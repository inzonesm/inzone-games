/**
 * TikTok Marketing API OAuth — server-only.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Flow
 *
 *   1. /admin/tiktok-oauth — Firebase-Auth-gated admin page.
 *   2. Client fetches a Firebase ID token and POSTs to
 *      /api/tiktok/oauth/start with `Authorization: Bearer <token>`. The
 *      server verifies the token against `ADMIN_EMAILS`, mints `state`,
 *      sets it as an HttpOnly Secure SameSite=Lax cookie scoped to
 *      /api/tiktok/oauth, and returns `{ authorizeUrl }` as JSON.
 *   3. Client navigates the same window to `authorizeUrl`.
 *   4. TikTok bounces back to /api/tiktok/oauth/callback with `auth_code`
 *      and the same `state` in the query string.
 *   5. Callback constant-time-compares the state, then POSTs
 *      { app_id, secret, auth_code } to TikTok's token endpoint.
 *   6. The response carries `access_token`, `advertiser_ids`, and `scope`.
 *      The callback renders those once in HTML for the admin browser
 *      session to paste into Vercel — no admin credential ever appears in
 *      a URL, and no token bytes are ever written to a log line.
 *
 * The token exchange requires `TIKTOK_APP_SECRET` (server-only, Encrypted in
 * Vercel). Admin identity is Firebase Auth ID token + `ADMIN_EMAILS`;
 * there is no admin key in a URL.
 *
 * Read-only by design. The scopes we ask for cannot create campaigns, edit
 * budgets, upload creatives, or publish ads — see `MINIMUM_SCOPE_CAPABILITIES`
 * below.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { TIKTOK_BUSINESS_API_BASE } from './config.ts';

/** Server-only env var: TikTok Developer App client secret. Never NEXT_PUBLIC_*. */
export const TIKTOK_APP_SECRET_ENV = 'TIKTOK_APP_SECRET';

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
 * Minimum capabilities we need from TikTok. Described by what the endpoint
 * does, not by TikTok's UI label — TikTok has renamed its scope groups more
 * than once and a hardcoded label rots. When Jayme picks scopes, he matches
 * these capabilities to whatever labels his current portal shows, then
 * cross-checks the callback page against `TikTokOAuthTokenResponse.scope`
 * (which returns TikTok's own current identifiers) before pasting the token
 * into Vercel.
 *
 * Two capabilities cover every call in `lib/tiktok/reporting.ts`. Adding one
 * means adding a new endpoint the codebase reads.
 */
export const MINIMUM_SCOPE_CAPABILITIES = [
  {
    // Unlocks `/report/integrated/get/` at CAMPAIGN / ADGROUP / AD data
    // levels for the metrics in TIKTOK_METRICS. TikTok's portal has
    // historically labelled this group "Reporting". If the label has
    // changed, pick the group that names "reporting" or the `report/*` API.
    capability: 'Reporting',
    endpoints: ['/report/integrated/get/'],
    read_only: true,
  },
  {
    // Read the ad account metadata that the report response hydrates
    // (currency, timezone, advertiser info). TikTok's portal has labelled
    // this "Ad Account Management" with a Read-only variant; more recent
    // portal versions may fold this into Reporting or split it further. If
    // no separate ad-account read group is visible, request Reporting only
    // and rely on the callback page's scope readout: if the report call
    // works, this capability is covered.
    capability: 'Ad account metadata (read)',
    endpoints: ['/report/integrated/get/ (response metadata)'],
    read_only: true,
  },
] as const;

/**
 * Capabilities we deliberately do NOT request. Kept as a list so a reviewer
 * can see on inspection that write access is off by construction. Labels
 * here are functional; TikTok's UI labels vary.
 */
export const REFUSED_CAPABILITIES = [
  'Any ads/campaign/adgroup/ad management (write, edit, create, delete)',
  'Budget management',
  'Bidding & optimization',
  'Creative upload or edit',
  'Audience management (write)',
  'Comment management',
  'DPA / product feed management',
  'Account management (write)',
  'Anything TikTok groups as "All Access" / "Full Management"',
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
 * Non-sensitive summary safe to log. Never contains any part of the token —
 * not the full string, not a prefix, not a length, not a fingerprint. Even
 * a 4-character prefix is entropy an attacker can combine with side-channel
 * data. `redactAccessToken` remains available for error-surface rendering
 * (e.g. an error banner in an admin UI) but must not appear in server logs.
 */
export function summarizeTokenResponse(res: TikTokOAuthTokenResponse): {
  advertiserCount: number;
  scopeCount: number;
} {
  return {
    advertiserCount: res.advertiserIds.length,
    scopeCount: res.scope.length,
  };
}

