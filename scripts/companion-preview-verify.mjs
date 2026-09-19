#!/usr/bin/env node
import { chromium } from 'playwright-core';

const PREVIEW = process.env.PREVIEW_URL;
const SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
if (!PREVIEW || !SECRET) throw new Error('PREVIEW_URL and VERCEL_AUTOMATION_BYPASS_SECRET required');
const HOST = new URL(PREVIEW).host;
const CHROMIUM = process.env.CHROMIUM || '/usr/bin/google-chrome';
const GAMES = [
  'kart-bros',
  'clelytraflight',
  'karate-bros',
  'clescaperoad',
  'nightclub-showdown-inzone-production',
];

const notes = [];
const rec = (name, status, detail) => {
  notes.push({ name, status, detail });
  console.log(`${status.padEnd(10)} ${name} — ${detail}`);
};

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});

async function openCtx(viewport, extras = {}) {
  const context = await browser.newContext({
    viewport,
    locale: 'en-US',
    ...extras,
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
    await route.continue();
  });
  return context;
}

const desktop = await openCtx({ width: 1280, height: 800 });
const page = await desktop.newPage();
const health = await page.goto(`${PREVIEW}/api/companion`, { waitUntil: 'domcontentloaded', timeout: 30000 });
rec('companion-health', health?.ok() ? 'PASS' : 'FAIL', `HTTP ${health?.status()} ${await health?.text()}`);

await page.goto(`${PREVIEW}/games`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(3500);
rec('hub', (await page.locator('.game-card').count()) > 0 ? 'PASS' : 'FAIL', `${await page.locator('.game-card').count()} cards`);

for (const id of GAMES) {
  await page.goto(`${PREVIEW}/games/${id}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(8000);
  const iframe = page.locator('.game-frame-body iframe');
  const src = (await iframe.count()) ? await iframe.getAttribute('src') : null;
  const companion = await page.locator('[data-testid=game-companion]').count();
  const state = companion ? await page.locator('[data-testid=game-companion]').getAttribute('data-companion-state') : null;
  rec(`open:${id}`, src && companion ? 'PASS' : 'FAIL', `src=${src} companion=${companion} state=${state}`);
  if (companion) {
    await page.locator('[data-testid=companion-ptt]').click();
    await page.waitForTimeout(2500);
    const after = await page.locator('[data-testid=game-companion]').getAttribute('data-companion-state');
    const caption = await page.locator('.companion-caption').count();
    rec(`speak:${id}`, ['thinking', 'speaking', 'idle'].includes(after || '') ? 'PASS' : 'UNVERIFIED', `state=${after} caption=${caption}`);
  }
}

const phone = await openCtx(
  { width: 390, height: 844 },
  {
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
);
const mobile = await phone.newPage();
await mobile.goto(`${PREVIEW}/games/kart-bros`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await mobile.waitForTimeout(6000);
const mobileCompanion = await mobile.locator('[data-testid=game-companion]').count();
const iframeBox = await mobile.locator('.game-frame-body iframe').boundingBox();
rec(
  'mobile-kart',
  mobileCompanion ? 'PASS' : 'FAIL',
  `companion=${mobileCompanion} iframe=${iframeBox ? `${Math.round(iframeBox.width)}x${Math.round(iframeBox.height)}` : 'none'}`,
);

await browser.close();
console.log(JSON.stringify({ host: HOST, notes }, null, 2));
process.exit(notes.some((n) => n.status === 'FAIL') ? 1 : 0);
