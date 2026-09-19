#!/usr/bin/env node
/**
 * Daily product report. Queries Hexclave through the documented
 * `hexclave exec --cloud-project-id` + `hexclaveServerApp.queryAnalytics`
 * path (see scripts/hexclave-analytics-query.mjs).
 *
 * Missing authentication is a **blocked** result, not a successful report
 * with counts: null. Unavailable measurements are **unknown**, never zero.
 *
 * Usage:
 *   HEXCLAVE_PROJECT_ID=… node --experimental-strip-types scripts/daily-product-report.mjs
 *
 * Delivery: write to REPORT_DIR only (prefer a private reporting repo).
 * Never write private analytics into the public application repository.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { FLAGSHIP_ROSTER } from '../lib/flagship-roster.ts';

const PROJECT_ID =
  process.env.HEXCLAVE_PROJECT_ID || '463bba54-7ccd-4570-acb7-0dc8f5123e7e';
const REPORT_DIR = process.env.REPORT_DIR || '';
const CAMPAIGN_PATH = '/session-prototype';
const QA_USER_IDS = (process.env.HEXCLAVE_QA_USER_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const COVERAGE = [
  ['Landing / frame load', 'game_open / game_frame_loaded', 'proxy — not a player'],
  ['Verified gameplay start', 'game_start', 'verified — Nightclub + Flappy only'],
  ['Engagement', 'engaged_play', 'verified — adapter games only'],
  ['Game over', 'first_game_over', 'verified — adapter games only'],
  ['Return', 'return_play', 'verified — next local calendar day'],
  ['Invitations / joins', 'invite_copied / invite_joined', 'social interest'],
  ['Companion usage', 'companion_intro / companion_turn', 'not gameplay'],
  ['Companion audio fail / latency', 'companion_audio_fail + latency_ms', 'not gameplay'],
];

function utcDay(d) {
  return d.toISOString().slice(0, 10);
}

function yesterdayUtc(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

function spawnHexclave(args) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['--yes', '@hexclave/cli@latest', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

async function hexclaveWhoami() {
  return spawnHexclave(['whoami']);
}

function qaFilterSql() {
  if (!QA_USER_IDS.length) return '';
  const list = QA_USER_IDS.map((id) => `'${id.replace(/'/g, '')}'`).join(', ');
  return `AND (user_id IS NULL OR user_id NOT IN (${list}))`;
}

function campaignWhere(days) {
  return `
    event_type = '$page-view'
    AND JSONExtractString(toString(data), 'path') = '${CAMPAIGN_PATH}'
    AND event_at > now() - INTERVAL ${days} DAY
    ${qaFilterSql()}
  `;
}

async function queryAnalytics(sql) {
  const js = `return await hexclaveServerApp.queryAnalytics({ query: ${JSON.stringify(sql)} });`;
  const result = await spawnHexclave(['exec', '--cloud-project-id', PROJECT_ID, js]);
  if (result.code !== 0) {
    throw new Error(result.err || result.out || `hexclave exec exit ${result.code}`);
  }
  if (!result.out) return null;
  return JSON.parse(result.out);
}

function rowsOf(result) {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.rows)) return result.rows;
  if (Array.isArray(result.data)) return result.data;
  return [];
}

function num(row, key) {
  const v = row?.[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function str(row, key) {
  return typeof row?.[key] === 'string' ? row[key] : '';
}

function coverageTable() {
  const rows = [
    '| Signal | Event names | Status on flagship roster |',
    '|---|---|---|',
  ];
  for (const [signal, events, status] of COVERAGE) {
    rows.push(`| ${signal} | \`${events}\` | ${status} |`);
  }
  return rows.join('\n');
}

function formatCounts(title, rows, columns) {
  if (!rows.length) return `${title}\n\nunknown — query returned no rows.\n`;
  const header = `| ${columns.map((c) => c.label).join(' | ')} |`;
  const split = `|${columns.map(() => '---').join('|')}|`;
  const body = rows.map((row) =>
    `| ${columns.map((c) => {
      const v = c.text ? str(row, c.key) : num(row, c.key);
      if (v === null || v === undefined || v === '') return 'unknown';
      return String(v);
    }).join(' | ')} |`).join('\n');
  return `${title}\n\n${header}\n${split}\n${body}\n`;
}

function blockedMarkdown({ whoRaw, day, reason }) {
  return `# InZone daily product report — BLOCKED

- Generated at: ${new Date().toISOString()}
- Latest complete UTC day requested: **${day}**
- Status: **blocked**
- Reason: ${reason}
- Hexclave whoami: \`${whoRaw.replace(/`/g, '').slice(0, 180) || 'empty'}\`

This is not a successful analytics report. Counts are **unknown**, not zero.
Do not enable recurrence until an authenticated Hexclave session produces a
populated report **and** that file is delivered to a private REPORT_DIR.

Coordinate \`hexclave login\` with the already-authenticated Hexclave agent,
then rerun:

\`\`\`
HEXCLAVE_PROJECT_ID=${PROJECT_ID} REPORT_DIR=/path/to/private-reports \\
  node --experimental-strip-types scripts/daily-product-report.mjs
\`\`\`
`;
}

function successMarkdown({ day, whoRaw, windowDays, qa, funnelDay, funnelWeek, eventsDay, eventsWeek, perTitle, history }) {
  const generatedAt = new Date().toISOString();
  const deployed = process.env.REPORT_DEPLOYED_SHA || 'unknown';
  return `# InZone daily product report — ${day}

- Generated at: ${generatedAt}
- Deployed version: \`${deployed}\`
- Historical window: **${windowDays}** (1-day vs 7-day vs 28-day queries)
- Hexclave identity: authenticated (\`${whoRaw.replace(/`/g, '').slice(0, 80)}\`)
- QA exclusions: ${qa}
- Sample size: event counts below; unique \`user_id\` is a Hexclave user key, not a person.

## Measurement coverage

${coverageTable()}

Unavailable measurements are **unknown**, not zero. Four flagship titles have no verified gameplay adapter — frame loads on those titles are not players.

## Latest complete UTC day vs preceding 7 days

Latest complete day: **${day}**

${formatCounts('### Funnel — last complete-day window (1 day)', funnelDay, [
  { label: 'Arrivals (events)', key: 'arrivals_events' },
  { label: 'Arrivals (users)', key: 'arrivals_users' },
  { label: 'Starts (events)', key: 'starts_events' },
  { label: 'Starts (users)', key: 'starts_users' },
  { label: 'Engaged (events)', key: 'engaged_events' },
  { label: 'Engaged (users)', key: 'engaged_users' },
  { label: 'First over (events)', key: 'first_over_events' },
  { label: 'First over (users)', key: 'first_over_users' },
])}

${formatCounts('### Funnel — preceding 7 days', funnelWeek, [
  { label: 'Arrivals (events)', key: 'arrivals_events' },
  { label: 'Arrivals (users)', key: 'arrivals_users' },
  { label: 'Starts (events)', key: 'starts_events' },
  { label: 'Starts (users)', key: 'starts_users' },
  { label: 'Engaged (events)', key: 'engaged_events' },
  { label: 'Engaged (users)', key: 'engaged_users' },
])}

${formatCounts('### Campaign events — 1 day', eventsDay, [
  { label: 'Event', key: 'ev', text: true },
  { label: 'Count', key: 'n' },
  { label: 'Users', key: 'users' },
  { label: 'Replays', key: 'replays' },
])}

${formatCounts('### Campaign events — 7 days', eventsWeek, [
  { label: 'Event', key: 'ev', text: true },
  { label: 'Count', key: 'n' },
  { label: 'Users', key: 'users' },
  { label: 'Replays', key: 'replays' },
])}

${formatCounts('### Per-title (7 days)', perTitle, [
  { label: 'Game', key: 'game_id', text: true },
  { label: 'Event', key: 'ev', text: true },
  { label: 'Count', key: 'n' },
  { label: 'Users', key: 'users' },
])}

## Historical context (28 days)

${history || 'unknown — 28-day query did not return rows.'}

## Flagship coverage reminder

${FLAGSHIP_ROSTER.map((game) =>
    `- ${game.title} (\`${game.id}\`): ${
      game.id === 'nightclub-showdown-inzone-production'
        ? 'verified Nightclub v2 adapter'
        : 'no verified start adapter — do not treat opens as players'
    }`).join('\n')}

## Replay and capture limits

Replay identifiers are omitted from this public-safe template when copied; the private file may include counts only. Physical-device evidence is separate from emulated browser evidence.

## Schedule

Proposed: 09:00 America/Los_Angeles. Recurrence stays off until this successful run has a delivery record in a private REPORT_DIR.
`;
}

async function pullWindow(days) {
  const funnel = await queryAnalytics(`
    SELECT
      countIf(ev = 'campaign_arrival') AS arrivals_events,
      uniqExactIf(user_id, ev = 'campaign_arrival') AS arrivals_users,
      countIf(ev = 'game_open') AS opens_events,
      uniqExactIf(user_id, ev = 'game_open') AS opens_users,
      countIf(ev = 'game_start') AS starts_events,
      uniqExactIf(user_id, ev = 'game_start') AS starts_users,
      countIf(ev = 'engaged_play') AS engaged_events,
      uniqExactIf(user_id, ev = 'engaged_play') AS engaged_users,
      countIf(ev = 'first_game_over') AS first_over_events,
      uniqExactIf(user_id, ev = 'first_game_over') AS first_over_users,
      countIf(ev = 'return_play') AS return_events,
      uniqExactIf(user_id, ev = 'return_play') AS return_users
    FROM (
      SELECT user_id, JSONExtractString(toString(data), 'inzone_event') AS ev
      FROM events
      WHERE ${campaignWhere(days)}
    )
  `);
  const events = await queryAnalytics(`
    SELECT JSONExtractString(toString(data), 'inzone_event') AS ev,
           count() AS n,
           uniqExact(user_id) AS users,
           uniqExact(session_replay_id) AS replays
    FROM events
    WHERE ${campaignWhere(days)}
    GROUP BY ev
    ORDER BY n DESC
  `);
  return { funnel: rowsOf(funnel), events: rowsOf(events) };
}

async function main() {
  const day = utcDay(yesterdayUtc());
  const who = await hexclaveWhoami();
  const authenticated = who.code === 0 && /@|user|email|logged/i.test(`${who.out} ${who.err}`) && !/not logged in/i.test(`${who.out} ${who.err}`);

  if (!authenticated) {
    const body = blockedMarkdown({
      whoRaw: `${who.out} ${who.err}`.trim(),
      day,
      reason: 'hexclave_unauthenticated',
    });
    if (REPORT_DIR) {
      await mkdir(REPORT_DIR, { recursive: true });
      const blocked = path.join(REPORT_DIR, `BLOCKED-${day}.md`);
      await writeFile(blocked, body);
      process.stdout.write(`${blocked}\n`);
    } else {
      process.stdout.write(body);
    }
    process.stderr.write('\nBlocked: Hexclave CLI is not authenticated. Not a successful analytics report.\n');
    process.exit(2);
  }

  for (const key of ['HEXCLAVE_SECRET_SERVER_KEY', 'STACK_SECRET_SERVER_KEY']) {
    if (process.env[key]) {
      process.stderr.write(`${key} must be unset for --cloud-project-id exec.\n`);
      process.exit(2);
    }
  }

  const dayWindow = await pullWindow(1);
  const weekWindow = await pullWindow(7);
  const monthWindow = await pullWindow(28);
  const perTitle = rowsOf(await queryAnalytics(`
    SELECT JSONExtractString(toString(data), 'game_id') AS game_id,
           JSONExtractString(toString(data), 'inzone_event') AS ev,
           count() AS n,
           uniqExact(user_id) AS users
    FROM events
    WHERE ${campaignWhere(7)}
    GROUP BY game_id, ev
    ORDER BY n DESC
    LIMIT 80
  `));

  const qa = QA_USER_IDS.length
    ? `excluded ${QA_USER_IDS.length} configured Hexclave user key(s)`
    : 'not excluded — HEXCLAVE_QA_USER_IDS unset';

  const history = formatCounts('28-day funnel', monthWindow.funnel, [
    { label: 'Arrivals (events)', key: 'arrivals_events' },
    { label: 'Arrivals (users)', key: 'arrivals_users' },
    { label: 'Starts (events)', key: 'starts_events' },
    { label: 'Starts (users)', key: 'starts_users' },
    { label: 'Engaged (events)', key: 'engaged_events' },
    { label: 'Engaged (users)', key: 'engaged_users' },
  ]);

  const body = successMarkdown({
    day,
    whoRaw: who.out || 'authenticated',
    windowDays: '1 / 7 / 28',
    qa,
    funnelDay: dayWindow.funnel,
    funnelWeek: weekWindow.funnel,
    eventsDay: dayWindow.events,
    eventsWeek: weekWindow.events,
    perTitle,
    history,
  });

  if (!REPORT_DIR) {
    process.stdout.write(body);
    process.stderr.write('\nREPORT_DIR is unset. Refusing to write private analytics into the public repo.\n');
    process.exit(0);
  }

  await mkdir(REPORT_DIR, { recursive: true });
  const dated = path.join(REPORT_DIR, `${day}.md`);
  const latest = path.join(REPORT_DIR, 'latest.md');
  await writeFile(dated, body);
  await writeFile(latest, body);
  process.stdout.write(`${dated}\n${latest}\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
