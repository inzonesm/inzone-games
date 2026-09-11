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
  coverFallbackHue,
  coverInitial,
  createSeat,
  displayGameName,
  filterCatalog,
  gameFitFor,
  needsProgressConfirm,
  pickFeaturedIds,
  playerFacingDescription,
  toGameRef,
  withServerUrl,
  type CatalogChip,
  type ProtoWireEvent,
  type ReviewMode,
  type SeatSnapshot,
  type Suggestion,
  type SuggestionSeatStatus,
  type Surface,
  type GameFit,
} from '@/lib/session-prototype';
import {
  createPlaySession,
  ensurePlaySessionUser,
  joinPlaySession,
  leavePlaySession,
  liveInviteUrl,
  loadPlaySeat,
  playSessionActor,
  postPlayMessage,
  savePlaySeat,
  subscribePlayFeed,
  subscribePlayPreview,
  type PlayMemberDoc,
  type PlaySessionActor,
  type SessionLoadError,
} from '@/lib/play-session';
import { isPlaySessionId, PLAY_SESSION_COPY } from '@/lib/play-session-core';

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

function GameThumb({
  url,
  name,
  seed,
  size = 256,
}: {
  url: string;
  name: string;
  seed?: string;
  size?: number;
}) {
  const [stage, setStage] = useState<0 | 1 | 2>(() => (failedIcons.has(url) ? 2 : 0));
  if (!url || stage === 2) {
    const hue = coverFallbackHue(seed || name || 'game');
    return (
      <div
        className="sp-thumb-fallback"
        style={{ '--sp-fallback-hue': String(hue) } as React.CSSProperties}
        aria-hidden="true"
      >
        <span>{coverInitial(name)}</span>
      </div>
    );
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
  const { user, loading: authLoading } = useAuth();
  const youLabel = user?.displayName?.split(/\s+/)[0] || 'You';
  const seatParam = searchParams.get('seat')?.trim() || 'you';
  const requestedGame = searchParams.get('game');
  const roomFromUrl = searchParams.get('room')?.trim() || '';
  const reviewFromUrl = searchParams.get('review') === '1';
  const sessionParam = searchParams.get('session')?.trim() || '';

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
  const [liveId, setLiveId] = useState(sessionParam);
  const [liveError, setLiveError] = useState<SessionLoadError | null>(
    sessionParam && !isPlaySessionId(sessionParam) ? 'invalid' : null,
  );
  const [liveMembers, setLiveMembers] = useState<PlayMemberDoc[]>([]);
  const [liveJoined, setLiveJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [actorId, setActorId] = useState('');
  const actorRef = useRef<PlaySessionActor | null>(null);
  const restoredSeatFor = useRef('');
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [seats, setSeats] = useState<Record<string, SeatSnapshot>>({});
  const [focusSeat, setFocusSeat] = useState(seatParam);
  const [frameReady, setFrameReady] = useState<Record<string, string>>({});
  const [narrow, setNarrow] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (liveId && isPlaySessionId(liveId)) setChatOpen(true);
  }, [liveId]);

  useEffect(() => {
    if (sessionParam && isPlaySessionId(sessionParam)) setLiveId(sessionParam);
  }, [sessionParam]);

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

  useEffect(() => {
    if (!user) {
      actorRef.current = null;
      if (!liveId) setActorId('');
      return;
    }
    playSessionActor(user)
      .then((actor) => {
        actorRef.current = actor;
        setActorId(actor.uid);
      })
      .catch((err) => {
        console.warn('[play-session] profile', err instanceof Error ? err.message : err);
      });
  }, [user, liveId]);

  useEffect(() => {
    setThread([]);
    restoredSeatFor.current = '';
    if (!liveId) {
      setLiveJoined(false);
      setLiveMembers([]);
    }
  }, [liveId]);

  useEffect(() => {
    if (!liveId || !isPlaySessionId(liveId) || authLoading) return;
    let stop = false;
    let unsub = () => {};
    void (async () => {
      try {
        const authed = await ensurePlaySessionUser();
        if (stop) return;
        const actor = await playSessionActor(authed);
        if (stop) return;
        actorRef.current = actor;
        setActorId(actor.uid);
        unsub = subscribePlayPreview(liveId, {
          onSession: (session) => {
            setLiveError(null);
            const member = session.memberIds.includes(actor.uid);
            setLiveJoined(member);
            if (!member) setThread([]);
          },
          onMembers: setLiveMembers,
          onError: (e) => {
            if (e === 'denied') console.warn('[play-session] preview denied');
            setLiveError(e);
            setLiveJoined(false);
          },
        });
      } catch (err) {
        console.warn('[play-session] preview', err instanceof Error ? err.message : err);
        if (!stop) setLiveError('denied');
      }
    })();
    return () => {
      stop = true;
      unsub();
    };
  }, [liveId, user, authLoading]);

  useEffect(() => {
    if (!liveId || !isPlaySessionId(liveId) || !liveJoined) return;
    return subscribePlayFeed(liveId, {
      onMessages: (msgs) => {
        setThread(
          msgs.map((m) => {
            if (m.type === 'suggest' && m.game) {
              return {
                kind: 'suggestion' as const,
                suggestion: {
                  id: m.id,
                  fromSeat: m.senderId,
                  fromLabel: m.senderName,
                  game: { id: m.game.id, name: m.game.name, description: '', iconUrl: m.game.iconUrl },
                  createdAt: m.createdAt,
                },
                statusBySeat: {},
              };
            }
            return {
              kind: 'chat' as const,
              id: m.id,
              fromSeat: m.senderId,
              fromLabel: m.senderName,
              text: m.text,
            };
          }),
        );
      },
      onError: (e) => {
        if (e === 'denied') console.warn('[play-session] feed denied');
        setLiveError(e);
      },
    });
  }, [liveId, liveJoined]);

  useEffect(() => {
    if (!liveJoined || !liveId || !actorId || !games.length) return;
    if (restoredSeatFor.current === liveId) return;
    let cancelled = false;
    void (async () => {
      const gameId = await loadPlaySeat(liveId, actorId);
      if (cancelled) return;
      restoredSeatFor.current = liveId;
      if (!gameId || !games.some((g) => g.id === gameId)) return;
      setSeats((prev) => {
        if (!prev.you) return { ...prev, you: createSeat('you', youLabel, gameId) };
        if (prev.you.gameId === gameId) return prev;
        return { ...prev, you: applySeatAction(prev.you, { type: 'play-game', gameId }) };
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [liveJoined, liveId, actorId, games, youLabel]);

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

  const persistYouSeat = useCallback((seatId: string, gameId: string) => {
    if (!liveId || !actorId || !liveJoined) return;
    if (seatId !== 'you') return;
    void savePlaySeat(liveId, actorId, gameId);
  }, [liveId, actorId, liveJoined]);

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
    persistYouSeat(seatId, gameId);
    setSurface('play');
    setDetailId(null);
  }, [seats, patchSeat, persistYouSeat]);

  const confirmPending = useCallback(() => {
    if (!pending) return;
    patchSeat(
      pending.seatId,
      pending.reason === 'open-suggested'
        ? { type: 'open-suggested', gameId: pending.gameId }
        : { type: 'play-game', gameId: pending.gameId },
    );
    persistYouSeat(pending.seatId, pending.gameId);
    setSurface('play');
    setDetailId(null);
    setPending(null);
  }, [pending, patchSeat, persistYouSeat]);

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
    if (liveId) {
      const actor = actorRef.current;
      if (!actor) {
        flash(PLAY_SESSION_COPY.suggestFailed);
        return;
      }
      void postPlayMessage(liveId, actor, {
        type: 'suggest',
        text: game.name,
        game: { id: game.id, name: game.name, iconUrl: coverUrl(game) },
      }).then((res) => {
        if (res && 'error' in res) {
          flash(res.error === 'rate' ? PLAY_SESSION_COPY.rateLimited : PLAY_SESSION_COPY.suggestFailed);
          return;
        }
        flash(PLAY_SESSION_COPY.suggested);
        setChatOpen(true);
      }).catch((err) => {
        console.warn('[play-session] suggest', err instanceof Error ? err.message : err);
        flash(PLAY_SESSION_COPY.suggestFailed);
      });
      return;
    }
    patchSeat(from.id, { type: 'receive-suggestion', suggestion });
    setThread((t) => [...t, { kind: 'suggestion', suggestion, statusBySeat: {} }]);
    setChatOpen(true);
    channelRef.current?.postMessage({ v: 1, type: 'suggest', suggestion } satisfies ProtoWireEvent);
    flash(PLAY_SESSION_COPY.suggested);
  }, [flash, patchSeat, liveId]);

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
    if (!text || !youSeat || sending) return;
    if (liveId) {
      if (!liveJoined) return;
      const actor = actorRef.current;
      if (!actor) return;
      setSending(true);
      void postPlayMessage(liveId, actor, { type: 'chat', text })
        .then((res) => {
          setSending(false);
          if (res && 'error' in res) {
            setSendFailed(true);
            flash(res.error === 'rate' ? PLAY_SESSION_COPY.rateLimited : PLAY_SESSION_COPY.sendFailed);
            return;
          }
          setSendFailed(false);
          setDraft('');
        })
        .catch((err) => {
          setSending(false);
          setSendFailed(true);
          console.warn('[play-session] sendChat', err instanceof Error ? err.message : err);
          flash(PLAY_SESSION_COPY.sendFailed);
        });
      return;
    }
    const id = `chat-${Date.now()}`;
    setThread((t) => [...t, { kind: 'chat', id, fromSeat: youSeat.id, fromLabel: youSeat.label, text }]);
    setDraft('');
    setSendFailed(false);
    channelRef.current?.postMessage({
      v: 1,
      type: 'chat',
      id,
      fromSeat: youSeat.id,
      fromLabel: youSeat.label,
      text,
      createdAt: Date.now(),
    } satisfies ProtoWireEvent);
  }, [draft, youSeat, liveId, liveJoined, flash, sending]);

  async function copyInvite() {
    const gameId = youSeat?.gameId || requestedGame || '';
    let sid = liveId;
    try {
      const authed = await ensurePlaySessionUser();
      const actor = await playSessionActor(authed);
      actorRef.current = actor;
      setActorId(actor.uid);
      if (!sid || !isPlaySessionId(sid)) {
        const created = await createPlaySession(actor, gameId);
        sid = created.id;
        setLiveId(sid);
        setLiveJoined(true);
        const next = liveInviteUrl(window.location.origin, { gameId, sessionId: sid });
        window.history.replaceState(null, '', `${window.location.pathname}${new URL(next).search}`);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'unknown error';
      console.warn('createPlaySession failed', detail);
      flash(PLAY_SESSION_COPY.createFailed);
      setChatOpen(true);
      setReviewOpen(false);
      return;
    }
    const link = liveInviteUrl(window.location.origin, { gameId, sessionId: sid });
    try {
      await navigator.clipboard.writeText(link);
      flash(PLAY_SESSION_COPY.copied);
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'unknown error';
      console.warn('clipboard write failed', detail);
      flash(PLAY_SESSION_COPY.copyFailed);
    }
    setChatOpen(true);
    setReviewOpen(false);
  }

  async function toggleFullscreen() {
    const node = stageRef.current;
    if (!node) return;
    const orient = screen.orientation as ScreenOrientation & {
      lock?: (mode: string) => Promise<void>;
      unlock?: () => void;
    };
    try {
      if (document.fullscreenElement) {
        try { orient.unlock?.(); } catch { /* unlock is best-effort */ }
        await document.exitFullscreen();
        return;
      }
      await node.requestFullscreen();
      const playing = youSeat ? byId.get(youSeat.gameId) : undefined;
      const fit = gameFitFor(youSeat?.gameId || '', playing?.name);
      if (fit === 'landscape' && orient.lock) {
        try { await orient.lock('landscape'); } catch { /* rotate hint remains */ }
      }
    } catch {
      /* fullscreen can be blocked */
    }
  }

  const selected = (detailId && byId.get(detailId)) || (selectedId && byId.get(selectedId)) || featured[0] || games[0] || null;
  const pendingGame = pending ? byId.get(pending.gameId) : undefined;
  const liveActive = liveMembers.filter((m) => m.status === 'active');
  const peopleCount = liveId
    ? Math.max(1, liveActive.length)
    : 1 + (mode === 'sample' ? 1 : 0) + (mode === 'split' && peerSeat ? 1 : 0);
  const sheetOpen = surface !== 'play';
  const overlayBlocksGame = sheetOpen || (chatOpen && narrow);
  const seatIds = mode === 'split' ? ['you', 'peer'] : [seats[seatParam] ? seatParam : 'you'];
  const currentGame = youSeat ? byId.get(youSeat.gameId) : undefined;
  const currentFit: GameFit = gameFitFor(currentGame?.id || '', currentGame?.name);
  const missingFit = Boolean(currentGame && currentFit === 'unknown');

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
      mode={liveId ? 'empty' : mode}
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
      live={Boolean(liveId)}
      liveError={liveError}
      liveMembers={liveMembers}
      joined={liveJoined}
      joining={joining}
      actorId={actorId}
      sending={sending}
      sendFailed={sendFailed}
      onJoin={() => {
        if (!liveId || joining) return;
        setJoining(true);
        void (async () => {
          try {
            const authed = await ensurePlaySessionUser();
            const actor = await playSessionActor(authed);
            actorRef.current = actor;
            setActorId(actor.uid);
            const err = await joinPlaySession(liveId, actor);
            if (err) {
              setLiveError(err);
              return;
            }
            setLiveJoined(true);
            setLiveError(null);
          } catch (err) {
            console.warn('[play-session] join', err instanceof Error ? err.message : err);
            setLiveError('denied');
          } finally {
            setJoining(false);
          }
        })();
      }}
      onLeave={() => {
        if (!liveId || !actorRef.current) return;
        void leavePlaySession(liveId, actorRef.current).then(() => {
          setLiveId('');
          setLiveJoined(false);
          setLiveMembers([]);
          setThread([]);
          setSendFailed(false);
          window.history.replaceState(null, '', window.location.pathname);
          flash(PLAY_SESSION_COPY.left);
        }).catch((err) => {
          console.warn('[play-session] leave', err instanceof Error ? err.message : err);
          flash(PLAY_SESSION_COPY.leaveFailed);
        });
      }}
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
    <div className={`sp-root${overlayBlocksGame ? ' is-overlay' : ''}`} data-fit={currentFit} ref={rootRef}>
      <header className="sp-top">
        <Link href="/session-prototype" className="sp-brand">
          <Logo size={22} />
          INZONE
        </Link>
        <nav className="sp-tabs" aria-label="Play">
          <button type="button" className={`sp-tab${surface === 'discover' ? ' is-on' : ''}`} onClick={() => openDiscover()}>
            {COPY.discover}
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
                  fit={gameFitFor(seats[id]?.gameId || '', seats[id] ? byId.get(seats[id].gameId)?.name : '')}
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
              fit={currentFit}
              blocked={overlayBlocksGame}
              onReady={() => {
                if (!youSeat) return;
                patchSeat(youSeat.id, { type: 'mark-interacted' });
                setFrameReady((m) => ({ ...m, [youSeat.id]: youSeat.gameId }));
              }}
            />
          )}

          {sheetOpen && (
            <section className="sp-sheet" aria-label={surface === 'yours' ? 'Your games' : COPY.discover}>
              <div className="sp-sheet-head">
                <h2>{surface === 'yours' ? 'Your games' : COPY.discover}</h2>
                <button type="button" className="sp-icon-btn" aria-label="Close" onClick={() => { setSurface('play'); setDetailId(null); }}>
                  <IconClose />
                </button>
              </div>
              <div className="sp-sheet-body">
                {detailId && surface === 'discover' ? (
                  <button type="button" className="sp-back" onClick={() => setDetailId(null)}>
                    ← {COPY.discover}
                  </button>
                ) : currentGame ? (
                  <button type="button" className="sp-back" onClick={() => { setSurface('play'); setDetailId(null); }}>
                    ← Back to {displayGameName(currentGame.name)}
                  </button>
                ) : null}
                {surface === 'discover' && (
                  <>
                    {!detailId && (
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
                      </>
                    )}
                    {detailId && selected && youSeat && (
                      <GameDetail
                        game={selected}
                        onPlay={() => requestPlay(youSeat.id, selected.id, 'play')}
                        onSuggest={() => suggestGame(youSeat, selected)}
                      />
                    )}
                    {!detailId && (
                      <div className="sp-grid">
                        {filtered.map((g) => (
                          <button
                            key={g.id}
                            type="button"
                            className="sp-card"
                            onClick={() => setDetailId(g.id)}
                          >
                            <GameThumb url={coverUrl(g)} name={displayGameName(g.name)} seed={g.id} size={320} />
                            <span>{displayGameName(g.name)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {surface === 'yours' && youSeat && (
                  <div className="sp-grid">
                    {youSeat.playedIds.map((gid) => {
                      const g = byId.get(gid);
                      if (!g) return null;
                      return (
                        <button key={gid} type="button" className="sp-card" onClick={() => requestPlay(youSeat.id, g.id, 'play')}>
                          <GameThumb url={coverUrl(g)} name={displayGameName(g.name)} seed={g.id} size={320} />
                          <span>{displayGameName(g.name)}</span>
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
            {currentGame && <GameThumb url={coverUrl(currentGame)} name={displayGameName(currentGame.name)} seed={currentGame.id} size={72} />}
            <strong>{currentGame ? displayGameName(currentGame.name) : 'Loading…'}</strong>
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
              <IconDiscover /> <span>{COPY.discover}</span>
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
                  <GameThumb url={coverUrl(g)} name={displayGameName(g.name)} seed={g.id} size={320} />
                  <span>{displayGameName(g.name)}</span>
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
          {currentGame && (
            <p>
              {displayGameName(currentGame.name)}: {currentFit}
              {missingFit ? ` — ${COPY.missingFit}` : ''}
            </p>
          )}
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
  blocked = false,
  fit = 'unknown',
  onFocus,
  onReady,
}: {
  stageRef?: Ref<HTMLDivElement>;
  seat?: SeatSnapshot;
  game?: HubGame;
  loadError: string | null;
  ready: boolean;
  blocked?: boolean;
  fit?: GameFit;
  onFocus?: () => void;
  onReady: () => void;
}) {
  const title = game ? displayGameName(game.name) : '';
  return (
    <div className="sp-stage-col" data-fit={fit} onPointerDown={onFocus}>
      <div className="sp-stage" data-fit={fit} ref={stageRef}>
        <div className={`sp-frame-hold${blocked ? ' is-blocked' : ''}`}>
          {loadError && <div className="sp-load">{loadError}</div>}
          {game && seat && (
            <iframe
              key={seat.gameId}
              src={sameOriginGameUrl(withServerUrl(game.gameUrl, game.serverUrl))}
              title={title}
              scrolling="no"
              allow="camera; microphone; geolocation; encrypted-media; autoplay; fullscreen; gamepad; accelerometer; gyroscope"
              allowFullScreen
              onLoad={onReady}
            />
          )}
          {game && !ready && <div className="sp-load">Loading {title}…</div>}
        </div>
      </div>
      {fit === 'landscape' && (
        <p className="sp-rotate-hint">{COPY.rotatePhone}</p>
      )}
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
  const title = displayGameName(game.name);
  const blurb = playerFacingDescription(game.description, game.name);
  return (
    <div className="sp-detail">
      <GameThumb url={coverUrl(game)} name={title} seed={game.id} size={256} />
      <div>
        <h3>{title}</h3>
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
  live,
  liveError,
  liveMembers,
  joined,
  joining,
  onJoin,
  onLeave,
  actorId,
  sending,
  sendFailed,
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
  live?: boolean;
  liveError?: SessionLoadError | null;
  liveMembers?: PlayMemberDoc[];
  joined?: boolean;
  joining?: boolean;
  onJoin?: () => void;
  onLeave?: () => void;
  actorId?: string;
  sending?: boolean;
  sendFailed?: boolean;
}) {
  const youGame = youSeat ? byId.get(youSeat.gameId) : undefined;
  const peerGame = peerSeat ? byId.get(peerSeat.gameId) : undefined;
  const showJoin =
    Boolean(live && !joined && onJoin) && liveError !== 'invalid' && liveError !== 'expired' && liveError !== 'ended';
  const empty = !showJoin && peopleCount <= 1 && thread.length === 0;

  return (
    <aside className="sp-chat" aria-label={COPY.chat}>
      <div className="sp-chat-head">
        <h2>{COPY.chat}</h2>
        <button type="button" className="sp-icon-btn" aria-label="Close chat" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <p className="sp-sim">{live ? COPY.liveChat : COPY.chatSimulated}</p>
      {liveError === 'invalid' && <p className="sp-sim">{COPY.invalidInvite}</p>}
      {liveError === 'expired' && <p className="sp-sim">{COPY.expiredInvite}</p>}
      {liveError === 'ended' && <p className="sp-sim">{COPY.sessionEnded}</p>}
      {liveError === 'denied' && <p className="sp-sim">Couldn’t join this session.</p>}
      <div className="sp-people">
        {live && liveMembers && liveMembers.length > 0 ? liveMembers.map((m) => (
          <div className="sp-person" key={m.actorId}>
            <div className={`sp-avatar${m.status === 'left' ? ' is-sample' : ''}`}>{(m.actorName || '?').slice(0, 1)}</div>
            <div>
              <strong>{m.actorName}</strong>
              <span>{m.status === 'left' ? 'Left' : (m.anonymous ? 'Guest' : 'Playing')}</span>
            </div>
          </div>
        )) : (
          <>
            <div className="sp-person">
              <div className="sp-avatar">Y</div>
              <div>
                <strong>{youSeat?.label || 'You'}</strong>
                <span>{youGame ? displayGameName(youGame.name) : ''}</span>
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
                  <span>{peerGame ? displayGameName(peerGame.name) : ''}</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {showJoin && (
        <div className="sp-empty">
          <h3>{PLAY_SESSION_COPY.joinTitle}</h3>
          <p>{PLAY_SESSION_COPY.joinBody}</p>
          <button type="button" className="sp-btn sp-btn-primary" onClick={onJoin} disabled={joining}>
            {PLAY_SESSION_COPY.join}
          </button>
        </div>
      )}
      {empty && (
        <div className="sp-empty">
          <h3>{COPY.emptyTitle}</h3>
          <p>{COPY.emptyBody}</p>
          <button type="button" className="sp-btn sp-btn-primary" onClick={onInvite}>Invite</button>
          <p className="sp-sim" style={{ padding: '10px 0 0' }}>{live ? 'Share the link with another browser.' : COPY.inviteHint}</p>
        </div>
      )}
      {!showJoin && <div className="sp-thread">
        {thread.map((item) => {
          if (item.kind === 'notice') return <p key={item.id} className="sp-sim">{item.text}</p>;
          if (item.kind === 'chat') {
            return (
              <div key={item.id} className={`sp-bubble${item.fromSeat === youSeat?.id || item.fromSeat === actorId ? ' is-you' : ''}`}>
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
                <GameThumb url={item.suggestion.game.iconUrl} name={displayGameName(item.suggestion.game.name)} seed={item.suggestion.game.id} />
                <div>
                  <strong>{displayGameName(item.suggestion.game.name)}</strong>
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
      </div>}
      {!showJoin && (
      <form className="sp-compose" onSubmit={(e) => { e.preventDefault(); onSend(); }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={COPY.chatPlaceholder}
          aria-label={COPY.chat}
          disabled={sending}
        />
        <button type="submit" className="sp-btn sp-btn-ghost" disabled={sending}>Send</button>
      </form>
      )}
      {live && joined && sendFailed && (
        <p className="sp-sim" style={{ padding: '0 12px 8px' }}>
          {PLAY_SESSION_COPY.sendFailed}{' '}
          <button type="button" className="sp-btn sp-btn-ghost" onClick={onSend} disabled={sending}>
            {PLAY_SESSION_COPY.retry}
          </button>
        </p>
      )}
      {live && joined && onLeave && !liveError && (
        <button type="button" className="sp-btn sp-btn-ghost" style={{ margin: '0 12px 12px' }} onClick={onLeave}>
          {COPY.leave}
        </button>
      )}
    </aside>
  );
}
