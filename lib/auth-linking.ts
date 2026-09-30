/**
 * Anonymous → Google upgrade policy.
 *
 * Pure helpers (no Firebase imports) so the upgrade decision is unit-testable.
 * The rule these encode:
 *
 * - An anonymous guest who signs in with Google must be UPGRADED, not
 *   replaced. `signInWithPopup` swaps the uid, orphaning every session
 *   membership (`memberIds`), seat, and message attribution keyed by the
 *   anonymous uid — the guest lands outside the conversation they were
 *   invited to. `linkWithPopup` attaches the Google credential to the
 *   anonymous account instead, so the uid — and the invite, the membership,
 *   and the conversation — survive.
 * - When the Google account already exists (`auth/credential-already-in-use`
 *   from the link attempt), we sign into the existing account and carry the
 *   pending invite membership across (see AuthProvider). Firestore rules
 *   forbid listing sessions (`allow list: if false`), so the carry covers the
 *   invite in the current round-trip; older sessions stay reachable via
 *   their invite links and a normal re-join.
 */

import { isPlaySessionId } from './play-session-core.ts';

export type GoogleSignInMode = 'link' | 'popup';

/**
 * How should this Google sign-in proceed?
 * 'link' — current user is anonymous: link the Google credential onto the
 *   anonymous account (uid preserved, memberships survive).
 * 'popup' — signed-out or already non-anonymous: plain signInWithPopup
 *   (previous behavior, unchanged).
 */
export function googleSignInMode(
  user: { isAnonymous: boolean } | null | undefined,
): GoogleSignInMode {
  return user && user.isAnonymous ? 'link' : 'popup';
}

/**
 * True when a linkWithPopup/linkWithCredential failure means the Google
 * credential is already attached to another Firebase user. Firebase reports
 * this as `auth/credential-already-in-use`; accept the code with or without
 * the `auth/` prefix so wrapped errors still match, but require the full
 * token — never substring-match a bare word like "credential".
 */
export function isCredentialAlreadyInUse(err: unknown): boolean {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';
  if (code === 'auth/credential-already-in-use' || code === 'credential-already-in-use') {
    return true;
  }
  const message = err instanceof Error ? err.message : '';
  return /auth\/credential-already-in-use/.test(message);
}

function safeNextPath(next: string | null): string | null {
  // Same open-redirect guard as the login page: a same-origin absolute path.
  if (!next || !next.startsWith('/') || next.startsWith('//')) return null;
  return next;
}

/**
 * Recover the invite session id from a login round-trip query string.
 *
 * Invite arrivals that must sign in are sent to
 * `/login?next=/games/<id>?session=<sessionId>`; after Google sign-in the
 * login page returns them to `next`. When the link attempt fails because the
 * Google account already exists, the carry step needs the session id to
 * re-seat the guest — this extracts it (validating the id shape) from the
 * live query string. Returns null when there is no invite to carry.
 *
 * `search` is the raw query string including the leading `?`, or ''.
 */
export function pendingInviteSessionId(search: string): string | null {
  if (!search) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  } catch {
    return null;
  }
  const next = safeNextPath(params.get('next'));
  if (!next) return null;
  const queryIndex = next.indexOf('?');
  if (queryIndex < 0) return null;
  let nextParams: URLSearchParams;
  try {
    nextParams = new URLSearchParams(next.slice(queryIndex + 1));
  } catch {
    return null;
  }
  const sessionId = (nextParams.get('session') || '').trim();
  return sessionId && isPlaySessionId(sessionId) ? sessionId : null;
}
