/* Admin API — the influencer-hub's admin backend (backend/app.py) ported to
 * a Next.js route: application review + Mailchimp sync + CSV export, gated
 * to admin accounts.
 *
 *   is_admin            → lib/admin-shared ADMIN_EMAILS (hub list plus
 *                         jshim777@terpmail.umd.edu) + the hub's
 *                         humanUsers/{email}.isAdmin Firestore fallback
 *   GET  ?view=pending | authenticated | accepted-not-signed-up
 *                       → hub /api/admin/applications[...] list filters
 *   GET  ?view=export   → hub /api/admin/export-influencers (CSV download)
 *   POST {action:'review', email, status}
 *                       → hub /api/admin/applications/<email>: status +
 *                         is_accepted/is_authenticated flags, OneLink
 *                         referral_link generation (+ humanUsers copy),
 *                         contentStats/yieldStats seeding
 *   POST {action:'sync-mailchimp'}
 *                       → hub /api/admin/sync-mailchimp: create_or_update
 *                         every influencer in the audience with FNAME/LNAME/
 *                         COMPANY/LINK merge fields and the Accepted
 *                         Ambassador / Not Accepted influencer tag           */

import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { adminAuth, adminCredentialsConfigured, adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { ADMIN_EMAILS } from '@/lib/admin-shared';

export const runtime = 'nodejs';

/* Mailchimp config — same env names and development defaults as the hub. */
const MAILCHIMP_API_KEY = process.env.MAILCHIMP_API_KEY || 'fe969d4e44691be45a26dd3619fae03a-us14';
const MAILCHIMP_SERVER_PREFIX = process.env.MAILCHIMP_SERVER_PREFIX || 'us14';
const MAILCHIMP_AUDIENCE_ID = process.env.MAILCHIMP_AUDIENCE_ID || '8be0c23396';

type Row = Record<string, unknown>;
type Snap = { id: string; data: () => Row };

function err(code: string, status: number) {
  return NextResponse.json({ error: code }, { status });
}

/** hub is_admin(): allow-list first, then humanUsers/{email}.isAdmin. */
async function isAdmin(db: Firestore, email: string | null): Promise<boolean> {
  if (!email) return false;
  const normalized = email.includes('+web@') ? email.replace('+web@', '@') : email;
  const list = ADMIN_EMAILS as readonly string[];
  if (list.includes(email) || list.includes(normalized)) return true;
  try {
    const u = await db.collection('humanUsers').doc(email).get();
    return u.exists && (u.data() as Row).isAdmin === true;
  } catch {
    return false;
  }
}

async function requireAdmin(req: NextRequest): Promise<{ db: Firestore; email: string } | NextResponse> {
  if (!adminCredentialsConfigured()) return err('ADMIN_NOT_CONFIGURED', 503);
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return err('UNAUTHENTICATED', 401);
  let email: string | null = null;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    email = decoded.email ?? null;
  } catch {
    return err('UNAUTHENTICATED', 401);
  }
  const db = adminDb();
  if (!(await isAdmin(db, email))) return err('FORBIDDEN', 403);
  return { db, email: email as string };
}

/* ── Applications (hub list filters, duplicate-safe) ───────────────── */

/** Case-insensitive, +web-stripped email key. Duplicate influencer docs are
 *  real in this dataset (the hub's application doc + one uid-keyed doc per
 *  auth account that signed in, sometimes differing only by email case), so
 *  every list/review operation works on the EMAIL GROUP, never a single doc. */
function normEmail(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase().replace('+web@', '@') : '';
}

function groupByEmail(all: Row[]): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const d of all) {
    const key = normEmail(d.email) || normEmail(d.id) || (d.id as string);
    const list = groups.get(key);
    if (list) list.push(d);
    else groups.set(key, [d]);
  }
  return groups;
}

