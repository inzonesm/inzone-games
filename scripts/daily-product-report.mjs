#!/usr/bin/env node
/**
 * First accurate daily product report for the flagship roster.
 *
 * Reads Hexclave when an authenticated CLI session exists. Missing
 * measurements are written as `unknown`, never zero. Output is sanitized
 * Markdown: no replay ids, user ids, transcripts, or raw URLs.
 *
 * Usage:
 *   HEXCLAVE_PROJECT_ID=… node scripts/daily-product-report.mjs
 *
 * Delivery: write to REPORT_DIR if set (prefer a private reporting repo).
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

const COVERAGE = [
  ['Landing / frame load', 'game_open / game_frame_loaded', 'proxy'],
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

async function hexclaveWhoami() {
  return await new Promise((resolve) => {
    const child = spawn('npx', ['--yes', '@hexclave/cli@latest', 'whoami'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('close', (code) => resolve({ code, out: (out + err).trim() }));
  });
}

function coverageTable() {
  const rows = [
    '| Signal | Event names | Status on flagship roster |',
    '|---|---|---|',
  ];
  for (const [signal, events, status] of COVERAGE) {
    rows.push(`| ${signal} | \`${events}\` | ${status} |`);
  }
  rows.push('');
  rows.push('| Game | Verified start | Engaged / over | Companion |');
  rows.push('|---|---|---|---|');
  for (const game of FLAGSHIP_ROSTER) {
    const verified = game.id === 'nightclub-showdown-inzone-production'
      ? 'Nightclub v2 adapter'
      : 'unknown — no adapter';
    rows.push(`| ${game.title} | ${verified} | ${verified} | instrumented this branch |`);
  }
  return rows.join('\n');
}

function reportMarkdown({ whoami, day, windowDays, counts }) {
  const generatedAt = new Date().toISOString();
  const deployed = process.env.REPORT_DEPLOYED_SHA || 'unknown';
  return `# InZone daily product report — ${day}

- Generated at: ${generatedAt}
- Deployed version: \`${deployed}\`
- Historical window requested: up to 28 days; window used: **${windowDays}**
- Hexclave identity: ${whoami.ok ? 'authenticated' : 'unknown — CLI not logged in this runner'}
- QA traffic: not excluded (no identifiable QA filter available)
- Sample size: ${counts ? 'see tables' : 'unknown'}

## Measurement coverage

${coverageTable()}

Unavailable measurements are **unknown**, not zero.

## Latest complete UTC day vs preceding 7 days

Latest complete day: **${day}**

${counts || 'Counts are unknown. Hexclave query did not run. Do not treat missing coverage as no players.'}

## Findings

1. Four flagship titles still have no verified gameplay adapter. Frame loads on those titles are not players.
2. Companion events are new on this branch and will be unknown until the preview is used.
3. Preview SSO / Firebase gaps can hide catalogue cards; hosted checks must record the exact SHA.

## Prioritized next change

Ship one verified start adapter only after ordinary play on that title actually exposes a trustworthy signal. Do not fabricate starts from iframe load.

## Previous change

This is the first report on the revamp branch. No prior daily file exists.

## Replay and capture limits

Replay identifiers are omitted. Iframe canvas capture in Hexclave is not assumed. Physical-device evidence is separate from emulated browser evidence.

## Schedule

Proposed: 09:00 America/Los_Angeles. Scheduling is complete only after one successful run **and** a verified delivery path.
`;
}

async function main() {
  const who = await hexclaveWhoami();
  const whoami = { ok: who.code === 0 && /@|user|email|logged/i.test(who.out), raw: who.out.slice(0, 200) };
  const day = utcDay(yesterdayUtc());
  const body = reportMarkdown({
    whoami,
    day,
    windowDays: whoami.ok ? 'query pending first authenticated pull' : 'unknown',
    counts: null,
  });

  if (!REPORT_DIR) {
    process.stdout.write(body);
    process.stderr.write(
      '\nREPORT_DIR is unset. Refusing to write private analytics into the public repo.\n',
    );
    process.exit(whoami.ok ? 0 : 2);
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
