'use client';

/**
 * DOM wiring for the cross-origin engagement adapter.
 *
 * Mounted alongside the game iframe on `/games/[id]` for games that have
 * NO same-origin adapter. Silent when a verified adapter exists — Nightclub
 * v2 and Flappy v9 already have build-authoritative measurement, and running
 * this on top would double-count engagement.
 *
 * All state lives in refs. Only DOM plumbing is here; the accumulator
 * arithmetic and threshold logic live in lib/cross-origin-engagement.ts so
 * they can be tested without a browser.
 *
 * QA policy: this component uses trackCampaignEvent, which tags every send
 * with app_env and traffic_kind from lib/qa-traffic.ts. Preview / marked-QA
 * traffic still emits (Hexclave will see it and classify it), but the ad-
 * platform pixel gate keeps these away from Meta / TikTok. Only the four
 * VERIFIED_GAMEPLAY_EVENTS ever reach the pixels; these proxies never do.
 */

import { useEffect, useRef } from 'react';
import {
  CAMPAIGN_EVENTS,
  trackCampaignEvent,
} from '@/lib/campaign-analytics';
import { gameSignalAdapter } from '@/lib/game-adapters';
import {
  ACTIVE_INPUT_WINDOW_MS,
  CROSS_ORIGIN_EVENTS,
  DWELL_THRESHOLDS_MS,
  ENGAGEMENT_TICK_MS,
  INTERSECT_THRESHOLD,
  bounceReasonAtUnload,
  dwellEventName,
  initialEngagementState,
  tickAccumulator,
} from '@/lib/cross-origin-engagement';

type Props = {
  gameId: string;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
};

export function CrossOriginEngagementProbe({ gameId, iframeRef }: Props) {
  // Refs so the effect body sees the latest without adding them to deps.
  const stateRef = useRef(initialEngagementState());
  const onScreenRef = useRef(false);
  const lastInputAtRef = useRef<number | null>(null);
  const lastTickAtRef = useRef<number | null>(null);

  useEffect(() => {
    // If a same-origin adapter exists for this game, do nothing — the
    // build-authoritative signal is strictly better than parent-side proxies.
    if (gameSignalAdapter(gameId)) return;

    const state = stateRef.current;
    const iframe = iframeRef.current;
    if (!iframe) return;

    // The `now` we use everywhere: monotonic, unaffected by clock changes.
    const now = () => performance.now();

    // ─── Iframe lifecycle ────────────────────────────────────────────────
    const onIframeLoad = () => {
      state.iframeLoaded = true;
    };
    // The iframe's load may fire before we attach; check readyState.
    if (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (iframe as any).complete ||
      iframe.contentDocument?.readyState === 'complete'
    ) {
      state.iframeLoaded = true;
    }
    iframe.addEventListener('load', onIframeLoad);

    // ─── First tap on the iframe area = iframe_engaged ────────────────────
    // pointerdown fires on the parent BEFORE the iframe consumes the event,
    // so the target is still the iframe DOM node when we handle it. We use
    // capture-phase so a stopPropagation later in the tree can't hide it.
    const onParentPointerDown = (event: PointerEvent) => {
      lastInputAtRef.current = now();
      if (state.iframeEngaged) return;
      const target = event.target as Element | null;
      if (!target) return;
      if (target === iframe || iframe.contains(target)) {
        state.iframeEngaged = true;
        trackCampaignEvent(CAMPAIGN_EVENTS.iframeEngaged, {
          game_id: gameId,
          companion_state: 'idle',
          outcome: 'ok',
        });
      }
    };
    // Any parent-level input refreshes the active window. Cheap; refs only.
    const bumpInput = () => {
      lastInputAtRef.current = now();
    };

    document.addEventListener('pointerdown', onParentPointerDown, true);
    document.addEventListener('pointermove', bumpInput, { passive: true });
    document.addEventListener('touchstart', bumpInput, { passive: true });
    document.addEventListener('keydown', bumpInput);

    // ─── Visibility × intersection = "on screen" ─────────────────────────
    const recomputeOnScreen = (intersecting: boolean | null) => {
      const visible = document.visibilityState === 'visible';
      // If the observer hasn't fired yet, assume intersecting so we don't
      // undercount the boot moment. It'll correct itself on first callback.
      const inView = intersecting ?? true;
      onScreenRef.current = visible && inView;
    };
    let lastIntersecting: boolean | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.target !== iframe) continue;
          lastIntersecting = e.intersectionRatio >= INTERSECT_THRESHOLD;
          recomputeOnScreen(lastIntersecting);
        }
      },
      { threshold: [INTERSECT_THRESHOLD] },
    );
    observer.observe(iframe);
    const onVisibilityChange = () => recomputeOnScreen(lastIntersecting);
    document.addEventListener('visibilitychange', onVisibilityChange);
    recomputeOnScreen(null);

    // ─── The tick ────────────────────────────────────────────────────────
    lastTickAtRef.current = now();
    const timer = window.setInterval(() => {
      const t = now();
      const last = lastTickAtRef.current ?? t;
      lastTickAtRef.current = t;
      const delta = Math.max(0, t - last);
      const active =
        onScreenRef.current &&
        lastInputAtRef.current != null &&
        t - lastInputAtRef.current <= ACTIVE_INPUT_WINDOW_MS;
      const crossed = tickAccumulator(state, delta, active);
      for (const threshold of crossed) {
        const name = dwellEventName(threshold);
        if (!name) continue;
        trackCampaignEvent(name, {
          game_id: gameId,
          companion_state: 'idle',
          outcome: 'ok',
        });
      }
    }, ENGAGEMENT_TICK_MS);

    // ─── Bounce reporting on unload ──────────────────────────────────────
    // pagehide is the reliable one on iOS Safari; visibilitychange→hidden
    // covers Android backgrounding. beforeunload fires on desktop close.
    // We may fire from more than one — every path routes through emitBounce
    // which is idempotent on the same reason.
    let bounceEmitted = false;
    const emitBounce = () => {
      if (bounceEmitted) return;
      const reason = bounceReasonAtUnload(state);
      if (!reason) return;
      bounceEmitted = true;
      trackCampaignEvent(CAMPAIGN_EVENTS.sessionBounce, {
        game_id: gameId,
        companion_state: 'idle',
        outcome: reason,
      });
    };
    const onPageHide = () => emitBounce();
    const onBeforeUnload = () => emitBounce();
    const onVisibilityHiddenBounce = () => {
      // Only treat "hidden" transitions as unload candidates on mobile — a
      // desktop user Alt-Tabbing shouldn't bounce them. iOS Safari fires
      // visibilitychange→hidden reliably on close; pagehide follows if the
      // page is destroyed. Emit on hidden anyway — emitBounce is idempotent
      // and the reason will not change.
      if (document.visibilityState === 'hidden') emitBounce();
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibilityHiddenBounce);

    return () => {
      window.clearInterval(timer);
      iframe.removeEventListener('load', onIframeLoad);
      document.removeEventListener('pointerdown', onParentPointerDown, true);
      document.removeEventListener('pointermove', bumpInput);
      document.removeEventListener('touchstart', bumpInput);
      document.removeEventListener('keydown', bumpInput);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      document.removeEventListener('visibilitychange', onVisibilityHiddenBounce);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      observer.disconnect();
      // Route unmount through bounce path: SPA navigation away is also a
      // session end for this game×visit.
      emitBounce();
    };
  }, [gameId, iframeRef]);

  // No DOM output — the probe is invisible.
  return null;
}

// Re-export the event names so a report can grep for them from one place.
export { CROSS_ORIGIN_EVENTS, DWELL_THRESHOLDS_MS };
