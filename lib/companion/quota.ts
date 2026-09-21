/**
 * Shared companion quotas for paid chat and TTS.
 *
 * Hosted OpenAI / ElevenLabs calls require a working Firestore backend
 * (`FIREBASE_SERVICE_ACCOUNT`). Process-local maps never authorize paid
 * spend — they only rate-limit the free scripted + browser path.
 *
 * Reserve before any paid call. Each reservation has a unique id and a
 * settled flag so duplicate commit/release is a no-op. An expired lease
 * reclaims both reserved chat and reserved TTS. Chat characters and TTS
 * characters are tracked separately; TTS length is not model usage.
 */

import { COMPANION_LIMITS } from './config.ts';
import {
  beginCompanionTurn,
  companionLimitError,
  finishCompanionTurn,
} from './limits.ts';

export const REQUIRED_QUOTA_SETTING = 'FIREBASE_SERVICE_ACCOUNT' as const;
export const QUOTA_LEASE_MS = 45_000;

export type QuotaBackend = 'firestore' | 'process_local';
export type QuotaError = 'rate_limited' | 'concurrency' | 'spend_limited' | 'quota_unavailable';
export type UsageAmounts = { chatChars: number; ttsChars: number };

export type QuotaReservationRecord = {
  reservationId: string;
  chatChars: number;
  ttsChars: number;
  settled: boolean;
  leaseUntil: number;
};

export type UserQuotaDoc = {
  uid: string;
  day: string;
  turns: number;
  chatChars: number;
  ttsChars: number;
  reservations: Record<string, QuotaReservationRecord>;
  updatedAt: number;
};

export type GlobalQuotaDoc = {
  day: string;
  chatChars: number;
  ttsChars: number;
  updatedAt: number;
};

export type LockDoc = {
  inflight: number;
  leaseUntil: number;
  reservationId: string | null;
  uid: string;
  updatedAt: number;
};

export type QuotaReservation =
  | {
      ok: true;
      backend: 'firestore';
      uid: string;
      day: string;
      reservationId: string;
      reservedChatChars: number;
      reservedTtsChars: number;
      leaseUntil: number;
    }
  | {
      ok: false;
      error: QuotaError;
      backend: QuotaBackend;
      requiredSetting?: typeof REQUIRED_QUOTA_SETTING;
    };

export function utcDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function requiredQuotaSetting(): typeof REQUIRED_QUOTA_SETTING {
  return REQUIRED_QUOTA_SETTING;
}

export function paidQuotaReady(
  env: { [key: string]: string | undefined } = process.env,
): boolean {
  return Boolean(
    env.FIREBASE_SERVICE_ACCOUNT?.trim() || env.GOOGLE_APPLICATION_CREDENTIALS?.trim(),
  );
}

export function quotaBackend(
  env: { [key: string]: string | undefined } = process.env,
): QuotaBackend {
  return paidQuotaReady(env) ? 'firestore' : 'process_local';
}

function clampChars(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}

export function clampUsage(amounts: UsageAmounts): UsageAmounts {
  return {
    chatChars: clampChars(amounts.chatChars),
    ttsChars: clampChars(amounts.ttsChars),
  };
}

export function emptyUserDoc(uid: string, day: string, now: number): UserQuotaDoc {
  return { uid, day, turns: 0, chatChars: 0, ttsChars: 0, reservations: {}, updatedAt: now };
}

export function emptyGlobalDoc(day: string, now: number): GlobalQuotaDoc {
  return { day, chatChars: 0, ttsChars: 0, updatedAt: now };
}

