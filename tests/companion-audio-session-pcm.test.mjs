/**
 * Regression coverage for the PCM stream lifecycle in
 * lib/companion/audio-session.ts, tied to PR #45 (Rook not listening).
 *
 * PR #45 added `pcmHold.player.cancel()` in the finally block of the
 * companion turn so a mid-stream throw stops leaving `pcmActive=true` and
 * therefore never fires `handlers.onPlaying(false)` — which is what left
 * `speakingRef.current` stuck true and silently discarded every subsequent
 * hands-free transcript.
 *
 * The concern this test guards against is not the fix itself, it is the
 * cost: cancel-in-finally MUST NOT cut off playback on the success path,
 * or Rook would speak half a sentence and stop. That claim can only be
 * verified against the real audio-session state machine — the pure helpers
 * in tests/companion-stream.test.mjs cannot reach it.
 *
 * To reach it from node, we install minimal browser-shaped mocks
 * (`window.AudioContext`) before importing the audio-session module. The
 * mocks record calls so tests can assert what the state machine did — no
 * jsdom, no headless browser.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Browser-shaped mocks ────────────────────────────────────────────────
// Installed BEFORE importing audio-session so `AudioContextCtor()`'s lazy
// `window.AudioContext` lookup returns the mock rather than null.

class MockGainNode {
  constructor() {
    this.gain = { value: 1 };
  }
  connect() {}
  disconnect() {}
}

class MockAudioBuffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    // audio-session::schedule reads `.duration` to advance pcmNextTime.
    this.duration = length / sampleRate;
  }
  copyToChannel() {}
}

class MockAudioBufferSourceNode {
  constructor() {
    this.buffer = null;
    this.onended = null;
    this.startedAt = null;
    this.stopped = false;
    this.disconnected = false;
  }
  connect() {}
  disconnect() {
    this.disconnected = true;
  }
  start(at) {
    this.startedAt = at;
  }
  stop() {
    this.stopped = true;
  }
}

class MockAudioContext {
  constructor() {
    this.state = 'running';
    // audio-session uses this to compute source start-time; tests advance it
    // through `advanceTime` on the shared session context below.
    this.currentTime = 0;
    this.destination = { name: 'destination' };
    this.sources = [];
    this.gain = null;
  }
  async resume() {
    this.state = 'running';
  }
  createGain() {
    const g = new MockGainNode();
    this.gain = g;
    return g;
  }
  createBuffer(channels, length, sampleRate) {
    return new MockAudioBuffer(channels, length, sampleRate);
  }
  createBufferSource() {
    const s = new MockAudioBufferSourceNode();
    this.sources.push(s);
    return s;
  }
}

globalThis.window = { AudioContext: MockAudioContext };
// audio-session::stopSpeech checks `typeof speechSynthesis` — stub so the
// success-path cancel doesn't throw when trying to cancel an SR queue.
globalThis.speechSynthesis = { cancel() {} };

const { createCompanionAudioSession } = await import('../lib/companion/audio-session.ts');

// ── Test harness ────────────────────────────────────────────────────────

function makeSession() {
  const events = { playing: [], onset: [], level: [], mode: [] };
  let generation = 1;
  const session = createCompanionAudioSession({
    currentGeneration: () => generation,
    onPlaying: (playing) => events.playing.push(playing),
    onOnset: (at) => events.onset.push(at),
    onLevel: (level) => events.level.push(level),
    onPlaybackMode: (mode, reactive) => events.mode.push({ mode, reactive }),
  });
  return {
    session,
    events,
    bumpGeneration: () => (generation += 1),
    generation: () => generation,
  };
}

/** 100 samples of near-silent PCM s16le — enough for schedule() to accept
 *  it and create one MockAudioBufferSourceNode, without triggering the
 *  oversized-event dropping path in the flush code. */
function samplePcm(byteCount = 200) {
  return new Uint8Array(byteCount);
}

function findCurrentContext() {
  // MockAudioContext instances register themselves on their creator.
  // audio-session keeps at most one context alive per session; grab the most
  // recent by inspecting the most recent gain-carrying instance.
  for (let i = window.AudioContext._all?.length - 1; i >= 0; i -= 1) {
    return window.AudioContext._all[i];
  }
  return null;
}

// Track every context we hand out so a test can drive its sources.
const origCreate = MockAudioContext;
window.AudioContext = class extends origCreate {
  constructor() {
    super();
    (window.AudioContext._all ||= []).push(this);
  }
};
window.AudioContext._all = [];

// A tick long enough for schedule()'s setTimeout(fn, delayMs) to fire in a
// mock context where delayMs is at most 20ms.
async function drainMicrotasksAndTimers() {
  await new Promise((r) => setTimeout(r, 30));
}

function completeAllSources(ctx) {
  // Simulate the browser firing `source.onended` for every source it holds.
  // audio-session filters the ended source out of pcmSources, and only fires
  // handlers.onPlaying(false) when pcmSources is empty AND !pcmActive.
  for (const source of ctx.sources) {
    if (source.onended) source.onended();
  }
}

// ── Tests ───────────────────────────────────────────────────────────────

