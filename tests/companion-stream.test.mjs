import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import {
  concatBytes,
  pcmS16leToWav,
  rmsPcmS16le,
  smoothSpeechEnvelope,
} from '../lib/companion/pcm.ts';
import { classifyTranscriptSource } from '../lib/companion/transcript-source.ts';
import { speechCacheKey } from '../lib/companion/cache.ts';
import { gameInviteBridgeScript } from '../lib/game-invite-bridge.ts';
import { instrumentGameHtml } from '../lib/game-hosting.ts';

test('PCM helpers wrap s16le as WAV and measure energy', () => {
  const pcm = new Uint8Array(8);
  const view = new DataView(pcm.buffer);
  view.setInt16(0, 16000, true);
  view.setInt16(2, -16000, true);
  view.setInt16(4, 8000, true);
  view.setInt16(6, -8000, true);
  assert.ok(rmsPcmS16le(pcm) > 0.2);
  assert.equal(rmsPcmS16le(new Uint8Array(0)), 0);
  const wav = pcmS16leToWav(pcm, 16_000, 1);
  assert.equal(wav.byteLength, 52);
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.subarray(8, 12)), 'WAVE');
  const joined = concatBytes([pcm.subarray(0, 4), pcm.subarray(4)]);
  assert.deepEqual(joined, pcm);
});

test('speech envelope attacks faster than it releases', () => {
  const up = smoothSpeechEnvelope(0, 1, 0.085, 85, 230);
  const down = smoothSpeechEnvelope(1, 0, 0.085, 85, 230);
  assert.ok(up > 0.5);
  assert.ok(down > 0.6);
  assert.ok(up > 1 - down);
});

test('fake SpeechRecognition is simulated_recognition, not a microphone', () => {
  assert.equal(classifyTranscriptSource({ flagged: 'injected' }), 'injected');
  assert.equal(
    classifyTranscriptSource({ flagged: 'microphone', simulatedCtor: true }),
    'simulated_recognition',
  );
  assert.equal(classifyTranscriptSource({ ctorName: 'FakeRec' }), 'simulated_recognition');
  assert.equal(classifyTranscriptSource({ flagged: 'simulated_recognition' }), 'simulated_recognition');
  assert.equal(classifyTranscriptSource({}), 'microphone');
});

test('PCM and MPEG cache keys stay distinct', () => {
  const base = {
    text: 'hello there',
    provider: 'elevenlabs',
    voiceId: 'voice',
    modelId: 'eleven_turbo_v2',
    language: 'en-US',
    settings: 'stb:0.55',
  };
  assert.notEqual(speechCacheKey(base), speechCacheKey({ ...base, format: 'pcm_16000' }));
  assert.equal(
    speechCacheKey({ ...base, format: 'pcm_16000' }),
    speechCacheKey({ ...base, format: 'pcm_16000' }),
  );
});

function runInviteBridge(existing, { flush = true } = {}) {
  const timers = [];
  const listeners = new Map();
  const parent = { postMessage() {} };
  const window = {
    InZoneSDK: existing,
    parent,
    location: { origin: 'https://preview.example' },
    addEventListener(type, fn) {
      const list = listeners.get(type) || [];
      list.push(fn);
      listeners.set(type, list);
    },
    dispatchEvent(event) {
      for (const fn of listeners.get(event.type) || []) fn(event);
      return true;
    },
  };
  const document = { readyState: 'complete', addEventListener() {} };
  const ctx = createContext({
    window,
    document,
    location: window.location,
    parent,
    Map,
    Promise,
    setTimeout: (fn) => {
      timers.push(fn);
      return 1;
    },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
  });
  runInContext(gameInviteBridgeScript('nightclub-showdown-inzone-production'), ctx);
  if (flush) {
    while (timers.length) timers.shift()();
  }
  return { window, timers, listeners };
}

test('invite bridge does not overwrite an existing InZoneSDK', () => {
  const sendChallenge = () => 'mine';
  const openChat = () => 'chat';
  const existing = { sendChallenge, openChat, extra: true };
  const { window } = runInviteBridge(existing);
  assert.equal(window.InZoneSDK, existing);
  assert.equal(window.InZoneSDK.sendChallenge, sendChallenge);
  assert.equal(window.InZoneSDK.openChat, openChat);
  assert.equal(window.InZoneSDK.extra, true);
});

test('invite bridge fills only missing invite methods on a partial SDK', () => {
  const getConfig = () => ({ owned: true });
  const existing = { getConfig };
  const { window } = runInviteBridge(existing);
  assert.equal(window.InZoneSDK, existing);
  assert.equal(typeof window.InZoneSDK.sendChallenge, 'function');
  assert.equal(typeof window.InZoneSDK.openChat, 'function');
  assert.equal(window.InZoneSDK.getConfig, getConfig);
});

test('invite bridge waits so an isolated SDK can install first', () => {
  const { window, timers } = runInviteBridge(undefined, { flush: false });
  assert.equal(window.InZoneSDK, undefined);
  const isolated = {
    sendChallenge: () => 'sdk',
    openChat: () => 'sdk',
    getConfig: () => ({ isolation: 'isolated' }),
  };
  window.InZoneSDK = isolated;
  while (timers.length) timers.shift()();
  assert.equal(window.InZoneSDK, isolated);
  assert.equal(window.InZoneSDK.sendChallenge(), 'sdk');
});

test('shim claims conversation only and instrumented HTML stays same-origin', () => {
  const { window } = runInviteBridge(undefined);
  assert.equal(typeof window.InZoneSDK.sendChallenge, 'function');
  return window.InZoneSDK.getConfig().then((config) => {
    assert.equal(config.inviteScope, 'conversation');
    assert.equal(config.matchJoined, false);
    assert.equal(Array.from(config.capabilities).join(','), 'sendChallenge,openChat');
  });
});

test('instrumented Nightclub HTML still gets the deferred invite bridge', () => {
  const html = instrumentGameHtml('<html><head></head><body><h1>nightclub</h1></body></html>', {
    baseHref: '/gcs/games/nightclub-showdown-inzone-production/v2/',
    gameId: 'nightclub-showdown-inzone-production',
  });
  assert.match(html, /__inzonePlayInvite/);
  assert.match(html, /fillMissing/);
  assert.doesNotMatch(html, /matchJoined: true/);
  assert.doesNotMatch(html, /__inzoneWebSdk/);
});
