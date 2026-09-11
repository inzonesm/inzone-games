/**
 * Browser acceptance against the real HexclaveProvider (not a mocked client).
 *
 * Starts Next with the production Hexclave project id, intercepts
 * r.hexclave.com analytics batches (gzip + JSON), continues them to the
 * real ingest, and records HTTP acceptance separately from dashboard UI.
 *
 * Usage: npm run test:hexclave-provider
 */
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { campaignEventNameFromHexclaveEvent } from '../lib/campaign-analytics.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_PORT = process.env.HEXCLAVE_PROVIDER_PORT || '3017';
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const ARTIFACTS = process.env.PLAY_SESSION_ARTIFACTS || '/opt/cursor/artifacts';
const CHROME = process.env.CHROMIUM_EXECUTABLE || '/usr/local/bin/google-chrome';
const HEXCLAVE_PROJECT_ID =
  process.env.HEXCLAVE_PROJECT_ID || '463bba54-7ccd-4570-acb7-0dc8f5123e7e';
const CAMPAIGN =
  `/session-prototype?utm_source=gtm&utm_medium=cpc&utm_campaign=play-together-2026&game=nightclub-showdown-inzone-production`;
const NIGHTCLUB = 'Nightclub Showdown';
const PUZZLE = '2048';
const SECRET_RE = /session=|[?&]session=|invite=|[a-f0-9]{32}/i;
const CHAT_LEAK = 'hexclave-secret-chat-should-never-ship';

const children = [];

function freePort(port) {
  try {
    execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' });
  } catch {
    /* nothing listening */
  }
}

function run(cmd, args, extraEnv = {}) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  children.push(child);
  let buf = '';
  const onData = (chunk) => {
    const s = chunk.toString();
    buf += s;
    process.stderr.write(s);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.buffer = () => buf;
  return child;
}

function waitFor(child, re, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    const check = (chunk) => {
      if (re.test(String(chunk)) || re.test(child.buffer())) {
        clearTimeout(timer);
        child.stdout.off('data', check);
        child.stderr.off('data', check);
        resolve();
      }
    };
    child.stdout.on('data', check);
    child.stderr.on('data', check);
    check('');
  });
}

