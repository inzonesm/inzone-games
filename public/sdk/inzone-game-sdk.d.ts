export type InZoneSdkError = Error & {
  code: string;
  outcomeUnknown?: boolean;
  requestId?: string;
  status?: number;
};

export type InZoneWebSdkConfig = {
  sdkVersion: string;
  protocol: number;
  gameId: string;
  fixtureMode: boolean;
  isolation: 'opaque-origin-frame';
  capabilities: readonly string[];
  pendingCapabilities: readonly string[];
  signedIn?: boolean;
};

export type InZoneCatalogOffer = {
  id: string;
  title: string;
  kind: 'durable' | 'consumable';
  coins: number;
  quantity: number;
};

export type InZoneCatalog = {
  gameId: string;
  version: string;
  offers: InZoneCatalogOffer[];
};

export type InZoneReceipt = {
  transactionId: string;
  gameId: string;
  offerId: string;
  catalogVersion: string;
  coins: number;
  currency: 'Coin';
  newBalance: number;
  entitlement: {
    gameId: string;
    offerId: string;
    kind: 'durable' | 'consumable';
    quantity: number;
    transactionId: string;
  };
};

export type InZoneInventory = {
  gameId: string;
  offerId: string;
  owned: boolean;
  quantity: number;
  kind?: 'durable' | 'consumable';
  transactionId?: string;
};

export interface InZoneWebSdk {
  ready: Promise<InZoneWebSdkConfig>;
  getConfig(): Promise<InZoneWebSdkConfig>;
  getStatus(): { state: 'initializing' | 'ready' | 'failed'; error: { code: string } | null };
  getCapabilities(): Promise<{ supported: readonly string[]; pending: readonly string[] }>;
  getCatalog(): Promise<InZoneCatalog>;
  requestPurchase(input: { offerId: string }): Promise<InZoneReceipt>;
  getInventory(input: { offerId: string }): Promise<InZoneInventory>;
  getReceipt(input: { requestId: string }): Promise<InZoneReceipt>;
  saveState(input: { state: object; metadata?: object } | object): Promise<unknown>;
  loadState(): Promise<unknown>;
  postScore(payload?: unknown): Promise<never>;
  sendChallenge(payload?: unknown): Promise<never>;
  openChat(payload?: unknown): Promise<never>;
  gameState(payload?: unknown): Promise<never>;
  purchaseCoinTier(coins?: unknown, payload?: unknown): Promise<never>;
  close(): Promise<never>;
}

declare global {
  interface Window {
    InZoneSDK?: InZoneWebSdk;
    __INZONE_SOCIAL_LOOP_CONFIG__?: InZoneWebSdkConfig;
  }
}

export {};
