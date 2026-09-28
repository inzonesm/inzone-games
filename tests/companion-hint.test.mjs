/**
 * Coverage for lib/companion-hint.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HINT_DELAY_MS,
  HINT_EVENT_NAME,
  HINT_LIFETIME_MS,
  HINT_STORAGE_PREFIX,
  ROOK_HINT_COPY,
  shouldShowRookHint,
} from '../lib/companion-hint.ts';

test('copy is short and neutral — no gameplay claim, no imperative to win', () => {
  assert.ok(ROOK_HINT_COPY.length > 0);
  assert.ok(ROOK_HINT_COPY.length <= 30);
  const overpromise = /\bhelp\b|\bwin\b|\btip\b|\bcheat\b|\bhint\b|\bstrategy\b/i;
  assert.ok(!overpromise.test(ROOK_HINT_COPY), `"${ROOK_HINT_COPY}" implies gameplay assistance`);
});

test('timings are within a sensible band for a WebView bouncer to see', () => {
  // Users on TikTok WebView traffic bounce at p50 ≈ 1s. The hint must
  // appear BEFORE the bounce window closes for the median user. But it
  // also can't paint on top of a boot spinner. 2s is the compromise.
  assert.ok(HINT_DELAY_MS >= 1000 && HINT_DELAY_MS <= 4000);
  // Lifetime long enough to read and act, short enough not to nag.
  assert.ok(HINT_LIFETIME_MS >= 3000 && HINT_LIFETIME_MS <= 10000);
});

test('storage key prefix is namespaced and won\'t collide with other InZone keys', () => {
  assert.match(HINT_STORAGE_PREFIX, /^inzone\./);
  assert.match(HINT_STORAGE_PREFIX, /\.$/, 'trailing dot so the game id concatenates cleanly');
});

test('event name mirrors the companion_* family — never verified gameplay', () => {
  assert.equal(HINT_EVENT_NAME, 'companion_hint_shown');
  assert.match(HINT_EVENT_NAME, /^companion_/);
});

test('shouldShowRookHint: happy path — flagship, cross-origin, unaware user, frame ready', () => {
  assert.equal(
    shouldShowRookHint({
      rookEnabled: true,
      hasSameOriginAdapter: false,
      voiceEnabled: false,
      alreadyShown: false,
      frameLoaded: true,
    }),
    true,
  );
});

test('shouldShowRookHint: same-origin adapter games do NOT get the hint', () => {
  // Nightclub / Flappy have their own discovery affordances. Painting the
  // hint on them would be noise, and their bounce rates are already low.
  assert.equal(
    shouldShowRookHint({
      rookEnabled: true,
      hasSameOriginAdapter: true,
      voiceEnabled: false,
      alreadyShown: false,
      frameLoaded: true,
    }),
    false,
  );
});

test('shouldShowRookHint: users who already enabled voice do not need it', () => {
  assert.equal(
    shouldShowRookHint({
      rookEnabled: true,
      hasSameOriginAdapter: false,
      voiceEnabled: true,
      alreadyShown: false,
      frameLoaded: true,
    }),
    false,
  );
});

test('shouldShowRookHint: never re-fires in the same session', () => {
  assert.equal(
    shouldShowRookHint({
      rookEnabled: true,
      hasSameOriginAdapter: false,
      voiceEnabled: false,
      alreadyShown: true,
      frameLoaded: true,
    }),
    false,
  );
});

test('shouldShowRookHint: waits for the iframe to load — no painting over the boot spinner', () => {
  assert.equal(
    shouldShowRookHint({
      rookEnabled: true,
      hasSameOriginAdapter: false,
      voiceEnabled: false,
      alreadyShown: false,
      frameLoaded: false,
    }),
    false,
  );
});

test('shouldShowRookHint: Rook must be enabled for this game (isFlagshipId)', () => {
  assert.equal(
    shouldShowRookHint({
      rookEnabled: false,
      hasSameOriginAdapter: false,
      voiceEnabled: false,
      alreadyShown: false,
      frameLoaded: true,
    }),
    false,
  );
});
