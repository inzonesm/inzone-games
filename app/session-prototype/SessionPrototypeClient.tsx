'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { Logo } from '@/components/Logo';
import { useAuth } from '@/components/AuthProvider';
import { fetchApprovedGames } from '@/lib/games';
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
  playerFacingDescription,
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

function thumbSrc(url: string, size: number): string {
  const noScheme = url.replace(/^https?:\/\//, '');
  return `https://images.weserv.nl/?url=ssl:${encodeURIComponent(noScheme)}&w=${size}&h=${size}&fit=cover&output=webp&q=80`;
}

function coverUrl(game: Pick<HubGame, 'iconUrl' | 'preview'>): string {
  return game.preview?.posterUrl?.trim() || game.iconUrl;
}

function GameThumb({ url, name, size = 256 }: { url: string; name: string; size?: number }) {
  const [stage, setStage] = useState<0 | 1 | 2>(() => (failedIcons.has(url) ? 2 : 0));
  if (!url || stage === 2) {
    return <div className="sp-thumb-fallback" aria-hidden="true">🎮</div>;
  }
  const src = stage === 0 ? thumbSrc(url, size) : url;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
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

function IconChat() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 6h16v10H8l-4 4V6z" />
    </svg>
  );
}
function IconDiscover() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="4" y="5" width="6" height="6" rx="1.2" />
      <rect x="14" y="5" width="6" height="6" rx="1.2" />
      <rect x="4" y="13" width="6" height="6" rx="1.2" />
      <rect x="14" y="13" width="6" height="6" rx="1.2" />
    </svg>
  );
}
function IconFull() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4" />
    </svg>
  );
}
function IconClose() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function pickStartId(games: HubGame[], requested: string | null): string {
  if (requested && games.some((g) => g.id === requested)) return requested;
  return pickFeaturedIds(games, 1)[0] || games[0]?.id || '';
}

