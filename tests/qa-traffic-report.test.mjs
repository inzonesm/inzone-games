/**
 * Report filtering, against the five cases the daily report must separate:
 * production, Preview, explicitly marked QA, a documented historical id, and
 * an unknown host.
 *
 * The report filters in SQL inside ClickHouse, so it cannot call the shared
 * classifier. These tests therefore check BOTH: the pure decision, and that
 * the generated SQL still carries the clause each decision depends on — so the
 * two cannot drift apart without a test failing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyReportRow, hostnameOf } from '../lib/qa-traffic.ts';
import {
  PRODUCTION_HOSTS,
  campaignWhere,
  diagnosticsWhere,
  environmentBucketSql,
  markedTrafficSql,
  productionHostSql,
} from '../scripts/daily-product-report.mjs';

const HISTORICAL = ['82798aa3-538f-490e-b6c0-f9115c0427f4', 'fea1b5f4-8d1d-4c41-94ab-eda35f12af0d'];

const FIXTURES = [
  {
    label: 'production, ordinary visitor',
    row: { url: 'https://www.inzone.games/games/flappybird-inzone-2?utm_source=meta&utm_campaign=solo_social_01', user_id: 'real-1' },
    bucket: 'customer', appEnv: 'production',
  },
  {
    label: 'production apex hostname',
    row: { url: 'https://inzone.games/games/x', user_id: 'real-2' },
    bucket: 'customer', appEnv: 'production',
  },
  {
    label: 'Preview deployment',
    row: { url: 'https://inzone-games-git-claude-busy-cerf-19mfrm-in-zone-s-projects.vercel.app/games/x', user_id: 'p-1' },
    bucket: 'diagnostic', appEnv: 'preview',
  },
  {
    label: 'explicitly marked QA on production',
    row: { url: 'https://www.inzone.games/games/x?inzone_qa=agent', traffic_kind: 'agent', user_id: 'q-1' },
    bucket: 'diagnostic', appEnv: 'production',
  },
  {
    label: 'documented historical QA id, unmarked',
    row: { url: 'https://www.inzone.games/games/x', user_id: HISTORICAL[0] },
    bucket: 'diagnostic', appEnv: 'production',
  },
  {
    label: 'unknown host',
    row: { url: 'https://staging.example.com/games/x', user_id: 'u-1' },
    bucket: 'diagnostic', appEnv: 'unknown',
  },
  {
    label: 'missing url is unknown, never production',
    row: { url: null, user_id: 'u-2' },
    bucket: 'diagnostic', appEnv: 'unknown',
  },
  {
    label: 'lookalike host is not production',
    row: { url: 'https://inzone.games.evil.example/games/x', user_id: 'u-3' },
    bucket: 'diagnostic', appEnv: 'unknown',
  },
  {
    label: 'legacy utm_medium=qa convention, historical rows',
    row: { url: 'https://www.inzone.games/games/x', utm_medium: 'qa', user_id: 'l-1' },
    bucket: 'diagnostic', appEnv: 'production',
  },
  {
    label: 'legacy utm_content=exclude_from_acquisition convention',
    row: { url: 'https://www.inzone.games/games/x', utm_content: 'exclude_from_acquisition', user_id: 'l-2' },
    bucket: 'diagnostic', appEnv: 'production',
  },
  {
    label: 'localhost',
    row: { url: 'http://localhost:3000/games/x', user_id: 'd-1' },
    bucket: 'diagnostic', appEnv: 'local',
  },
];

for (const f of FIXTURES) {
  test(`report classification — ${f.label}`, () => {
    const got = classifyReportRow(f.row, HISTORICAL);
    assert.equal(got.bucket, f.bucket, `${f.label}: ${got.reason}`);
    assert.equal(got.appEnv, f.appEnv);
  });
}

test('every fixture lands in exactly one of the two buckets', () => {
  const customer = FIXTURES.filter((f) => classifyReportRow(f.row, HISTORICAL).bucket === 'customer');
  const diagnostic = FIXTURES.filter((f) => classifyReportRow(f.row, HISTORICAL).bucket === 'diagnostic');
  assert.equal(customer.length + diagnostic.length, FIXTURES.length);
  assert.equal(customer.length, 2, 'only the two genuine production visitors count');
});

test('hostnameOf tolerates junk without throwing', () => {
  assert.equal(hostnameOf('not a url'), null);
  assert.equal(hostnameOf(''), null);
  assert.equal(hostnameOf(null), null);
  assert.equal(hostnameOf('https://www.inzone.games/x?y=1'), 'www.inzone.games');
});

/* ── the SQL must still carry each clause the decision depends on ───────── */

test('customer SQL restricts to the exact production hostnames', () => {
  const sql = campaignWhere(7);
  for (const h of PRODUCTION_HOSTS) assert.ok(sql.includes(`'${h}'`), `missing ${h}`);
  assert.ok(productionHostSql().includes('IN ('), 'exact-match list, not a suffix test');
  assert.ok(!/endsWith\([^)]*inzone\.games/.test(productionHostSql()), 'must not suffix-match production');
});

test('customer SQL excludes marked traffic and both legacy conventions', () => {
  const sql = campaignWhere(7);
  assert.ok(sql.includes("'traffic_kind') = ''"), 'marker clause missing');
  assert.ok(sql.includes("'qa', 'verification'"), 'legacy utm_medium clause missing');
  assert.ok(sql.includes('exclude_from_acquisition'), 'legacy utm_content clause missing');
});

test('diagnostics SQL is the complement of the customer SQL', () => {
  const diag = diagnosticsWhere(7);
  assert.ok(diag.includes('NOT ('), 'diagnostics must be the negation, not a second guess');
  assert.ok(diag.includes(markedTrafficSql().trim().split('\n')[0].trim()));
});

test('the environment bucket never folds an unclassified host into production', () => {
  const sql = environmentBucketSql();
  assert.ok(sql.includes("'unknown'"), 'unknown must be a real bucket');
  assert.ok(sql.trimEnd().endsWith("'unknown'\n    )") || sql.includes("'unknown'\n    )"),
    'the multiIf default must be unknown, not production');
});
