import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontNavNextPath } from '../lib/player-front-nav.ts';

/**
 * Invite arrivals land on /games/<id>?session=<sessionId>. The pre-fix nav
 * computed `next` from usePathname() only, so the /login?next= round-trip
 * silently dropped ?session= — the second account landed on the game but
 * outside the conversation they were invited to.
 */

const SESSION = 'aabbccddeeff00112233445566778899';

test('invite session query survives the login return path', () => {
  assert.equal(
    frontNavNextPath('/games/kart-bros', `?session=${SESSION}`),
    `/games/kart-bros?session=${SESSION}`,
  );
});

test('no query string keeps the previous pathname-only behavior', () => {
  assert.equal(frontNavNextPath('/games/kart-bros', ''), '/games/kart-bros');
  assert.equal(frontNavNextPath('/games', ''), '/games');
  assert.equal(frontNavNextPath('/', ''), '/');
  assert.equal(frontNavNextPath('/upload', ''), '/');
});

test('additional params are preserved alongside the session', () => {
  assert.equal(
    frontNavNextPath('/games/kart-bros', `?session=${SESSION}&utm_source=share`),
    `/games/kart-bros?session=${SESSION}&utm_source=share`,
  );
});

test('non-game paths keep their mapping with the query preserved', () => {
  assert.equal(frontNavNextPath('/games', `?session=${SESSION}`), `/games?session=${SESSION}`);
  assert.equal(frontNavNextPath('/', `?session=${SESSION}`), `/?session=${SESSION}`);
});