export function emptyLock(uid: string, now: number): LockDoc {
  return { inflight: 0, leaseUntil: 0, reservationId: null, uid, updatedAt: now };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function parseUserDoc(
  data: unknown,
  uid: string,
  day: string,
  now: number,
): UserQuotaDoc {
  const raw = asRecord(data);
  const reservations: Record<string, QuotaReservationRecord> = {};
  for (const [id, row] of Object.entries(asRecord(raw.reservations))) {
    const rec = asRecord(row);
    const reservationId = typeof rec.reservationId === 'string' ? rec.reservationId : id;
    reservations[id] = {
      reservationId,
      chatChars: clampChars(Number(rec.chatChars || 0)),
      ttsChars: clampChars(Number(rec.ttsChars || 0)),
      settled: rec.settled === true,
      leaseUntil: clampChars(Number(rec.leaseUntil || 0)),
    };
  }
  return {
    uid,
    day,
    turns: clampChars(Number(raw.turns || 0)),
    chatChars: clampChars(Number(raw.chatChars || 0)),
    ttsChars: clampChars(Number(raw.ttsChars ?? raw.chars ?? 0)),
    reservations,
    updatedAt: clampChars(Number(raw.updatedAt || now)),
  };
}

export function parseGlobalDoc(data: unknown, day: string, now: number): GlobalQuotaDoc {
  const raw = asRecord(data);
  return {
    day,
    chatChars: clampChars(Number(raw.chatChars || 0)),
    ttsChars: clampChars(Number(raw.ttsChars ?? raw.chars ?? 0)),
    updatedAt: clampChars(Number(raw.updatedAt || now)),
  };
}

export function parseLockDoc(data: unknown, uid: string, now: number): LockDoc {
  const raw = asRecord(data);
  return {
    inflight: clampChars(Number(raw.inflight || 0)),
    leaseUntil: clampChars(Number(raw.leaseUntil || 0)),
    reservationId: typeof raw.reservationId === 'string' ? raw.reservationId : null,
    uid,
    updatedAt: clampChars(Number(raw.updatedAt || now)),
  };
}

function floorUsage(doc: { chatChars: number; ttsChars: number }): void {
  doc.chatChars = Math.max(0, doc.chatChars);
  doc.ttsChars = Math.max(0, doc.ttsChars);
}

function releaseReservationAmounts(
  user: UserQuotaDoc,
  global: GlobalQuotaDoc,
  rec: QuotaReservationRecord,
  releaseTurn: boolean,
): void {
  user.chatChars -= rec.chatChars;
  user.ttsChars -= rec.ttsChars;
  global.chatChars -= rec.chatChars;
  global.ttsChars -= rec.ttsChars;
  floorUsage(user);
  floorUsage(global);
  if (releaseTurn) user.turns = Math.max(0, user.turns - 1);
}

export function reclaimExpiredReservations(
  user: UserQuotaDoc,
  global: GlobalQuotaDoc,
  lock: LockDoc,
  now: number,
): { user: UserQuotaDoc; global: GlobalQuotaDoc; lock: LockDoc; reclaimed: string[] } {
  const nextUser = { ...user, reservations: { ...user.reservations } };
  const nextGlobal = { ...global };
  let nextLock = { ...lock };
  const reclaimed: string[] = [];
  for (const [id, rec] of Object.entries(nextUser.reservations)) {
    if (rec.settled || rec.leaseUntil > now) continue;
    releaseReservationAmounts(nextUser, nextGlobal, rec, true);
    delete nextUser.reservations[id];
    reclaimed.push(id);
  }
  if (nextLock.leaseUntil > 0 && nextLock.leaseUntil <= now) {
    nextLock = { ...nextLock, inflight: 0, leaseUntil: 0, reservationId: null, updatedAt: now };
  }
  nextUser.updatedAt = now;
  nextGlobal.updatedAt = now;
  return { user: nextUser, global: nextGlobal, lock: nextLock, reclaimed };
}

export function planReserve(input: {
  user: UserQuotaDoc;
  global: GlobalQuotaDoc;
  lock: LockDoc;
  uid: string;
  day: string;
  amounts: UsageAmounts;
  now: number;
  reservationId: string;
}):
  | {
      ok: true;
      user: UserQuotaDoc;
      global: GlobalQuotaDoc;
      lock: LockDoc;
      reservation: QuotaReservationRecord;
    }
  | { ok: false; error: Exclude<QuotaError, 'quota_unavailable'> } {
  const reclaimed = reclaimExpiredReservations(input.user, input.global, input.lock, input.now);
  const amounts = clampUsage(input.amounts);
  const inflight =
    reclaimed.lock.leaseUntil > input.now ? reclaimed.lock.inflight : 0;
  if (inflight >= COMPANION_LIMITS.maxConcurrentPerUid) {
    return { ok: false, error: 'concurrency' };
  }
  if (reclaimed.user.turns >= COMPANION_LIMITS.maxTurnsPerWindow) {
    return { ok: false, error: 'rate_limited' };
  }
  if (
    reclaimed.user.chatChars + amounts.chatChars > COMPANION_LIMITS.maxChatCharsPerUidDay ||
    reclaimed.global.chatChars + amounts.chatChars > COMPANION_LIMITS.maxChatCharsGlobalDay ||
    reclaimed.user.ttsChars + amounts.ttsChars > COMPANION_LIMITS.maxTtsCharsPerUidDay ||
    reclaimed.global.ttsChars + amounts.ttsChars > COMPANION_LIMITS.maxTtsCharsGlobalDay
  ) {
    return { ok: false, error: 'spend_limited' };
  }
  const reservation: QuotaReservationRecord = {
    reservationId: input.reservationId,
    chatChars: amounts.chatChars,
    ttsChars: amounts.ttsChars,
    settled: false,
    leaseUntil: input.now + QUOTA_LEASE_MS,
  };
  const user: UserQuotaDoc = {
    ...reclaimed.user,
    uid: input.uid,
    day: input.day,
    turns: reclaimed.user.turns + 1,
    chatChars: reclaimed.user.chatChars + amounts.chatChars,
    ttsChars: reclaimed.user.ttsChars + amounts.ttsChars,
    reservations: { ...reclaimed.user.reservations, [input.reservationId]: reservation },
    updatedAt: input.now,
  };
  const global: GlobalQuotaDoc = {
    ...reclaimed.global,
    day: input.day,
    chatChars: reclaimed.global.chatChars + amounts.chatChars,
    ttsChars: reclaimed.global.ttsChars + amounts.ttsChars,
    updatedAt: input.now,
  };
  const lock: LockDoc = {
    inflight: 1,
    leaseUntil: reservation.leaseUntil,
    reservationId: input.reservationId,
    uid: input.uid,
    updatedAt: input.now,
  };
  return { ok: true, user, global, lock, reservation };
}

export function planSettle(input: {
  user: UserQuotaDoc;
  global: GlobalQuotaDoc;
  lock: LockDoc;
  reservationId: string;
  actual: UsageAmounts;
  releaseTurn: boolean;
  now: number;
}): { user: UserQuotaDoc; global: GlobalQuotaDoc; lock: LockDoc; applied: boolean } {
  const rec = input.user.reservations[input.reservationId];
  if (!rec || rec.settled) {
    return { user: input.user, global: input.global, lock: input.lock, applied: false };
  }
  const actual = clampUsage(input.actual);
  const user: UserQuotaDoc = {
    ...input.user,
    reservations: { ...input.user.reservations },
    updatedAt: input.now,
  };
  const global: GlobalQuotaDoc = { ...input.global, updatedAt: input.now };
  user.chatChars += actual.chatChars - rec.chatChars;
  user.ttsChars += actual.ttsChars - rec.ttsChars;
  global.chatChars += actual.chatChars - rec.chatChars;
  global.ttsChars += actual.ttsChars - rec.ttsChars;
  floorUsage(user);
  floorUsage(global);
  if (input.releaseTurn) user.turns = Math.max(0, user.turns - 1);
  delete user.reservations[input.reservationId];
  let lock = input.lock;
  if (lock.reservationId === input.reservationId) {
    lock = { ...lock, inflight: 0, leaseUntil: 0, reservationId: null, updatedAt: input.now };
  }
  return { user, global, lock, applied: true };
}

async function firestoreAdmin() {
  const { adminDb } = await import('../firebase-admin.ts');
  return { db: adminDb() };
}

async function firestoreReserve(
  uid: string,
  amounts: UsageAmounts,
  now: number,
): Promise<QuotaReservation> {
  const { db } = await firestoreAdmin();
  const day = utcDay(now);
  const reservationId = crypto.randomUUID();
  try {
    const planned = await db.runTransaction(async (tx) => {
      const userRef = db.collection('companion_quota').doc(`uid_${uid}_${day}`);
      const globalRef = db.collection('companion_quota').doc(`global_${day}`);
      const lockRef = db.collection('companion_quota').doc(`lock_${uid}`);
      const [userSnap, globalSnap, lockSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(globalRef),
        tx.get(lockRef),
      ]);
      const result = planReserve({
        user: parseUserDoc(userSnap.data(), uid, day, now),
        global: parseGlobalDoc(globalSnap.data(), day, now),
        lock: parseLockDoc(lockSnap.data(), uid, now),
        uid,
        day,
        amounts,
        now,
        reservationId,
      });
      if (!result.ok) {
        throw Object.assign(new Error(result.error), { code: result.error });
      }
      tx.set(userRef, result.user);
      tx.set(globalRef, result.global);
      tx.set(lockRef, result.lock);
      return result.reservation;
    });
    return {
      ok: true,
      backend: 'firestore',
      uid,
      day,
      reservationId: planned.reservationId,
      reservedChatChars: planned.chatChars,
      reservedTtsChars: planned.ttsChars,
      leaseUntil: planned.leaseUntil,
    };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'concurrency' || code === 'rate_limited' || code === 'spend_limited') {
      return { ok: false, error: code, backend: 'firestore' };
    }
    return {
      ok: false,
      error: 'quota_unavailable',
      backend: 'firestore',
      requiredSetting: REQUIRED_QUOTA_SETTING,
    };
  }
}

