/* Automated payouts API — the influencer-hub payout system (backend/services/
 * payout_scheduler.py + the /api/payout/* endpoints payoutService.ts calls),
 * ported to a Next.js route on the new-schema economy:
 *
 *   · balances are DERIVED: sum(ledger_entries for the stakeholder) minus
 *     sum(paid payout records) — never a stored mutable number (brief §6.5),
 *     so there is no "reset pending amounts" step like the hub had
 *   · payouts run on the 15th monthly (hub PAYOUT_DAY), with a 30-day
 *     holdback window recorded on each payout (hub HOLDBACK_PERIOD_DAYS)
 *   · a payout requires a configured payment method (bank/paypal/venmo,
 *     hub get_influencers_for_payout eligibility check)
 *   · transfers go through initiateTransfer(), the same provider seam the
 *     hub left (_initiate_transfer → Stripe for bank, PayPal for
 *     paypal/venmo); wire real credentials there without touching callers
 *
 * Endpoints (Bearer ID token, same auth pattern as unity-publish):
 *   GET    /api/payouts             → balances, next payout date, scheduled list
 *   POST   /api/payouts {action}    → 'schedule' | 'process'
 *   DELETE /api/payouts?id=…        → cancel a scheduled payout
 */

import { NextResponse, type NextRequest } from 'next/server';
import { adminAuth, adminCredentialsConfigured, adminDb } from '@/lib/firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';

export const runtime = 'nodejs';

const PAYOUT_DAY = 15; // hub payout_scheduler.PAYOUT_DAY
const HOLDBACK_PERIOD_DAYS = 30; // hub payout_scheduler.HOLDBACK_PERIOD_DAYS
const MINIMUM_PAYOUT_USD = 50; // threshold shown on the payouts page

type Role = 'developer' | 'creator';
type Row = Record<string, unknown>;
/** Minimal snapshot shape — keeps this file typechecking even before
 *  firebase-admin's own types are installed. */
type Snap = { id: string; data: () => Row };

interface ScheduledPayoutItem {
  id: string;
  amount: number;
  currency: string;
  scheduledDate: string;
  status: string;
  description: string;
}

function err(code: string, status: number) {
  return NextResponse.json({ error: code }, { status });
}

async function uidFromRequest(req: NextRequest): Promise<{ uid: string; email: string | null } | null> {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email ?? null };
  } catch {
    return null;
  }
}

/** Next payout date — 15th of this month if still ahead, else next month
 *  (hub payout_scheduler.get_next_payout_date). */
function nextPayoutDate(now = new Date()): Date {
  if (now.getUTCDate() < PAYOUT_DAY) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), PAYOUT_DAY));
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, PAYOUT_DAY));
}

/** All ids this user's ledger rows may be keyed by (mirrors lib/creators.ts:
 *  session uid, influencer doc id, and the app-account `uid` field). */
async function candidateIds(db: Firestore, uid: string, email: string | null): Promise<string[]> {
  const ids = new Set<string>([uid]);
  try {
    let inf: Row | null = null;
    let infDocId: string | null = null;
    const byUid = await db.collection('influencers').doc(uid).get();
    if (byUid.exists) {
      inf = byUid.data() as Row;
      infDocId = byUid.id;
    } else if (email) {
      const clean = email.replace(/\+web@/, '@');
      const [local, domain] = clean.split('@');
      for (const candidate of [clean, `${local}+web@${domain}`]) {
        const snap = await db.collection('influencers').where('email', '==', candidate).limit(1).get();
        if (!snap.empty) {
          inf = snap.docs[0].data() as Row;
          infDocId = snap.docs[0].id;
          break;
        }
      }
    }
    if (infDocId && !infDocId.includes('@')) ids.add(infDocId);
    const appUid = inf?.uid;
    if (typeof appUid === 'string' && appUid.trim()) ids.add(appUid.trim());
  } catch {
    /* influencer resolution is best-effort */
  }
  return [...ids];
}

