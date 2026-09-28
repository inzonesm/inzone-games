/**
 * Coverage for lib/games.ts::gameOrganicShareLink.
 *
 * Distinguishes attribution-carrying share URLs (this one) from
 * attribution-free invite URLs (liveInviteUrl — see gameplay-signals.test.mjs
 * for the negative test that keeps invites clean).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameOrganicShareLink, gameWebLink } from '../lib/game-share-links.ts';
import { liveInviteUrl } from '../lib/play-session-core.ts';

test('gameOrganicShareLink carries utm_source=share and utm_medium=organic', () => {
  const url = new URL(gameOrganicShareLink('nightclub-showdown-inzone-production'));
  assert.equal(url.hostname, 'inzone.games');
  assert.equal(url.pathname, '/games/nightclub-showdown-inzone-production');
  assert.equal(url.searchParams.get('utm_source'), 'share');
  assert.equal(url.searchParams.get('utm_medium'), 'organic');
});

test('gameOrganicShareLink does not carry a session id or private surface param', () => {
  const url = new URL(gameOrganicShareLink('clescaperoad'));
  // Public share URL — must never carry session or invite ids.
  assert.equal(url.searchParams.get('session'), null);
  assert.equal(url.searchParams.get('invite'), null);
});

test('gameOrganicShareLink encodes the game id — protects against injection', () => {
  const url = gameOrganicShareLink('has spaces/and&stuff');
  assert.ok(!url.includes('has spaces/and&stuff'));
  assert.ok(url.includes('has%20spaces') || url.includes('has+spaces'));
});

test('gameOrganicShareLink is distinct from gameWebLink — the latter stays UTM-free', () => {
  const plain = gameWebLink('nightclub-showdown-inzone-production');
  const tagged = gameOrganicShareLink('nightclub-showdown-inzone-production');
  assert.notEqual(plain, tagged);
  // The plain link has no query params at all.
  assert.ok(!plain.includes('utm_'));
});

test('invite URLs (liveInviteUrl) must remain UTM-free — mirrors the existing invariant', () => {
  // This test doesn't own the invariant (that's gameplay-signals.test.mjs).
  // It stands as a reminder here so a future contributor changing this file
  // sees the rule alongside the organic-share code.
  const url = new URL(
    liveInviteUrl('https://www.inzone.games', {
      gameId: 'nightclub-showdown-inzone-production',
      sessionId: 'c'.repeat(32),
    }),
  );
  assert.equal(url.searchParams.get('utm_source'), null);
  assert.equal(url.searchParams.get('utm_medium'), null);
});
