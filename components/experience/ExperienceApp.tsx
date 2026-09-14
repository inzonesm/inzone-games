'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetchApprovedGames } from '@/lib/games';
import type { HubGame } from '@/lib/types';
import {
  IX_COPY,
  composeExperienceHome,
  experienceHref,
  gamesById,
  readRecentIds,
  rememberRecentId,
  type ExperienceOverlay,
  type ExperienceScene,
} from '@/lib/experience-reset';
import { isPlaySessionId, PLAY_SESSION_COPY } from '@/lib/play-session-core';
import {
  createPlaySession,
  ensurePlaySessionUser,
  joinPlaySession,
  leavePlaySession,
  playSessionActor,
  postPlayMessage,
  subscribePlayFeed,
  subscribePlayPreview,
  type PlayMemberDoc,
  type PlaySessionActor,
} from '@/lib/play-session';
import { ExperienceReviewBar } from './ExperienceReviewBar';
import { ExperienceHome } from './ExperienceHome';
import { ExperiencePlay } from './ExperiencePlay';
import { ExperienceDiscover } from './ExperienceDiscover';
import { ExperienceSession, type ThreadItem } from './ExperienceSession';

export function ExperienceApp() {
  const router = useRouter();
  const search = useSearchParams();
  const gameParam = search.get('game')?.trim() || '';
  const sessionParam = search.get('session')?.trim() || '';
  const sceneParam = (search.get('scene') || '') as ExperienceScene | '';

  const [games, setGames] = useState<HubGame[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);

  const [overlay, setOverlay] = useState<ExperienceOverlay>('none');
  const [wide, setWide] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [discoverQuery, setDiscoverQuery] = useState('');
  const [discoverDetail, setDiscoverDetail] = useState<string | null>(null);

  const [liveId, setLiveId] = useState('');
  const [joined, setJoined] = useState(false);
  const [members, setMembers] = useState<PlayMemberDoc[]>([]);
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [fixturePreview, setFixturePreview] = useState(false);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const actorRef = useRef<PlaySessionActor | null>(null);

  const byId = useMemo(() => gamesById(games), [games]);
  const home = useMemo(() => composeExperienceHome(games), [games]);
  const current = byId.get(gameParam) || null;
  const recents = recentIds.map((id) => byId.get(id)).filter((g): g is HubGame => !!g);

  const scene: ExperienceScene = sceneParam || (gameParam ? 'play' : 'home');
  const failScene = scene === 'load-fail';
  const expiredScene = scene === 'expired';
  const invitePreviewScene = scene === 'invite-preview' || (Boolean(sessionParam) && !joined && !fixturePreview);

  useEffect(() => {
    setRecentIds(readRecentIds());
    let cancelled = false;
    fetchApprovedGames()
      .then((items) => {
        if (!cancelled) setGames(items);
      })
      .catch((err) => {
        if (!cancelled) setCatalogError(err instanceof Error ? err.message : 'Failed to load games.');
      })
      .finally(() => {
        if (!cancelled) setLoadingCatalog(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const go = useCallback((opts: { gameId?: string; sessionId?: string; scene?: ExperienceScene | '' }) => {
    router.replace(experienceHref(opts), { scroll: false });
  }, [router]);

  const playGame = useCallback((id: string, confirmed = false) => {
    if (!id) return;
    if (current && id !== current.id && hasInteracted && !confirmed) {
      setPendingId(id);
      return;
    }
    setPendingId(null);
    setFrameLoaded(false);
    setHasInteracted(false);
    setLoadError(null);
    setRecentIds(rememberRecentId(id));
    go({ gameId: id, sessionId: liveId || undefined });
  }, [current, hasInteracted, liveId, go]);

  useEffect(() => {
    if (!gameParam) return;
    setFrameLoaded(false);
  }, [gameParam, reloadKey]);

  useEffect(() => {
    if (sessionParam && isPlaySessionId(sessionParam)) {
      setLiveId(sessionParam);
      setFixturePreview(false);
      setOverlay('session');
    }
  }, [sessionParam]);

  useEffect(() => {
    if (scene === 'invite-preview') {
      setFixturePreview(true);
      setJoined(false);
      setOverlay('session');
      if (!gameParam && home.feature) go({ gameId: home.feature.id, scene: 'invite-preview' });
    }
    if (scene === 'expired') {
      setOverlay('session');
      if (!gameParam && home.feature) go({ gameId: home.feature.id, scene: 'expired' });
    }
    if (scene === 'load-fail' && !gameParam && home.feature) {
      go({ gameId: home.feature.id, scene: 'load-fail' });
    }
    if (scene === 'play' && !gameParam && home.feature) {
      playGame(home.feature.id, true);
    }
    if (scene === 'return') {
      setOverlay('none');
    }
  }, [scene, gameParam, home.feature, go, playGame]);

  useEffect(() => {
    if (!liveId || !isPlaySessionId(liveId) || fixturePreview) return;
    let stop = false;
    let unsub = () => {};
    void (async () => {
      try {
        const user = await ensurePlaySessionUser();
        if (stop) return;
        const actor = await playSessionActor(user);
        actorRef.current = actor;
        unsub = subscribePlayPreview(liveId, {
          onSession: (session) => {
            setJoined(session.memberIds.includes(actor.uid));
          },
          onMembers: setMembers,
          onError: (err) => {
            if (err === 'expired' || err === 'ended') setJoined(false);
          },
        });
      } catch (err) {
        console.warn('[experience] preview', err);
      }
    })();
    return () => {
      stop = true;
      unsub();
    };
  }, [liveId, fixturePreview]);

  useEffect(() => {
    if (!liveId || !joined || fixturePreview) return;
    return subscribePlayFeed(liveId, {
      onMessages: (msgs) => {
        setThread((prev) => {
          const fixtures = prev.filter((item) => item.kind === 'suggest' && item.fixture);
          const live: ThreadItem[] = msgs.map((m) => {
            if (m.type === 'suggest' && m.game) {
              const game = byId.get(m.game.id);
              return {
                kind: 'suggest' as const,
                id: m.id,
                from: m.senderName,
                game: game || {
                  id: m.game.id,
                  name: m.game.name,
                  iconUrl: m.game.iconUrl,
                  description: '',
                  gameUrl: '',
                  serverUrl: '',
                  source: 'community' as const,
                  uploaderId: '',
                  preview: null,
                  createdAt: 0,
                  updatedAt: null,
                },
                status: 'pending' as const,
              };
            }
            return {
              kind: 'chat' as const,
              id: m.id,
              from: m.senderName,
              text: m.text,
              you: actorRef.current?.uid === m.senderId,
            };
          });
          return [...live, ...fixtures];
        });
      },
      onError: () => {},
    });
  }, [liveId, joined, fixturePreview, byId]);

  function flash(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(null), 3200);
  }

  async function copyInvite() {
    setInviteBusy(true);
    try {
      const user = await ensurePlaySessionUser();
      const actor = await playSessionActor(user);
      actorRef.current = actor;
      let sid = liveId;
      if (!sid || !isPlaySessionId(sid) || fixturePreview || expiredScene) {
        const created = await createPlaySession(actor, current?.id || '');
        sid = created.id;
        setLiveId(sid);
        setJoined(true);
        setFixturePreview(false);
      }
      const proto = `${window.location.origin}/experience?game=${encodeURIComponent(current?.id || '')}&session=${sid}`;
      await navigator.clipboard.writeText(proto);
      go({ gameId: current?.id, sessionId: sid });
      flash(IX_COPY.copied);
    } catch {
      flash(IX_COPY.copyFailed);
    } finally {
      setInviteBusy(false);
    }
  }

  async function joinLive() {
    if (fixturePreview) {
      setJoined(true);
      setFixturePreview(true);
      flash(`${IX_COPY.fixture}: joined locally. Production Join writes to a live session.`);
      return;
    }
    if (!liveId) return;
    setInviteBusy(true);
    try {
      const user = await ensurePlaySessionUser();
      const actor = await playSessionActor(user);
      actorRef.current = actor;
      const err = await joinPlaySession(liveId, actor);
      if (err) {
        flash(PLAY_SESSION_COPY.joinFailed);
        return;
      }
      setJoined(true);
    } finally {
      setInviteBusy(false);
    }
  }

  async function leaveLive() {
    if (fixturePreview) {
      setJoined(false);
      setLiveId('');
      setThread([]);
      setDraft('');
      setMembers([]);
      return;
    }
    if (!liveId || !actorRef.current) return;
    try {
      await leavePlaySession(liveId, actorRef.current);
    } catch {
      /* still clear local */
    }
    setLiveId('');
    setJoined(false);
    setMembers([]);
    setThread([]);
    go({ gameId: current?.id });
  }

  async function sendChat() {
    const text = draft.trim();
    if (!text || !liveId || !joined) return;
    if (fixturePreview) {
      setThread((t) => [...t, { kind: 'chat', id: `fix-${Date.now()}`, from: 'You', text, you: true }]);
      setDraft('');
      return;
    }
    if (!actorRef.current) return;
    setSending(true);
    const result = await postPlayMessage(liveId, actorRef.current, { type: 'chat', text });
    setSending(false);
    if ('ok' in result) setDraft('');
    else flash(PLAY_SESSION_COPY.sendFailed);
  }

  async function suggestGame(game: HubGame) {
    if (!joined) return;
    if (fixturePreview || !liveId || !actorRef.current) {
      setThread((t) => [...t, {
        kind: 'suggest',
        id: `fix-s-${Date.now()}`,
        from: 'You',
        game,
        status: 'pending',
      }]);
      setOverlay('session');
      return;
    }
    await postPlayMessage(liveId, actorRef.current, {
      type: 'suggest',
      text: game.name,
      game: { id: game.id, name: game.name, iconUrl: game.iconUrl },
    });
    setOverlay('session');
  }

  function injectSuggestion() {
    const candidate = home.alternatives[0] || home.picks[0] || current;
    if (!candidate) return;
    setThread((t) => [...t, {
      kind: 'suggest',
      id: `fix-${Date.now()}`,
      from: 'Review fixture',
      game: candidate,
      fixture: true,
      status: 'pending',
    }]);
    setOverlay('session');
    if (!joined) {
      setFixturePreview(true);
      setJoined(true);
    }
  }

  const sessionMode = expiredScene
    ? 'expired'
    : (invitePreviewScene && !joined) || (fixturePreview && !joined)
      ? 'preview'
      : joined
        ? 'joined'
        : 'invite';

  const showPlay = Boolean(gameParam) || failScene || expiredScene || invitePreviewScene || scene === 'play';
  const showDock = wide && overlay === 'session' && sessionMode === 'joined';

  return (
    <div className="ix-root">
      <ExperienceReviewBar
        scene={scene === 'play' && gameParam ? 'play' : scene}
        feature={home.feature}
        onScene={(next, gameId) => {
          if (next === 'home' || next === 'return') {
            setOverlay('none');
            go({ scene: next === 'return' ? 'return' : '' });
            return;
          }
          go({ gameId: gameId || current?.id, scene: next === 'play' ? '' : next });
        }}
        onInjectSuggestion={injectSuggestion}
        canInject={Boolean(current || home.feature)}
      />

      {loadingCatalog && games.length === 0 ? (
        <main className="ix-home"><p className="ix-status">Loading catalogue…</p></main>
      ) : catalogError && games.length === 0 ? (
        <main className="ix-home"><p className="ix-status">{catalogError}</p></main>
      ) : showPlay && (current || failScene) ? (
        <ExperiencePlay
          game={current}
          reloadKey={reloadKey}
          loading={false}
          loadError={loadError}
          frameLoaded={frameLoaded}
          failScene={failScene}
          onFrameLoaded={() => { setFrameLoaded(true); setHasInteracted(true); }}
          onRetry={() => {
            setLoadError(null);
            go({ gameId: current?.id || home.feature?.id });
            setReloadKey((k) => k + 1);
            setFrameLoaded(false);
          }}
          onAnother={() => {
            const next = home.alternatives[0] || home.picks[0];
            if (next) playGame(next.id, true);
            else go({});
          }}
          onDiscover={() => setOverlay((o) => (o === 'discover' ? 'none' : 'discover'))}
          onSession={() => setOverlay((o) => (o === 'session' ? 'none' : 'session'))}
          onHome={() => { setOverlay('none'); go({}); }}
          overlay={overlay}
          sessionLabel={joined ? IX_COPY.session : IX_COPY.invite}
        >
          {showDock && (
            <ExperienceSession
              mode={sessionMode}
              game={current}
              docked
              members={members}
              thread={thread}
              draft={draft}
              sending={sending}
              toast={toast}
              inviteBusy={inviteBusy}
              fixture={fixturePreview || expiredScene || scene === 'invite-preview'}
              onClose={() => setOverlay('none')}
              onCopy={() => void copyInvite()}
              onJoin={() => void joinLive()}
              onLeave={() => void leaveLive()}
              onPlayAlone={() => { setOverlay('none'); go({ gameId: current?.id }); }}
              onDraft={setDraft}
              onSend={() => void sendChat()}
              onOpenSuggest={(id) => {
                const item = thread.find((t) => t.id === id);
                if (item?.kind === 'suggest') {
                  setThread((t) => t.map((row) => (row.id === id && row.kind === 'suggest' ? { ...row, status: 'opened' } : row)));
                  playGame(item.game.id);
                }
              }}
              onKeepSuggest={(id) => {
                setThread((t) => t.map((row) => (row.id === id && row.kind === 'suggest' ? { ...row, status: 'kept' } : row)));
              }}
            />
          )}
        </ExperiencePlay>
      ) : (
        <ExperienceHome
          feature={home.feature}
          alternatives={home.alternatives}
          picks={home.picks}
          recents={scene === 'return' ? recents : []}
          onPlay={(id) => playGame(id, true)}
        />
      )}

      {overlay === 'discover' && showPlay && (
        <ExperienceDiscover
          games={games}
          current={current}
          query={discoverQuery}
          detailId={discoverDetail}
          canSuggest={joined}
          onQuery={setDiscoverQuery}
          onDetail={setDiscoverDetail}
          onClose={() => setOverlay('none')}
          onPlay={(id) => playGame(id)}
          onSuggest={(g) => void suggestGame(g)}
        />
      )}

      {overlay === 'session' && showPlay && !showDock && (
        <ExperienceSession
          mode={sessionMode}
          game={current}
          docked={false}
          members={members}
          thread={thread}
          draft={draft}
          sending={sending}
          toast={toast}
          inviteBusy={inviteBusy}
          fixture={fixturePreview || expiredScene || scene === 'invite-preview'}
          onClose={() => setOverlay('none')}
          onCopy={() => void copyInvite()}
          onJoin={() => void joinLive()}
          onLeave={() => void leaveLive()}
          onPlayAlone={() => { setOverlay('none'); go({ gameId: current?.id }); }}
          onDraft={setDraft}
          onSend={() => void sendChat()}
          onOpenSuggest={(id) => {
            const item = thread.find((t) => t.id === id);
            if (item?.kind === 'suggest') {
              setThread((t) => t.map((row) => (row.id === id && row.kind === 'suggest' ? { ...row, status: 'opened' } : row)));
              playGame(item.game.id);
            }
          }}
          onKeepSuggest={(id) => {
            setThread((t) => t.map((row) => (row.id === id && row.kind === 'suggest' ? { ...row, status: 'kept' } : row)));
          }}
        />
      )}

      {pendingId && (
        <div className="ix-dialog">
          <div className="ix-dialog-card">
            <h3>{IX_COPY.switchTitle}</h3>
            <p>{IX_COPY.switchBody}</p>
            <div className="ix-dialog-actions">
              <button type="button" className="ix-btn ix-btn-ghost" onClick={() => setPendingId(null)}>
                {IX_COPY.keepPlaying}
              </button>
              <button
                type="button"
                className="ix-btn ix-btn-primary"
                onClick={() => pendingId && playGame(pendingId, true)}
              >
                {IX_COPY.switchGame}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
