// Imported only by the local runner. Never by the production game route.
export function bootstrapScript({ fixtureMode, fail = false } = {}) {
  if (process.env.NODE_ENV === 'production' || fixtureMode !== true) {
    throw new Error('SDK harness requires explicit non-production fixture mode');
  }
  return `(${install.toString()})(${JSON.stringify({ fail: fail === true })});`;
}

function install(options) {
  if (window.__inzoneSdkBootstrap) return;
  // Do not overwrite an SDK owned by a game or another host.
  if (window.InZoneSDK) throw new Error('Existing InZoneSDK would be overwritten');
  window.__inzoneSdkBootstrap = true;
  let status = 'initializing';
  let failure = null;
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // A late subscriber may inspect a failed SDK without an unhandled rejection.
  ready.catch(() => {});
  const config = Object.freeze({ fixtureMode: true, gameId: 'development-harness',
    capabilities: Object.freeze(['getConfig']) });
  const unsupported = () => Promise.reject(Object.assign(
    new Error('Backend capability unavailable in the browser bootstrap proof'),
    { code: 'INZONE_UNSUPPORTED_CAPABILITY' }));
  const sdk = { ready, getConfig: () => ready,
    getStatus: () => ({ state: status, error: failure }),
    postScore: unsupported, gameState: unsupported, saveState: unsupported,
    purchaseCoinTier: unsupported };
  window.InZoneSDK = Object.freeze(sdk);
  // Wait for the fixture DOM so its inline scripts can subscribe early.
  // A deadline also terminates readiness if DOM completion stalls.
  let timer;
  const settle = (timedOut = false) => {
    if (status !== 'initializing') return;
    clearTimeout(timer);
    if (options.fail || timedOut) {
      status = 'failed';
      failure = Object.freeze({ code: 'INZONE_SDK_INITIALIZATION_FAILED' });
      rejectReady(Object.assign(new Error(timedOut ? 'Fixture initialization deadline exceeded' : 'Deliberate fixture failure'), failure));
      window.dispatchEvent(new CustomEvent('inzone:sdk-error', { detail: failure }));
      return;
    }
    status = 'ready';
    window.__INZONE_SOCIAL_LOOP_CONFIG__ = config;
    resolveReady(config);
    window.dispatchEvent(new CustomEvent('inzone:sdk-ready', { detail: config }));
  };
  timer = setTimeout(() => settle(true), 2000);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => settle(), { once: true });
  } else { queueMicrotask(() => settle()); }
}
