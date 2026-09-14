import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeExperienceHome, EXPERIENCE_OPENING, experienceHref } from '../lib/experience-reset.ts';

function game(id, name) {
  return {
    id,
    name,
    description: `${name} is a short player-facing line.`,
    iconUrl: `https://example.com/${id}.png`,
    gameUrl: 'https://example.com/play',
    serverUrl: '',
    source: 'community',
    uploaderId: 'x',
    preview: null,
    createdAt: 1,
    updatedAt: null,
  };
}

test('opening composition uses distinct games and does not repeat the feature in picks', () => {
  const games = [
    game('nightclub-showdown-inzone-production', 'Nightclub Showdown'),
    game('2048-inzone-upload', '2048'),
    game('snake', 'Snake'),
    game('other-one', 'Other'),
  ];
  const home = composeExperienceHome(games);
  assert.equal(home.feature?.id, EXPERIENCE_OPENING[0]);
  const openingIds = [home.feature.id, ...home.alternatives.map((g) => g.id)];
  assert.equal(new Set(openingIds).size, openingIds.length);
  assert.equal(home.picks.some((g) => openingIds.includes(g.id)), false);
  assert.equal(home.picks.map((g) => g.id).includes('other-one'), true);
});

test('missing editorial ids are skipped without inventing titles', () => {
  const games = [game('snake', 'Snake'), game('solo', 'Solo')];
  const home = composeExperienceHome(games);
  assert.equal(home.feature?.name, 'Snake');
  assert.equal(home.alternatives.some((g) => g.id === 'solo'), true);
});

test('invite-preview href stays on the review route and does not carry a live session', () => {
  const href = experienceHref({ gameId: 'snake', scene: 'invite-preview' });
  assert.equal(href.startsWith('/experience?'), true);
  assert.equal(href.includes('game=snake'), true);
  assert.equal(href.includes('scene=invite-preview'), true);
  assert.equal(href.includes('session='), false);
});
