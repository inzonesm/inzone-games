/**
 * Measure the advertised game in the three layouts we ship, and judge what the
 * player can actually see and reach in each.
 *
 * Separates two different things that both look like "the game is small":
 *   - host sizing: how many CSS pixels we hand the iframe;
 *   - game rendering: the integer zoom the engine picks for that box, which is
 *     internal to the build and not something the host can set.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const OUT = process.env.OUT_DIR || '/tmp/layouts';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const GAME = 'nightclub-showdown-inzone-production';
const lines = [];
const say = (s) => { console.log(s); lines.push(s); };

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE || '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});

const LAYOUTS = [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false },
  { name: 'phone-portrait', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  { name: 'phone-landscape', viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true },
];

for (const L of LAYOUTS) {
  const ctx = await browser.newContext({
    viewport: L.viewport, hasTouch: L.hasTouch, isMobile: L.isMobile, deviceScaleFactor: L.isMobile ? 3 : 1,
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(90000);
  await page.goto(`${BASE}/games/${GAME}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('iframe');
  let f = page.frames().find((x) => x.url().includes('/gcs/'));
  while (!f) { await page.waitForTimeout(200); f = page.frames().find((x) => x.url().includes('/gcs/')); }
  await f.waitForFunction(() => !!window.__NightclubRuntime);

  const box = await f.evaluate(() => { const c = document.getElementById('webgl').getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });
  // Start the run the way a player does.
  for (let i = 0; i < 15; i++) {
    if (await f.evaluate(() => !!window.__NightclubRuntime?.Game?.ME?.hero).catch(() => false)) break;
    if (L.hasTouch) await page.touchscreen.tap(box.x + box.w / 2, box.y + box.h / 2);
    else await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
    await page.waitForTimeout(1000);
  }

  const m = await f.evaluate(() => {
    const c = document.getElementById('webgl');
    const r = c.getBoundingClientRect();
    const rt = window.__NightclubRuntime, g = rt.Game?.ME;
    // The engine's own scale factor, wherever it keeps it.
    const scaleCandidates = {};
    for (const k of ['SCALE', 'UI_SCALE', 'AUTO_SCALE_TARGET_WID']) if (rt.Const && k in rt.Const) scaleCandidates[k] = rt.Const[k];
    const sc = g?.scroller;
    return {
      cssCanvas: { w: Math.round(r.width), h: Math.round(r.height) },
      backingCanvas: { w: c.width, h: c.height },
      dpr: window.devicePixelRatio,
      scrollerZoom: sc ? { x: sc.scaleX, y: sc.scaleY } : null,
      constScale: scaleCandidates,
      levelWid: g?.level?.wid, levelHei: g?.level?.hei,
    };
  });
  // World area actually on screen, in game pixels and level cells.
  const world = await f.evaluate(() => {
    const g = window.__NightclubRuntime.Game.ME, sc = g.scroller;
    const c = document.getElementById('webgl');
    const zx = sc.scaleX || 1, zy = sc.scaleY || 1;
    return { visibleWorldW: Math.round(c.width / zx), visibleWorldH: Math.round(c.height / zy), gridCellsWide: +(c.width / zx / 16).toFixed(1) };
  });

  // Is any host control sitting on top of the game's own controls?
  const overlaps = await page.evaluate(() => {
    const frame = document.querySelector('iframe');
    const fr = frame.getBoundingClientRect();
    const hostBits = [...document.querySelectorAll('.player-actions, .player-invite-btn, .player-invite-copy, .engagement-rail, .player-sp-bar, .game-hint, [aria-label="Install InZone"]')]
      .map((el) => ({ cls: el.className || el.getAttribute('aria-label'), r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.height > 0);
    return { frame: { x: fr.x, y: fr.y, w: fr.width, h: fr.height }, hostBits: hostBits.map((h) => ({ cls: String(h.cls).slice(0, 40), x: Math.round(h.r.x), y: Math.round(h.r.y), w: Math.round(h.r.width), h: Math.round(h.r.height) })) };
  });
  // The game's own HUD buttons, in host coordinates.
  const gameHud = await f.evaluate(() => {
    const out = {};
    for (const id of ['muteBtn', 'restartBtn', 'resultsCard']) {
      const el = document.getElementById(id);
      if (el) { const r = el.getBoundingClientRect(); out[id] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }
    }
    return out;
  });

  // Can the player actually hit the game's Mute button here?
  let muteReachable = 'n/a';
  try {
    const before = await f.evaluate(() => document.getElementById('muteBtn')?.textContent);
    await f.locator('#muteBtn').click({ timeout: 5000 });
    await page.waitForTimeout(400);
    const after = await f.evaluate(() => document.getElementById('muteBtn')?.textContent);
    muteReachable = before !== after ? `yes (${before} -> ${after})` : `no visible change (${before})`;
  } catch (e) { muteReachable = `blocked: ${e.message.split('\n')[0].slice(0, 70)}`; }

  // Touch: does a tap actually drive the game?
  let touchVerdict = 'not applicable (no touch)';
  if (L.hasTouch) {
    const a = await f.evaluate(() => { const h = window.__NightclubRuntime.Game.ME.hero; return +(h.cx + h.xr).toFixed(2); });
    await page.touchscreen.tap(box.x + box.w * 0.7, box.y + box.h * 0.6);
    await page.waitForTimeout(1800);
    const b = await f.evaluate(() => { const h = window.__NightclubRuntime.Game.ME.hero; return +(h.cx + h.xr).toFixed(2); });
    touchVerdict = a !== b ? `tap moved the hero ${a} -> ${b}` : `tap produced no movement (${a})`;
  }

  const installBanner = await page.evaluate(() => !!document.querySelector('[aria-label="Install InZone"]'));

  say(`\n## ${L.name} (${L.viewport.width}x${L.viewport.height}${L.hasTouch ? ', touch' : ''})`);
  say(`  host gives the canvas   : ${m.cssCanvas.w}x${m.cssCanvas.h} CSS px (iframe ${Math.round(overlaps.frame.w)}x${Math.round(overlaps.frame.h)})`);
  say(`  engine backing buffer   : ${m.backingCanvas.w}x${m.backingCanvas.h} px at dpr ${m.dpr}`);
  say(`  engine integer zoom     : ${JSON.stringify(m.scrollerZoom)}`);
  say(`  world visible           : ${world.visibleWorldW}x${world.visibleWorldH} game px = ${world.gridCellsWide} level cells wide (level is ${m.levelWid} wide)`);
  say(`  game's own Mute button  : ${muteReachable}`);
  say(`  touch                   : ${touchVerdict}`);
  say(`  install banner present  : ${installBanner}`);
  say(`  host chrome boxes       : ${JSON.stringify(overlaps.hostBits)}`);
  say(`  game HUD boxes          : ${JSON.stringify(gameHud)}`);

  await page.screenshot({ path: `${OUT}/${L.name}.png` });
  await ctx.close();
}
writeFileSync(`${OUT}/layouts.txt`, lines.join('\n'));
await browser.close();
console.log(`\nartifacts in ${OUT}`);
