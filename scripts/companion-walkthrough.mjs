#!/usr/bin/env node
/** Headed walkthrough: measure time to first speech and exercise controls. */
import { chromium } from 'playwright-core';

const PREVIEW = process.env.PREVIEW_URL;
const SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const HOST = new URL(PREVIEW).host;
const OUT = process.env.VERIFY_OUT || '/opt/cursor/artifacts/walkthrough';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/google-chrome',
  headless: false,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-speech-dispatcher',
    '--window-size=1280,800',
    '--window-position=40,40',
  ],
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
await page.goto(`${PREVIEW}/games/kart-bros`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForSelector('[data-testid=game-companion]', { timeout: 20000 });
await page.waitForTimeout(4000);

const clickAt = Date.now();
await page.locator('[data-testid=companion-ptt]').click();
let speakingAt = null;
for (let i = 0; i < 40; i += 1) {
  const state = await page.locator('[data-testid=game-companion]').getAttribute('data-companion-state');
  const speaking = await page.evaluate(() => window.speechSynthesis?.speaking === true);
  if ((state === 'speaking' || speaking) && !speakingAt) speakingAt = Date.now();
  if (speakingAt) break;
  await page.waitForTimeout(150);
}
const latencyMs = speakingAt ? speakingAt - clickAt : null;
const caption = ((await page.locator('.companion-caption').textContent().catch(() => '')) || '').trim();
const provider = await page.locator('[data-testid=game-companion]').getAttribute('data-companion-provider');
const attrLatency = await page.locator('[data-testid=game-companion]').getAttribute('data-speech-latency-ms');
await page.screenshot({ path: `${OUT}/companion_kart_first_speech.png` });
console.log(JSON.stringify({ event: 'first-speech', latencyMs, attrLatency, provider, caption, speakingAt, clickAt }, null, 2));

await page.waitForTimeout(4000);
await page.locator('[data-testid=companion-mute]').click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/companion_kart_muted.png` });
await page.locator('[data-testid=companion-mute]').click();
await page.locator('[data-testid=companion-stop]').click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/companion_kart_stopped.png` });

await page.goto(`${PREVIEW}/games/clelytraflight`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(5000);
const switched = {
  game: await page.locator('[data-testid=game-companion]').getAttribute('data-game'),
  state: await page.locator('[data-testid=game-companion]').getAttribute('data-companion-state'),
  iframe: await page.locator('.game-frame-body iframe').count(),
};
await page.screenshot({ path: `${OUT}/companion_elytra_after_switch.png` });
console.log(JSON.stringify({ event: 'switch', ...switched, latencyMs }, null, 2));
await page.waitForTimeout(1500);
await browser.close();
