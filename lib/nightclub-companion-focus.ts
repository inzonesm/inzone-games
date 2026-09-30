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

/**
 * A touch on the canvas is focus, as a click already is.
 *
 * The iPhone-landscape "PAUSED - click anywhere to resume" that never resumed.
 * Inspected v2: hxd.Window tracks focus from the #webgl canvas's own
 * focus/blur events, and GameFocusHelper re-suspends within 0.2 s whenever
 * `get_isFocused()` is false. A mouse click focuses the tabindex canvas — which
 * is why every automated run resumed. But hxd.Window.onTouchStart calls
 * `e.preventDefault()`, which cancels the compatibility mousedown a touch
 * screen would synthesise, so a tap NEVER focuses the canvas. After any blur
 * (rotation, the host bar, a system sheet) the tap resumes via the overlay's
 * own onPush, the next check finds focus still false, and the game pauses
 * again: a paused screen that eats every tap.
 *
 * This restores what the mouse path already does, for a touch that lands on
 * the canvas itself: focus the canvas and tell the engine it has focus. It
 * does not resume, click or unpause anything — the player's own tap does that,
 * through the build's own overlay. Runs in capture so the engine reads focus
 * before it handles the same touch.
 *
 * It also moves the engine's pointer to the touch (see `pointAt` below): the
 * other half of "a tap does what a click does". Without it a phone reached the
 * game and then every tap on the floor or an enemy was action None, because
 * the engine resolved it at (0,0). Verified on the production build with
 * touch-only Chromium: four taps were None,None,None,None and the hero stayed
 * put; with the pointer moved they were Move and GrabMob and the hero walked.
 */
export const NIGHTCLUB_TOUCH_FOCUS_MARKER = '__inzoneTouchFocus';

const TOUCH_FOCUS_SOURCE = String.raw`
(function () {
  if (window.__inzoneTouchFocus) return;
  window.__inzoneTouchFocus = true;
  function engineWindow() {
    try {
      var boot = window.__NightclubRuntime && window.__NightclubRuntime.Boot;
      var inst = boot && boot.ME && boot.ME.s2d && boot.ME.s2d.window;
      if (inst) return inst;
      var hx = window.$hxClasses;
      return (hx && hx['hxd.Window'] && hx['hxd.Window'].inst) || null;
    } catch (e) {
      return null;
    }
  }
  // Where the finger is, as a mouse move already reports. The engine's
  // Game.onMouseDown resolves every push through getMouse() ->
  // hxd.Window.get_mouseX/Y, which read curMouseX/curMouseY — fields only a
  // real mousemove writes. The touch path dispatches the push with the right
  // coordinates but never moves that pointer, and it cancels the
  // compatibility mouse events that would have. So on a touch-only device
  // every tap resolved at (0,0): action None, the hero never moved.
  function pointAt(e) {
    try {
      var canvas = document.getElementById('webgl');
      if (!canvas || e.target !== canvas) return false;
      var t = e.changedTouches && e.changedTouches[0];
      var w = engineWindow();
      if (!t || !w || typeof t.clientX !== 'number' || typeof t.clientY !== 'number') return true;
      w.curMouseX = t.clientX;
      w.curMouseY = t.clientY;
      return true;
    } catch (err) {
      return false;
    }
  }
  window.addEventListener('touchstart', function (e) {
    try {
      if (!pointAt(e)) return;
      if (document.visibilityState === 'hidden') return;
      var canvas = document.getElementById('webgl');
      if (document.activeElement !== canvas && typeof canvas.focus === 'function') {
        try { canvas.focus({ preventScroll: true }); } catch (x) { canvas.focus(); }
      }
      var w = engineWindow();
      if (w && typeof w.onFocus === 'function' && w.focused !== true) w.onFocus(true);
    } catch (err) {}
  }, { capture: true, passive: true });
  window.addEventListener('touchmove', pointAt, { capture: true, passive: true });
  window.addEventListener('touchend', pointAt, { capture: true, passive: true });
})();
`;

/**
 * On-screen input log inside the game document — the device check for the
 * touch fix, on iOS Safari and in the Flutter WebView alike (the app loads the
 * raw build, so a host-side panel would never exist there).
 *
 * Opt-in only: `window.__inzoneDiag === true` (a debug app build sets it), or
 * `?inzoneDiag=1` on the host page away from production, matching
 * lib/resume-diagnostics.ts. `pointer-events: none`, so it takes no gesture
 * from the game. It shows event kinds, targets by tag/id and coordinates, the
 * engine's pointer, focus and pause flags, and the canvas / viewport /
 * safe-area boxes. It never reads text and has no transport.
 */
export const NIGHTCLUB_INPUT_DIAG_MARKER = '__inzoneInputDiag';

