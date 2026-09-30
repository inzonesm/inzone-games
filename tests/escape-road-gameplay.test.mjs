import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

import { BUILD_EVENTS_SHIM, INERT_FIREBASE_SHIM, HOSTED_BUILDS } from '../lib/hosted-builds.ts';
import { instrumentGameHtml } from '../lib/game-hosting.ts';
import {
  connectEscapeRoadGameplay,
  ESCAPE_ROAD_BUILD_PIN,
  ESCAPE_ROAD_PATH_PREFIX,
  ESCAPE_ROAD_START_EVENT,
} from '../lib/escape-road-gameplay-adapter.ts';
import { gameSignalAdapter, hasFullSameOriginAdapter, verifiedSignalGameIds } from '../lib/game-adapters.ts';
import { idsWithMeasurementMode, measurementMode } from '../lib/flagship-readiness.ts';
import { gameHasReadyProbe } from '../lib/game-frame-recovery.ts';

// Real PlayerPrefs writes captured from the pinned production build, two runs.
const PREFS = JSON.parse(readFileSync(new URL('../fixtures/hosted-builds/escape-road-playerprefs.json', import.meta.url), 'utf8'));
const bytes = (b64) => new Uint8Array(Buffer.from(b64, 'base64'));
const PREFS_KEY = '/idbfs/4be1176d356d680c37eeba2d1969ad41/PlayerPrefs';

/** A game window with the two early shims installed, the way the served entry runs them. */
function gameWindow({ pathname = `${ESCAPE_ROAD_PATH_PREFIX}index.html`, pin = ESCAPE_ROAD_BUILD_PIN, shims = true } = {}) {
  const target = new EventTarget();
  const puts = [];
  class IDBObjectStore {}
  IDBObjectStore.prototype.put = function (value, key) { puts.push({ value, key }); return { ok: true }; };
  const win = {
    location: { pathname },
    document: { querySelector: (sel) => (sel === 'meta[data-inzone-hosted]' && pin ? { getAttribute: () => pin } : null) },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    IDBObjectStore,
  };
  if (shims) {
    const ctx = vm.createContext({ window: win, CustomEvent, Proxy, String, Array });
    vm.runInContext(INERT_FIREBASE_SHIM, ctx);
    vm.runInContext(BUILD_EVENTS_SHIM, ctx);
  }
  const store = new win.IDBObjectStore();
  return {
    win,
    puts,
    /** What the build's jslib does: `firebase.analytics().logEvent(name)`. */
    logEvent: (...args) => win.firebase.analytics().logEvent(...args),
    /** What Unity's IDBFS sync does with PlayerPrefs. */
    savePrefs: (b64, key = PREFS_KEY) => store.put({ contents: bytes(b64), timestamp: 0, mode: 33206 }, key),
  };
}

function connect(game) {
  const signals = [];
  const conn = connectEscapeRoadGameplay(game.win, 'mount-a', (s) => signals.push(s));
  return { conn, signals };
}

test('the fixture is the real format: ads is absent at boot, 1 after run one, 2 after run two', () => {
  const game = gameWindow();
  game.savePrefs(PREFS.boot);
  assert.equal(game.win.__inzoneBuildEvents.prefs.ads, undefined);
  game.savePrefs(PREFS.run1Over);
  assert.equal(game.win.__inzoneBuildEvents.prefs.ads, 1);
  game.savePrefs(PREFS.run2Over);
  assert.equal(game.win.__inzoneBuildEvents.prefs.ads, 2);
  // Every write still reaches IndexedDB.
  assert.equal(game.puts.length, 3);
});

test('two recorded runs: start on Press_play_game, over when ads moves, a new run id each time', () => {
  const game = gameWindow();
  const { conn, signals } = connect(game);
  assert.ok(conn);
  game.savePrefs(PREFS.boot);
  game.logEvent(ESCAPE_ROAD_START_EVENT);
  game.savePrefs(PREFS.runStart); // the build also saves RestartGame at a run start
  game.savePrefs(PREFS.run1Over);
  game.logEvent('Restart_button_click_level');
  game.logEvent('_showInter_escape-road');
  game.logEvent(ESCAPE_ROAD_START_EVENT);
  game.savePrefs(PREFS.run2Over);
  assert.deepEqual(signals, [
    { type: 'start', runId: 'mount-a:escape-1' },
    { type: 'over', runId: 'mount-a:escape-1', outcome: 'loss' },
    { type: 'start', runId: 'mount-a:escape-2' },
    { type: 'over', runId: 'mount-a:escape-2', outcome: 'loss' },
  ]);
});

test('no start, no over: a prefs change before any run ends nothing', () => {
  const game = gameWindow();
  const { signals } = connect(game);
  game.savePrefs(PREFS.run1Over);
  game.savePrefs(PREFS.run2Over);
  assert.deepEqual(signals, []);
});

test('a returning browser loads an older count at boot; only a change after the start ends the run', () => {
  const game = gameWindow();
  const { signals } = connect(game);
  game.savePrefs(PREFS.run1Over); // boot of a returning browser: ads is already 1
  game.logEvent(ESCAPE_ROAD_START_EVENT);
  game.savePrefs(PREFS.run1Over); // a re-save of the same count is not a game over
  assert.deepEqual(signals, [{ type: 'start', runId: 'mount-a:escape-1' }]);
  game.savePrefs(PREFS.run2Over);
  assert.equal(signals.at(-1).type, 'over');
});

