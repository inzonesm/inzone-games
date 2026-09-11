/**
 * Two independent browser contexts against Auth + Firestore emulators.
 * Invite → join → message → suggest → independent switch → refresh → leave.
 *
 * Usage: npm run test:play-session-live
 * Production rules are not deployed.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'inzone-f93e4';
const APP_PORT = process.env.PLAY_SESSION_LIVE_PORT || '3010';
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const ARTIFACTS = process.env.PLAY_SESSION_ARTIFACTS || '/opt/cursor/artifacts';
const CHROME = process.env.CHROMIUM_EXECUTABLE || '/usr/local/bin/google-chrome';
const GCS = 'https://storage.googleapis.com/inzone-html/games/nightclub-showdown-inzone-production/v2/index.html';

const children = [];

function run(cmd, args, extraEnv = {}) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
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
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
}

process.on('exit', stopAll);
process.on('SIGINT', () => { stopAll(); process.exit(1); });

async function seedCatalog() {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.GCLOUD_PROJECT = PROJECT;
  const app = initializeApp({ projectId: PROJECT });
  const db = getFirestore(app);
  await db.collection('html_games').doc('nightclub-showdown-inzone-production').set({
    name: 'Nightclub Showdown',
    description: 'Seeded for emulator session proof.',
    iconUrl: '',
    gameUrl: GCS,
    serverUrl: '',
    status: 'approved',
    uploaderId: 'emulator-seed',
  });
  await db.collection('html_games').doc('neon-blaster').set({
    name: 'Neon Blaster',
    description: 'Second title for independent switch and suggest.',
    iconUrl: '',
    gameUrl: GCS,
    serverUrl: '',
    status: 'approved',
    uploaderId: 'emulator-seed',
  });
}

async function shot(page, name) {
  mkdirSync(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: join(ARTIFACTS, name), fullPage: false });
}

const emu = run('npx', ['firebase', 'emulators:start', '--only', 'auth,firestore', `--project`, PROJECT], {
  FIRESTORE_EMULATOR_HOST: '',
});
await waitFor(emu, /All emulators ready/i, 120_000, 'firebase emulators');
await seedCatalog();

const next = run('npx', ['next', 'dev', '-p', APP_PORT], {
  NEXT_PUBLIC_FIREBASE_EMULATOR: '1',
});
await waitFor(next, /Ready in/i, 120_000, 'next dev');

const browser = await chromium.launch({
  headless: true,
  executablePath: existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const videoDir = join(ARTIFACTS, 'play-session-live-videos');
mkdirSync(videoDir, { recursive: true });

function newCtx() {
  return browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ['clipboard-read', 'clipboard-write'],
    recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
  });
}

const hostCtx = await newCtx();
const joinCtx = await newCtx();
const host = await hostCtx.newPage();
const joiner = await joinCtx.newPage();
const results = [];

try {
  await host.goto(`${APP_URL}/session-prototype`, { waitUntil: 'domcontentloaded' });
  await host.getByText('Nightclub Showdown').first().waitFor({ timeout: 30_000 });
  await host.getByRole('button', { name: 'Invite' }).first().click();
  await host.waitForFunction(() => /session=[a-f0-9]{32}/.test(location.search), null, { timeout: 20_000 });
  const inviteUrl = host.url();
  assert.match(inviteUrl, /session=[a-f0-9]{32}/);
  results.push(`invite created: ${inviteUrl}`);
  await shot(host, 'play_session_host_invite.png');

  await joiner.goto(inviteUrl, { waitUntil: 'domcontentloaded' });
  await joiner.getByRole('button', { name: 'Chat' }).click();
  await joiner.getByText('Messages sync for people with this invite.').waitFor({ timeout: 20_000 });
  await host.getByText('Messages sync for people with this invite.').waitFor({ timeout: 10_000 });
  await joiner.waitForFunction(() => document.querySelectorAll('.sp-person').length >= 2, null, { timeout: 20_000 });
  await host.waitForFunction(() => document.querySelectorAll('.sp-person').length >= 2, null, { timeout: 20_000 });
  results.push('join: both browsers show two people');
  await shot(joiner, 'play_session_joiner_joined.png');

  const chatBox = host.locator('.sp-compose input');
  await chatBox.fill('hello from host');
  await host.locator('.sp-compose button[type="submit"]').click();
  await host.getByText('hello from host').waitFor({ timeout: 15_000 });
  await joiner.getByText('hello from host').waitFor({ timeout: 15_000 });
  results.push('message: joiner saw host chat after persistence');
  await shot(joiner, 'play_session_joiner_message.png');

  await host.getByRole('button', { name: 'Discover' }).first().click();
  await host.getByText('Neon Blaster').first().click();
  await host.getByRole('button', { name: 'Suggest' }).click();
  await host.getByText('Suggested. Nobody was moved.').waitFor({ timeout: 15_000 });
  await joiner.locator('.sp-suggest').filter({ hasText: 'Neon Blaster' }).waitFor({ timeout: 15_000 });
  results.push('suggest: joiner saw suggestion only after write succeeded');
  await shot(host, 'play_session_host_suggest.png');
  await shot(joiner, 'play_session_joiner_suggest.png');

  await joiner.getByRole('button', { name: 'Open game' }).click();
  const switchBtn = joiner.getByRole('button', { name: 'Switch game' });
  if (await switchBtn.isVisible().catch(() => false)) await switchBtn.click();
  await joiner.getByText('Neon Blaster').first().waitFor({ timeout: 15_000 });
  const hostNow = await host.locator('.sp-now strong').textContent();
  const joinNow = await joiner.locator('.sp-now strong').textContent();
  assert.notEqual(hostNow?.trim(), joinNow?.trim());
  results.push(`independent switch: host="${hostNow?.trim()}" joiner="${joinNow?.trim()}"`);
  await shot(host, 'play_session_host_still_nightclub.png');
  await shot(joiner, 'play_session_joiner_switched.png');

  await joiner.reload({ waitUntil: 'domcontentloaded' });
  await joiner.getByRole('button', { name: 'Chat' }).click();
  await joiner.getByText('hello from host').waitFor({ timeout: 20_000 });
  results.push('refresh/reconnect: joiner still sees persisted chat');
  await shot(joiner, 'play_session_joiner_reconnect.png');

  await joiner.getByRole('button', { name: 'Leave session' }).click();
  await joiner.getByText('You left the session.').waitFor({ timeout: 15_000 });
  await host.waitForFunction(() => document.querySelectorAll('.sp-person').length === 1, null, { timeout: 20_000 });
  results.push('leave: joiner left; host remains in session');
  await shot(host, 'play_session_host_after_leave.png');
  await shot(joiner, 'play_session_joiner_left.png');

  console.log(JSON.stringify({ ok: true, results }, null, 2));
} catch (err) {
  await shot(host, 'play_session_host_failure.png').catch(() => {});
  await shot(joiner, 'play_session_joiner_failure.png').catch(() => {});
  console.error(err);
  process.exitCode = 1;
} finally {
  await hostCtx.close();
  await joinCtx.close();
  await browser.close();
  stopAll();
}
