/**
 * Computed geometry for the player stage. Source assertions are not enough:
 * missing, empty, zero, and invalid --game-fit must not collapse the iframe
 * to the browser default 300×150 box.
 *
 * Chromium here is Google Chrome via Playwright. Playwright WebKit, if
 * present, is not macOS Safari.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, webkit } from 'playwright-core';

const CSS = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const CHROMIUM = process.env.CHROMIUM || '/usr/bin/google-chrome';

const PAGE = `<!doctype html><html><head><style>${CSS}</style></head>
<body>
<div class="game-frame-shell">
  <div class="game-frame-body">
    <div class="game-stage" data-testid="game-stage">
      <iframe title="fixture" src="about:blank"></iframe>
    </div>
  </div>
</div>
</body></html>`;

const MEASURE = `(() => {
  const iframe = document.querySelector('.game-frame-body iframe');
  const stage = document.querySelector('.game-stage');
  const r = iframe.getBoundingClientRect();
  const cs = getComputedStyle(iframe);
  return {
    w: Math.round(r.width),
    h: Math.round(r.height),
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: cs.width,
    height: cs.height,
    transform: cs.transform,
    stageW: Math.round(stage.getBoundingClientRect().width),
    stageH: Math.round(stage.getBoundingClientRect().height),
  };
})()`;

async function launch(kind) {
  if (kind === 'chromium') {
    return chromium.launch({
      executablePath: CHROMIUM,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return webkit.launch({ headless: true });
}

async function openFixture(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent(PAGE, { waitUntil: 'domcontentloaded' });
  return page;
}

test('chromium computed geometry: default fills the stage', async () => {
  const browser = await launch('chromium');
  try {
    const page = await openFixture(browser);
    const box = await page.evaluate(MEASURE);
    assert.equal(box.w, 1196, JSON.stringify(box));
    assert.equal(box.h, 800);
    assert.equal(box.x, 0);
    assert.equal(box.y, 0);
  } finally {
    await browser.close();
  }
});

test('chromium computed geometry: empty, zero, and invalid --game-fit cannot collapse', async () => {
  const browser = await launch('chromium');
  try {
    const page = await openFixture(browser);
    for (const raw of ['', '0', 'none', 'foo', 'NaN', '2']) {
      await page.evaluate((value) => {
        document.querySelector('.game-frame-body').style.setProperty('--game-fit', value);
      }, raw);
      const box = await page.evaluate(MEASURE);
      assert.equal(box.w, 1196, `collapsed for --game-fit=${JSON.stringify(raw)} ${JSON.stringify(box)}`);
      assert.equal(box.h, 800);
    }
  } finally {
    await browser.close();
  }
});

test('chromium computed geometry: validated zoom keeps a usable painted box, then invalid zoom is ignored', async () => {
  const browser = await launch('chromium');
  try {
    const page = await openFixture(browser);
    await page.evaluate(() => {
      const stage = document.querySelector('.game-stage');
      stage.style.setProperty('--game-fit-safe', '0.5');
      stage.classList.add('is-zoomed');
    });
    const zoomed = await page.evaluate(MEASURE);
    assert.ok(zoomed.w >= 1100 && zoomed.h >= 700, JSON.stringify(zoomed));
    await page.evaluate(() => {
      const stage = document.querySelector('.game-stage');
      stage.classList.remove('is-zoomed');
      stage.style.removeProperty('--game-fit-safe');
      document.querySelector('.game-frame-body').style.setProperty('--game-fit', '0');
    });
    const after = await page.evaluate(MEASURE);
    assert.equal(after.w, 1196, JSON.stringify(after));
    assert.equal(after.h, 800);
  } finally {
    await browser.close();
  }
});

test('playwright-webkit computed geometry (not Safari)', async (t) => {
  let browser;
  try {
    browser = await launch('webkit');
  } catch (err) {
    t.skip(`Playwright WebKit not installed: ${String(err).slice(0, 160)}`);
    return;
  }
  try {
    const page = await openFixture(browser);
    const box = await page.evaluate(MEASURE);
    assert.ok(box.w >= 1100 && box.h >= 700, JSON.stringify(box));
    assert.ok(!(box.w <= 308 && box.h <= 158), 'must not be the 300×150 default');
    await page.evaluate(() => {
      document.querySelector('.game-frame-body').style.setProperty('--game-fit', '0');
    });
    const invalid = await page.evaluate(MEASURE);
    assert.ok(invalid.w >= 1100 && invalid.h >= 700, JSON.stringify(invalid));
  } finally {
    await browser?.close();
  }
});
