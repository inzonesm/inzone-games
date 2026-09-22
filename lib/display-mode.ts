/**
 * Giving a landscape game more room, honestly.
 *
 * WHAT THE PREVIOUS VERSION GOT WRONG
 * -----------------------------------
 * "Fill screen" rotated the whole player 90° in CSS. The geometry was right,
 * the hit-testing was right, and on a physical iPhone it was still wrong:
 * Safari's own furniture — the status bar, the address bar, the toolbar — does
 * not rotate with a transformed element. The result is a sideways player
 * inside an upright browser, which is the same incoherence it was meant to
 * remove, relocated to the frame around it. A device recording showed exactly
 * that.
 *
 * CSS rotation is not fullscreen. It cannot remove browser chrome, it cannot
 * lock an orientation, and no amount of transform will make the notch turn.
 *
 * WHAT THIS DOES INSTEAD
 * ----------------------
 * Feature-test, then offer only what the browser can actually deliver:
 *
 *   - `elementFullscreen` — the Fullscreen API on an ordinary element. Where
 *     it exists, the browser removes its own chrome and the player really does
 *     get the screen. This is the only thing we call "Full screen".
 *   - `orientationLock` — `screen.orientation.lock`. Where it exists we ask
 *     for landscape once, inside the fullscreen gesture, and carry on without
 *     it if the request is refused. It is a bonus, never a requirement.
 *
 * Where neither exists — iPhone Safari today, which has no element fullscreen
 * and no orientation lock — the player keeps a stable portrait layout and the
 * game's own measured `orientationHint` is surfaced as a suggestion. Turning
 * the phone genuinely works there, because the browser re-lays out for real
 * and its chrome turns with it. A suggestion the player can act on beats a
 * control that half-works.
 *
 * Nothing here requires installation, and nothing claims a capability the
 * browser has not reported.
 */

export type DisplayCapabilities = {
  /** The Fullscreen API is callable on an ordinary element. */
  elementFullscreen: boolean;
  /** `screen.orientation.lock` exists. Its success is never assumed. */
  orientationLock: boolean;
};

export const DISPLAY_COPY = {
  enter: 'Full screen',
  exit: 'Exit full screen',
  enterLabel: 'Play full screen',
  exitLabel: 'Leave full screen',
} as const;

type FullscreenElement = Element & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
};

type FullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

/**
 * Reads what this browser can actually do. Every probe is a capability check
 * on a prototype, never a user-agent string: a UA test is a guess about a
 * browser, and this has to be a fact about the one in front of us.
 *
 * `fullscreenEnabled` matters as much as the method existing — an iframe
 * without `allowfullscreen`, or a policy that forbids it, reports the method
 * and refuses the call.
 */
export function detectDisplayCapabilities(win: Window | undefined = typeof window === 'undefined' ? undefined : window): DisplayCapabilities {
  if (!win) return { elementFullscreen: false, orientationLock: false };
  try {
    const doc = win.document as FullscreenDocument | undefined;
    const elementCtor = (win as Window & { Element?: { prototype?: unknown } }).Element;
    const proto = elementCtor?.prototype as FullscreenElement | undefined;
    const hasMethod = Boolean(proto && (typeof proto.requestFullscreen === 'function' || typeof proto.webkitRequestFullscreen === 'function'));
    const allowed = Boolean(doc && (doc.fullscreenEnabled === true || doc.webkitFullscreenEnabled === true));
    const orientation = (win.screen as Screen & { orientation?: { lock?: unknown } } | undefined)?.orientation;
    return {
      elementFullscreen: hasMethod && allowed,
      orientationLock: typeof orientation?.lock === 'function',
    };
  } catch {
    return { elementFullscreen: false, orientationLock: false };
  }
}

/**
 * Offer the control only where the browser can honour it, and only where it
 * buys the game something: a narrow viewport whose game has a measured
 * orientation gain. A wide desktop already has the room.
 */
export function fullscreenOffered(input: {
  capabilities: DisplayCapabilities;
  narrow: boolean;
  frameReady: boolean;
}): boolean {
  return input.capabilities.elementFullscreen && input.narrow && input.frameReady;
}

/**
 * Where fullscreen is unavailable, the honest alternative is the game's own
 * measured hint — and only where someone measured it. `lib/game-controls.ts`
 * documents `orientationHint` as set only when a sideways layout measurably
 * gave that build more room.
 */
export function orientationHintShown(input: {
  capabilities: DisplayCapabilities;
  hasOrientationHint: boolean;
  portrait: boolean;
  narrow: boolean;
  frameReady: boolean;
}): boolean {
  return (
    !input.capabilities.elementFullscreen
    && input.hasOrientationHint
    && input.portrait
    && input.narrow
    && input.frameReady
  );
}

/** Whether the document is currently in fullscreen, either spelling. */
export function isFullscreen(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): boolean {
  if (!doc) return false;
  const d = doc as FullscreenDocument;
  return Boolean(d.fullscreenElement || d.webkitFullscreenElement);
}