function sampleThread(): ThreadItem[] {
  return [
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
  const reviewFromUrl = searchParams.get('review') === '1';

  const [games, setGames] = useState<HubGame[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<ReviewMode>(searchParams.get('split') === '1' ? 'split' : 'empty');
  const [surface, setSurface] = useState<Surface>('play');
  const [chatOpen, setChatOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(reviewFromUrl);
  const [chip, setChip] = useState<CatalogChip>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [draft, setDraft] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingSwitch | null>(null);
  const [room, setRoom] = useState(roomFromUrl);
  const [seats, setSeats] = useState<Record<string, SeatSnapshot>>({});
  const [focusSeat, setFocusSeat] = useState(seatParam);
  const [frameReady, setFrameReady] = useState<Record<string, string>>({});
  const [narrow, setNarrow] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  const featured = useMemo(() => {
    const ids = pickFeaturedIds(games, 5);
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
        if (items.length === 0) setLoadError('No games available right now.');
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load games.');
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

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)');
    const syncNarrow = () => setNarrow(mq.matches);
    syncNarrow();
    mq.addEventListener('change', syncNarrow);
    return () => mq.removeEventListener('change', syncNarrow);
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      const bottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      rootRef.current?.style.setProperty('--sp-vv-bottom', `${bottom}px`);
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
    };
  }, []);

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
        setChatOpen(true);
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
      setDetailId(null);
      return;
    }
    if (needsProgressConfirm(seat, gameId)) {
      setPending({ seatId, gameId, reason });
      return;
    }
    patchSeat(seatId, reason === 'open-suggested' ? { type: 'open-suggested', gameId } : { type: 'play-game', gameId });
    setSurface('play');
    setDetailId(null);
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
    setDetailId(null);
    setPending(null);
  }, [pending, patchSeat]);

  const suggestGame = useCallback((from: SeatSnapshot, game: HubGame) => {
    const suggestion: Suggestion = {
      id: `sug-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fromSeat: from.id,
      fromLabel: from.label,
      game: toGameRef({
        ...game,
        iconUrl: coverUrl(game),
        description: playerFacingDescription(game.description, game.name) || '',
      }),
      createdAt: Date.now(),
    };
    patchSeat(from.id, { type: 'receive-suggestion', suggestion });
    setThread((t) => [...t, { kind: 'suggestion', suggestion, statusBySeat: {} }]);
    setChatOpen(true);
    channelRef.current?.postMessage({ v: 1, type: 'suggest', suggestion } satisfies ProtoWireEvent);
    flash('Suggested. Nobody was moved.');
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
    try {
      await navigator.clipboard.writeText(proto);
      flash(COPY.inviteHint);
    } catch {
      flash(proto);
    }
    setChatOpen(true);
    setReviewOpen(false);
  }

  async function toggleFullscreen() {
    const node = stageRef.current;
    if (!node) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await node.requestFullscreen();
    } catch {
      /* fullscreen can be blocked */
    }
  }

  const selected = (detailId && byId.get(detailId)) || (selectedId && byId.get(selectedId)) || featured[0] || games[0] || null;
  const pendingGame = pending ? byId.get(pending.gameId) : undefined;
  const peopleCount = 1 + (mode === 'sample' ? 1 : 0) + (mode === 'split' && peerSeat ? 1 : 0);
  const sheetOpen = surface !== 'play';
  const overlayBlocksGame = sheetOpen || (chatOpen && narrow);
  const seatIds = mode === 'split' ? ['you', 'peer'] : [seats[seatParam] ? seatParam : 'you'];
  const currentGame = youSeat ? byId.get(youSeat.gameId) : undefined;

  function openDiscover(gameId?: string) {
    if (gameId) {
      setSelectedId(gameId);
      setDetailId(gameId);
    } else {
      setDetailId(null);
    }
    setSurface('discover');
    setReviewOpen(false);
  }

  const chatPanel = (
    <ChatPanel
      mode={mode}
      peopleCount={peopleCount}
      youSeat={youSeat}
      peerSeat={peerSeat}
      byId={byId}
      thread={thread}
      draft={draft}
      setDraft={setDraft}
      onSend={sendChat}
      onInvite={() => void copyInvite()}
      onClose={() => setChatOpen(false)}
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
      focusSeatId={activeSeat?.id || 'you'}
    />
  );

  return (
    <div className={`sp-root${overlayBlocksGame ? ' is-overlay' : ''}`} ref={rootRef}>
      <header className="sp-top">
        <Link href="/session-prototype" className="sp-brand">
          <Logo size={22} />
          INZONE
        </Link>
        <nav className="sp-tabs" aria-label="Play">
          <button type="button" className={`sp-tab${surface === 'discover' ? ' is-on' : ''}`} onClick={() => openDiscover()}>
            Discover
          </button>
          <button type="button" className={`sp-tab${surface === 'yours' ? ' is-on' : ''}`} onClick={() => setSurface('yours')}>
            Your games
          </button>
        </nav>
        <div className="sp-top-end">
          <button type="button" className="sp-demo" aria-expanded={reviewOpen} onClick={() => setReviewOpen((v) => !v)}>
            {COPY.demo}
          </button>
          <button type="button" className="sp-invite" onClick={() => void copyInvite()}>Invite</button>
        </div>
      </header>

      <div className="sp-body">
        <div className="sp-play-row">
          <div className="sp-game-wrap">
          {mode === 'split' ? (
            <div className="sp-split">
              {seatIds.map((id) => (
                <GameStage
                  key={id}
                  stageRef={id === 'you' ? stageRef : undefined}
                  seat={seats[id]}
                  game={seats[id] ? byId.get(seats[id].gameId) : undefined}
                  loadError={loadError}
                  ready={seats[id] ? frameReady[id] === seats[id].gameId : false}
                  blocked={overlayBlocksGame && focusSeat === id}
                  onFocus={() => setFocusSeat(id)}
                  onReady={() => {
                    if (!seats[id]) return;
                    patchSeat(id, { type: 'mark-interacted' });
                    setFrameReady((m) => ({ ...m, [id]: seats[id].gameId }));
                  }}
                />
              ))}
            </div>
          ) : (
            <GameStage
              stageRef={stageRef}
              seat={youSeat}
              game={currentGame}
              loadError={loadError}
              ready={youSeat ? frameReady[youSeat.id] === youSeat.gameId : false}
              blocked={overlayBlocksGame}
              onReady={() => {
                if (!youSeat) return;
                patchSeat(youSeat.id, { type: 'mark-interacted' });
                setFrameReady((m) => ({ ...m, [youSeat.id]: youSeat.gameId }));
              }}
            />
          )}

          {sheetOpen && (
            <section className="sp-sheet" aria-label={surface === 'yours' ? 'Your games' : 'Discover'}>
              <div className="sp-sheet-head">
                <h2>{surface === 'yours' ? 'Your games' : COPY.findNext}</h2>
                <button type="button" className="sp-icon-btn" aria-label="Close" onClick={() => { setSurface('play'); setDetailId(null); }}>
                  <IconClose />
                </button>
              </div>
              <div className="sp-sheet-body">
                {currentGame && (
                  <button type="button" className="sp-back" onClick={() => { setSurface('play'); setDetailId(null); }}>
                    ← Back to {currentGame.name}
                  </button>
                )}
                {surface === 'discover' && (
                  <>
                    <input
                      className="sp-search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={COPY.search}
                      aria-label={COPY.search}
                    />
                    <div className="sp-chips">
                      <button type="button" className={chip === 'all' ? 'is-on' : ''} onClick={() => setChip('all')}>All</button>
                      <button type="button" className={chip === 'action' ? 'is-on' : ''} onClick={() => setChip('action')}>Action</button>
                      <button type="button" className={chip === 'puzzle' ? 'is-on' : ''} onClick={() => setChip('puzzle')}>Puzzle</button>
                    </div>
                    {detailId && selected && youSeat && (
                      <GameDetail
                        game={selected}
                        onPlay={() => requestPlay(youSeat.id, selected.id, 'play')}
                        onSuggest={() => suggestGame(youSeat, selected)}
                      />
                    )}
                    <div className="sp-grid">
                      {filtered.map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          className="sp-card"
                          onClick={() => setDetailId(g.id)}
                        >
                          <GameThumb url={coverUrl(g)} name={g.name} size={320} />
                          <span>{g.name}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {surface === 'yours' && youSeat && (
                  <div className="sp-grid">
                    {youSeat.playedIds.map((gid) => {
                      const g = byId.get(gid);
                      if (!g) return null;
                      return (
                        <button key={gid} type="button" className="sp-card" onClick={() => requestPlay(youSeat.id, g.id, 'play')}>
                          <GameThumb url={coverUrl(g)} name={g.name} size={320} />
                          <span>{g.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          )}
          </div>
          {chatOpen && chatPanel}
        </div>

        <div className="sp-bar">
          <div className="sp-now">
            {currentGame && <GameThumb url={coverUrl(currentGame)} name={currentGame.name} size={72} />}
            <strong>{currentGame?.name || 'Loading…'}</strong>
          </div>
          <div className="sp-tools">
            <button
              type="button"
              className={`sp-tool${chatOpen ? ' is-on' : ''}`}
              onClick={() => { setChatOpen((v) => !v); setReviewOpen(false); }}
            >
              <IconChat /> <span>{COPY.chat}</span>
            </button>
            <button
              type="button"
              className={`sp-tool${surface === 'discover' ? ' is-on' : ''}`}
              onClick={() => (surface === 'discover' ? setSurface('play') : openDiscover())}
            >
              <IconDiscover /> <span>{COPY.moreGames}</span>
            </button>
            <button type="button" className="sp-tool" onClick={() => void toggleFullscreen()}>
              <IconFull /> <span>{COPY.fullscreen}</span>
            </button>
          </div>
        </div>

        {surface === 'play' && mode !== 'split' && (
          <section className="sp-rail" aria-label={COPY.findNext}>
            <h2>{COPY.findNext}</h2>
            <div className="sp-rail-row">
              {featured.filter((g) => g.id !== currentGame?.id).map((g) => (
                <button key={g.id} type="button" className="sp-tile" onClick={() => openDiscover(g.id)}>
                  <GameThumb url={coverUrl(g)} name={g.name} size={320} />
                  <span>{g.name}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      {reviewOpen && (
        <div className="sp-review" role="dialog" aria-label="Demo controls">
          <h3>Demo controls</h3>
          <p>These sit outside ordinary play. Chat and invites are simulated. Sample names are not real people.</p>
          <div className="sp-review-actions">
            <button type="button" className={`sp-btn ${mode === 'empty' ? 'sp-btn-primary' : 'sp-btn-ghost'}`} onClick={() => setMode('empty')}>
              Empty session
            </button>
            <button type="button" className={`sp-btn ${mode === 'sample' ? 'sp-btn-primary' : 'sp-btn-ghost'}`} onClick={() => { setMode('sample'); setChatOpen(true); }}>
              Sample companion
            </button>
            <button
              type="button"
              className={`sp-btn ${mode === 'split' ? 'sp-btn-primary' : 'sp-btn-ghost'}`}
              onClick={() => { setMode('split'); setChatOpen(true); }}
            >
              Independent split
            </button>
            <Link href="/games">Game hub</Link>
            <Link href="/upload">Studio</Link>
          </div>
        </div>
      )}

      {toast && <div className="sp-toast" role="status">{toast}</div>}

      {pending && (
        <div className="sp-dialog" role="dialog" aria-modal="true" aria-labelledby="sp-switch-title">
          <div className="sp-dialog-card">
            <h3 id="sp-switch-title">{COPY.switchTitle}</h3>
            <p>{COPY.switchBody}{pendingGame ? ` Next: ${pendingGame.name}.` : ''}</p>
            <div className="sp-actions">
              <button type="button" className="sp-btn sp-btn-ghost" onClick={() => setPending(null)}>{COPY.keepPlaying}</button>
              <button type="button" className="sp-btn sp-btn-primary" onClick={confirmPending}>{COPY.switchGame}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GameStage({
  stageRef,
  seat,
  game,
  loadError,
  ready,
  blocked,
  onFocus,
  onReady,
}: {
  stageRef?: Ref<HTMLDivElement>;
  seat?: SeatSnapshot;
  game?: HubGame;
  loadError: string | null;
  ready: boolean;
  blocked: boolean;
  onFocus?: () => void;
  onReady: () => void;
}) {
  return (
    <div className="sp-stage-col" onPointerDown={onFocus}>
      <div className="sp-stage" ref={stageRef}>
        <div className={`sp-frame-hold${blocked ? ' is-blocked' : ''}`}>
          {loadError && <div className="sp-load">{loadError}</div>}
          {game && seat && (
            <iframe
              key={seat.gameId}
              src={sameOriginGameUrl(withServerUrl(game.gameUrl, game.serverUrl))}
              title={game.name}
              scrolling="no"
              allow="camera; microphone; geolocation; encrypted-media; autoplay; fullscreen; gamepad; accelerometer; gyroscope"
              allowFullScreen
              onLoad={onReady}
            />
          )}
          {game && !ready && <div className="sp-load">Loading {game.name}…</div>}
        </div>
      </div>
    </div>
  );
}

function GameDetail({
  game,
  onPlay,
  onSuggest,
}: {
  game: HubGame;
  onPlay: () => void;
  onSuggest: () => void;
}) {
  const blurb = playerFacingDescription(game.description, game.name);
  return (
    <div className="sp-detail">
      <GameThumb url={coverUrl(game)} name={game.name} size={256} />
      <div>
        <h3>{game.name}</h3>
        {blurb && <p>{blurb}</p>}
        <div className="sp-actions">
          <button type="button" className="sp-btn sp-btn-primary" onClick={onPlay}>{COPY.play}</button>
          <button type="button" className="sp-btn sp-btn-ghost" onClick={onSuggest}>{COPY.suggest}</button>
        </div>
      </div>
    </div>
  );
}

function ChatPanel({
  mode,
  peopleCount,
  youSeat,
  peerSeat,
  byId,
  thread,
  draft,
  setDraft,
  onSend,
  onInvite,
  onClose,
  onKeep,
  onOpen,
  onSampleKeep,
  focusSeatId,
}: {
  mode: ReviewMode;
  peopleCount: number;
  youSeat?: SeatSnapshot;
  peerSeat?: SeatSnapshot;
  byId: Map<string, HubGame>;
  thread: ThreadItem[];
  draft: string;
  setDraft: (v: string) => void;
  onSend: () => void;
  onInvite: () => void;
  onClose: () => void;
  onKeep: (suggestion: Suggestion) => void;
  onOpen: (suggestion: Suggestion) => void;
  onSampleKeep: (suggestion: Suggestion) => void;
  focusSeatId: string;
}) {
  const youGame = youSeat ? byId.get(youSeat.gameId) : undefined;
  const peerGame = peerSeat ? byId.get(peerSeat.gameId) : undefined;
  const empty = (mode === 'empty' || peopleCount <= 1) && thread.length === 0;

  return (
    <aside className="sp-chat" aria-label={COPY.chat}>
      <div className="sp-chat-head">
        <h2>{COPY.chat}</h2>
        <button type="button" className="sp-icon-btn" aria-label="Close chat" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <p className="sp-sim">{COPY.chatSimulated}</p>
      <div className="sp-people">
        <div className="sp-person">
          <div className="sp-avatar">Y</div>
          <div>
            <strong>{youSeat?.label || 'You'}</strong>
            <span>{youGame ? youGame.name : ''}</span>
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
              <span>{peerGame?.name}</span>
            </div>
          </div>
        )}
      </div>
      {empty && (
        <div className="sp-empty">
          <h3>{COPY.emptyTitle}</h3>
          <p>{COPY.emptyBody}</p>
          <button type="button" className="sp-btn sp-btn-primary" onClick={onInvite}>Invite</button>
          <p className="sp-sim" style={{ padding: '10px 0 0' }}>{COPY.inviteHint}</p>
        </div>
      )}
      <div className="sp-thread">
        {thread.map((item) => {
          if (item.kind === 'notice') return <p key={item.id} className="sp-sim">{item.text}</p>;
          if (item.kind === 'chat') {
            return (
              <div key={item.id} className={`sp-bubble${item.fromSeat === youSeat?.id ? ' is-you' : ''}`}>
                <small>{item.sample ? item.fromLabel : item.fromLabel}</small>
                {item.text}
              </div>
            );
          }
          const mine = item.statusBySeat[focusSeatId];
          const sampleStatus = item.statusBySeat.sample;
          const blurb = playerFacingDescription(item.suggestion.game.description, item.suggestion.game.name);
          return (
            <div key={item.suggestion.id} className="sp-suggest">
              <small>{item.suggestion.fromLabel} suggested</small>
              <div className="sp-suggest-game">
                <GameThumb url={item.suggestion.game.iconUrl} name={item.suggestion.game.name} />
                <div>
                  <strong>{item.suggestion.game.name}</strong>
                  {blurb && <span>{blurb}</span>}
                </div>
              </div>
              {mine !== 'kept' && mine !== 'opened' && (
                <div className="sp-actions">
                  <button type="button" className="sp-btn sp-btn-primary" onClick={() => onOpen(item.suggestion)}>
                    {COPY.openGame}
                  </button>
                  <button type="button" className="sp-btn sp-btn-ghost" onClick={() => onKeep(item.suggestion)}>
                    {COPY.keepPlaying}
                  </button>
                </div>
              )}
              {mine === 'kept' && <p className="sp-sim">You kept playing.</p>}
              {mine === 'opened' && <p className="sp-sim">Opened on this device.</p>}
              {sampleStatus === 'kept' && <p className="sp-sim">Sample companion kept playing.</p>}
              {mode === 'sample' && sampleStatus !== 'kept' && sampleStatus !== 'opened' && (
                <button type="button" className="sp-btn sp-btn-ghost" onClick={() => onSampleKeep(item.suggestion)}>
                  Sample keeps playing
                </button>
              )}
            </div>
          );
        })}
      </div>
      <form className="sp-compose" onSubmit={(e) => { e.preventDefault(); onSend(); }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={COPY.chatPlaceholder}
          aria-label={COPY.chat}
        />
        <button type="submit" className="sp-btn sp-btn-ghost">Send</button>
      </form>
    </aside>
  );
}
