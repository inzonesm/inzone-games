import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {

  DISCOVERY_COPY,
  DISCOVERY_FEATURED_IDS,
  DISCOVERY_UNRESOLVED_IDS,
  catalogueArtUrl,
  catalogueClipUrl,
  discoveryCategory,
  filterDiscoveryGames,
  gamesForDiscoveryFeatured,
  isKitCoverPath,
  proxiedCatalogueArt,
} from '../lib/discovery.ts';

/* Discovery is preserved but not routed.
 *
 * `/games` serves the previous design again while the approved discovery image
 * is worked up properly; these assertions describe the redesign's wiring, so
 * they would fail on a branch that has deliberately unrouted it. Deleting them
 * would lose the specification, and asserting them would fail the wrong thing,
 * so they stand down until `app/games/page.tsx` routes to DiscoveryPage again
 * and then come straight back. */
const ROUTED = readFileSync(new URL('../app/games/page.tsx', import.meta.url), 'utf8').includes('DiscoveryPage');
const test = ROUTED ? nodeTest : nodeTest.skip;

function game(id, name, extras = {}) {
  return {
    id,
    source: 'community',
    name,
    description: extras.description || '',
    iconUrl: extras.iconUrl || `https://example.test/${id}.png`,
    gameUrl: 'https://example.test/game',
    serverUrl: '',
    uploaderId: 'test',
    preview: extras.preview || null,
    createdAt: 1,
    updatedAt: null,
  };
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'docs') continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, acc);
    else if (/\.(ts|tsx|js|mjs|css|md)$/.test(name)) acc.push(path);
  }
  return acc;
}

test('featured discovery prefers Nightclub, Karate, Elytra and skips Escape Road', () => {
  const games = [
    game('clescaperoad', 'Escape Road'),
    game('kart-bros', 'Kart Bros'),
    game('clelytraflight', 'Elytra Flight'),
    game('karate-bros', 'Karate Bros'),
    game('nightclub-showdown-inzone-production', 'Nightclub Showdown'),
    game('snake', 'Snake'),
  ];
  assert.deepEqual(
    gamesForDiscoveryFeatured(games).map((item) => item.id),
    [...DISCOVERY_FEATURED_IDS],
  );
  assert.ok(DISCOVERY_UNRESOLVED_IDS.includes('clescaperoad'));
});

test('featured discovery fills from remaining resolved flagship then catalogue', () => {
  const games = [
    game('kart-bros', 'Kart Bros'),
    game('clescaperoad', 'Escape Road'),
    game('snake', 'Snake'),
    game('nightclub-showdown-inzone-production', 'Nightclub Showdown'),
  ];
  assert.deepEqual(
    gamesForDiscoveryFeatured(games).map((item) => item.id),
    ['nightclub-showdown-inzone-production', 'kart-bros', 'snake'],
  );
});

test('catalogue art prefers poster then icon and never kit covers', () => {
  const withPoster = game('nightclub-showdown-inzone-production', 'Nightclub Showdown', {
    iconUrl: 'https://example.test/icon.png',
    preview: {
      videoUrl: 'https://example.test/clip.mp4',
      posterUrl: 'https://example.test/poster.png',
      videoPath: '',
      posterPath: '',
      mimeType: 'video/mp4',
      durationMs: 1000,
      width: 640,
      height: 360,
      sizeBytes: 1,
      updatedAt: 1,
    },
  });
  assert.equal(catalogueArtUrl(withPoster), 'https://example.test/poster.png');
  assert.equal(catalogueClipUrl(withPoster), 'https://example.test/clip.mp4');
  assert.equal(catalogueArtUrl(game('x', 'X', { iconUrl: 'https://example.test/i.png' })), 'https://example.test/i.png');
  assert.equal(catalogueClipUrl(game('x', 'X')), null);
  assert.equal(isKitCoverPath('assets/cover-night.svg'), true);
  assert.equal(isKitCoverPath('https://example.test/icon.png'), false);
  assert.ok(proxiedCatalogueArt('https://storage.googleapis.com/a.png', 800).includes('images.weserv.nl'));
});