async function listApplications(db: Firestore, view: string): Promise<Row[]> {
  const snap = await db.collection('influencers').get();
  const all: Row[] = snap.docs.map((d: Snap) => ({ ...d.data(), id: d.id }));

  const out: Row[] = [];
  for (const docs of groupByEmail(all).values()) {
    // Group-level status: a doc accepted/authenticated ANYWHERE means the
    // email is not pending, no matter how many duplicates linger.
    const anyAuthenticated = docs.some((d) => d.is_authenticated === true);
    const anyAccepted = docs.some((d) => d.is_accepted === true);
    const anyRejected = docs.some((d) => d.rejected === true || d.status === 'rejected');
    const signedUp = docs.some((d) => typeof d.uid === 'string' && !!d.uid);

    const matches =
      view === 'authenticated'
        ? anyAuthenticated
        : view === 'accepted-not-signed-up'
          ? anyAccepted && !anyAuthenticated && !signedUp
          : !anyAuthenticated && !anyAccepted && !anyRejected; // pending
    if (!matches) continue;

    // One row per email: prefer the doc carrying the application fields.
    const rep =
      docs.find((d) => d.why || d.followers || d.instagram || d.tiktok) ||
      docs.find((d) => typeof d.uid === 'string' && !!d.uid) ||
      docs[0];
    out.push(rep);
  }
  return out;
}

function toCsv(rows: Row[]): string {
  const cols = ['name', 'email', 'username', 'followers', 'instagram', 'twitter', 'tiktok', 'twitch', 'status', 'is_accepted', 'is_authenticated', 'referral_link'];
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

export async function GET(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (ctx instanceof NextResponse) return ctx;
  const { db } = ctx;
  const view = new URL(req.url).searchParams.get('view') || 'pending';

  if (view === 'export') {
    const snap = await db.collection('influencers').get();
    const all: Row[] = snap.docs.map((d: Snap) => ({ ...d.data(), id: d.id }));
    return new NextResponse(toCsv(all), {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="influencers_export_${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  }

  const applications = await listApplications(db, view);
  return NextResponse.json({ applications });
}

/* ── Review (hub /api/admin/applications/<email>) ──────────────────── */

async function reviewApplication(db: Firestore, email: string, status: 'accepted' | 'rejected') {
  // Update EVERY doc for this email, matched case-insensitively on the email
  // field AND the doc id. The old `.limit(1)` exact-match version updated one
  // of the duplicates and left its twins in the pending list forever.
  const target = normEmail(email);
  if (!target) return { ok: false as const, code: 'NOT_FOUND' };
  const snap = await db.collection('influencers').get();
  const matches = snap.docs.filter((d) => {
    const data = d.data() as Row;
    return normEmail(data.email) === target || normEmail(d.id) === target;
  });
  if (matches.length === 0) return { ok: false as const, code: 'NOT_FOUND' };

  // The group's app-account uid (any duplicate that has one) drives the
  // is_authenticated flip and OneLink issuance for the whole group.
  const groupUid =
    (matches
      .map((d) => (d.data() as Row).uid)
      .find((u) => typeof u === 'string' && !!u) as string | undefined) || null;
  const existingLink =
    (matches
      .map((d) => (d.data() as Row).referral_link)
      .find((l) => typeof l === 'string' && !!l) as string | undefined) || null;
  const referralLink =
    existingLink ||
    (groupUid
      ? `https://join-inzone.onelink.me/SACg?af_xp=custom&pid=my_media_source&deep_link_value=referral&deep_link_sub1=${groupUid}`
      : null);

  const today = new Date();
  let payout = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 15));
  if (today > payout || (payout.getTime() - today.getTime()) / 86400000 < 7) {
    payout = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 15));
  }

  const batch = db.batch();
  for (const d of matches) {
    const data = d.data() as Row;
    const update: Row = { status, is_accepted: status === 'accepted' };

    if (status === 'accepted' && groupUid) {
      update.is_authenticated = true;
      update.date_authenticated = FieldValue.serverTimestamp();
    } else if (status === 'rejected') {
      update.is_authenticated = false;
      update.date_authenticated = null;
      update.rejected = true;
    }

    if (status === 'accepted') {
      // OneLink referral link, generated once per group (hub review logic).
      if (referralLink && data.referral_link == null) update.referral_link = referralLink;
      if (groupUid && !data.contentStats) {
        update.contentStats = { totalPosts: 0, thisWeekPosts: 0, engagement: 0, reachGrowth: 0 };
      }
      if (groupUid && !data.yieldStats) {
        update.yieldStats = {
          totalEarned: 0.0,
          pendingPayout: 0.0,
          nextPayoutDate: payout.toISOString(),
          adShareRate: 30,
          purchaseShareRate: 10,
          tipShareRate: 80,
        };
      }
    }
    batch.update(d.ref, update);
  }
  await batch.commit();

  // Mirror the link to the app profile once (hub review endpoint).
  if (status === 'accepted' && groupUid && referralLink && !existingLink) {
    const rep = matches.map((d) => d.data() as Row).find((r) => r.uid === groupUid) as Row;
    const huRef = db.collection('humanUsers').doc(groupUid);
    const hu = await huRef.get();
    if (hu.exists) {
      await huRef.update({ referral_link: referralLink });
    } else {
      await huRef.set({
        uid: groupUid,
        email: (rep?.email as string) || email,
        username: (rep?.username as string) || '',
        referral_link: referralLink,
        date_created: FieldValue.serverTimestamp(),
      });
    }
  }

  return { ok: true as const };
}

