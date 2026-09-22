/**
 * Fill screen — the opt-in landscape stage for a portrait phone.
 *
 * Why this exists. A landscape-canvas game on a portrait phone is bound by
 * width, not by our chrome. Nightclub Showdown at 390pt gets a 390x136 canvas
 * (see the measurement recorded in app/globals.css) and centres it in its own
 * page, which is where the black band above and below the strip comes from —
 * it is inside the iframe, not host chrome. Removing every pixel of host
 * chrome returns ~58px to a screen whose game is already width-bound, so it
 * buys nothing. Handing the game a landscape viewport buys roughly 6x:
 * 390x136 (53k px) becomes about 844x390 minus the bar (~308k px).
 *
 * Why it is opt-in. Rotating the stage is a real trade. A build that reads
 * `screen.orientation`, or renders portrait-specific UI, can be made worse by
 * it, and we cannot verify every build in the catalogue. So the player asks
 * for it and the player can undo it. Nothing rotates on its own.
 *
 * Why only some games are offered it. `lib/game-controls.ts` already records
 * `orientationHint` and that field is documented as "set only when a layout
 * measurably gives the game more room" — a verified measurement, not a genre
 * guess. That is the gate. A game nobody has measured is not offered the
 * control, which is the same policy the rest of this codebase applies to
 * gameplay signals: a smaller honest surface beats an invented one.
 */

/** Copy for the control. One verb each way, no jargon. */
export const FILL_SCREEN_COPY = {
  fill: 'Fill screen',
  restore: 'Fit to phone',
  fillLabel: 'Rotate the game to fill the screen',
  restoreLabel: 'Return the game to portrait',
} as const;

/**
 * The rotated stage sizes itself from the stage's own box with `cqw`/`cqh`,
 * which needs size containment. Older engines keep the portrait layout rather
 * than a half-applied rotation, so the control is hidden instead of broken.
 */
export function canFillScreen(cssSupports?: (property: string, value: string) => boolean): boolean {
  const supports = cssSupports
    ?? (typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
      ? (property: string, value: string) => CSS.supports(property, value)
      : null);
  if (!supports) return false;
  try {
    return supports('container-type', 'size');
  } catch {
    return false;
  }
}

/**
 * Offer the control only where it is both useful and measured: a narrow
 * portrait viewport, a build whose `orientationHint` records that a sideways
 * layout gave it more room, and an engine that can render the rotated stage.
 */
export function fillScreenOffered(input: {
  hasOrientationHint: boolean;
  portrait: boolean;
  narrow: boolean;
  supported: boolean;
  frameReady: boolean;
}): boolean {
  return (
    input.hasOrientationHint
    && input.portrait
    && input.narrow
    && input.supported
    && input.frameReady
  );
}

/**
 * When the rotated player must give the screen back.
 *
 * Two cases, both of which produce something worse than the problem the
 * rotation solves:
 *
 *   - The phone is already landscape. The player has the space; rotating on
 *     top of that is a second 90 degrees, and the game ends up upside down in
 *     a portrait-shaped box. Physical rotation must undo the control, not
 *     compound it.
 *   - A sheet with a text input is open. Chat is typed into, and a rotated
 *     field with an upright system keyboard is not usable. The sheets sit
 *     outside the transformed element — a transform makes the transformed box
 *     the containing block for fixed descendants, so anything inside it would
 *     rotate with the game, and anything outside it stays upright over a
 *     sideways picture. Neither reads. Un-rotating keeps the frame mounted and
 *     only resizes the game, which every build already handles.
 */
export function shouldExitFillScreen(input: { portrait: boolean; textSheetOpen: boolean }): boolean {
  return !input.portrait || input.textSheetOpen;
}
