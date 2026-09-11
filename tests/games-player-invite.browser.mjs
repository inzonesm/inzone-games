/**
 * Unified player: Play with a friend sheet + join via ?session=.
 * Usage: node tests/games-player-invite.browser.mjs
 */
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { featuredHeroSlug } from '../lib/home-rows.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'inzone-f93e4';
const APP_PORT = process.env.PLAYER_INVITE_PORT || '3018';
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const ARTIFACTS = process.env.PLAY_SESSION_ARTIFACTS || '/opt/cursor/artifacts';
const CHROME = process.env.CHROMIUM_EXECUTABLE || '/usr/local/bin/google-chrome';
const HERO = featuredHeroSlug();
const GCS = 'https://storage.googleapis.com/inzone-html/games/snake/v2/src/index.html';
const SESSION_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const children = [];

function freePort(port) {
  try { execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' }); } catch { /* nothing listening */ }
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
    } catch { /* already gone */ }
  }
}

process.on('exit', stopAll);
process.on('SIGINT', () => { stopAll(); process.exit(1); });

async function seed() {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.GCLOUD_PROJECT = PROJECT;
  const app = initializeApp({ projectId: PROJECT });
  const db = getFirestore(app);
  await db.collection('html_games').doc(HERO).set({
    name: 'Snake',
    description: 'Seeded hero game.',
    iconUrl: '',
    gameUrl: GCS,
    serverUrl: '',
    status: 'approved',
    uploaderId: 'emulator-seed',
  });
  await db.collection('playSessions').doc(SESSION_ID).set({
    hostId: 'seed-host',
    memberIds: ['seed-host'],
    memberNames: { 'seed-host': 'Host' },
    gameId: HERO,
    status: 'open',
    // Rules require a timestamp for playUnexpired(); a millis number 403s preview+join.
    createdAt: Timestamp.now(),
    latestSeq: 0,
  });
  return db;
}

freePort(APP_PORT);
freePort(8080);
freePort(9099);
await new Promise((r) => setTimeout(r, 500));

const emu = run('npx', ['firebase', 'emulators:start', '--only', 'auth,firestore', `--project`, PROJECT], {
  FIRESTORE_EMULATOR_HOST: '',
});
await waitFor(emu, /All emulators ready/i, 120_000, 'firebase emulators');
const db = await seed();

const next = run('npx', ['next', 'dev', '-p', APP_PORT], {
  NEXT_PUBLIC_FIREBASE_EMULATOR: '1',
});
await waitFor(next, /Ready in/i, 120_000, 'next dev');

const browser = await chromium.launch({
  headless: true,
  executablePath: existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await ctx.newPage();
mkdirSync(ARTIFACTS, { recursive: true });

try {
  page.on('console', (msg) => console.log('[player]', msg.type(), msg.text()));
  page.on('pageerror', (err) => console.log('[player:error]', err.message));
  await page.goto(`${APP_URL}/games/${encodeURIComponent(HERO)}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const redirect = await page.request.fetch(
    `${APP_URL}/session-prototype?game=${encodeURIComponent(HERO)}&session=${SESSION_ID}`,
    { maxRedirects: 0 },
  );
  assert.equal(redirect.status(), 308);
  assert.match(redirect.headers()['location'] || '', new RegExp(`/games/${HERO}\\?session=${SESSION_ID}`));

  await page.locator('.sp-now strong').filter({ hasText: /Snake/i }).waitFor({ timeout: 30_000 });
  await page.getByTestId('play-with-friend').waitFor({ timeout: 10_000 });
  assert.equal(await page.getByRole('button', { name: 'Invite', exact: true }).count(), 0);
  await page.screenshot({ path: join(ARTIFACTS, 'followup_player_desktop_play_with_friend.png') });
  await page.getByTestId('play-with-friend').click();
  await page.getByTestId('social-panel').waitFor({ timeout: 15_000 });
  const copy = page.getByRole('button', { name: 'Copy Link' });
  await copy.waitFor({ timeout: 15_000 });
  await page.waitForFunction(() => {
    const el = document.activeElement;
    return el && /copy link/i.test((el.textContent || el.getAttribute('aria-label') || ''));
  }, null, { timeout: 10_000 });
  await page.screenshot({ path: join(ARTIFACTS, 'followup_invite_copy_focused.png') });
  await copy.click();
  await page.getByText(/Invite link copied/i).waitFor({ timeout: 20_000 });
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(clip, new RegExp(`/games/${HERO}\\?session=[a-f0-9]{32}$`));
  assert.doesNotMatch(clip, /session-prototype/);

  // Friend-of-Alice: a second anonymous uid (not the copy tab, not seed-host)
  // opens the seeded invite and actually joins.
  const friend = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const friendPage = await friend.newPage();
  friendPage.on('console', (msg) => console.log('[friend]', msg.type(), msg.text()));
  friendPage.on('pageerror', (err) => console.log('[friend:error]', err.message));
  await friendPage.goto(
    `${APP_URL}/games/${encodeURIComponent(HERO)}?session=${SESSION_ID}`,
    { waitUntil: 'domcontentloaded', timeout: 60_000 },
  );
  const joinBtn = friendPage.getByRole('button', { name: 'Join session', exact: true });
  await joinBtn.waitFor({ timeout: 30_000 });
  await joinBtn.click();
  await friendPage.getByRole('button', { name: 'Leave session', exact: true }).waitFor({ timeout: 30_000 });
  await friendPage.locator('.sp-compose input').waitFor({ timeout: 15_000 });

  let members = [];
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const snap = await db.collection('playSessions').doc(SESSION_ID).get();
    members = snap.data()?.memberIds || [];
    if (members.length === 2 && members.includes('seed-host') && members.some((id) => id !== 'seed-host')) {
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(members.includes('seed-host'), true, `seed-host missing in ${JSON.stringify(members)}`);
  assert.equal(members.length, 2, `expected 2 members, got ${JSON.stringify(members)}`);
  assert.equal(members.some((id) => id !== 'seed-host'), true);
  await friendPage.screenshot({ path: join(ARTIFACTS, 'followup_invite_joined.png') });
  await friend.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mpage = await mobile.newPage();
  await mpage.goto(`${APP_URL}/games/${encodeURIComponent(HERO)}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await mpage.locator('.sp-now strong').waitFor({ timeout: 30_000 });
  await mpage.getByTestId('play-with-friend-mobile').waitFor({ timeout: 15_000 });
  assert.equal(await mpage.getByRole('button', { name: 'Invite', exact: true }).count(), 0);
  await mpage.screenshot({ path: join(ARTIFACTS, 'followup_player_mobile_play_with_friend.png') });
  await mpage.getByTestId('play-with-friend-mobile').evaluate((el) => el.click());
  const mobilePanel = mpage.getByTestId('social-panel');
  try {
    await mobilePanel.waitFor({ timeout: 8_000 });
  } catch {
    const peek = mpage.locator('.social-panel-peek-hit');
    if (await peek.isVisible().catch(() => false)) await peek.evaluate((el) => el.click());
    await mobilePanel.waitFor({ timeout: 15_000 });
  }
  await mpage.getByRole('button', { name: 'Copy Link' }).waitFor({ timeout: 15_000 });
  await mpage.screenshot({ path: join(ARTIFACTS, 'followup_player_mobile_copy_link.png') });
  await mobile.close();

  console.log(JSON.stringify({
    ok: true,
    hero: HERO,
    session: SESSION_ID,
    clipboard: clip,
    memberIds: members,
  }));
} finally {
  await ctx.close().catch(() => {});
  await browser.close().catch(() => {});
  stopAll();
}
