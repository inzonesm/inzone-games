/**
 * In-frame game-audio ducking for the voice companion (Rook).
 *
 * The defect (2026-09-25, phone test): Rook's voice loop and the game's
 * audio run uncoordinated. The game plays at full volume under Rook's
 * speech, and the recognizer hears game SFX/music as user speech — so a
 * game sound during "thinking" fires a bogus onText, which aborts the
 * in-flight turn and starts a new one. Rook interrupts itself forever and
 * never finishes an answer.
 *
 * The host page cannot duck a frame's Web Audio graph from outside (no
 * cross-frame audio API exists), so the ducking lives INSIDE the frame as
 * an injected shim, following the exact pattern of the viewport-fit and
 * nightclub focus scripts: baked at upload time (lib/upload-pipeline.ts)
 * and injected at request time for already-uploaded builds
 * (app/gcs/[...path]/route.ts → lib/game-hosting.ts). Inserted first in
 * <head>, it runs before any game script creates audio.
 *
 * The shim:
 *   1. Wraps window.AudioContext / webkitAudioContext. Every context the
 *      game creates is proxied so `ctx.destination` returns a per-context
 *      master GainNode (connected to the real destination) instead of the
 *      raw destination. All game Web Audio then flows through a gain the
 *      shim owns, and ducking is a smooth ramp on those gains.
 *   2. Tracks HTMLMediaElements (document sweep + MutationObserver +
 *      wrapped `new Audio()`) and scales their volume against the stored
 *      base volume. If the game changes an element's volume mid-duck the
 *      stored base re-syncs from the element on the next sweep, so the
 *      game's own volume controls keep working.
 *
 * The host drives it with setGameAudioDuck(frame, level): 1 = full game
 * audio, GAME_DUCK_LEVEL while anyone is talking. Cross-origin or
 * torn-down frames safely report false (no ducking possible there).
 */

export const GAME_AUDIO_DUCK_MARKER = '__inzoneAudioDuckShim';

/** Game-audio level while a voice turn is active. Not a mute: the game
 *  stays faintly audible under Rook, which is what the original
 *  "ducking is omitted" comment in audio-session.ts was protecting. */
export const GAME_DUCK_LEVEL = 0.12;

