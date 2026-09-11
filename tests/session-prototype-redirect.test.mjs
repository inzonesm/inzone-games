import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_PROTOTYPE_REDIRECT_STATUS,
  sessionPrototypeRedirectLocation,
  sessionPrototypeRedirectPath,
} from '../lib/session-prototype-redirect.ts';

const SID = 'aabbccddeeff00112233445566778899';

test('legacy session-prototype query maps onto /games/:id', () => {
  assert.equal(
    sessionPrototypeRedirectPath(`game=snake&session=${SID}`),
    `/games/snake?session=${SID}`,
  );
  assert.equal(sessionPrototypeRedirectPath('game=2048-inzone-upload'), '/games/2048-inzone-upload');
  assert.equal(sessionPrototypeRedirectPath(''), '/');
  assert.equal(
    sessionPrototypeRedirectPath('utm_source=gtm&game=snake'),
    '/games/snake?utm_source=gtm',
  );
});

test('/session-prototype?game=X&session=Y returns 308 to the unified player', () => {
  const from = `https://www.inzone.games/session-prototype?game=snake&session=${SID}`;
  const location = sessionPrototypeRedirectLocation('https://www.inzone.games', new URL(from).searchParams);
  assert.equal(location, `https://www.inzone.games/games/snake?session=${SID}`);
  assert.equal(SESSION_PROTOTYPE_REDIRECT_STATUS, 308);
});
