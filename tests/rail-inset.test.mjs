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

test('a bar on a half pixel reserves the pixel it paints into', () => {
  /* Measured on a hosted phone viewport: the bar painted from y=779.5 with a
     height of 64.5. `offsetTop` rounds to nearest and reported 780, so the gap
     below it read 64 and the stage was inset by 64 — leaving half a pixel of
     bar over the bottom row of the game. `offsetHeight` rounds the other way
     and reports 65, and the larger of the two readings is the one that cannot
     cover anything. */
  const body = rect(0, 0, 390, 844);
  assert.deepEqual(railInsetFrom(rect(0, 780, 390, 65), body), { x: 0, y: 65 });
  const wide = rect(0, 0, 1356, 900);
  assert.deepEqual(railInsetFrom(rect(1288, 0, 69, 900), wide), { x: 69, y: 0 });
});

test('reserving more is allowed; reserving less never is', () => {
  // Whatever the two readings disagree by, the inset clears the bar's own box.
  const body = rect(0, 0, 390, 844);
  for (const [top, height] of [[780, 65], [779, 65], [781, 63], [774, 70]]) {
    const { y } = railInsetFrom(rect(0, top, 390, height), body);
    assert.ok(y >= height, `inset ${y} does not clear a ${height}px bar`);
    assert.ok(y >= body.height - top, `inset ${y} does not reach the bar at ${top}`);
  }
});
