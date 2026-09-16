import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectFlappyGameplay } from '../lib/flappy-gameplay-adapter.ts';
import { applyGameplaySignal, emptyEngagement } from '../lib/gameplay-signals.ts';

// Mirrors the inspected v9 engine's ordering, including the continue boundary.
function fixture() {
  const listeners = new Map();
  const bird = { state: 'getready', paused: false, velocity: 0 };
  const entity = { enabled: false, script: { bird }, getPosition: () => ({ y }) };
  const over = { enabled: false };
  let y = 0;
  const app = {
    root: { findByName: name => name === 'Game' ? { findByName: () => entity } : over },
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    off(name, fn) { listeners.get(name)?.delete(fn); },
    fire(name) { for (const fn of listeners.get(name) || []) fn(); },
  };
  const win = { location: { pathname: '/gcs/games/flappybird-inzone-2/v9/index.html' }, pc: { Application: { getApplication: () => app } } };
  const signals = [];
  const connect = mount => connectFlappyGameplay(win, mount, s => signals.push(s));
  const ready = () => { app.fire('game:getready'); entity.enabled = true; bird.state = 'getready'; over.enabled = false; };
  const flap = () => { app.fire('game:play'); bird.state = 'play'; bird.velocity = 1; };
  return { win, app, bird, entity, over, signals, connect, ready, flap, move: () => { y += 0.1; } };
}

test('Flappy fails closed for unknown versions and an unloaded engine', () => {
  const f = fixture();
  f.win.location.pathname = '/gcs/games/flappybird-inzone-2/v10/index.html';
  assert.equal(f.connect('m'), null);
  f.win.location.pathname = '/gcs/games/flappybird-inzone-2/v9/index.html';
  delete f.win.pc;
  assert.equal(f.connect('m'), null);
});

test('loading, animated menus and get-ready do not emit starts or active time', () => {
  const f = fixture(), c = f.connect('m');
  f.move();
  assert.deepEqual(c.read(), [{ type: 'ready' }]);
  f.ready();
  f.move();
  assert.deepEqual(c.read(), [{ type: 'ready' }]);
  assert.deepEqual(f.signals, []);
  c.dispose();
});

test('first flap starts once even if a short attempt ends between polling ticks', () => {
  const f = fixture(), c = f.connect('m');
  f.ready(); f.flap(); f.flap();
  f.bird.state = 'dead'; f.over.enabled = true; f.app.fire('game:gameover');
  f.app.fire('game:gameover');
  assert.deepEqual(f.signals, [
    { type: 'start', runId: 'm:flappy-1' },
    { type: 'over', runId: 'm:flappy-1', outcome: 'loss' },
  ]);
  assert.equal(c.read()[1].active, false);
  c.dispose();
});

test('continue prompt is inactive, and accepted continue stays in the same run', () => {
  const f = fixture(), c = f.connect('m');
  f.ready(); f.flap();
  f.bird.state = 'dead'; f.bird.paused = true; f.app.fire('game:pause');
  f.app.fire('game:gameover'); // Not final: the actual game-over screen is absent.
  assert.equal(c.read()[1].active, false);
  assert.equal(f.signals.filter(s => s.type === 'over').length, 0);
  f.bird.paused = false; f.bird.state = 'play'; f.move();
  assert.equal(c.read()[1].runId, 'm:flappy-1');
  assert.equal(c.read()[1].active, true);
  assert.equal(f.signals.filter(s => s.type === 'start').length, 1);
  c.dispose();
});

test('replay has a new run id; detach removes only our engine listeners', () => {
  const f = fixture();
  let engineCalls = 0;
  f.app.on('game:play', () => engineCalls++);
  const c = f.connect('m');
  f.ready(); f.flap(); f.app.fire('game:menu'); f.ready(); f.flap();
  assert.deepEqual(f.signals.filter(s => s.type === 'start').map(s => s.runId), ['m:flappy-1', 'm:flappy-2']);
  c.dispose();
  const length = f.signals.length;
  f.ready(); f.flap();
  assert.equal(f.signals.length, length);
  assert.equal(engineCalls, 3);
  assert.deepEqual(c.read(), []);
});

test('Flappy activity uses physics; pauses and hidden time cannot advance engagement', () => {
  const f = fixture();
  let state = emptyEngagement(), lastTick = null, now = 0, visible = true;
  const events = [];
  const fold = signal => {
    const result = applyGameplaySignal({ state, lastTick, now, signal, documentVisible: visible });
    ({ state, lastTick } = result); events.push(...result.events);
  };
  const c = connectFlappyGameplay(f.win, 'm', fold);
  f.ready(); f.flap();
  for (let i = 0; i <= 65; i++) {
    now = i * 1000; f.move(); c.read().forEach(fold);
  }
  assert.equal(events.filter(e => e.name === 'engaged_play').length, 1);
  const active = state.activeMs;
  f.bird.paused = true; f.app.fire('game:pause');
  now += 1000; f.move(); c.read().forEach(fold);
  assert.equal(state.activeMs, active);
  f.bird.paused = false; visible = false;
  now += 1000; f.move(); c.read().forEach(fold);
  assert.equal(state.activeMs, active);
  c.dispose();
});

test('attaching during an existing run does not invent a start', () => {
  const f = fixture(); f.ready(); f.flap();
  const c = f.connect('m'); f.move();
  assert.deepEqual(c.read(), [{ type: 'ready' }]);
  assert.deepEqual(f.signals, []);
  c.dispose();
});
