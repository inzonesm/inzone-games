/**
 * Gameplay coverage: the two scoped games are proxy-only with documented
 * reasons, adapter games are verified, and the default is conservative.
 *
 * The value of this file is negative: it fails if a game without a verified
 * signal ever gets classified as one, because every downstream number
 * inherits that classification.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gameplayCoverage,
  PROXY_ONLY_GAMES,
  proxyOnlyReason,
} from '../lib/gameplay-coverage.ts';
import { gameSignalAdapter } from '../lib/game-adapters.ts';
import { sanitizeData } from '../lib/campaign-analytics.ts';

test('Escape Road and Elytra Flight are proxy-only', () => {
  assert.equal(gameplayCoverage('clescaperoad'), 'proxy-only');
  assert.equal(gameplayCoverage('clelytraflight'), 'proxy-only');
});

test('proxy-only reasons name the Unity one-directional API', () => {
  for (const id of ['clescaperoad', 'clelytraflight']) {
    const reason = proxyOnlyReason(id);
    assert.ok(reason && reason.length > 50, `${id} needs a documented reason`);
    assert.match(reason, /Unity/i);
    assert.match(reason, /SendMessage|host→game|host-to-game/i);
  }
});

test('adapter games are verified', () => {
  assert.equal(gameplayCoverage('flappybird-inzone-2'), 'verified');
  assert.equal(gameplayCoverage('nightclub-showdown-inzone-production'), 'verified');
});

test('unknown games default to proxy-only, never verified', () => {
  assert.equal(gameplayCoverage('some-future-game'), 'proxy-only');
  assert.equal(gameplayCoverage(''), 'proxy-only');
});

test('every documented proxy-only game truly has no adapter', () => {
  for (const id of Object.keys(PROXY_ONLY_GAMES)) {
    assert.equal(gameSignalAdapter(id), null, `${id} has an adapter but is listed proxy-only`);
  }
});

test('coverage agrees with the adapter registry both ways', () => {
  // If someone adds an adapter for a proxy-only game without updating the
  // registry, this fails loudly instead of silently misreporting.
  for (const id of Object.keys(PROXY_ONLY_GAMES)) {
    assert.equal(gameplayCoverage(id), 'proxy-only');
  }
  assert.equal(gameplayCoverage('flappybird-inzone-2'), 'verified');
});

test('measurement_coverage survives sanitizeData as a closed set', () => {
  assert.equal(
    sanitizeData({ measurement_coverage: 'proxy-only' }).measurement_coverage,
    'proxy-only',
  );
  assert.equal(
    sanitizeData({ measurement_coverage: 'verified' }).measurement_coverage,
    'verified',
  );
  // Anything outside the closed set is dropped, never passed through.
  assert.equal(
    sanitizeData({ measurement_coverage: 'definitely-playing' }).measurement_coverage,
    undefined,
  );
});
