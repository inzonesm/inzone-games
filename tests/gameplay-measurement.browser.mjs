/**
 * End-to-end check that verified gameplay events describe gameplay.
 *
 * Runs the real page against the real analytics transport, intercepting the
 * Hexclave batches on the way out so we can read exactly what would be
 * reported, and letting them continue to ingest so the same run also serves as
 * transport evidence.
 *
 * Ordinary mouse input only. Nothing here writes game state.
 *
 * Usage: BASE_URL=http://127.0.0.1:3000 node tests/gameplay-measurement.browser.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const GAME = 'nightclub-showdown-inzone-production';
const OUT = process.env.OUT_DIR || '/tmp/measurement';
const CHROME = process.env.CHROMIUM_EXECUTABLE || '/usr/local/bin/google-chrome';
/** Identifiable in a Hexclave query, and obviously not real traffic. */
const TEST_CAMPAIGN = process.env.TEST_CAMPAIGN || `launch_check_${Date.now()}`;
mkdirSync(OUT, { recursive: true });

const report = [];
const say = (s) => { console.log(s); report.push(s); };

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(90000);

/** Every InZone event we saw leave the browser, in order. */
const sent = [];
await page.route(/r\.hexclave\.com\/api\/v1\/analytics\/events\/batch/, async (route) => {
  const request = route.request();
  try {
    const buf = request.postDataBuffer();
    if (buf) {
      let text;
      try { text = gunzipSync(buf).toString('utf8'); } catch { text = buf.toString('utf8'); }
      const body = JSON.parse(text);
      for (const event of body.events || []) {
        const data = event.data || {};
        if (data.inzone_event) sent.push({ name: data.inzone_event, data, at: event.event_at_ms });
      }
    }
  } catch (err) {
    say(`  (could not decode a batch: ${err.message})`);
  }
  // Continue to real ingest so this run is also a receipt.
  await route.continue();
});

const seen = (name) => sent.filter((e) => e.name === name);
const namesSince = (i) => sent.slice(i).map((e) => e.name);

async function frame() {
  await page.waitForSelector('iframe');
  let f = page.frames().find((x) => x.url().includes('/gcs/'));
  while (!f) { await page.waitForTimeout(200); f = page.frames().find((x) => x.url().includes('/gcs/')); }
  await f.waitForFunction(() => !!window.__NightclubRuntime);
  return f;
}
const canvasBox = (f) => f.evaluate(() => { const c = document.getElementById('webgl').getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });

async function aim(f, box, wx, wy) {
  let css = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(css.x, css.y);
    await page.waitForTimeout(70);
    const m = await f.evaluate(() => { const p = window.__NightclubRuntime.Game.ME.getMouse(); return { x: p.x, y: p.y }; });
    const dx = wx - m.x, dy = wy - m.y;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) break;
    css = { x: Math.max(box.x + 4, Math.min(box.x + box.w - 4, css.x + dx * 4)),
            y: Math.max(box.y + 4, Math.min(box.y + box.h - 4, css.y + dy * 4)) };
  }
  return css;
}
const heroAlive = (f) => f.evaluate(() => { const h = window.__NightclubRuntime?.Game?.ME?.hero; return !!h && h.life > 0; });
const shootTarget = (f) => f.evaluate(() => {
  const m = (window.__NightclubRuntime.en_Mob.ALL || []).find((e) => !e.destroyed && e.life > 0 && e.canBeShot());
  return m ? { x: m.head.getX(), y: m.head.getY() } : null;
});
const heroPt = (f) => f.evaluate(() => { const h = window.__NightclubRuntime.Game.ME.hero; return { x: (h.cx + h.xr) * 16, y: (h.cy + h.yr) * 16 - h.radius }; });

/** Play with ordinary clicks for a while, replaying whenever the run ends. */
async function playFor(f, box, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!(await heroAlive(f))) {
      try { await f.locator('#replayBtn').click({ timeout: 3000 }); } catch { /* card not up yet */ }
      await page.waitForTimeout(2500);
      const b = await canvasBox(f);
      for (let i = 0; i < 6 && !(await heroAlive(f)); i++) {
        await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
        await page.waitForTimeout(800);
      }
      continue;
    }
    const t = (await shootTarget(f)) || (await heroPt(f).then((h) => ({ x: h.x + 64, y: h.y + 8 })));
    const css = await aim(f, box, t.x, t.y);
    await page.mouse.click(css.x, css.y);
    await page.waitForTimeout(450);
  }
}

// ── PHASE A — arrive from a campaign link and touch nothing ────────────────
say(`## Phase A — land, do not play (campaign ${TEST_CAMPAIGN})`);
await page.goto(`${BASE}/games/${GAME}?utm_source=facebook&utm_medium=cpc&utm_campaign=${TEST_CAMPAIGN}`, { waitUntil: 'domcontentloaded' });
let f = await frame();
let box = await canvasBox(f);
await page.waitForTimeout(15000);
const afterIdle = [...sent];
say(`  events: ${JSON.stringify([...new Set(afterIdle.map((e) => e.name))])}`);
assert.equal(seen('game_start').length, 0, 'loading and idling must not emit game_start');
assert.equal(seen('engaged_play').length, 0, 'idling must not emit engaged_play');
assert.ok(seen('game_frame_loaded').length >= 1, 'the frame-load proxy should be emitted, under its own name');
assert.ok(seen('game_ready').length >= 1, 'the build reported itself ready');
say('  PASS: no verified gameplay from loading or idling; proxy and ready present');

