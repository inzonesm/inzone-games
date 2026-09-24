/**
 * TikTok OAuth — /callback route.
 *
 * TikTok redirects the browser here with `auth_code` and `state` in the
 * query. We constant-time-verify the state against the HttpOnly cookie set
 * by /start, then exchange the auth_code for an access token server-side
 * with `TIKTOK_APP_SECRET`.
 *
 * The token exchange happens server-side. The token is then rendered ONCE
 * as HTML in the response body for the Firebase-authenticated admin to
 * paste into Vercel. This is a protected one-time transfer, not
 * server-only storage: the token traverses server → HTTPS response → the
 * admin's browser DOM → their clipboard → Vercel's env store. It never
 * touches any log, cookie, server-side store this code owns, or third-party
 * service. It is not held by this process after the response ships.
 *
 * Any failure (bad state, bad code, TikTok rejection) returns an error page
 * without echoing sensitive fields. Server log lines mention only the
 * outcome and non-sensitive counts (advertiser count, scope count).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { TIKTOK_APP_ID_ENV } from '@/lib/tiktok/config';
import {
  TIKTOK_APP_SECRET_ENV,
  TIKTOK_OAUTH_STATE_COOKIE,
  exchangeTikTokAuthCode,
  safeStateEqual,
  TikTokOAuthError,
} from '@/lib/tiktok/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (c) =>
    c === '&'
      ? '&amp;'
      : c === '<'
        ? '&lt;'
        : c === '>'
          ? '&gt;'
          : c === '"'
            ? '&quot;'
            : '&#39;',
  );
}

function errorPage(title: string, detail: string, status = 400): NextResponse {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>TikTok OAuth error</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body { font-family: system-ui, sans-serif; max-width: 640px; margin: 3rem auto; padding: 0 1rem; color: #eee; background: #0a0d12; }
h1 { color: #ff8080; font-size: 1.4rem; }
p, li { line-height: 1.55; }
code { background: #1a1f28; padding: 2px 6px; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 0.9em; }
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(detail)}</p>
<p>Check <code>docs/TIKTOK_INTEGRATION.md</code> or retry the flow from <code>/api/tiktok/oauth/start?admin_key=...</code>.</p>
</body></html>`;
  return new NextResponse(body, { status, headers: NO_STORE_HEADERS });
}

function successPage(input: {
  token: string;
  advertiserIds: string[];
  scope: (string | number)[];
}): NextResponse {
  const advertiserRows = input.advertiserIds
    .map((id) => `<li><code>${escapeHtml(id)}</code></li>`)
    .join('');
  const scopeRows = input.scope
    .map((s) => `<li><code>${escapeHtml(String(s))}</code></li>`)
    .join('');
  const token = escapeHtml(input.token);
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>TikTok OAuth — copy token to Vercel</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body { font-family: system-ui, sans-serif; max-width: 780px; margin: 2rem auto; padding: 0 1rem; color: #eee; background: #0a0d12; }
h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
h2 { font-size: 1.05rem; margin-top: 2rem; color: #9fd5ff; }
p, li { line-height: 1.55; }
code { background: #1a1f28; padding: 2px 6px; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 0.9em; word-break: break-all; }
.token-box { background: #10141b; border: 1px solid #2a2f38; border-radius: 8px; padding: 1rem; font-family: ui-monospace, monospace; font-size: 0.9em; word-break: break-all; user-select: all; }
button { background: #2b64ff; color: white; border: 0; padding: 0.55rem 1rem; border-radius: 6px; font: inherit; cursor: pointer; margin-top: 0.75rem; }
button:hover { background: #4a7dff; }
.warn { color: #ffcc66; }
.ok { color: #80e080; }
</style></head><body>
<h1 class="ok">TikTok reporting authorized</h1>
<p class="warn">This page shows the access token <strong>once</strong>, in your admin browser session only. The response is <code>no-store</code>, <code>no-cache</code>, <code>Referrer-Policy: no-referrer</code>, and <code>X-Robots-Tag: noindex, nofollow</code>. The server holds nothing after this response ships. Copy the token into Vercel now — refreshing or navigating away loses it and you'll need to redo the flow.</p>

<h2>1. Access token → <code>TIKTOK_ACCESS_TOKEN</code> in Vercel (Encrypted, Production)</h2>
<div class="token-box" id="token">${token}</div>
<button type="button" id="copy-token">Copy token</button>

<h2>2. Advertiser id → <code>TIKTOK_ADVERTISER_ID</code> in Vercel (Plain Text, Production)</h2>
<p>Pick the advertiser you're running InZone ads under:</p>
<ul>${advertiserRows || '<li><em>None returned — check that the app was granted access to your advertiser.</em></li>'}</ul>

<h2>3. Granted scopes (from TikTok)</h2>
<ul>${scopeRows || '<li><em>None reported.</em></li>'}</ul>
<p>If this list contains any <code>Management (Write)</code> or <code>Budget</code> scope, revoke and redo — this integration is read-only.</p>

<h2>4. After pasting into Vercel</h2>
<ul>
<li>Remove <code>TIKTOK_APP_SECRET</code> and <code>TIKTOK_OAUTH_ADMIN_KEY</code> from Vercel — they're only needed to obtain the token.</li>
<li>Trigger a production redeploy so the new env vars land in the runtime.</li>
<li>Verify: <code>tiktokReportingConfig(process.env)</code> returns non-null in a production server-side call.</li>
</ul>

<script>
document.getElementById('copy-token').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(document.getElementById('token').textContent.trim());
    const b = document.getElementById('copy-token');
    b.textContent = 'Copied — paste into Vercel now';
    b.disabled = true;
  } catch (e) {
    alert('Clipboard blocked — select the token manually and copy.');
  }
});
</script>
</body></html>`;
  return new NextResponse(body, { status: 200, headers: NO_STORE_HEADERS });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const authCode = (url.searchParams.get('auth_code') ?? url.searchParams.get('code') ?? '').trim();
  const providedState = (url.searchParams.get('state') ?? '').trim();
  const cookieState = req.cookies.get(TIKTOK_OAUTH_STATE_COOKIE)?.value ?? '';

  if (!authCode) {
    return errorPage('Missing auth_code', 'TikTok redirected without an auth_code query parameter. Retry the flow.');
  }
  if (!safeStateEqual(providedState, cookieState)) {
    return errorPage(
      'State mismatch',
      'The state parameter did not match the cookie. This can happen if the flow was interrupted or the callback URL was visited without kicking off from /api/tiktok/oauth/start. Retry the flow.',
    );
  }
  const appId = (process.env[TIKTOK_APP_ID_ENV] ?? '').trim();
  const appSecret = (process.env[TIKTOK_APP_SECRET_ENV] ?? '').trim();
  if (!appId || !appSecret) {
    return errorPage(
      'App credentials unset',
      `${TIKTOK_APP_ID_ENV} and ${TIKTOK_APP_SECRET_ENV} must be set to exchange the auth_code. Set them in Vercel and retry.`,
      503,
    );
  }

  let tokenRes;
  try {
    tokenRes = await exchangeTikTokAuthCode({ appId, appSecret, authCode });
  } catch (err) {
    const code = err instanceof TikTokOAuthError ? err.code : 'unknown';
    // Redacted server log — no token, no auth_code echoed back.
    console.warn(`[tiktok-oauth] exchange failed code=${code}`);
    return errorPage(
      'Token exchange failed',
      `TikTok rejected the auth_code (${code}). Retry the flow; the auth_code may have expired.`,
    );
  }

  // Log only non-sensitive counts. No token bytes reach a log line here or
  // anywhere else in this route — not the full token, not a prefix, not a
  // fingerprint, not a length. Even a 4-char prefix is entropy an attacker
  // can combine with side-channel data.
  console.log(
    `[tiktok-oauth] success advertisers=${tokenRes.advertiserIds.length} scopes=${tokenRes.scope.length}`,
  );

  const res = successPage({
    token: tokenRes.accessToken,
    advertiserIds: tokenRes.advertiserIds,
    scope: tokenRes.scope,
  });
  // Best-effort: clear the state cookie so the same page can't be replayed.
  res.cookies.set({
    name: TIKTOK_OAUTH_STATE_COOKIE,
    value: '',
    path: '/api/tiktok/oauth',
    maxAge: 0,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  });
  return res;
}
