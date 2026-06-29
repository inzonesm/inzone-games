'use client';

/* Engagement data layer — per-game likes and comments.
 *
 * Both live in subcollections under the game doc so they travel with it and are
 * cleaned up if the game is deleted:
 *
 *   html_games/{gameId}/likes/{actorId}     — one doc per actor who liked it.
 *       The doc *existing* IS the like, so the count is a server-side COUNT and
 *       "did I like this?" is a single doc-exists read. actorId is the Firebase
 *       uid for signed-in users or the cookie `guest_…` id for guests.
 *   html_games/{gameId}/comments/{autoId}   — one doc per comment.
 *
 * Guests participate without signing in (see lib/identity.ts), so these
 * subcollections are world-writable by design — keep the matching rules in
 * firestore.rules in sync.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  increment,
  limit as fbLimit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Timestamp,
} from 'firebase/firestore';
import { getDb } from './firebase';
import type { Identity } from './identity';

const COLLECTION = 'html_games';

/** Longest comment we accept — mirrored in firestore.rules. */
export const MAX_COMMENT_LEN = 500;

function isTimestamp(v: unknown): v is Timestamp {
  return !!v && typeof v === 'object' && 'toMillis' in (v as Record<string, unknown>);
}

export interface LikeSummary {
  count: number;
  liked: boolean;
}

/** Current like count for a game and whether `actorId` has liked it. Best-effort:
 *  a missing subcollection or denied read resolves to a zeroed, un-liked state. */
export async function fetchLikeSummary(gameId: string, actorId: string): Promise<LikeSummary> {
  if (!gameId) return { count: 0, liked: false };
  const db = getDb();
  try {
    const countSnap = await getCountFromServer(collection(db, COLLECTION, gameId, 'likes'));
    let liked = false;
    if (actorId) {
      const mine = await getDoc(doc(db, COLLECTION, gameId, 'likes', actorId));
      liked = mine.exists();
    }
    return { count: countSnap.data().count, liked };
  } catch {
    return { count: 0, liked: false };
  }
}

/** Toggle a like on/off for `actor`. Writing the doc adds the like; deleting it
 *  removes it. Idempotent — calling with the same `liked` value twice is safe. */
export async function setLike(gameId: string, actor: Identity, liked: boolean): Promise<void> {
  if (!gameId || !actor.id) return;
  const ref = doc(getDb(), COLLECTION, gameId, 'likes', actor.id);
  if (liked) {
    await setDoc(ref, {
      actorId: actor.id,
      actorName: actor.username,
      anonymous: actor.anonymous,
      createdAt: serverTimestamp(),
    });
  } else {
    await deleteDoc(ref);
  }
}

export interface GameComment {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  anonymous: boolean;
  /** Parent comment id for a reply, or null for a top-level comment. */
  parentId: string | null;
  /** Denormalized like tally (incremented atomically). */
  likeCount: number;
  createdAt: number | null;
}

function toComment(id: string, raw: Record<string, unknown>): GameComment {
  const created = raw.createdAt;
  const parent = raw.parentId;
  const likes = Number(raw.likeCount);
  return {
    id,
    authorId: ((raw.authorId as string) ?? '').trim(),
    authorName: ((raw.authorName as string) ?? 'Player').trim() || 'Player',
    text: ((raw.text as string) ?? '').trim(),
    anonymous: raw.anonymous === true,
    parentId: typeof parent === 'string' && parent ? parent : null,
    likeCount: Number.isFinite(likes) && likes > 0 ? likes : 0,
    createdAt: isTimestamp(created) ? created.toMillis() : null,
  };
}

/** Newest-first list of comments for a game. Best-effort → [] on failure. */
export async function fetchComments(gameId: string, max = 200): Promise<GameComment[]> {
  if (!gameId) return [];
  try {
    const snap = await getDocs(
      query(
        collection(getDb(), COLLECTION, gameId, 'comments'),
        orderBy('createdAt', 'desc'),
        fbLimit(max),
      ),
    );
    return snap.docs.map((d) => toComment(d.id, d.data() as Record<string, unknown>));
  } catch {
    return [];
  }
}

/** Just the comment count (server-side COUNT, no payloads). Best-effort → 0. */
export async function fetchCommentCount(gameId: string): Promise<number> {
  if (!gameId) return 0;
  try {
    const snap = await getCountFromServer(collection(getDb(), COLLECTION, gameId, 'comments'));
    return snap.data().count;
  } catch {
    return 0;
  }
}

/** Post a comment (or a reply when `parentId` is set) as `actor`. Returns the
 *  created comment with a local timestamp so it renders immediately. Throws on
 *  empty/oversized text so the caller can surface a message. */
export async function addComment(
  gameId: string,
  actor: Identity,
  rawText: string,
  parentId: string | null = null,
): Promise<GameComment> {
  const text = rawText.trim();
  if (!gameId) throw new Error('Missing game.');
  if (!text) throw new Error('Comment is empty.');
  if (text.length > MAX_COMMENT_LEN) throw new Error(`Keep it under ${MAX_COMMENT_LEN} characters.`);

  const ref = await addDoc(collection(getDb(), COLLECTION, gameId, 'comments'), {
    authorId: actor.id,
    authorName: actor.username,
    anonymous: actor.anonymous,
    text,
    parentId: parentId ?? null,
    likeCount: 0,
    createdAt: serverTimestamp(),
  });

  return {
    id: ref.id,
    authorId: actor.id,
    authorName: actor.username,
    anonymous: actor.anonymous,
    text,
    parentId: parentId ?? null,
    likeCount: 0,
    createdAt: Date.now(),
  };
}

/** Bump a comment's like tally by ±1 (atomic). Guest-friendly: the per-user
 *  "have I liked this" state is kept client-side (see lib/identity.ts), this
 *  just moves the shared counter. Best-effort — a denied write is swallowed by
 *  the caller's optimistic flow. */
export async function likeComment(
  gameId: string,
  commentId: string,
  liked: boolean,
): Promise<void> {
  if (!gameId || !commentId) return;
  await updateDoc(doc(getDb(), COLLECTION, gameId, 'comments', commentId), {
    likeCount: increment(liked ? 1 : -1),
  });
}