/** Derived balance for one role: ledger earned − payouts already paid.
 *  All per-id ledger/payout queries run in parallel. */
async function pendingForRole(db: Firestore, ids: string[], role: Role): Promise<number> {
  const perId = await Promise.all(
    ids.map(async (id) => {
      try {
        const [ledger, payouts] = await Promise.all([
          db.collection('ledger_entries')
            .where('stakeholder_type', '==', role)
            .where('stakeholder_id', '==', id)
            .get(),
          db.collection('payouts')
            .where('stakeholder_type', '==', role)
            .where('stakeholder_id', '==', id)
            .get(),
        ]);
        let earned = 0;
        let paid = 0;
        ledger.docs.forEach((d: Snap) => {
          earned += Number(d.data().amount) || 0;
        });
        payouts.docs.forEach((d: Snap) => {
          const p = d.data();
          if (p.status === 'paid' || p.status === 'processing') paid += Number(p.amount) || 0;
        });
        return earned - paid;
      } catch {
        return 0; // missing collections → zero balance
      }
    }),
  );
  const total = perId.reduce((s, n) => s + n, 0);
  return Math.max(0, Math.round(total * 100) / 100);
}

/** Payment fields the client may set (hub PaymentInformationCard shape). */
const PAYMENT_FIELDS = [
  'paymentMethod',
  'bankName',
  'accountHolder',
  'accountNumber',
  'routingNumber',
  'paypalEmail',
  'venmoUsername',
] as const;

/** Full payment info from the private subcollection (privatePaymentService).
 *  Read/written HERE with the Admin SDK because the deployed client rules
 *  deny influencers + private-subcollection writes entirely. */
async function paymentInfoFor(db: Firestore, uid: string): Promise<Row | null> {
  try {
    const priv = await db.collection('influencers').doc(uid).collection('private').doc('paymentInfo').get();
    if (priv.exists) {
      const d = priv.data() as Row;
      const m = d.paymentMethod;
      if (m === 'bank' || m === 'paypal' || m === 'venmo') {
        const out: Row = {};
        for (const k of PAYMENT_FIELDS) if (typeof d[k] === 'string') out[k] = d[k];
        return out;
      }
    }
    // Legacy: method type only, on the influencer doc.
    const inf = await db.collection('influencers').doc(uid).get();
    const onDoc = inf.exists ? (inf.data() as Row).paymentMethod : null;
    return onDoc === 'bank' || onDoc === 'paypal' || onDoc === 'venmo' ? { paymentMethod: onDoc } : null;
  } catch {
    return null;
  }
}

async function paymentMethodFor(db: Firestore, uid: string): Promise<string | null> {
  const info = await paymentInfoFor(db, uid);
  const m = info?.paymentMethod;
  return m === 'bank' || m === 'paypal' || m === 'venmo' ? m : null;
}

/** Provider seam — hub _initiate_transfer. Bank → Stripe, paypal/venmo →
 *  PayPal, exactly the split the hub documents; call the real APIs here. */
function initiateTransfer(method: string, uid: string, amount: number) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 15);
  return {
    success: true as const,
    transferId: `transfer_${stamp}_${uid.slice(0, 8)}`,
    provider: method === 'bank' ? 'stripe' : 'paypal',
    status: 'processing' as const,
    amount,
  };
}

async function scheduledFor(db: Firestore, uid: string): Promise<ScheduledPayoutItem[]> {
  try {
    const snap = await db
      .collection('scheduled_payouts')
      .where('user_id', '==', uid)
      .get();
    const items: Array<Row & { id: string }> = snap.docs.map((d: Snap) => ({ ...d.data(), id: d.id }));
    return items
      .filter((p) => p.status === 'scheduled' || p.status === 'processing')
      .map((p) => ({
        id: p.id,
        amount: Number(p.amount) || 0,
        currency: (p.currency as string) || 'USD',
        scheduledDate: (p.scheduledDate as string) || '',
        status: (p.status as string) || 'scheduled',
        description: (p.description as string) || '',
      }));
  } catch {
    return [];
  }
}

