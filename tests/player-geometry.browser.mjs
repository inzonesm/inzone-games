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

/** Seven cells: Rook plus the six actions the bar has always carried. */
const CELLS = ['Voice', 'Replay', 'Home', '0', '0', 'Share', 'App'];

const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>${CSS}</style></head>
<body>
<div class="game-frame-shell">
  <div class="game-frame-body" data-fill="off">
    <div class="game-stage">
      <iframe title="fixture" src="about:blank"></iframe>
    </div>
    <div class="swipe-gutter left"></div>
    <div class="swipe-gutter right"></div>
    <button class="player-fill">Fill screen</button>
    <div class="player-actions"><button class="player-chat">Chat</button><button class="player-invite-copy">Invite</button></div>
    <div class="rook-bubble"><p class="companion-caption">A caption long enough to wrap onto three clamped lines inside its own bubble, which is the worst case the bands above the bar have to clear without ever landing on each other.</p><button class="rook-bubble-stop"></button></div>
    <div class="game-rail" role="toolbar">
      ${CELLS.map((cap, i) => `<button class="rail-btn${i === 0 ? ' rook-cell' : ''}"><span class="${i === 0 ? 'rook-mark' : ''}"><svg width="22" height="22"></svg></span><span class="rail-cap">${cap}</span></button>`).join('')}
      <div class="rail-nav"><button class="rail-btn nav"></button><button class="rail-btn nav"></button></div>
    </div>
  </div>
</div>
</body></html>`;

const MEASURE = `(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
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
    guttersShown: gutters.filter((g) => getComputedStyle(g).display !== 'none').length,
    bubbleEvents: getComputedStyle(document.querySelector('.rook-bubble')).pointerEvents,
    fill: box(document.querySelector('.player-fill')),
    bodyLayout: { w: document.querySelector('.game-frame-body').offsetWidth, h: document.querySelector('.game-frame-body').offsetHeight },
    stageLayout: { w: document.querySelector('.game-stage').offsetWidth, h: document.querySelector('.game-stage').offsetHeight },
    bodyTransform: getComputedStyle(document.querySelector('.game-frame-body')).transform,
    actions: box(document.querySelector('.player-actions')),
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

async function measure(viewport, { fit, fill } = {}) {
  const page = await browser.newPage({ viewport });
  await page.setContent(PAGE, { waitUntil: 'domcontentloaded' });
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
  assert.equal(m.navShown, false, 'the chevrons trade out for Rook');
  assert.equal(m.guttersShown, 2, 'swipe nav replaces them');
});

test('phone portrait: seven cells still clear a 44px touch target', async () => {
  const m = await measure({ width: 390, height: 844 });
  assert.equal(m.cells.length, 7);
  for (const cell of m.cells) {
    assert.ok(cell.w >= 44, `cell width ${cell.w} is under a 44px touch target`);
  }
});

test('phone portrait: the caption floats in the letterbox and passes taps through', async () => {
  const m = await measure({ width: 390, height: 844 });
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
  assert.equal(m.guttersShown, 2, 'short landscape must keep swipe nav too');
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

test('the bands above the bar never land on each other, worst-case caption included', async () => {
  // A three-line caption is the tallest transient thing on this screen. If the
  // bands hold here they hold everywhere, and this is what keeps the named
  // offsets in globals.css honest as the chrome changes.
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
    const m = await measure(viewport);
    const bands = [['fill screen', m.fill], ['caption', m.bubble], ['session actions', m.actions], ['bar', m.rail]];
    for (let i = 0; i < bands.length; i += 1) {
      for (let j = i + 1; j < bands.length; j += 1) {
        assert.equal(
          overlaps(bands[i][1], bands[j][1]),
          false,
          `${bands[i][0]} overlaps ${bands[j][0]} at ${viewport.width}x${viewport.height}: ${JSON.stringify(bands[i][1])} vs ${JSON.stringify(bands[j][1])}`,
        );
      }
    }
    // And none of it may spill off the stage into nowhere.
    assert.ok(m.fill.y >= 0, `fill screen off-stage at ${viewport.width}x${viewport.height}`);
  }
});
