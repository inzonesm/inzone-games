import type { Catalog, Inventory, Receipt } from './checkout-types.ts';
import { HostSdkError } from './errors.ts';
import type { CheckoutPort } from './purchase-session.ts';

export type FixtureCheckoutControl = {
  catalog: Catalog;
  failNextPurchase: null | 'network' | 'disabled' | 'changed' | 'balance' | 'hang-post';
  purchasePosts: number;
  receiptGets: number;
  lastPurchaseBody: { offerId: string; catalogVersion: string; requestId: string } | null;
  receipts: Map<string, Receipt>;
  inventory: Map<string, Inventory>;
  committedRequestIds: Set<string>;
};

function receiptFor(
  gameId: string,
  input: { offerId: string; catalogVersion: string; requestId: string },
  offer: Catalog['offers'][number],
  transactionId: string,
): Receipt {
  return {
    transactionId,
    gameId,
    offerId: input.offerId,
    catalogVersion: input.catalogVersion,
    coins: offer.coins,
    currency: 'Coin',
    commissionCoins: 0,
    developerCoins: offer.coins,
    newBalance: 0,
    entitlement: {
      gameId,
      offerId: offer.id,
      kind: offer.kind,
      quantity: offer.quantity,
      transactionId,
    },
  };
}

export const FIXTURE_CATALOG = (gameId: string): Catalog => ({
  gameId,
  version: 'fixture-v1',
  offers: [
    { id: 'extra-lives', title: 'Extra lives', kind: 'consumable', coins: 10, quantity: 3 },
    { id: 'golden-badge', title: 'Golden badge', kind: 'durable', coins: 50, quantity: 1 },
  ],
});

export function createFixtureCheckoutClient(gameId: string, control?: Partial<FixtureCheckoutControl>): {
  client: CheckoutPort;
  control: FixtureCheckoutControl;
} {
  const state: FixtureCheckoutControl = {
    catalog: FIXTURE_CATALOG(gameId),
    failNextPurchase: null,
    purchasePosts: 0,
    receiptGets: 0,
    lastPurchaseBody: null,
    receipts: new Map(),
    inventory: new Map(),
    committedRequestIds: new Set(),
    ...control,
  };

  const client: CheckoutPort = {
    async getCatalog() {
      return {
        ...state.catalog,
        offers: state.catalog.offers.map((offer) => ({ ...offer })),
      };
    },
    async purchase(input) {
      state.purchasePosts += 1;
      state.lastPurchaseBody = { ...input };
      const mode = state.failNextPurchase;
      state.failNextPurchase = null;
      if (mode === 'hang-post') {
        return new Promise(() => {});
      }
      if (mode === 'network') {
        const offer = state.catalog.offers.find((item) => item.id === input.offerId);
        if (offer && input.catalogVersion === state.catalog.version) {
          const transactionId = `tx_${input.requestId}`;
          const rec = receiptFor(gameId, input, offer, transactionId);
          state.receipts.set(input.requestId, rec);
          state.committedRequestIds.add(input.requestId);
        }
        throw new HostSdkError('NETWORK_ERROR', { outcomeUnknown: true });
      }
      if (mode === 'disabled') {
        throw new HostSdkError('CHECKOUT_DISABLED', { status: 404 });
      }
      if (mode === 'changed') {
        throw new HostSdkError('OFFER_CHANGED', { status: 409 });
      }
      if (mode === 'balance') {
        throw new HostSdkError('INSUFFICIENT_BALANCE', { status: 400 });
      }
      if (state.receipts.has(input.requestId) || state.committedRequestIds.has(input.requestId)) {
        const existing = state.receipts.get(input.requestId);
        if (existing) return existing;
      }
      const offer = state.catalog.offers.find((item) => item.id === input.offerId);
      if (!offer || input.catalogVersion !== state.catalog.version) {
        throw new HostSdkError('OFFER_CHANGED', { status: 409 });
      }
      const transactionId = `tx_${input.requestId}`;
      const rec = receiptFor(gameId, input, offer, transactionId);
      state.receipts.set(input.requestId, rec);
      state.committedRequestIds.add(input.requestId);
      const prev = state.inventory.get(offer.id);
      const quantity = offer.kind === 'consumable'
        ? (prev?.quantity ?? 0) + offer.quantity
        : offer.quantity;
      state.inventory.set(offer.id, {
        gameId,
        offerId: offer.id,
        owned: true,
        quantity,
        kind: offer.kind,
        transactionId,
      });
      return rec;
    },
    async getReceipt(requestId) {
      state.receiptGets += 1;
      const rec = state.receipts.get(requestId);
      if (!rec) throw new HostSdkError('PURCHASE_NOT_FOUND', { status: 404 });
      return rec;
    },
    async getInventory(offerId) {
      return state.inventory.get(offerId) ?? {
        gameId,
        offerId,
        owned: false,
        quantity: 0,
      };
    },
  };

  return { client, control: state };
}
