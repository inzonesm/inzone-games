/**
 * Shared companion quotas. Firestore transactions are the deployment-wide
 * atomic backend. Process-local counters remain a fallback when Admin
 * credentials are absent (single instance only).
 *
 * Reserve before any paid chat or TTS call. Release on failure. Commit
 * adjusts reserved TTS characters down to the actual billed length.
 */

import { COMPANION_LIMITS } from './config.ts';
import {
  beginCompanionTurn,
  companionLimitError,
  finishCompanionTurn,
} from './limits.ts';

export type QuotaBackend = 'firestore' | 'process_local';
export type QuotaError = 'rate_limited' | 'concurrency' | 'spend_limited';

export type QuotaReservation =
  | {
      ok: true;
      backend: QuotaBackend;
      uid: string;
      reservedChars: number;
      day: string;
    }
  | { ok: false; error: QuotaError; backend: QuotaBackend };

function utcDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function quotaBackend(env: { [key: string]: string | undefined } = process.env): QuotaBackend {
  if (env.FIREBASE_SERVICE_ACCOUNT?.trim() || env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
    return 'firestore';
  }
  return 'process_local';
}

async function firestoreAdmin() {
  const [{ adminDb }, { FieldValue }] = await Promise.all([
    import('../firebase-admin.ts'),
    import('firebase-admin/firestore'),
  ]);
  return { db: adminDb(), FieldValue };
}

async function firestoreReserve(uid: string, reservedChars: number, now: number): Promise<QuotaReservation> {
  const { db } = await firestoreAdmin();
  const day = utcDay(now);
  try {
    await db.runTransaction(async (tx) => {
      const userRef = db.collection('companion_quota').doc(`uid_${uid}_${day}`);
      const globalRef = db.collection('companion_quota').doc(`global_${day}`);
      const lockRef = db.collection('companion_quota').doc(`lock_${uid}`);
      const [userSnap, globalSnap, lockSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(globalRef),
        tx.get(lockRef),
      ]);
      const lock = lockSnap.data() as { inflight?: number; leaseUntil?: number } | undefined;
      const inflight = (lock?.leaseUntil ?? 0) > now ? lock?.inflight ?? 0 : 0;
      if (inflight >= COMPANION_LIMITS.maxConcurrentPerUid) {
        throw Object.assign(new Error('concurrency'), { code: 'concurrency' });
      }
      const turns = Number(userSnap.data()?.turns || 0);
      if (turns >= COMPANION_LIMITS.maxTurnsPerWindow) {
        throw Object.assign(new Error('rate_limited'), { code: 'rate_limited' });
      }
      const chars = Number(userSnap.data()?.chars || 0);
      if (chars + reservedChars > COMPANION_LIMITS.maxTtsCharsPerUidDay) {
        throw Object.assign(new Error('spend_limited'), { code: 'spend_limited' });
      }
      const globalChars = Number(globalSnap.data()?.chars || 0);
      if (globalChars + reservedChars > COMPANION_LIMITS.maxTtsCharsGlobalDay) {
        throw Object.assign(new Error('spend_limited'), { code: 'spend_limited' });
      }
      tx.set(
        lockRef,
        { inflight: 1, leaseUntil: now + 45_000, uid, updatedAt: now },
        { merge: true },
      );
      tx.set(
        userRef,
        {
          turns: turns + 1,
          chars: chars + reservedChars,
          uid,
          day,
          updatedAt: now,
        },
        { merge: true },
      );
      tx.set(
        globalRef,
        { chars: globalChars + reservedChars, day, updatedAt: now },
        { merge: true },
      );
    });
    return { ok: true, backend: 'firestore', uid, reservedChars, day };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'concurrency' || code === 'rate_limited' || code === 'spend_limited') {
      return { ok: false, error: code, backend: 'firestore' };
    }
    throw err;
  }
}

async function firestoreAdjust(
  reservation: Extract<QuotaReservation, { ok: true }>,
  actualChars: number,
  releaseTurn: boolean,
): Promise<void> {
  const { db, FieldValue } = await firestoreAdmin();
  const delta = actualChars - reservation.reservedChars;
  await db.runTransaction(async (tx) => {
    const userRef = db.collection('companion_quota').doc(`uid_${reservation.uid}_${reservation.day}`);
    const globalRef = db.collection('companion_quota').doc(`global_${reservation.day}`);
    const lockRef = db.collection('companion_quota').doc(`lock_${reservation.uid}`);
    tx.set(lockRef, { inflight: 0, leaseUntil: 0, updatedAt: Date.now() }, { merge: true });
    tx.set(
      userRef,
      {
        chars: FieldValue.increment(delta),
        turns: FieldValue.increment(releaseTurn ? -1 : 0),
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    tx.set(
      globalRef,
      { chars: FieldValue.increment(delta), updatedAt: Date.now() },
      { merge: true },
    );
  });
}

export async function reserveCompanionUsage(
  uid: string,
  reservedChars: number,
  now = Date.now(),
): Promise<QuotaReservation> {
  const chars = Math.max(0, Math.min(COMPANION_LIMITS.maxReplyChars, Math.floor(reservedChars)));
  if (quotaBackend() === 'firestore') {
    return firestoreReserve(uid, chars, now);
  }
  const error = companionLimitError(uid, chars, now);
  if (error) return { ok: false, error, backend: 'process_local' };
  beginCompanionTurn(uid);
  return { ok: true, backend: 'process_local', uid, reservedChars: chars, day: utcDay(now) };
}

export async function commitCompanionUsage(
  reservation: Extract<QuotaReservation, { ok: true }>,
  actualChars: number,
): Promise<void> {
  const billed = Math.max(0, Math.floor(actualChars));
  if (reservation.backend === 'firestore') {
    await firestoreAdjust(reservation, billed, false);
    return;
  }
  finishCompanionTurn(reservation.uid, billed);
}

export async function releaseCompanionUsage(
  reservation: Extract<QuotaReservation, { ok: true }>,
): Promise<void> {
  if (reservation.backend === 'firestore') {
    await firestoreAdjust(reservation, 0, true);
    return;
  }
  finishCompanionTurn(reservation.uid, 0);
}
