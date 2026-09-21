/**
 * Host player-stage geometry.
 *
 * The game iframe must keep a usable box through companion state, captions,
 * Chat/Invite sheets, recovery, and viewport changes. Companion chrome is
 * overlay; it must not become the iframe's sizing context.
 *
 * A collapsed box here means the host iframe (or its reported rectangle)
 * has fallen to the browser default 300×150, or otherwise lost most of the
 * viewport, while host chrome can still paint full-bleed. That is the
 * visible "tiny rectangle, upper left" failure.
 */

export const BROWSER_DEFAULT_IFRAME = { width: 300, height: 150 } as const;

export type PlayerBox = { width: number; height: number };

export type SizableFrame = {
  hasAttribute(name: string): boolean;
  removeAttribute(name: string): void;
  style: {
    width: string;
    height: string;
    removeProperty(name: string): void;
  };
};

/** True when a player box has collapsed relative to a still-usable viewport. */
export function isCollapsedPlayerBox(box: PlayerBox, viewport: PlayerBox): boolean {
  if (box.width <= 0 || box.height <= 0) return true;
  const defaultIframe =
    box.width <= BROWSER_DEFAULT_IFRAME.width + 8 &&
    box.height <= BROWSER_DEFAULT_IFRAME.height + 8;
  if (defaultIframe && (viewport.width > 480 || viewport.height > 400)) return true;
  if (viewport.width >= 700 && box.width < viewport.width * 0.35) return true;
  if (viewport.height >= 360 && box.height < viewport.height * 0.35) return true;
  return false;
}

/**
 * Strip width/height attributes and inline sizes an in-frame script can set
 * on the host iframe via `window.frameElement`. CSS then owns the box.
 * Returns whether anything was removed.
 */
export function clearHostileIframeSizing(iframe: SizableFrame): boolean {
  let changed = false;
  if (iframe.hasAttribute('width')) {
    iframe.removeAttribute('width');
    changed = true;
  }
  if (iframe.hasAttribute('height')) {
    iframe.removeAttribute('height');
    changed = true;
  }
  if (iframe.style.width) {
    iframe.style.removeProperty('width');
    changed = true;
  }
  if (iframe.style.height) {
    iframe.style.removeProperty('height');
    changed = true;
  }
  return changed;
}
