'use client';

/**
 * Live play-session (invite → join → chat → suggest).
 *
 * Actor id is Firebase Auth uid only (existing Google/Apple session, or
 * anonymous Auth when no user is signed in). Cookie guest_* ids are display
 * names at most — never Firestore keys. Writes are a single session document
 * so membership, lastPosted, and the new message are one atomic rules check.
 */

import { signInAnonymously, type User } from 'firebase/auth';
import {
  arrayRemove,
  arrayUnion,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Timestamp,
} from 'firebase/firestore';
import { getDb, getFirebaseAuth } from './firebase';
import { getGuestIdentity, resolveIdentity } from './identity';
import {
  MAX_PLAY_MESSAGE,
  PLAY_RATE_MS,
  PLAY_SESSIONS,
  PLAY_SESSION_COPY,
  canPostAt,
  isPlaySessionId,
  sessionExpiresAt,
  sessionIsExpired,
  validatePlayMessage,
} from './play-session-core';

export {
  PLAY_SESSIONS,
  PLAY_RATE_MS,
  PLAY_SESSION_COPY,
  canPostAt,
  isPlaySessionId,
  liveInviteUrl,
  sessionExpiresAt,
  sessionIsExpired,
  validatePlayMessage,
  MAX_PLAY_MESSAGE,
} from './play-session-core';

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
  lastPosted: Record<string, number>;
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
export type PlayWriteError = 'rate' | 'invalid' | 'expired' | 'ended' | 'denied';

export interface PlaySessionActor {
  uid: string;
  displayName: string;
  anonymous: boolean;
}

export function newPlaySessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function newMessageId(): string {
  const bytes = new Uint8Array(8);
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

function diagnose(op: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
  console.warn(`[play-session] ${op} failed`, code || detail, detail);
}

function isPermissionDenied(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === 'object' &&
      'code' in err &&
      String((err as { code: unknown }).code).includes('permission-denied'),
  );
}

/**
 * Firebase-verifiable identity for session writes.
 * Reuses the current Auth user (Google/Apple or already-anonymous).
 * Signs in anonymously only when there is no current user — never replaces
 * an existing signed-in account.
 */
export async function ensurePlaySessionUser(): Promise<User> {
  const auth = getFirebaseAuth();
  if (auth.currentUser) return auth.currentUser;
  const cred = await signInAnonymously(auth);
  return cred.user;
}

export async function playSessionActor(user: User): Promise<PlaySessionActor> {
  const display = user.isAnonymous
    ? getGuestIdentity().username
    : (await resolveIdentity(user)).username;
  return {
    uid: user.uid,
    displayName: (display || 'Player').slice(0, 80),
    anonymous: user.isAnonymous,
  };
}

function parseSession(raw: Record<string, unknown>): PlaySessionDoc {
  const createdAt = asMillis(raw.createdAt);
  const lastRaw = raw.lastPosted && typeof raw.lastPosted === 'object' ? (raw.lastPosted as Record<string, unknown>) : {};
  const lastPosted: Record<string, number> = {};
  for (const [k, v] of Object.entries(lastRaw)) lastPosted[k] = asMillis(v);
  return {
    hostId: String(raw.hostId || ''),
    memberIds: Array.isArray(raw.memberIds) ? raw.memberIds.map(String) : [],
    gameId: String(raw.gameId || ''),
    status: raw.status === 'ended' ? 'ended' : 'open',
    createdAt,
    expiresAt: sessionExpiresAt(createdAt),
    lastPosted,
  };
}

function parseMembers(raw: Record<string, unknown>, session: PlaySessionDoc): PlayMemberDoc[] {
  const names =
    raw.memberNames && typeof raw.memberNames === 'object'
      ? (raw.memberNames as Record<string, unknown>)
      : {};
  return session.memberIds.map((id) => ({
    actorId: id,
    actorName: String(names[id] || 'Player').slice(0, 80),
    anonymous: false,
    status: 'active' as const,
    lastMessageAt: session.lastPosted[id] || 0,
  }));
}

