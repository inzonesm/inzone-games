/**
 * Cross-origin engagement — parent-side proxies for games we cannot read
 * from the inside.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * `lib/game-adapters.ts` gives us verified gameplay only for builds served
 * same-origin through `/gcs/` (Nightclub v2, Flappy v9). Four of the five
 * flagship titles are hosted cross-origin (CrazyGames CDN etc.); we cannot
 * reach into their `window` object, so we cannot emit `game_start`,
 * `engaged_play`, `first_game_over`, or `return_play` for them. Those events
 * are load-bearing under the CLAUDE.md contract — a build must report its
 * own state before any of them fires.
 *
 * But we can measure engagement PROXIES from the parent document — signals
 * that describe "someone is here, they touched the game area, they stayed
 * with the tab visible for N seconds." These NEVER masquerade as verified
 * gameplay. They ship under distinct event names so a reader of a report
 * cannot confuse the two.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROXY EVENTS EMITTED
 *
 *   iframe_engaged
 *     First `pointerdown` on the parent whose target is (or is inside) the
 *     game iframe DOM node, after the iframe's `load` event fired. Fires
 *     once per (visit × game). This is the strongest "the user actually
 *     touched this game" signal we can get from outside the build.
 *
 *   foreground_dwell_15s
 *     Cumulative time in this visit×game where ALL of these hold:
 *       - document.visibilityState === 'visible'
 *       - iframe intersects ≥ INTERSECT_THRESHOLD of the viewport
 *       - a parent-level pointer/touch/key event fired within
 *         ACTIVE_INPUT_WINDOW_MS
 *     reached 15,000 ms for the first time.
 *
 *   foreground_dwell_60s
 *     Same accumulator, threshold at 60,000 ms. This is the natural sibling
 *     of `engaged_play` but is explicitly a proxy — the accumulator uses
 *     parent-side signals, not build state, and its name is different so a
 *     report never counts these as verified engaged players.
 *
 *   session_bounce
 *     Emitted on page-unload / pagehide if `iframe_engaged` never fired.
 *     The user arrived, we mounted, and they left without ever touching
 *     the game frame. Anchored by iframe load: if the iframe never fired
 *     `load` either, bounce still fires — that's an even worse bounce and
 *     the data carries the reason.
 *
 * None of these are in `VERIFIED_GAMEPLAY_EVENTS`. None reach Meta or
 * TikTok's pixel. The load-bearing contract in `lib/gameplay-signals.ts`
 * is untouched.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE HEURISTIC IS TRUSTWORTHY, WITHIN THE STATED LIMITS
 *
 * The parent-side signal cannot see events INSIDE the iframe (that's the
 * whole point of cross-origin isolation). What it CAN see:
 *
 *   - A pointerdown whose target is the iframe DOM node fires on the parent
 *     BEFORE the iframe consumes the event. This is a real signal that the
 *     user aimed at the game.
 *   - Visibility, intersection, and page-lifecycle events fire regardless
 *     of iframe origin — same document.
 *   - The user's periodic scroll / tap / key on the parent chrome (the
 *     action bar, Rook, the chat sheet) tells us the tab is being used.
 *     A user who stops moving for 8 seconds while the iframe is on screen
 *     is either idle in the game or has walked away; the accumulator
 *     treats both as "not credited" and errs toward under-counting.
 *
 * This module is pure logic. All DOM plumbing lives in
 * `components/CrossOriginEngagementProbe.tsx` so this file stays testable
 * without a browser.
 */

/** How much of the iframe must be visible to count as "on screen". */
export const INTERSECT_THRESHOLD = 0.5;

/**
 * The accumulator counts "user is engaged" while a parent-level input event
 * fired within this window. On desktop the mouse is usually moving on the
 * chrome; on mobile the user is tapping the action bar / Rook / the frame
 * boundary. Users who go idle for 8+ seconds while the game plays are not
 * credited — this errs toward under-counting.
 */
export const ACTIVE_INPUT_WINDOW_MS = 8000;

