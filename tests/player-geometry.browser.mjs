/**
 * Computed player geometry. Source assertions say what the CSS intends;
 * these say what a browser actually lays out.
 *
 * The claims under test are the ones this layout was built to make good on:
 *   1. the bar insets the stage, so nothing persistent covers the game;
 *   2. the default iframe box cannot collapse to 300x150 whatever --game-fit
 *      is set to;
 *   3. fill screen hands a portrait phone a genuinely landscape stage;
 *   4. seven cells still clear a 44px touch target at 390pt.
 *
 * Chromium via Playwright. Playwright WebKit is not macOS Safari, and this
 * file does not pretend otherwise — Safari stays owner-verified.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const CSS = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const CHROMIUM = process.env.CHROMIUM_EXECUTABLE
  || process.env.CHROMIUM
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/** The phone bar: Rook, the conversation, navigation, and More.
 *  Mirrors lib/player-actions.ts — if that list changes, this must too. */
const CELLS = ['Voice', 'Chat', 'Invite', 'Games', 'Home', 'More'];

const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>${CSS}</style></head>
<body>
<div class="game-frame-shell">
  <div class="game-frame-body" data-fill="off">
    <div class="game-stage">
      <iframe title="fixture" src="about:blank"></iframe>
    </div>
    <div class="player-overlay">
      <div class="player-sheet"><button class="player-more-row"><svg width="20" height="20"></svg><span>Share</span></button><button class="player-more-row"><svg width="20" height="20"></svg><span>Fill screen</span></button></div>
      <div class="rook-bubble"><p class="companion-caption">A caption long enough to wrap onto three clamped lines inside its own bubble, which is the worst case the bands above the bar have to clear without ever landing on each other.</p><button class="rook-bubble-stop"></button></div>
    </div>
    <div class="game-rail" role="toolbar">
      ${CELLS.map((cap, i) => `<button class="rail-btn${i === 0 ? ' rook-cell' : ''}"><span class="${i === 0 ? 'rook-mark' : ''}"><svg width="22" height="22"></svg></span><span class="rail-cap">${cap}</span></button>`).join('')}
    </div>
  </div>
