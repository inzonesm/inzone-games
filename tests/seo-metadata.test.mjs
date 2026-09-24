/**
 * Pure-helper coverage for lib/seo/game-metadata.ts. The layout / sitemap /
 * robots modules are thin wrappers around firebase-admin plus these helpers;
 * mocking firebase-admin from node:test is more scaffolding than the marginal
 * coverage would pay for, so we test the helpers here and lean on typecheck +
 * the load-bearing suite for the wrappers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGameDescription,
  buildGameJsonLd,
  buildGameTitle,
  buildSitemap,
  gameCanonicalPath,
  gameCanonicalUrl,
  SITE_ORIGIN,
} from '../lib/seo/game-metadata.ts';

const NIGHTCLUB = {
  name: 'Nightclub Showdown',
  description: 'A retro brawler at the door of the dance floor.',
  iconUrl: 'https://storage.googleapis.com/inzone-html/games/nightclub/icon.png',
};

test('buildGameTitle names the game and falls back cleanly', () => {
  assert.equal(buildGameTitle(NIGHTCLUB), 'Nightclub Showdown — Play Free on InZone');
  assert.equal(buildGameTitle(null), 'Play Free Browser Games on InZone');
  assert.equal(buildGameTitle({ name: '   ', description: 'x', iconUrl: '' }), 'Play Free Browser Games on InZone');
  assert.equal(buildGameTitle({ name: '  Kart Bros  ', description: '', iconUrl: '' }), 'Kart Bros — Play Free on InZone');
});

test('buildGameDescription prefers stored copy, else derives from name, else defaults', () => {
  assert.equal(buildGameDescription(NIGHTCLUB), 'A retro brawler at the door of the dance floor.');
  const derived = buildGameDescription({ name: 'Karate Bros', description: '   ', iconUrl: '' });
  assert.match(derived, /Karate Bros/);
  assert.match(derived, /no install/i);
  const fallback = buildGameDescription(null);
  assert.match(fallback, /InZone/);
  assert.match(fallback, /No install/i);
});

test('canonical URL uses the apex origin and encodes the id', () => {
  assert.equal(gameCanonicalPath('flappybird-inzone-2'), '/games/flappybird-inzone-2');
  assert.equal(
    gameCanonicalUrl('nightclub-showdown-inzone-production'),
    'https://inzone.games/games/nightclub-showdown-inzone-production',
  );
  // A pasted markdown-corrupted id must not slip through as a valid canonical.
  assert.equal(
    gameCanonicalUrl('nightclub-showdown-inzone-production`**'),
    'https://inzone.games/games/nightclub-showdown-inzone-production%60**',
  );
});

test('SITE_ORIGIN is the CLAUDE.md production URL, not the www subdomain', () => {
  assert.equal(SITE_ORIGIN, 'https://inzone.games');
});

test('buildGameJsonLd emits a VideoGame block only when the game has a name', () => {
  const json = buildGameJsonLd('nightclub-showdown-inzone-production', NIGHTCLUB);
  assert.ok(json);
  assert.equal(json['@type'], 'VideoGame');
  assert.equal(json.name, NIGHTCLUB.name);
  assert.equal(
    json.url,
    'https://inzone.games/games/nightclub-showdown-inzone-production',
  );
  assert.equal(json.image, NIGHTCLUB.iconUrl);
  assert.deepEqual(json.offers, {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
    availability: 'https://schema.org/InStock',
    url: 'https://inzone.games/games/nightclub-showdown-inzone-production',
  });

  assert.equal(buildGameJsonLd('x', null), null);
  assert.equal(buildGameJsonLd('x', { name: '', description: '', iconUrl: '' }), null);
  assert.equal(buildGameJsonLd('x', { name: '   ', description: '', iconUrl: '' }), null);

  const noIcon = buildGameJsonLd('kart-bros', { name: 'Kart Bros', description: '', iconUrl: '' });
  assert.ok(noIcon);
  assert.equal(noIcon.image, undefined);
});

test('buildSitemap includes static routes even with no game ids', () => {
  const empty = buildSitemap([]);
  assert.equal(empty.length, 2);
  assert.equal(empty[0].url, 'https://inzone.games/');
  assert.equal(empty[0].priority, 1);
  assert.equal(empty[1].url, 'https://inzone.games/games');
  assert.equal(empty[1].priority, 0.9);
});

test('buildSitemap emits one entry per unique id and skips empty/dupe ids', () => {
  const now = new Date('2026-09-24T00:00:00Z');
  const map = buildSitemap(
    ['flappybird-inzone-2', 'flappybird-inzone-2', '', '   ', 'nightclub-showdown-inzone-production'],
    now,
  );
  assert.equal(map.length, 4);
  assert.equal(map[2].url, 'https://inzone.games/games/flappybird-inzone-2');
  assert.equal(map[3].url, 'https://inzone.games/games/nightclub-showdown-inzone-production');
  assert.equal(map[2].lastModified.toISOString(), now.toISOString());
  assert.equal(map[2].priority, 0.7);
  assert.equal(map[2].changeFrequency, 'weekly');
});
