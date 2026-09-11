import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PLAY_CHUNK,
  MAX_PLAY_MESSAGE,
  PLAY_HISTORY_CHUNKS,
  PLAY_RATE_MS,
  SESSION_TTL_MS,
  canPostAt,
  isPlaySessionId,
  liveInviteUrl,
  sessionExpiresAt,
  sessionIsExpired,
  validatePlayMessage,
} from '../lib/play-session-core.ts';
import { applySeatAction, createSeat, iframeShouldRemount } from '../lib/session-prototype.ts';

test('invite URL carries the session id and game, not a lobby', () => {
  const url = liveInviteUrl('https://www.inzone.games', {
    gameId: 'nightclub-showdown-inzone-production',
    sessionId: 'aabbccddeeff00112233445566778899',
  });
  assert.equal(
    url,
    'https://www.inzone.games/games/nightclub-showdown-inzone-production?session=aabbccddeeff00112233445566778899',
  );
  assert.equal(isPlaySessionId('aabbccddeeff00112233445566778899'), true);
  assert.equal(isPlaySessionId('proto-demo'), false);
});

test('message validation rejects empty and oversized text', () => {
  assert.equal(validatePlayMessage('  hello  '), 'hello');
  assert.equal(validatePlayMessage(''), null);
  assert.equal(validatePlayMessage('   '), null);
  assert.equal(validatePlayMessage('x'.repeat(MAX_PLAY_MESSAGE)), 'x'.repeat(MAX_PLAY_MESSAGE));
  assert.equal(validatePlayMessage('x'.repeat(MAX_PLAY_MESSAGE + 1)), null);
});

test('expired sessions and rate limits are enforced in helpers', () => {
  assert.equal(sessionIsExpired(1, 2), true);
  assert.equal(sessionIsExpired(50, 40), false);
  assert.equal(sessionExpiresAt(1000), 1000 + SESSION_TTL_MS);
  assert.equal(canPostAt(0, PLAY_RATE_MS), true);
  assert.equal(canPostAt(1000, 1000 + PLAY_RATE_MS - 1), false);
  assert.equal(MAX_PLAY_CHUNK, 40);
  assert.equal(PLAY_HISTORY_CHUNKS, 2);
});

test('live chat and suggestions still do not remount this seat', () => {
  const seat = createSeat('you', 'You', 'nightclub-showdown-inzone-production');
  const suggestion = {
    id: 's1',
    fromSeat: 'peer',
    fromLabel: 'Joiner',
    game: { id: 'neon-blaster', name: 'Neon Blaster', description: '', iconUrl: '' },
    createdAt: 1,
  };
  assert.equal(applySeatAction(seat, { type: 'receive-suggestion', suggestion }).gameId, seat.gameId);
  assert.equal(applySeatAction(seat, { type: 'keep-playing', suggestionId: 's1' }).gameId, seat.gameId);
  assert.equal(iframeShouldRemount(seat.gameId, seat.gameId), false);
});
