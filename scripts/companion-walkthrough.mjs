#!/usr/bin/env node
/** Headed walkthrough on DISPLAY=:1 for an audible companion demo. */
import { chromium } from 'playwright-core';

const PREVIEW = process.env.PREVIEW_URL;
const SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const HOST = new URL(PREVIEW).host;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/google-chrome',
  headless: false,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,800'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
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
const page = await context.newPage();
await page.goto(`${PREVIEW}/games`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(3000);
await page.locator('[data-testid=flagship-row] .game-card').first().click();
await page.waitForTimeout(8000);
await page.locator('[data-testid=companion-ptt]').click();
await page.waitForTimeout(5000);
await page.screenshot({ path: '/opt/cursor/artifacts/walkthrough/companion_kart_intro.png' });
await page.waitForTimeout(2000);
await browser.close();
