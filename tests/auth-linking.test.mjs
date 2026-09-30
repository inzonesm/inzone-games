import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  googleSignInMode,
  isCredentialAlreadyInUse,
  pendingInviteSessionId,
} from '../lib/auth-linking.ts';

/**
 * Anonymous guests who sign in with Google must be UPGRADED (linkWithPopup),
 * not replaced (signInWithPopup): the uid is the session-membership key, so
 * swapping it strands the guest outside the conversation they were invited
 * to. These tests pin the upgrade decision, the already-in-use recovery
 * signal, and the invite-session recovery from the login round-trip.
 */

const SESSION = 'aabbccddeeff00112233445566778899';

test('anonymous user upgrades via link so the uid (and memberships) survive', () => {
  assert.equal(googleSignInMode({ isAnonymous: true }), 'link');
});

test('signed-in non-anonymous user keeps the plain popup flow', () => {
  assert.equal(googleSignInMode({ isAnonymous: false }), 'popup');
});

test('signed-out user keeps the plain popup flow', () => {
  assert.equal(googleSignInMode(null), 'popup');
  assert.equal(googleSignInMode(undefined), 'popup');
});

test('credential-already-in-use is detected from the Firebase error code', () => {
  const err = new Error('The account already exists.');
  // @ts-expect-error — Firebase attaches the code at runtime
  err.code = 'auth/credential-already-in-use';
  assert.equal(isCredentialAlreadyInUse(err), true);
});

test('credential-already-in-use is detected without the auth/ prefix', () => {
  const err = new Error('already in use');
  // @ts-expect-error — Firebase attaches the code at runtime
  err.code = 'credential-already-in-use';
  assert.equal(isCredentialAlreadyInUse(err), true);
});

test('other auth errors are not misclassified as already-in-use', () => {
  const popupClosed = new Error('popup closed');
  // @ts-expect-error — Firebase attaches the code at runtime
  popupClosed.code = 'auth/popup-closed-by-user';
  assert.equal(isCredentialAlreadyInUse(popupClosed), false);

  const denied = new Error('denied');
  // @ts-expect-error — Firebase attaches the code at runtime
  denied.code = 'auth/operation-not-allowed';
  assert.equal(isCredentialAlreadyInUse(denied), false);

  assert.equal(isCredentialAlreadyInUse(new Error('boom')), false);
  assert.equal(isCredentialAlreadyInUse(null), false);
  assert.equal(isCredentialAlreadyInUse(undefined), false);
  assert.equal(isCredentialAlreadyInUse('auth/credential-already-in-use'), false);
});

test('invite session id is recovered from the login next param', () => {
  const next = encodeURIComponent(`/games/kart-bros?session=${SESSION}`);
  assert.equal(pendingInviteSessionId(`?next=${next}`), SESSION);
});

test('unencoded next param with the session also resolves', () => {
  // URLSearchParams tolerates the raw form; the login page encodes it.
  assert.equal(
    pendingInviteSessionId(`?next=/games/kart-bros?session=${SESSION}`),
    SESSION,
  );
});

test('missing or invalid session ids yield null', () => {
  const noSession = encodeURIComponent('/games/kart-bros');
  assert.equal(pendingInviteSessionId(`?next=${noSession}`), null);

  const badSession = encodeURIComponent('/games/kart-bros?session=not-a-session-id');
  assert.equal(pendingInviteSessionId(`?next=${badSession}`), null);

  assert.equal(pendingInviteSessionId(''), null);
  assert.equal(pendingInviteSessionId('?next='), null);
  assert.equal(pendingInviteSessionId('?utm_source=share'), null);
});

test('non-invite next paths yield null', () => {
  assert.equal(pendingInviteSessionId(`?next=${encodeURIComponent('/games')}`), null);
  assert.equal(pendingInviteSessionId(`?next=${encodeURIComponent('/creators')}`), null);
});

test('open-redirect-style next values are rejected', () => {
  assert.equal(
    pendingInviteSessionId(`?next=${encodeURIComponent('//evil.example/x')}`),
    null,
  );
  assert.equal(
    pendingInviteSessionId('?next=https://evil.example/games/kart-bros?session=' + SESSION),
    null,
  );
});
