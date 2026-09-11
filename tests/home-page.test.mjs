import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HomeView } from '../lib/home-view.ts';
import {
  FEATURED_HERO,
  HOME_ROW_DEFS,
  featuredHeroSlug,
  resolveHomeRows,
} from '../lib/home-rows.ts';

function game(id, name) {
  return {
    id,
    source: 'community',
    name,
    description: '',
    iconUrl: '',
    gameUrl: 'https://example.test/game',
    serverUrl: '',
    uploaderId: 'test',
    preview: null,
    createdAt: 1,
    updatedAt: null,
  };
}

test('home SSR renders hero plus three rows even if one shelf is empty', () => {
  assert.equal(featuredHeroSlug(), FEATURED_HERO[0]);
  assert.equal(HOME_ROW_DEFS.length, 3);

  const heroId = featuredHeroSlug();
  const games = [
    game(heroId, 'Snake'),
    game('2048-inzone-upload', '2048'),
    game('nightclub-showdown-inzone-production', 'Nightclub Showdown'),
    // clcookieclicker omitted so the New row degrades without crashing
  ];
  const { hero, rows } = resolveHomeRows(games);
  assert.ok(hero);
  assert.equal(hero.id, heroId);
  assert.equal(rows.length, 3);
  rows[2] = { ...rows[2], games: [] };

  const html = renderToStaticMarkup(createElement(HomeView, { hero, rows }));
  assert.match(html, /class="player-home"/);
  assert.match(html, /class="home-hero"/);
  assert.match(html, /data-featured-slug="snake"/);
  assert.match(html, />Snake</);
  assert.match(html, /data-row="play-with-a-friend"/);
  assert.match(html, /data-row="trending"/);
  assert.match(html, /data-row="new"/);
  assert.match(html, /More games coming soon/);
});
