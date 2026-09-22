/**
 * How much dead space the game is actually leaving us, measured.
 *
 * Rook's caption floats over the stage. That is safe on a build that
 * letterboxes itself — Nightclub Showdown draws a 390x136 canvas at 390pt and
 * centres it, leaving most of the screen unused — and it is not safe at all on
 * a build that fills the stage, where the same overlay sits on live controls.
 * The first version assumed the letterbox was always there. It is not.
 *
 * So we measure rather than assume, and we fail toward not covering anything:
 *
 *   - A same-origin build (everything served through /gcs is same-origin) lets
 *     us read the drawn surface and compute the free band beneath it.
 *   - A cross-origin build, a frame that has not painted, or any read that
 *     throws, yields zero. Zero means the caption does not overlay at all: it
 *     stays in Rook's sheet, and the bar's own cell carries the speaking
 *     state. A player who wants the words can open the sheet; a player who
 *     wants to play is never covered on our guess.
 *
 * This module is deliberately pure so the rule can be tested without a
 * browser. The DOM reading lives in `bottomBandOfFrame`, which hands its
 * measurements to `bottomBandFrom`.
 */

/** A rectangle in stage coordinates. Only the parts we need. */
export type Rect = { top: number; height: number };

/** Smallest band worth using. Below this a caption would be clipped anyway. */
export const MIN_CAPTION_BAND = 44;

/**
 * Free space between the bottom of the drawn content and the bottom of the
 * stage. `null` for content means nothing could be measured, which is not the
 * same as "no free space measured" — both return 0 here, and that is the point:
 * the caller cannot tell them apart and must not act as if it can.
 */
export function bottomBandFrom(stageHeight: number, content: Rect | null): number {
  if (!content || stageHeight <= 0) return 0;
  if (content.height <= 0) return 0;
  const band = stageHeight - (content.top + content.height);
  if (!Number.isFinite(band) || band <= 0) return 0;
  return Math.floor(band);
}

/** Whether a caption may be drawn over the stage at all. */
export function captionMayOverlay(band: number): boolean {
  return band >= MIN_CAPTION_BAND;
}

/**
 * Reads the drawn surface out of a same-origin frame.
 *
 * Preference order is deliberate: a `<canvas>` is what an engine actually
 * paints, and its client rect is the drawn area even when the page around it
 * is full height. Only if there is no canvas do we fall back to the body's
 * content box. A build with several canvases (an engine plus an overlay) is
 * measured by the union, because covering the smaller one still covers the
 * game.
 *
 * Every access is guarded. A cross-origin frame throws on `contentDocument`,
 * and that throw must read as "unknown", never as "plenty of room".
 */
export function bottomBandOfFrame(iframe: HTMLIFrameElement | null, stageHeight: number): number {
  if (!iframe || stageHeight <= 0) return 0;
  let doc: Document | null = null;
  try {
    doc = iframe.contentDocument;
  } catch {
    return 0;
  }
  if (!doc || !doc.body) return 0;
  try {
    const canvases = Array.from(doc.querySelectorAll('canvas'));
    const painted = canvases.filter((c) => c.clientWidth > 0 && c.clientHeight > 0);
    if (painted.length > 0) {
      let top = Infinity;
      let bottom = -Infinity;
      for (const canvas of painted) {
        const rect = canvas.getBoundingClientRect();
        top = Math.min(top, rect.top);
        bottom = Math.max(bottom, rect.bottom);
      }
      if (!Number.isFinite(top) || !Number.isFinite(bottom)) return 0;
      // The frame fills the stage, so frame coordinates are stage coordinates.
      return bottomBandFrom(stageHeight, { top, height: bottom - top });
    }
    const body = doc.body.getBoundingClientRect();
    return bottomBandFrom(stageHeight, { top: body.top, height: body.height });
  } catch {
    return 0;
  }
}