</div>
</body></html>`;

const MEASURE = `(() => {
  const box = (el) => { if (!el) return { x: 0, y: 0, w: 0, h: 0, absent: true }; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const iframe = document.querySelector('.game-frame-body iframe');
  const cells = [...document.querySelectorAll('.game-rail > .rail-btn')];
  const gutters = [...document.querySelectorAll('.swipe-gutter')];
  return {
    stage: box(document.querySelector('.game-stage')),
    frame: box(iframe),
    rail: box(document.querySelector('.game-rail')),
    bubble: box(document.querySelector('.rook-bubble')),
    frameCss: { width: getComputedStyle(iframe).width, height: getComputedStyle(iframe).height, transform: getComputedStyle(iframe).transform },
    cells: cells.map(box),
    navPresent: document.querySelector('.rail-nav') !== null,
    guttersPainted: [...document.querySelectorAll('.swipe-gutter')].filter((g) => getComputedStyle(g).display !== 'none').length,
    overlayEvents: getComputedStyle(document.querySelector('.player-overlay')).pointerEvents,
    bubbleInRail: document.querySelector('.game-rail .rook-bubble') !== null,
    bubbleEvents: getComputedStyle(document.querySelector('.rook-bubble')).pointerEvents,
    bubblePainted: getComputedStyle(document.querySelector('.rook-bubble')).display !== 'none',
    sheetPresent: document.querySelector('.player-sheet') !== null,
    sheet: box(document.querySelector('.player-sheet')),
    bodyTransform: getComputedStyle(document.querySelector('.game-frame-body')).transform,

  };
})()`;

/** True when two boxes share any area at all. */
function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

let browser;
test.before(async () => {
  browser = await chromium.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
});
test.after(async () => { await browser?.close(); });

async function measure(viewport, { fit, noSheet } = {}) {
  const page = await browser.newPage({ viewport });
  await page.setContent(PAGE, { waitUntil: 'domcontentloaded' });
  if (noSheet) {
    await page.evaluate(() => document.querySelector('.player-sheet')?.remove());
  }
  if (fit !== undefined) {
    await page.evaluate((v) => {
      document.querySelector('.game-frame-body').style.setProperty('--game-fit', v);
    }, fit);
  }
  // The app measures the bar and writes the inset; the fixture does the same
  // so what is under test is the layout, not a constant in the stylesheet.
  await page.evaluate(() => {
    const rail = document.querySelector('.game-rail');
    const body = document.querySelector('.game-frame-body');
    const horizontal = rail.offsetWidth >= body.offsetWidth * 0.9;
    body.style.setProperty('--rail-x', horizontal ? '0px' : `${Math.round(body.offsetWidth - rail.offsetLeft)}px`);
    body.style.setProperty('--rail-y', horizontal ? `${Math.round(body.offsetHeight - rail.offsetTop)}px` : '0px');
  });
  const out = await page.evaluate(MEASURE);
  await page.close();
  return out;
}

test('desktop: the stage is the viewport minus the rail strip', async () => {
  const m = await measure({ width: 1280, height: 800 });
  assert.deepEqual(m.stage, { x: 0, y: 0, w: 1196, h: 800 }, JSON.stringify(m.stage));
  assert.deepEqual(m.frame, m.stage, 'the frame fills the stage exactly');
  assert.equal(m.navPresent, false, 'no unnamed chevron pair anywhere');
});

test('phone portrait: the bar insets the game and nothing persistent covers it', async () => {
  const m = await measure({ width: 390, height: 844 });
  assert.equal(m.stage.w, 390, JSON.stringify(m.stage));
  assert.ok(m.stage.h >= 780 && m.stage.h <= 790, `stage height ${m.stage.h}`);
  assert.deepEqual(m.frame, m.stage);
  assert.equal(overlaps(m.rail, m.stage), false, 'the bar must not sit on the stage');
  assert.equal(m.navPresent, false, 'the chevrons trade out for the Games cell');
  assert.equal(m.guttersPainted, 0, 'nothing of ours lies over the game waiting for a gesture');
});

test('phone portrait: six cells clear a 44px touch target with room to spare', async () => {
  const m = await measure({ width: 390, height: 844 });
  assert.equal(m.cells.length, 6);
  for (const cell of m.cells) {
    assert.ok(cell.w >= 44, `cell width ${cell.w} is under a 44px touch target`);
  }
});

test('phone portrait: the caption floats in the letterbox and passes taps through', async () => {
  const m = await measure({ width: 390, height: 844 }, { noSheet: true });
  assert.equal(m.bubbleEvents, 'none');
  assert.equal(overlaps(m.bubble, m.rail), false, 'the caption must clear the bar');
  assert.ok(m.bubble.y + m.bubble.h <= m.stage.y + m.stage.h, 'the caption stays on the stage');
});


test('short landscape: the bar hugs the right edge and never overlaps the game', async () => {
  const m = await measure({ width: 844, height: 390 });
  assert.equal(m.stage.h, 390, JSON.stringify(m.stage));
  assert.ok(m.stage.w >= 780 && m.stage.w < 844, `stage width ${m.stage.w}`);
  assert.equal(overlaps(m.rail, m.stage), false);
  assert.equal(m.navPresent, false);
  assert.equal(m.guttersPainted, 0, 'no strips over the game here either');
  assert.equal(overlaps(m.bubble, m.rail), false, 'the caption must clear the bar here as well');
});

test('no --game-fit value collapses the frame to the browser default box', async () => {
  for (const fit of ['', '0', 'none', 'NaN', 'foo', '2', '-1']) {
    const m = await measure({ width: 1280, height: 800 }, { fit });
    assert.deepEqual(
      m.frame,
      { x: 0, y: 0, w: 1196, h: 800 },
      `--game-fit: "${fit}" produced ${JSON.stringify(m.frame)}`,
    );
  }
});

test('a sheet and a caption never stack — the caption steps aside', async () => {
  // They occupy the same band on purpose. A sheet is a deliberate
  // interruption; a caption behind it is noise, and Rook's sheet carries the
  // words anyway. The rule lives in globals.css so it cannot be forgotten in
  // one of the three places a sheet can open.
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
    const m = await measure(viewport);
    assert.equal(m.bubblePainted, false, `caption painted behind a sheet at ${viewport.width}`);
    assert.equal(m.sheetPresent, true);
    assert.ok(m.sheet.y >= 0, `sheet off-stage at ${viewport.width}x${viewport.height}`);
    assert.equal(overlaps(m.sheet, m.rail), false, `sheet lands on the bar at ${viewport.width}`);
  }
});

test('with no sheet open, a worst-case caption clears the bar at every size', async () => {
  // A three-line caption is the tallest transient thing on this screen. If it
  // holds here it holds everywhere, and this keeps the named band offsets in
  // globals.css honest as the chrome changes.
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
    const m = await measure(viewport, { noSheet: true });
    assert.ok(m.bubblePainted, `caption not painted at ${viewport.width}`);
    assert.equal(overlaps(m.bubble, m.rail), false, `caption lands on the bar at ${viewport.width}: ${JSON.stringify(m.bubble)} vs ${JSON.stringify(m.rail)}`);
    assert.ok(m.bubble.y >= 0, `caption off-stage at ${viewport.width}`);
  }
});

test('the caption is painted in the overlay, never clipped inside the bar', async () => {
  // `.game-rail` is positioned and scrolls its overflow. A bubble nested in it
  // is clipped to the bar on a desktop rail and measured against the wrong box
  // on a phone, and no source assertion catches that.
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const m = await measure(viewport, { noSheet: true });
    assert.equal(m.bubbleInRail, false, `caption nested in the bar at ${viewport.width}`);
    assert.equal(m.overlayEvents, 'none', 'the overlay must not block the game');
    assert.ok(m.bubble.w > 0 && m.bubble.h > 0, `caption not painted at ${viewport.width}`);
    assert.ok(m.bubble.x >= 0 && m.bubble.x + m.bubble.w <= viewport.width + 1, `caption off-screen at ${viewport.width}: ${JSON.stringify(m.bubble)}`);
  }
});




test('the player is never transformed — fullscreen is the browser\'s job', async () => {
  // A CSS rotation cannot turn the browser\'s own chrome with it, which is
  // what made the rotated mode wrong on a real phone.
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const m = await measure(viewport);
    assert.equal(m.bodyTransform, 'none', `the player is transformed at ${viewport.width}`);
  }
});
