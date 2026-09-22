/**
 * The bar's inset, measured rather than guessed.
 *
 * `--rail-x` / `--rail-y` are the strips the action bar actually occupies, and
 * the stage is inset by them so the bar never sits on the game. They used to
 * be hardcoded — `--rail-y: 58px` on phones — which is a number that was true
 * on the day it was written. Seat one more cell in the bar, bump a caption's
 * font size, ship a device with a taller safe-area inset, and the bar quietly
 * grows past the number while the stage keeps believing it. Chromium at 390pt
 * measured the overlap at the moment Rook joined the row.
 *
 * A measured inset removes that whole class of bug: the contract holds for
 * whatever the bar ends up carrying, and nobody has to remember to update a
 * constant. The CSS values stay as the pre-hydration fallback.
 *
 * Measurements come from layout boxes (`offsetWidth` and friends), never from
 * `getBoundingClientRect`. Fill screen rotates the whole player, and a client
 * rect reports the rotated box — a bottom bar would read as an edge bar and
 * the inset would be reserved on the wrong axis.
 */

export type RailInset = { x: number; y: number };

/** The layout box of an element, unaffected by any transform above it. */
export type LayoutBox = { width: number; height: number; top: number; left: number };

/** Reads an element's layout box. Kept here so callers cannot reach for a client rect by habit. */
export function layoutBoxOf(el: HTMLElement): LayoutBox {
  return { width: el.offsetWidth, height: el.offsetHeight, top: el.offsetTop, left: el.offsetLeft };
}

/**
 * A bar spanning (near enough) the full width of the stage area is a bottom
 * bar and costs vertical space; anything else hugs an edge and costs
 * horizontal space. The 0.9 ratio keeps a full-bleed bar with rounding or a
 * hairline border on the horizontal branch.
 */
export function railInsetFrom(rail: LayoutBox, body: LayoutBox): RailInset {
  if (rail.width <= 0 || rail.height <= 0) return { x: 0, y: 0 };
  const horizontal = rail.width >= body.width * 0.9;
  /* Two readings of the same strip, and the inset takes the larger.
   *
   * `offsetTop` and `offsetLeft` round to the nearest integer, so a bar
   * painted at 779.5 reports 780 and the gap below it reads 64 while the bar
   * really occupies 64.5. The stage was inset by 64, and half a pixel of bar
   * sat on the bottom row of the game -- the same failure as the hardcoded
   * constant, one rounding mode further down. `offsetHeight` rounds the other
   * way (65 for the same bar), and the bar's own box is never smaller than
   * what it covers.
   *
   * Taking the larger of the two can only reserve more, never less, which is
   * the direction this is allowed to be wrong in: a pixel of letterbox costs
   * nothing and a pixel of bar over the game is the bug. Still layout boxes
   * throughout -- a client rect would read a rotated player's bottom bar as
   * an edge bar and reserve the wrong axis. */
  if (horizontal) {
    const gap = body.height - rail.top;
    return { x: 0, y: Math.max(0, Math.round(Math.max(gap, rail.height))) };
  }
  const gap = body.width - rail.left;
  return { x: Math.max(0, Math.round(Math.max(gap, rail.width))), y: 0 };
}
