/**
 * Recovery phase machine and same-origin shell probe.
 *
 * The load-bearing claim: iframe `load` is not game-ready, and a hollow
 * shell after load must still offer Retry / Back. Games without an
 * adapter never receive a fabricated ready or failure from load alone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootStatusCopy,
  gameHasReadyProbe,
  inspectGameDocument,
  inspectSameOriginShell,
  probeAdapterReady,
  probeFramePlayable,
  resolveRecoveryPhase,
  showCompactRecovery,
  showFullBootOverlay,
  showRecoveryActions,
} from '../lib/game-frame-recovery.ts';

const nightclub = 'nightclub-showdown-inzone-production';
const flappy = 'flappybird-inzone-2';
const ovo = 'ovo-inzone-production-2';

function phase(overrides = {}) {
  return resolveRecoveryPhase({
    hasGame: true,
    frameLoaded: false,
    frameFailed: false,
    gameReady: false,
    stalled: false,
    hasReadyProbe: false,
    inspectableBlankShell: false,
    ...overrides,
  });
}

function fakeDoc({
  url = 'https://www.inzone.games/gcs/games/demo/index.html',
  canvas = false,
  scripts = 0,
  descendants = 0,
  text = '',
  body = true,
} = {}) {
  const nodes = {
    length: descendants,
  };
  const bodyNode = body
    ? {
        childElementCount: descendants,
        textContent: text,
        innerText: text,
        querySelector: (sel) => (canvas && /canvas/.test(sel) ? { tag: 'canvas' } : null),
        querySelectorAll: () => nodes,
      }
    : null;
  return {
    URL: url,
    body: bodyNode,
    scripts: { length: scripts },
    querySelector: (sel) => (canvas && /canvas/.test(sel) ? { tag: 'canvas' } : null),
  };
}

test('only Nightclub and Flappy expose a ready probe', () => {
  assert.equal(gameHasReadyProbe(nightclub), true);
  assert.equal(gameHasReadyProbe(flappy), true);
  assert.equal(gameHasReadyProbe(ovo), false);
  assert.equal(gameHasReadyProbe(''), false);
});

test('iframe load is not ready for an adapter game', () => {
  const loaded = phase({ frameLoaded: true, hasReadyProbe: true });
  assert.equal(loaded, 'waiting-ready');
  assert.equal(showFullBootOverlay(loaded), true);
  assert.equal(showCompactRecovery(loaded), false);
  assert.equal(showRecoveryActions(loaded), false);
  assert.equal(bootStatusCopy(loaded), 'Loading…');
});

test('iframe load without a probe is unverified play, not success or failure', () => {
  const loaded = phase({ frameLoaded: true, hasReadyProbe: false });
  assert.equal(loaded, 'unverified-play');
  assert.equal(showFullBootOverlay(loaded), false);
  assert.equal(showCompactRecovery(loaded), true);
  assert.equal(showRecoveryActions(loaded), true);
  assert.equal(bootStatusCopy(loaded), null);
});

test('a late stall tick cannot cover a healthy ready session', () => {
  const ready = phase({ frameLoaded: true, hasReadyProbe: true, gameReady: true, stalled: true });
  assert.equal(ready, 'ready');
  assert.equal(showFullBootOverlay(ready), false);
  assert.equal(showRecoveryActions(ready), false);
});

test('a late stall tick cannot cover unverified play after onload', () => {
  const play = phase({ frameLoaded: true, hasReadyProbe: false, stalled: true });
  assert.equal(play, 'unverified-play');
  assert.equal(showFullBootOverlay(play), false);
  assert.equal(showCompactRecovery(play), true);
});

test('adapter games that never become ready can stall after onload', () => {
  const stalled = phase({ frameLoaded: true, hasReadyProbe: true, stalled: true });
  assert.equal(stalled, 'stalled');
  assert.equal(showFullBootOverlay(stalled), true);
  assert.equal(showRecoveryActions(stalled), true);
  assert.equal(bootStatusCopy(stalled), 'Still loading — this one is taking longer than usual.');
});

test('iframe error and hollow shells are failed even after onload', () => {
  assert.equal(phase({ frameLoaded: true, frameFailed: true }), 'failed');
  assert.equal(phase({ frameLoaded: true, hasReadyProbe: true, inspectableBlankShell: true }), 'failed');
  assert.equal(phase({ frameLoaded: true, hasReadyProbe: false, inspectableBlankShell: true }), 'failed');
  assert.equal(showRecoveryActions('failed'), true);
  assert.equal(bootStatusCopy('failed'), "This game didn't load.");
});

test('failed wins over ready so a torn-down frame is not declared playable', () => {
  assert.equal(
    phase({ frameLoaded: true, gameReady: true, frameFailed: true, hasReadyProbe: true }),
    'failed',
  );
});

test('download stall before onload still offers recovery', () => {
  const stalled = phase({ frameLoaded: false, stalled: true });
  assert.equal(stalled, 'stalled');
  assert.equal(showRecoveryActions(stalled), true);
});

test('inspectable hollow shell after onload is a broken download, not a player', () => {
  const empty = inspectGameDocument(fakeDoc({ descendants: 0, scripts: 0, text: '' }));
  assert.deepEqual(empty, { reachable: true, blankBrokenShell: true });

  const aboutBlank = inspectGameDocument(fakeDoc({ url: 'about:blank', descendants: 0, scripts: 0, text: '' }));
  assert.equal(aboutBlank.blankBrokenShell, true);

  const noBody = inspectGameDocument({ URL: 'https://x', body: null, scripts: { length: 0 }, querySelector: () => null });
  assert.equal(noBody.blankBrokenShell, true);
});

test('a scripted or canvas document is not treated as a broken shell', () => {
  assert.equal(inspectGameDocument(fakeDoc({ canvas: true })).blankBrokenShell, false);
  assert.equal(inspectGameDocument(fakeDoc({ scripts: 3, descendants: 12, text: '' })).blankBrokenShell, false);
  assert.equal(inspectGameDocument(fakeDoc({ descendants: 8, text: 'Click anywhere to start' })).blankBrokenShell, false);
});

test('cross-origin or missing documents are not declared blank', () => {
  assert.deepEqual(inspectGameDocument(null), { reachable: false, blankBrokenShell: false });
  assert.deepEqual(inspectSameOriginShell(null), { reachable: false, blankBrokenShell: false });
  assert.deepEqual(inspectSameOriginShell({ contentDocument: null }), { reachable: false, blankBrokenShell: false });
  assert.deepEqual(
    inspectSameOriginShell({
      get contentDocument() {
        throw new Error('Blocked a frame with origin');
      },
    }),
    { reachable: false, blankBrokenShell: false },
  );
});

test('Nightclub ready probe uses the existing bridge, not iframe load', () => {
  const notYet = {
    NightclubBridge: { getState: () => ({}) },
  };
  assert.equal(probeAdapterReady(notYet, nightclub), false);

  const ready = {
    NightclubBridge: { getState: () => ({ runId: '', ended: false }) },
    __NightclubRuntime: { Game: { ME: {} }, Main: { ME: {} } },
  };
  assert.equal(probeAdapterReady(ready, nightclub), true);
  assert.equal(probeAdapterReady(ready, ovo), false);
});

test('Flappy ready probe fails closed until the inspected v9 engine is present', () => {
  const win = { location: { pathname: '/other/index.html' } };
  assert.equal(probeAdapterReady(win, flappy), false);
  assert.equal(probeFramePlayable(win, flappy), false);
});

test('Flappy title-screen engine is playable for overlay, not a verified start', () => {
  const bird = { enabled: false, script: { bird: { state: null } }, findByName() { return null; }, getPosition() { return { y: 0 }; } };
  const over = {};
  const app = {
    root: { findByName: (name) => (name === 'Game' ? { findByName: () => bird } : over) },
    on() {},
    off() {},
  };
  const win = {
    location: { pathname: '/gcs/games/flappybird-inzone-2/v9/index.html' },
    pc: { Application: { getApplication: () => app } },
  };
  assert.equal(probeAdapterReady(win, flappy), false, 'bird is not in getready/play/dead');
  assert.equal(probeFramePlayable(win, flappy), true, 'v9 engine entities are on the title screen');
});

test('recovery never remounts by itself: helpers are pure', () => {
  const first = phase({ frameLoaded: true, hasReadyProbe: true });
  const second = phase({ frameLoaded: true, hasReadyProbe: true });
  assert.equal(first, second);
  assert.equal(first, 'waiting-ready');
});
