import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISPLAY_COPY,
  detectDisplayCapabilities,
  fullscreenOffered,
  isFullscreen,
  orientationHintShown,
} from '../lib/display-mode.ts';

/** A browser stand-in. Absent members mean the capability is absent. */
const fakeWin = ({ request, webkitRequest, enabled, webkitEnabled, lock } = {}) => ({
  Element: { prototype: {
    ...(request ? { requestFullscreen: () => {} } : {}),
    ...(webkitRequest ? { webkitRequestFullscreen: () => {} } : {}),
  } },
  document: {
    ...(enabled === undefined ? {} : { fullscreenEnabled: enabled }),
    ...(webkitEnabled === undefined ? {} : { webkitFullscreenEnabled: webkitEnabled }),
  },
  screen: lock ? { orientation: { lock: () => {} } } : { orientation: {} },
});

test('a browser with the Fullscreen API and permission reports it', () => {
  const caps = detectDisplayCapabilities(fakeWin({ request: true, enabled: true }));
  assert.deepEqual(caps, { elementFullscreen: true, orientationLock: false });
});

test('the webkit spelling counts', () => {
  const caps = detectDisplayCapabilities(fakeWin({ webkitRequest: true, webkitEnabled: true, lock: true }));
  assert.deepEqual(caps, { elementFullscreen: true, orientationLock: true });
});

test('the method existing is not enough — the document must permit it', () => {
  // An iframe without allowfullscreen, or a policy that forbids it, reports
  // the method and refuses the call.
  const caps = detectDisplayCapabilities(fakeWin({ request: true, enabled: false }));
  assert.equal(caps.elementFullscreen, false);
});

test('iPhone Safari today: no element fullscreen, no orientation lock', () => {
  const caps = detectDisplayCapabilities(fakeWin({}));
  assert.deepEqual(caps, { elementFullscreen: false, orientationLock: false });
  assert.equal(fullscreenOffered({ capabilities: caps, narrow: true, frameReady: true }), false);
});

test('no window at all reports nothing rather than guessing', () => {
  assert.deepEqual(detectDisplayCapabilities(undefined), { elementFullscreen: false, orientationLock: false });
});

test('a window that throws on probing reports nothing', () => {
  const hostile = { get document() { throw new Error('nope'); } };
  assert.deepEqual(detectDisplayCapabilities(hostile), { elementFullscreen: false, orientationLock: false });
});

test('fullscreen is offered only where it is supported and buys something', () => {
  const caps = { elementFullscreen: true, orientationLock: false };
  assert.equal(fullscreenOffered({ capabilities: caps, narrow: true, frameReady: true }), true);
  assert.equal(fullscreenOffered({ capabilities: caps, narrow: false, frameReady: true }), false);
  assert.equal(fullscreenOffered({ capabilities: caps, narrow: true, frameReady: false }), false);
});

test('where fullscreen is unavailable, a measured orientation hint takes its place', () => {
  const none = { elementFullscreen: false, orientationLock: false };
  const base = { capabilities: none, hasOrientationHint: true, portrait: true, narrow: true, frameReady: true };
  assert.equal(orientationHintShown(base), true);
  // Never invented: a build nobody measured gets no hint.
  assert.equal(orientationHintShown({ ...base, hasOrientationHint: false }), false);
  // And never shown where the player already has the room.
  assert.equal(orientationHintShown({ ...base, portrait: false }), false);
  assert.equal(orientationHintShown({ ...base, narrow: false }), false);
});

test('the hint and the control are never both offered', () => {
  const caps = { elementFullscreen: true, orientationLock: false };
  const input = { capabilities: caps, hasOrientationHint: true, portrait: true, narrow: true, frameReady: true };
  assert.equal(orientationHintShown(input), false);
  assert.equal(fullscreenOffered({ capabilities: caps, narrow: true, frameReady: true }), true);
});

test('isFullscreen reads either spelling and is false without a document', () => {
  assert.equal(isFullscreen(undefined), false);
  assert.equal(isFullscreen({}), false);
  assert.equal(isFullscreen({ fullscreenElement: {} }), true);
  assert.equal(isFullscreen({ webkitFullscreenElement: {} }), true);
});

test('both directions are labelled', () => {
  assert.notEqual(DISPLAY_COPY.enter, DISPLAY_COPY.exit);
  assert.ok(DISPLAY_COPY.enterLabel && DISPLAY_COPY.exitLabel);
});
