'use client';

/**
 * Live play-session (invite → join → chat → suggest).
 *
 * Reuses Firebase Auth identity via lib/identity.ts (signed-in uid or the
 * cookie-backed guest_* actor used by hub likes/comments). Reuses the
 * conversations/messages shape (senderId, text, createdAt) and guest-friendly
 * comment validation (length, required fields).
 *
 * Gap: Flutter `conversations` require signed-in uids and have no invite
 * token, suggestions, or leave-session. `groupChats` is a per-game community
 * dump with an open signed-in write. This collection is only the session
 * flow those cannot cover.
 *
 * Writes are enforced in firestore.rules. The phase-2a public-read catch-all
 * still allows listing this collection — that is a documented release blocker.
 */

import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Timestamp,
} from 'firebase/firestore';
import { getDb } from './firebase';
import type { Identity } from './identity';
import {
  MAX_PLAY_MESSAGE,
  PLAY_RATE_MS,
  PLAY_SESSIONS,
  SESSION_TTL_MS,
  canPostAt,
  isPlaySessionId,
  sessionIsExpired,
  validatePlayMessage,
} from './play-session-core';

export { PLAY_SESSIONS, PLAY_RATE_MS, SESSION_TTL_MS, canPostAt, isPlaySessionId, liveInviteUrl, sessionIsExpired, validatePlayMessage, MAX_PLAY_MESSAGE } from './play-session-core';

export type PlayMemberStatus = 'active' | 'left';
export type PlaySessionStatus = 'open' | 'ended';
export type PlayMessageType = 'chat' | 'suggest' | 'system';

export interface PlaySessionDoc {
  hostId: string;
  memberIds: string[];
  gameId: string;
  status: PlaySessionStatus;
  createdAt: number;
  expiresAt: number;
}

export interface PlayMemberDoc {
  actorId: string;
  actorName: string;
  anonymous: boolean;
  status: PlayMemberStatus;
  lastMessageAt: number;
}

export interface PlayGameRef {
  id: string;
  name: string;
  iconUrl: string;
}

export interface PlayMessageDoc {
  type: PlayMessageType;
  senderId: string;
  senderName: string;
  text: string;
  game: PlayGameRef | null;
  createdAt: number;
}

export type SessionLoadError = 'invalid' | 'expired' | 'ended' | 'denied';

export function newPlaySessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function isTimestamp(v: unknown): v is Timestamp {
  return !!v && typeof v === 'object' && 'toMillis' in (v as Record<string, unknown>);
}

function asMillis(v: unknown): number {
  if (typeof v === 'number') return v;
  if (isTimestamp(v)) return v.toMillis();
  return 0;
}

export async function createPlaySession(
  actor: Identity,
  gameId: string,
): Promise<{ id: string; expiresAt: number }> {
  const id = newPlaySessionId();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  const db = getDb();
  await setDoc(doc(db, PLAY_SESSIONS, id), {
    hostId: actor.id,
    memberIds: [actor.id],
    gameId: gameId || '',
    status: 'open',
    createdAt: now,
    expiresAt,
  } satisfies PlaySessionDoc);
  await setDoc(doc(db, PLAY_SESSIONS, id, 'members', actor.id), {
    actorId: actor.id,
    actorName: actor.username.slice(0, 80),
    anonymous: actor.anonymous,
    status: 'active',
    lastMessageAt: 0,
  } satisfies PlayMemberDoc);
  return { id, expiresAt };
}

export async function loadPlaySession(
  sessionId: string,
): Promise<{ session: PlaySessionDoc } | { error: SessionLoadError }> {
  if (!sessionId || !isPlaySessionId(sessionId)) return { error: 'invalid' };
  const snap = await getDoc(doc(getDb(), PLAY_SESSIONS, sessionId));
  if (!snap.exists()) return { error: 'invalid' };
  const raw = snap.data() as Record<string, unknown>;
  const session: PlaySessionDoc = {
    hostId: String(raw.hostId || ''),
    memberIds: Array.isArray(raw.memberIds) ? raw.memberIds.map(String) : [],
    gameId: String(raw.gameId || ''),
    status: raw.status === 'ended' ? 'ended' : 'open',
    createdAt: asMillis(raw.createdAt),
    expiresAt: asMillis(raw.expiresAt),
  };
  if (session.status === 'ended') return { error: 'ended' };
  if (sessionIsExpired(session.expiresAt)) return { error: 'expired' };
  return { session };
}

export async function joinPlaySession(sessionId: string, actor: Identity): Promise<SessionLoadError | null> {
  const loaded = await loadPlaySession(sessionId);
  if ('error' in loaded) return loaded.error;
  const db = getDb();
  await updateDoc(doc(db, PLAY_SESSIONS, sessionId), { memberIds: arrayUnion(actor.id) });
  const memberRef = doc(db, PLAY_SESSIONS, sessionId, 'members', actor.id);
  const existing = await getDoc(memberRef);
  await setDoc(
    memberRef,
    existing.exists()
      ? { actorName: actor.username.slice(0, 80), status: 'active' }
      : {
          actorId: actor.id,
          actorName: actor.username.slice(0, 80),
          anonymous: actor.anonymous,
          status: 'active',
          lastMessageAt: 0,
        },
    { merge: true },
  );
  return null;
}