async function firestoreSettle(
  reservation: Extract<QuotaReservation, { ok: true }>,
  actual: UsageAmounts,
  releaseTurn: boolean,
): Promise<void> {
  const { db } = await firestoreAdmin();
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const userRef = db.collection('companion_quota').doc(`uid_${reservation.uid}_${reservation.day}`);
    const globalRef = db.collection('companion_quota').doc(`global_${reservation.day}`);
    const lockRef = db.collection('companion_quota').doc(`lock_${reservation.uid}`);
    const [userSnap, globalSnap, lockSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(globalRef),
      tx.get(lockRef),
    ]);
    const settled = planSettle({
      user: parseUserDoc(userSnap.data(), reservation.uid, reservation.day, now),
      global: parseGlobalDoc(globalSnap.data(), reservation.day, now),
      lock: parseLockDoc(lockSnap.data(), reservation.uid, now),
      reservationId: reservation.reservationId,
      actual,
      releaseTurn,
      now,
    });
    if (!settled.applied) return;
    tx.set(userRef, settled.user);
    tx.set(globalRef, settled.global);
    tx.set(lockRef, settled.lock);
  });
}

export async function reserveCompanionUsage(
  uid: string,
  amounts: UsageAmounts,
  now = Date.now(),
  env: { [key: string]: string | undefined } = process.env,
): Promise<QuotaReservation> {
  const next = clampUsage(amounts);
  if (!paidQuotaReady(env)) {
    return {
      ok: false,
      error: 'quota_unavailable',
      backend: 'process_local',
      requiredSetting: REQUIRED_QUOTA_SETTING,
    };
  }
  return firestoreReserve(uid, next, now);
}

export async function commitCompanionUsage(
  reservation: Extract<QuotaReservation, { ok: true }>,
  actual: UsageAmounts,
): Promise<void> {
  await firestoreSettle(reservation, clampUsage(actual), false);
}

export async function releaseCompanionUsage(
  reservation: Extract<QuotaReservation, { ok: true }>,
): Promise<void> {
  await firestoreSettle(reservation, { chatChars: 0, ttsChars: 0 }, true);
}

/** Process-local turn limiter for the free scripted + browser path only. */
export function reserveFreeCompanionTurn(
  uid: string,
  now = Date.now(),
): { ok: true } | { ok: false; error: Exclude<QuotaError, 'quota_unavailable'> } {
  const error = companionLimitError(uid, 0, now);
  if (error) return { ok: false, error };
  beginCompanionTurn(uid);
  return { ok: true };
}

export function finishFreeCompanionTurn(uid: string, now = Date.now()): void {
  finishCompanionTurn(uid, 0, now);
}
