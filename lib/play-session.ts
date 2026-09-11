'use client';

/**
 * Live play-session (invite → join → chat → suggest).
 *
 * Actor id is Firebase Auth uid only. Conversation lives in member-only
 * chunks so invite preview cannot stream chat. Each chunk is capped; a new
 * chunk opens when the current one is full so posting can continue.
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
  MAX_PLAY_CHUNK,
  MAX_PLAY_MESSAGE,
  PLAY_CHUNKS,
  PLAY_HISTORY_CHUNKS,
  PLAY_RATE_MS,
  PLAY_SEATS,
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
  PLAY_CHUNKS,
  PLAY_SEATS,
  PLAY_RATE_MS,
  PLAY_SESSION_COPY,
  PLAY_HISTORY_CHUNKS,
  MAX_PLAY_CHUNK,
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
  latestSeq: number;
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

function chunkRef(sessionId: string, seq: number) {
  return doc(getDb(), PLAY_SESSIONS, sessionId, PLAY_CHUNKS, String(seq));
}

function seatRef(sessionId: string, uid: string) {
  return doc(getDb(), PLAY_SESSIONS, sessionId, PLAY_SEATS, uid);
}

function historySeqs(latestSeq: number): number[] {
  const seqs: number[] = [];
  for (let i = 0; i < PLAY_HISTORY_CHUNKS; i++) {
    const seq = latestSeq - i;
    if (seq >= 0) seqs.push(seq);
  }
  return seqs;
}

let anonymousSignIn: Promise<User> | null = null;

export async function ensurePlaySessionUser(): Promise<User> {
  const auth = getFirebaseAuth();
  if (auth.currentUser) return auth.currentUser;
  if (!anonymousSignIn) {
    anonymousSignIn = signInAnonymously(auth)
      .then((cred) => cred.user)
      .finally(() => {
        anonymousSignIn = null;
      });
  }
  return anonymousSignIn;
}

export async function playSessionActor(user: User): Promise<PlaySessionActor> {
  if (user.isAnonymous) {
    return {
      uid: user.uid,
      displayName: (getGuestIdentity().username || 'Player').slice(0, 80),
      anonymous: true,
    };
  }
  const identity = await resolveIdentity(user);
  return {
    uid: user.uid,
    displayName: (identity.username || 'Player').slice(0, 80),
    anonymous: false,
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
    latestSeq: typeof raw.latestSeq === 'number' ? raw.latestSeq : 0,
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

function parseLastPosted(raw: Record<string, unknown>): Record<string, number> {
  const lastRaw = raw.lastPosted && typeof raw.lastPosted === 'object' ? (raw.lastPosted as Record<string, unknown>) : {};
  const lastPosted: Record<string, number> = {};
  for (const [k, v] of Object.entries(lastRaw)) lastPosted[k] = asMillis(v);
  return lastPosted;
}

/** Copy lastPosted as stored (timestamps), so opening the next chunk does not rewrite peers. */
function rawLastPosted(raw: Record<string, unknown>): Record<string, unknown> {
  const lastRaw = raw.lastPosted && typeof raw.lastPosted === 'object' ? (raw.lastPosted as Record<string, unknown>) : {};
  return { ...lastRaw };
}

function messageCount(raw: Record<string, unknown>): number {
  const bag =
    raw.messages && typeof raw.messages === 'object' ? (raw.messages as Record<string, unknown>) : {};
  return Object.keys(bag).length;
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
      latestSeq: 0,
    });
    if (gameId) {
      await setDoc(seatRef(id, user.uid), {
        gameId: gameId.slice(0, 128),
        updatedAt: serverTimestamp(),
      });
    }
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
  if (!loaded.session.memberIds.includes(user.uid)) {
    try {
      await updateDoc(doc(getDb(), PLAY_SESSIONS, sessionId), {
        memberIds: arrayUnion(user.uid),
        [`memberNames.${user.uid}`]: actor.displayName.slice(0, 80),
      });
    } catch (err) {
      const again = await loadPlaySession(sessionId);
      if ('error' in again || !again.session.memberIds.includes(user.uid)) {
        diagnose('joinPlaySession', err);
        return 'error' in again ? again.error : 'denied';
      }
    }
  }
  const after = await loadPlaySession(sessionId);
  const seq = !('error' in after) ? after.session.latestSeq : loaded.session.latestSeq;
  await admitToChunks(sessionId, user.uid, seq);
  return null;
}