export async function leavePlaySession(sessionId: string, actor: Identity): Promise<void> {
  const db = getDb();
  await setDoc(doc(db, PLAY_SESSIONS, sessionId, 'members', actor.id), { status: 'left' }, { merge: true });
  const loaded = await loadPlaySession(sessionId);
  await updateDoc(doc(db, PLAY_SESSIONS, sessionId), {
    memberIds: arrayRemove(actor.id),
    ...(!('error' in loaded) && loaded.session.memberIds.filter((id) => id !== actor.id).length === 0
      ? { status: 'ended' as const }
      : {}),
  });
}

export async function postPlayMessage(
  sessionId: string,
  actor: Identity,
  input: { type: PlayMessageType; text: string; game?: PlayGameRef | null },
): Promise<{ ok: true } | { error: 'rate' | 'invalid' | 'expired' }> {
  const text = input.type === 'chat' || input.type === 'system' ? validatePlayMessage(input.text) : (input.text || '').slice(0, MAX_PLAY_MESSAGE);
  if (input.type === 'chat' && !text) return { error: 'invalid' };
  const loaded = await loadPlaySession(sessionId);
  if ('error' in loaded) return { error: loaded.error === 'expired' ? 'expired' : 'invalid' };
  const db = getDb();
  const memberRef = doc(db, PLAY_SESSIONS, sessionId, 'members', actor.id);
  try {
    await runTransaction(db, async (tx) => {
      const memberSnap = await tx.get(memberRef);
      const last = memberSnap.exists() ? Number((memberSnap.data() as PlayMemberDoc).lastMessageAt || 0) : 0;
      if (!canPostAt(last)) throw new Error('rate');
      const now = Date.now();
      const msgRef = doc(collection(db, PLAY_SESSIONS, sessionId, 'messages'));
      tx.set(msgRef, {
        type: input.type,
        senderId: actor.id,
        senderName: actor.username.slice(0, 80),
        text: text || '',
        game: input.game || null,
        createdAt: now,
        stamped: serverTimestamp(),
      });
      tx.set(memberRef, { lastMessageAt: now, status: 'active' }, { merge: true });
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'rate') return { error: 'rate' };
    return { error: 'invalid' };
  }
  return { ok: true };
}

export function subscribePlaySession(
  sessionId: string,
  onData: (session: PlaySessionDoc) => void,
  onError: (err: SessionLoadError) => void,
): () => void {
  return onSnapshot(
    doc(getDb(), PLAY_SESSIONS, sessionId),
    (snap) => {
      if (!snap.exists()) {
        onError('invalid');
        return;
      }
      const raw = snap.data() as Record<string, unknown>;
      const session: PlaySessionDoc = {
        hostId: String(raw.hostId || ''),
        memberIds: Array.isArray(raw.memberIds) ? raw.memberIds.map(String) : [],
        gameId: String(raw.gameId || ''),
        status: raw.status === 'ended' ? 'ended' : 'open',
        createdAt: asMillis(raw.createdAt),
        expiresAt: asMillis(raw.expiresAt),
      };
      if (session.status === 'ended') onError('ended');
      else if (sessionIsExpired(session.expiresAt)) onError('expired');
      else onData(session);
    },
    () => onError('denied'),
  );
}

export function subscribePlayMembers(
  sessionId: string,
  onData: (members: PlayMemberDoc[]) => void,
): () => void {
  return onSnapshot(collection(getDb(), PLAY_SESSIONS, sessionId, 'members'), (snap) => {
    const members = snap.docs.map((d) => {
      const raw = d.data() as Record<string, unknown>;
      return {
        actorId: String(raw.actorId || d.id),
        actorName: String(raw.actorName || 'Player'),
        anonymous: raw.anonymous === true,
        status: raw.status === 'left' ? 'left' : 'active',
        lastMessageAt: Number(raw.lastMessageAt || 0),
      } satisfies PlayMemberDoc;
    });
    onData(members);
  });
}

export function subscribePlayMessages(
  sessionId: string,
  onData: (messages: Array<PlayMessageDoc & { id: string }>) => void,
): () => void {
  const q = query(collection(getDb(), PLAY_SESSIONS, sessionId, 'messages'), orderBy('createdAt', 'asc'));
  return onSnapshot(q, (snap) => {
    onData(
      snap.docs.map((d) => {
        const raw = d.data() as Record<string, unknown>;
        const gameRaw = raw.game && typeof raw.game === 'object' ? (raw.game as Record<string, unknown>) : null;
        return {
          id: d.id,
          type: raw.type === 'suggest' || raw.type === 'system' ? raw.type : 'chat',
          senderId: String(raw.senderId || ''),
          senderName: String(raw.senderName || 'Player'),
          text: String(raw.text || ''),
          game: gameRaw
            ? { id: String(gameRaw.id || ''), name: String(gameRaw.name || ''), iconUrl: String(gameRaw.iconUrl || '') }
            : null,
          createdAt: asMillis(raw.createdAt),
        };
      }),
    );
  });
}