const INPUT_DIAG_SOURCE = String.raw`
(function () {
  if (window.__inzoneInputDiag) return;
  function enabled() {
    try {
      if (window.__inzoneDiag === true) return true;
      var p = window.parent;
      if (!p || p === window) return false;
      var host = String(p.location.hostname || '');
      if (/(^|\.)inzone\.games$/i.test(host)) return false;
      return /(^|[?&])inzoneDiag=1(&|$)/.test(String(p.location.search || ''));
    } catch (e) {
      return false;
    }
  }
  function start() {
    if (window.__inzoneInputDiag || !enabled() || !document.body) return;
    window.__inzoneInputDiag = true;
    var panel = document.createElement('pre');
    panel.setAttribute('aria-hidden', 'true');
    panel.style.cssText = 'position:fixed;left:env(safe-area-inset-left,0px);top:0;z-index:2147483647;margin:0;' +
      'padding:4px 6px;max-width:60vw;font:10px/1.25 monospace;color:#9f9;background:rgba(0,0,0,.72);' +
      'pointer-events:none;white-space:pre;';
    var probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);';
    document.body.appendChild(probe);
    document.body.appendChild(panel);
    var log = [];
    var t0 = Date.now();
    function name(t) {
      if (!t) return '-';
      if (t === window) return 'window';
      if (t === document) return 'document';
      return String(t.nodeName || '?').toLowerCase() + (t.id ? '#' + t.id : '');
    }
    function note(e) {
      var pt = (e.changedTouches && e.changedTouches[0]) || e;
      var xy = typeof pt.clientX === 'number' ? ' ' + Math.round(pt.clientX) + ',' + Math.round(pt.clientY) : '';
      log.push(((Date.now() - t0) / 1000).toFixed(1) + ' ' + e.type + ' ' + name(e.target) + xy);
      if (log.length > 10) log.shift();
    }
    ['touchstart', 'touchend', 'touchcancel', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'focus', 'blur', 'pagehide']
      .forEach(function (type) { window.addEventListener(type, note, { capture: true, passive: true }); });
    document.addEventListener('visibilitychange', function () {
      log.push(((Date.now() - t0) / 1000).toFixed(1) + ' visibility ' + document.visibilityState);
      if (log.length > 10) log.shift();
    }, true);
    function box(r) { return r ? Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) : '-'; }
    function render() {
      try {
        var R = window.__NightclubRuntime || {};
        var w = R.Boot && R.Boot.ME && R.Boot.ME.s2d && R.Boot.ME.s2d.window;
        var m = R.Main && R.Main.ME;
        var g = R.Game && R.Game.ME;
        var c = document.getElementById('webgl');
        var vv = window.visualViewport;
        var cs = getComputedStyle(probe);
        var h = g && g.heroHistory;
        var last = h && h.length ? h[h.length - 1] : null;
        panel.textContent = [
          'viewport ' + innerWidth + 'x' + innerHeight + (vv ? '  visual ' + Math.round(vv.width) + 'x' + Math.round(vv.height) + ' @' + Math.round(vv.offsetLeft) + ',' + Math.round(vv.offsetTop) : ''),
          'safe t' + cs.paddingTop + ' r' + cs.paddingRight + ' b' + cs.paddingBottom + ' l' + cs.paddingLeft + '  dpr ' + (window.__NC_REAL_DPR__ || '?') + '->' + window.devicePixelRatio,
          'canvas ' + (c ? box(c.getBoundingClientRect()) + ' backing ' + c.width + 'x' + c.height : '-'),
          'engine ptr ' + (w ? Math.round(w.curMouseX) + ',' + Math.round(w.curMouseY) + ' focused ' + w.focused : '-') +
            '  paused ' + (m ? m.paused : '-') + '  cine ' + (g && g.hasCinematic ? g.hasCinematic() : '-'),
          'actions ' + (h ? h.length : '-') + (last && last.a ? ' last#' + last.a._hx_index : '') + '  active ' + name(document.activeElement),
        ].concat(log).join('\n');
      } catch (e) {}
    }
    setInterval(render, 250);
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
`;

export function nightclubInputDiagScript(): string {
  return INPUT_DIAG_SOURCE.trim();
}

export function nightclubInputDiagTag(): string {
  return `<script id="${NIGHTCLUB_INPUT_DIAG_MARKER}-script">${nightclubInputDiagScript()}</script>`;
}

export function nightclubTouchFocusScript(): string {
  return TOUCH_FOCUS_SOURCE.trim();
}

export function nightclubTouchFocusTag(): string {
  return `<script id="${NIGHTCLUB_TOUCH_FOCUS_MARKER}-script">${nightclubTouchFocusScript()}</script>`;
}

export function nightclubCompanionFocusTag(): string {
  return `<script id="${NIGHTCLUB_COMPANION_FOCUS_MARKER}-script">${nightclubCompanionFocusScript()}</script>`;
}

/** Parent-side attach. The iframe injector can miss Boot.ME; the host can see it. */
export function attachNightclubFocusHold(frame: HTMLIFrameElement | null): boolean {
  if (!frame) return false;
  try {
    const win = frame.contentWindow as Window & {
      __NightclubRuntime?: {
        Boot?: { ME?: { s2d?: { window?: { get_isFocused?: () => unknown; __inzoneHoldPlay?: boolean } } } };
      };
    } | null;
    const inst = win?.__NightclubRuntime?.Boot?.ME?.s2d?.window;
    if (!inst || typeof inst.get_isFocused !== 'function') return false;
    if (inst.__inzoneHoldPlay) return true;
    const original = inst.get_isFocused.bind(inst);
    inst.__inzoneHoldPlay = true;
    inst.get_isFocused = function () {
      if (
        companionShouldHoldPlay({
          voiceHold: window.__inzoneCompanionHoldPlay === true,
          hostSheetOpen: window.__inzoneHostSheetOpen === true,
          visibilityState: document.visibilityState,
        })
      ) {
        return true;
      }
      return original();
    };
    return true;
  } catch {
    return false;
  }
}
