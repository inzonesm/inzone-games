'use client';

/* Payouts data layer — history reads plus the client half of the automated
 * payout system ported from the influencer hub (payoutService.ts /
 * paymentInfoService.ts / usePayout.ts), pointed at our /api/payouts route
 * instead of the hub's Flask backend.
 *
 *   payouts             append-only payout records (developer + creator legs)
 *   scheduled_payouts   one-shot scheduled payouts (via the API only)
 *   influencers/{uid}   paymentMethod type lives on the doc (the hub's
 *                       scheduler eligibility field) …
 *   influencers/{uid}/private/paymentInfo
 *                       … while account details stay in the private
 *                       subcollection (hub privatePaymentService), which the
 *                       rules restrict to the owner. */

import { collection, getDocs, query, where } from 'firebase/firestore';
import { getDb, getFirebaseAuth } from './firebase';

/* ── Unified history rows ──────────────────────────────────────────── */

export type PayoutStatus = 'paid' | 'pending' | 'processing' | 'failed';
export type PayoutSource = 'games' | 'creators';

export interface PayoutRecord {
  id: string;
  period: string;
  /** Which side of the platform earned it — a game title or the creator program. */
  source: PayoutSource;
  gross: number;
  fee: number;
  net: number;
  paid: string | null;
  status: PayoutStatus;
  createdAt: Date | null;
}

function toDate(val: unknown): Date | null {
  if (!val) return null;
  if (typeof (val as { toDate?: unknown }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate();
  }
  if (val instanceof Date) return val;
  if (typeof val === 'string' || typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function periodLabel(start: Date | null, end: Date | null, fallback: string): string {
  const fmt = (x: Date) => x.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  if (start && end && fmt(start) !== fmt(end)) return `${fmt(start)} – ${fmt(end)}`;
  if (start || end) return fmt((start || end) as Date);
  return fallback;
}

/** Deterministic next payout date — 15th of this month if still ahead, else
 *  next month (hub payout_scheduler.get_next_payout_date). Computed locally
 *  so the UI can show it instantly instead of waiting on the API. */
export function computeNextPayoutDate(now = new Date()): Date {
  const PAYOUT_DAY = 15;
  if (now.getUTCDate() < PAYOUT_DAY) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), PAYOUT_DAY));
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, PAYOUT_DAY));
}

/** Developer + creator payout records for this user, merged and sorted.
 *  Reads the append-only `payouts` collection for every candidate id
 *  (session uid, influencer doc id, app uid — same resolution creators use).
 *  All role×id queries run in PARALLEL. */
export async function fetchPayoutHistory(candidateIds: string[]): Promise<PayoutRecord[]> {
  const db = getDb();
  const roles = ['developer', 'creator'] as const;
  const snaps = await Promise.all(
    roles.flatMap((role) =>
      candidateIds.map(async (id) => {
        try {
          const snap = await getDocs(
            query(
              collection(db, 'payouts'),
              where('stakeholder_type', '==', role),
              where('stakeholder_id', '==', id),
            ),
          );
          return { role, snap };
        } catch {
          return null; // payouts collection not present yet
        }
      }),
    ),
  );

  const rows: PayoutRecord[] = [];
  const seen = new Set<string>();
  for (const item of snaps) {
    if (!item) continue;
    item.snap.docs.forEach((d) => {
      if (seen.has(d.id)) return;
      seen.add(d.id);
      const p = d.data() as Record<string, unknown>;
      const createdAt = toDate(p.created_at);
      const amount = Math.round((Number(p.amount) || 0) * 100) / 100;
      const status: PayoutStatus =
        p.status === 'paid' || p.status === 'processing' || p.status === 'failed'
          ? p.status
          : 'pending';
      rows.push({
        id: d.id,
        period: periodLabel(toDate(p.period_start), toDate(p.period_end), (p.period as string) || '—'),
        source: item.role === 'creator' ? 'creators' : 'games',
        // Records store the stakeholder's NET amount; the gross → fee →
        // net waterfall already happened in the ledger split.
        gross: amount,
        fee: 0,
        net: amount,
        paid:
          status === 'paid' && createdAt
            ? createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : null,
        status,
        createdAt,
      });
    });
  }
  rows.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  return rows;
}