function parseMessages(raw: Record<string, unknown>): Array<PlayMessageDoc & { id: string }> {
  const bag =
    raw.messages && typeof raw.messages === 'object' ? (raw.messages as Record<string, unknown>) : {};
  const list: Array<PlayMessageDoc & { id: string }> = [];
  for (const [id, value] of Object.entries(bag)) {
    if (!value || typeof value !== 'object') continue;
    const msg = value as Record<string, unknown>;
    list.push({
      id,
      type: msg.type === 'suggest' ? 'suggest' : 'chat',
      senderId: String(msg.senderId || ''),
      senderName: String(msg.senderName || 'Player'),
      text: String(msg.text || ''),
      game:
        msg.type === 'suggest'
          ? {
              id: String(msg.gameId || ''),
              name: String(msg.gameName || ''),
              iconUrl: String(msg.gameIconUrl || ''),
            }
          : null,
      createdAt: asMillis(msg.createdAt),
    });
  }
  list.sort((a, b) => a.createdAt - b.createdAt);
  return list;
}

export async function createPlaySession(
  actor: PlaySessionActor,
  gameId: string,
): Promise<{ id: string; expiresAt: number }> {
  const user = await ensurePlaySessionUser();
  if (user.uid !== actor.uid) {
    diagnose('createPlaySession', new Error('auth uid mismatch'));
    throw new Error('denied');
  }
  const id = newPlaySessionId();
  const db = getDb();
  try {
    await setDoc(doc(db, PLAY_SESSIONS, id), {
      hostId: user.uid,
      memberIds: [user.uid],
      memberNames: { [user.uid]: actor.displayName.slice(0, 80) },
      gameId: (gameId || '').slice(0, 128),
      status: 'open',
      createdAt: serverTimestamp(),
      lastPosted: {},
      messages: {},
      latestMessageId: '',
    });
  } catch (err) {
    diagnose('createPlaySession', err);
    throw err;
  }
  return { id, expiresAt: sessionExpiresAt(Date.now()) };
}

export async function loadPlaySession(
  sessionId: string,
): Promise<{ session: PlaySessionDoc; raw: Record<string, unknown> } | { error: SessionLoadError }> {
  if (!sessionId || !isPlaySessionId(sessionId)) return { error: 'invalid' };
  try {
    const snap = await getDoc(doc(getDb(), PLAY_SESSIONS, sessionId));
    if (!snap.exists()) return { error: 'invalid' };
    const raw = snap.data() as Record<string, unknown>;
    const session = parseSession(raw);
    if (session.status === 'ended') return { error: 'ended' };
    if (sessionIsExpired(session.expiresAt)) return { error: 'expired' };
    return { session, raw };
  } catch (err) {
    diagnose('loadPlaySession', err);
    if (isPermissionDenied(err)) return { error: 'denied' };
    return { error: 'denied' };
  }
}

export async function joinPlaySession(
  sessionId: string,
  actor: PlaySessionActor,
): Promise<SessionLoadError | null> {
  const user = await ensurePlaySessionUser();
  if (user.uid !== actor.uid) return 'denied';
  const loaded = await loadPlaySession(sessionId);
  if ('error' in loaded) return loaded.error;
  if (loaded.session.memberIds.includes(user.uid)) return null;
  try {
    await updateDoc(doc(getDb(), PLAY_SESSIONS, sessionId), {
      memberIds: arrayUnion(user.uid),
      [`memberNames.${user.uid}`]: actor.displayName.slice(0, 80),
    });
    return null;
  } catch (err) {
    const again = await loadPlaySession(sessionId);
    if (!('error' in again) && again.session.memberIds.includes(user.uid)) return null;
    diagnose('joinPlaySession', err);
    if ('error' in again) return again.error;
    return 'denied';
  }
}

export async function leavePlaySession(sessionId: string, actor: PlaySessionActor): Promise<void> {
  const user = await ensurePlaySessionUser();
  if (user.uid !== actor.uid) {
    diagnose('leavePlaySession', new Error('auth uid mismatch'));
    throw new Error('denied');
  }
  const db = getDb();
  const ref = doc(db, PLAY_SESSIONS, sessionId);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const data = snap.data() as Record<string, unknown>;
      const ids = Array.isArray(data.memberIds) ? data.memberIds.map(String) : [];
      if (!ids.includes(user.uid)) return;
      const patch: Record<string, unknown> = {
        memberIds: arrayRemove(user.uid),
        [`memberNames.${user.uid}`]: deleteField(),
      };
      if (ids.length <= 1) patch.status = 'ended';
      tx.update(ref, patch);
    });
  } catch (err) {
    diagnose('leavePlaySession', err);
    throw err;
  }
}

