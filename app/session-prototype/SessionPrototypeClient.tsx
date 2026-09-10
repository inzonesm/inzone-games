'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Logo } from '@/components/Logo';
import { useAuth } from '@/components/AuthProvider';
import { fetchApprovedGames, gameWebLink } from '@/lib/games';
import { sameOriginGameUrl } from '@/lib/game-hosting';
import type { HubGame } from '@/lib/types';
import {
  COPY,
  applySeatAction,
  channelNameForRoom,
  createSeat,
  filterCatalog,
  needsProgressConfirm,
  newPrototypeRoomId,
  pickFeaturedIds,
  prototypeInviteUrl,
  toGameRef,
  withServerUrl,
  type CatalogChip,
  type ProtoWireEvent,
  type ReviewMode,
  type SeatSnapshot,
  type Suggestion,
  type SuggestionSeatStatus,
  type Surface,
} from '@/lib/session-prototype';

type ThreadItem =
  | { kind: 'notice'; id: string; text: string }
  | { kind: 'chat'; id: string; fromSeat: string; fromLabel: string; sample?: boolean; text: string }
  | { kind: 'suggestion'; suggestion: Suggestion; statusBySeat: Record<string, SuggestionSeatStatus> };

type PendingSwitch = { seatId: string; gameId: string; reason: 'play' | 'open-suggested' };

const failedIcons = new Set<string>();

function thumbSrc(url: string): string {
  const noScheme = url.replace(/^https?:\/\//, '');
  return `https://images.weserv.nl/?url=ssl:${encodeURIComponent(noScheme)}&w=256&h=256&fit=cover&output=webp&q=80`;
}

function GameThumb({ url, name }: { url: string; name: string }) {
  const [stage, setStage] = useState<0 | 1 | 2>(() => (failedIcons.has(url) ? 2 : 0));
  if (!url || stage === 2) {
    return <div className="sp-thumb-fallback" aria-hidden="true">🎮</div>;
  }
  const src = stage === 0 ? thumbSrc(url) : url;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      draggable={false}
      onError={() => {
        setStage((s) => {
          const next = s === 0 ? 1 : 2;
          if (next === 2) failedIcons.add(url);
          return next;
        });
      }}
    />
  );
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  );
}
function IconExplore() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
function IconGames() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function pickStartId(games: HubGame[], requested: string | null): string {
  if (requested && games.some((g) => g.id === requested)) return requested;
  return pickFeaturedIds(games, 1)[0] || games[0]?.id || '';
}

function sampleThread(): ThreadItem[] {
  return [
    {
      kind: 'notice',
      id: 'notice-sample',
      text: 'Prototype conversation. “Sam · sample” is a fixture, not a real person.',
    },
    { kind: 'chat', id: 'chat-you-1', fromSeat: 'you', fromLabel: 'You', text: 'Another round?' },
    {
      kind: 'chat',
      id: 'chat-sample-1',
      fromSeat: 'sample',
      fromLabel: COPY.sampleLabel,
      sample: true,
      text: 'Let’s try something different.',
    },
  ];
}

