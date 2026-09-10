import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createFixtureCheckoutClient } from '../lib/game-sdk/fixture-checkout.ts';
import { createPurchaseController } from '../lib/game-sdk/purchase-session.ts';
import { createMemoryStore, readPending } from '../lib/game-sdk/persist.ts';
import { toSdkError } from '../lib/game-sdk/errors.ts';
import {
  PENDING_CAPABILITIES,
  SDK_CHANNEL,
  SDK_PROTOCOL,
  SDK_VERSION,
  SUPPORTED_CAPABILITIES,
} from '../lib/game-sdk/protocol.ts';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const port = '4175';
const server = spawn(process.execPath, ['--experimental-strip-types', 'scripts/sdk-host-harness/server.mjs'], {
  env: { ...process.env, SDK_HOST_PORT: port },
  stdio: ['ignore', 'pipe', 'pipe'],
});

function makeSession(accountId, client, store, page) {
  return createPurchaseController({
    accountId,
    gameId: 'sdk-example',
    client,
    store,
    confirm: (prompt) => page.evaluate((p) => window.showHostConfirm(p), prompt),
  });
}

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
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const store = createMemoryStore();
  const { client, control } = createFixtureCheckoutClient('sdk-example');
  let session = makeSession('user-a', client, store, page);

  await page.exposeFunction('__inzoneHostRpc', async (req) => {
    const reply = (body) => ({
      channel: SDK_CHANNEL,
      v: SDK_PROTOCOL,
      id: req.id,
      type: 'res',
      ...body,
    });
    const methods = {
      getConfig: async () => ({
        sdkVersion: SDK_VERSION,
        protocol: SDK_PROTOCOL,
        gameId: 'sdk-example',
        fixtureMode: true,
        isolation: 'opaque-origin-frame',
        capabilities: SUPPORTED_CAPABILITIES,
        pendingCapabilities: PENDING_CAPABILITIES,
        signedIn: true,
      }),
      getCatalog: () => session.getCatalog(),
      requestPurchase: (payload) => session.requestPurchase(payload),
      getInventory: (payload) => session.getInventory(payload),
      getReceipt: (payload) => session.getReceipt(payload),
      saveState: async (payload) => ({ saved: true, state: payload && payload.state ? payload.state : payload }),
      loadState: async () => ({ version: 1, state: { saved: true } }),
    };
    try {
      const method = methods[req.method];
      if (!method) throw Object.assign(new Error('INZONE_UNSUPPORTED_CAPABILITY'), { code: 'INZONE_UNSUPPORTED_CAPABILITY' });
      return reply({ ok: true, result: await method(req.payload) });
    } catch (error) {
      const mapped = toSdkError(error);
      return reply({
        ok: false,
        error: {
          code: mapped.code,
          message: mapped.message,
          outcomeUnknown: mapped.outcomeUnknown,
          requestId: mapped.requestId,
          status: mapped.status,
        },
      });
    }
  });

  await page.goto(`http://127.0.0.1:${port}/`);
  const frame = page.frames().find((f) => f.url().includes('/game/index.html'));
  assert.ok(frame, 'game iframe missing');
  assert.equal(await page.evaluate(() => typeof window.InZoneSDK), 'undefined');

  await frame.waitForFunction(() => window.InZoneSDK && window.InZoneSDK.getStatus().state === 'ready');
  assert.equal(await frame.evaluate(() => InZoneSDK.getStatus().state), 'ready');
  const config = await frame.evaluate(() => InZoneSDK.getConfig());
  assert.equal(config.gameId, 'sdk-example');
  assert.equal(config.isolation, 'opaque-origin-frame');
  assert.ok(!Object.prototype.hasOwnProperty.call(config, 'userId'));
  assert.ok(!Object.prototype.hasOwnProperty.call(config, 'gameKey'));
  assert.ok(!Object.prototype.hasOwnProperty.call(config, 'backendBaseUrl'));
  assert.ok(await frame.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0));
  await frame.locator('#play').click();
  assert.equal(await frame.locator('#play').textContent(), 'Tap: 1');

  const isolated = await frame.evaluate(() => {
    try {
      return { parentHref: window.parent.location.href, leaked: true };
    } catch {
      return { leaked: false, origin: String(window.origin) };
    }
  });
  assert.equal(isolated.leaked, false);

  await frame.locator('#catalog').click();
  await frame.waitForFunction(() => window.results.catalog && window.results.catalog.offers.length === 2);
  const catalogTitle = await frame.evaluate(() => results.catalog.offers[0].title);
  assert.equal(catalogTitle, 'Extra lives');

  await frame.locator('#buy-lives').click();
  await page.getByTestId('purchase-confirm').waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('confirm-title').textContent(), 'Extra lives');
  assert.match(await page.getByTestId('confirm-price').textContent(), /10/);
  await page.getByTestId('confirm-cancel').click();
  await frame.waitForFunction(() => window.results.lastError && window.results.lastError.code === 'PURCHASE_CANCELLED');
  assert.equal(control.purchasePosts, 0);

  await page.evaluate(() => {
    window.postMessage({
      channel: 'inzone-web-sdk',
      v: 1,
      id: 'spoof',
      type: 'req',
      method: 'requestPurchase',
      payload: { offerId: 'extra-lives' },
    }, '*');
  });
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#confirm').isVisible(), false);
  assert.equal(control.purchasePosts, 0);

  control.failNextPurchase = 'network';
  await frame.locator('#buy-lives').click();
  await page.getByTestId('purchase-confirm').waitFor({ state: 'visible' });
  await page.getByTestId('confirm-buy').click();
  await frame.waitForFunction(() => window.results.lastError && window.results.lastError.outcomeUnknown === true);
  assert.equal(control.purchasePosts, 1);
  assert.equal(readPending(store, 'user-a', 'sdk-example').requestId, await frame.evaluate(() => results.lastError.requestId));

  await frame.locator('#buy-lives').click();
  await frame.waitForFunction(() => window.results.receipt && window.results.receipt.transactionId);
  assert.equal(control.purchasePosts, 1);
  assert.equal(await page.locator('#confirm').isVisible(), false);

  session = makeSession('user-b', client, store, page);
  assert.equal(readPending(store, 'user-b', 'sdk-example'), null);
  await frame.locator('#buy-badge').click();
  await page.getByTestId('purchase-confirm').waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('confirm-title').textContent(), 'Golden badge');
  await page.getByTestId('confirm-cancel').click();
  await frame.waitForFunction(() => window.results.lastError && window.results.lastError.code === 'PURCHASE_CANCELLED');

  await frame.locator('#unsupported').click();
  await frame.waitForFunction(() => document.querySelector('#out').textContent.includes('INZONE_UNSUPPORTED_CAPABILITY'));

  await frame.evaluate(() => history.pushState({}, '', '/another-path'));
  assert.equal(
    await frame.evaluate(() => new URL('asset.svg', document.baseURI).pathname),
    '/game/asset.svg',
  );

  assert.deepEqual(errors, []);
  console.log('PASS: hosting-path iframe isolation, catalog confirm/cancel, spoof ignore, failed purchase recovery, account switch, relative assets, existing gameplay.');
} finally {
  if (browser) await browser.close();
  server.kill();
}
