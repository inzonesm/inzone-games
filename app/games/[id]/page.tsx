'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { GameCompanion } from '@/components/GameCompanion';
import { PlayInviteHost } from '@/components/PlayInviteHost';
import { SocialPanel } from '@/components/SocialPanel';
import { fetchApprovedGames, fetchGameById, gameShareLink, gameWebLink } from '@/lib/games';
import {
  addComment,
  fetchCommentCount,
  fetchComments,
  fetchLikeSummary,
  likeComment,
  setLike,
  MAX_COMMENT_LEN,
  type GameComment,
} from '@/lib/engagement';
import {
  getLikedCommentIds,
  resolveIdentity,
  setCommentLiked,
  type Identity,
} from '@/lib/identity';
import { sameOriginGameUrl } from '@/lib/game-hosting';
import { gameControls } from '@/lib/game-controls';
import { fallbackGameName, normalizeGameIdFromRoute } from '@/lib/game-display';
import { GameSdkHost } from '@/components/GameSdkHost';
import { isWebSdkHostEnabled } from '@/lib/game-sdk/opt-in';
import type { HubGame } from '@/lib/types';
import { isPlaySessionId } from '@/lib/play-session-core';
import { createConversationInvite } from '@/lib/play-invite-action';
import { PLAY_INVITE_COPY } from '@/lib/play-invite';
import { previewForceRetryRequested } from '@/lib/preview-force-retry';
import { setHostSheetOpen } from '@/lib/nightclub-companion-focus';
import {
  CAMPAIGN_EVENTS,
  captureCampaignArrival,
  mergeAttributionSearch,
  recordAcquisition,
  trackCampaignEvent,
  trackInviteCopiedAfterWrite,
} from '@/lib/campaign-analytics';
import { useGameplayMeasurement } from '@/lib/use-gameplay-measurement';
import { ENTRY_FIX_WINDOW_MS, entryFixFor } from '@/lib/game-entry';
import {
  FRAME_READY_POLL_MS,
  FRAME_SHELL_SETTLE_MS,
  FRAME_STALL_AFTER_MS,
  bootStatusCopy,
  gameHasReadyProbe,
  inspectSameOriginShell,
  probeFramePlayable,
  resolveRecoveryPhase,
  showCompactRecovery,
  showFullBootOverlay,
  showRecoveryActions,
} from '@/lib/game-frame-recovery';
import { clearHostileIframeSizing } from '@/lib/player-stage';
import { layoutBoxOf, railInsetFrom } from '@/lib/rail-inset';
import {
  barCellCount,
  splitPlayerActions,
  type PlayerActionId,
  type PlayerLayout,
} from '@/lib/player-actions';
import { subscribePlayPreview } from '@/lib/play-session';
import { canFillScreen, FILL_SCREEN_COPY, fillScreenOffered, shouldExitFillScreen } from '@/lib/fill-screen';

/* ── Sizing ──────────────────────────────────────────────────────
   The iframe is exactly the visible game area (see .game-frame-body iframe in
   globals.css), so the game sees the same `window.innerWidth/Height` the
   InZone app's WebView gives it — no manual zoom. Games with oversized or
   fixed-size canvases are fitted *inside* the page by the viewport-fit script
   (the same one the Flutter app injects into its WebView — see
   community_game_screen.dart). It reaches the game two ways: baked into the
   entry HTML at upload, and injected at request time by the same-origin /gcs
   route this page loads bucket-hosted games through (which is what covers
   builds uploaded before the script existed). A deployment-wide zoom-out
   escape hatch remains as --game-fit in CSS. */

export default function GamePlayerPage() {
  return (
    <Suspense
      fallback={
        <div className="game-frame-shell">
          <div className="game-frame-body">
            <div className="empty" style={{ position: 'absolute', inset: 0 }}>
              <p>Loading game…</p>
            </div>
          </div>
        </div>
      }
    >
      <GamePlayerPageInner />
    </Suspense>
  );
}

function GamePlayerPageInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const rawId = params?.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  // Strip trailing markdown/URL-encoded punctuation ("%60", "*") that share
  // links pasted into Slack/WhatsApp/Meta bleed into the slug — see
  // docs/hexclave-findings-2026-09-17.md §D5.
  const gameId = id ? normalizeGameIdFromRoute(id) : '';

  const [game, setGame] = useState<HubGame | null>(null);
  // Boot-screen title source. Trusts `game.name` when Firestore has resolved
  // (matches lib/session-prototype.ts::displayGameName's "as stored" policy).
  // Before Firestore resolves, derives a name from the id so the boot screen
  // shows a real title on the first paint of a paid-social arrival — see
  // docs/hexclave-findings-2026-09-17.md §D1.
  const displayName = useMemo(() => fallbackGameName(gameId, game?.name), [gameId, game?.name]);
  const [loading, setLoading] = useState(true);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [gameReady, setGameReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // A game bundle that never fires `load` used to leave the spinner turning
  // forever with no way out. `frameStalled` only says the wait is unusually
  // long — the download is still running underneath, so the copy must not
  // claim a failure that hasn't happened. iframe `load` is not game-ready:
  // a hollow shell can fire `load` and still need Retry / Back.
  const [frameStalled, setFrameStalled] = useState(false);
  const [frameFailed, setFrameFailed] = useState(false);
  const [blankShell, setBlankShell] = useState(false);
  /** Preview-only: lets Retry be exercised on a build that came up fine. */
  const [forcePreviewRetry, setForcePreviewRetry] = useState(false);
  /** Cleared once the game is up, so nothing of ours is over live gameplay. */
  const [showHint, setShowHint] = useState(true);
  const hasReadyProbe = gameHasReadyProbe(gameId);
  const recoveryPhase = resolveRecoveryPhase({
    hasGame: Boolean(game),
    frameLoaded,
    frameFailed: frameFailed || (forcePreviewRetry && frameLoaded),
    gameReady,
    stalled: frameStalled,
    hasReadyProbe,
    inspectableBlankShell: blankShell,
  });
  const bootOverlay = loading || showFullBootOverlay(recoveryPhase);
  const compactRecovery = !loading && showCompactRecovery(recoveryPhase);
  const recoveryActions = showRecoveryActions(recoveryPhase);
  const bootStatus = bootStatusCopy(recoveryPhase);

  // Sibling games (hub order) — drives the up/down navigation + mobile swipe.
  const [order, setOrder] = useState<string[]>([]);

  // Engagement state.
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [likeCount, setLikeCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const [comments, setComments] = useState<GameComment[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [socialOpen, setSocialOpen] = useState(false);
  const [socialExpanded, setSocialExpanded] = useState(true);
  const [narrow, setNarrow] = useState(false);
  const [portrait, setPortrait] = useState(false);
  /** Opt-in landscape stage for a portrait phone — see lib/fill-screen.ts. */
  const [fillScreen, setFillScreen] = useState(false);
  const [fillOffered, setFillOffered] = useState(false);
  const [hostSessionId, setHostSessionId] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [gamesOpen, setGamesOpen] = useState(false);
  /** Real conversation state for the Chat cell. A cell that looks the same
   *  whether or not anyone is in the room is a lie the player only finds by
   *  tapping it. */
  const [liveMembers, setLiveMembers] = useState(0);
  const overlayRef = useRef<HTMLDivElement>(null);
  const inviteReceiveSent = useRef('');
  const sessionParam = searchParams.get('session')?.trim() || '';
  const intentParam = searchParams.get('intent')?.trim() || '';
  const liveSession = sessionParam && isPlaySessionId(sessionParam) ? sessionParam : '';
  const activeSession = isPlaySessionId(liveSession || hostSessionId) ? (liveSession || hostSessionId) : '';

  // Comments UI extras: sort order, which comment we're replying to, expanded
  // reply threads, and the viewer's locally-remembered comment likes.
  const [sort, setSort] = useState<'top' | 'newest'>('top');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [likedComments, setLikedComments] = useState<Set<string>>(new Set());
  const composeRef = useRef<HTMLTextAreaElement>(null);

  // Once the user toggles a like, a late-arriving server fetch must NOT clobber
  // their choice (which would look like the like "undoing itself"). Reset per game.
  const likeTouchedRef = useRef(false);
  useEffect(() => { likeTouchedRef.current = false; }, [gameId]);

  // ── Load the game ───────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!gameId) return;
    setLoading(true);
    setError(null);
    setFrameLoaded(false);
    setGameReady(false);
    setBlankShell(false);
    try {
      const g = await fetchGameById(gameId);
      if (!g) {
        setError('Game not found or no longer available.');
        setGame(null);
      } else {
        setGame(g);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load game.');
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  useEffect(() => { if (gameId) load(); }, [gameId, load]);

  // Stall clock starts when this mount is asked to load a game. iframe `load`
  // must not cancel it — a hollow shell fires `load` and would otherwise
  // hide Retry. A late tick after ready / unverified-play is ignored by
  // resolveRecoveryPhase so a healthy session is never covered again.
  useEffect(() => {
    setFrameStalled(false);
    setFrameFailed(false);
    setBlankShell(false);
    setGameReady(false);
    setShowHint(true);
    if (!game) return;
    const t = setTimeout(() => setFrameStalled(true), FRAME_STALL_AFTER_MS);
    return () => clearTimeout(t);
  }, [game, reloadKey, gameId]);

  // Adapter games keep the boot overlay until the existing ready probe
  // succeeds. Games without a probe never get a guessed ready here.
  useEffect(() => {
    if (!game || !hasReadyProbe || gameReady) return;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      if (probeFramePlayable(win, gameId)) setGameReady(true);
    };
    tick();
    const t = setInterval(tick, FRAME_READY_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [game, gameId, hasReadyProbe, gameReady, frameLoaded, reloadKey]);

  // After onload settles, a same-origin hollow shell is a real failure.
  // Cross-origin / opaque frames stay unreachable and are not marked failed.
  useEffect(() => {
    if (!game || !frameLoaded || gameReady || frameFailed) return;
    const t = setTimeout(() => {
      if (inspectSameOriginShell(iframeRef.current).blankBrokenShell) {
        setBlankShell(true);
      }
    }, FRAME_SHELL_SETTLE_MS);
    return () => clearTimeout(t);
  }, [game, frameLoaded, gameReady, frameFailed, reloadKey]);

  // Hand the screen over to the game shortly after it is actually up.
  // Adapter games wait for ready; everyone else waits for the download.
  useEffect(() => {
    if (bootOverlay) return;
    const t = setTimeout(() => setShowHint(false), 6000);
    return () => clearTimeout(t);
  }, [bootOverlay, reloadKey]);

  const retryFrame = useCallback(() => {
    setFrameLoaded(false);
    setGameReady(false);
    setFrameStalled(false);
    setFrameFailed(false);
    setBlankShell(false);
    setForcePreviewRetry(false);
    if (typeof window !== 'undefined' && window.location.search.includes('previewForceRetry=')) {
      const next = new URL(window.location.href);
      next.searchParams.delete('previewForceRetry');
      window.history.replaceState(null, '', mergeAttributionSearch(`${next.pathname}${next.search}`));
    }
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    captureCampaignArrival(typeof window === 'undefined' ? '' : window.location.href);
    // How this browser was acquired, written once and never rewritten. Landing
    // on an invitation is an invite acquisition even when the page also carries
    // UTMs, so the inviter's campaign is never credited with the invitee.
    recordAcquisition({ viaInvite: Boolean(liveSession) });
  }, [liveSession]);

  useEffect(() => {
    if (!gameId) return;
    trackCampaignEvent(CAMPAIGN_EVENTS.gameOpen, { game_id: gameId });
  }, [gameId]);

  // Verified gameplay measurement. `game_start` comes from the build, not from
  // the iframe finishing its download.
  useGameplayMeasurement({ gameId, iframeRef, frameLoaded, reloadKey });

  /* The bar's inset is measured, not guessed — see lib/rail-inset.ts. A
     hardcoded 58px is only true until the bar carries one more thing, and a
     bar that outgrows its constant sits on the game silently. */
  const railRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const rail = railRef.current;
    const body = rail?.parentElement;
    if (!rail || !body) return;
    const sync = () => {
      const { x, y } = railInsetFrom(layoutBoxOf(rail), layoutBoxOf(body));
      body.style.setProperty('--rail-x', `${x}px`);
      body.style.setProperty('--rail-y', `${y}px`);
    };
    sync();
    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', sync);
      window.addEventListener('orientationchange', sync);
      return () => {
        window.removeEventListener('resize', sync);
        window.removeEventListener('orientationchange', sync);
      };
    }
    // The bar's own box never depends on the stage it insets, so observing
    // both cannot feed back into itself.
    const ro = new ResizeObserver(sync);
    ro.observe(rail);
    ro.observe(body);
    return () => ro.disconnect();
  }, []);

  /* Keep the host iframe's box on the stage. A same-origin build can reach
     `window.frameElement` and write width/height; left alone that collapses
     the frame to the browser default 300x150 in the top-left corner while our
     chrome keeps painting full-bleed. Companion state must never remount the
     frame, so this corrects attributes rather than changing `reloadKey`,
     which stays retry-only. */
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !frameLoaded) return;
    const apply = () => clearHostileIframeSizing(iframe);
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(iframe, { attributes: true, attributeFilter: ['style', 'width', 'height'] });
    return () => mo.disconnect();
  }, [frameLoaded, gameId, reloadKey]);

  // Preview-only failure injection, so Retry can be exercised on a healthy
  // build instead of being reported "n/a because the frame came up".
  useEffect(() => {
    if (previewForceRetryRequested(searchParams, window.location.hostname)) {
      setForcePreviewRetry(true);
    }
  }, [searchParams]);

  // The session sheet is a deliberate pause: tell the in-frame focus hold that
  // host chrome is on top, so it stops holding the game awake underneath it.
  useEffect(() => {
    setHostSheetOpen(socialOpen);
    return () => setHostSheetOpen(false);
  }, [socialOpen]);


  // Clear a build's dead menu gate so arrival lands on a playable screen.
  // `probeFramePlayable` hands the screen over once the engine reaches its
  // title screen; for Flappy v9 that screen is inert everywhere except a
  // small START button, so handing it over is not enough on its own.
  // Production replays show arrivals tapping it 19–113 times without ever
  // starting a round. This presses past the gate and stops. It never stands
  // in for the player: the verified `game_start` still needs their own flap.
  useEffect(() => {
    if (!frameLoaded) return;
    const fix = entryFixFor(gameId);
    if (!fix) return;
    let done = false;
    const attempt = () => {
      if (done) return;
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      try {
        if (fix.clear(win as Window)) done = true;
      } catch {
        // A cross-origin or torn-down frame throws on access. Leaving the
        // gate alone is the correct outcome, not a guess.
        done = true;
      }
    };
    attempt();
    const timer = setInterval(() => {
      if (done) clearInterval(timer);
      else attempt();
    }, FRAME_READY_POLL_MS);
    // Stop chasing a build that never comes up rather than polling forever.
    const stop = setTimeout(() => { done = true; clearInterval(timer); }, ENTRY_FIX_WINDOW_MS);
    return () => { done = true; clearInterval(timer); clearTimeout(stop); };
  }, [gameId, frameLoaded, reloadKey]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 899px)');
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)');
    const sync = () => setPortrait(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (liveSession) {
      setSocialOpen(true);
      setSocialExpanded(true);
      if (inviteReceiveSent.current !== liveSession) {
        inviteReceiveSent.current = liveSession;
        trackCampaignEvent(CAMPAIGN_EVENTS.inviteReceive, { game_id: gameId });
      }
    } else if (intentParam === 'invite') {
      setSocialOpen(true);
      setSocialExpanded(true);
    }
  }, [liveSession, intentParam, gameId]);

  useEffect(() => {
    if (!socialOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSocialOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [socialOpen]);

  // ── Sibling order for navigation (fetched once) ──
  useEffect(() => {
    let cancelled = false;
    fetchApprovedGames()
      .then((games) => { if (!cancelled) setOrder(games.map((g) => g.id)); })
      .catch(() => { /* navigation just stays disabled */ });
    return () => { cancelled = true; };
  }, []);

  // ── Resolve who's acting (signed-in user or persistent guest) ──
  useEffect(() => {
    let cancelled = false;
    resolveIdentity(user).then((idn) => { if (!cancelled) setIdentity(idn); });
    return () => { cancelled = true; };
  }, [user]);

  // ── Likes + comment count, refreshed per game + identity ──
  useEffect(() => {
    if (!gameId || !identity) return;
    let cancelled = false;
    fetchLikeSummary(gameId, identity.id).then((s) => {
      if (cancelled) return;
      setLikeCount(s.count);
      if (!likeTouchedRef.current) setLiked(s.liked);
    });
    fetchCommentCount(gameId).then((n) => { if (!cancelled) setCommentCount(n); });
    return () => { cancelled = true; };
  }, [gameId, identity]);

  /** Existing hub art — the preview still if the developer uploaded a clip,
   *  otherwise the icon. Never a new asset invented for this screen. */
  const artwork = game?.preview?.posterUrl || game?.iconUrl || '';
  const controls = useMemo(() => (gameId ? gameControls(gameId) : null), [gameId]);

  /* Live conversation state for the Chat cell. Counts active members only —
     someone who left is not in the room, and showing them would overstate
     what the player is walking into. */
  useEffect(() => {
    if (!activeSession) {
      setLiveMembers(0);
      return;
    }
    const stop = subscribePlayPreview(activeSession, {
      onMembers: (members) => setLiveMembers(members.filter((m) => m.status === 'active').length),
      onError: () => setLiveMembers(0),
    });
    return () => stop();
  }, [activeSession]);

  // Close the transient menus whenever attention goes back to the game, the
  // same rule Rook's sheet follows. Nothing here touches the frame.
  useEffect(() => {
    if (!moreOpen && !gamesOpen) return;
    const close = () => { setMoreOpen(false); setGamesOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const poll = window.setInterval(() => {
      if (document.activeElement === iframeRef.current) close();
    }, 400);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [moreOpen, gamesOpen]);

  /* Whether to offer the rotated stage. Recomputed on orientation and on game
     change; a player who turns the phone sideways has already got the space,
     so the offer and the rotation both drop away. */
  useEffect(() => {
    setFillOffered(
      fillScreenOffered({
        hasOrientationHint: Boolean(controls?.orientationHint),
        portrait,
        narrow,
        supported: canFillScreen(),
        frameReady: frameLoaded,
      }),
    );
  }, [controls?.orientationHint, portrait, narrow, frameLoaded, gameId]);

  /* The rotated player gives the screen back on physical rotation and
     whenever a sheet that is typed into opens — see shouldExitFillScreen.
     This only changes a class: the frame stays mounted and the game resizes,
     which is not the same as a remount. */
  useEffect(() => {
    if (!fillScreen) return;
    if (shouldExitFillScreen({ portrait, textSheetOpen: socialOpen || commentsOpen })) {
      setFillScreen(false);
    }
  }, [fillScreen, portrait, socialOpen, commentsOpen]);

  useEffect(() => {
    setFillScreen(false);
  }, [gameId]);

  // ── Prev / next in hub order (wraps around) ──
  const { prevId, nextId } = useMemo(() => {
    if (order.length < 2 || !gameId) return { prevId: null, nextId: null };
    const i = order.indexOf(gameId);
    if (i === -1) return { prevId: null, nextId: null };
    const n = order.length;
    return {
      prevId: order[(i - 1 + n) % n],
      nextId: order[(i + 1) % n],
    };
  }, [order, gameId]);

  const goTo = useCallback((target: string | null) => {
    if (!target || target === gameId) return;
    router.push(`/games/${encodeURIComponent(target)}`);
  }, [router, gameId]);

  // ── Toast helper ─────────────────────────────────────────────────
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  /* One invite path for every entry point: the bar's Invite cell, the session
     sheet, and a first-party build calling `sendChallenge`/`openChat` through
     the bridge. It writes a real play session first and only claims success
     after that write, so the "cannot complete invite without InZone SDK" dead
     end is gone. What it creates is an InZone conversation — shared chat and
     membership — not a shared match. Copy says conversation for that reason:
     a game whose only synchronised state is chat must not be sold as
     multiplayer (CLAUDE.md, "Do not"). */
  const completeConversationInvite = useCallback(async (method: 'sendChallenge' | 'openChat') => {
    setHostSheetOpen(true);
    setSocialOpen(true);
    setSocialExpanded(true);
    trackCampaignEvent(CAMPAIGN_EVENTS.inviteSheetOpen, { game_id: gameId });
    const created = await createConversationInvite({
      gameId,
      origin: window.location.origin,
      existingSessionId: activeSession,
    });
    setHostSessionId(created.sessionId);
    window.history.replaceState(
      null,
      '',
      mergeAttributionSearch(`${window.location.pathname}?session=${created.sessionId}`),
    );
    const copied = await trackInviteCopiedAfterWrite(
      async (text) => {
        await navigator.clipboard.writeText(text);
      },
      created.url,
      gameId,
    );
    flashToast(copied ? PLAY_INVITE_COPY.conversationToast : PLAY_INVITE_COPY.conversationReady);
    void method;
    return created.result;
  }, [activeSession, flashToast, gameId]);

  async function handleInviteCopy() {
    try {
      await completeConversationInvite('sendChallenge');
    } catch (err) {
      console.warn('createConversationInvite failed', err instanceof Error ? err.message : err);
      flashToast('Couldn’t start a live session. Try again.');
    }
  }

  // ── Actions ─────────────────────────────────────────────────────
  function handleReplay() {
    retryFrame();
  }

  function openSocialSheet() {
    setSocialOpen(true);
    setSocialExpanded(true);
    trackCampaignEvent(CAMPAIGN_EVENTS.inviteSheetOpen, { game_id: gameId });
  }

  /* The iframe's `load` says the bundle downloaded. It is not game-ready
     and never dismisses recovery for adapter games. useGameplayMeasurement
     still emits the `game_frame_loaded` proxy from this flag. */
  function noteFrameLoaded() {
    setFrameLoaded(true);
  }

  function noteFrameFailed() {
    setFrameFailed(true);
  }

  async function handleToggleLike() {
    if (!identity || likeBusy) return;
    likeTouchedRef.current = true;
    const next = !liked;
    // Optimistic — snap the UI, reconcile if the write fails.
    setLiked(next);
    setLikeCount((c) => Math.max(0, c + (next ? 1 : -1)));
    setLikeBusy(true);
    try {
      await setLike(gameId, identity, next);
    } catch (e) {
      // Most commonly this means the Firestore rules for the likes
      // subcollection aren't deployed yet — see firestore.rules.
      console.warn('[InZone] like write failed (deploy firestore.rules?):', e);
      setLiked(!next);
      setLikeCount((c) => Math.max(0, c + (next ? -1 : 1)));
      flashToast("Couldn't save like");
    } finally {
      setLikeBusy(false);
    }
  }

  const openComments = useCallback(async () => {
    setCommentsOpen(true);
    setCommentsLoading(true);
    setLikedComments(getLikedCommentIds(gameId));
    try {
      const list = await fetchComments(gameId);
      setComments(list);
      setCommentCount(list.length);
    } finally {
      setCommentsLoading(false);
    }
  }, [gameId]);

  async function handlePostComment() {
    if (!identity || posting) return;
    const text = draft.trim();
    if (!text) return;
    const parentId = replyTo?.id ?? null;
    setPosting(true);
    setCommentError(null);
    try {
      const created = await addComment(gameId, identity, text, parentId);
      setComments((prev) => [created, ...prev]);
      setCommentCount((c) => c + 1);
      setDraft('');
      if (parentId) setExpanded((s) => new Set(s).add(parentId)); // show the thread we just replied in
      setReplyTo(null);
      requestAnimationFrame(() => autoGrow(composeRef.current));
    } catch (e) {
      setCommentError(e instanceof Error ? e.message : 'Could not post comment.');
    } finally {
      setPosting(false);
    }
  }

  // Optimistic per-comment like toggle. The shared tally moves on the server;
  // the viewer's own "liked" flag is remembered locally (guest-friendly).
  async function handleLikeComment(commentId: string) {
    const next = !likedComments.has(commentId);
    setLikedComments((prev) => {
      const s = new Set(prev);
      if (next) s.add(commentId); else s.delete(commentId);
      return s;
    });
    setComments((prev) => prev.map((c) =>
      c.id === commentId ? { ...c, likeCount: Math.max(0, c.likeCount + (next ? 1 : -1)) } : c,
    ));
    setCommentLiked(gameId, commentId, next);
    try {
      await likeComment(gameId, commentId, next);
    } catch (e) {
      // Revert on failure (most likely undeployed rules).
      console.warn('[InZone] comment like failed (deploy firestore.rules?):', e);
      setLikedComments((prev) => {
        const s = new Set(prev);
        if (next) s.delete(commentId); else s.add(commentId);
        return s;
      });
      setComments((prev) => prev.map((c) =>
        c.id === commentId ? { ...c, likeCount: Math.max(0, c.likeCount + (next ? -1 : 1)) } : c,
      ));
      setCommentLiked(gameId, commentId, !next);
    }
  }

  function startReply(c: GameComment) {
    setReplyTo({ id: c.parentId ?? c.id, name: c.authorName });
    requestAnimationFrame(() => composeRef.current?.focus());
  }

  // Split comments into top-level (sorted by the chosen order) and replies
  // grouped under their parent (oldest first within a thread).
  const { topLevel, repliesByParent } = useMemo(() => {
    const tops: GameComment[] = [];
    const byParent = new Map<string, GameComment[]>();
    for (const c of comments) {
      if (c.parentId) {
        const arr = byParent.get(c.parentId) ?? [];
        arr.push(c);
        byParent.set(c.parentId, arr);
      } else {
        tops.push(c);
      }
    }
    for (const arr of byParent.values()) {
      arr.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    }
    tops.sort((a, b) => {
      if (sort === 'top' && b.likeCount !== a.likeCount) return b.likeCount - a.likeCount;
      return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    });
    return { topLevel: tops, repliesByParent: byParent };
  }, [comments, sort]);

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }

  function renderComment(c: GameComment, isReply: boolean) {
    const replies = repliesByParent.get(c.id) ?? [];
    const isLiked = likedComments.has(c.id);
    const open = expanded.has(c.id);
    return (
      <div key={c.id} className={`comment${isReply ? ' reply' : ''}`}>
        <div className="comment-avatar" aria-hidden="true">{initial(c.authorName)}</div>
        <div className="comment-body">
          <div className="comment-meta">
            <span className="comment-author">{c.authorName}</span>
            {c.createdAt && <span className="comment-time">{timeAgo(c.createdAt)}</span>}
          </div>
          <p className="comment-text">{c.text}</p>
          <div className="comment-actions">
            <button
              className={`comment-like${isLiked ? ' liked' : ''}`}
              onClick={() => handleLikeComment(c.id)}
              aria-pressed={isLiked}
              aria-label={isLiked ? 'Unlike comment' : 'Like comment'}
            >
              <HeartIcon filled={isLiked} size={16} />
              {c.likeCount > 0 && <span>{formatCount(c.likeCount)}</span>}
            </button>
            <button className="comment-reply-btn" onClick={() => startReply(c)}>Reply</button>
          </div>
          {!isReply && replies.length > 0 && (
            <button className="comment-replies-toggle" onClick={() => toggleExpanded(c.id)}>
              <span className={`replies-caret${open ? ' open' : ''}`}><ChevronDownIcon /></span>
              {open ? 'Hide replies' : `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
            </button>
          )}
          {!isReply && open && replies.length > 0 && (
            <div className="comment-replies">{replies.map((r) => renderComment(r, true))}</div>
          )}
        </div>
      </div>
    );
  }

  // Share = copy the plain public website link (NOT the app deep link).
  async function handleShare() {
    const url = gameWebLink(gameId);
    try {
      await navigator.clipboard.writeText(url);
      flashToast('Link copied');
    } catch {
      flashToast(url);
    }
  }

  // App = open / share the InZone app deep link, keeping the native share card.
  async function handleOpenApp() {
    const url = gameShareLink(gameId);
    const title = displayName ? `Play ${displayName} on InZone` : 'Play this game on InZone';
    const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    trackCampaignEvent(CAMPAIGN_EVENTS.appCtaClick, {
      game_id: gameId,
      cta_surface: 'player_rail',
      outcome: canShare ? 'share' : 'phone_link',
    });
    if (canShare) {
      try { await navigator.share({ title, url }); } catch { /* user dismissed */ }
      return;
    }
    // No share sheet (most desktops) → copy the deep link so it can be opened on a phone.
    try {
      await navigator.clipboard.writeText(url);
      flashToast('Phone link copied. Open it on your phone to get the app.');
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  }

  /* The swipe handlers are gone with the gutters. Changing game is an
     explicit cell in the bar, which is reachable without putting a listener
     over any part of the game. */

  const navDisabled = !prevId && !nextId;

  const layout: PlayerLayout = narrow ? 'touch' : 'wide';
  const actionSplit = useMemo(
    () => splitPlayerActions(layout, (id) => {
      // An action that does not apply to this visit is absent, not disabled:
      // a dead cell spends the same space as a live one.
      if (id === 'fill') return fillOffered || fillScreen;
      if (id === 'games') return !navDisabled;
      return true;
    }),
    [layout, fillOffered, fillScreen, navDisabled],
  );

  /** One definition of each action, rendered either as a bar cell or as a row
   *  in More. Two presentations, never two lists that can drift apart. */
  function renderAction(id: PlayerActionId, variant: 'cell' | 'chip') {
    const cls = variant === 'cell' ? 'rail-btn' : 'player-more-row';
    const cap = (text: string) =>
      variant === 'cell' ? <span className="rail-cap">{text}</span> : <span>{text}</span>;
    const dismiss = () => { setMoreOpen(false); setGamesOpen(false); };

    switch (id) {
      case 'rook':
        return (
          <GameCompanion
            key="rook"
            gameId={gameId}
            gameName={displayName}
            iframeRef={iframeRef}
            overlayRef={overlayRef}
            active={frameLoaded && !socialOpen}
          />
        );
      case 'chat':
        return (
          <button
            key="chat"
            type="button"
            className={`${cls}${socialOpen ? ' active' : ''}${liveMembers > 0 ? ' is-live' : ''}`}
            data-testid="player-chat"
            data-live-members={String(liveMembers)}
            onClick={() => { dismiss(); openSocialSheet(); }}
            aria-label={liveMembers > 0 ? `Chat — ${liveMembers} in the room` : 'Chat'}
          >
            <CommentIcon />
            {cap(liveMembers > 0 ? `${liveMembers} here` : 'Chat')}
          </button>
        );
      case 'invite':
        return (
          <button
            key="invite"
            type="button"
            className={cls}
            data-testid="player-invite"
            onClick={() => { dismiss(); void handleInviteCopy(); }}
            aria-label="Invite a friend to this conversation"
          >
            <InviteIcon />
            {cap('Invite')}
          </button>
        );
      case 'games':
        return (
          <button
            key="games"
            type="button"
            className={`${cls}${gamesOpen ? ' active' : ''}`}
            data-testid="player-change-game"
            aria-expanded={gamesOpen}
            aria-controls="player-games-sheet"
            onClick={() => { setMoreOpen(false); setGamesOpen((open) => !open); }}
            aria-label="Change game"
          >
            <GamesIcon />
            {cap('Games')}
          </button>
        );
      case 'home':
        return (
          <Link key="home" href="/games" className={cls} aria-label="Back to all games" onClick={dismiss}>
            <HomeIcon />
            {cap('Home')}
          </Link>
        );
      case 'replay':
        return (
          <button key="replay" type="button" className={cls} onClick={() => { dismiss(); handleReplay(); }} disabled={!game} aria-label="Replay game">
            <ReplayIcon />
            {cap('Replay')}
          </button>
        );
      case 'like':
        return (
          <button
            key="like"
            type="button"
            className={`${cls}${liked ? ' active' : ''}`}
            onClick={handleToggleLike}
            disabled={!game || !identity}
            aria-pressed={liked}
            aria-label={liked ? 'Unlike game' : 'Like game'}
          >
            <HeartIcon filled={liked} />
            {cap(formatCount(likeCount))}
          </button>
        );
      case 'comments':
        return (
          <button key="comments" type="button" className={cls} onClick={() => { dismiss(); openComments(); }} disabled={!game} aria-label="Comments">
            <CommentIcon />
            {cap(formatCount(commentCount))}
          </button>
        );
      case 'share':
        return (
          <button key="share" type="button" className={cls} onClick={() => { dismiss(); handleShare(); }} disabled={!game} aria-label="Copy share link">
            <LinkIcon />
            {cap('Share')}
          </button>
        );
      case 'app':
        return (
          <button key="app" type="button" className={cls} onClick={() => { dismiss(); handleOpenApp(); }} disabled={!game} aria-label="Get the InZone app" data-testid="player-get-app">
            <AppIcon />
            {cap('App')}
          </button>
        );
      case 'fill':
        return (
          <button
            key="fill"
            type="button"
            className={`${cls}${fillScreen ? ' active' : ''}`}
            data-testid="player-fill-screen"
            aria-pressed={fillScreen}
            aria-label={fillScreen ? FILL_SCREEN_COPY.restoreLabel : FILL_SCREEN_COPY.fillLabel}
            onClick={() => { dismiss(); setFillScreen((on) => !on); }}
          >
            <FillScreenIcon />
            {cap(fillScreen ? FILL_SCREEN_COPY.restore : FILL_SCREEN_COPY.fill)}
          </button>
        );
      default:
        return null;
    }
  }

  return (
    <div className="game-frame-shell">
      <div className="game-frame-body" data-fill={fillScreen ? 'on' : 'off'}>
        {error ? (
          <div className="empty" style={{ position: 'absolute', inset: 0 }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>⚠️</div>
            <h2>Couldn&apos;t load game</h2>
            <p>{error}</p>
            <button onClick={load} className="btn-primary">Retry</button>
          </div>
        ) : (
          <>
            {/* `.game-stage` is the iframe's containing block and the only box
                that decides how big the game is. Everything else on this
                screen either insets it (the bar) or floats over the dead
                letterbox (caption, hint, recovery) — never both. */}
            <div className="game-stage">
            {game && (isWebSdkHostEnabled(gameId) ? (
              // Opted-in games only: opaque-origin SDK host. Default games keep
              // the unsandboxed same-origin iframe so storage/assets stay as today.
              <GameSdkHost
                iframeRef={iframeRef}
                reloadKey={reloadKey}
                src={sameOriginGameUrl(withServerUrl(game.gameUrl, game.serverUrl))}
                title={displayName}
                gameId={gameId}
                user={user}
                mode="live"
                onFrameLoaded={noteFrameLoaded}
                onFrameError={noteFrameFailed}
                onConversationInvite={completeConversationInvite}
              />
            ) : (
              // `scrolling="no"` only kicks in when a game overflows: it
              // suppresses the iframe's scrollbars. A game that fits the
              // window is completely unaffected (no resize, no clipping).
              <iframe
                ref={iframeRef}
                key={reloadKey}
                src={sameOriginGameUrl(withServerUrl(game.gameUrl, game.serverUrl))}
                title={displayName}
                scrolling="no"
                onLoad={noteFrameLoaded}
                onError={noteFrameFailed}
                allow="camera; microphone; geolocation; encrypted-media; autoplay; fullscreen; gamepad; accelerometer; gyroscope"
                allowFullScreen
              />
            ))}
            </div>

            {/* No swipe gutters. They were two always-on strips over the
                iframe's edges, and an always-on strip over the game captures
                whatever the game wanted there — a lane swipe, a drag, a flick.
                Changing game is an explicit cell in the bar now, which costs
                the player one deliberate tap and the game nothing. Re-adding
                swipe needs device evidence that it takes no gesture the build
                uses, not an assumption that the edges are free. */}

            {bootOverlay && (
              <div className="game-boot" role="status" aria-live="polite" data-testid="game-boot" data-recovery={recoveryPhase}>
                {/* The artwork the player just tapped in the ad or on the hub.
                    Nothing here is a progress figure: the host cannot see
                    inside a third-party bundle, so a percentage would be made
                    up. The art plus a moving bar is the honest version. */}
                {artwork ? (
                  <img className="game-boot-art" src={artwork} alt="" width={112} height={112} />
                ) : (
                  <div className="game-boot-art game-boot-art-fallback" aria-hidden="true" />
                )}
                <h2 className="game-boot-name">{displayName || 'Loading game'}</h2>

                {recoveryPhase === 'failed' || recoveryPhase === 'stalled' ? (
                  <p className="game-boot-status">{bootStatus}</p>
                ) : (
                  <>
                    <div className="game-boot-bar" aria-hidden="true"><span /></div>
                    <p className="game-boot-status">{bootStatus || 'Loading…'}</p>
                  </>
                )}

                {controls && recoveryPhase !== 'failed' && (
                  <div className="game-boot-controls">
                    <p className="game-boot-controls-primary">{controls.primary}</p>
                    {controls.note && <p className="game-boot-controls-note">{controls.note}</p>}
                    {controls.orientationHint && narrow && portrait && (
                      <p className="game-boot-controls-note">{controls.orientationHint}</p>
                    )}
                  </div>
                )}

                {recoveryActions && (
                  <div className="game-boot-actions" data-testid="game-boot-actions">
                    <button type="button" className="btn-primary" data-testid="game-retry" onClick={retryFrame}>Try again</button>
                    <Link href="/games" className="game-boot-back" data-testid="game-back">Back to games</Link>
                  </div>
                )}
              </div>
            )}

            {compactRecovery && (
              <div className="game-recovery-compact" data-testid="game-recovery-compact">
                <button type="button" className="game-recovery-retry" data-testid="game-retry" onClick={retryFrame}>
                  Try again
                </button>
                <Link href="/games" className="game-boot-back" data-testid="game-back">Back to games</Link>
              </div>
            )}

            {/* After the game is up, the verified controls stay readable for a
                few seconds in the letterbox strip, then get out of the way. */}
            {!bootOverlay && showHint && controls && (
              <div className="game-hint" role="note">
                <span>{controls.primary}</span>
                <button type="button" onClick={() => setShowHint(false)} aria-label="Dismiss controls hint">
                  <CloseIcon />
                </button>
              </div>
            )}

            {/* No title over live gameplay. The boot screen already names the
                game, and uploaded builds put their own title in the top-left:
                ours landed directly on Nightclub Showdown's, two headlines in
                the same 40px. The top-left belongs to the game. */}

            {/* Lets a first-party build's own Challenge-a-Friend reach the
                same conversation invite instead of a missing-SDK dead end. */}
            <PlayInviteHost iframeRef={iframeRef} onRequest={completeConversationInvite} />

            {/* Where every floating thing is painted. It is a direct child of
                the stage's parent, never of the bar: `.game-rail` is
                positioned and scrolls its overflow, so anything absolutely
                positioned inside it is clipped to the bar on a desktop rail
                and measured against the wrong box on a phone. */}
            <div className="player-overlay" ref={overlayRef} aria-hidden={false} />

            {moreOpen && (
              <div
                id="player-more-sheet"
                className="player-sheet"
                data-testid="player-more-sheet"
                role="dialog"
                aria-label="More actions"
              >
                {actionSplit.secondary.map((id) => renderAction(id, 'chip'))}
              </div>
            )}

            {gamesOpen && (
              <div
                id="player-games-sheet"
                className="player-sheet"
                data-testid="player-games-sheet"
                role="dialog"
                aria-label="Change game"
              >
                <button
                  type="button"
                  className="player-more-row"
                  data-testid="player-prev-game"
                  disabled={!prevId}
                  onClick={() => { setGamesOpen(false); goTo(prevId); }}
                >
                  <ChevronUpIcon />
                  <span>Previous game</span>
                </button>
                <button
                  type="button"
                  className="player-more-row"
                  data-testid="player-next-game"
                  disabled={!nextId}
                  onClick={() => { setGamesOpen(false); goTo(nextId); }}
                >
                  <ChevronDownIcon />
                  <span>Next game</span>
                </button>
                <Link href="/games" className="player-more-row" onClick={() => setGamesOpen(false)}>
                  <HomeIcon />
                  <span>All games</span>
                </Link>
              </div>
            )}

            {/* Chat and Invite are cells of the bar now, not floating pills.
                They used to sit over the game in their own corner, which made
                them a second persistent surface with its own rules — and on a
                phone they landed on whatever the build drew there. */}
          </>
        )}

        {/* ── Engagement rail (right on desktop, bottom bar on mobile) ── */}
        {/* One persistent surface. What it carries is a budget decision, not
            a styling one — see lib/player-actions.ts. A phone shows Rook, the
            conversation and navigation; everything else is one tap away behind
            More, never gone. A wide viewport has room for all of it at once. */}
        <div className="game-rail" ref={railRef} role="toolbar" aria-label="Game actions">
          {actionSplit.primary.map((id) => renderAction(id, 'cell'))}
          {actionSplit.needsMore && (
            <button
              type="button"
              className={`rail-btn${moreOpen ? ' active' : ''}`}
              data-testid="player-more"
              aria-expanded={moreOpen}
              aria-controls="player-more-sheet"
              aria-label="More actions"
              onClick={() => { setGamesOpen(false); setMoreOpen((open) => !open); }}
            >
              <MoreIcon />
              <span className="rail-cap">More</span>
            </button>
          )}
        </div>

        {toast && <div className="share-toast" role="status">{toast}</div>}
      </div>

      {socialOpen && (
        <>
          <button
            type="button"
            className="social-panel-scrim"
            aria-label="Close session sheet"
            onClick={() => setSocialOpen(false)}
          />
          <SocialPanel
            gameId={gameId}
            liveSession={liveSession || null}
            inviteComposer={intentParam === 'invite' || !liveSession}
            expanded={!narrow || socialExpanded}
            hasInteracted={frameLoaded}
            onCloseRequest={() => setSocialOpen(false)}
            onExpandRequest={() => setSocialExpanded(true)}
            onPlayGame={(nextId) => {
              if (!nextId || nextId === gameId) return;
              const params = new URLSearchParams();
              if (liveSession) params.set('session', liveSession);
              else if (sessionParam) params.set('session', sessionParam);
              const qs = params.toString();
              router.push(`/games/${encodeURIComponent(nextId)}${qs ? `?${qs}` : ''}`);
            }}
          />
        </>
      )}

      {/* ── Comments panel ── */}
      {commentsOpen && (
        <>
          <div className="comments-backdrop" onClick={() => setCommentsOpen(false)} />
          <aside className="comments-panel" aria-label="Comments">
            <header className="comments-head">
              <div className="comments-title">
                <h2>Comments</h2>
                <span className="comments-count">{formatCount(commentCount)}</span>
              </div>
              <div className="comments-head-actions">
                <div className="sort-wrap">
                  <button
                    className="icon-btn"
                    onClick={() => setSortMenuOpen((o) => !o)}
                    aria-haspopup="menu"
                    aria-expanded={sortMenuOpen}
                    aria-label="Sort comments"
                  >
                    <SortIcon />
                  </button>
                  {sortMenuOpen && (
                    <>
                      <div className="sort-menu-backdrop" onClick={() => setSortMenuOpen(false)} />
                      <div className="sort-menu" role="menu">
                        <button role="menuitemradio" aria-checked={sort === 'top'} className={sort === 'top' ? 'active' : ''} onClick={() => { setSort('top'); setSortMenuOpen(false); }}>
                          Top {sort === 'top' && <CheckIcon />}
                        </button>
                        <button role="menuitemradio" aria-checked={sort === 'newest'} className={sort === 'newest' ? 'active' : ''} onClick={() => { setSort('newest'); setSortMenuOpen(false); }}>
                          Newest {sort === 'newest' && <CheckIcon />}
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <button className="icon-btn" onClick={() => setCommentsOpen(false)} aria-label="Close comments">
                  <CloseIcon />
                </button>
              </div>
            </header>

            <div className="comments-list">
              {commentsLoading ? (
                <div className="comments-empty">Loading…</div>
              ) : topLevel.length === 0 ? (
                <div className="comments-empty">No comments yet. Be the first!</div>
              ) : (
                topLevel.map((c) => renderComment(c, false))
              )}
            </div>

            <div className="comments-compose">
              {replyTo && (
                <div className="reply-banner">
                  Replying to <b>{replyTo.name}</b>
                  <button className="reply-cancel" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
                    <CloseIcon />
                  </button>
                </div>
              )}
              {identity && (
                <div className="compose-as">
                  Commenting as <b>{identity.username}</b>
                  {identity.anonymous && <span className="guest-tag">guest</span>}
                </div>
              )}
              {commentError && <div className="compose-err">{commentError}</div>}
              <div className="compose-row">
                <textarea
                  ref={composeRef}
                  className="compose-input"
                  placeholder={replyTo ? `Reply to ${replyTo.name}…` : 'Add a comment…'}
                  value={draft}
                  rows={1}
                  maxLength={MAX_COMMENT_LEN}
                  onChange={(e) => { setDraft(e.target.value); autoGrow(e.target); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePostComment(); }
                  }}
                />
                <button
                  className="compose-send"
                  onClick={handlePostComment}
                  disabled={posting || !draft.trim() || !identity}
                  aria-label="Post comment"
                >
                  {posting ? <span className="compose-spin" aria-hidden="true" /> : <SendIcon />}
                </button>
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

/** Append `?serverUrl=…` to the game's gameUrl so the client iframe can read
 *  it from `window.location.search` and dial the right multiplayer backend.
 *  Skips appending when serverUrl is empty (single-player game). */
function withServerUrl(gameUrl: string, serverUrl: string): string {
  if (!gameUrl) return gameUrl;
  if (!serverUrl) return gameUrl;
  try {
    const u = new URL(gameUrl);
    u.searchParams.set('serverUrl', serverUrl);
    return u.toString();
  } catch {
    const sep = gameUrl.includes('?') ? '&' : '?';
    return `${gameUrl}${sep}serverUrl=${encodeURIComponent(serverUrl)}`;
  }
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0)}K`.replace('.0', '');
  return `${(n / 1_000_000).toFixed(1)}M`.replace('.0', '');
}

function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

function timeAgo(ms: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

function InviteIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </svg>
  );
}

function GamesIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="4" />
      <path d="M7 10v4M5 12h4M16 11h.01M18.5 13.5h.01" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

function FillScreenIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="7" width="20" height="10" rx="2" />
      <path d="M12 3v2M12 19v2" />
    </svg>
  );
}

function ReplayIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9.5 12 3l9 6.5" />
      <path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}

function HeartIcon({ filled, size = 22 }: { filled?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function SortIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="6" y1="12" x2="18" y2="12" />
      <line x1="9" y1="18" x2="15" y2="18" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/** Grow a comment textarea to fit its content, up to the CSS max-height. */
function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
}

function CommentIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function AppIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <path d="M11 18h2" />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}
