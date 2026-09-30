/**
 * On-screen keys for builds that only listen to a keyboard.
 *
 * Some hosted builds were made for a desktop and draw no touch input at all:
 * Escape Road tells a phone "PRESS A, D OR ←,→ TO START" and ignores every tap
 * on its canvas, so on a phone it cannot even be started. These pads are the
 * missing keys, drawn inside the game's own document (never over the host
 * player) and only on a touch screen.
 *
 * What they do and do not do:
 *   - A pad sends the same keydown/keyup a physical key would, dispatched on
 *     the build's canvas so it bubbles through document and window — every
 *     place an engine may listen. Verified against Escape Road's Unity build:
 *     synthetic A/D start a run, steer, and restart after the game over card.
 *   - Holding a pad holds the key (for at least 90ms, so a quick tap is not
 *     lost between two engine frames); lifting, cancelling, losing pointer capture,
 *     hiding the tab or blurring the frame releases it. A stuck key is worse
 *     than no key.
 *   - `touch-action: none` on the pad stops the browser scrolling or zooming
 *     under a thumb. No `preventDefault()` on pointerdown: the pads need no
 *     click, but the rule in CLAUDE.md is kept anyway.
 *   - Visible, labelled and at least 64px — never an invisible strip. There is
 *     no swipe layer over the canvas; the build may want every gesture there.
 *   - Bottom placement clears the iPhone home indicator with
 *     env(safe-area-inset-bottom).
 */

export type TouchKey = {
  /** Visible glyph. */
  label: string;
  /** Accessible name. */
  aria: string;
  /** KeyboardEvent.key, .code and the legacy keyCode engines still read. */
  key: string;
  code: string;
  keyCode: number;
  /** Which bottom corner the pad sits in. */
  side: 'left' | 'right';
};

export type TouchControlLayout = {
  keys: TouchKey[];
  /** Distance of the pads from the bottom edge, before the safe-area inset —
   *  set per build so the pads clear its own corner buttons. */
  bottomPx: number;
};

export const TOUCH_CONTROLS_MARKER = '__inzoneTouchKeys';

/** Minimum rendered size of a pad. Apple's floor is 44pt; a steering pad held
 *  for seconds at a time wants more. */
export const TOUCH_PAD_SIZE_PX = 72;

export function touchControlsScript(layout: TouchControlLayout): string {
  const config = JSON.stringify(layout);
  return String.raw`
(function () {
  try {
    if (window.${TOUCH_CONTROLS_MARKER}) return;
    window.${TOUCH_CONTROLS_MARKER} = true;
    var layout = ${config};
    var coarse = false;
    try { coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches; } catch (e) {}
    if (!coarse && !('ontouchstart' in window)) return; // a desktop keeps its keyboard

    var SIZE = ${TOUCH_PAD_SIZE_PX};
    // An engine samples input once per frame; a tap shorter than a frame
    // would deliver keydown and keyup together and be read as nothing.
    var MIN_HOLD_MS = 90;
    var held = {};
    var downAt = {};

    function target() {
      return document.querySelector('canvas') || document.body || document;
    }
    function fire(type, k) {
      try {
        var e = new KeyboardEvent(type, { key: k.key, code: k.code, keyCode: k.keyCode, which: k.keyCode, bubbles: true, cancelable: true });
        try { Object.defineProperty(e, 'keyCode', { get: function () { return k.keyCode; } }); } catch (x) {}
        try { Object.defineProperty(e, 'which', { get: function () { return k.keyCode; } }); } catch (x) {}
        target().dispatchEvent(e);
      } catch (err) {}
    }
    function press(k, id) {
      if (held[k.code]) { held[k.code][id] = true; return; }
      held[k.code] = {}; held[k.code][id] = true;
      downAt[k.code] = Date.now();
      fire('keydown', k);
    }
    function release(k, id) {
      var h = held[k.code];
      if (!h) return;
      delete h[id];
      for (var any in h) return;
      delete held[k.code];
      var wait = MIN_HOLD_MS - (Date.now() - (downAt[k.code] || 0));
      if (wait > 0) {
        setTimeout(function () { if (!held[k.code]) fire('keyup', k); }, wait);
      } else {
        fire('keyup', k);
      }
    }
    function releaseAll() {
      for (var i = 0; i < layout.keys.length; i++) {
        var k = layout.keys[i];
        if (held[k.code]) { held[k.code] = { x: true }; release(k, 'x'); }
      }
    }

    var style = document.createElement('style');
    style.id = '__inzone-touch-keys-style';
    style.textContent =
      '.__inzone-pad{position:fixed;z-index:2147483000;width:' + SIZE + 'px;height:' + SIZE + 'px;' +
      'bottom:calc(' + layout.bottomPx + 'px + env(safe-area-inset-bottom, 0px));' +
      'border-radius:50%;border:2px solid rgba(255,255,255,.7);background:rgba(10,14,24,.38);' +
      'color:#fff;font:700 30px/1 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;' +
      'touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;' +
      '-webkit-tap-highlight-color:transparent;padding:0;margin:0}' +
      '.__inzone-pad.is-down{background:rgba(255,255,255,.35)}' +
      '.__inzone-pad.left{left:calc(18px + env(safe-area-inset-left, 0px))}' +
      '.__inzone-pad.right{right:calc(18px + env(safe-area-inset-right, 0px))}';

    function build() {
      if (document.getElementById('__inzone-touch-keys')) return;
      (document.head || document.documentElement).appendChild(style);
      var root = document.createElement('div');
      root.id = '__inzone-touch-keys';
      for (var i = 0; i < layout.keys.length; i++) {
        (function (k) {
          var pad = document.createElement('button');
          pad.type = 'button';
          pad.className = '__inzone-pad ' + k.side;
          pad.setAttribute('aria-label', k.aria);
          pad.textContent = k.label;
          var down = function (e) {
            try { pad.setPointerCapture(e.pointerId); } catch (x) {}
            pad.className = '__inzone-pad ' + k.side + ' is-down';
            press(k, e.pointerId);
          };
          var up = function (e) {
            pad.className = '__inzone-pad ' + k.side;
            release(k, e.pointerId);
          };
          pad.addEventListener('pointerdown', down);
          pad.addEventListener('pointerup', up);
          pad.addEventListener('pointercancel', up);
          pad.addEventListener('lostpointercapture', up);
          pad.addEventListener('contextmenu', function (e) { e.preventDefault(); });
          root.appendChild(pad);
        })(layout.keys[i]);
      }
      document.body.appendChild(root);
    }

    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') releaseAll(); });
    window.addEventListener('blur', releaseAll);
    window.addEventListener('pagehide', releaseAll);
    if (document.body) build();
    else document.addEventListener('DOMContentLoaded', build);
  } catch (e) {}
})();
`.trim();
}

export function touchControlsTag(layout: TouchControlLayout): string {
  return `<script id="${TOUCH_CONTROLS_MARKER}-script">${touchControlsScript(layout)}</script>`;
}