/** Fail fast when admin creds are missing (see firebase-admin.ts). */
function adminGuard(): NextResponse | null {
  return adminCredentialsConfigured()
    ? null
    : NextResponse.json({ error: 'ADMIN_NOT_CONFIGURED' }, { status: 503 });
}

/* ── GET — status (or just the payment info with ?scope=payment) ───── */
export async function GET(req: NextRequest) {
  const guard = adminGuard();
  if (guard) return guard;
  const who = await uidFromRequest(req);
  if (!who) return err('UNAUTHENTICATED', 401);
  const db = adminDb();

  // Lightweight branch for the payment-method widget: skips balance math.
  if (new URL(req.url).searchParams.get('scope') === 'payment') {
    const info = await paymentInfoFor(db, who.uid);
    return NextResponse.json({ paymentInfo: info, paymentMethod: info?.paymentMethod ?? null });
  }

  const ids = await candidateIds(db, who.uid, who.email);
  const [pendingDeveloper, pendingCreator, method, scheduled] = await Promise.all([
    pendingForRole(db, ids, 'developer'),
    pendingForRole(db, ids, 'creator'),
    paymentMethodFor(db, who.uid),
    scheduledFor(db, who.uid),
  ]);

  return NextResponse.json({
    pendingDeveloper,
    pendingCreator,
    pendingTotal: Math.round((pendingDeveloper + pendingCreator) * 100) / 100,
    minimumPayout: MINIMUM_PAYOUT_USD,
    nextPayoutDate: nextPayoutDate().toISOString(),
    paymentMethod: method,
    scheduled,
  });
}

/* ── PUT — save payment method (admin write; client rules deny these) ─ */
export async function PUT(req: NextRequest) {
  const guard = adminGuard();
  if (guard) return guard;
  const who = await uidFromRequest(req);
  if (!who) return err('UNAUTHENTICATED', 401);

  const body = (await req.json().catch(() => null)) as Row | null;
  const method = body?.paymentMethod;
  if (method !== 'bank' && method !== 'paypal' && method !== 'venmo') return err('INVALID_METHOD', 400);
  const info: Row = {};
  for (const k of PAYMENT_FIELDS) if (typeof body?.[k] === 'string') info[k] = body[k];

  const db = adminDb();
  await db
    .collection('influencers')
    .doc(who.uid)
    .collection('private')
    .doc('paymentInfo')
    .set({ ...info, paymentMethodUpdatedAt: new Date().toISOString() }, { merge: true });
  // Mirror the (non-sensitive) method type onto the influencer doc — the
  // hub scheduler's eligibility field.
  await db.collection('influencers').doc(who.uid).set({ uid: who.uid, paymentMethod: method }, { merge: true });
  return NextResponse.json({ success: true });
}

