'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { fetchApprovedGames } from '@/lib/games';
import type { HubGame } from '@/lib/types';
import {
  COPY,
  coverFallbackHue,
  coverInitial,
  createSeat,
  displayGameName,
  filterCatalog,
  needsProgressConfirm,
  playerFacingDescription,
  toGameRef,
  type Suggestion,
  type SuggestionSeatStatus,
} from '@/lib/session-prototype';
import {
  createPlaySession,
  ensurePlaySessionUser,
  admitPlaySessionChunks,
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
import {
  CAMPAIGN_EVENTS,
  mergeAttributionSearch,
  noteGameOpened,
  trackCampaignEvent,
  trackInviteCopiedAfterWrite,
} from '@/lib/campaign-analytics';

type ThreadItem =
  | { kind: 'notice'; id: string; text: string }
  | { kind: 'chat'; id: string; fromSeat: string; fromLabel: string; text: string }
  | { kind: 'suggestion'; suggestion: Suggestion; statusBySeat: Record<string, SuggestionSeatStatus> };

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
        className="social-panel-thumb-fallback sp-thumb-fallback"
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

function IconClose() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function SocialPanel({
  gameId,
  liveSession,
  inviteComposer = false,
  expanded = true,
  onCloseRequest,
  onExpandRequest,
  onPlayGame,
  hasInteracted = false,
}: {
  gameId: string;
  liveSession?: string | null;
  inviteComposer?: boolean;
  expanded?: boolean;
  onCloseRequest: () => void;
  onExpandRequest?: () => void;
  onPlayGame?: (nextGameId: string) => void;
  hasInteracted?: boolean;
}) {
  const { user, loading: authLoading } = useAuth();
  const youLabel = user?.displayName?.split(/\s+/)[0] || 'You';
  const sessionParam = (liveSession || '').trim();

  const [games, setGames] = useState<HubGame[]>([]);
  const [tab, setTab] = useState<'session' | 'discover'>(inviteComposer ? 'session' : 'session');
  const [query, setQuery] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [draft, setDraft] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [pendingGameId, setPendingGameId] = useState<string | null>(null);
  const [liveId, setLiveId] = useState(sessionParam && isPlaySessionId(sessionParam) ? sessionParam : '');
  const [liveError, setLiveError] = useState<SessionLoadError | null>(
    sessionParam && !isPlaySessionId(sessionParam) ? 'invalid' : null,
  );
  const [liveMembers, setLiveMembers] = useState<PlayMemberDoc[]>([]);
  const [liveJoined, setLiveJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [actorId, setActorId] = useState('');
  const actorRef = useRef<PlaySessionActor | null>(null);
  const restoredSeatFor = useRef('');
  const admittedChunksFor = useRef('');
  const endedSentFor = useRef('');
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [playedIds, setPlayedIds] = useState<string[]>(gameId ? [gameId] : []);
  const copyBtnRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLElement>(null);

  const youSeat = useMemo(
    () => ({
      ...createSeat('you', youLabel, gameId),
      playedIds,
      interacted: hasInteracted,
    }),
    [youLabel, gameId, playedIds, hasInteracted],
  );

  useEffect(() => {
    if (sessionParam && isPlaySessionId(sessionParam)) setLiveId(sessionParam);
  }, [sessionParam]);

  useEffect(() => {
    if (inviteComposer) {
      setTab('session');
      const id = window.setTimeout(() => copyBtnRef.current?.focus(), 40);
      return () => window.clearTimeout(id);
    }
  }, [inviteComposer]);

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

  const byId = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  const filtered = useMemo(
    () => filterCatalog(games, { query, chip: 'all' }),
    [games, query],
  );

  useEffect(() => {
    let cancelled = false;
    fetchApprovedGames()
      .then((items) => {
        if (!cancelled) setGames(items);
      })
      .catch((err) => {
        console.warn('[social-panel] catalog', err instanceof Error ? err.message : err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    admittedChunksFor.current = '';
    if (!liveId) {
      setLiveJoined(false);
      setLiveMembers([]);
    }
  }, [liveId]);

  const markSessionEnded = useCallback((reason: SessionLoadError | 'leave') => {
    if (reason !== 'expired' && reason !== 'ended' && reason !== 'leave') return;
    const key = `${liveId}:${reason}`;
    if (!liveId || endedSentFor.current === key) return;
    endedSentFor.current = key;
    trackCampaignEvent(CAMPAIGN_EVENTS.sessionEnded, { game_id: gameId });
  }, [liveId, gameId]);

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
            const uid = actorRef.current?.uid;
            const member = !!(uid && session.memberIds.includes(uid));
            setLiveJoined(member);
            if (session.status === 'ended') markSessionEnded('ended');
            if (member && admittedChunksFor.current !== liveId) {
              admittedChunksFor.current = liveId;
              void admitPlaySessionChunks(liveId);
            }
            if (!member) {
              admittedChunksFor.current = '';
              setThread([]);
            }
          },
          onMembers: setLiveMembers,
          onError: (e) => {
            if (e === 'denied') console.warn('[play-session] preview denied');
            setLiveError(e);
            setLiveJoined(false);
            if (e === 'expired' || e === 'ended') markSessionEnded(e);
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
  }, [liveId, user, authLoading, markSessionEnded]);

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
        if (e === 'expired' || e === 'ended') markSessionEnded(e);
      },
    });
  }, [liveId, liveJoined, markSessionEnded]);

  useEffect(() => {
    if (!liveJoined || !liveId || !actorId || !games.length) return;
    if (restoredSeatFor.current === liveId) return;
    let cancelled = false;
    void (async () => {
      const seatGameId = await loadPlaySeat(liveId, actorId);
      if (cancelled) return;
      restoredSeatFor.current = liveId;
      if (!seatGameId || !games.some((g) => g.id === seatGameId)) return;
      if (seatGameId !== gameId) onPlayGame?.(seatGameId);
    })();
    return () => {
      cancelled = true;
    };
  }, [liveJoined, liveId, actorId, games, gameId, onPlayGame]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    const t = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(t);
  }, []);

  const persistYouSeat = useCallback((nextGameId: string) => {
    if (!liveId || !actorId || !liveJoined) return;
    void savePlaySeat(liveId, actorId, nextGameId);
  }, [liveId, actorId, liveJoined]);

  const requestPlay = useCallback((nextGameId: string) => {
    if (!nextGameId || nextGameId === gameId) {
      setTab('session');
      setDetailId(null);
      return;
    }
    const seat = youSeat;
    if (needsProgressConfirm(seat, nextGameId)) {
      setPendingGameId(nextGameId);
      return;
    }
    persistYouSeat(nextGameId);
    noteGameOpened({ cause: 'play', fromGameId: gameId, toGameId: nextGameId });
    setPlayedIds((ids) => (ids.includes(nextGameId) ? ids : [...ids, nextGameId]));
    onPlayGame?.(nextGameId);
  }, [gameId, youSeat, persistYouSeat, onPlayGame]);

  const confirmPending = useCallback(() => {
    if (!pendingGameId) return;
    persistYouSeat(pendingGameId);
    noteGameOpened({ cause: 'play', fromGameId: gameId, toGameId: pendingGameId });
    onPlayGame?.(pendingGameId);
    setPendingGameId(null);
  }, [pendingGameId, persistYouSeat, gameId, onPlayGame]);

  const suggestGame = useCallback((game: HubGame) => {
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
        setTab('session');
        trackCampaignEvent(CAMPAIGN_EVENTS.gameSuggested, { game_id: game.id });
        trackCampaignEvent(CAMPAIGN_EVENTS.sessionMessage, { game_id: gameId });
      }).catch((err) => {
        console.warn('[play-session] suggest', err instanceof Error ? err.message : err);
        flash(PLAY_SESSION_COPY.suggestFailed);
      });
      return;
    }
    const suggestion: Suggestion = {
      id: `sug-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fromSeat: 'you',
      fromLabel: youLabel,
      game: toGameRef({
        ...game,
        iconUrl: coverUrl(game),
        description: playerFacingDescription(game.description, game.name) || '',
      }),
      createdAt: Date.now(),
    };
    setThread((t) => [...t, { kind: 'suggestion', suggestion, statusBySeat: {} }]);
    setTab('session');
    flash(PLAY_SESSION_COPY.suggested);
    trackCampaignEvent(CAMPAIGN_EVENTS.gameSuggested, { game_id: game.id });
  }, [flash, liveId, youLabel, gameId]);

  const sendChat = useCallback(() => {
    const text = draft.trim();
    if (!text || sending) return;
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
          trackCampaignEvent(CAMPAIGN_EVENTS.sessionMessage, { game_id: gameId });
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
    setThread((t) => [...t, { kind: 'chat', id, fromSeat: 'you', fromLabel: youLabel, text }]);
    setDraft('');
    setSendFailed(false);
  }, [draft, liveId, liveJoined, flash, sending, youLabel, gameId]);

  async function copyInvite() {
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
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'unknown error';
      console.warn('createPlaySession failed', detail);
      flash(PLAY_SESSION_COPY.createFailed);
      return;
    }
    const link = liveInviteUrl(window.location.origin, { gameId, sessionId: sid });
    const copied = await trackInviteCopiedAfterWrite(
      async (text) => {
        try {
          await navigator.clipboard.writeText(text);
        } catch (err) {
          const detail = err instanceof Error ? err.message : 'unknown error';
          console.warn('clipboard write failed', detail);
          throw err;
        }
      },
      link,
      gameId,
    );
    window.history.replaceState(
      null,
      '',
      mergeAttributionSearch(`${window.location.pathname}?session=${sid}`),
    );
    if (copied) flash(PLAY_SESSION_COPY.copied);
    else {
      console.warn('clipboard write failed');
      flash(PLAY_SESSION_COPY.copyFailed);
    }
    setTab('session');
  }

  const liveActive = liveMembers.filter((m) => m.status === 'active');
  const peopleCount = liveId ? Math.max(1, liveActive.length) : 1;
  const showJoin =
    Boolean(liveId && !liveJoined) && liveError !== 'invalid' && liveError !== 'expired' && liveError !== 'ended';
  const empty = !showJoin && peopleCount <= 1 && thread.length === 0;
  const currentGame = byId.get(gameId);
  const pendingGame = pendingGameId ? byId.get(pendingGameId) : undefined;
  const selected = (detailId && byId.get(detailId)) || null;

  if (!expanded) {
    return (
      <aside
        className="social-panel social-panel-peek sp-chat"
        ref={rootRef}
        aria-label={COPY.chat}
      >
        <button type="button" className="social-panel-peek-hit" onClick={onExpandRequest}>
          <span className="social-panel-peek-handle" />
          <strong>Play with a friend</strong>
          <span>{peopleCount > 1 ? `${peopleCount} playing` : 'Invite a friend'}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="social-panel social-panel-expanded sp-chat" ref={rootRef} aria-label={COPY.chat}>
      <div className="social-panel-head sp-chat-head">
        <h2>{tab === 'discover' ? COPY.discover : COPY.chat}</h2>
        <button type="button" className="sp-icon-btn" aria-label="Close" onClick={onCloseRequest}>
          <IconClose />
        </button>
      </div>
      <div className="social-panel-tabs" role="tablist" aria-label="Session">
        <button type="button" role="tab" aria-selected={tab === 'session'} className={tab === 'session' ? 'is-on' : ''} onClick={() => setTab('session')}>
          {COPY.chat}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'discover'} className={tab === 'discover' ? 'is-on' : ''} onClick={() => { setTab('discover'); setDetailId(null); }}>
          {COPY.discover}
        </button>
      </div>

      {tab === 'session' && (
        <>
          <p className="sp-sim">{liveId ? COPY.liveChat : COPY.emptyBody}</p>
          {liveError === 'invalid' && <p className="sp-sim">{COPY.invalidInvite}</p>}
          {liveError === 'expired' && <p className="sp-sim">{COPY.expiredInvite}</p>}
          {liveError === 'ended' && <p className="sp-sim">{COPY.sessionEnded}</p>}
          {liveError === 'denied' && <p className="sp-sim">Couldn’t join this session.</p>}
          {inviteComposer && liveId && liveJoined && (
            <p className="sp-sim">Copy the invite and send it to a friend.</p>
          )}
          <div className="sp-people">
            {liveId && liveMembers.length > 0 ? liveMembers.map((m) => (
              <div className="sp-person" key={m.actorId}>
                <div className={`sp-avatar${m.status === 'left' ? ' is-sample' : ''}`}>{(m.actorName || '?').slice(0, 1)}</div>
                <div>
                  <strong>{m.actorName}</strong>
                  <span>{m.status === 'left' ? 'Left' : (m.anonymous ? 'Guest' : 'Playing')}</span>
                </div>
              </div>
            )) : (
              <div className="sp-person">
                <div className="sp-avatar">Y</div>
                <div>
                  <strong>{youLabel}</strong>
                  <span>{currentGame ? displayGameName(currentGame.name) : ''}</span>
                </div>
              </div>
            )}
          </div>
          {showJoin && (
            <div className="sp-empty">
              <h3>{PLAY_SESSION_COPY.joinTitle}</h3>
              <p>{PLAY_SESSION_COPY.joinBody}</p>
              <button
                type="button"
                className="sp-btn sp-btn-primary"
                disabled={joining}
                onClick={() => {
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
                      setLiveError(null);
                      trackCampaignEvent(CAMPAIGN_EVENTS.inviteJoined, { game_id: gameId });
                      trackCampaignEvent(CAMPAIGN_EVENTS.inviteAccepted, { game_id: gameId });
                    } catch (err) {
                      console.warn('[play-session] join', err instanceof Error ? err.message : err);
                      setLiveError('denied');
                    } finally {
                      setJoining(false);
                    }
                  })();
                }}
              >
                {PLAY_SESSION_COPY.join}
              </button>
            </div>
          )}
          {empty && (
            <div className="sp-empty">
              <h3>{COPY.emptyTitle}</h3>
              <p>{COPY.emptyBody}</p>
              <button
                ref={copyBtnRef}
                type="button"
                className="sp-btn sp-btn-primary"
                onClick={() => void copyInvite()}
              >
                Copy Link
              </button>
              <button type="button" className="sp-btn sp-btn-ghost" onClick={() => void copyInvite()}>
                Invite
              </button>
              <p className="sp-sim" style={{ padding: '10px 0 0' }}>{COPY.inviteHint}</p>
            </div>
          )}
          {!empty && !showJoin && (
            <div className="social-panel-invite-row">
              <button
                ref={copyBtnRef}
                type="button"
                className="sp-btn sp-btn-primary"
                onClick={() => void copyInvite()}
              >
                Copy Link
              </button>
              <button type="button" className="sp-btn sp-btn-ghost" onClick={() => void copyInvite()}>
                Invite
              </button>
            </div>
          )}
          {!showJoin && (
            <div className="sp-thread">
              {thread.map((item) => {
                if (item.kind === 'notice') return <p key={item.id} className="sp-sim">{item.text}</p>;
                if (item.kind === 'chat') {
                  return (
                    <div key={item.id} className={`sp-bubble${item.fromSeat === 'you' || item.fromSeat === actorId ? ' is-you' : ''}`}>
                      <small>{item.fromLabel}</small>
                      {item.text}
                    </div>
                  );
                }
                const mine = item.statusBySeat.you;
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
                        <button
                          type="button"
                          className="sp-btn sp-btn-primary"
                          onClick={() => {
                            setThread((t) => t.map((row) => (
                              row.kind === 'suggestion' && row.suggestion.id === item.suggestion.id
                                ? { ...row, statusBySeat: { ...row.statusBySeat, you: 'opened' } }
                                : row
                            )));
                            persistYouSeat(item.suggestion.game.id);
                            noteGameOpened({
                              cause: 'open-suggested',
                              fromGameId: gameId,
                              toGameId: item.suggestion.game.id,
                            });
                            onPlayGame?.(item.suggestion.game.id);
                          }}
                        >
                          {COPY.openGame}
                        </button>
                        <button
                          type="button"
                          className="sp-btn sp-btn-ghost"
                          onClick={() => {
                            setThread((t) => t.map((row) => (
                              row.kind === 'suggestion' && row.suggestion.id === item.suggestion.id
                                ? { ...row, statusBySeat: { ...row.statusBySeat, you: 'kept' } }
                                : row
                            )));
                            trackCampaignEvent(CAMPAIGN_EVENTS.keepPlaying, { game_id: gameId });
                          }}
                        >
                          {COPY.keepPlaying}
                        </button>
                      </div>
                    )}
                    {mine === 'kept' && <p className="sp-sim">You kept playing.</p>}
                    {mine === 'opened' && <p className="sp-sim">Opened on this device.</p>}
                  </div>
                );
              })}
            </div>
          )}
          {!showJoin && (
            <form className="sp-compose" onSubmit={(e) => { e.preventDefault(); sendChat(); }}>
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
          {liveId && liveJoined && sendFailed && (
            <p className="sp-sim" style={{ padding: '0 12px 8px' }}>
              {PLAY_SESSION_COPY.sendFailed}{' '}
              <button type="button" className="sp-btn sp-btn-ghost" onClick={sendChat} disabled={sending}>
                {PLAY_SESSION_COPY.retry}
              </button>
            </p>
          )}
          {liveId && liveJoined && !liveError && (
            <button
              type="button"
              className="sp-btn sp-btn-ghost"
              style={{ margin: '0 12px 12px' }}
              onClick={() => {
                if (!actorRef.current) return;
                const last = liveActive.length <= 1;
                void leavePlaySession(liveId, actorRef.current).then(() => {
                  if (last) markSessionEnded('leave');
                  setLiveId('');
                  setLiveJoined(false);
                  setLiveMembers([]);
                  setThread([]);
                  setSendFailed(false);
                  window.history.replaceState(null, '', mergeAttributionSearch(window.location.pathname));
                  flash(PLAY_SESSION_COPY.left);
                }).catch((err) => {
                  console.warn('[play-session] leave', err instanceof Error ? err.message : err);
                  flash(PLAY_SESSION_COPY.leaveFailed);
                });
              }}
            >
              {COPY.leave}
            </button>
          )}
        </>
      )}

      {tab === 'discover' && (
        <div className="social-panel-discover sp-sheet-body">
          {detailId && selected ? (
            <>
              <button type="button" className="sp-back" onClick={() => setDetailId(null)}>
                ← {COPY.discover}
              </button>
              <div className="sp-detail">
                <GameThumb url={coverUrl(selected)} name={displayGameName(selected.name)} seed={selected.id} size={256} />
                <div>
                  <h3>{displayGameName(selected.name)}</h3>
                  {playerFacingDescription(selected.description, selected.name) && (
                    <p>{playerFacingDescription(selected.description, selected.name)}</p>
                  )}
                  <div className="sp-actions">
                    <button type="button" className="sp-btn sp-btn-primary" onClick={() => requestPlay(selected.id)}>{COPY.play}</button>
                    <button type="button" className="sp-btn sp-btn-ghost" onClick={() => suggestGame(selected)}>{COPY.suggest}</button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <input
                className="sp-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={COPY.search}
                aria-label={COPY.search}
              />
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
            </>
          )}
        </div>
      )}

      {toast && <div className="sp-toast" role="status">{toast}</div>}

      {pendingGameId && (
        <div className="sp-dialog" role="dialog" aria-modal="true" aria-labelledby="sp-switch-title">
          <div className="sp-dialog-card">
            <h3 id="sp-switch-title">{COPY.switchTitle}</h3>
            <p>{COPY.switchBody}{pendingGame ? ` Next: ${pendingGame.name}.` : ''}</p>
            <div className="sp-actions">
              <button type="button" className="sp-btn sp-btn-ghost" onClick={() => {
                trackCampaignEvent(CAMPAIGN_EVENTS.keepPlaying, { game_id: gameId });
                setPendingGameId(null);
              }}>{COPY.keepPlaying}</button>
              <button type="button" className="sp-btn sp-btn-primary" onClick={confirmPending}>{COPY.switchGame}</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
