import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FLAGSHIP_IDS,
  FLAGSHIP_ROSTER,
  VERIFIED_STATE_FLAGSHIP_IDS,
  flagshipHasVerifiedState,
  flagshipTitle,
  gamesForFlagship,
  isFlagshipId,
} from '../lib/flagship-roster.ts';

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

test('approved flagship roster is exactly the five launch titles in order', () => {
  assert.deepEqual(
    FLAGSHIP_ROSTER.map((item) => [item.id, item.title]),
    [
      ['kart-bros', 'Kart Bros'],
      ['clelytraflight', 'Elytra Flight'],
      ['karate-bros', 'Karate Bros'],
      ['clescaperoad', 'Escape Road'],
      ['nightclub-showdown-inzone-production', 'Nightclub Showdown'],
    ],
  );
  assert.equal(FLAGSHIP_IDS.length, 5);
});

test('flagship helpers skip missing catalogue ids and keep roster order', () => {
  const games = [
    game('clescaperoad', 'Escape Road'),
    game('snake', 'Snake'),
    game('kart-bros', 'Kart Bros'),
  ];
  assert.deepEqual(
    gamesForFlagship(games).map((item) => item.id),
    ['kart-bros', 'clescaperoad'],
  );
  assert.equal(isFlagshipId('kart-bros'), true);
  assert.equal(isFlagshipId('snake'), false);
  assert.equal(flagshipTitle('karate-bros'), 'Karate Bros');
  assert.equal(flagshipTitle('missing'), null);
});

test('only Nightclub has verified gameplay-state integration on the roster', () => {
  assert.deepEqual([...VERIFIED_STATE_FLAGSHIP_IDS], ['nightclub-showdown-inzone-production']);
  assert.equal(flagshipHasVerifiedState('nightclub-showdown-inzone-production'), true);
  for (const id of FLAGSHIP_IDS) {
    if (id === 'nightclub-showdown-inzone-production') continue;
    assert.equal(flagshipHasVerifiedState(id), false, id);
  }
});
