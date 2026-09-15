/**
 * Records the advertised first minute of Nightclub Showdown: arrival from the
 * paid-campaign link through actual gameplay. Used to capture comparable
 * before/after evidence for host-page changes.
 *
 *   node scripts/nightclub-journey.mjs <label> [outDir]
 *
 * Emulated viewports only — this is not a substitute for a real handset.
 */
import { createRequire } from 'node:module';
import { mkdirSync, renameSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const label = process.argv[2] || 'run';
const outDir = process.argv[3] || '/tmp/journey';
const BASE = process.env.JOURNEY_BASE || 'http://127.0.0.1:3000';
const GAME = 'nightclub-showdown-inzone-production';
const CAMPAIGN = `${BASE}/session-prototype?utm_source=gtm&utm_medium=cpc&utm_campaign=play-together-2026&game=${GAME}`;

const LAYOUTS = [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, extra: {} },
  { name: 'phone-portrait', viewport: { width: 390, height: 844 }, extra: { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { name: 'phone-landscape', viewport: { width: 844, height: 390 }, extra: { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
];

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE || '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});

const report = {};

for (const layout of LAYOUTS) {
  const videoDir = join(outDir, `${label}-${layout.name}-raw`);
  mkdirSync(videoDir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: layout.viewport,
    ...layout.extra,
    recordVideo: { dir: videoDir, size: layout.viewport },
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);

  const t0 = Date.now();
  const marks = {};
  await page.goto(CAMPAIGN, { waitUntil: 'domcontentloaded' });
  marks.landed = Date.now() - t0;

  // What the arriving player sees while the game is still coming down.
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(outDir, `${label}-${layout.name}-01-loading.png`) });

  await page.waitForSelector('iframe');
  let f = page.frames().find((x) => x.url().includes('/gcs/'));
  while (!f) { await page.waitForTimeout(200); f = page.frames().find((x) => x.url().includes('/gcs/')); }
  await f.waitForFunction(() => !!window.__NightclubRuntime).catch(() => {});
  marks.runtimeReady = Date.now() - t0;

  const box = await f.evaluate(() => {
    const c = document.getElementById('webgl').getBoundingClientRect();
    return { x: c.x, y: c.y, w: c.width, h: c.height, vw: window.innerWidth, vh: window.innerHeight };
  });
  report[layout.name] = { ...marks, canvas: box };

  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(outDir, `${label}-${layout.name}-02-start-gate.png`) });

  // The game gates itself behind its own "Click anywhere to start".
  const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const tap = async (x, y) => {
    if (layout.extra.hasTouch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
  };
  let started = false;
  for (let i = 0; i < 15 && !started; i++) {
    await tap(centre.x, centre.y);
    await page.waitForTimeout(1000);
    started = await f.evaluate(() => !!window.__NightclubRuntime?.Game?.ME?.hero).catch(() => false);
  }
  report[layout.name].playableAt = Date.now() - t0;
  report[layout.name].started = started;

  await page.waitForTimeout(800);
  await page.screenshot({ path: join(outDir, `${label}-${layout.name}-03-playing.png`) });

  // Ordinary play: tap around the floor, which is the one control that works.
  const floorY = box.y + box.h * 0.82;
  for (const frac of [0.7, 0.25, 0.85, 0.4, 0.6]) {
    await tap(box.x + box.w * frac, floorY);
    await page.waitForTimeout(2200);
  }
  await page.screenshot({ path: join(outDir, `${label}-${layout.name}-04-after-play.png`) });

  report[layout.name].endState = await f.evaluate(() => {
    const g = window.__NightclubRuntime?.Game?.ME;
    const m = window.__NightclubRuntime?.Main?.ME;
    return g ? { heroLife: g.hero?.life ?? null, ammo: g.hero?.ammo ?? null, paused: !!m?.paused } : null;
  }).catch(() => null);

  // Is the game's own HUD (top-right Mute/Restart) actually clickable, or is
  // host chrome sitting on top of it?
  report[layout.name].gameHudCovered = await page.evaluate(() => {
    const fr = document.querySelector('iframe');
    if (!fr) return null;
    const doc = fr.contentDocument;
    const ui = doc?.querySelector('.top-ui');
    if (!ui) return null;
    const fb = fr.getBoundingClientRect();
    const out = [];
    for (const btn of ui.querySelectorAll('button')) {
      const b = btn.getBoundingClientRect();
      const px = fb.x + b.x + b.width / 2;
      const py = fb.y + b.y + b.height / 2;
      const hit = document.elementFromPoint(px, py);
      out.push({
        button: btn.textContent.trim(),
        topElement: hit ? (hit.className || hit.tagName).toString().slice(0, 60) : null,
        reachable: hit === fr,
      });
    }
    return out;
  }).catch(() => null);

  await page.close();
  await ctx.close();

  const files = readdirSync(videoDir).filter((n) => n.endsWith('.webm'));
  if (files[0]) renameSync(join(videoDir, files[0]), join(outDir, `${label}-${layout.name}.webm`));
}

await browser.close();
console.log(JSON.stringify(report, null, 2));
