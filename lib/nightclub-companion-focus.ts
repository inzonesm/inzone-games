/**
 * First-party Nightclub focus hold.
 *
 * Inspected v2 (`dn.heaps.GameFocusHelper`): the engine suspends when
 * `hxd.Window.get_isFocused()` is false. That flag follows #webgl blur.
 * Parent companion chrome and SpeechRecognition live in the host document,
 * so they blur the iframe canvas and show “PAUSED - click anywhere to resume”
 * even though the player did not pause.
 *
 * While the host marks a live voice session and is not showing Invite/Chat
 * and the tab is visible, get_isFocused reports true. That prevents a new
 * focus-loss suspend. It does not call resume, click the canvas, or clear
 * cinematic / game-over / an already-shown pause overlay.
 *
 * Safari SpeechRecognition is not the architecture defect. The owner
 * recording on kvh0n8c7y showed LISTENING while Nightclub displayed the
 * GameFocusHelper overlay — recognition had started. webkitSpeechRecognition
 * exists. Do not replace STT until a Safari capture failure is shown.
 */

declare global {
  interface Window {
    __inzoneCompanionHoldPlay?: boolean;
    __inzoneHostSheetOpen?: boolean;
    __inzoneCompanionFocus?: boolean;
  }
}

export const NIGHTCLUB_COMPANION_FOCUS_MARKER = '__inzoneCompanionFocus';
export const NIGHTCLUB_FOCUS_GAME_ID = 'nightclub-showdown-inzone-production';

export type CompanionHoldInput = {
  voiceHold: boolean;
  hostSheetOpen: boolean;
  visibilityState: string;
};

export function companionShouldHoldPlay(input: CompanionHoldInput): boolean {
  if (!input.voiceHold) return false;
  if (input.hostSheetOpen) return false;
  if (input.visibilityState === 'hidden') return false;
  return true;
}

export function setCompanionHoldPlay(hold: boolean): void {
  if (typeof window === 'undefined') return;
  window.__inzoneCompanionHoldPlay = hold === true;
}

export function setHostSheetOpen(open: boolean): void {
  if (typeof window === 'undefined') return;
  window.__inzoneHostSheetOpen = open === true;
}

const INSTALL_SOURCE = String.raw`
(function () {
  if (window.__inzoneCompanionFocus) return;
  window.__inzoneCompanionFocus = true;

  function hold() {
    try {
      if (document.visibilityState === 'hidden') return false;
      var parentWin = window.parent;
      if (!parentWin || parentWin === window) return false;
      if (parentWin.__inzoneHostSheetOpen) return false;
      return parentWin.__inzoneCompanionHoldPlay === true;
    } catch (e) {
      return false;
    }
  }

  function wrap(target) {
    if (!target || target.__inzoneHoldPlay) return !!(target && target.__inzoneHoldPlay);
    var original = target.get_isFocused;
    if (typeof original !== 'function') return false;
    target.__inzoneHoldPlay = true;
    target.get_isFocused = function () {
      if (hold()) return true;
      return original.call(this);
    };
    return true;
  }

  function patch() {
    try {
      var hx = window.$hxClasses;
      if (hx && hx['hxd.Window'] && hx['hxd.Window'].prototype) wrap(hx['hxd.Window'].prototype);
      var boot = window.__NightclubRuntime && window.__NightclubRuntime.Boot;
      var inst = boot && boot.ME && boot.ME.s2d && boot.ME.s2d.window;
      if (inst) {
        try { wrap(Object.getPrototypeOf(inst)); } catch (e) { /* proto may be null */ }
        if (wrap(inst)) return true;
      }
      return !!(hx && hx['hxd.Window'] && hx['hxd.Window'].prototype && hx['hxd.Window'].prototype.__inzoneHoldPlay);
    } catch (e) {
      return false;
    }
  }

  if (patch()) return;
  var timer = setInterval(function () {
    if (patch()) clearInterval(timer);
  }, 250);
})();
`;

export function nightclubCompanionFocusScript(): string {
  return INSTALL_SOURCE.trim();
}

export type NightclubPauseSample = {
  mainPaused: boolean | null;
  iframeFocused: boolean | null;
  overlay: boolean | null;
  hold: boolean;
  visibility: string;
};

/** Pause-reason sample. Timestamps only — never conversation text. */
export function sampleNightclubPause(frame: HTMLIFrameElement | null): NightclubPauseSample {
  const hold = companionShouldHoldPlay({
    voiceHold: typeof window !== 'undefined' && window.__inzoneCompanionHoldPlay === true,
    hostSheetOpen: typeof window !== 'undefined' && window.__inzoneHostSheetOpen === true,
    visibilityState: typeof document !== 'undefined' ? document.visibilityState : 'visible',
  });
  const visibility = typeof document !== 'undefined' ? document.visibilityState : 'visible';
  if (!frame) {
    return { mainPaused: null, iframeFocused: null, overlay: null, hold, visibility };
  }
  try {
    const win = frame.contentWindow as Window & {
      __NightclubRuntime?: {
        Main?: { ME?: { paused?: unknown } };
        Boot?: { ME?: { s2d?: { window?: { get_isFocused?: () => unknown } } } };
      };
      document?: Document;
    } | null;
    if (!win) {
      return { mainPaused: null, iframeFocused: null, overlay: null, hold, visibility };
    }
    const runtime = win.__NightclubRuntime;
    const mainPaused = runtime?.Main?.ME?.paused;
    const hxWindow = runtime?.Boot?.ME?.s2d?.window;
    const iframeFocused =
      typeof hxWindow?.get_isFocused === 'function'
        ? hxWindow.get_isFocused() === true
        : typeof win.document?.hasFocus === 'function' ? win.document.hasFocus() : null;
    const text = String(win.document?.body?.innerText || '');
    const overlay = /PAUSED/i.test(text);
    return {
      mainPaused: typeof mainPaused === 'boolean' ? mainPaused : null,
      iframeFocused,
      overlay,
      hold,
      visibility,
    };
  } catch {
    return { mainPaused: null, iframeFocused: null, overlay: null, hold, visibility };
  }
}

export function formatPauseSample(sample: NightclubPauseSample): string {
  const paused =
    sample.overlay === true ? 'overlay'
      : sample.mainPaused === true ? 'main_paused'
        : sample.mainPaused === false && sample.overlay === false ? 'running'
          : 'unknown';
  const focus =
    sample.iframeFocused === true ? 'iframe_focus'
      : sample.iframeFocused === false ? 'iframe_blur'
        : 'iframe_unknown';
  return `${paused},${focus},${sample.hold ? 'hold' : 'no_hold'},${sample.visibility}`;
}

export function nightclubCompanionFocusTag(): string {
  return `<script id="${NIGHTCLUB_COMPANION_FOCUS_MARKER}">${nightclubCompanionFocusScript()}</script>`;
}
