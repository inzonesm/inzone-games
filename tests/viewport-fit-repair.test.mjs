/**
 * The two repairs the injected viewport-fit script makes to a build that did
 * not size itself, and the case it must keep its hands off.
 *
 * These are request-time injections into HTML we serve; nothing of the build's
 * own files is modified and no monetization is touched. Rollback is reverting
 * this script.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { VIEWPORT_FIT_SCRIPT } from '../lib/game-hosting.ts';

test('an unsized canvas is recognised only at the exact browser default box', () => {
  assert.match(VIEWPORT_FIT_SCRIPT, /DEFAULT_CANVAS_W = 300/);
  assert.match(VIEWPORT_FIT_SCRIPT, /DEFAULT_CANVAS_H = 150/);
  // Author sizing of any kind disqualifies it — that is a build's own choice.
  assert.match(VIEWPORT_FIT_SCRIPT, /c\.style\.width \|\| c\.style\.height\)\) return false/);
  assert.match(VIEWPORT_FIT_SCRIPT, /cs\.width === DEFAULT_CANVAS_W \+ 'px'/);
});

test('an authored letterbox is still left alone', () => {
  // The overflow branch is unchanged; enlargement happens only for `unsized`.
  assert.match(VIEWPORT_FIT_SCRIPT, /if \(!overflows && !unsized\) return;/);
});

test('a zero-sized canvas is still skipped unless it is the default box', () => {
  assert.match(VIEWPORT_FIT_SCRIPT, /if \(!unsized && \(rect\.width === 0 \|\| rect\.height === 0\)\) return;/);
});

test("Unity's mobile class is added, never its desktop one removed wholesale", () => {
  assert.match(VIEWPORT_FIT_SCRIPT, /unity-mobile/);
  assert.match(VIEWPORT_FIT_SCRIPT, /indexOf\('unity-desktop'\) === -1\) return;/);
  // Only on a narrow touch viewport.
  assert.match(VIEWPORT_FIT_SCRIPT, /if \(vw > 900\) return;/);
  assert.match(VIEWPORT_FIT_SCRIPT, /ontouchstart/);
});

test('nothing here removes a build\'s own scripts or ad slots', () => {
  assert.doesNotMatch(VIEWPORT_FIT_SCRIPT, /removeChild|remove\(\)|innerHTML\s*=/);
});
