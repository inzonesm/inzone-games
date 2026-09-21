import test from 'node:test';
import assert from 'node:assert/strict';
import { canFillScreen, fillScreenOffered, FILL_SCREEN_COPY } from '../lib/fill-screen.ts';

const base = {
  hasOrientationHint: true,
  portrait: true,
  narrow: true,
  supported: true,
  frameReady: true,
};

test('offers the rotated stage only when every condition holds', () => {
  assert.equal(fillScreenOffered(base), true);
});

test('a game with no measured orientation gain is never offered it', () => {
  assert.equal(fillScreenOffered({ ...base, hasOrientationHint: false }), false);
});

test('landscape and desktop viewports are not offered it', () => {
  assert.equal(fillScreenOffered({ ...base, portrait: false }), false);
  assert.equal(fillScreenOffered({ ...base, narrow: false }), false);
});

test('an engine without size containment keeps the portrait layout', () => {
  assert.equal(fillScreenOffered({ ...base, supported: false }), false);
  assert.equal(canFillScreen(() => false), false);
  assert.equal(canFillScreen((property, value) => property === 'container-type' && value === 'size'), true);
});

test('a frame that is not up yet has nothing to rotate', () => {
  assert.equal(fillScreenOffered({ ...base, frameReady: false }), false);
});

test('canFillScreen is false rather than throwing where CSS.supports is absent', () => {
  assert.equal(canFillScreen(), typeof CSS !== 'undefined' ? canFillScreen() : false);
  assert.equal(canFillScreen(() => { throw new Error('nope'); }), false);
});

test('both directions are labelled', () => {
  assert.ok(FILL_SCREEN_COPY.fill && FILL_SCREEN_COPY.restore);
  assert.notEqual(FILL_SCREEN_COPY.fill, FILL_SCREEN_COPY.restore);
});