test('PR #45 invariant: cancel() is a safe no-op on a stream whose end() has already resolved', async () => {
  const { session, events } = makeSession();
  const player = session.playPcmStream(1);
  player.start({ sampleRate: 16000, channels: 1 });
  player.append(samplePcm());
  await drainMicrotasksAndTimers(); // let schedule's setTimeout fire onPlaying(true)
  const ctx = window.AudioContext._all[window.AudioContext._all.length - 1];
  assert.equal(events.playing[0], true, 'onPlaying(true) fires after schedule');

  // The stream's producer calls end(); before end() can resolve, the last
  // source has to complete. Simulate that by triggering onended for every
  // source, then resolve end().
  const endPromise = player.end();
  completeAllSources(ctx);
  const state = await endPromise;
  assert.equal(state, 'playing', 'natural completion resolves with "playing"');
  assert.equal(
    events.playing.filter((p) => p === false).length,
    1,
    'onPlaying(false) fires exactly once from source.onended',
  );

  const beforeStops = ctx.sources.filter((s) => s.stopped).length;
  const playingLenBefore = events.playing.length;

  // The PR #45 change: cancel called on this already-completed player.
  assert.doesNotThrow(() => player.cancel(), 'cancel on completed player must not throw');

  const afterStops = ctx.sources.filter((s) => s.stopped).length;
  assert.equal(
    afterStops,
    beforeStops,
    'cancel must not stop any source after natural completion — pcmSources is already empty',
  );
  const extraPlayingTrue = events.playing.slice(playingLenBefore).some((p) => p === true);
  assert.equal(
    extraPlayingTrue,
    false,
    'cancel after completion must not re-fire onPlaying(true)',
  );
});

test('cancel() on an interrupted stream fires onPlaying(false) and stops in-flight sources', async () => {
  const { session, events } = makeSession();
  const player = session.playPcmStream(1);
  player.start({ sampleRate: 16000, channels: 1 });
  player.append(samplePcm());
  await drainMicrotasksAndTimers();
  const ctx = window.AudioContext._all[window.AudioContext._all.length - 1];
  assert.equal(events.playing[0], true, 'stream is speaking before interruption');
  assert.equal(
    events.playing.some((p) => p === false),
    false,
    'onPlaying(false) has not fired — end() was never called',
  );

  // Simulate the mid-stream throw: producer never calls end(), never
  // triggers source completion. Direct cancel is what the finally block now
  // does per PR #45.
  player.cancel();

  assert.equal(
    events.playing[events.playing.length - 1],
    false,
    'cancel must fire onPlaying(false) so speakingRef clears',
  );
  const stopped = ctx.sources.every((s) => s.stopped);
  assert.equal(stopped, true, 'every in-flight source must be stopped');
});

test('a fresh PCM stream after cancel-on-interruption completes cleanly (next turn accepted)', async () => {
  const { session, events, bumpGeneration, generation } = makeSession();

  // Interrupted first stream — cleanup path.
  const first = session.playPcmStream(generation());
  first.start({ sampleRate: 16000, channels: 1 });
  first.append(samplePcm());
  await drainMicrotasksAndTimers();
  first.cancel();

  const playingAfterFirst = events.playing.length;
  assert.equal(
    events.playing[events.playing.length - 1],
    false,
    'first stream cleaned up before second starts',
  );

  // A new turn bumps the generation the way GameCompanion::bumpGeneration
  // does — playPcmStream and schedule both gate on it, so the second stream
  // has to run under the new number to be accepted.
  bumpGeneration();

  // Second stream on the same session — must not be poisoned by the first.
  const second = session.playPcmStream(generation());
  second.start({ sampleRate: 16000, channels: 1 });
  second.append(samplePcm());
  await drainMicrotasksAndTimers();
  const secondCtx = window.AudioContext._all[window.AudioContext._all.length - 1];
  assert.equal(
    events.playing[playingAfterFirst],
    true,
    'second stream fires onPlaying(true) after cancel of the first',
  );

  const endPromise = second.end();
  completeAllSources(secondCtx);
  const state = await endPromise;
  assert.equal(state, 'playing', 'second stream resolves cleanly');
  assert.equal(
    events.playing[events.playing.length - 1],
    false,
    'second stream fires onPlaying(false) at natural completion',
  );
});

test('cancel() called twice is idempotent (belt-and-suspenders for finally + explicit teardown paths)', async () => {
  const { session, events } = makeSession();
  const player = session.playPcmStream(1);
  player.start({ sampleRate: 16000, channels: 1 });
  player.append(samplePcm());
  await drainMicrotasksAndTimers();

  player.cancel();
  const eventCountAfterFirst = events.playing.length;
  assert.doesNotThrow(() => player.cancel(), 'second cancel must not throw');
  // A second cancel may fire onPlaying(false) again (audio-session::stopPcm
  // clears pcmSources and calls onPlaying(false) unconditionally). Assert
  // only that no onPlaying(true) sneaks back in and that no exception is
  // raised — both of which would break the state machine on the caller.
  const extraPlayingTrue = events.playing
    .slice(eventCountAfterFirst)
    .some((p) => p === true);
  assert.equal(extraPlayingTrue, false, 'second cancel must not fire onPlaying(true)');
});
