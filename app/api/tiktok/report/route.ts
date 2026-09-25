/**
 * TikTok reporting — read-only report runner.
 *
 * Firebase-Auth-gated like `/oauth/start`: the caller sends a valid ID token
 * whose email is on `ADMIN_EMAILS`. GET with optional query params:
 *
 *   start_date, end_date — `YYYY-MM-DD` in the advertiser account's timezone.
 *                          Defaults to yesterday .. yesterday.
 *   level                — `campaign` | `adgroup` | `ad`. Defaults to `campaign`.
 *
 * Server-side only. The access token never leaves the server and never
 * appears in the response; the JSON carries aggregate report rows, the
 * advertiser timezone TikTok actually used, currency, and the attribution
 * window — the four facts needed to compare against Ads Manager.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { adminAuth, adminCredentialsConfigured } from '@/lib/firebase-admin';
import { isAdminEmail } from '@/lib/admin-shared';
import {
  fetchTikTokReport,
  TikTokReportingError,
  type TikTokDataLevel,
} from '@/lib/tiktok/reporting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LEVELS: Record<string, TikTokDataLevel> = {
  campaign: 'AUCTION_CAMPAIGN',
  adgroup: 'AUCTION_ADGROUP',
  ad: 'AUCTION_AD',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function err(code: string, status: number, detail?: string) {
  return NextResponse.json(detail ? { error: code, detail } : { error: code }, { status });
}

/** Yesterday as `YYYY-MM-DD`. TikTok interprets the range in the advertiser's
 *  timezone and returns the effective timezone in the response header. */
function defaultRange(): { startDate: string; endDate: string } {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  const s = d.toISOString().slice(0, 10);
  return { startDate: s, endDate: s };
}

export async function GET(req: NextRequest) {
  if (!adminCredentialsConfigured()) {
    return err(
      'admin_not_configured',
      503,
      'FIREBASE_SERVICE_ACCOUNT must be set to verify admin identity.',
    );
  }
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return err('unauthenticated', 401);
  let email: string | null = null;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    email = decoded.email ?? null;
  } catch {
    return err('unauthenticated', 401);
  }
  if (!isAdminEmail(email)) return err('forbidden', 403);

  const sp = req.nextUrl.searchParams;
  const range = defaultRange();
  const startDate = sp.get('start_date') ?? range.startDate;
  const endDate = sp.get('end_date') ?? range.endDate;
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    return err('bad_date', 400, 'start_date and end_date must be YYYY-MM-DD.');
  }
  const level = LEVELS[sp.get('level') ?? 'campaign'] ?? LEVELS.campaign;

  try {
    const report = await fetchTikTokReport({ startDate, endDate, level }, process.env);
    return NextResponse.json(report);
  } catch (e) {
    if (e instanceof TikTokReportingError) {
      // The error class never carries token bytes; surface the code only.
      return err('report_failed', 502, `TikTok report failed (${e.code}).`);
    }
    return err('report_failed', 502, 'TikTok report failed (unknown).');
  }
}
