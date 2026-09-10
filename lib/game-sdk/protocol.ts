/** postMessage contract between the trusted host and an isolated game frame. */

export const SDK_CHANNEL = 'inzone-web-sdk';
export const SDK_PROTOCOL = 1;
export const SDK_VERSION = '2.0.0-preview.1';

export const GAME_IFRAME_SANDBOX = [
  'allow-scripts',
  'allow-pointer-lock',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-forms',
  'allow-modals',
  'allow-downloads',
  'allow-orientation-lock',
  'allow-presentation',
].join(' ');

/** Supported by this web host preview. Pending methods exist on the object but reject. */
export const SUPPORTED_CAPABILITIES = Object.freeze([
  'getConfig',
  'getCapabilities',
  'getStatus',
  'getCatalog',
  'requestPurchase',
  'getInventory',
  'getReceipt',
  'saveState',
  'loadState',
]);

export const PENDING_CAPABILITIES = Object.freeze([
  'postScore',
  'sendChallenge',
  'openChat',
  'gameState',
  'purchaseCoinTier',
  'close',
]);

export type SdkRequest = {
  channel: typeof SDK_CHANNEL;
  v: number;
  id: string;
  type: 'req';
  method: string;
  payload?: unknown;
};

export type SdkErrorPayload = {
  code: string;
  message: string;
  outcomeUnknown?: boolean;
  requestId?: string;
  status?: number;
};

export type SdkResponse = {
  channel: typeof SDK_CHANNEL;
  v: number;
  id: string;
  type: 'res';
  ok: boolean;
  result?: unknown;
  error?: SdkErrorPayload;
};

export function isSdkRequest(data: unknown): data is SdkRequest {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  return d.channel === SDK_CHANNEL
    && d.v === SDK_PROTOCOL
    && d.type === 'req'
    && typeof d.id === 'string'
    && d.id.length > 0
    && d.id.length <= 100
    && typeof d.method === 'string';
}