export async function postPlayMessage(
  sessionId: string,
  actor: PlaySessionActor,
  input: { type: PlayMessageType; text: string; game?: PlayGameRef | null },
): Promise<{ ok: true } | { error: PlayWriteError }> {
  const user = await ensurePlaySessionUser();
  if (user.uid !== actor.uid) return { error: 'denied' };
  if (input.type === 'system') return { error: 'invalid' };
  const text =
    input.type === 'chat'
      ? validatePlayMessage(input.text)
      : (input.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_PLAY_MESSAGE);
  if (input.type === 'chat' && !text) return { error: 'invalid' };
  if (input.type === 'suggest') {
    const gameId = (input.game?.id || '').trim();
    const gameName = (input.game?.name || text || '').trim();
    if (!gameId || !gameName) return { error: 'invalid' };
  }
  const loaded = await loadPlaySession(sessionId);
  if ('error' in loaded) {
    if (loaded.error === 'expired' || loaded.error === 'ended') return { error: loaded.error };
    return { error: loaded.error === 'denied' ? 'denied' : 'invalid' };
  }
  if (!loaded.session.memberIds.includes(user.uid)) return { error: 'denied' };
  if (!canPostAt(loaded.session.lastPosted[user.uid] || 0)) return { error: 'rate' };

  const mid = newMessageId();
  const message =
    input.type === 'suggest'
      ? {
          type: 'suggest' as const,
          senderId: user.uid,
          senderName: actor.displayName.slice(0, 80),
          text: text || String(input.game?.name || 'Game').slice(0, MAX_PLAY_MESSAGE),
          createdAt: serverTimestamp(),
          gameId: String(input.game?.id || '').slice(0, 128),
          gameName: String(input.game?.name || '').slice(0, 120),
          gameIconUrl: String(input.game?.iconUrl || '').slice(0, 2000),
        }
      : {
          type: 'chat' as const,
          senderId: user.uid,
          senderName: actor.displayName.slice(0, 80),
          text: text || '',
          createdAt: serverTimestamp(),
        };

  try {
    await updateDoc(doc(getDb(), PLAY_SESSIONS, sessionId), {
      [`messages.${mid}`]: message,
      [`lastPosted.${user.uid}`]: serverTimestamp(),
      latestMessageId: mid,
    });
  } catch (err) {
    diagnose('postPlayMessage', err);
    const again = await loadPlaySession(sessionId);
    if ('error' in again) {
      if (again.error === 'expired' || again.error === 'ended') return { error: again.error };
      return { error: 'denied' };
    }
    if (!canPostAt(again.session.lastPosted[user.uid] || 0)) return { error: 'rate' };
    return { error: isPermissionDenied(err) ? 'denied' : 'invalid' };
  }
  return { ok: true };
}

export function subscribePlayLive(
  sessionId: string,
  handlers: {
    onSession?: (session: PlaySessionDoc) => void;
    onMembers?: (members: PlayMemberDoc[]) => void;
    onMessages?: (messages: Array<PlayMessageDoc & { id: string }>) => void;
    onError: (err: SessionLoadError) => void;
  },
): () => void {
  return onSnapshot(
    doc(getDb(), PLAY_SESSIONS, sessionId),
    (snap) => {
      if (!snap.exists()) {
        handlers.onError('invalid');
        return;
      }
      const raw = snap.data() as Record<string, unknown>;
      const session = parseSession(raw);
      handlers.onMembers?.(parseMembers(raw, session));
      handlers.onMessages?.(parseMessages(raw));
      if (session.status === 'ended') handlers.onError('ended');
      else if (sessionIsExpired(session.expiresAt)) handlers.onError('expired');
      else handlers.onSession?.(session);
    },
    (err) => {
      diagnose('subscribePlayLive', err);
      handlers.onError('denied');
    },
  );
}

export function subscribePlaySession(
  sessionId: string,
  onData: (session: PlaySessionDoc) => void,
  onError: (err: SessionLoadError) => void,
): () => void {
  return subscribePlayLive(sessionId, { onSession: onData, onError });
}

export function subscribePlayMembers(
  sessionId: string,
  onData: (members: PlayMemberDoc[]) => void,
): () => void {
  return subscribePlayLive(sessionId, { onMembers: onData, onError: () => {} });
}

export function subscribePlayMessages(
  sessionId: string,
  onData: (messages: Array<PlayMessageDoc & { id: string }>) => void,
): () => void {
  return subscribePlayLive(sessionId, { onMessages: onData, onError: () => {} });
}
