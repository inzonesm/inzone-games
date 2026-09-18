/**
 * Network evidence for optional tracking consent.
 * BASE_URL / PREVIEW_URL required. Host-only Vercel bypass when SECRET is set.
 *
 * Checks automatic SDK batches, Meta pixel + noscript, and Vercel insights
 * across fresh visit, reject, selective accept, reload, and withdraw.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const BASE = process.env.PREVIEW_URL || process.env.BASE_URL;
const SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const OUT = process.env.OUT_DIR || '/tmp/consent-verify';
const CHROME = process.env.CHROMIUM_EXECUTABLE || '/usr/local/bin/google-chrome';
if (!BASE) throw new Error('PREVIEW_URL or BASE_URL required');
mkdirSync(OUT, { recursive: true });
const HOST = new URL(BASE).host;

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

async function makeCtx() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  if (SECRET) {
    await ctx.route('**', async (route, request) => {
      if (new URL(request.url()).host === HOST) {
        await route.continue({
          headers: {
            ...request.headers(),
            'x-vercel-protection-bypass': SECRET,
            'x-vercel-set-bypass-cookie': 'samesitenone',
          },
        });
      } else await route.continue();
    });
  }
  const page = await ctx.newPage();
  const net = { hexclave: 0, meta: 0, noscript: 0, vercel: 0, inzone: [] };
  await page.route(/r\.hexclave\.com\/api\/v1\/analytics\/events\/batch/, async (route) => {
    net.hexclave += 1;
    try {
      const buf = route.request().postDataBuffer();
      if (buf) {
        let text; try { text = gunzipSync(buf).toString('utf8'); } catch { text = buf.toString('utf8'); }
        const body = JSON.parse(text);
        for (const event of body.events || []) {
          const data = event.data || {};
          if (data.inzone_event) net.inzone.push(data.inzone_event);
        }
      }
    } catch { /* ignore decode */ }
    await route.continue();
  });
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('connect.facebook.net/en_US/fbevents.js') || /facebook\.com\/tr\?/.test(url)) net.meta += 1;
    if (url.includes('facebook.com/tr') && url.includes('noscript=1')) net.noscript += 1;
    if (url.includes('/_vercel/insights') || url.includes('va.vercel-scripts.com')) net.vercel += 1;
  });
  return { ctx, page, net };
}

function assert(cond, msg, failures) {
  if (!cond) failures.push(msg);
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
}

const failures = [];
const GAME = `${BASE}/games/nightclub-showdown-inzone-production`;

// Fresh visit: no optional tracking
{
  const { ctx, page, net } = await makeCtx();
  await page.goto(GAME, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  assert(await page.locator('[data-testid="consent-banner"]').isVisible(), 'fresh visit shows banner', failures);
  assert(net.hexclave === 0, `fresh visit Hexclave batches=0 (got ${net.hexclave})`, failures);
  assert(net.meta === 0, `fresh visit Meta pixel/tr=0 (got ${net.meta})`, failures);
  assert(net.vercel === 0, `fresh visit Vercel insights=0 (got ${net.vercel})`, failures);
  assert(await page.locator('[data-testid="player-chat"]').count() > 0, 'Chat still present without consent', failures);
  await page.screenshot({ path: `${OUT}/01-fresh-reject-ready.png` });
  await page.locator('[data-testid="consent-reject"]').click();
  await page.waitForTimeout(2500);
  assert(net.hexclave === 0 && net.meta === 0 && net.vercel === 0, 'reject keeps optional tracking off', failures);
  await ctx.close();
}

// Selective analytics only, then reload, then withdraw
{
  const { ctx, page, net } = await makeCtx();
  await page.goto(GAME, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.locator('[data-testid="consent-preferences"]').click();
  await page.locator('[data-testid="consent-opt-analytics"]').check();
  await page.locator('[data-testid="consent-save"]').click();
  await page.waitForTimeout(4000);
  assert(net.hexclave > 0, 'analytics grant emits Hexclave batches', failures);
  assert(net.meta === 0, `analytics-only does not load Meta (got ${net.meta})`, failures);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const afterReloadMeta = net.meta;
  assert(await page.locator('[data-testid="consent-banner"]').count() === 0, 'reload preserves choice, no banner', failures);
  assert(afterReloadMeta === 0, 'reload of analytics-only still has no Meta', failures);
  await page.locator('[data-testid="consent-privacy"]').click();
  await page.locator('[data-testid="consent-withdraw"]').click();
  await page.waitForTimeout(2500);
  const hexAfterWithdraw = net.hexclave;
  await page.waitForTimeout(3000);
  assert(net.hexclave === hexAfterWithdraw, 'withdraw stops further Hexclave batches', failures);
  await page.screenshot({ path: `${OUT}/02-after-withdraw.png` });
  await ctx.close();
}

// Advertising grant: pixel + noscript in DOM
{
  const { ctx, page, net } = await makeCtx();
  await page.goto(GAME, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.locator('[data-testid="consent-preferences"]').click();
  await page.locator('[data-testid="consent-opt-advertising"]').check();
  await page.locator('[data-testid="consent-save"]').click();
  await page.waitForTimeout(4000);
  const noscript = await page.locator('noscript img[src*="facebook.com/tr"]').count();
  assert(net.meta > 0 || noscript > 0, 'advertising grant loads Meta pixel or noscript', failures);
  await ctx.close();
}

writeFileSync(`${OUT}/report.txt`, failures.length ? `FAIL\n${failures.join('\n')}` : 'PASS');
await browser.close();
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`PASS artifacts in ${OUT}`);
