/**
 * Coverage for lib/tiktok/oauth.ts.
 *
 * These pin the OAuth invariants that keep the flow safe:
 *   - Redirect URL matches exactly what Jayme registers with TikTok.
 *   - State is 64-hex, high-entropy, compared constant-time.
 *   - Authorize URL carries only public identifiers, never the secret.
 *   - Token exchange never logs the raw token.
 *   - Minimum scope list stays read-only; refused scope list stays write-only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MINIMUM_SCOPES,
  REFUSED_SCOPES,
  TIKTOK_APP_SECRET_ENV,
  TIKTOK_AUTHORIZE_URL,
  TIKTOK_OAUTH_ADMIN_KEY_ENV,
  TIKTOK_OAUTH_CALLBACK_PATH,
  TIKTOK_OAUTH_STATE_COOKIE,
  buildTikTokAuthorizeUrl,
  exchangeTikTokAuthCode,
  generateOAuthState,
  safeStateEqual,
  summarizeTokenResponse,
  tiktokOAuthRedirectUri,
} from '../lib/tiktok/oauth.ts';

test('env var names are server-only public identifiers', () => {
  assert.equal(TIKTOK_APP_SECRET_ENV, 'TIKTOK_APP_SECRET');
  assert.equal(TIKTOK_OAUTH_ADMIN_KEY_ENV, 'TIKTOK_OAUTH_ADMIN_KEY');
  assert.ok(!TIKTOK_APP_SECRET_ENV.startsWith('NEXT_PUBLIC_'));
  assert.ok(!TIKTOK_OAUTH_ADMIN_KEY_ENV.startsWith('NEXT_PUBLIC_'));
});

test('callback path is stable — this is what Jayme registers with TikTok', () => {
  assert.equal(TIKTOK_OAUTH_CALLBACK_PATH, '/api/tiktok/oauth/callback');
});

test('redirect URI defaults to production, honours NEXT_PUBLIC_APP_URL override, and never has a trailing slash before the path', () => {
  assert.equal(tiktokOAuthRedirectUri({}), 'https://inzone.games/api/tiktok/oauth/callback');
  assert.equal(
    tiktokOAuthRedirectUri({ NEXT_PUBLIC_APP_URL: 'https://staging.inzone.games' }),
    'https://staging.inzone.games/api/tiktok/oauth/callback',
  );
  assert.equal(
    tiktokOAuthRedirectUri({ NEXT_PUBLIC_APP_URL: 'https://staging.inzone.games/' }),
    'https://staging.inzone.games/api/tiktok/oauth/callback',
    'trailing slash on the base URL must not create a double slash before the callback path',
  );
  assert.equal(
    tiktokOAuthRedirectUri({ NEXT_PUBLIC_APP_URL: '   ' }),
    'https://inzone.games/api/tiktok/oauth/callback',
    'whitespace-only override falls back to production',
  );
});

test('authorize URL is TikTok Business Center portal — never a random third-party host', () => {
  assert.equal(TIKTOK_AUTHORIZE_URL, 'https://business-api.tiktok.com/portal/auth');
});

test('buildTikTokAuthorizeUrl carries only public identifiers, not the app secret', () => {
  const url = buildTikTokAuthorizeUrl({
    appId: '12345',
    redirectUri: 'https://inzone.games/api/tiktok/oauth/callback',
    state: 'ff'.repeat(32),
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, TIKTOK_AUTHORIZE_URL);
  assert.equal(parsed.searchParams.get('app_id'), '12345');
  assert.equal(parsed.searchParams.get('redirect_uri'), 'https://inzone.games/api/tiktok/oauth/callback');
  assert.equal(parsed.searchParams.get('state'), 'ff'.repeat(32));
  // Belt-and-braces: the URL must not carry anything that looks like a secret
  // or an auth_code — those are exchanged server-side only.
  assert.equal(parsed.searchParams.get('secret'), null);
  assert.equal(parsed.searchParams.get('app_secret'), null);
  assert.equal(parsed.searchParams.get('auth_code'), null);
});

test('generateOAuthState produces 64 hex characters (32 bytes of entropy) and never repeats', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const s = generateOAuthState();
    assert.equal(s.length, 64);
    assert.match(s, /^[0-9a-f]{64}$/);
    assert.ok(!seen.has(s), 'state values must be unique across calls');
    seen.add(s);
  }
});

test('safeStateEqual is constant-time equality with length and falsy guards', () => {
  const good = 'ab'.repeat(32);
  assert.equal(safeStateEqual(good, good), true);
  assert.equal(safeStateEqual(good, good.slice(0, -1) + 'f'), false);
  // Length mismatch never throws — just returns false.
  assert.equal(safeStateEqual(good, 'short'), false);
  assert.equal(safeStateEqual('', good), false);
  assert.equal(safeStateEqual(good, ''), false);
  assert.equal(safeStateEqual(null, good), false);
  assert.equal(safeStateEqual(good, null), false);
  assert.equal(safeStateEqual(undefined, undefined), false);
});

test('state cookie name is stable — the callback compares against this exact name', () => {
  assert.equal(TIKTOK_OAUTH_STATE_COOKIE, 'tiktok_oauth_state');
});

test('minimum scope list is read-only', () => {
  for (const scope of MINIMUM_SCOPES) {
    assert.ok(
      !/\bWrite\b|\bManage(?!ment \(Read Only\))|Budget|Bidding/i.test(scope) ||
        /\(Read Only\)/.test(scope),
      `scope "${scope}" must be read-only or explicitly Read Only`,
    );
  }
});

test('refused scope list only contains write / management surfaces', () => {
  for (const scope of REFUSED_SCOPES) {
    assert.ok(
      /Write|Budget|Bidding|Management(?!\s*\(Read Only\))/.test(scope),
      `refused scope "${scope}" should be a write / management surface`,
    );
  }
});

test('minimum and refused scope lists never overlap', () => {
  const min = new Set(MINIMUM_SCOPES);
  for (const refused of REFUSED_SCOPES) {
    assert.ok(!min.has(refused), `refused scope "${refused}" cannot also be in MINIMUM_SCOPES`);
  }
});

test('exchangeTikTokAuthCode POSTs to the token endpoint with the secret in the body, not the URL', async () => {
  let seen = null;
  const fakeFetch = async (url, init) => {
    seen = { url, init };
    return new Response(
      JSON.stringify({
        code: 0,
        message: 'OK',
        data: { access_token: 'tok_ABCDEFGHIJKLMNOP', advertiser_ids: [123, 456], scope: [1, 4] },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  const res = await exchangeTikTokAuthCode(
    { appId: 'app_id_public', appSecret: 'shh_secret', authCode: 'code_xyz' },
    fakeFetch,
  );
  assert.ok(seen, 'fake fetch was called');
  assert.equal(seen.init.method, 'POST');
  assert.equal(new URL(seen.url).pathname, '/open_api/v1.3/oauth2/access_token/');
  // The secret is in the body, never in the URL.
  assert.ok(!seen.url.includes('shh_secret'), 'secret must not appear in the URL');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.app_id, 'app_id_public');
  assert.equal(body.secret, 'shh_secret');
  assert.equal(body.auth_code, 'code_xyz');
  // Response is normalized: advertiser ids are strings, scope preserved.
  assert.equal(res.accessToken, 'tok_ABCDEFGHIJKLMNOP');
  assert.deepEqual(res.advertiserIds, ['123', '456']);
  assert.deepEqual(res.scope, [1, 4]);
});

test('exchangeTikTokAuthCode rejects a non-zero TikTok error code without exposing the secret', async () => {
  const fakeFetch = async () =>
    new Response(JSON.stringify({ code: 40001, message: 'Invalid auth_code', data: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  await assert.rejects(
    exchangeTikTokAuthCode(
      { appId: 'a', appSecret: 'shh_secret', authCode: 'bad' },
      fakeFetch,
    ),
    (err) => {
      assert.equal(err.name, 'Error');
      assert.equal(err.code, 'tiktok_40001');
      assert.ok(!err.message.includes('shh_secret'), 'error message must not echo the secret');
      return true;
    },
  );
});

test('exchangeTikTokAuthCode rejects a response missing access_token', async () => {
  const fakeFetch = async () =>
    new Response(JSON.stringify({ code: 0, message: 'OK', data: { advertiser_ids: [] } }), {
      status: 200,
    });
  await assert.rejects(
    exchangeTikTokAuthCode({ appId: 'a', appSecret: 's', authCode: 'c' }, fakeFetch),
    (err) => err.code === 'missing_access_token',
  );
});

test('summarizeTokenResponse keeps a fingerprint, never the raw token', () => {
  const summary = summarizeTokenResponse({
    accessToken: 'tok_ABCDEFGHIJKLMNOP',
    advertiserIds: ['1', '2'],
    scope: [1, 4, 7],
  });
  assert.ok(!summary.tokenFingerprint.includes('ABCDEFGHIJKLM'), 'middle of token must not appear');
  assert.equal(summary.advertiserCount, 2);
  assert.equal(summary.scopeCount, 3);
  // Log-safe: the whole summary can be JSON.stringified without leaking secrets.
  const line = JSON.stringify(summary);
  assert.ok(!line.includes('ABCDEFGHIJKLM'));
});
