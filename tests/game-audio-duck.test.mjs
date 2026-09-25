/**
 * Coverage for lib/game-audio-duck.ts (in-frame ducking shim + host
 * driver) and lib/companion/voice-duck-policy.ts.
 *
 * The shim is a script string injected first in <head> of every served
 * game (lib/game-hosting.ts). These tests pin: the marker/tag contract
 * the injector relies on, the host entry point the player page calls,
 * the AudioContext proxy trick that makes ducking possible at all, and
 * the pure duck policy the companion drives per voice-turn transition.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

async function loadDuck() {
  return await import('../lib/game-audio-duck.ts');
}
async function loadPolicy() {
  return await import('../lib/companion/voice-duck-policy.ts');
}
async function loadHosting() {
  return await import('../lib/game-hosting.ts');
}

test('shim exposes the host entry point and guards double-install', async () => {
  const { gameAudioDuckScript, GAME_AUDIO_DUCK_MARKER } = await loadDuck();
  const src = gameAudioDuckScript();
  assert.ok(src.includes('__inzoneSetGameDuck'), 'host entry point defined');
  assert.ok(src.includes(GAME_AUDIO_DUCK_MARKER), 'install guard uses the marker');
  assert.ok(src.includes("window['AudioContext']") || src.includes("patchAudioContext('AudioContext')"), 'wraps AudioContext');
  assert.ok(src.includes('webkitAudioContext'), 'wraps webkitAudioContext');
  assert.ok(src.includes('destination'), 'proxies ctx.destination to the master gain');
  assert.ok(src.includes('setTargetAtTime'), 'ducking ramps smoothly, no clicks');
  assert.ok(src.includes('querySelectorAll'), 'sweeps media elements');
  assert.ok(src.includes('MutationObserver'), 'catches elements added later');
});

test('tag carries the marker id so injection is idempotent', async () => {
  const { gameAudioDuckTag, GAME_AUDIO_DUCK_MARKER } = await loadDuck();
  const tag = gameAudioDuckTag();
  assert.ok(tag.startsWith('<script'), 'is a script tag');
  assert.ok(tag.includes(`id="${GAME_AUDIO_DUCK_MARKER}"`), 'marker id present');
});

test('injectAudioDuck inserts first in <head> and never duplicates', async () => {
  const { injectAudioDuck } = await loadHosting();
  const html = '<html><head><script src="game.js"></script></head><body></body></html>';
  const once = injectAudioDuck(html);
  assert.ok(once.indexOf('__inzoneAudioDuckShim') < once.indexOf('game.js'), 'shim runs before game scripts');
  const twice = injectAudioDuck(once);
  assert.equal(twice, once, 'second injection is a no-op');
});

test('instrumentGameHtml includes the duck shim for every game', async () => {
  const { instrumentGameHtml } = await loadHosting();
  const out = instrumentGameHtml('<html><head></head><body></body></html>', {
    baseHref: '/gcs/games/karate-bros/v1/',
    gameId: 'karate-bros',
  });
  assert.ok(out.includes('__inzoneAudioDuckShim'), 'duck shim injected');
  assert.ok(out.includes('__inzoneSetGameDuck'), 'host entry point present');
});

test('setGameAudioDuck drives the in-frame hook and reports success', async () => {
  const { setGameAudioDuck } = await loadDuck();
  const calls = [];
  const frame = {
    contentWindow: {
      __inzoneSetGameDuck: (level) => calls.push(level),
    },
  };
  assert.equal(setGameAudioDuck(frame, 0.12), true);
  assert.deepEqual(calls, [0.12]);
  assert.equal(setGameAudioDuck(frame, 1), true);
  assert.deepEqual(calls, [0.12, 1]);
});

test('setGameAudioDuck returns false when the frame is unreachable', async () => {
  const { setGameAudioDuck } = await loadDuck();
  assert.equal(setGameAudioDuck(null, 0.12), false, 'null frame');
  assert.equal(setGameAudioDuck({ contentWindow: null }, 0.12), false, 'no window');
  assert.equal(setGameAudioDuck({ contentWindow: {} }, 0.12), false, 'shim not installed, no document');
  const throwing = {
    get contentWindow() {
      throw new Error('cross-origin');
    },
  };
  assert.equal(setGameAudioDuck(throwing, 0.12), false, 'cross-origin never throws');
});

test('setGameAudioDuck falls back to a host-side media sweep on same-origin frames without the shim', async () => {
  const { setGameAudioDuck } = await loadDuck();
  const volumes = [];
  const el = {
    volume: 0.8,
    __inzoneBaseVolume: undefined,
  };
  const frame = {
    contentWindow: {
      document: {
        querySelectorAll: () => [el],
      },
    },
  };
  // querySelectorAll returns a plain array; forEach exists. Volumes recorded via setter trap:
  Object.defineProperty(el, 'volume', {
    get() { return this._v ?? 0.8; },
    set(v) { this._v = v; volumes.push(v); },
    configurable: true,
  });
  assert.equal(setGameAudioDuck(frame, 0.12), true);
  assert.ok(Math.abs(volumes[0] - 0.096) < 1e-9, `ducked to base*level, got ${volumes[0]}`);
  assert.equal(setGameAudioDuck(frame, 1), true, 'restore');
  assert.ok(Math.abs(volumes[volumes.length - 1] - 0.8) < 1e-9, 'base volume restored');
});

test('policy: ducks while Rook speaks, a turn is active, or the user is speaking', async () => {
  const { shouldDuckGameAudio } = await loadPolicy();
  const base = { voiceEnabled: true, muted: false, speaking: false, turnActive: false, userSpeaking: false };
  assert.equal(shouldDuckGameAudio(base), false, 'quiet listening leaves the game loud');
  assert.equal(shouldDuckGameAudio({ ...base, speaking: true }), true, 'Rook speaking');
  assert.equal(shouldDuckGameAudio({ ...base, turnActive: true }), true, 'turn in flight (thinking)');
  assert.equal(shouldDuckGameAudio({ ...base, userSpeaking: true }), true, 'user audibly speaking');
});

test('policy: never ducks when voice is off or muted', async () => {
  const { shouldDuckGameAudio } = await loadPolicy();
  const active = { voiceEnabled: true, muted: false, speaking: true, turnActive: true, userSpeaking: true };
  assert.equal(shouldDuckGameAudio({ ...active, voiceEnabled: false }), false, 'voice off');
  assert.equal(shouldDuckGameAudio({ ...active, muted: true }), false, 'muted');
});

test('GAME_DUCK_LEVEL is a duck, not a mute', async () => {
  const { GAME_DUCK_LEVEL } = await loadDuck();
  assert.ok(GAME_DUCK_LEVEL > 0 && GAME_DUCK_LEVEL < 0.5, `audible but low, got ${GAME_DUCK_LEVEL}`);
});
