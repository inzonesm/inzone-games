/**
 * TikTok OAuth — /start route.
 *
 * Admin-gated redirect to TikTok's authorize page. Gate is a compare against
 * `TIKTOK_OAUTH_ADMIN_KEY` in the query string. Not a full auth system — this
 * is a one-shot flow to obtain the reporting access token; once Jayme has
 * pasted the token into Vercel, `TIKTOK_APP_SECRET` and
 * `TIKTOK_OAUTH_ADMIN_KEY` can be removed and this route becomes inert.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { TIKTOK_APP_ID_ENV } from '@/lib/tiktok/config';
import {
  TIKTOK_OAUTH_ADMIN_KEY_ENV,
  TIKTOK_OAUTH_STATE_COOKIE,
  buildTikTokAuthorizeUrl,
  generateOAuthState,
  tiktokOAuthRedirectUri,
} from '@/lib/tiktok/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function constantTimeMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const provided = (url.searchParams.get('admin_key') ?? '').trim();
  const expected = (process.env[TIKTOK_OAUTH_ADMIN_KEY_ENV] ?? '').trim();
  if (!expected) {
    return NextResponse.json(
      {
        error: 'oauth_admin_key_unset',
        detail: `${TIKTOK_OAUTH_ADMIN_KEY_ENV} is not set on this deploy. Set it in Vercel to enable the OAuth flow, then retry.`,
      },
      { status: 503 },
    );
  }
  if (!provided || !constantTimeMatch(provided, expected)) {
    // No detail on the mismatch — logs don't hint at the correct value.
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const appId = (process.env[TIKTOK_APP_ID_ENV] ?? '').trim();
  if (!appId) {
    return NextResponse.json(
      {
        error: 'app_id_unset',
        detail: `${TIKTOK_APP_ID_ENV} is not set on this deploy. Set it in Vercel with the TikTok Developer App id, then retry.`,
      },
      { status: 503 },
    );
  }
  const redirectUri = tiktokOAuthRedirectUri(process.env);
  const state = generateOAuthState();
  const authorizeUrl = buildTikTokAuthorizeUrl({ appId, redirectUri, state });
  const res = NextResponse.redirect(authorizeUrl, { status: 302 });
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
