import { PENDING_CAPABILITIES, SDK_VERSION, SUPPORTED_CAPABILITIES } from './protocol.ts';

export const GAME_SDK_BOOTSTRAP_MARKER = '__inzoneWebSdk';

const INSTALL_SOURCE = String.raw`
(function (config) {
  if (window.__inzoneWebSdk) return;
  if (window.InZoneSDK) return;
  window.__inzoneWebSdk = true;

  var status = 'initializing';
  var failure = null;
  var resolveReady, rejectReady;
  var ready = new Promise(function (resolve, reject) {
    resolveReady = resolve;
    rejectReady = reject;
  });
  ready.catch(function () {});

  var pending = new Map();
  var seq = 0;
  var targetOrigin = location.origin && location.origin !== 'null' ? location.origin : '*';

  function sdkError(code, extra) {
    var err = new Error(code);
    err.code = code;
    if (extra) {
      for (var key in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, key)) err[key] = extra[key];
      }
    }
    return err;
  }

  function callHost(method, payload) {
    if (window.parent === window) {
      return Promise.reject(sdkError('INZONE_HOST_UNAVAILABLE'));
    }
    return new Promise(function (resolve, reject) {
      var id = 'c' + String(++seq);
      var timer = setTimeout(function () {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(sdkError('INZONE_HOST_TIMEOUT'));
      }, 120000);
      pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      parent.postMessage({
        channel: 'inzone-web-sdk',
        v: 1,
        id: id,
        type: 'req',
        method: method,
        payload: payload || {}
      }, targetOrigin);
    });
  }

  window.addEventListener('message', function (event) {
    if (event.source !== parent) return;
    var data = event.data;
    if (!data || data.channel !== 'inzone-web-sdk' || data.type !== 'res') return;
    var waiter = pending.get(data.id);
    if (!waiter) return;
    pending.delete(data.id);
    clearTimeout(waiter.timer);
    if (data.ok) waiter.resolve(data.result);
    else {
      var code = data.error && data.error.code ? data.error.code : 'INZONE_HOST_ERROR';
      waiter.reject(sdkError(code, data.error || {}));
    }
  });

  function unsupported() {
    return Promise.reject(sdkError('INZONE_UNSUPPORTED_CAPABILITY'));
  }

  var localConfig = Object.freeze({
    sdkVersion: config.sdkVersion,
    protocol: 1,
    gameId: config.gameId,
    fixtureMode: false,
    isolation: 'opaque-origin-frame',
    capabilities: Object.freeze(config.capabilities),
    pendingCapabilities: Object.freeze(config.pendingCapabilities)
  });

  var sdk = {
    ready: ready,
    getConfig: function () { return ready; },
    getStatus: function () { return { state: status, error: failure }; },
    getCapabilities: function () {
      return Promise.resolve({
        supported: localConfig.capabilities,
        pending: localConfig.pendingCapabilities
      });
    },
    getCatalog: function () { return callHost('getCatalog'); },
    requestPurchase: function (payload) { return callHost('requestPurchase', payload); },
    getInventory: function (payload) { return callHost('getInventory', payload); },
    getReceipt: function (payload) { return callHost('getReceipt', payload); },
    saveState: function (payload) { return callHost('saveState', payload); },
    loadState: function (payload) { return callHost('loadState', payload); },
    postScore: unsupported,
    sendChallenge: unsupported,
    openChat: unsupported,
    gameState: unsupported,
    purchaseCoinTier: unsupported,
    close: unsupported
  };

  window.InZoneSDK = Object.freeze(sdk);

  var settled = false;
  function succeed(hostConfig) {
    if (settled) return;
    settled = true;
    status = 'ready';
    var merged = Object.freeze(Object.assign({}, localConfig, hostConfig || {}));
    window.__INZONE_SOCIAL_LOOP_CONFIG__ = merged;
    resolveReady(merged);
    window.dispatchEvent(new CustomEvent('inzone:sdk-ready', { detail: merged }));
  }

  callHost('getConfig').then(succeed, function () {
    succeed(localConfig);
  });
})
`;

export function gameSdkBootstrapScript(gameId: string): string {
  const config = {
    gameId,
    sdkVersion: SDK_VERSION,
    capabilities: SUPPORTED_CAPABILITIES,
    pendingCapabilities: PENDING_CAPABILITIES,
  };
  return `(${INSTALL_SOURCE.trim()})(${JSON.stringify(config)});`;
}

export function gameSdkBootstrapTag(gameId: string): string {
  return `<script id="__inzone-web-sdk">${gameSdkBootstrapScript(gameId)}</script>`;
}