/** Poll cadence for the accumulator. */
export const ENGAGEMENT_TICK_MS = 500;

/** Thresholds we emit an event at. */
export const DWELL_THRESHOLDS_MS = [15_000, 60_000] as const;

/** Event names — see the module comment for exact semantics. */
export const CROSS_ORIGIN_EVENTS = {
  iframeEngaged: 'iframe_engaged',
  foregroundDwell15s: 'foreground_dwell_15s',
  foregroundDwell60s: 'foreground_dwell_60s',
  sessionBounce: 'session_bounce',
} as const;

export type CrossOriginEventName =
  (typeof CROSS_ORIGIN_EVENTS)[keyof typeof CROSS_ORIGIN_EVENTS];

/**
 * Reasons a `session_bounce` can fire. The report is honest about which
 * failure mode we're looking at.
 */
export type BounceReason =
  | 'no_frame_load' // Iframe never fired `load` before unload.
  | 'no_engagement'; // Frame loaded but the user never tapped it.

export type EngagementInputs = {
  /** performance.now() at the moment being evaluated. */
  now: number;
  /** True while the tab is visible AND the iframe intersects the viewport. */
  onScreen: boolean;
  /** Timestamp of the last parent-level input event we observed. */
  lastInputAt: number | null;
};

/** Decide whether to credit the current tick. Pure. */
export function isActiveTick(input: EngagementInputs): boolean {
  if (!input.onScreen) return false;
  if (input.lastInputAt == null) return false;
  return input.now - input.lastInputAt <= ACTIVE_INPUT_WINDOW_MS;
}

/**
 * State the accumulator carries between ticks. Kept as plain data so the
 * probe can save/restore it cheaply if we ever add a visit-boundary hook.
 */
export type EngagementState = {
  /** Wall-clock ms accumulated as "active" since the accumulator started. */
  activeAccumMs: number;
  /** Which threshold events have already fired this visit×game. */
  firedThresholds: Set<number>;
  /** Did we ever see a pointerdown target the iframe? */
  iframeEngaged: boolean;
  /** Did the iframe's `load` event fire? */
  iframeLoaded: boolean;
};

export function initialEngagementState(): EngagementState {
  return {
    activeAccumMs: 0,
    firedThresholds: new Set(),
    iframeEngaged: false,
    iframeLoaded: false,
  };
}

/**
 * Advance the accumulator by `deltaMs` if the tick counts. Returns the list
 * of dwell thresholds crossed on this tick, in the order they fired. The
 * probe emits an event per threshold.
 */
export function tickAccumulator(
  state: EngagementState,
  deltaMs: number,
  active: boolean,
): number[] {
  if (!active || deltaMs <= 0) return [];
  const before = state.activeAccumMs;
  state.activeAccumMs = before + deltaMs;
  const crossed: number[] = [];
  for (const threshold of DWELL_THRESHOLDS_MS) {
    if (
      before < threshold &&
      state.activeAccumMs >= threshold &&
      !state.firedThresholds.has(threshold)
    ) {
      state.firedThresholds.add(threshold);
      crossed.push(threshold);
    }
  }
  return crossed;
}

/**
 * Compute the bounce reason at page-unload time. Returns null when no
 * bounce should be emitted (the user genuinely engaged with the frame).
 */
export function bounceReasonAtUnload(state: EngagementState): BounceReason | null {
  if (state.iframeEngaged) return null;
  return state.iframeLoaded ? 'no_engagement' : 'no_frame_load';
}

/**
 * Map a dwell threshold in ms to its event name. Used by the probe when
 * deciding what to emit for a crossed threshold.
 */
export function dwellEventName(thresholdMs: number): CrossOriginEventName | null {
  switch (thresholdMs) {
    case 15_000:
      return CROSS_ORIGIN_EVENTS.foregroundDwell15s;
    case 60_000:
      return CROSS_ORIGIN_EVENTS.foregroundDwell60s;
    default:
      return null;
  }
}