test('only the start name starts a run, and one run ends once', () => {
  const game = gameWindow();
  const { signals } = connect(game);
  for (const name of ['Restart_button_click_level', '_showInter_escape-road', 'press_play_game', 'Press_play_game_x']) game.logEvent(name);
  assert.deepEqual(signals, []);
  game.logEvent(ESCAPE_ROAD_START_EVENT);
  game.savePrefs(PREFS.run1Over);
  game.savePrefs(PREFS.run2Over);
  assert.equal(signals.filter((s) => s.type === 'over').length, 1);
});

test('the recorder keeps event names only — parameters are never read or stored', () => {
  const game = gameWindow();
  game.logEvent('Press_play_game', { invite: 'https://inzone.games/join/abc', chat: 'hello' });
  game.logEvent('not a name', {});
  game.logEvent({ toString: () => 'Press_play_game' });
  const stored = JSON.stringify(game.win.__inzoneBuildEvents.events);
  assert.equal(stored, JSON.stringify([{ kind: 'log', name: 'Press_play_game' }]));
});

test('the recorder does not break the inert Firebase the build calls into', () => {
  const game = gameWindow();
  const fb = game.win.firebase;
  assert.doesNotThrow(() => fb.analytics().logEvent('Press_play_game'));
  assert.doesNotThrow(() => fb.analytics().setUserId('x'));
  assert.doesNotThrow(() => fb.firestore().collection('x').doc('y').get().then(() => { throw new Error('resolved'); }));
  assert.doesNotThrow(() => fb.auth().onAuthStateChanged(() => {}));
});

test('only PlayerPrefs writes are read; other files and malformed data are passed through untouched', () => {
  const game = gameWindow();
  game.savePrefs(PREFS.run1Over, '/idbfs/4be1176d356d680c37eeba2d1969ad41/SomethingElse');
  game.savePrefs(Buffer.from('not unity prefs at all').toString('base64'));
  assert.equal(game.win.__inzoneBuildEvents.prefs.ads, undefined);
  assert.equal(game.puts.length, 2);
});

test('fails closed: another path, another pin, or no recorder means no adapter', () => {
  assert.equal(connect(gameWindow({ pathname: '/gcs/games/clescaperoad/v2/index.html' })).conn, null);
  assert.equal(connect(gameWindow({ pin: 'clescaperoad@000000000000' })).conn, null);
  assert.equal(connect(gameWindow({ pin: null })).conn, null);
  assert.equal(connect(gameWindow({ shims: false })).conn, null);
});

test('dispose stops listening', () => {
  const game = gameWindow();
  const { conn, signals } = connect(game);
  conn.dispose();
  game.logEvent(ESCAPE_ROAD_START_EVENT);
  assert.deepEqual(signals, []);
  assert.deepEqual(conn.read(), []);
});

test('the pin the adapter checks is the pin the mirror serves', () => {
  const { sha } = HOSTED_BUILDS.clescaperoad.upstream;
  assert.equal(ESCAPE_ROAD_BUILD_PIN, `clescaperoad@${sha.slice(0, 12)}`);
});

test('the served entry installs the recorder after the inert Firebase and before the build', () => {
  const html = instrumentGameHtml(
    readFileSync(new URL('../fixtures/hosted-builds/clescaperoad.v1.html', import.meta.url), 'utf8'),
    { baseHref: ESCAPE_ROAD_PATH_PREFIX.replace('/index.html', ''), gameId: 'clescaperoad' },
  );
  const inert = html.indexOf(INERT_FIREBASE_SHIM);
  const recorder = html.indexOf(BUILD_EVENTS_SHIM);
  assert.ok(inert >= 0 && recorder > inert, 'recorder wraps the inert stub');
  assert.ok(recorder < html.indexOf('createUnityInstance('), 'recorder runs before the build');
  assert.match(html, new RegExp(`data-inzone-hosted="${ESCAPE_ROAD_BUILD_PIN}"`));
  // An element id is a named property on window; it must not equal the guard.
  assert.match(html, /<script id="__inzone-build-events-script">/);
  assert.doesNotMatch(html, /id="__inzoneBuildEvents"/);
});

test('Escape Road is verified for start and over only; everything else stays as for a cross-origin title', () => {
  const adapter = gameSignalAdapter('clescaperoad');
  assert.ok(adapter);
  assert.equal(adapter.lifecycleOnly, true);
  assert.match(adapter.signalDescription, /Press_play_game/);
  assert.match(adapter.signalDescription, /PlayerPrefs `ads`/);
  assert.ok(verifiedSignalGameIds().includes('clescaperoad'));
  assert.equal(measurementMode('clescaperoad'), 'verified-lifecycle');
  // Boot recovery, cross-origin dwell proxies and the Rook hint are unchanged.
  assert.equal(hasFullSameOriginAdapter('clescaperoad'), false);
  assert.equal(gameHasReadyProbe('clescaperoad'), false);
  assert.equal(hasFullSameOriginAdapter('nightclub-showdown-inzone-production'), true);
  assert.equal(hasFullSameOriginAdapter('flappybird-inzone-2'), true);
  assert.equal(hasFullSameOriginAdapter('clelytraflight'), false);
});

test('report modes match the registered adapters: full ones are verified-adapter, lifecycle-only ones verified-lifecycle', () => {
  const full = verifiedSignalGameIds().filter((id) => hasFullSameOriginAdapter(id)).sort();
  const lifecycle = verifiedSignalGameIds().filter((id) => !hasFullSameOriginAdapter(id)).sort();
  assert.deepEqual(idsWithMeasurementMode('verified-adapter').sort(), full);
  assert.deepEqual(idsWithMeasurementMode('verified-lifecycle').sort(), lifecycle);
});
