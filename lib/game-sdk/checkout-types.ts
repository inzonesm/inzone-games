/** Shapes from @inzone/checkout-host-client 0.1.0-preview.1 (backend PR #11). */

export type Offer = {
  id: string;
  title: string;
  kind: 'durable' | 'consumable';
  coins: number;
  quantity: number;
};

export type Catalog = { gameId: string; version: string; offers: Offer[] };

export type Entitlement = {
  gameId: string;
  offerId: string;
  kind: 'durable' | 'consumable';
  quantity: number;
  transactionId: string;
};

export type Receipt = {
  transactionId: string;
  gameId: string;
  offerId: string;
  catalogVersion: string;
  coins: number;
  currency: 'Coin';
  commissionCoins: number;
  developerCoins: number;
  newBalance: number;
  entitlement: Entitlement;
};

export type Inventory = {
  gameId: string;
  offerId: string;
  owned: boolean;
  quantity: number;
  kind?: 'durable' | 'consumable';
  transactionId?: string;
};

export type Purchase = { offerId: string; catalogVersion: string; requestId: string };
