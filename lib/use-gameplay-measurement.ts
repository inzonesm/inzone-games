'use client';

import { useEffect, useRef } from 'react';
import {
  CAMPAIGN_EVENTS,
  readAcquisition,
  trackCampaignEvent,
} from './campaign-analytics';
import { gameSignalAdapter, startSignalFromProgress } from './game-adapters';
import {
  ACTIVITY_TIMEOUT_MS,
  VISITOR_STORAGE_KEY,
  VISIT_STORAGE_KEY,
  applyGameplaySignal,
  emptyEngagement,
  localDay,
  localTimezone,
  newRandomId,
  noteVerifiedPlayDay,
  parseGameplayMessage,
  resolveVisit,
  type EmittedEvent,
  type GameEngagement,
  type GameplaySignal,
  type SignalSource,
  type VisitRecord,
  type VisitorRecord,
} from './gameplay-signals';

/** How often we ask a same-origin build for its state. */
const POLL_MS = 1000;

function readJson<T>(store: Storage | null, key: string): T | null {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(store: Storage | null, key: string, value: unknown): void {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked; measurement degrades rather than throwing */
  }
}

function session(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

function local(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function engagementKey(visitId: string, gameId: string): string {
  return `inzone.engagement.v1:${visitId}:${gameId}`;
}

/**
 * Emit verified gameplay events for the game currently on screen.
 *
 * The hook is the only place that turns a build's signal into an analytics
 * event, so every guarantee in lib/gameplay-signals.ts is enforced in one
 * place:
 *
 *  - `game_frame_loaded` is the proxy for the iframe's `load`. `game_start` is
 *    never emitted from it.
 *  - Engagement is stored per visit and per game, so a refresh resumes the
 *    count instead of restarting it, and cannot re-emit `engaged_play`.
 *  - `mountId` scopes every run id, so a signal that arrives from a previous
 *    mount is ignored and gameplay after a refresh is a genuinely new round.
 *  - A game with no adapter and no bridge messages produces no verified events
 *    at all.
 */
export function useGameplayMeasurement(opts: {
  gameId: string;
  iframeRef: { current: HTMLIFrameElement | null };
  frameLoaded: boolean;
  /** Bumped by the host whenever the iframe is remounted. */
  reloadKey: number;
}): void {
  const { gameId, iframeRef, frameLoaded, reloadKey } = opts;
  const frameLoadedSent = useRef('');

  // The frame-load proxy. Named for what it is, and kept out of the verified set.
  useEffect(() => {
    if (!frameLoaded || !gameId) return;
    const key = `${gameId}:${reloadKey}`;
    if (frameLoadedSent.current === key) return;
    frameLoadedSent.current = key;
    trackCampaignEvent(CAMPAIGN_EVENTS.gameFrameLoaded, { game_id: gameId });
  }, [frameLoaded, gameId, reloadKey]);

  useEffect(() => {
    if (!gameId || typeof window === 'undefined') return;

    const mountId = newRandomId('mount');
    const adapter = gameSignalAdapter(gameId);
    const signalSource: SignalSource = adapter ? 'same-origin-adapter' : 'postmessage-bridge';

    // Visit: continued if this tab has a fresh one, otherwise a new one.
    const { visit } = resolveVisit(readJson<VisitRecord>(session(), VISIT_STORAGE_KEY), Date.now());
    writeJson(session(), VISIT_STORAGE_KEY, visit);

    let visitor = readJson<VisitorRecord>(local(), VISITOR_STORAGE_KEY);
    const visitorId = visitor?.visitorId || newRandomId('visitor');

    const key = engagementKey(visit.visitId, gameId);
    let state: GameEngagement = readJson<GameEngagement>(session(), key) ?? emptyEngagement();
    let lastTick: { at: number; fingerprint: string } | null = null;
    /** Last fingerprint seen for a run, used to spot the first real action. */
    const lastFingerprint = new Map<string, string>();

    const acquisition = readAcquisition();

    const baseProps = () => ({
      game_id: gameId,
      visit_id: visit.visitId,
      visitor_id: visitorId,
      signal_source: signalSource,
      ...(acquisition ? { acquisition: acquisition.channel } : {}),
    });

    function emit(event: EmittedEvent): void {
      switch (event.name) {
        case 'game_ready':
          trackCampaignEvent(CAMPAIGN_EVENTS.gameReady, { ...baseProps(), ...(event.runId ? { run_id: event.runId } : {}) });
          break;
        case 'game_start': {
          trackCampaignEvent(CAMPAIGN_EVENTS.gameStart, { ...baseProps(), run_id: event.runId });
          // A verified start is also the only thing that can make a day count
          // as a return, so the two decisions stay together.
          const day = localDay();
          const { record, isReturn } = noteVerifiedPlayDay(visitor, visitorId, day);
          visitor = record;
          writeJson(local(), VISITOR_STORAGE_KEY, record);
          if (isReturn) {
            trackCampaignEvent(CAMPAIGN_EVENTS.returnPlay, {
              ...baseProps(),
              run_id: event.runId,
              day,
              timezone: localTimezone(),
            });
          }
          break;
        }
        case 'engaged_play':
          trackCampaignEvent(CAMPAIGN_EVENTS.engagedPlay, {
            ...baseProps(),
            run_id: event.runId,
            active_seconds: Math.round(event.activeMs / 1000),
          });
          break;
        case 'first_game_over':
          trackCampaignEvent(CAMPAIGN_EVENTS.firstGameOver, {
            ...baseProps(),
            run_id: event.runId,
            ...(event.outcome ? { outcome: event.outcome } : {}),
          });
          break;
      }
    }

    function fold(signal: GameplaySignal): void {
      const now = Date.now();
      const result = applyGameplaySignal({
        state,
        signal,
        now,
        documentVisible: document.visibilityState === 'visible',
        lastTick,
      });
      state = result.state;
      lastTick = result.lastTick;
      for (const event of result.events) emit(event);
      if (result.events.length) writeJson(session(), key, state);
      // Keeps the visit alive only while something is actually happening.
      writeJson(session(), VISIT_STORAGE_KEY, { visitId: visit.visitId, lastActiveAt: now });
    }

    /** A build's first observed state change is its first gameplay action. */
    function foldWithStartDetection(signal: GameplaySignal): void {
      if (signal.type === 'progress') {
        const prev = lastFingerprint.get(signal.runId) ?? null;
        lastFingerprint.set(signal.runId, signal.fingerprint);
        const start = startSignalFromProgress(prev, signal);
        if (start) fold(start);
      }
      fold(signal);
    }

    // ── same-origin adapter path ──────────────────────────────────────────
    let timer: ReturnType<typeof setInterval> | null = null;
    if (adapter) {
      timer = setInterval(() => {
        const win = iframeRef.current?.contentWindow;
        if (!win) return;
        let signals: GameplaySignal[] = [];
        try {
          signals = adapter.read(win as Window, mountId);
        } catch {
          // A cross-origin or torn-down frame throws on access. Nothing to
          // report is the correct outcome, not a guess.
          return;
        }
        for (const s of signals) foldWithStartDetection(s);
      }, POLL_MS);
    }

    // ── postMessage bridge path, for builds that report directly ──────────
    const onMessage = (event: MessageEvent) => {
      const frameWindow = iframeRef.current?.contentWindow ?? null;
      const signal = parseGameplayMessage(
        { origin: event.origin, source: event.source, data: event.data },
        { hostOrigin: window.location.origin, gameId, frameWindow },
      );
      if (!signal) return;
      // Scope the build's run id to this mount, exactly as the adapter path does.
      const scoped: GameplaySignal =
        'runId' in signal && signal.runId
          ? ({ ...signal, runId: `${mountId}:${signal.runId}` } as GameplaySignal)
          : signal;
      foldWithStartDetection(scoped);
    };
    window.addEventListener('message', onMessage);

    // A hidden tab must not accrue time. Dropping the tick means the next
    // interval has no previous tick to price, so the gap is never credited.
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') lastTick = null;
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (timer) clearInterval(timer);
      window.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', onVisibility);
      writeJson(session(), key, state);
    };
    // Remounting the iframe (reloadKey) or changing game starts a new mount.
  }, [gameId, iframeRef, reloadKey]);
}

export const GAMEPLAY_POLL_MS = POLL_MS;
export const GAMEPLAY_ACTIVITY_TIMEOUT_MS = ACTIVITY_TIMEOUT_MS;