/* ── POST — schedule | process ─────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const guard = adminGuard();
  if (guard) return guard;
  const who = await uidFromRequest(req);
  if (!who) return err('UNAUTHENTICATED', 401);
  const db = adminDb();
  const body = (await req.json().catch(() => ({}))) as { action?: string };

  const ids = await candidateIds(db, who.uid, who.email);
  const [pendingDeveloper, pendingCreator, method] = await Promise.all([
    pendingForRole(db, ids, 'developer'),
    pendingForRole(db, ids, 'creator'),
    paymentMethodFor(db, who.uid),
  ]);
  const pendingTotal = Math.round((pendingDeveloper + pendingCreator) * 100) / 100;

  if (body.action === 'schedule') {
    // Hub PayoutScheduler: one scheduled payout at a time, for the next
    // payout date, for the currently available amount.
    if (pendingTotal <= 0) return err('NOTHING_TO_PAY', 400);
    if (!method) return err('NO_PAYMENT_METHOD', 400);
    const existing = await scheduledFor(db, who.uid);
    if (existing.some((p) => p.status === 'scheduled')) return err('ALREADY_SCHEDULED', 409);

    const when = nextPayoutDate();
    const ref = await db.collection('scheduled_payouts').add({
      user_id: who.uid,
      amount: pendingTotal,
      amount_developer: pendingDeveloper,
      amount_creator: pendingCreator,
      currency: 'USD',
      scheduledDate: when.toISOString(),
      status: 'scheduled',
      description: `Scheduled payout for ${when.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
      created_at: new Date().toISOString(),
    });
    return NextResponse.json({ success: true, id: ref.id, scheduledDate: when.toISOString(), amount: pendingTotal });
  }

  if (body.action === 'process') {
    // Hub process_payout: validate method, initiate transfer, record the
    // payout with a 30-day holdback. Runs the caller's due scheduled payout,
    // or an on-demand payout when past the minimum.
    if (!method) return err('NO_PAYMENT_METHOD', 400);
    if (pendingTotal <= 0) return err('NOTHING_TO_PAY', 400);
    if (pendingTotal < MINIMUM_PAYOUT_USD) return err('BELOW_MINIMUM', 400);

    const transfer = initiateTransfer(method, who.uid, pendingTotal);
    if (!transfer.success) return err('TRANSFER_FAILED', 502);

    const now = new Date();
    const holdbackEnd = new Date(now.getTime() + HOLDBACK_PERIOD_DAYS * 24 * 60 * 60 * 1000);
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const batch = db.batch();

    // Append-only payout records per role (brief §8 payouts shape); the
    // derived balance drops to zero because these rows now offset the ledger.
    for (const [role, amount] of [
      ['developer', pendingDeveloper],
      ['creator', pendingCreator],
    ] as const) {
      if (amount <= 0) continue;
      batch.set(db.collection('payouts').doc(), {
        stakeholder_type: role,
        stakeholder_id: who.uid,
        period_start: periodStart.toISOString(),
        period_end: now.toISOString(),
        amount,
        currency: 'USD',
        status: 'paid',
        transfer_id: transfer.transferId,
        provider: transfer.provider,
        payment_method: method,
        holdback_release_end: holdbackEnd.toISOString(),
        created_at: now.toISOString(),
      });
    }

    // Mark any due scheduled payout as completed (hub status transition).
    const due = await scheduledFor(db, who.uid);
    due
      .filter((p) => p.status === 'scheduled')
      .forEach((p) => {
        batch.update(db.collection('scheduled_payouts').doc(p.id), {
          status: 'completed',
          transfer_id: transfer.transferId,
          processed_at: now.toISOString(),
        });
      });

    await batch.commit();
    return NextResponse.json({
      success: true,
      transferId: transfer.transferId,
      provider: transfer.provider,
      amount: pendingTotal,
      holdbackReleaseEnd: holdbackEnd.toISOString(),
    });
  }

  return err('UNKNOWN_ACTION', 400);
}

/* ── DELETE — cancel a scheduled payout ────────────────────────────── */
export async function DELETE(req: NextRequest) {
  const guard = adminGuard();
  if (guard) return guard;
  const who = await uidFromRequest(req);
  if (!who) return err('UNAUTHENTICATED', 401);
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return err('MISSING_ID', 400);

  const db = adminDb();
  const ref = db.collection('scheduled_payouts').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return err('NOT_FOUND', 404);
  const data = snap.data() as Row;
  if (data.user_id !== who.uid) return err('FORBIDDEN', 403);
  if (data.status !== 'scheduled') return err('NOT_CANCELLABLE', 409);

  await ref.update({ status: 'cancelled', cancelled_at: new Date().toISOString() });
  return NextResponse.json({ success: true });
}
