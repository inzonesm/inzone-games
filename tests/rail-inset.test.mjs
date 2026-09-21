import test from 'node:test';
import assert from 'node:assert/strict';
import { railInsetFrom } from '../lib/rail-inset.ts';

// Layout boxes, the way offsetWidth/offsetTop report them: relative to the
// offset parent and unaffected by a rotation above them.
const rect = (x, y, w, h) => ({ left: x, top: y, width: w, height: h });

test('a full-width bar costs vertical space', () => {
  const body = rect(0, 0, 390, 844);
  const rail = rect(0, 774, 390, 70);
  assert.deepEqual(railInsetFrom(rail, body), { x: 0, y: 70 });
});

test('an edge-hugging bar costs horizontal space', () => {
  const body = rect(0, 0, 844, 390);
  const rail = rect(791, 0, 53, 390);
  assert.deepEqual(railInsetFrom(rail, body), { x: 53, y: 0 });
});

test('a floating desktop pill reserves its own margin too', () => {
  const body = rect(0, 0, 1280, 800);
  const rail = rect(1198, 300, 68, 420);
  assert.deepEqual(railInsetFrom(rail, body), { x: 82, y: 0 });
});

test('a bar that grew taller than yesterday is still measured correctly', () => {
  const body = rect(0, 0, 390, 844);
  assert.equal(railInsetFrom(rect(0, 760, 390, 84), body).y, 84);
  assert.equal(railInsetFrom(rect(0, 786, 390, 58), body).y, 58);
});

test('an unmeasurable bar reserves nothing rather than a wrong guess', () => {
  const body = rect(0, 0, 390, 844);
  assert.deepEqual(railInsetFrom(rect(0, 0, 0, 0), body), { x: 0, y: 0 });
});

test('a rotated player still reserves the bar on the right axis', () => {
  // Fill screen rotates the whole player. Layout boxes are unchanged by that,
  // so a bottom bar in a 785x390 rotated body is still a bottom bar.
  const body = rect(0, 0, 785, 390);
  const rail = rect(0, 331, 785, 59);
  assert.deepEqual(railInsetFrom(rail, body), { x: 0, y: 59 });
});
