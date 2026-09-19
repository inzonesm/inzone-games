#!/usr/bin/env node
/**
 * Ordinary-play probe. Menus are not a completed journey.
 * Reaching Ready / lobby / takeoff-unconfirmed is journey_incomplete, not by
 * itself a product defect. Assign product_defect only after the correct start
 * control is used and the build errors or refuses that start. Canvas-hash
 * failures are automation_failure. Emulated viewports only.
 */
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PREVIEW = process.env.PREVIEW_URL;
const SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const OUT = process.env.OUT_DIR || 'scripts/.hexclave-out/flagship-play';
if (!PREVIEW || !SECRET) throw new Error('PREVIEW_URL and VERCEL_AUTOMATION_BYPASS_SECRET required');
const HOST = new URL(PREVIEW).host;
const CHROMIUM = process.env.CHROMIUM || '/usr/bin/google-chrome';

const TITLES = [
  { id: 'kart-bros', kind: 'race', keys: ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'KeyW'] },
  { id: 'clelytraflight', kind: 'flight', keys: ['Space', 'KeyW', 'ArrowUp'] },
  { id: 'karate-bros', kind: 'bout', keys: ['KeyA', 'KeyD', 'KeyJ', 'KeyK', 'Space'] },
  { id: 'clescaperoad', kind: 'drive', keys: ['ArrowLeft', 'ArrowRight', 'ArrowUp'] },
  { id: 'nightclub-showdown-inzone-production', kind: 'club', keys: [] },
];

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

async function ctxFor(view) {
  const context = await browser.newContext(view);
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

async function snapshot(frame) {
  return await frame.evaluate(() => {
    const canvas = document.querySelector('canvas');
    let hash = 0;
    let pixels = 0;
    if (canvas) {
      try {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          const { data } = ctx.getImageData(0, 0, Math.min(canvas.width, 64), Math.min(canvas.height, 64));
          pixels = data.length;
          for (let i = 0; i < data.length; i += 16) hash = (hash * 33 + data[i]) >>> 0;
        } else {
          hash = canvas.width * 1000 + canvas.height;
        }
      } catch {
        hash = canvas.width * 1000 + canvas.height;
      }
    }
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 240);
    return {
      href: location.href,
      canvas: canvas ? { w: canvas.width, h: canvas.height, hash, pixels } : null,
      text,
    };
  });
}

async function probe(title, viewName, view) {
  const context = await ctxFor(view);
  const page = await context.newPage();
  await page.goto(`${PREVIEW}/games/${title.id}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(9000);
  const frameEl = page.frameLocator('.game-frame-body iframe');
  const iframe = page.locator('.game-frame-body iframe');
  const handle = await iframe.elementHandle();
  const frame = await handle?.contentFrame();
  const before = frame ? await snapshot(frame) : { error: 'no-frame' };
  if (frame) {
    const box = await iframe.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(400);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.72);
    }
    for (const key of title.keys) {
      await page.keyboard.down(key);
      await page.waitForTimeout(180);
      await page.keyboard.up(key);
    }
    if (title.id === 'nightclub-showdown-inzone-production' && box) {
      await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.55);
      await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.42);
    }
    await page.waitForTimeout(2500);
  }
  const after = frame ? await snapshot(frame) : { error: 'no-frame' };
  const shot = path.join(OUT, `${title.id}-${viewName}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  const changed = JSON.stringify(before.canvas) !== JSON.stringify(after.canvas) || before.text !== after.text;
  const playable = Boolean(after.canvas) && changed;
  const result = {
    id: title.id,
    kind: title.kind,
    view: viewName,
    playable,
    changed,
    before,
    after,
    shot,
    evidence: viewName.includes('iphone') ? 'emulated iPhone UA/viewport — not a physical device' : 'emulated desktop Chromium — not a physical device',
  };
  await context.close();
  console.log(
    `${playable ? 'PASS' : 'FAIL'} ${title.id} ${viewName} canvas=${after.canvas ? `${after.canvas.w}x${after.canvas.h}` : 'none'} changed=${changed}`,
  );
  return result;
}

const views = [
  ['desktop', { viewport: { width: 1280, height: 800 } }],
  [
    'iphone-portrait',
    {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    },
  ],
];

const results = [];
for (const title of TITLES) {
  for (const [name, view] of views) {
    try {
      results.push(await probe(title, name, view));
    } catch (err) {
      results.push({ id: title.id, view: name, playable: false, error: String(err) });
      console.log(`FAIL ${title.id} ${name} ${err}`);
    }
  }
}
await writeFile(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
await browser.close();
const failed = results.filter((r) => !r.playable);
console.log(`playable=${results.length - failed.length}/${results.length}`);
process.exit(0);
