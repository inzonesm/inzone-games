/**
 * TikTok OAuth — /start route.
 *
 * Firebase-Auth-gated: caller must send a valid ID token whose email is on
 * `ADMIN_EMAILS`. This replaces the earlier admin-key-in-URL gate — a URL
 * parameter leaks into server access logs, browser history and referrer
 * headers, none of which we can control.
 *
 * The route only accepts POST and returns JSON. The browser flow lives in
 * `app/admin/tiktok-oauth/page.tsx`, which fetches an ID token from Firebase
 * client SDK, POSTs here, receives `{ authorizeUrl }`, and navigates itself.
 * State is set as an HttpOnly Secure SameSite=Lax cookie in the same
 * response — the browser has it before it navigates to TikTok, and TikTok's
 * callback carries it back on the same origin.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { adminAuth, adminCredentialsConfigured } from '@/lib/firebase-admin';
import { isAdminEmail } from '@/lib/admin-shared';
import { TIKTOK_APP_ID_ENV } from '@/lib/tiktok/config';
import {
  TIKTOK_OAUTH_STATE_COOKIE,
  buildTikTokAuthorizeUrl,
  generateOAuthState,
  tiktokOAuthRedirectUri,
} from '@/lib/tiktok/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function err(code: string, status: number, detail?: string) {
  return NextResponse.json(detail ? { error: code, detail } : { error: code }, { status });
}

export async function POST(req: NextRequest) {
  if (!adminCredentialsConfigured()) {
    return err(
      'admin_not_configured',
      503,
      'FIREBASE_SERVICE_ACCOUNT must be set to verify admin identity for the OAuth flow.',
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

  const appId = (process.env[TIKTOK_APP_ID_ENV] ?? '').trim();
  if (!appId) {
    return err(
      'app_id_unset',
      503,
      `${TIKTOK_APP_ID_ENV} is not set on this deploy. Set it in Vercel with the TikTok Developer App id, then retry.`,
    );
  }

  const redirectUri = tiktokOAuthRedirectUri(process.env);
  const state = generateOAuthState();
  const authorizeUrl = buildTikTokAuthorizeUrl({ appId, redirectUri, state });
  const res = NextResponse.json({ authorizeUrl });
  res.cookies.set({
    name: TIKTOK_OAUTH_STATE_COOKIE,
    value: state,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/api/tiktok/oauth',
    maxAge: 60 * 10, // 10 minutes — the flow completes in seconds.
  });
  return res;
}
