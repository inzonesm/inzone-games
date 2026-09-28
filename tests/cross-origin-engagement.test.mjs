/**
 * State-machine coverage for lib/cross-origin-engagement.ts.
 *
 * These pin the invariants that keep cross-origin proxies from being
 * mistaken for verified gameplay:
 *   - Every emitted name is distinct from the four VERIFIED_GAMEPLAY_EVENTS.
 *   - Thresholds fire exactly once each, in order.
 *   - Idle time (no recent input) is not credited.
 *   - Off-screen time (hidden tab / iframe scrolled away) is not credited.
 *   - Bounce reason distinguishes "iframe never even loaded" from
 *     "loaded but user never touched it".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_INPUT_WINDOW_MS,
  CROSS_ORIGIN_EVENTS,
  DWELL_THRESHOLDS_MS,
  ENGAGEMENT_TICK_MS,
  INTERSECT_THRESHOLD,
  bounceReasonAtUnload,
  dwellEventName,
  initialEngagementState,
  isActiveTick,
  tickAccumulator,
} from '../lib/cross-origin-engagement.ts';
import { VERIFIED_GAMEPLAY_EVENTS } from '../lib/campaign-analytics.ts';

test('event names are distinct from VERIFIED_GAMEPLAY_EVENTS — proxies never masquerade', () => {
  const verified = new Set(VERIFIED_GAMEPLAY_EVENTS);
  for (const name of Object.values(CROSS_ORIGIN_EVENTS)) {
    assert.ok(
      !verified.has(name),
      `cross-origin proxy "${name}" must not overlap the verified event set`,
    );
  }
});

test('constants have the operationally-agreed values — bumping these requires a report-format change', () => {
  assert.equal(INTERSECT_THRESHOLD, 0.5);
  assert.equal(ACTIVE_INPUT_WINDOW_MS, 8000);
  assert.equal(ENGAGEMENT_TICK_MS, 500);
  assert.deepEqual([...DWELL_THRESHOLDS_MS], [15_000, 60_000]);
});

test('isActiveTick: on-screen + recent input = active', () => {
  const now = 10_000;
  assert.equal(
    isActiveTick({ now, onScreen: true, lastInputAt: now - 3000 }),
    true,
  );
});

test('isActiveTick: off-screen tab is never active, even with fresh input', () => {
  const now = 10_000;
  assert.equal(
    isActiveTick({ now, onScreen: false, lastInputAt: now - 100 }),
    false,
  );
});

test('isActiveTick: no input recorded yet = not active (user landed but hasn\'t touched anything)', () => {
  const now = 10_000;
  assert.equal(isActiveTick({ now, onScreen: true, lastInputAt: null }), false);
});

test('isActiveTick: idle past ACTIVE_INPUT_WINDOW_MS is not credited — errs toward under-counting', () => {
  const now = 10_000;
  assert.equal(
    isActiveTick({ now, onScreen: true, lastInputAt: now - (ACTIVE_INPUT_WINDOW_MS + 1) }),
    false,
  );
  // Right at the boundary counts as active (<=, not <).
  assert.equal(
    isActiveTick({ now, onScreen: true, lastInputAt: now - ACTIVE_INPUT_WINDOW_MS }),
    true,
  );
});

test('tickAccumulator: credits deltas while active, skips while inactive', () => {
  const s = initialEngagementState();
  tickAccumulator(s, 500, true);
  tickAccumulator(s, 500, true);
  tickAccumulator(s, 500, false); // idle tick, not credited
  tickAccumulator(s, 500, true);
  assert.equal(s.activeAccumMs, 1500);
});

test('tickAccumulator: 15s threshold fires exactly once, in order', () => {
  const s = initialEngagementState();
  // 30 ticks of 500ms = 15,000ms exactly.
  let allCrossings = [];
  for (let i = 0; i < 30; i++) {
    const crossed = tickAccumulator(s, 500, true);
    allCrossings.push(...crossed);
  }
  assert.deepEqual(allCrossings, [15_000]);
  // A 31st tick does not re-fire 15s.
  const again = tickAccumulator(s, 500, true);
  assert.deepEqual(again, []);
});

test('tickAccumulator: both thresholds fire in the same run, 15s before 60s', () => {
  const s = initialEngagementState();
  let allCrossings = [];
  // 120 ticks of 500ms = 60,000ms exactly.
  for (let i = 0; i < 120; i++) {
    const crossed = tickAccumulator(s, 500, true);
    allCrossings.push(...crossed);
  }
  assert.deepEqual(allCrossings, [15_000, 60_000]);
});

test('tickAccumulator: a single large delta can cross both thresholds at once', () => {
  const s = initialEngagementState();
  const crossed = tickAccumulator(s, 60_000, true);
  assert.deepEqual(crossed, [15_000, 60_000], 'both thresholds cross in one tick');
});

test('tickAccumulator: negative or zero delta is a no-op', () => {
  const s = initialEngagementState();
  s.activeAccumMs = 5000;
  assert.deepEqual(tickAccumulator(s, 0, true), []);
  assert.deepEqual(tickAccumulator(s, -100, true), []);
  assert.equal(s.activeAccumMs, 5000);
});

test('dwellEventName: only 15s and 60s map to event names', () => {
  assert.equal(dwellEventName(15_000), 'foreground_dwell_15s');
  assert.equal(dwellEventName(60_000), 'foreground_dwell_60s');
  assert.equal(dwellEventName(30_000), null);
});

test('bounceReasonAtUnload: engaged users do not bounce', () => {
  const s = initialEngagementState();
  s.iframeLoaded = true;
  s.iframeEngaged = true;
  s.activeAccumMs = 45_000;
  assert.equal(bounceReasonAtUnload(s), null);
});

test('bounceReasonAtUnload: iframe loaded but never engaged → no_engagement', () => {
  const s = initialEngagementState();
  s.iframeLoaded = true;
  s.iframeEngaged = false;
  assert.equal(bounceReasonAtUnload(s), 'no_engagement');
});

test('bounceReasonAtUnload: iframe never loaded → no_frame_load (worse bounce)', () => {
  const s = initialEngagementState();
  s.iframeLoaded = false;
  s.iframeEngaged = false;
  assert.equal(bounceReasonAtUnload(s), 'no_frame_load');
});

test('WebView / news-app bounce scenario (TikTok surge): ~1s active + never engaged → session_bounce with no_engagement', () => {
  // Simulate the reported bounce: user lands, the iframe loads within
  // ~700ms, the user's finger hovers on the parent chrome for ~1s
  // producing pointermove events, then they close the tab.
  const s = initialEngagementState();
  s.iframeLoaded = true; // load fired at T+718ms
  // Two ticks of active hover on the parent (total 1000ms).
  tickAccumulator(s, 500, true);
  tickAccumulator(s, 500, true);
  // User never tapped the iframe itself.
  assert.equal(s.iframeEngaged, false);
  assert.equal(s.activeAccumMs, 1000);
  // On unload: bounce with reason no_engagement.
  assert.equal(bounceReasonAtUnload(s), 'no_engagement');
});

test('happy path: 30-second engaged play emits iframe_engaged then foreground_dwell_15s but not 60s', () => {
  const s = initialEngagementState();
  s.iframeLoaded = true;
  s.iframeEngaged = true; // The probe would set this on first pointerdown-inside-iframe.
  const crossings = [];
  for (let i = 0; i < 60; i++) {
    crossings.push(...tickAccumulator(s, 500, true));
  }
  assert.deepEqual(crossings, [15_000]);
  assert.equal(bounceReasonAtUnload(s), null, 'engaged users do not bounce');
});
