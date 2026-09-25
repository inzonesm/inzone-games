/**
 * Diagnostic-path coverage for lib/tiktok/reporting.ts.
 *
 * These are the invariants for the minimal-report diagnostic (PR #54):
 * upstream error text is sanitized before it can reach the admin UI,
 * TikTok's request_id is threaded through for log correlation, and the
 * outgoing request is the minimal id-only shape. Missing metrics stay
 * missing (empty string), never zero.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchTikTokReport,
  sanitizeTikTokErrorMessage,
  TIKTOK_METRICS,
  TikTokReportingError,
} from '../lib/tiktok/reporting.ts';

const ENV = {
  TIKTOK_ACCESS_TOKEN: 'test-token',
  TIKTOK_ADVERTISER_ID: '7660957559345004545',
};

function mockFetchOnce(handler) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = orig;
    },
  };
}

function jsonResponse(status, body, headers = {}) {
  return {
    status,
    headers: { get: (k) => headers[k] ?? null },
    json: async () => body,
  };
}

test('TIKTOK_METRICS is the round-D set (both quartile schemes under test)', () => {
  assert.deepEqual([...TIKTOK_METRICS], [
    'spend',
    'impressions',
    'clicks',
    'ctr',
    'cpc',
    'cpm',
    'reach',
    'conversion',
    'video_play_actions',
    'video_watched_2s',
    'video_watched_6s',
    'video_views_p25',
    'video_views_p50',
    'video_views_p75',
    'video_views_p100',
    'video_watched_25p',
    'video_watched_50p',
    'video_watched_75p',
    'video_watched_100p',
    'cost_per_conversion',
    'conversion_rate',
  ]);
});

test('sanitizer leaves a normal TikTok message intact', () => {
  const msg = 'Invalid parameter: metrics contains unsupported field "currency".';
  assert.equal(sanitizeTikTokErrorMessage(msg), msg);
});

test('sanitizer strips raw URLs', () => {
  const out = sanitizeTikTokErrorMessage(
    'See https://business-api.tiktok.com/portal/docs?id=1740302848100353 for details.',
  );
  assert.ok(!out.includes('https://'), 'raw URL must not survive');
  assert.ok(out.includes('[url]'));
});

test('sanitizer redacts long token-looking strings', () => {
  const tokenLike = 'a'.repeat(64);
  const out = sanitizeTikTokErrorMessage(`Auth failed with key ${tokenLike} rejected.`);
  assert.ok(!out.includes(tokenLike), 'token-looking string must not survive');
  assert.ok(out.includes('[redacted]'));
});

test('sanitizer caps message length', () => {
  const out = sanitizeTikTokErrorMessage('x'.repeat(2000));
  assert.ok(out.length <= 500);
});

test('API rejection threads TikTok request_id onto the error', async () => {
  const mock = mockFetchOnce(() =>
    jsonResponse(400, {
      code: 40002,
      message: 'Invalid parameter: metrics contains unsupported field.',
      request_id: 'req-abc-123',
    }),
  );
  try {
    await assert.rejects(
      () =>
        fetchTikTokReport(
          { level: 'AUCTION_CAMPAIGN', startDate: '2026-09-24', endDate: '2026-09-24' },
          ENV,
        ),
      (e) => {
        assert.ok(e instanceof TikTokReportingError);
        assert.equal(e.code, 'tiktok_40002');
        assert.equal(e.status, 400);
        assert.equal(e.requestId, 'req-abc-123');
        return true;
      },
    );
    assert.equal(mock.calls.length, 1);
  } finally {
    mock.restore();
  }
});

test('report sends id-only dimensions and the round-D metrics', async () => {
  const mock = mockFetchOnce(() =>
    jsonResponse(200, { code: 0, message: 'OK', data: { list: [] }, request_id: 'r1' }),
  );
  try {
    await fetchTikTokReport(
      { level: 'AUCTION_CAMPAIGN', startDate: '2026-09-24', endDate: '2026-09-24' },
      ENV,
    );
    const url = new URL(mock.calls[0].url);
    assert.equal(url.origin + url.pathname, 'https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/');
    assert.equal(url.searchParams.get('report_type'), 'BASIC');
    assert.equal(url.searchParams.get('data_level'), 'AUCTION_CAMPAIGN');
    assert.equal(url.searchParams.get('service_type'), 'AUCTION');
    assert.equal(url.searchParams.get('advertiser_id'), '7660957559345004545');
    assert.equal(url.searchParams.get('start_date'), '2026-09-24');
    assert.equal(url.searchParams.get('end_date'), '2026-09-24');
    assert.deepEqual(JSON.parse(url.searchParams.get('dimensions')), ['campaign_id']);
    assert.deepEqual(JSON.parse(url.searchParams.get('metrics')), [
      'spend',
      'impressions',
      'clicks',
      'ctr',
      'cpc',
      'cpm',
      'reach',
      'conversion',
      'video_play_actions',
      'video_watched_2s',
      'video_watched_6s',
      'video_views_p25',
      'video_views_p50',
      'video_views_p75',
      'video_views_p100',
      'video_watched_25p',
      'video_watched_50p',
      'video_watched_75p',
      'video_watched_100p',
      'cost_per_conversion',
      'conversion_rate',
    ]);
    // Token travels in the header, never in the query string.
    assert.ok(!mock.calls[0].url.includes('test-token'));
    assert.equal(mock.calls[0].init.headers['Access-Token'], 'test-token');
  } finally {
    mock.restore();
  }
});

test('missing metrics stay unavailable, never zero', async () => {
  const mock = mockFetchOnce(() =>
    jsonResponse(200, {
      code: 0,
      message: 'OK',
      data: {
        list: [
          {
            dimensions: { campaign_id: '123' },
            metrics: { spend: '12.50', impressions: '1000' }, // clicks absent
          },
        ],
      },
    }),
  );
  try {
    const report = await fetchTikTokReport(
      { level: 'AUCTION_CAMPAIGN', startDate: '2026-09-24', endDate: '2026-09-24' },
      ENV,
    );
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].id, '123');
    assert.equal(report.rows[0].name, undefined);
    assert.equal(report.rows[0].metrics.spend, '12.50');
    assert.ok(!('clicks' in report.rows[0].metrics), 'absent metric must stay absent, not "0"');
  } finally {
    mock.restore();
  }
});
