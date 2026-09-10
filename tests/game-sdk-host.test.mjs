import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, readPending, writePending, clearPending } from '../lib/game-sdk/persist.ts';
import { createPurchaseController } from '../lib/game-sdk/purchase-session.ts';
import { createFixtureCheckoutClient } from '../lib/game-sdk/fixture-checkout.ts';
import { handleHostSdkMessage, isBoundGameMessage } from '../lib/game-sdk/host-bridge.ts';
import { instrumentGameHtml, injectViewportFit } from '../lib/game-hosting.ts';
import { PENDING_CAPABILITIES, SDK_CHANNEL, SDK_PROTOCOL } from '../lib/game-sdk/protocol.ts';
import { createCheckoutClient } from '../packages/checkout-host-client/index.js';

function controller(overrides = {}) {
  const { client, control } = createFixtureCheckoutClient('sdk-example');
  const store = createMemoryStore();
  const prompts = [];
  const session = createPurchaseController({
    accountId: 'user-a',
    gameId: 'sdk-example',
    client,
    store,
    confirm: async (prompt) => {
      prompts.push(prompt);
      return overrides.confirm ? overrides.confirm(prompt) : true;
    },
    randomId: () => overrides.requestId || 'req_fixed_1',
    ...overrides.session,
  });
  return { session, client, control, store, prompts };
}

test('catalog confirmation uses server title/price and ignores game fields', async () => {
  const { session, prompts, control } = controller();
  const receipt = await session.requestPurchase({ offerId: 'extra-lives', coins: 1, title: 'hacked' });
  assert.equal(prompts[0].title, 'Extra lives');
  assert.equal(prompts[0].coins, 10);
  assert.equal(prompts[0].quantity, 3);
  assert.equal(prompts[0].currency, 'Coin');
  assert.equal(receipt.offerId, 'extra-lives');
  assert.equal(control.purchasePosts, 1);
});

test('cancellation does not POST', async () => {
  const { session, control } = controller({ confirm: async () => false });
  await assert.rejects(session.requestPurchase({ offerId: 'extra-lives' }), { code: 'PURCHASE_CANCELLED' });
  assert.equal(control.purchasePosts, 0);
});

test('persists request before dispatch and recovers the same id after unknown failure', async () => {
  const { session, control, store } = controller();
  control.failNextPurchase = 'network';
  await assert.rejects(session.requestPurchase({ offerId: 'extra-lives' }), (err) => {
    assert.equal(err.code, 'NETWORK_ERROR');
    assert.equal(err.outcomeUnknown, true);
    assert.equal(err.requestId, 'req_fixed_1');
    return true;
  });
  const pending = readPending(store, 'user-a', 'sdk-example');
  assert.equal(pending.requestId, 'req_fixed_1');
  assert.equal(control.purchasePosts, 1);
  const recovered = await session.requestPurchase({ offerId: 'extra-lives' });
  assert.equal(recovered.transactionId, 'tx_req_fixed_1');
  assert.equal(control.purchasePosts, 1);
  assert.equal(control.receiptGets, 1);
  assert.equal(readPending(store, 'user-a', 'sdk-example'), null);
});

test('account and game isolation for persisted requests', () => {
  const store = createMemoryStore();
  writePending(store, {
    accountId: 'user-a', gameId: 'game-1', offerId: 'extra-lives',
    catalogVersion: 'fixture-v1', requestId: 'secret-a', status: 'uncertain', createdAt: 1,
  });
  assert.equal(readPending(store, 'user-b', 'game-1'), null);
  assert.equal(readPending(store, 'user-a', 'game-2'), null);
  assert.equal(readPending(store, 'user-a', 'game-1').requestId, 'secret-a');
  clearPending(store, 'user-a', 'game-1');
  assert.equal(readPending(store, 'user-a', 'game-1'), null);
});

test('unauthenticated purchase is rejected without a client POST', async () => {
  const { client, control } = createFixtureCheckoutClient('sdk-example');
  const session = createPurchaseController({
    accountId: null,
    gameId: 'sdk-example',
    client,
    store: createMemoryStore(),
    confirm: async () => true,
  });
  await assert.rejects(session.requestPurchase({ offerId: 'extra-lives' }), { code: 'UNAUTHENTICATED' });
  assert.equal(control.purchasePosts, 0);
});

test('spoofed messages from another window source are ignored', async () => {
  const iframe = { id: 'iframe' };
  const other = { id: 'other' };
  const calls = [];
  const handled = await handleHostSdkMessage(
    {
      source: other,
      origin: 'null',
      data: { channel: SDK_CHANNEL, v: SDK_PROTOCOL, id: '1', type: 'req', method: 'getCatalog', payload: {} },
    },
    {
      boundSource: iframe,
      allowedOrigin: 'http://127.0.0.1:4175',
      methods: { getCatalog: async () => { calls.push('catalog'); return { ok: true }; } },
      postToSource: () => { calls.push('posted'); },
    },
  );
  assert.equal(handled, false);
  assert.deepEqual(calls, []);
  assert.equal(isBoundGameMessage({ source: iframe, origin: 'null' }, iframe, 'http://127.0.0.1:4175'), true);
  assert.equal(isBoundGameMessage({ source: other, origin: 'http://127.0.0.1:4175' }, iframe, 'http://127.0.0.1:4175'), false);
});

test('hosting instrumentation preserves viewport-fit and injects SDK without tokens', () => {
  const html = '<html><head></head><body><h1>game</h1></body></html>';
  const out = instrumentGameHtml(html, { baseHref: '/gcs/games/demo/v1/', gameId: 'demo' });
  assert.match(out, /__inzoneWebSdk/);
  assert.match(out, /__inzoneViewportFit/);
  assert.match(out, /<base href="\/gcs\/games\/demo\/v1\/">/);
  assert.doesNotMatch(out, /Bearer /);
  assert.doesNotMatch(out, /userId/);
  assert.doesNotMatch(out, /gameKey/);
  assert.equal(injectViewportFit(out), out);
  assert.match(JSON.stringify(PENDING_CAPABILITIES), /purchaseCoinTier/);
});

test('production host runner refuses to start', async () => {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/sdk-host-harness/server.mjs'], {
    env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Local SDK host harness disabled in production/);
});

test('vendored checkout client still rejects price fields and insecure origins', () => {
  const client = createCheckoutClient({
    baseUrl: 'https://api.example.test',
    gameId: 'game-1',
    getToken: () => 'token',
    fetch: async () => new Response(JSON.stringify({ success: true, data: {} })),
  });
  assert.throws(
    () => client.purchase({ offerId: 'lives', catalogVersion: 'v1', requestId: 'r1', coins: 1 }),
    { code: 'INVALID_REQUEST' },
  );
  assert.throws(
    () => createCheckoutClient({ baseUrl: 'http://evil.test', gameId: 'game-1', getToken: () => 't' }),
    { code: 'INVALID_BASE_URL' },
  );
});
