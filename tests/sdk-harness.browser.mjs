import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = spawn(process.execPath, ['--experimental-strip-types', 'scripts/sdk-harness/server.mjs'], {
  env: { ...process.env, SDK_HARNESS_PORT: '4174' }, stdio: ['ignore', 'pipe', 'pipe']
});
let browser;
try {
  await Promise.race([
    once(server.stdout, 'data'),
    once(server, 'exit').then(([code]) => { throw new Error(`Harness exited: ${code}`); }),
    new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('Harness startup timed out')), 10000); t.unref(); })
  ]);
  browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: process.env.CHROMIUM_EXECUTABLE ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] });
  const page = await browser.newPage();
  const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', req => { if (new URL(req.url()).hostname !== '127.0.0.1') external.push(req.url()); });
  await page.goto('http://127.0.0.1:4174/');
  const frame = page.frames().find(f => f.url().includes('/game/index.html'));
  assert.ok(frame);
  assert.equal(await page.evaluate(() => typeof window.InZoneSDK), 'undefined');
  const result = await frame.evaluate(() => window.results);
  assert.equal(result.earlyState, 'initializing');
  assert.equal(result.early, 'development-harness');
  assert.equal(result.late, result.early);
  assert.equal(result.readyEvents, 1);
  assert.ok(await frame.locator('img').evaluate(img => img.complete && img.naturalWidth > 0));
  await frame.locator('#play').click();
  assert.equal(await frame.locator('#play').textContent(), 'Tap: 1');
  await frame.locator('#unsupported').click();
  assert.equal(await frame.locator('#status').textContent(), 'INZONE_UNSUPPORTED_CAPABILITY');
  assert.ok(await frame.evaluate(() => {
    const old = InZoneSDK;
    const script = document.createElement('script');
    script.textContent = document.querySelector('#sdk-bootstrap').textContent;
    document.head.appendChild(script);
    return old === InZoneSDK && results.readyEvents === 1;
  }));
  // Existing production helper behavior under SPA navigation.
  await frame.goto('http://127.0.0.1:4174/game/index.html?serverUrl=wss%3A%2F%2Fexample.invalid');
  assert.ok(await frame.evaluate(() => {
    history.pushState({}, '', '/another-path');
    return new URLSearchParams(location.search).get('serverUrl') === 'wss://example.invalid' &&
      new URL('asset.svg', document.baseURI).pathname === '/game/asset.svg';
  }));
  await page.goto('http://127.0.0.1:4174/?fail=1');
  const failed = page.frames().find(f => f.url().includes('/game/index.html'));
  const failure = await failed.evaluate(() => ({ ...results, state: InZoneSDK.getStatus().state }));
  assert.equal(failure.state, 'failed');
  assert.equal(failure.failure, 'INZONE_SDK_INITIALIZATION_FAILED');
  assert.equal(failure.lateFailure, failure.failure);
  assert.equal(failure.errorEvents, 1);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('PASS: browser iframe readiness, early/late consumers, duplicate, failure, assets, interaction, unsupported methods, SPA helpers; zero page errors/external requests.');
} finally {
  if (browser) await browser.close();
  server.kill();
}