export function SessionPrototypeClient() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const youLabel = user?.displayName?.split(/\s+/)[0] || 'You';
  const seatParam = searchParams.get('seat')?.trim() || 'you';
  const requestedGame = searchParams.get('game');
  const roomFromUrl = searchParams.get('room')?.trim() || '';

  const [games, setGames] = useState<HubGame[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<ReviewMode>(searchParams.get('split') === '1' ? 'split' : 'empty');
  const [surface, setSurface] = useState<Surface>('play');
  const [sessionOpen, setSessionOpen] = useState(true);
  const [immersive, setImmersive] = useState(false);
  const [chip, setChip] = useState<CatalogChip>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [draft, setDraft] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingSwitch | null>(null);
  const [room, setRoom] = useState(roomFromUrl);
  const [seats, setSeats] = useState<Record<string, SeatSnapshot>>({});
  const [focusSeat, setFocusSeat] = useState(seatParam);
  const [frameReady, setFrameReady] = useState<Record<string, string>>({});

  const byId = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  const featured = useMemo(() => {
    const ids = pickFeaturedIds(games, 3);
    return ids.map((id) => byId.get(id)).filter((g): g is HubGame => Boolean(g));
  }, [games, byId]);
  const filtered = useMemo(
    () => filterCatalog(games, { query, chip }),
    [games, query, chip],
  );

  const youSeat = seats[seatParam] || seats.you;
  const peerSeat = seats.peer;
  const activeSeat = seats[focusSeat] || youSeat;

  useEffect(() => {
    let cancelled = false;
    fetchApprovedGames()
      .then((items) => {
        if (cancelled) return;
        setGames(items);
        if (items.length === 0) setLoadError('No approved games in the catalog right now.');
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load catalog.');
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!games.length) return;
    const start = pickStartId(games, requestedGame);
    setSeats((prev) => {
      const next = { ...prev };
      if (!next.you) next.you = createSeat('you', youLabel, start);
      else if (next.you.label !== youLabel) next.you = { ...next.you, label: youLabel };
      if (seatParam !== 'you' && seatParam !== 'peer' && !next[seatParam]) {
        next[seatParam] = createSeat(seatParam, 'Companion seat', start);
      }
      if ((mode === 'split' || seatParam === 'peer') && !next.peer) {
        next.peer = createSeat('peer', 'Companion seat (this browser)', start);
      }
      return next;
    });
    setSelectedId((id) => id || featured[0]?.id || start);
  }, [games, featured, requestedGame, seatParam, youLabel, mode]);

  useEffect(() => {
    if (mode === 'sample') {
      setThread((t) => (t.some((i) => i.kind === 'chat' && i.sample) ? t : [...sampleThread(), ...t]));
    }
  }, [mode]);

  const channelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    channelRef.current?.close();
    channelRef.current = null;
    if (!room || typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(channelNameForRoom(room));
    channelRef.current = ch;
    ch.onmessage = (ev: MessageEvent<ProtoWireEvent>) => {
      const data = ev.data;
      if (!data || data.v !== 1) return;
      if (data.type === 'suggest') {
        setSeats((prev) => {
          const next = { ...prev };
          for (const id of Object.keys(next)) {
            next[id] = applySeatAction(next[id], { type: 'receive-suggestion', suggestion: data.suggestion });
          }
          return next;
        });
        setThread((t) => {
          if (t.some((i) => i.kind === 'suggestion' && i.suggestion.id === data.suggestion.id)) return t;
          return [...t, { kind: 'suggestion', suggestion: data.suggestion, statusBySeat: {} }];
        });
        setSessionOpen(true);
      } else if (data.type === 'chat') {
        setThread((t) => {
          if (t.some((i) => i.kind === 'chat' && i.id === data.id)) return t;
          return [...t, { kind: 'chat', id: data.id, fromSeat: data.fromSeat, fromLabel: data.fromLabel, text: data.text }];
        });
      } else if (data.type === 'suggestion-status') {
        setThread((t) => t.map((item) => {
          if (item.kind !== 'suggestion' || item.suggestion.id !== data.suggestionId) return item;
          return { ...item, statusBySeat: { ...item.statusBySeat, [data.seatId]: data.status } };
        }));
      }
    };
    return () => { ch.close(); };
  }, [room]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, []);

  const patchSeat = useCallback((id: string, action: Parameters<typeof applySeatAction>[1]) => {
    setSeats((prev) => {
      const seat = prev[id];
      if (!seat) return prev;
      return { ...prev, [id]: applySeatAction(seat, action) };
    });
  }, []);

  const requestPlay = useCallback((seatId: string, gameId: string, reason: PendingSwitch['reason']) => {
    const seat = seats[seatId];
    if (!seat || !gameId) return;
    if (seat.gameId === gameId) {
      setSurface('play');
      return;
    }
    if (needsProgressConfirm(seat, gameId)) {
      setPending({ seatId, gameId, reason });
      return;
    }
    patchSeat(seatId, reason === 'open-suggested' ? { type: 'open-suggested', gameId } : { type: 'play-game', gameId });
    setSurface('play');
  }, [seats, patchSeat]);

  const confirmPending = useCallback(() => {
    if (!pending) return;
    patchSeat(
      pending.seatId,
      pending.reason === 'open-suggested'
        ? { type: 'open-suggested', gameId: pending.gameId }
        : { type: 'play-game', gameId: pending.gameId },
    );
    setSurface('play');
    setPending(null);
  }, [pending, patchSeat]);

  const suggestGame = useCallback((from: SeatSnapshot, game: HubGame) => {
    const suggestion: Suggestion = {
      id: `sug-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fromSeat: from.id,
      fromLabel: from.label,
      game: toGameRef(game),
      createdAt: Date.now(),
    };
    patchSeat(from.id, { type: 'receive-suggestion', suggestion });
    setThread((t) => [...t, { kind: 'suggestion', suggestion, statusBySeat: {} }]);
    setSessionOpen(true);
    setSurface('play');
    channelRef.current?.postMessage({ v: 1, type: 'suggest', suggestion } satisfies ProtoWireEvent);
    flash('Suggested to this prototype session. Nobody was moved.');
  }, [flash, patchSeat]);

  const setSuggestionStatus = useCallback((suggestion: Suggestion, seatId: string, status: SuggestionSeatStatus) => {
    setThread((t) => t.map((item) => {
      if (item.kind !== 'suggestion' || item.suggestion.id !== suggestion.id) return item;
      return { ...item, statusBySeat: { ...item.statusBySeat, [seatId]: status } };
    }));
    patchSeat(seatId, { type: 'keep-playing', suggestionId: suggestion.id });
    channelRef.current?.postMessage({
      v: 1,
      type: 'suggestion-status',
      suggestionId: suggestion.id,
      seatId,
      status,
    } satisfies ProtoWireEvent);
  }, [patchSeat]);

  const sendChat = useCallback(() => {
    const text = draft.trim();
    if (!text || !youSeat) return;
    const id = `chat-${Date.now()}`;
    setThread((t) => [...t, { kind: 'chat', id, fromSeat: youSeat.id, fromLabel: youSeat.label, text }]);
    setDraft('');
    channelRef.current?.postMessage({
      v: 1,
      type: 'chat',
      id,
      fromSeat: youSeat.id,
      fromLabel: youSeat.label,
      text,
      createdAt: Date.now(),
    } satisfies ProtoWireEvent);
  }, [draft, youSeat]);

  async function copyInvite() {
    const gameId = youSeat?.gameId || requestedGame || '';
    const nextRoom = room || newPrototypeRoomId();
    if (!room) setRoom(nextRoom);
    const proto = prototypeInviteUrl(window.location.origin, { gameId, room: nextRoom, seat: 'peer' });
    const live = gameId ? gameWebLink(gameId) : '';
    const payload = live
      ? `${proto}\n\nLive player (production, unchanged): ${live}`
      : proto;
    try {
      await navigator.clipboard.writeText(payload);
      flash('Copied prototype invite link. Nobody was notified.');
    } catch {
      flash(proto);
    }
  }

  const selected = (selectedId && byId.get(selectedId)) || featured[0] || games[0] || null;
  const pendingGame = pending ? byId.get(pending.gameId) : undefined;
  const pendingFrom = pending ? byId.get(seats[pending.seatId]?.gameId || '') : undefined;
  const sessionCollapsed = immersive || !sessionOpen;
  const peopleCount = 1 + (mode === 'sample' ? 1 : 0) + (mode === 'split' && peerSeat ? 1 : 0);

  function openDiscover(gameId?: string) {
    if (gameId) setSelectedId(gameId);
    setSurface('discover');
    setImmersive(false);
  }

  const seatIds = mode === 'split' ? ['you', 'peer'] : [seats[seatParam] ? seatParam : 'you'];

  return (
    <div className={`sp-root${immersive ? ' is-immersive' : ''}`}>
      <header className="sp-banner">
        <span className="sp-banner-kicker">{COPY.banner}</span>
        <h1>Play stays central. <span>The conversation stays with you.</span></h1>
        <div className="sp-banner-actions">
          <button type="button" className={`sp-mode${mode === 'empty' ? ' is-on' : ''}`} onClick={() => setMode('empty')}>
            Empty session
          </button>
          <button type="button" className={`sp-mode${mode === 'sample' ? ' is-on' : ''}`} onClick={() => setMode('sample')}>
            Sample companion
          </button>
          <button
            type="button"
            className={`sp-mode${mode === 'split' ? ' is-on' : ''}`}
            onClick={() => { setMode('split'); setSessionOpen(true); }}
          >
            Independent split
          </button>
          <button type="button" className={`sp-mode${immersive ? ' is-on' : ''}`} onClick={() => setImmersive((v) => !v)}>
            {immersive ? 'Show chrome' : 'Collapse for immersion'}
          </button>
          {sessionCollapsed && (
            <button type="button" className="sp-mode is-on" onClick={() => { setImmersive(false); setSessionOpen(true); }}>
              Your session
            </button>
          )}
          <Link href="/games">Live hub</Link>
        </div>
      </header>

      <div className={`sp-shell${sessionCollapsed ? ' is-session-collapsed' : ''}${mode === 'split' ? ' is-split' : ''}`}>
        <nav className="sp-nav" aria-label="Player navigation">
          <Link href="/session-prototype" className="sp-brand">
            <Logo size={28} />
            <strong>InZone</strong>
          </Link>
          <button type="button" className={surface === 'play' ? 'is-on' : ''} onClick={() => setSurface('play')}>
            <IconPlay /> Play
          </button>
          <button type="button" className={surface === 'discover' ? 'is-on' : ''} onClick={() => openDiscover()}>
            <IconExplore /> Explore
          </button>
          <button type="button" className={surface === 'yours' ? 'is-on' : ''} onClick={() => setSurface('yours')}>
            <IconGames /> Your games
          </button>
          <div className="sp-nav-spacer" />
          <Link href="/upload" className="sp-nav-link sp-nav-studio">
            Studio
            <small>production</small>
          </Link>
        </nav>

        <div className={mode === 'split' ? 'sp-split-wrap' : 'sp-stage-col'}>
          <div className={mode === 'split' ? 'sp-split' : 'sp-stage-col'}>
            {seatIds.map((id) => {
              const seat = seats[id];
              if (!seat) return null;
              const game = byId.get(seat.gameId);
              const showCover = focusSeat === id && surface !== 'play';
              return (
                <section
                  key={id}
                  className={mode === 'split' ? 'sp-seat' : 'sp-stage-col'}
                  onPointerDown={() => setFocusSeat(id)}
                >
                  <div className="sp-seat-head">
                    <div>
                      <h2>{game?.name || 'Loading catalog…'}</h2>
                      <p>
                        {seat.label}
                        {mode === 'split' ? ' · independent seat' : ''}
                        {game?.description ? ` · ${game.description}` : ''}
                      </p>
                    </div>
                    <div className="sp-game-meta">
                      {game?.serverUrl ? <span>Has a server URL — still not the same match</span> : <span>Solo-safe</span>}
                    </div>
                    <Link href="/games" className="sp-exit" style={{ textDecoration: 'none' }}>Exit to hub</Link>
                  </div>

                  <div className="sp-play">
                    <div className={`sp-frame-hold${showCover ? ' is-covered' : ''}`}>
                      {loadError && (
                        <div className="sp-cover" style={{ position: 'absolute' }}>
                          <h3>Catalog unavailable</h3>
                          <p className="sp-lede">{loadError}</p>
                        </div>
                      )}
                      {game && (
                        <iframe
                          key={seat.gameId}
                          src={sameOriginGameUrl(withServerUrl(game.gameUrl, game.serverUrl))}
                          title={game.name}
                          scrolling="no"
                          allow="camera; microphone; geolocation; encrypted-media; autoplay; fullscreen; gamepad; accelerometer; gyroscope"
                          allowFullScreen
                          onLoad={() => {
                            patchSeat(id, { type: 'mark-interacted' });
                            setFrameReady((m) => ({ ...m, [id]: seat.gameId }));
                          }}
                        />
                      )}
                      {game && frameReady[id] !== game.id && (
                        <div className="sp-cover" style={{ position: 'absolute', zIndex: 1, background: 'var(--bg)' }}>
                          <p className="sp-lede">Loading {game.name}… the game stays mounted while you open session or discovery.</p>
                        </div>
                      )}
                    </div>

                    {showCover && (
                      <div className="sp-cover is-sheet-open">
                        {game && <div className="sp-running-chip">{COPY.stillRunning(game.name)}</div>}
                        {surface === 'discover' && (
                          <>
                            <div className="sp-actions" style={{ marginBottom: 12 }}>
                              <button type="button" className="sp-btn sp-btn-ghost" onClick={() => setSurface('play')}>
                                Back to game
                              </button>
                            </div>
                            <h3>What next?</h3>
                            <p className="sp-lede">Pick a game. Keep the conversation going. The current game stays mounted.</p>
                            <div className="sp-chips">
                              <button type="button" className={chip === 'all' ? 'is-on' : ''} onClick={() => setChip('all')}>Browse all</button>
                              <button type="button" className={chip === 'action' ? 'is-on' : ''} onClick={() => setChip('action')}>Action</button>
                              <button type="button" className={chip === 'puzzle' ? 'is-on' : ''} onClick={() => setChip('puzzle')}>Puzzle</button>
                            </div>
                            <input
                              className="sp-search"
                              value={query}
                              onChange={(e) => setQuery(e.target.value)}
                              placeholder="Search the live catalog…"
                              aria-label="Search games"
                            />
                            {selected && (
                              <div className="sp-highlight">
                                <div className="sp-highlight-card">
                                  <GameThumb url={selected.iconUrl} name={selected.name} />
                                  <div>
                                    <h4>{selected.name}</h4>
                                    <p>{selected.description || 'Live catalog title. Artwork is the real icon, not the concept mock.'}</p>
                                    <div className="sp-actions">
                                      <button type="button" className="sp-btn sp-btn-primary" onClick={() => requestPlay(id, selected.id, 'play')}>
                                        {COPY.playThis}
                                      </button>
                                      <button type="button" className="sp-btn sp-btn-ghost" onClick={() => suggestGame(seat, selected)}>
                                        {COPY.suggestToSession}
                                      </button>
                                      <Link className="sp-btn sp-btn-quiet" href={`/games/${encodeURIComponent(selected.id)}`}>
                                        Live player
                                      </Link>
                                    </div>
                                    <p className="sp-note">{COPY.suggestNever} {COPY.sameMatch}</p>
                                  </div>
                                </div>
                              </div>
                            )}
                            <div className="sp-grid">
                              {filtered.map((g) => (
                                <button
                                  key={g.id}
                                  type="button"
                                  className={`sp-card${selected?.id === g.id ? ' is-on' : ''}`}
                                  onClick={() => setSelectedId(g.id)}
                                >
                                  <GameThumb url={g.iconUrl} name={g.name} />
                                  <span>{g.name}</span>
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                        {surface === 'yours' && (
                          <>
                            <div className="sp-actions" style={{ marginBottom: 12 }}>
                              <button type="button" className="sp-btn sp-btn-ghost" onClick={() => setSurface('play')}>
                                Back to game
                              </button>
                            </div>
                            <h3>Your games</h3>
                            <p className="sp-lede">Titles this seat opened in the prototype. Not a fabricated library.</p>
                            <div className="sp-grid">
                              {seat.playedIds.map((gid) => {
                                const g = byId.get(gid);
                                if (!g) return null;
                                return (
                                  <button key={gid} type="button" className="sp-card" onClick={() => requestPlay(id, g.id, 'play')}>
                                    <GameThumb url={g.iconUrl} name={g.name} />
                                    <span>{g.name}</span>
                                  </button>
                                );
                              })}
                            </div>
                            {seat.playedIds.length === 0 && <p className="sp-note">Open a game and it will appear here.</p>}
                          </>
                        )}
                      </div>
                    )}

                    <div className="sp-dock">
                      <button type="button" className="sp-btn sp-btn-ghost" onClick={() => { setSessionOpen(true); setImmersive(false); }}>
                        Session
                      </button>
                      <button type="button" className="sp-btn sp-btn-primary" onClick={() => openDiscover()}>
                        Discover
                      </button>
                    </div>
                    <div className="sp-immerse-peek">
                      <button type="button" className="sp-btn sp-btn-ghost" onClick={() => setImmersive(false)}>Show chrome</button>
                    </div>
                  </div>

                  {mode !== 'split' && (
                    <div className="sp-strip">
                      <h3>Choose another game</h3>
                      <div className="sp-strip-row">
                        {featured.map((g) => (
                          <button key={g.id} type="button" className="sp-strip-card" onClick={() => openDiscover(g.id)}>
                            <GameThumb url={g.iconUrl} name={g.name} />
                            <span>{g.name}</span>
                          </button>
                        ))}
                      </div>
                      <button type="button" className="sp-btn sp-btn-ghost" onClick={() => { setChip('all'); openDiscover(); }}>
                        Browse all
                      </button>
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          {mode === 'split' && (
            <SessionPanel
              open={!sessionCollapsed}
              peopleCount={peopleCount}
              mode={mode}
              youSeat={youSeat}
              peerSeat={peerSeat}
              byId={byId}
              thread={thread}
              draft={draft}
              setDraft={setDraft}
              onSend={sendChat}
              onInvite={() => void copyInvite()}
              onCollapse={() => setSessionOpen(false)}
              onKeep={(suggestion) => {
                if (!activeSeat) return;
                setSuggestionStatus(suggestion, activeSeat.id, 'kept');
              }}
              onOpen={(suggestion) => {
                if (!activeSeat) return;
                setSuggestionStatus(suggestion, activeSeat.id, 'opened');
                requestPlay(activeSeat.id, suggestion.game.id, 'open-suggested');
              }}
              onSampleKeep={(suggestion) => setSuggestionStatus(suggestion, 'sample', 'kept')}
              focusSeatId={focusSeat}
            />
          )}
        </div>

        {mode !== 'split' && (
          <SessionPanel
            open={!sessionCollapsed}
            peopleCount={peopleCount}
            mode={mode}
            youSeat={youSeat}
            peerSeat={peerSeat}
            byId={byId}
            thread={thread}
            draft={draft}
            setDraft={setDraft}
            onSend={sendChat}
            onInvite={() => void copyInvite()}
            onCollapse={() => { setSessionOpen(false); }}
            onKeep={(suggestion) => {
              if (!youSeat) return;
              setSuggestionStatus(suggestion, youSeat.id, 'kept');
            }}
            onOpen={(suggestion) => {
              if (!youSeat) return;
              setSuggestionStatus(suggestion, youSeat.id, 'opened');
              requestPlay(youSeat.id, suggestion.game.id, 'open-suggested');
            }}
            onSampleKeep={(suggestion) => setSuggestionStatus(suggestion, 'sample', 'kept')}
            focusSeatId={youSeat?.id || 'you'}
          />
        )}
      </div>

      <p className="sp-legal">{COPY.footer} Production player, SDK, auth, analytics, hosting, storage, and purchases are unchanged.</p>

      {toast && <div className="sp-toast" role="status">{toast}</div>}

      {pending && (
        <div className="sp-dialog" role="dialog" aria-modal="true" aria-labelledby="sp-switch-title">
          <div className="sp-dialog-card">
            <h3 id="sp-switch-title">{COPY.switchTitle(pendingFrom?.name || 'this game')}</h3>
            <p>{COPY.switchBody(pendingFrom?.name || 'this game')}</p>
            {pendingGame && <p>Next: {pendingGame.name}. {COPY.sameMatch}</p>}
            <div className="sp-actions">
              <button type="button" className="sp-btn sp-btn-ghost" onClick={() => setPending(null)}>{COPY.keepPlaying}</button>
              <button type="button" className="sp-btn sp-btn-primary" onClick={confirmPending}>{COPY.switchAnyway}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SessionPanel({
  open,
  peopleCount,
  mode,
  youSeat,
  peerSeat,
  byId,
  thread,
  draft,
  setDraft,
  onSend,
  onInvite,
  onCollapse,
  onKeep,
  onOpen,
  onSampleKeep,
  focusSeatId,
}: {
  open: boolean;
  peopleCount: number;
  mode: ReviewMode;
  youSeat?: SeatSnapshot;
  peerSeat?: SeatSnapshot;
  byId: Map<string, HubGame>;
  thread: ThreadItem[];
  draft: string;
  setDraft: (v: string) => void;
  onSend: () => void;
  onInvite: () => void;
  onCollapse: () => void;
  onKeep: (suggestion: Suggestion) => void;
  onOpen: (suggestion: Suggestion) => void;
  onSampleKeep: (suggestion: Suggestion) => void;
  focusSeatId: string;
}) {
  const youGame = youSeat ? byId.get(youSeat.gameId) : undefined;
  const peerGame = peerSeat ? byId.get(peerSeat.gameId) : undefined;
  const empty = mode === 'empty';

  return (
    <aside className={`sp-session${open ? ' is-sheet-open' : ''}`} aria-label="Your session">
      <div className="sp-session-head">
        <h2>Your session</h2>
        <button type="button" className="sp-exit" onClick={onCollapse} aria-label="Collapse session">Collapse</button>
      </div>

      <div className="sp-people">
        <div className="sp-person">
          <div className="sp-avatar">Y</div>
          <div>
            <strong>{youSeat?.label || 'You'}</strong>
            <span>{youGame ? `Playing ${youGame.name}` : 'In this session'}</span>
          </div>
        </div>
        {mode === 'sample' && (
          <div className="sp-person">
            <div className="sp-avatar is-sample">S</div>
            <div>
              <strong>{COPY.sampleLabel}</strong>
              <span>{COPY.sampleHint}</span>
            </div>
          </div>
        )}
        {mode === 'split' && peerSeat && (
          <div className="sp-person">
            <div className="sp-avatar is-sample">C</div>
            <div>
              <strong>{peerSeat.label}</strong>
              <span>
                {peerGame ? `Playing ${peerGame.name}` : 'Independent seat'}
                {youGame && peerGame && youGame.id === peerGame.id ? ' · same title ≠ same match' : ''}
              </span>
            </div>
          </div>
        )}
      </div>

      {empty && peopleCount <= 1 && (
        <div className="sp-empty">
          <h3>{COPY.emptyTitle}</h3>
          <p>{COPY.emptyBody}</p>
          <button type="button" className="sp-btn sp-btn-primary" onClick={onInvite}>Invite by link</button>
          <p className="sp-note">{COPY.inviteHint}</p>
        </div>
      )}

      <div className="sp-thread">
        <p className="sp-notice">{COPY.chatNotice}</p>
        {thread.map((item) => {
          if (item.kind === 'notice') {
            return <p key={item.id} className="sp-notice">{item.text}</p>;
          }
          if (item.kind === 'chat') {
            return (
              <div key={item.id} className={`sp-bubble${item.fromSeat === youSeat?.id ? ' is-you' : ''}`}>
                <small>{item.sample ? `${item.fromLabel} · fixture` : item.fromLabel}</small>
                {item.text}
              </div>
            );
          }
          const mine = item.statusBySeat[focusSeatId];
          const sampleStatus = item.statusBySeat.sample;
          const peerStatus = item.statusBySeat.peer;
          return (
            <div key={item.suggestion.id} className="sp-suggest">
              <small>{item.suggestion.fromLabel} suggested</small>
              <div className="sp-suggest-game">
                <GameThumb url={item.suggestion.game.iconUrl} name={item.suggestion.game.name} />
                <div>
                  <strong>{item.suggestion.game.name}</strong>
                  <span>{item.suggestion.game.description || 'Exact catalog title'}</span>
                </div>
              </div>
              <div className="sp-actions">
                <button type="button" className="sp-btn sp-btn-primary" onClick={() => onOpen(item.suggestion)}>
                  {COPY.openGame}
                </button>
                <button type="button" className="sp-btn sp-btn-ghost" onClick={() => onKeep(item.suggestion)}>
                  {COPY.keepPlaying}
                </button>
              </div>
              <p className="sp-note">
                {COPY.suggestNever} {COPY.sameMatch}
                {mine === 'kept' ? ' You kept playing.' : ''}
                {mine === 'opened' ? ' You opened it in this seat only.' : ''}
                {sampleStatus === 'kept' ? ' Sample companion ignored it.' : ''}
                {peerStatus === 'kept' ? ' Companion seat kept playing.' : ''}
                {peerStatus === 'opened' ? ' Companion seat opened it independently.' : ''}
              </p>
              {mode === 'sample' && sampleStatus !== 'kept' && sampleStatus !== 'opened' && (
                <button type="button" className="sp-btn sp-btn-quiet" onClick={() => onSampleKeep(item.suggestion)}>
                  Demonstrate ignored suggestion
                </button>
              )}
            </div>
          );
        })}
      </div>

      <form
        className="sp-compose"
        onSubmit={(e) => { e.preventDefault(); onSend(); }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={COPY.chatPlaceholder}
          aria-label="Prototype message"
        />
        <button type="submit" className="sp-btn sp-btn-ghost">Send</button>
      </form>
      <div className="sp-foot-actions">
        <button type="button" className="sp-btn sp-btn-ghost" onClick={onInvite}>Invite by link</button>
        {youSeat && (
          <Link className="sp-btn sp-btn-quiet" href={`/games/${encodeURIComponent(youSeat.gameId)}`}>
            Live player
          </Link>
        )}
      </div>
    </aside>
  );
}
