/**
 * TikTok Ads integration config, mirroring the Meta pixel + reporting split
 * (public pixel id vs server-only reporting credentials).
 *
 * Two surfaces:
 *
 *   - Public pixel id (`NEXT_PUBLIC_TIKTOK_PIXEL_ID`) — ships in the base
 *     script to every browser like Meta's does, so it is not a secret. Empty
 *     means "no TikTok pixel on this deploy" and the client component
 *     no-ops silently.
 *
 *   - Server-only reporting credentials (`TIKTOK_ACCESS_TOKEN`,
 *     `TIKTOK_ADVERTISER_ID`) — read only from server-side code paths
 *     (`lib/tiktok/reporting.ts`, API routes). Never NEXT_PUBLIC_*, never
 *     imported by a `'use client'` module. `TIKTOK_APP_ID` is a public
 *     identifier of the Business Center developer app; kept server-only
 *     here for hygiene since nothing in the browser needs it.
 *
 * NEVER hand-type any of these into chat. Set them via the workspace's
 * secret manager (Vercel → Project → Settings → Environment Variables
 * with `Encrypted` for the access token, `Plain Text` for the two ids).
 *
 * The setup steps for Jayme live in `docs/TIKTOK_INTEGRATION.md`.
 */

export const TIKTOK_PIXEL_ID_ENV = 'NEXT_PUBLIC_TIKTOK_PIXEL_ID';
export const TIKTOK_ACCESS_TOKEN_ENV = 'TIKTOK_ACCESS_TOKEN';
export const TIKTOK_ADVERTISER_ID_ENV = 'TIKTOK_ADVERTISER_ID';
export const TIKTOK_APP_ID_ENV = 'TIKTOK_APP_ID';

/**
 * TikTok Business API base URL. The `v1.3` version is the current stable
 * marketing API surface. Change here rather than at every call site.
 */
export const TIKTOK_BUSINESS_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

export type TikTokReportingConfig = {
  accessToken: string;
  advertiserId: string;
  appId?: string;
};

/** True when the public pixel is configured for the current build. */
export function tiktokPixelConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean((env[TIKTOK_PIXEL_ID_ENV] ?? '').trim());
}

/** Public pixel id, or null when unconfigured. Safe to log. */
export function tiktokPixelId(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env[TIKTOK_PIXEL_ID_ENV] ?? '').trim();
  return raw ? raw : null;
}

/**
 * Read server-only reporting credentials. Returns null when incomplete —
 * caller must fail fast rather than silently produce empty reports.
 */
export function tiktokReportingConfig(
  env: NodeJS.ProcessEnv = process.env,
): TikTokReportingConfig | null {
  const accessToken = (env[TIKTOK_ACCESS_TOKEN_ENV] ?? '').trim();
  const advertiserId = (env[TIKTOK_ADVERTISER_ID_ENV] ?? '').trim();
  if (!accessToken || !advertiserId) return null;
  const appId = (env[TIKTOK_APP_ID_ENV] ?? '').trim();
  return {
    accessToken,
    advertiserId,
    ...(appId ? { appId } : {}),
  };
}

/**
 * Redact the access token for log lines / error surfaces. Keeps a small
 * fingerprint (first 4 + last 4) so ops can distinguish "wrong token"
 * from "no token" without ever writing the full string.
 */
export function redactAccessToken(token: string): string {
  if (!token || token.length < 12) return '(redacted)';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
