import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const port = '4176';
const server = spawn(process.execPath, ['--experimental-strip-types', 'scripts/legacy-games-harness/server.mjs'], {
  env: { ...process.env, LEGACY_GAMES_PORT: port },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let browser;
try {
  await Promise.race([
    once(server.stdout, 'data'),
    once(server, 'exit').then(([code]) => { throw new Error(`Harness exited: ${code}`); }),
    new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('Harness startup timed out')), 10000); t.unref(); }),
  ]);

  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: process.env.CHROMIUM_EXECUTABLE ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
  });
  const page = await browser.newPage();

  await page.goto(`http://127.0.0.1:${port}/legacy`);
  const legacy = page.frameLocator('#game');
  await legacy.locator('#tile').waitFor();
  assert.equal(await legacy.locator('#tile').evaluate((img) => img.complete && img.naturalWidth > 0), true);
  assert.equal(await legacy.locator('#out').textContent(), 'none');
  await legacy.locator('#save').click();
  assert.equal(await legacy.locator('#out').textContent(), '42');
  assert.equal(await page.frames().find((f) => f.url().includes('/fixture/')).evaluate(() => typeof window.InZoneSDK), 'undefined');
  const parentAccess = await page.frames().find((f) => f.url().includes('/fixture/')).evaluate(() => {
    try {
      return { leaked: true, marker: window.parent.document.getElementById('host-marker').textContent };
    } catch {
      return { leaked: false };
    }
  });
  assert.equal(parentAccess.leaked, true);
  assert.equal(parentAccess.marker, 'trusted-host');

  await page.reload();
  const legacy2 = page.frameLocator('#game');
  await legacy2.locator('#out').waitFor();
  assert.equal(await legacy2.locator('#out').textContent(), '42');

  await page.goto(`http://127.0.0.1:${port}/isolated`);
  const isolatedFrame = page.frames().find((f) => f.url().includes('/fixture/'));
  assert.ok(isolatedFrame);
  await isolatedFrame.waitForFunction(() => window.InZoneSDK);
  const isolated = await isolatedFrame.evaluate(() => {
    try {
      return { leaked: true, href: window.parent.location.href };
    } catch {
      return { leaked: false, origin: String(window.origin), sdk: typeof window.InZoneSDK };
    }
  });
  assert.equal(isolated.leaked, false);
  assert.equal(isolated.origin, 'null');
  assert.equal(isolated.sdk, 'object');
  await isolatedFrame.locator('#save').click();
  assert.equal(await isolatedFrame.locator('#out').textContent(), 'blocked');

  await page.goto(`http://127.0.0.1:${port}/gcs-snake`);
  const snake = page.frames().find((f) => f.url().includes('/gcs/games/snake/'));
  assert.ok(snake, 'snake iframe missing');
  await snake.waitForFunction(() => typeof window.InZoneSDK === 'undefined' && !!document.querySelector('canvas'));
  const snakeCss = await snake.evaluate(() => {
    const href = document.querySelector('link[rel="stylesheet"]')?.href || '';
    const sheets = [...document.styleSheets].filter((s) => {
      try { return s.cssRules && s.cssRules.length > 0; } catch { return false; }
    });
    return { href, sheets: sheets.length, sdk: typeof window.InZoneSDK, origin: String(window.origin) };
  });
  assert.match(snakeCss.href, /\/gcs\/games\/snake\/v2\/src\/index\.css/);
  assert.ok(snakeCss.sheets > 0, 'snake CSS did not apply');
  assert.equal(snakeCss.sdk, 'undefined');
  const snakeStorage = await snake.evaluate(() => {
    localStorage.setItem('highscore', '7');
    localStorage.setItem('previousScore', '3');
    return {
      highscore: localStorage.getItem('highscore'),
      previousScore: localStorage.getItem('previousScore'),
    };
  });
  assert.equal(snakeStorage.highscore, '7');
  assert.equal(snakeStorage.previousScore, '3');

  await page.goto(`http://127.0.0.1:${port}/gcs-2048`);
  const g2048 = page.frames().find((f) => f.url().includes('/gcs/games/2048-inzone-upload/'));
  assert.ok(g2048, '2048 iframe missing');
  await g2048.waitForFunction(() => typeof window.InZoneSDK === 'undefined');
  const assets2048 = await g2048.evaluate(async () => {
    const img = document.querySelector('img[src*="2048"], img#game-icon, .game-container img') || document.querySelector('img');
    const scripts = [...document.scripts].map((s) => s.src).filter(Boolean);
    return {
      sdk: typeof window.InZoneSDK,
      scriptOk: scripts.some((src) => src.includes('js/game_manager.js')),
      imgSrc: img ? img.getAttribute('src') || img.src : null,
    };
  });
  assert.equal(assets2048.sdk, 'undefined');
  assert.equal(assets2048.scriptOk, true);

  console.log('PASS: legacy same-origin storage/assets, isolated SDK opt-in, snake+2048 hub games.');
} finally {
  if (browser) await browser.close();
  server.kill();
}