/* ── Mailchimp sync (hub /api/admin/sync-mailchimp) ────────────────── */

async function mailchimpFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`https://${MAILCHIMP_SERVER_PREFIX}.api.mailchimp.com/3.0${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(`apikey:${MAILCHIMP_API_KEY}`).toString('base64')}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  return res;
}

async function syncMailchimp(db: Firestore) {
  if (!MAILCHIMP_API_KEY || !MAILCHIMP_AUDIENCE_ID) {
    return { status: 500, body: { success: false, error: 'Mailchimp client not configured' } };
  }

  // Verify the audience exists (hub checks before syncing).
  const aud = await mailchimpFetch(`/lists/${MAILCHIMP_AUDIENCE_ID}`);
  if (!aud.ok) {
    return { status: 404, body: { success: false, error: `Mailchimp audience not found: ${MAILCHIMP_AUDIENCE_ID}` } };
  }

  const snap = await db.collection('influencers').get();
  const influencers = snap.docs
    .map((d: Snap) => {
      const data = d.data();
      const name = ((data.name as string) || '').trim();
      let firstName = ((data.first_name as string) || '').trim();
      let lastName = ((data.last_name as string) || '').trim();
      if (!firstName && name) {
        const parts = name.split(/\s+/);
        firstName = parts[0] || 'Unknown';
        lastName = parts.slice(1).join(' ');
      }
      return {
        email: ((data.email as string) || '').trim().toLowerCase(),
        firstName: firstName || 'Unknown',
        lastName,
        referralLink: (data.referral_link as string) || '',
        accepted: data.is_authenticated === true || data.is_accepted === true,
      };
    })
    .filter((i) => !!i.email);

  let synced = 0;
  let failed = 0;
  const errors: Array<{ email: string; error: string }> = [];

  for (const inf of influencers) {
    const tag = inf.accepted ? 'Accepted Ambassador' : 'Not Accepted influencer';
    const hash = createHash('md5').update(inf.email).digest('hex');
    try {
      // create_or_update (hub uses the same upsert semantics).
      const res = await mailchimpFetch(`/lists/${MAILCHIMP_AUDIENCE_ID}/members/${hash}`, {
        method: 'PUT',
        body: JSON.stringify({
          email_address: inf.email,
          status_if_new: 'subscribed',
          status: 'subscribed',
          merge_fields: {
            FNAME: inf.firstName,
            LNAME: inf.lastName,
            COMPANY: 'InZone',
            LINK: inf.referralLink,
          },
        }),
      });
      if (!res.ok) {
        const detail = ((await res.json().catch(() => ({}))) as { detail?: string }).detail;
        throw new Error(detail || `HTTP ${res.status}`);
      }
      // Tags need their own endpoint on updates.
      await mailchimpFetch(`/lists/${MAILCHIMP_AUDIENCE_ID}/members/${hash}/tags`, {
        method: 'POST',
        body: JSON.stringify({ tags: [{ name: tag, status: 'active' }] }),
      }).catch(() => {});
      synced += 1;
    } catch (e) {
      failed += 1;
      errors.push({ email: inf.email, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    status: 200,
    body: {
      success: failed === 0,
      total: influencers.length,
      synced,
      succeeded: synced,
      failed,
      errors: errors.slice(0, 10),
    },
  };
}

export async function POST(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (ctx instanceof NextResponse) return ctx;
  const { db } = ctx;
  const body = (await req.json().catch(() => ({}))) as { action?: string; email?: string; status?: string };

  if (body.action === 'review') {
    const status = body.status;
    if (!body.email || (status !== 'accepted' && status !== 'rejected')) return err('INVALID_REVIEW', 400);
    const result = await reviewApplication(db, body.email, status);
    if (!result.ok) return err(result.code, 404);
    return NextResponse.json({ message: `Application ${status} successfully` });
  }

  if (body.action === 'sync-mailchimp') {
    const { status, body: out } = await syncMailchimp(db);
    return NextResponse.json(out, { status });
  }

  return err('UNKNOWN_ACTION', 400);
}