const INSTALL_SOURCE = String.raw`
(function () {
  if (window.__inzoneAudioDuckShim) return;
  window.__inzoneAudioDuckShim = true;

  var level = 1;
  var masters = [];
  // media element -> { base: number, applied: number }
  var media = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  var mediaFallback = [];

  function entryFor(el) {
    if (media) {
      var e = media.get(el);
      if (!e) {
        e = { base: 1, applied: 1 };
        try { e.base = el.volume; } catch (err) { /* unreadable */ }
        e.applied = e.base;
        media.set(el, e);
      }
      return e;
    }
    for (var i = 0; i < mediaFallback.length; i++) {
      if (mediaFallback[i].el === el) return mediaFallback[i];
    }
    var fresh = { el: el, base: 1, applied: 1 };
    try { fresh.base = el.volume; } catch (err) { /* unreadable */ }
    fresh.applied = fresh.base;
    mediaFallback.push(fresh);
    return fresh;
  }

  function duckElement(el) {
    var entry = entryFor(el);
    var current = 1;
    try { current = el.volume; } catch (err) { return; }
    // If the game moved the volume itself since our last write, treat the
    // game's value as the new base instead of fighting its slider.
    if (current !== entry.applied) {
      entry.base = current;
    }
    var target = Math.max(0, Math.min(1, entry.base * level));
    entry.applied = target;
    try { el.volume = target; } catch (err) { /* ignore */ }
  }

  function applyLevel() {
    var t;
    for (var i = 0; i < masters.length; i++) {
      try {
        var g = masters[i];
        t = g.context.currentTime;
        g.gain.cancelScheduledValues(t);
        // Smooth ramp: no clicks when Rook starts/stops talking.
        g.gain.setTargetAtTime(level, t, 0.08);
      } catch (err) { /* context gone */ }
    }
    var els = [];
    try { els = document.querySelectorAll('audio,video'); } catch (err) { /* no dom */ }
    for (var j = 0; j < els.length; j++) duckElement(els[j]);
  }

  function patchAudioContext(name) {
    var Real = window[name];
    if (typeof Real !== 'function' || Real.__inzoneDuckPatched) return;
    function Wrapped() {
      var args = Array.prototype.slice.call(arguments);
      var ctx = new (Function.prototype.bind.apply(Real, [null].concat(args)))();
      var master = ctx.createGain();
      master.gain.value = level;
      try { master.connect(ctx.destination); } catch (err) { /* no destination yet */ }
      masters.push(master);
      return new Proxy(ctx, {
        get: function (target, prop) {
          // Every game source connects to ctx.destination — hand it our
          // master gain so all game Web Audio flows through the duck.
          if (prop === 'destination') return master;
          var v = target[prop];
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    }
    Wrapped.prototype = Real.prototype;
    Wrapped.__inzoneDuckPatched = true;
    try { window[name] = Wrapped; } catch (err) { /* read-only */ }
  }

  function patchAudioElement() {
    var RealAudio = window.Audio;
    if (typeof RealAudio !== 'function' || RealAudio.__inzoneDuckPatched) return;
    function WrappedAudio() {
      var args = Array.prototype.slice.call(arguments);
      var el = new (Function.prototype.bind.apply(RealAudio, [null].concat(args)))();
      entryFor(el);
      if (level !== 1) duckElement(el);
      return el;
    }
    WrappedAudio.prototype = RealAudio.prototype;
    WrappedAudio.__inzoneDuckPatched = true;
    try { window.Audio = WrappedAudio; } catch (err) { /* read-only */ }
  }

  // Host entry point. Called by the player page on every voice-turn
  // transition; safe to call any time.
  window.__inzoneSetGameDuck = function (next) {
    level = typeof next === 'number' && isFinite(next) ? Math.max(0, Math.min(1, next)) : 1;
    applyLevel();
  };

  if (typeof MutationObserver !== 'undefined') {
    try {
      new MutationObserver(function () {
        if (level !== 1) applyLevel();
      }).observe(document.documentElement, { childList: true, subtree: true });
    } catch (err) { /* observer unavailable */ }
  }

  patchAudioContext('AudioContext');
  patchAudioContext('webkitAudioContext');
  patchAudioElement();
})();
`;

export function gameAudioDuckScript(): string {
  return INSTALL_SOURCE.trim();
}

export function gameAudioDuckTag(): string {
  return `<script id="${GAME_AUDIO_DUCK_MARKER}">${gameAudioDuckScript()}</script>`;
}

/**
 * Host-side driver. Sets the in-frame duck level; returns true when the
 * frame accepted it. Cross-origin / torn-down frames return false — there
 * is no way to duck those, and the voice loop's half-duplex mic discipline
 * is the backstop there.
 */
export function setGameAudioDuck(frame: HTMLIFrameElement | null, level: number): boolean {
  if (!frame) return false;
  try {
    const win = frame.contentWindow as
      | (Window & { __inzoneSetGameDuck?: (level: number) => void })
      | null;
    if (!win) return false;
    if (typeof win.__inzoneSetGameDuck === 'function') {
      win.__inzoneSetGameDuck(level);
      return true;
    }
    // Same-origin frame that never got the shim (e.g. a non-/gcs game):
    // best-effort media-element sweep from the host side. Web Audio made
    // inside the frame is unreachable from here.
    const doc = win.document;
    if (!doc) return false;
    doc.querySelectorAll('audio,video').forEach((node) => {
      const el = node as HTMLMediaElement & { __inzoneBaseVolume?: number };
      if (typeof el.__inzoneBaseVolume !== 'number') el.__inzoneBaseVolume = el.volume;
      el.volume = Math.max(0, Math.min(1, el.__inzoneBaseVolume * level));
    });
    return true;
  } catch {
    return false;
  }
}