function stopAll() {
  for (const child of children) {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

process.on('exit', stopAll);
process.on('SIGINT', () => {
  stopAll();
  process.exit(1);
});

function decodeBatchBody(buffer, headers) {
  if (!buffer || !buffer.length) return { json: '', gzip: false };
  const contentType = String(headers['content-type'] || headers['Content-Type'] || '');
  const gzip = contentType.includes('octet-stream') || (buffer[0] === 0x1f && buffer[1] === 0x8b);
  const json = gzip ? gunzipSync(buffer).toString('utf8') : buffer.toString('utf8');
  return { json, gzip };
}

async function attachAnalytics(page, sink) {
  await page.route('**/api/v1/analytics/events/batch', async (route) => {
    const request = route.request();
    const headers = request.headers();
    const buffer = request.postDataBuffer();
    let decoded = { json: '', gzip: false };
    try {
      decoded = decodeBatchBody(buffer, headers);
    } catch (err) {
      decoded = { json: `decode-error:${err instanceof Error ? err.message : String(err)}`, gzip: false };
    }
    const started = Date.now();
    const response = await route.fetch();
    const status = response.status();
    sink.push({
      url: request.url(),
      status,
      accepted: status >= 200 && status < 300,
      gzip: decoded.gzip,
      json: decoded.json,
      elapsedMs: Date.now() - started,
    });
    await route.fulfill({ response });
  });
}

function eventTypes(batches) {
  const types = [];
  for (const batch of batches) {
    try {
      const parsed = JSON.parse(batch.json);
      for (const event of parsed.events || []) {
        const name = campaignEventNameFromHexclaveEvent(event);
        if (name) types.push(name);
        else if (typeof event.event_type === 'string') types.push(event.event_type);
      }
    } catch {
      /* ignore */
    }
  }
  return types;
}

function dumped(batches) {
  return batches.map((batch) => batch.json).join('\n');
}

async function waitForEvent(batches, name, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (eventTypes(batches).includes(name)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${name}; saw ${eventTypes(batches).join(',')}`);
}

async function shot(page, name) {
  mkdirSync(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: join(ARTIFACTS, name), fullPage: false });
}

async function openDiscoverAndPlay(page, gameName) {
  await page.getByRole('button', { name: 'Discover' }).first().click();
  const search = page.getByLabel('Search games');
  await search.waitFor({ timeout: 20_000 });
  await search.fill(gameName);
  const card = page.locator('.sp-grid .sp-card').filter({ hasText: gameName }).first();
  await card.waitFor({ timeout: 20_000 });
  await card.click();
  await page.getByRole('button', { name: 'Play' }).click();
  const confirm = page.getByRole('button', { name: 'Switch game' });
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click();
  }
}

freePort(APP_PORT);

const hexclaveEnv = {
  HEXCLAVE_PROJECT_ID,
  NEXT_PUBLIC_HEXCLAVE_PROJECT_ID: HEXCLAVE_PROJECT_ID,
  PORT: APP_PORT,
};

const next = run('npx', ['next', 'dev', '-p', APP_PORT, '-H', '127.0.0.1'], hexclaveEnv);
await waitFor(next, /Ready|started server|Local:/i, 120_000, 'next dev');

const browser = await chromium.launch({
  headless: true,
  executablePath: existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const videoDir = join(ARTIFACTS, 'hexclave-provider-videos');
mkdirSync(videoDir, { recursive: true });

function newCtx(clipboard) {
  return browser.newContext({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
    permissions: clipboard ? ['clipboard-read', 'clipboard-write'] : [],
    recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
  });
}

const hostBatches = [];
const joinerBatches = [];
const failCopyBatches = [];
const results = {
  transportAcceptance: [],
  dashboardIngestion: 'not verified (no Hexclave admin credentials)',
  events: {},
};

const hostCtx = await newCtx(true);
const joinCtx = await newCtx(true);
const failCtx = await newCtx(false);
const host = await hostCtx.newPage();
const joiner = await joinCtx.newPage();
const failCopy = await failCtx.newPage();

try {
  host.on('console', (msg) => console.log('[host]', msg.type(), msg.text()));
  joiner.on('console', (msg) => console.log('[joiner]', msg.type(), msg.text()));

  await attachAnalytics(host, hostBatches);
  await attachAnalytics(joiner, joinerBatches);
  await attachAnalytics(failCopy, failCopyBatches);

  await failCopy.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error('Clipboard write denied')),
      },
    });
  });

  await host.goto(`${APP_URL}${CAMPAIGN}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await host.getByRole('button', { name: 'Invite' }).waitFor({ timeout: 60_000 });
  await shot(host, 'hexclave_provider_campaign_arrival.png');
  await waitForEvent(hostBatches, 'campaign_arrival', 15_000);

  await failCopy.goto(`${APP_URL}${CAMPAIGN}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await failCopy.getByRole('button', { name: 'Invite' }).waitFor({ timeout: 60_000 });
  await failCopy.evaluate(() => {
    const write = () => Promise.reject(new Error('Clipboard write denied'));
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: write },
      });
    } catch {
      navigator.clipboard.writeText = write;
    }
  });
  await failCopy.getByRole('button', { name: 'Invite' }).click();
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(eventTypes(failCopyBatches).includes('invite_copied'), false);
  await shot(failCopy, 'hexclave_provider_copy_failed.png');

  await host.getByRole('button', { name: 'Invite' }).click();
  await host.getByText(/Invite link copied/i).waitFor({ timeout: 30_000 });
  await waitForEvent(hostBatches, 'invite_copied', 15_000);
  const inviteUrl = await host.evaluate(() => window.location.href);
  assert.match(inviteUrl, /session=[a-f0-9]{32}/);
  await shot(host, 'hexclave_provider_invite_copied.png');

  await joiner.goto(inviteUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await joiner.getByRole('button', { name: 'Join session' }).waitFor({ timeout: 45_000 });
  await joiner.getByRole('button', { name: 'Join session' }).click();
  await waitForEvent(joinerBatches, 'invite_joined', 20_000);
  await shot(joiner, 'hexclave_provider_invite_joined.png');

  const chat = host.locator('textarea, input[placeholder*="message" i]').first();
  await host.getByRole('button', { name: 'Chat' }).first().click().catch(() => {});
  await chat.waitFor({ timeout: 20_000 });
  await chat.fill(CHAT_LEAK);
  await chat.press('Enter');

  await openDiscoverAndPlay(host, PUZZLE);
  await host.locator('.sp-now strong').filter({ hasText: /2048/i }).waitFor({ timeout: 30_000 });
  await waitForEvent(hostBatches, 'game_opened', 15_000);
  await shot(host, 'hexclave_provider_game_switch.png');

  // Automatic $page-view after replaceState flushes on a 10s interval.
  await new Promise((r) => setTimeout(r, 12_000));

  const allBatches = [...hostBatches, ...joinerBatches, ...failCopyBatches];
  const types = eventTypes(hostBatches);
  results.events = {
    host: types,
    joiner: eventTypes(joinerBatches),
    failedCopy: eventTypes(failCopyBatches),
  };
  results.transportAcceptance = allBatches.map((batch) => ({
    url: batch.url,
    status: batch.status,
    accepted: batch.accepted,
    gzip: batch.gzip,
    eventTypes: (() => {
      try {
        return (JSON.parse(batch.json).events || [])
          .map((e) => campaignEventNameFromHexclaveEvent(e) || e.event_type)
          .filter(Boolean);
      } catch {
        return [];
      }
    })(),
  }));

  assert.equal(types.includes('campaign_arrival'), true);
  assert.equal(types.includes('invite_copied'), true);
  assert.equal(eventTypes(joinerBatches).includes('invite_joined'), true);
  assert.equal(types.includes('game_opened'), true);
  assert.equal(eventTypes(failCopyBatches).includes('invite_copied'), false);

  const opened = hostBatches
    .flatMap((batch) => {
      try {
        return JSON.parse(batch.json).events || [];
      } catch {
        return [];
      }
    })
    .find((event) => event.event_type === 'game_opened');
  assert.ok(opened);
  assert.equal(opened.data.utm_campaign, 'play-together-2026');
  assert.equal(opened.data.utm_source, 'gtm');

  const dump = dumped(allBatches);
  assert.equal(dump.includes(CHAT_LEAK), false);
  assert.doesNotMatch(dump, /session=/);
  for (const batch of allBatches) {
    assert.equal(batch.accepted, true, `ingest ${batch.url} returned ${batch.status}`);
  }

  const pageViews = allBatches.flatMap((batch) => {
    try {
      return (JSON.parse(batch.json).events || []).filter((e) => e.event_type === '$page-view');
    } catch {
      return [];
    }
  });
  assert.equal(pageViews.length >= 1, true, 'expected automatic $page-view after Provider flush');
  for (const event of pageViews) {
    const url = String(event.data?.url || '');
    assert.equal(url.includes('session='), false, url);
    assert.equal(SECRET_RE.test(String(event.data?.text || '')), false);
  }

  writeFileSync(join(ARTIFACTS, 'hexclave_provider_transport.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ok: true, results }, null, 2));
} finally {
  await hostCtx.close().catch(() => {});
  await joinCtx.close().catch(() => {});
  await failCtx.close().catch(() => {});
  await browser.close().catch(() => {});
  stopAll();
}