/* ── /api/payouts client (hub payoutService.ts equivalent) ─────────── */

export interface ScheduledPayout {
  id: string;
  amount: number;
  currency: string;
  scheduledDate: string;
  status: string;
  description?: string;
}

export interface PayoutApiStatus {
  pendingDeveloper: number;
  pendingCreator: number;
  pendingTotal: number;
  minimumPayout: number;
  nextPayoutDate: string;
  paymentMethod: PaymentMethodType | null;
  scheduled: ScheduledPayout[];
}

async function authedFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error('User not authenticated');
  const idToken = await user.getIdToken();
  // Hard timeout so a hung API (e.g. misconfigured admin creds) can never
  // stall the page — callers treat aborts like any other failure.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(path, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPayoutStatus(): Promise<PayoutApiStatus | null> {
  try {
    const res = await authedFetch('/api/payouts');
    if (!res.ok) return null;
    return (await res.json()) as PayoutApiStatus;
  } catch {
    return null;
  }
}

export async function schedulePayout(): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await authedFetch('/api/payouts', {
      method: 'POST',
      body: JSON.stringify({ action: 'schedule' }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return res.ok ? { success: true } : { success: false, error: data.error || 'SCHEDULE_FAILED' };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'SCHEDULE_FAILED' };
  }
}

export async function processPayoutNow(): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await authedFetch('/api/payouts', {
      method: 'POST',
      body: JSON.stringify({ action: 'process' }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return res.ok ? { success: true } : { success: false, error: data.error || 'PROCESS_FAILED' };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'PROCESS_FAILED' };
  }
}

export async function cancelScheduledPayout(id: string): Promise<boolean> {
  try {
    const res = await authedFetch(`/api/payouts?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}

/* ── Payment method (hub paymentInfoService.ts equivalent) ─────────── */

export type PaymentMethodType = 'bank' | 'paypal' | 'venmo';

export interface PaymentInfo {
  paymentMethod: PaymentMethodType;
  /** bank */
  bankName?: string;
  accountHolder?: string;
  accountNumber?: string;
  routingNumber?: string;
  /** paypal */
  paypalEmail?: string;
  /** venmo */
  venmoUsername?: string;
}

/* Payment info goes through /api/payouts (Admin SDK) — the DEPLOYED client
 * rules deny writes to influencers and its private subcollection, so client
 * Firestore writes here would silently fail. */

export async function loadPaymentInfo(uid: string): Promise<PaymentInfo | null> {
  if (!uid) return null;
  try {
    const res = await authedFetch('/api/payouts?scope=payment');
    if (!res.ok) return null;
    const data = (await res.json()) as { paymentInfo?: Record<string, unknown> | null };
    const d = data.paymentInfo;
    const method = d?.paymentMethod;
    if (method !== 'bank' && method !== 'paypal' && method !== 'venmo') return null;
    return {
      paymentMethod: method,
      bankName: (d?.bankName as string) || '',
      accountHolder: (d?.accountHolder as string) || '',
      accountNumber: (d?.accountNumber as string) || '',
      routingNumber: (d?.routingNumber as string) || '',
      paypalEmail: (d?.paypalEmail as string) || '',
      venmoUsername: (d?.venmoUsername as string) || '',
    };
  } catch {
    return null;
  }
}

/** Save payment details privately (server-side) and mirror the method type
 *  onto the influencer doc — the hub scheduler's eligibility field. */
export async function savePaymentInfo(uid: string, info: PaymentInfo): Promise<void> {
  if (!uid) throw new Error('User not authenticated');
  const res = await authedFetch('/api/payouts', {
    method: 'PUT',
    body: JSON.stringify(info),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      data.error === 'ADMIN_NOT_CONFIGURED'
        ? 'Server is missing FIREBASE_SERVICE_ACCOUNT — restart after configuring it.'
        : data.error || 'Failed to save payment info.',
    );
  }
}
