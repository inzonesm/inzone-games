/**
 * What the one persistent bar carries, and in what order.
 *
 * The bar is the only surface on the player that permanently costs the game
 * space (see "The player layout contract" in CLAUDE.md), so what sits in it is
 * a budget decision, not a styling one. Seven equal cells at 390pt measured
 * 52px each — above a touch target, but every one of them competing for the
 * same glance. A phone gets the three things this product is actually for:
 *
 *   1. Rook and the microphone state, because that is the differentiator and
 *      because a player must always be able to see whether they are live.
 *   2. Chat and Invite, carrying real conversation state — a Chat cell that
 *      looks identical whether or not someone is in the room is a lie the
 *      player only discovers by tapping.
 *   3. Navigation: leaving, and changing game.
 *
 * Everything else moves behind More. Nothing is removed: a secondary action is
 * one tap further away, never gone, and `assertNothingLost` in the tests holds
 * that line.
 *
 * A wide viewport has room for the whole set at once, so it gets the whole set
 * and no More menu. One definition, two presentations.
 */

export type PlayerActionId =
  | 'rook'
  | 'chat'
  | 'invite'
  | 'games'
  | 'home'
  | 'replay'
  | 'like'
  | 'comments'
  | 'share'
  | 'app'
  | 'fill';

export type PlayerLayout = 'touch' | 'wide';

/** Display order, most-used first. The bar and the More sheet both read it. */
export const PLAYER_ACTION_ORDER: readonly PlayerActionId[] = [
  'rook',
  'chat',
  'invite',
  'games',
  'home',
  'replay',
  'like',
  'comments',
  'share',
  'app',
  'fill',
] as const;

/**
 * The cells a touch layout shows without a second tap. Five plus the More cell
 * itself is six, which measured 63px each at 390pt — comfortably above a touch
 * target and legible at a glance, where seven was 52px and crowded.
 */
export const TOUCH_PRIMARY: readonly PlayerActionId[] = ['rook', 'chat', 'invite', 'games', 'home'] as const;

export type PlayerActionSplit = {
  /** Rendered directly in the bar. */
  primary: PlayerActionId[];
  /** Rendered inside More. Empty on a wide layout, which shows everything. */
  secondary: PlayerActionId[];
  /** Whether the bar needs a More cell at all. */
  needsMore: boolean;
};

/**
 * `available` lets the caller drop an action that genuinely does not apply to
 * this visit — fill screen on a game with no measured orientation gain, or
 * changing game when the catalogue has not loaded. An unavailable action is
 * absent from both lists rather than present and dead, because a disabled cell
 * spends the same space as a live one and teaches the player nothing.
 */
export function splitPlayerActions(
  layout: PlayerLayout,
  available: (id: PlayerActionId) => boolean = () => true,
): PlayerActionSplit {
  const shown = PLAYER_ACTION_ORDER.filter(available);
  if (layout === 'wide') {
    return { primary: [...shown], secondary: [], needsMore: false };
  }
  const primary = shown.filter((id) => TOUCH_PRIMARY.includes(id));
  const secondary = shown.filter((id) => !TOUCH_PRIMARY.includes(id));
  return { primary, secondary, needsMore: secondary.length > 0 };
}

/** How many cells the bar renders, counting More. Used by the layout tests. */
export function barCellCount(split: PlayerActionSplit): number {
  return split.primary.length + (split.needsMore ? 1 : 0);
}
