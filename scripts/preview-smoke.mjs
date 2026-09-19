#!/usr/bin/env node
/**
 * Hosted preview smoke for the revamp branch.
 * Bypass header is applied only to the exact preview host.
 */

import { chromium } from 'playwright-core';

const PREVIEW = process.env.PREVIEW_URL;
const SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
if (!PREVIEW) throw new Error('PREVIEW_URL not set');
if (!SECRET) throw new Error('VERCEL_AUTOMATION_BYPASS_SECRET not set');

const HOST = new URL(PREVIEW).host;
const CHROMIUM =
  process.env.CHROMIUM ||
  process.env.CHROMIUM_EXECUTABLE ||
  process.env.CHROME_PATH ||
  'google-chrome';

const notes = [];
function rec(name, status, detail) {
  notes.push({ name, status, detail });
  console.log(`${status.padEnd(10)} ${name} — ${detail}`);
}

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  locale: 'en-US',
});
await context.route('**', async (route, request) => {
  const url = new URL(request.url());
  if (url.host === HOST) {
    await route.continue({
      headers: {
        ...request.headers(),
        'x-vercel-protection-bypass': SECRET,
        'x-vercel-set-bypass-cookie': 'samesitenone',
      },
    });
    return;
  }
  if (request.headers()['x-vercel-protection-bypass']) {
    rec('bypass-leak', 'FAIL', `bypass header reached ${url.host}`);
  }
  await route.continue();
});

const page = await context.newPage();
const redirects = [];
page.on('framenavigated', (frame) => {
  if (frame === page.mainFrame()) redirects.push(frame.url());
});

const games = await page.goto(`${PREVIEW}/games`, { waitUntil: 'domcontentloaded', timeout: 45000 });
const gamesStatus = games?.status() ?? 0;
const gamesUrl = page.url();
if (gamesStatus >= 300 && gamesStatus < 400) rec('games-load', 'FAIL', `HTTP ${gamesStatus} ${gamesUrl}`);
else if (/\/login|sso|vercel\.com\/login/i.test(gamesUrl) && !/\/games/.test(gamesUrl)) {
  rec('games-load', 'FAIL', `redirected off /games to ${gamesUrl}`);
} else if ((redirects.filter((u) => /\/games\/?$/.test(new URL(u).pathname)).length || 0) > 6) {
  rec('games-load', 'FAIL', `redirect loop: ${redirects.slice(-8).join(' -> ')}`);
} else {
  rec('games-load', 'PASS', `HTTP ${gamesStatus} ${gamesUrl}`);
}

await page.waitForTimeout(4000);
const html = await page.content();
const firebasePresent = /firebase|inzone-f93e4|NEXT_PUBLIC_FIREBASE/i.test(html)
  || await page.evaluate(() => {
    const scripts = [...document.scripts].map((s) => s.textContent || '').join('\n');
    return /inzone-f93e4|firebaseapp\.com|firebase\/js/.test(scripts + document.documentElement.innerHTML);
  });
rec('firebase-config', firebasePresent ? 'PASS' : 'UNVERIFIED', firebasePresent ? 'firebase strings present in document' : 'not found in HTML; may be chunk-split');

const cards = await page.locator('.game-card').count();
const flagship = await page.locator('[data-testid=flagship-row] .game-card').count();
if (cards > 0) rec('catalogue', 'PASS', `${cards} cards, flagship row ${flagship}`);
else rec('catalogue', 'FAIL', 'no .game-card nodes');

if (cards > 0) {
  const href = await page.locator('.game-card').first().getAttribute('href');
  await page.locator('.game-card').first().click();
  await page.waitForTimeout(5000);
  const opened = page.url();
  const frame = page.locator('iframe').first();
  const frameCount = await page.locator('iframe').count();
  const companion = await page.locator('[data-testid=game-companion]').count();
  if (/\/games\/.+/.test(opened) && frameCount > 0) {
    rec('game-open', 'PASS', `${opened} iframe=${await frame.getAttribute('src')} companion=${companion}`);
  } else {
    rec('game-open', 'FAIL', `${opened} iframes=${frameCount}`);
  }
}

await browser.close();
const failed = notes.filter((n) => n.status === 'FAIL');
console.log(JSON.stringify({ host: HOST, notes }, null, 2));
process.exit(failed.length ? 1 : 0);
