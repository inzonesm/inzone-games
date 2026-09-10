import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { bootstrapScript } from '../scripts/sdk-harness/bootstrap.mjs';
function setup(fail = false) {
  const events = [];
  const window = { dispatchEvent: e => events.push(e.type) };
  const context = vm.createContext({ window, queueMicrotask, setTimeout, clearTimeout, document: { readyState: 'complete' }, CustomEvent: class { constructor(type) { this.type = type; } } });
  const code = bootstrapScript({ fixtureMode: true, fail });
  vm.runInContext(code, context);
  return { window, events, context, code };
}
test('early/late readiness and immutable config', async () => {
  const { window: w, events } = setup();
  assert.equal(w.InZoneSDK.getStatus().state, 'initializing');
  const config = await w.InZoneSDK.getConfig();
  assert.equal(config, await w.InZoneSDK.getConfig());
  assert.equal(config.fixtureMode, true);
  assert.ok(Object.isFrozen(config));
  assert.deepEqual(events, ['inzone:sdk-ready']);
});
test('duplicate retains SDK and emits once', async () => {
  const { window: w, context, code, events } = setup();
  const sdk = w.InZoneSDK;
  vm.runInContext(code, context);
  await sdk.ready;
  vm.runInContext(code, context);
  assert.equal(w.InZoneSDK, sdk);
  assert.equal(events.length, 1);
});
test('failure rejects early/late and reaches failed', async () => {
  const { window: w, events } = setup(true);
  await assert.rejects(w.InZoneSDK.ready, { code: 'INZONE_SDK_INITIALIZATION_FAILED' });
  await assert.rejects(w.InZoneSDK.getConfig());
  assert.equal(w.InZoneSDK.getStatus().state, 'failed');
  assert.deepEqual(events, ['inzone:sdk-error']);
});
test('all exposed backend operations reject', async () => {
  const { window: w } = setup();
  for (const method of ['postScore', 'gameState', 'saveState', 'purchaseCoinTier']) {
    await assert.rejects(w.InZoneSDK[method](), { code: 'INZONE_UNSUPPORTED_CAPABILITY' });
  }
});
test('fixture opt-in and production guard', () => {
  assert.throws(() => bootstrapScript());
  const old = process.env.NODE_ENV;
  try { process.env.NODE_ENV = 'production'; assert.throws(() => bootstrapScript({ fixtureMode: true })); }
  finally { if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old; }
});
test('stalled DOM reaches failure at deadline', async () => {
  let deadline;
  const window = { dispatchEvent() {} };
  const context = vm.createContext({ window, queueMicrotask,
    setTimeout(fn) { deadline = fn; return 1; }, clearTimeout() {},
    document: { readyState: 'loading', addEventListener() {} },
    CustomEvent: class {} });
  vm.runInContext(bootstrapScript({ fixtureMode: true }), context);
  deadline();
  await assert.rejects(window.InZoneSDK.ready, { code: 'INZONE_SDK_INITIALIZATION_FAILED' });
  assert.equal(window.InZoneSDK.getStatus().state, 'failed');
});
test('production runner refuses to start', async () => {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, ['scripts/sdk-harness/server.mjs'], {
    env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8', timeout: 5000
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Local SDK harness disabled in production/);
});
