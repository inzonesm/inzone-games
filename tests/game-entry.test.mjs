/**
 * Entry repair must clear a build's dead menu gate and nothing else.
 * It must never emit or imply a gameplay signal — `game_start` still comes
 * from the player's own first flap (see tests/flappy-gameplay.test.mjs).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { entryFixFor } from '../lib/game-entry.ts';

const V9 = '/gcs/games/flappybird-inzone-2/v9/index.html';

function fakeWin({ pathname = V9, bird = null, over = null, onFire = () => {} } = {}) {
  const game = bird ? { findByName: (n) => (n === 'Bird' ? bird : null) } : null;
  return {
    location: { pathname },
    pc: {
      Application: {
        getApplication: () => ({
          root: {
            findByName: (n) => (n === 'Game' ? game : n === 'Game Over Screen' ? over : null),
          },
          fire: onFire,
        }),
      },
    },
  };
}

test('only flappy has an entry fix', () => {
  assert.equal(entryFixFor('flappybird-inzone-2')?.gameId, 'flappybird-inzone-2');
  assert.equal(entryFixFor('neon-blaster-inzone-production'), null);
  assert.equal(entryFixFor('nightclub-showdown-inzone-production'), null);
});

test('names the exact gate it clears', () => {
  assert.match(entryFixFor('flappybird-inzone-2').gateDescription, /game:getready/);
});

test('fails closed on an uninspected build', () => {
  const fired = [];
  const win = fakeWin({ pathname: '/gcs/games/flappybird-inzone-2/v8/index.html', onFire: (e) => fired.push(e) });
  assert.equal(entryFixFor('flappybird-inzone-2').clear(win), true, 'reports done so nothing keeps polling');
  assert.deepEqual(fired, [], 'never fires into a build it has not inspected');
});

test('waits, without firing, while the engine is still booting', () => {
  const fired = [];
  const win = fakeWin({ bird: null, onFire: (e) => fired.push(e) });
  assert.equal(entryFixFor('flappybird-inzone-2').clear(win), false, 'asks to be called again');
  assert.deepEqual(fired, []);
});

test('fires game:getready exactly once when the bird is held disabled', () => {
  const fired = [];
  const bird = { enabled: false, findByName: () => null };
  const win = fakeWin({ bird, onFire: (e) => { fired.push(e); bird.enabled = true; } });
  const fix = entryFixFor('flappybird-inzone-2');
  assert.equal(fix.clear(win), true, 'gate cleared');
  assert.deepEqual(fired, ['game:getready']);
  assert.equal(fix.clear(win), true, 'already past the gate');
  assert.deepEqual(fired, ['game:getready'], 'does not fire again once the player has control');
});

test('leaves a player who is already in control alone', () => {
  const fired = [];
  const bird = { enabled: true, findByName: () => null };
  const win = fakeWin({ bird, onFire: (e) => fired.push(e) });
  assert.equal(entryFixFor('flappybird-inzone-2').clear(win), true);
  assert.deepEqual(fired, [], 'never interrupts live play');
});

test('reports not-ready when the fire does not take, instead of claiming success', () => {
  const bird = { enabled: false, findByName: () => null };
  const win = fakeWin({ bird, onFire: () => {} }); // engine ignores it
  assert.equal(entryFixFor('flappybird-inzone-2').clear(win), false);
});

test('never fires a second time into the same window', () => {
  const fired = [];
  const bird = { enabled: false, findByName: () => null };
  const win = fakeWin({ bird, onFire: (e) => { fired.push(e); bird.enabled = true; } });
  const fix = entryFixFor('flappybird-inzone-2');
  assert.equal(fix.clear(win), true);
  assert.deepEqual(fired, ['game:getready']);
  // The build drops the bird again after a round — a score screen, a restart,
  // a continue prompt. That is the build's business, not ours.
  bird.enabled = false;
  assert.equal(fix.clear(win), true, 'reports done rather than re-opening');
  assert.deepEqual(fired, ['game:getready'], 'still exactly one fire');
});

test('a fresh window after a reload is still opened', () => {
  const fired = [];
  const mk = () => {
    const bird = { enabled: false, findByName: () => null };
    return fakeWin({ bird, onFire: (e) => { fired.push(e); bird.enabled = true; } });
  };
  const fix = entryFixFor('flappybird-inzone-2');
  assert.equal(fix.clear(mk()), true);
  assert.equal(fix.clear(mk()), true, 'a retry or refresh is a new arrival');
  assert.deepEqual(fired, ['game:getready', 'game:getready']);
});

test('does not open a bird disabled behind a game-over screen', () => {
  const fired = [];
  const bird = { enabled: false, findByName: () => null };
  const over = { enabled: true, findByName: () => null };
  const win = fakeWin({ bird, over, onFire: (e) => fired.push(e) });
  assert.equal(entryFixFor('flappybird-inzone-2').clear(win), true);
  assert.deepEqual(fired, [], 'the screen after a round is the build\'s to own');
});
