import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAYER_ACTION_ORDER,
  TOUCH_PRIMARY,
  barCellCount,
  splitPlayerActions,
} from '../lib/player-actions.ts';

test('a phone leads with Rook, then the conversation, then navigation', () => {
  const { primary } = splitPlayerActions('touch');
  assert.deepEqual(primary, ['rook', 'chat', 'invite', 'games', 'home']);
});

test('a phone bar is six cells including More', () => {
  const split = splitPlayerActions('touch');
  assert.equal(split.needsMore, true);
  assert.equal(barCellCount(split), 6);
});

test('nothing is removed — every action is reachable on every layout', () => {
  for (const layout of ['touch', 'wide']) {
    const split = splitPlayerActions(layout);
    const reachable = new Set([...split.primary, ...split.secondary]);
    for (const id of PLAYER_ACTION_ORDER) {
      assert.ok(reachable.has(id), `${id} is unreachable on ${layout}`);
    }
  }
});

test('a wide layout shows everything and needs no More menu', () => {
  const split = splitPlayerActions('wide');
  assert.deepEqual(split.primary, [...PLAYER_ACTION_ORDER]);
  assert.deepEqual(split.secondary, []);
  assert.equal(split.needsMore, false);
});

test('an action that does not apply is absent, not present and dead', () => {
  const noFill = splitPlayerActions('touch', (id) => id !== 'fill');
  assert.ok(!noFill.primary.includes('fill'));
  assert.ok(!noFill.secondary.includes('fill'));
  assert.ok(noFill.secondary.length > 0, 'the rest of More survives');
});

test('More disappears when nothing is left to put in it', () => {
  const only = splitPlayerActions('touch', (id) => TOUCH_PRIMARY.includes(id));
  assert.equal(only.needsMore, false);
  assert.equal(barCellCount(only), 5);
});

test('both lists keep the display order', () => {
  const { primary, secondary } = splitPlayerActions('touch');
  const index = (id) => PLAYER_ACTION_ORDER.indexOf(id);
  for (const list of [primary, secondary]) {
    const positions = list.map(index);
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  }
});