export async function admitPlaySessionChunks(sessionId: string): Promise<void> {
  const user = await ensurePlaySessionUser();
  const loaded = await loadPlaySession(sessionId);
  if ('error' in loaded || !loaded.session.memberIds.includes(user.uid)) return;
  await admitToChunks(sessionId, user.uid, loaded.session.latestSeq);
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
      const latestSeq = typeof data.latestSeq === 'number' ? data.latestSeq : 0;
      if (!ids.includes(user.uid)) return;
      const chunkSnaps: Array<{ ref: ReturnType<typeof chunkRef>; exists: boolean }> = [];
      for (const seq of historySeqs(latestSeq)) {
        const cRef = chunkRef(sessionId, seq);
        const cSnap = await tx.get(cRef);
        chunkSnaps.push({ ref: cRef, exists: cSnap.exists() });
      }
      const patch: Record<string, unknown> = {
        memberIds: arrayRemove(user.uid),
        [`memberNames.${user.uid}`]: deleteField(),
      };
      if (ids.length <= 1) patch.status = 'ended';
      tx.update(ref, patch);
      for (const chunk of chunkSnaps) {
        if (chunk.exists) tx.update(chunk.ref, { memberIds: arrayRemove(user.uid) });
      }
    });
  } catch (err) {
    diagnose('leavePlaySession', err);
    throw err;
  }
}

function buildMessage(
  user: User,
  actor: PlaySessionActor,
  input: { type: PlayMessageType; text: string; game?: PlayGameRef | null },
  text: string,
) {
  return input.type === 'suggest'
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
}

async function admitToChunks(sessionId: string, uid: string, latestSeq: number): Promise<void> {
  await Promise.all(
    historySeqs(latestSeq).map((seq) =>
      updateDoc(chunkRef(sessionId, seq), { memberIds: arrayUnion(uid) }).catch(() => undefined),
    ),
  );
}

async function latestChunk(
  sessionId: string,
  latestSeq: number,
): Promise<{ seq: number; raw: Record<string, unknown> } | null> {
  for (const seq of historySeqs(latestSeq)) {
    try {
      const snap = await getDoc(chunkRef(sessionId, seq));
      if (snap.exists()) return { seq: Number((snap.data() as Record<string, unknown>).seq ?? seq), raw: snap.data() as Record<string, unknown> };
    } catch (err) {
      if (!isPermissionDenied(err)) throw err;
    }
  }
  return null;
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

  let latest: { seq: number; raw: Record<string, unknown> } | null = null;
  try {
    latest = await latestChunk(sessionId, loaded.session.latestSeq);
  } catch (err) {
    diagnose('postPlayMessage latestChunk', err);
    return { error: isPermissionDenied(err) ? 'denied' : 'invalid' };
  }
  const lastPosted = latest ? parseLastPosted(latest.raw) : {};
  if (!canPostAt(lastPosted[user.uid] || 0)) return { error: 'rate' };

  const mid = newMessageId();
  const message = buildMessage(user, actor, input, text || '');
  const count = latest ? messageCount(latest.raw) : 0;
  const openNext = Boolean(latest && count >= MAX_PLAY_CHUNK);
  const seq = latest ? (openNext ? latest.seq + 1 : latest.seq) : 0;
  const payload = openNext || !latest
    ? {
        seq,
        messages: { [mid]: message },
        lastPosted: { ...(latest ? rawLastPosted(latest.raw) : {}), [user.uid]: serverTimestamp() },
        latestMessageId: mid,
        memberIds: loaded.session.memberIds,
      }
    : {
        [`messages.${mid}`]: message,
        [`lastPosted.${user.uid}`]: serverTimestamp(),
        latestMessageId: mid,
      };

  try {
    if (openNext || !latest) {
      await setDoc(chunkRef(sessionId, seq), payload);
      if (openNext) {
        await updateDoc(doc(getDb(), PLAY_SESSIONS, sessionId), { latestSeq: seq });
      }
    } else await updateDoc(chunkRef(sessionId, seq), payload);
  } catch (err) {
    diagnose('postPlayMessage', err);
    return { error: isPermissionDenied(err) ? 'denied' : 'invalid' };
  }
  return { ok: true };
}

export async function loadPlaySeat(sessionId: string, uid: string): Promise<string | null> {
  try {
    const snap = await getDoc(seatRef(sessionId, uid));
    if (!snap.exists()) return null;
    const gameId = String((snap.data() as Record<string, unknown>).gameId || '').trim();
    return gameId || null;
  } catch (err) {
    diagnose('loadPlaySeat', err);
    return null;
  }
}

