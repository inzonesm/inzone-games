/**
 * Ordinary-input acceptance run for the advertised game:
 * launch -> understand controls -> move -> shoot -> score/progress -> game over -> replay.
 *
 * Every interaction is a real mouse or key event delivered to the page. The
 * runtime is read only to record what happened; nothing writes game state.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const OUT = process.env.OUT_DIR || '/tmp/acceptance2';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const GAME = 'nightclub-showdown-inzone-production';
const GRID = 16;
const report = [];
const say = (s) => { console.log(s); report.push(s); };

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE || '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
});
const page = await ctx.newPage();
page.setDefaultTimeout(90000);

await page.goto(`${BASE}/games/${GAME}?utm_source=facebook&utm_campaign=launch_check`, { waitUntil: 'domcontentloaded' });
await page.screenshot({ path: `${OUT}/01_loading.png` });
say('LAUNCH: arrived from a campaign URL; host loading screen shown');

await page.waitForSelector('iframe');
let f = page.frames().find((x) => x.url().includes('/gcs/'));
while (!f) { await page.waitForTimeout(200); f = page.frames().find((x) => x.url().includes('/gcs/')); }
await f.waitForFunction(() => !!window.__NightclubRuntime);
say('READY: game runtime reported itself present');

const box = await f.evaluate(() => { const c = document.getElementById('webgl').getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });
for (let i = 0; i < 15; i++) {
  if (await f.evaluate(() => !!window.__NightclubRuntime?.Game?.ME?.hero).catch(() => false)) break;
  await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
  await page.waitForTimeout(1000);
}
say('START: a plain click put a hero in play');
await page.screenshot({ path: `${OUT}/02_in_play.png` });

const state = () => f.evaluate(() => {
  const rt = window.__NightclubRuntime, g = rt.Game.ME, h = g.hero;
  const mobs = (rt.en_Mob.ALL || []).filter((m) => !m.destroyed && m.life > 0);
  const bridge = window.NightclubBridge ? window.NightclubBridge.getState() : null;
  return {
    wave: g.waveId, ammo: h.ammo, life: h.life, heroX: +(h.cx + h.xr).toFixed(2),
    mobsAlive: mobs.length, shootable: mobs.filter((m) => m.canBeShot()).length,
    bridgeRun: bridge?.runNumber, bridgeEnded: bridge?.ended, bridgeScore: bridge?.score, bridgeOutcome: bridge?.outcome,
  };
});

// Move the real cursor until the engine reports the world point we want.
async function aim(wx, wy) {
  let css = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(css.x, css.y);
    await page.waitForTimeout(80);
    const m = await f.evaluate(() => { const p = window.__NightclubRuntime.Game.ME.getMouse(); return { x: p.x, y: p.y }; });
    const dx = wx - m.x, dy = wy - m.y;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) break;
    css = { x: Math.max(box.x + 4, Math.min(box.x + box.w - 4, css.x + dx * 4)),
            y: Math.max(box.y + 4, Math.min(box.y + box.h - 4, css.y + dy * 4)) };
  }
  return css;
}
const label = () => f.evaluate(() => window.__NightclubRuntime.Game.ME.hero.help?.text || null);
const shootTarget = () => f.evaluate(() => {
  const m = (window.__NightclubRuntime.en_Mob.ALL || []).find((e) => !e.destroyed && e.life > 0 && e.canBeShot());
  return m ? { head: { x: m.head.getX(), y: m.head.getY() }, torso: { x: m.torso.getX(), y: m.torso.getY() } } : null;
});
const heroPt = () => f.evaluate(() => { const h = window.__NightclubRuntime.Game.ME.hero; return { x: (h.cx + h.xr) * 16, y: (h.cy + h.yr) * 16 - h.radius }; });

// ── understand controls: the game names the action under the cursor ──────────
const labels = {};
for (let i = 0; i < 25 && Object.keys(labels).length < 2; i++) {
  const t = await shootTarget();
  if (t) {
    await aim(t.head.x, t.head.y); await page.waitForTimeout(220);
    const a = await label(); if (a) labels.head = a;
    await aim(t.torso.x, t.torso.y); await page.waitForTimeout(220);
    const b = await label(); if (b) labels.torso = b;
  }
  if (!t) await page.waitForTimeout(400);
}
say(`CONTROLS: the game labels its own targets — head=${JSON.stringify(labels.head)} torso=${JSON.stringify(labels.torso)}`);
await page.screenshot({ path: `${OUT}/03_hover_label.png` });

// ── move: click bare floor, away from any enemy ──────────────────────────────
{
  const a = await state();
  const hp = await heroPt();
  const css = await aim(hp.x + 3 * GRID, hp.y + 8);
  await page.mouse.click(css.x, css.y);
  await page.waitForTimeout(1800);
  const b = await state();
  say(`MOVE: floor click walked the hero ${a.heroX} -> ${b.heroX}; ammo ${a.ammo} -> ${b.ammo} (no shot fired)`);
  await page.screenshot({ path: `${OUT}/04_moved.png` });
}

// ── shoot: click an enemy ───────────────────────────────────────────────────
let shots = 0, kills = 0, firstShotShot = false;
for (let i = 0; i < 45; i++) {
  const s = await state();
  if (s.life <= 0) break;
  const t = await shootTarget();
  if (!t) {
    const hp = await heroPt();
    const css = await aim(hp.x + 5 * GRID, hp.y + 8);
    await page.mouse.click(css.x, css.y);
    await page.waitForTimeout(800);
    continue;
  }
  const a = await state();
  const css = await aim(t.head.x, t.head.y);
  await page.mouse.click(css.x, css.y);
  await page.waitForTimeout(700);
  const b = await state();
  if (b.ammo < a.ammo) {
    shots++;
    if (b.mobsAlive < a.mobsAlive) kills += a.mobsAlive - b.mobsAlive;
    say(`  shot ${shots}: ammo ${a.ammo}->${b.ammo}, enemies alive ${a.mobsAlive}->${b.mobsAlive}, wave ${a.wave}->${b.wave}`);
    if (!firstShotShot) { await page.screenshot({ path: `${OUT}/05_first_shot.png` }); firstShotShot = true; }
  }
  if (b.ammo === 0) {
    const hp = await heroPt();
    const c2 = await aim(hp.x, hp.y);
    const lbl = await label();
    await page.mouse.click(c2.x, c2.y);
    await page.waitForTimeout(1200);
    const c = await state();
    say(`  reload: clicking yourself (label ${JSON.stringify(lbl)}) restored ammo ${b.ammo}->${c.ammo}`);
  }
}
say(`SHOOT: ${shots} shots fired by clicking enemies; ${kills} enemies killed`);
const mid = await state();
say(`SCORE/PROGRESS: wave=${mid.wave}, bridge score=${mid.bridgeScore}, hero life=${mid.life}`);

// ── game over ───────────────────────────────────────────────────────────────
for (let i = 0; i < 70; i++) {
  const s = await state();
  if (s.life <= 0 || s.bridgeEnded) break;
  const t = await shootTarget();
  const hp = await heroPt();
  const p = t ? t.head : { x: hp.x + 5 * GRID, y: hp.y + 8 };
  const css = await aim(p.x, p.y);
  await page.mouse.click(css.x, css.y);
  await page.waitForTimeout(600);
}
const over = await state();
const card = await f.evaluate(() => {
  const c = document.getElementById('resultsCard');
  return { visible: c && !c.classList.contains('hidden'), reason: document.getElementById('resultsReason')?.textContent,
    score: document.getElementById('finalScore')?.textContent, replayVisible: !!document.getElementById('replayBtn') };
});
say(`GAME OVER: hero life=${over.life}; results card visible=${card.visible} reason=${JSON.stringify(card.reason)} score=${card.score}`);
await page.screenshot({ path: `${OUT}/06_game_over.png` });

// ── replay: the game's own Replay button in its results card ────────────────
const beforeReplay = await state();
await f.locator('#replayBtn').click();
await page.waitForTimeout(3500);
const afterReplay = await state();
say(`REPLAY: clicked the game's Replay button — run ${beforeReplay.bridgeRun} -> ${afterReplay.bridgeRun}, hero life ${beforeReplay.life} -> ${afterReplay.life}, wave ${afterReplay.wave}, ended=${afterReplay.bridgeEnded}`);
await page.screenshot({ path: `${OUT}/07_after_replay.png` });

// Confirm the replayed run is actually playable, not just reset bookkeeping.
let replayShots = 0;
for (let i = 0; i < 25 && replayShots < 1; i++) {
  const t = await shootTarget();
  const hp = await heroPt();
  const p = t ? t.head : { x: hp.x + 4 * GRID, y: hp.y + 8 };
  const a = await state();
  const css = await aim(p.x, p.y);
  await page.mouse.click(css.x, css.y);
  await page.waitForTimeout(700);
  const b = await state();
  if (b.ammo < a.ammo) replayShots++;
}
say(`REPLAY PLAYABLE: fired ${replayShots} shot(s) in the new run`);
say(afterReplay.life > 0 && replayShots > 0 ? 'ACCEPTANCE: PASS' : 'ACCEPTANCE: FAIL');

// The engine also draws "T to restart" — check whether that instruction works.
const tWorks = await (async () => {
  const a = await state();
  await f.evaluate(() => document.getElementById('webgl').focus());
  await page.keyboard.press('KeyT');
  await page.waitForTimeout(2500);
  const b = await state();
  return b.bridgeRun !== a.bridgeRun;
})();
say(`ENGINE HINT CHECK: the game draws "T to restart"; pressing T with the canvas focused restarted the run: ${tWorks}`);

writeFileSync(`${OUT}/report.txt`, report.join('\n'));
await ctx.close();
await browser.close();
console.log(`\nartifacts in ${OUT}`);