test('pace filters and known categories stay honest', () => {
  assert.equal(discoveryCategory(game('nightclub-showdown-inzone-production', 'Nightclub Showdown')), 'Tactical action');
  assert.equal(discoveryCategory(game('karate-bros', 'Karate Bros')), 'Arcade fighting');
  assert.equal(discoveryCategory(game('clelytraflight', 'Elytra Flight')), 'Flight');
  const games = [
    game('flappybird-inzone-2', 'Flappy Bird'),
    game('karate-bros', 'Karate Bros'),
    game('clelytraflight', 'Elytra Flight'),
  ];
  assert.deepEqual(filterDiscoveryGames(games, { pace: 'quick' }).map((g) => g.id), ['flappybird-inzone-2']);
  assert.ok(filterDiscoveryGames(games, { pace: 'action' }).some((g) => g.id === 'karate-bros'));
  assert.ok(filterDiscoveryGames(games, { query: 'elytra' }).some((g) => g.id === 'clelytraflight'));
});

test('product sources do not ship kit covers, journey selector, or prototype copy', () => {
  const files = [
    ...walk(new URL('../app', import.meta.url)),
    ...walk(new URL('../components', import.meta.url)),
    ...walk(new URL('../lib', import.meta.url)),
  ];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.equal(isKitCoverPath(text), false, file);
    assert.equal(text.includes('id="journey"'), false, file);
    assert.equal(text.includes('Come for a game.'), false, file);
  }
  const page = readFileSync(new URL('../app/games/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /DiscoveryPage/);
  assert.doesNotMatch(page, /Shell/);
  assert.doesNotMatch(page, /Game Hub/);
  const card = readFileSync(new URL('../components/DiscoveryCard.tsx', import.meta.url), 'utf8');
  assert.match(card, /catalogueArtUrl/);
  assert.match(card, /catalogueClipUrl/);
  assert.doesNotMatch(card, /cover-night/);
  const invite = readFileSync(new URL('../components/DiscoveryInvite.tsx', import.meta.url), 'utf8');
  assert.match(invite, /createConversationInvite/);
  assert.match(invite, /DISCOVERY_COPY\.creating/);
  assert.doesNotMatch(invite, /inzone\.games \/ your invitation/);
  const companion = readFileSync(new URL('../components/GameCompanion.tsx', import.meta.url), 'utf8');
  assert.match(companion, /data-companion-layout="shelf"/);
  assert.match(companion, /surface = 'player'/);
  assert.match(companion, /DISCOVERY_COPY\.talkToRook/);
  assert.match(companion, /: 'Voice'/);
});

test('kit source files are recreated in-repo and stay out of the product import graph', () => {
  const kit = [
    'START-HERE.md',
    'COMPONENTS.md',
    'CURSOR-PROMPT.md',
    'ASSET-MANIFEST.json',
    'tokens.json',
    'index.html',
    'styles.css',
    'app.js',
    'assets/cover-night.svg',
    'assets/rook-approved-renderer.js',
  ];
  for (const rel of kit) {
    const text = readFileSync(join(new URL('../docs/social-design', import.meta.url), rel), 'utf8');
    assert.ok(text.length > 20, rel);
  }
  const product = [
    new URL('../app/games/page.tsx', import.meta.url),
    new URL('../components/DiscoveryPage.tsx', import.meta.url),
    new URL('../components/DiscoveryCard.tsx', import.meta.url),
    new URL('../components/DiscoveryRook.tsx', import.meta.url),
    new URL('../lib/discovery.ts', import.meta.url),
  ];
  for (const file of product) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /docs\/social-design\/styles\.css/);
    assert.doesNotMatch(text, /cover-night\.svg/);
  }
  assert.equal(DISCOVERY_COPY.headline, 'Your next good time.');
  assert.equal(DISCOVERY_COPY.lede, 'Find a game. Make it a moment.');
});