export async function savePlaySeat(sessionId: string, uid: string, gameId: string): Promise<void> {
  const id = gameId.trim().slice(0, 128);
  if (!id) return;
  try {
    await setDoc(seatRef(sessionId, uid), {
      gameId: id,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    diagnose('savePlaySeat', err);
  }
}

export function subscribePlayPreview(
  sessionId: string,
  handlers: {
    onSession?: (session: PlaySessionDoc) => void;
    onMembers?: (members: PlayMemberDoc[]) => void;
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
      if (session.status === 'ended') handlers.onError('ended');
      else if (sessionIsExpired(session.expiresAt)) handlers.onError('expired');
      else handlers.onSession?.(session);
    },
    (err) => {
      diagnose('subscribePlayPreview', err);
      handlers.onError('denied');
    },
  );
}

export function subscribePlayFeed(
  sessionId: string,
  handlers: {
    onMessages?: (messages: Array<PlayMessageDoc & { id: string }>) => void;
    onError: (err: SessionLoadError) => void;
  },
): () => void {
  let stopChunks = () => {};
  const bag = new Map<number, Array<PlayMessageDoc & { id: string }>>();
  const emit = () => {
    const msgs = [...bag.entries()]
      .sort((a, b) => a[0] - b[0])
      .flatMap(([, list]) => list);
    handlers.onMessages?.(msgs);
  };
  const listenSeq = (seq: number): (() => void) => {
    let unsub = () => {};
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let attempts = 0;
    const start = () => {
      if (stopped) return;
      unsub();
      unsub = onSnapshot(
        chunkRef(sessionId, seq),
        (cs) => {
          attempts = 0;
          if (!cs.exists()) {
            bag.delete(seq);
            emit();
            return;
          }
          bag.set(seq, parseMessages(cs.data() as Record<string, unknown>));
          emit();
        },
        (err) => {
          diagnose('subscribePlayFeed chunk', err);
          if (stopped) return;
          bag.delete(seq);
          emit();
          if (!isPermissionDenied(err)) {
            handlers.onError('denied');
            return;
          }
          attempts += 1;
          timer = setTimeout(start, attempts < 10 ? 200 : 1000);
        },
      );
    };
    start();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      unsub();
    };
  };
  const stopParent = onSnapshot(
    doc(getDb(), PLAY_SESSIONS, sessionId),
    (snap) => {
      if (!snap.exists()) {
        handlers.onError('invalid');
        return;
      }
      const latestSeq = typeof snap.data()?.latestSeq === 'number' ? snap.data().latestSeq : 0;
      stopChunks();
      bag.clear();
      const unsubs = historySeqs(latestSeq).map((seq) => listenSeq(seq));
      stopChunks = () => {
        unsubs.forEach((u) => u());
      };
    },
    (err) => {
      diagnose('subscribePlayFeed', err);
      handlers.onError('denied');
    },
  );
  return () => {
    stopParent();
    stopChunks();
  };
}

export function subscribePlayLive(
  sessionId: string,
  handlers: {
    onSession?: (session: PlaySessionDoc) => void;
    onMembers?: (members: PlayMemberDoc[]) => void;
    onMessages?: (messages: Array<PlayMessageDoc & { id: string }>) => void;
    onError: (err: SessionLoadError) => void;
    includeFeed?: boolean;
  },
): () => void {
  const stopPreview = subscribePlayPreview(sessionId, handlers);
  const stopFeed = handlers.includeFeed === false ? () => {} : subscribePlayFeed(sessionId, handlers);
    return () => {
      stopPreview();
      stopFeed();
    };
}

export function subscribePlaySession(
  sessionId: string,
  onData: (session: PlaySessionDoc) => void,
  onError: (err: SessionLoadError) => void,
): () => void {
  return subscribePlayPreview(sessionId, { onSession: onData, onError });
}

export function subscribePlayMembers(
  sessionId: string,
  onData: (members: PlayMemberDoc[]) => void,
): () => void {
  return subscribePlayPreview(sessionId, { onMembers: onData, onError: () => {} });
}

export function subscribePlayMessages(
  sessionId: string,
  onData: (messages: Array<PlayMessageDoc & { id: string }>) => void,
): () => void {
  return subscribePlayFeed(sessionId, { onMessages: onData, onError: () => {} });
}
