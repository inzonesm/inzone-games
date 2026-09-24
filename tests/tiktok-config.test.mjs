/**
 * Config coverage for lib/tiktok/config.ts.
 *
 * These are the invariants that keep TikTok credentials on the server and
 * out of chat by construction. If a change ever surfaces the access token
 * through a public helper or misreads an env var name, one of these tests
 * fails.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIKTOK_ACCESS_TOKEN_ENV,
  TIKTOK_ADVERTISER_ID_ENV,
  TIKTOK_APP_ID_ENV,
  TIKTOK_BUSINESS_API_BASE,
  TIKTOK_PIXEL_ID_ENV,
  redactAccessToken,
  tiktokPixelConfigured,
  tiktokPixelId,
  tiktokReportingConfig,
} from '../lib/tiktok/config.ts';

test('env var names are public identifiers stable across deploys', () => {
  assert.equal(TIKTOK_PIXEL_ID_ENV, 'NEXT_PUBLIC_TIKTOK_PIXEL_ID');
  assert.equal(TIKTOK_ACCESS_TOKEN_ENV, 'TIKTOK_ACCESS_TOKEN');
  assert.equal(TIKTOK_ADVERTISER_ID_ENV, 'TIKTOK_ADVERTISER_ID');
  assert.equal(TIKTOK_APP_ID_ENV, 'TIKTOK_APP_ID');
  // Access token env is NOT NEXT_PUBLIC_* so it stays server-only.
  assert.ok(!TIKTOK_ACCESS_TOKEN_ENV.startsWith('NEXT_PUBLIC_'));
  assert.ok(!TIKTOK_ADVERTISER_ID_ENV.startsWith('NEXT_PUBLIC_'));
});

test('TIKTOK_BUSINESS_API_BASE points at the current stable marketing API', () => {
  assert.equal(TIKTOK_BUSINESS_API_BASE, 'https://business-api.tiktok.com/open_api/v1.3');
});

test('tiktokPixelConfigured / tiktokPixelId honour the public env, ignoring whitespace', () => {
  assert.equal(tiktokPixelConfigured({}), false);
  assert.equal(tiktokPixelId({}), null);
  assert.equal(tiktokPixelConfigured({ NEXT_PUBLIC_TIKTOK_PIXEL_ID: '   ' }), false);
  assert.equal(tiktokPixelId({ NEXT_PUBLIC_TIKTOK_PIXEL_ID: '   ' }), null);
  assert.equal(tiktokPixelConfigured({ NEXT_PUBLIC_TIKTOK_PIXEL_ID: 'D0123456789ABCDE' }), true);
  assert.equal(tiktokPixelId({ NEXT_PUBLIC_TIKTOK_PIXEL_ID: '  D0123456789ABCDE  ' }), 'D0123456789ABCDE');
});

test('tiktokReportingConfig returns null unless BOTH server-only vars are present', () => {
  assert.equal(tiktokReportingConfig({}), null);
  assert.equal(
    tiktokReportingConfig({ TIKTOK_ACCESS_TOKEN: 'abc' }),
    null,
    'access token alone is not enough — advertiser id is also required',
  );
  assert.equal(
    tiktokReportingConfig({ TIKTOK_ADVERTISER_ID: '123' }),
    null,
    'advertiser id alone is not enough — token is also required',
  );
  const got = tiktokReportingConfig({
    TIKTOK_ACCESS_TOKEN: 'tok_abcdefghijk',
    TIKTOK_ADVERTISER_ID: '1234567890',
  });
  assert.deepEqual(got, {
    accessToken: 'tok_abcdefghijk',
    advertiserId: '1234567890',
  });
});

test('tiktokReportingConfig includes appId when present, omits it otherwise', () => {
  const withApp = tiktokReportingConfig({
    TIKTOK_ACCESS_TOKEN: 'tok_abcdefghijk',
    TIKTOK_ADVERTISER_ID: '1234567890',
    TIKTOK_APP_ID: 'app_xyz',
  });
  assert.equal(withApp?.appId, 'app_xyz');
  const withoutApp = tiktokReportingConfig({
    TIKTOK_ACCESS_TOKEN: 'tok_abcdefghijk',
    TIKTOK_ADVERTISER_ID: '1234567890',
  });
  assert.equal('appId' in (withoutApp ?? {}), false, 'appId is absent, not undefined');
});

test('redactAccessToken keeps fingerprint but never the full token', () => {
  const full = 'token_ABCDEFGHIJKLMNOP';
  const redacted = redactAccessToken(full);
  assert.notEqual(redacted, full);
  assert.ok(!redacted.includes('CDEFGHIJKLM'), 'middle of the token is not in the redaction');
  assert.ok(redacted.startsWith('toke'), 'first 4 chars are the fingerprint prefix');
  assert.ok(redacted.endsWith('MNOP'), 'last 4 chars are the fingerprint suffix');
  assert.equal(redactAccessToken(''), '(redacted)');
  assert.equal(redactAccessToken('short'), '(redacted)');
});