// ── PHASE B — actually play ───────────────────────────────────────────────
say('\n## Phase B — play with ordinary clicks');
const beforePlay = sent.length;
for (let i = 0; i < 8 && !(await heroAlive(f)); i++) { await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2); await page.waitForTimeout(900); }
// One real gameplay action: a click on the floor.
const hp = await heroPt(f);
let css = await aim(f, box, hp.x + 48, hp.y + 8);
await page.mouse.click(css.x, css.y);
await page.waitForTimeout(3000);
const starts = seen('game_start');
say(`  events since play began: ${JSON.stringify(namesSince(beforePlay))}`);
assert.ok(starts.length >= 1, 'a real gameplay action must emit game_start');
const s0 = starts[0].data;
say(`  game_start props: run_id=${s0.run_id} signal_source=${s0.signal_source} acquisition=${s0.acquisition} game_id=${s0.game_id}`);
assert.equal(s0.signal_source, 'same-origin-adapter');
assert.equal(s0.game_id, GAME);
assert.equal(s0.acquisition, 'direct', 'a paid click is a direct acquisition');
assert.match(String(s0.run_id), /^mount_[0-9a-f]{32}:run-\d+$/, 'run ids are scoped to the mount');
assert.equal(s0.utm_campaign, TEST_CAMPAIGN, 'campaign attribution rides along');
say('  PASS: verified game_start from the build, with attribution intact');

// ── PHASE C+D — keep playing across attempts until a minute of real play ──
say('\n## Phase C/D — play on across attempts (game over, then engagement)');
await playFor(f, box, 150000);
const overs = seen('first_game_over');
const engaged = seen('engaged_play');
const rounds = seen('game_start');
say(`  rounds (game_start): ${rounds.length}`);
say(`  first_game_over: ${overs.length} ${overs[0] ? `(outcome=${overs[0].data.outcome})` : ''}`);
say(`  engaged_play: ${engaged.length} ${engaged[0] ? `(active_seconds=${engaged[0].data.active_seconds})` : ''}`);
assert.ok(rounds.length >= 2, 'replaying should produce further rounds');
assert.equal(overs.length, 1, 'first_game_over is once per visit per game');
assert.equal(engaged.length, 1, 'engaged_play is once per visit');
assert.ok(engaged[0].data.active_seconds >= 60, `engaged_play needs 60s of active play, got ${engaged[0].data.active_seconds}`);
assert.equal(engaged[0].data.visit_id, s0.visit_id, 'the same visit throughout');
say('  PASS: one game over and one engaged_play, accumulated across attempts');

// ── PHASE E — hidden tab must not advance engagement ─────────────────────
say('\n## Phase E — background the tab');
const other = await ctx.newPage();
await other.goto(`${BASE}/games`, { waitUntil: 'domcontentloaded' });
await other.bringToFront();
const beforeHidden = sent.length;
await new Promise((r) => setTimeout(r, 20000));
await other.close();
say(`  events while hidden: ${JSON.stringify(namesSince(beforeHidden))}`);
assert.equal(sent.slice(beforeHidden).filter((e) => e.name === 'engaged_play').length, 0, 'a hidden tab must not emit engagement');
assert.equal(sent.slice(beforeHidden).filter((e) => e.name === 'game_start').length, 0, 'a hidden tab must not emit starts');
say('  PASS: nothing verified while hidden');

// ── PHASE F — refresh and idle ───────────────────────────────────────────
say('\n## Phase F — refresh, then idle');
const beforeReload = sent.length;
await page.reload({ waitUntil: 'domcontentloaded' });
f = await frame();
await page.waitForTimeout(15000);
say(`  events after an idle refresh: ${JSON.stringify(namesSince(beforeReload))}`);
assert.equal(sent.slice(beforeReload).filter((e) => e.name === 'game_start').length, 0, 'an idle refresh must not emit game_start');
assert.equal(sent.slice(beforeReload).filter((e) => e.name === 'engaged_play').length, 0, 'an idle refresh must not re-emit engaged_play');
say('  PASS: an idle refresh emits nothing verified');

// ── Receipt ──────────────────────────────────────────────────────────────
const summary = {};
for (const e of sent) summary[e.name] = (summary[e.name] || 0) + 1;
say(`\n## Events observed leaving the browser\n${JSON.stringify(summary, null, 2)}`);
say(`\nTest campaign for a Hexclave query: utm_campaign=${TEST_CAMPAIGN}`);
writeFileSync(`${OUT}/measurement-report.txt`, report.join('\n'));
writeFileSync(`${OUT}/measurement-events.json`, JSON.stringify({ testCampaign: TEST_CAMPAIGN, events: sent }, null, 2));
await page.screenshot({ path: `${OUT}/measurement-final.png` });
await ctx.close();
await browser.close();
console.log(`\nALL MEASUREMENT CHECKS PASSED — artifacts in ${OUT}`);
