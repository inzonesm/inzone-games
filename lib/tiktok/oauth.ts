/**
 * TikTok Marketing API OAuth — server-only.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Flow
 *
 *   1. /api/tiktok/oauth/start — admin-gated redirect to TikTok's authorize
 *      page. Mints a random `state` and sets it as an HttpOnly cookie.
 *   2. TikTok bounces back to /api/tiktok/oauth/callback with `auth_code` and
 *      the same `state` in the query string.
 *   3. Callback constant-time-compares the state, then POSTs
 *      { app_id, secret, auth_code } to TikTok's token endpoint.
 *   4. The response carries `access_token`, `advertiser_ids`, and `scope`.
 *      The callback renders those once in HTML for the admin to paste into
 *      Vercel — the token is NEVER logged, cached, or persisted server-side.
 *
 * The token exchange requires `TIKTOK_APP_SECRET` (server-only, Encrypted in
 * Vercel). The /start route is gated by `TIKTOK_OAUTH_ADMIN_KEY` so random
 * visitors can't kick off the flow.
 *
 * Read-only by design. The scopes we ask for cannot create campaigns, edit
 * budgets, upload creatives, or publish ads — see `MINIMUM_SCOPES` below.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { TIKTOK_BUSINESS_API_BASE, redactAccessToken } from './config.ts';

/** Server-only env var: TikTok Developer App client secret. Never NEXT_PUBLIC_*. */
export const TIKTOK_APP_SECRET_ENV = 'TIKTOK_APP_SECRET';
/** Server-only env var: opaque key gating the /start route. */
export const TIKTOK_OAUTH_ADMIN_KEY_ENV = 'TIKTOK_OAUTH_ADMIN_KEY';

/**
 * Path of the callback route. Registered verbatim as the Advertiser Redirect
 * URL in the TikTok Developer Portal, with the production host prefix.
 */
export const TIKTOK_OAUTH_CALLBACK_PATH = '/api/tiktok/oauth/callback';

/**
 * Production origin for the redirect URL. TikTok requires an exact match on
 * the Advertiser Redirect URL registered in the Developer Portal — a
 * mismatched host, path, or protocol fails the exchange. Overridable via
 * `NEXT_PUBLIC_APP_URL` for hand-testing on a stable preview host, but the
 * production URL is what Jayme registers with TikTok.
 */
export function tiktokOAuthRedirectUri(env: NodeJS.ProcessEnv = process.env): string {
  const base = (env.NEXT_PUBLIC_APP_URL ?? '').trim().replace(/\/+$/, '') || 'https://inzone.games';
  return `${base}${TIKTOK_OAUTH_CALLBACK_PATH}`;
}

/** Name of the cookie carrying the OAuth state for CSRF verification. */
export const TIKTOK_OAUTH_STATE_COOKIE = 'tiktok_oauth_state';

/**
 * Minimum permission set for the endpoints this codebase actually calls.
 * Adding a scope means adding a call site that needs it. Anything with
 * write / manage in its name is deliberately absent.
 */
export const MINIMUM_SCOPES = [
  // Read the ad account metadata (advertiser id, currency, timezone) that
  // `/report/integrated/get/` needs to hydrate the report response.
  'Ad Account Management (Read Only)',
  // The permission that unlocks `/report/integrated/get/` at CAMPAIGN /
  // ADGROUP / AD data levels for the metrics in TIKTOK_METRICS.
  'Reporting',
] as const;

/**
 * Scopes we deliberately do NOT request. Kept as a list so a reviewer can see
 * on inspection that write access is off by construction, not by accident.
 */
export const REFUSED_SCOPES = [
  'Ads Management (Write)',
  'Campaign Management (Write)',
  'Ad Group Management (Write)',
  'Ad Management (Write)',
  'Budget Management',
  'Bidding & Optimization',
  'Creative Management (Write)',
  'Audience Management (Write)',
  'Comment Management',
  'DPA Product Feed Management',
] as const;

/** Base URL of the TikTok Business Center OAuth authorize page. */
export const TIKTOK_AUTHORIZE_URL = 'https://business-api.tiktok.com/portal/auth';

/**
 * Build the authorize URL a browser is redirected to. The `state` value is
 * echoed back on the callback and compared constant-time to the cookie.
 */
export function buildTikTokAuthorizeUrl(input: {
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    app_id: input.appId,
    state: input.state,
    redirect_uri: input.redirectUri,
  });
  return `${TIKTOK_AUTHORIZE_URL}?${params.toString()}`;
}

/** 32 bytes of entropy hex-encoded (64 characters). */
export function generateOAuthState(): string {
  return randomBytes(32).toString('hex');
}

/** Constant-time comparison. Falls to false rather than throwing on a length mismatch. */
export function safeStateEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export type TikTokOAuthTokenResponse = {
  accessToken: string;
  advertiserIds: string[];
  scope: (string | number)[];
};

export class TikTokOAuthError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Exchange an `auth_code` from the callback query for an access token. The
 * response body carries the token, the list of advertiser ids the granting
 * user authorized, and the numeric scope ids TikTok issued.
 *
 * Never call this from a client component. Never persist the return value.
 */
export async function exchangeTikTokAuthCode(
  input: { appId: string; appSecret: string; authCode: string },
  fetchImpl: typeof fetch = fetch,
): Promise<TikTokOAuthTokenResponse> {
  let res: Response;
  try {
    res = await fetchImpl(`${TIKTOK_BUSINESS_API_BASE}/oauth2/access_token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: input.appId,
        secret: input.appSecret,
        auth_code: input.authCode,
      }),
    });
  } catch (err) {
    throw new TikTokOAuthError(
      'network_error',
      0,
      `TikTok OAuth token endpoint unreachable — check network egress. ${(err as Error).message}`,
    );
  }
  let body: { code?: number; message?: string; data?: unknown; request_id?: string };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new TikTokOAuthError(
      'invalid_response',
      res.status,
      `TikTok OAuth token endpoint returned non-JSON (HTTP ${res.status}).`,
    );
  }
  if (res.status >= 400 || (typeof body.code === 'number' && body.code !== 0)) {
    throw new TikTokOAuthError(
      `tiktok_${body.code ?? 'http_' + res.status}`,
      res.status,
      body.message || 'TikTok OAuth token exchange failed',
    );
  }
  const data = (body.data as Record<string, unknown>) ?? {};
  const accessToken = typeof data.access_token === 'string' ? data.access_token : '';
  if (!accessToken) {
    throw new TikTokOAuthError('missing_access_token', res.status, 'TikTok OAuth response lacked access_token');
  }
  const advertiserIdsRaw = Array.isArray(data.advertiser_ids) ? (data.advertiser_ids as unknown[]) : [];
  const advertiserIds = advertiserIdsRaw.map((v) => String(v)).filter(Boolean);
  const scope = Array.isArray(data.scope) ? (data.scope as (string | number)[]) : [];
  return { accessToken, advertiserIds, scope };
}

/**
 * Redact-friendly summary safe to log. Never contains the token.
 */
export function summarizeTokenResponse(res: TikTokOAuthTokenResponse): {
  tokenFingerprint: string;
  advertiserCount: number;
  scopeCount: number;
} {
  return {
    tokenFingerprint: redactAccessToken(res.accessToken),
    advertiserCount: res.advertiserIds.length,
    scopeCount: res.scope.length,
  };
}
