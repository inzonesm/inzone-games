/**
 * Collapsed companion shelf must stay inside its reserved row.
 * Chromium here is Google Chrome via Playwright, not Safari.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const CSS = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const CHROMIUM = process.env.CHROMIUM || '/usr/bin/google-chrome';

const PAGE = `<!doctype html><html><head><style>${CSS}</style></head>
<body>
<div class="game-frame-shell">
  <div class="game-frame-body">
    <div class="game-stage">
      <div class="player-letterbox">
        <aside class="companion-dock" data-testid="game-companion" data-companion-layout="shelf">
          <div class="companion-presence"><canvas class="companion-ribbon" width="76" height="76"></canvas></div>
          <div class="companion-copy">
            <p class="companion-name">ROOK<span class="companion-dot"></span><span class="companion-status">Listening</span></p>
            <p class="companion-caption">Here when you need me.</p>
          </div>
          <div class="companion-controls">
            <button type="button" class="companion-icon-btn companion-voice-label">Voice</button>
            <button type="button" class="companion-icon-btn" aria-label="More">···</button>
          </div>
        </aside>
      </div>
    </div>
  </div>
</div>
</body></html>`;

async function measure(viewport) {
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage({ viewport });
    await page.setContent(PAGE, { waitUntil: 'domcontentloaded' });
    return await page.evaluate(() => {
      const dock = document.querySelector('.companion-dock');
      const box = dock.getBoundingClientRect();
      const style = getComputedStyle(dock);
      return {
        w: Math.round(box.width),
        h: Math.round(box.height),
        top: Math.round(box.top),
        wrap: style.flexWrap,
        overflow: style.overflow,
        children: [...dock.children].map((el) => {
          const r = el.getBoundingClientRect();
          return {
            tag: el.tagName,
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
            height: Math.round(r.height),
          };
        }),
      };
    });
  } finally {
    await browser.close();
  }
}

function childrenFitRow(box) {
  return box.children.every((child) => (
    child.top >= box.top - 1 && child.bottom <= box.top + box.h + 1
  ));
}

test('desktop collapsed shelf stays in the 88px reserved row', async () => {
  const box = await measure({ width: 1280, height: 800 });
  assert.equal(box.wrap, 'nowrap', JSON.stringify(box));
  assert.notEqual(box.overflow, 'hidden');
  assert.ok(box.h >= 76 && box.h <= 88, JSON.stringify(box));
  assert.ok(childrenFitRow(box), JSON.stringify(box));
});

test('phone collapsed shelf stays in the 76px reserved row', async () => {
  const box = await measure({ width: 390, height: 844 });
  assert.ok(box.h >= 60 && box.h <= 76, JSON.stringify(box));
  assert.ok(childrenFitRow(box), JSON.stringify(box));
});

test('short-landscape collapsed shelf stays in the 68px reserved row', async () => {
  const box = await measure({ width: 844, height: 390 });
  assert.ok(box.h >= 60 && box.h <= 68, JSON.stringify(box));
  assert.ok(childrenFitRow(box), JSON.stringify(box));
});
