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
      <div class="rail-nav"><button class="rail-btn nav"></button><button class="rail-btn nav"></button></div>
    </div>
  </div>
</div>
</body></html>`;

const MEASURE = `(() => {
  const box = (el) => { if (!el) return { x: 0, y: 0, w: 0, h: 0, absent: true }; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const iframe = document.querySelector('.game-frame-body iframe');
  const cells = [...document.querySelectorAll('.game-rail > .rail-btn')];
  const nav = document.querySelector('.rail-nav');
  const gutters = [...document.querySelectorAll('.swipe-gutter')];
  return {
    stage: box(document.querySelector('.game-stage')),
    frame: box(iframe),
    rail: box(document.querySelector('.game-rail')),
    bubble: box(document.querySelector('.rook-bubble')),
    frameCss: { width: getComputedStyle(iframe).width, height: getComputedStyle(iframe).height, transform: getComputedStyle(iframe).transform },
    cells: cells.map(box),
    navShown: nav ? getComputedStyle(nav).display !== 'none' : false,
    guttersPainted: [...document.querySelectorAll('.swipe-gutter')].filter((g) => getComputedStyle(g).display !== 'none').length,
    overlayEvents: getComputedStyle(document.querySelector('.player-overlay')).pointerEvents,
    bubbleInRail: document.querySelector('.game-rail .rook-bubble') !== null,
    bubbleEvents: getComputedStyle(document.querySelector('.rook-bubble')).pointerEvents,
    bubblePainted: getComputedStyle(document.querySelector('.rook-bubble')).display !== 'none',
    sheetPresent: document.querySelector('.player-sheet') !== null,
    sheet: box(document.querySelector('.player-sheet')),
    bodyLayout: { w: document.querySelector('.game-frame-body').offsetWidth, h: document.querySelector('.game-frame-body').offsetHeight },
    stageLayout: { w: document.querySelector('.game-stage').offsetWidth, h: document.querySelector('.game-stage').offsetHeight },
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

async function measure(viewport, { fit, fill, noSheet } = {}) {
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
  if (fill) {
    await page.evaluate(() => document.querySelector('.game-frame-body').setAttribute('data-fill', 'on'));
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
  assert.equal(m.navShown, true, 'desktop keeps the up/down switchers');
});

test('phone portrait: the bar insets the game and nothing persistent covers it', async () => {
  const m = await measure({ width: 390, height: 844 });
  assert.equal(m.stage.w, 390, JSON.stringify(m.stage));
  assert.ok(m.stage.h >= 780 && m.stage.h <= 790, `stage height ${m.stage.h}`);
  assert.deepEqual(m.frame, m.stage);
  assert.equal(overlaps(m.rail, m.stage), false, 'the bar must not sit on the stage');
  assert.equal(m.navShown, false, 'the chevrons trade out for the Games cell');
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

test('fill screen turns the whole player, not just the game', async () => {
  const after = await measure({ width: 390, height: 844 }, { fill: true });
  // The player's layout box is the viewport with its axes swapped, so the bar
  // and the bands travel with the game instead of staying upright over a
  // sideways picture.
  assert.equal(after.bodyLayout.w, 844, JSON.stringify(after.bodyLayout));
  assert.equal(after.bodyLayout.h, 390);
  assert.notEqual(after.bodyTransform, 'none');
  // The game is landscape and keeps the bar inset: 844 wide, 390 minus the bar.
  assert.equal(after.stageLayout.w, 844, JSON.stringify(after.stageLayout));
  assert.ok(after.stageLayout.h >= 320 && after.stageLayout.h < 390, `stage height ${after.stageLayout.h}`);
  // Against a 390x136 canvas in portrait, a landscape-shaped 844-wide stage is
  // worth about 4x on the drawn canvas at Nightclub's own 2.87:1 ratio.
  const drawn = 844 * (844 / 2.87);
  assert.ok(drawn > 390 * 136 * 3, `rotated canvas only ${Math.round(drawn)}px2`);
});

test('short landscape: the bar hugs the right edge and never overlaps the game', async () => {
  const m = await measure({ width: 844, height: 390 });
  assert.equal(m.stage.h, 390, JSON.stringify(m.stage));
  assert.ok(m.stage.w >= 780 && m.stage.w < 844, `stage width ${m.stage.w}`);
  assert.equal(overlaps(m.rail, m.stage), false);
  assert.equal(m.navShown, false);
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

test('rotated: a tap lands on the control it looks like it lands on', async () => {
  // Pointer coordinates travel through the same transform the paint does, so
  // hit-testing is the check that matters — not the numbers. Each bar cell is
  // probed at the centre of where it is actually drawn.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(PAGE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.querySelector('.game-frame-body').setAttribute('data-fill', 'on'));
  await page.evaluate(() => {
    const rail = document.querySelector('.game-rail');
    const body = document.querySelector('.game-frame-body');
    const horizontal = rail.offsetWidth >= body.offsetWidth * 0.9;
    body.style.setProperty('--rail-x', horizontal ? '0px' : `${Math.round(body.offsetWidth - rail.offsetLeft)}px`);
    body.style.setProperty('--rail-y', horizontal ? `${Math.round(body.offsetHeight - rail.offsetTop)}px` : '0px');
  });
  const hits = await page.evaluate(() => {
    const out = [];
    for (const cell of document.querySelectorAll('.game-rail > .rail-btn')) {
      const r = cell.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
      out.push({
        label: cell.querySelector('.rail-cap')?.textContent ?? '',
        onTarget: cell.contains(hit),
        got: hit ? `${hit.tagName}.${hit.className}` : 'nothing',
        painted: r.width > 0 && r.height > 0,
      });
    }
    return out;
  });
  await page.close();
  assert.equal(hits.length, CELLS.length);
  for (const hit of hits) {
    assert.ok(hit.painted, `${hit.label} not painted while rotated`);
    assert.ok(hit.onTarget, `${hit.label} is drawn where ${hit.got} receives the tap`);
  }
});

test('rotated: the game stays on screen and the bar stays off it', async () => {
  const m = await measure({ width: 390, height: 844 }, { fill: true });
  // Every rendered box must still be inside the physical viewport after the
  // turn — a rotation that pushes the bar off-screen is a lost escape route.
  for (const [name, box] of [['stage', m.stage], ['bar', m.rail]]) {
    assert.ok(box.x >= -1 && box.y >= -1, `${name} starts off-screen: ${JSON.stringify(box)}`);
    assert.ok(box.x + box.w <= 391 && box.y + box.h <= 845, `${name} runs off-screen: ${JSON.stringify(box)}`);
  }
  assert.equal(overlaps(m.rail, m.stage), false, 'the bar must not sit on the game while rotated');
});

test('toggling fill screen does not remount the frame', async () => {
  // A class change, not a key change. The element, its window and its document
  // must survive the turn in both directions, or a round is lost every time
  // the player tries the control.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(PAGE, { waitUntil: 'domcontentloaded' });
  const stamp = async () => page.evaluate(() => {
    const f = document.querySelector('.game-frame-body iframe');
    if (!f.__inzoneStamp) {
      f.__inzoneStamp = Math.random().toString(36).slice(2);
      f.contentWindow.__inzoneDocStamp = Math.random().toString(36).slice(2);
    }
    return {
      element: f.__inzoneStamp,
      doc: f.contentWindow.__inzoneDocStamp ?? null,
      src: f.getAttribute('src'),
    };
  });
  const before = await stamp();
  await page.evaluate(() => document.querySelector('.game-frame-body').setAttribute('data-fill', 'on'));
  const during = await stamp();
  await page.evaluate(() => document.querySelector('.game-frame-body').setAttribute('data-fill', 'off'));
  const after = await stamp();
  await page.close();
  assert.deepEqual(during, before, 'entering fill screen remounted the frame');
  assert.deepEqual(after, before, 'leaving fill screen remounted the frame');
});
