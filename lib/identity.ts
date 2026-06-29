'use client';

/* Engagement identity — who is liking / commenting.
 *
 * Signed-in users (Firebase Auth) act as themselves: their uid is the stable
 * actor id and their display name (or a humanUsers/{uid} username) is shown.
 *
 * Everyone else is a *guest*. We mint a stable random id + friendly username
 * once and persist them in a first-party cookie (1-year), so a guest's likes
 * and comments survive reloads and they can un-like something they liked in a
 * previous visit — without ever forcing a sign-in. The same id is what we write
 * as the doc key in the `likes` subcollection, so "did I like this?" is just a
 * doc-exists check, no extra client bookkeeping needed.
 */

import type { User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { getDb } from './firebase';

export interface Identity {
  /** Stable actor id: the Firebase uid for signed-in users, or `guest_…` for guests. */
  id: string;
  /** Friendly display name shown next to comments. */
  username: string;
  /** True when this is a cookie-backed guest rather than an authenticated user. */
  anonymous: boolean;
}

const ID_COOKIE = 'inzone_guest_id';
const NAME_COOKIE = 'inzone_guest_name';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(
    new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string): void {
  if (typeof document === 'undefined') return;
  document.cookie =
    `${name}=${encodeURIComponent(value)}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}

const ADJECTIVES = [
  'Swift', 'Cosmic', 'Neon', 'Pixel', 'Turbo', 'Lucky', 'Mighty', 'Sneaky',
  'Golden', 'Frost', 'Shadow', 'Crimson', 'Electric', 'Wild', 'Brave', 'Quantum',
  'Rogue', 'Stellar', 'Mellow', 'Nimble', 'Radiant', 'Vivid', 'Atomic', 'Hyper',
];
const NOUNS = [
  'Falcon', 'Tiger', 'Comet', 'Wizard', 'Ninja', 'Phoenix', 'Otter', 'Dragon',
  'Raccoon', 'Pixel', 'Yeti', 'Koala', 'Viper', 'Panda', 'Gecko', 'Mantis',
  'Bandit', 'Pilot', 'Nomad', 'Sprite', 'Goblin', 'Walrus', 'Lynx', 'Badger',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** A short, URL-safe random token. */
function randomToken(len = 16): string {
  const bytes = new Uint8Array(len);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, len);
}

function randomUsername(): string {
  return `${pick(ADJECTIVES)}${pick(NOUNS)}${Math.floor(Math.random() * 90 + 10)}`;
}

/** The cookie-backed guest identity, minting and persisting one on first use. */
export function getGuestIdentity(): Identity {
  let id = readCookie(ID_COOKIE);
  if (!id) {
    id = `guest_${randomToken()}`;
    writeCookie(ID_COOKIE, id);
  }
  let username = readCookie(NAME_COOKIE);
  if (!username) {
    username = randomUsername();
    writeCookie(NAME_COOKIE, username);
  }
  return { id, username, anonymous: true };
}

/** Resolve the acting identity for engagement: the signed-in user if present,
 *  otherwise the persistent guest. For signed-in users we prefer a
 *  humanUsers/{uid}.username, falling back to the auth displayName, then a
 *  generic label. Best-effort: a failed lookup still returns a usable identity. */
export async function resolveIdentity(user: User | null): Promise<Identity> {
  if (!user) return getGuestIdentity();

  let username = (user.displayName ?? '').trim();
  try {
    const snap = await getDoc(doc(getDb(), 'humanUsers', user.uid));
    if (snap.exists()) {
      const data = snap.data() as Record<string, unknown>;
      const stored = ((data.username as string) || (data.name as string) || '').trim();
      if (stored) username = stored;
    }
  } catch {
    /* humanUsers lookup is non-fatal — fall back to displayName below */
  }
  if (!username) username = 'Player';
  return { id: user.uid, username, anonymous: false };
}

/* ── Liked-comment memory ─────────────────────────────────────────
 * Which comments the viewer has liked is kept client-side (per game) so the
 * heart stays filled across reloads without a per-user Firestore doc per
 * comment. The shared like *tally* lives on the comment doc; this is just the
 * local "did I tap it" flag, the same trust model as guest game-likes. */
const LIKED_COMMENTS_KEY = 'inzone_liked_comments';

export function getLikedCommentIds(gameId: string): Set<string> {
  if (typeof localStorage === 'undefined' || !gameId) return new Set();
  try {
    const raw = localStorage.getItem(`${LIKED_COMMENTS_KEY}:${gameId}`);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function setCommentLiked(gameId: string, commentId: string, liked: boolean): void {
  if (typeof localStorage === 'undefined' || !gameId || !commentId) return;
  try {
    const set = getLikedCommentIds(gameId);
    if (liked) set.add(commentId);
    else set.delete(commentId);
    localStorage.setItem(`${LIKED_COMMENTS_KEY}:${gameId}`, JSON.stringify([...set]));
  } catch {
    /* storage full / disabled — non-fatal */
  }
}
