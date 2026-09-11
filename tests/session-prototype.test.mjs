import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COPY,
  applySeatAction,
  createSeat,
  coverFallbackHue,
  coverInitial,
  displayGameName,
  filterCatalog,
  gameFitFor,
  iframeShouldRemount,
  needsProgressConfirm,
  pickFeaturedIds,
  playerFacingDescription,
  prototypeInviteUrl,
  channelNameForRoom,
} from '../lib/session-prototype.ts';

const nightclub = { id: 'nightclub-showdown', name: 'Nightclub Showdown', description: 'A fast turned-based action game' };
const neon = { id: 'neon-blaster', name: 'Neon Blaster', description: 'Arcade space shooter with a modern twist.' };
const puzzle = { id: '2048-inzone-upload', name: '2048', description: 'Slide tiles. Puzzle.' };
const snake = { id: 'snake', name: 'snake', description: 'Classic snake' };

test('opening discovery or receiving a suggestion does not change the mounted game', () => {
  const seat = createSeat('you', 'You', nightclub.id);
  const suggestion = {
    id: 's1',
    fromSeat: 'peer',
    fromLabel: 'Companion seat',
    game: { id: neon.id, name: neon.name, description: neon.description, iconUrl: '' },
    createdAt: 1,
  };
  assert.equal(applySeatAction(seat, { type: 'open-surface', surface: 'discover' }).gameId, nightclub.id);
  assert.equal(applySeatAction(seat, { type: 'open-surface', surface: 'yours' }).gameId, nightclub.id);
  assert.equal(applySeatAction(seat, { type: 'toggle-session', open: true }).gameId, nightclub.id);
  assert.equal(applySeatAction(seat, { type: 'receive-suggestion', suggestion }).gameId, nightclub.id);
  assert.equal(applySeatAction(seat, { type: 'keep-playing', suggestionId: 's1' }).gameId, nightclub.id);
  assert.equal(iframeShouldRemount(nightclub.id, nightclub.id), false);
});

test('only explicit play / open-suggested remounts this seat', () => {
  const seat = createSeat('you', 'You', nightclub.id);
  const afterSuggest = applySeatAction(seat, {
    type: 'receive-suggestion',
    suggestion: {
      id: 's1',
      fromSeat: 'peer',
      fromLabel: 'Companion seat',
      game: { id: neon.id, name: neon.name, description: neon.description, iconUrl: '' },
      createdAt: 1,
    },
  });
  assert.equal(afterSuggest.gameId, nightclub.id);

  const opened = applySeatAction(afterSuggest, { type: 'open-suggested', gameId: neon.id });
  assert.equal(opened.gameId, neon.id);
  assert.deepEqual(opened.playedIds, [nightclub.id, neon.id]);
  assert.equal(opened.interacted, false);
  assert.equal(iframeShouldRemount(afterSuggest.gameId, opened.gameId), true);

  const peer = createSeat('peer', 'Companion seat', nightclub.id);
  assert.equal(applySeatAction(peer, { type: 'keep-playing', suggestionId: 's1' }).gameId, nightclub.id);
  assert.equal(peer.gameId, nightclub.id);
});

test('progress confirm is required after interaction and never claims a save', () => {
  let seat = createSeat('you', 'You', nightclub.id);
  assert.equal(needsProgressConfirm(seat, neon.id), false);
  seat = applySeatAction(seat, { type: 'mark-interacted' });
  assert.equal(needsProgressConfirm(seat, neon.id), true);
  assert.equal(needsProgressConfirm(seat, nightclub.id), false);
  assert.equal(COPY.switchTitle, 'Switch games?');
  assert.equal(COPY.switchBody, 'Your latest progress may not be saved.');
  assert.equal(COPY.switchGame, 'Switch game');
  assert.doesNotMatch(COPY.switchBody.toLowerCase(), /progress (is|was) saved/);
});

test('catalog search and chips use real ids; featured prefers known titles', () => {
  const games = [puzzle, snake, neon, nightclub];
  assert.deepEqual(pickFeaturedIds(games, 3), [nightclub.id, neon.id, puzzle.id]);
  assert.equal(filterCatalog(games, { query: 'neon', chip: 'all' })[0].id, neon.id);
  assert.ok(filterCatalog(games, { query: '', chip: 'puzzle' }).some((g) => g.id === puzzle.id));
  assert.ok(filterCatalog(games, { query: '', chip: 'action' }).some((g) => g.id === neon.id));
});

test('invite URL is a prototype deep link to that exact game, not a lobby', () => {
  const url = prototypeInviteUrl('https://www.inzone.games', {
    gameId: '2048-inzone-upload',
    room: 'proto-demo',
    seat: 'peer',
  });
  assert.equal(
    url,
    'https://www.inzone.games/session-prototype?game=2048-inzone-upload&room=proto-demo&seat=peer',
  );
  assert.equal(channelNameForRoom('proto-demo'), 'inzone-session-proto:proto-demo');
});

test('empty-session copy does not make the player wait', () => {
  assert.match(COPY.emptyBody, /invite is optional/i);
  assert.match(COPY.inviteHint, /Nobody is notified/);
  assert.match(COPY.sampleHint, /not a real person/);
  assert.match(COPY.chatSimulated, /demo/i);
  assert.equal(COPY.search, 'Search games');
  assert.equal(COPY.chat, 'Chat');
  assert.equal(COPY.discover, 'Discover');
  assert.doesNotMatch(COPY.search, /live catalog/i);
});

test('player-facing descriptions omit upload placeholders and do not invent copy', () => {
  assert.equal(
    playerFacingDescription(
      'Nightclub Showdown — a multi-file HTML5 game. Backend will pull this from README.md (or description.md) at the bundle root.',
      'Nightclub Showdown',
    ),
    null,
  );
  assert.equal(playerFacingDescription('Arcade space shooter with a modern twist.'), 'Arcade space shooter with a modern twist.');
  assert.equal(playerFacingDescription('   '), null);
});

test('approved titles are shown as stored; covers get an intentional fallback', () => {
  assert.equal(displayGameName('2048 Inzone Upload'), '2048 Inzone Upload');
  assert.equal(displayGameName('  Nightclub Showdown  '), 'Nightclub Showdown');
  assert.equal(coverInitial('Neon Blaster'), 'N');
  assert.equal(typeof coverFallbackHue('ovo-2'), 'number');
  assert.equal(gameFitFor('nightclub-showdown-inzone-production', 'Nightclub Showdown'), 'landscape');
  assert.equal(gameFitFor('unknown-id', 'Some New Game'), 'unknown');
});
