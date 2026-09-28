/**
 * Rook discoverability hint — one-shot per visit×game.
 *
 * The problem this exists to solve: Rook's intro only fires when a user
 * taps the voice button. On the two high-traffic cross-origin games
 * (Escape Road, Elytra Flight) users bounce inside 1s, so they never tap.
 * Rook is technically enabled and getting zero engagement.
 *
 * This module governs a tiny silent "Ask Rook" callout that appears once
 * per session per game, gestures to the Rook chip, and auto-dismisses.
 * NO audio (audio requires a gesture anyway). NO gameplay claim (Rook is
 * not gameplay). Nothing here says "get a hint" or "get help winning" —
 * it's a chat affordance, and the copy says so.
 *
 * Constraints:
 *   - `pointer-events: none` on the bubble. The bubble sits over the
 *     player chrome; it must not steal a tap the user meant for a game
 *     control or for the Rook chip itself.
 *   - Only on games with NO same-origin adapter. Adapter games
 *     (Nightclub, Flappy) have their own discovery affordances and
 *     lower bounce, so the hint is noise there.
 *   - One-shot per sessionStorage key. A page refresh in the same tab
 *     does not re-fire. A new tab does. No cross-visit persistence.
 *   - Auto-dismiss after HINT_LIFETIME_MS or on ANY interaction that
 *     the user could plausibly interpret as answering the hint (chip
 *     tap, voice-enable, sheet open, mute, menu).
 */

/** The chip's callout copy. Short, single-line. */
export const ROOK_HINT_COPY = 'Ask Rook';

/** How long the bubble stays on screen before fading, in ms. */
export const HINT_LIFETIME_MS = 6_000;

/** Delay after mount before showing the bubble, in ms. Gives the game
 *  chrome time to settle so the callout doesn't paint on top of a
 *  loading spinner. */
export const HINT_DELAY_MS = 2_000;

/** SessionStorage key prefix. The rest is the game id. */
export const HINT_STORAGE_PREFIX = 'inzone.rook.hint.';

/** Event name emitted through trackCampaignEvent when the hint appears. */
export const HINT_EVENT_NAME = 'companion_hint_shown';

/**
 * Decide, from ambient state, whether the hint SHOULD appear for this
 * (visit × game). Pure — the caller reads sessionStorage and passes the
 * boolean in.
 */
export function shouldShowRookHint(input: {
  /** Whether Rook is enabled at all for this game (isFlagshipId). */
  rookEnabled: boolean;
  /** Whether this game has a same-origin adapter — those don't need the hint. */
  hasSameOriginAdapter: boolean;
  /** Whether the user already tapped voice-on — they know Rook exists. */
  voiceEnabled: boolean;
  /** True if the sessionStorage key for this game has been set. */
  alreadyShown: boolean;
  /** Iframe finished loading (avoid painting over a boot spinner). */
  frameLoaded: boolean;
}): boolean {
  if (!input.rookEnabled) return false;
  if (input.hasSameOriginAdapter) return false;
  if (input.voiceEnabled) return false;
  if (input.alreadyShown) return false;
  if (!input.frameLoaded) return false;
  return true;
}

/** Read the sessionStorage flag. Returns false when storage is unavailable. */
export function readHintShown(gameId: string): boolean {
  try {
    if (typeof window === 'undefined') return false;
    return window.sessionStorage.getItem(`${HINT_STORAGE_PREFIX}${gameId}`) === '1';
  } catch {
    return false;
  }
}

/** Persist that the hint has been shown for this game. Silent on failure. */
export function markHintShown(gameId: string): void {
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(`${HINT_STORAGE_PREFIX}${gameId}`, '1');
  } catch {
    /* private-mode or blocked storage — the hint just re-shows next mount */
  }
}
