import type { Catalog, Inventory, Offer, Purchase, Receipt } from './checkout-types.ts';
import { HostSdkError, toSdkError } from './errors.ts';
import { clearPending, readPending, writePending, type KeyValueStore, type PendingPurchase } from './persist.ts';

export type CheckoutPort = {
  getCatalog(): Promise<Catalog>;
  purchase(input: Purchase): Promise<Receipt>;
  getReceipt(requestId: string): Promise<Receipt>;
  getInventory(offerId: string): Promise<Inventory>;
};

export type CatalogOfferPrompt = {
  offerId: string;
  title: string;
  kind: Offer['kind'];
  coins: number;
  quantity: number;
  currency: 'Coin';
  catalogVersion: string;
};

export type PurchaseControllerOptions = {
  accountId: string | null;
  gameId: string;
  client: CheckoutPort;
  store: KeyValueStore;
  confirm: (prompt: CatalogOfferPrompt) => Promise<boolean>;
  now?: () => number;
  randomId?: () => string;
};

const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

function requireId(value: unknown, code = 'INVALID_IDENTIFIER'): string {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new HostSdkError(code);
  return value;
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `r_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
  }
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function serialize<T>(gate: { chain: Promise<unknown> }, fn: () => Promise<T>): Promise<T> {
  const run = gate.chain.then(fn, fn);
  gate.chain = run.then(() => undefined, () => undefined);
  return run;
}

function offerPrompt(catalog: Catalog, offer: Offer): CatalogOfferPrompt {
  return {
    offerId: offer.id,
    title: offer.title,
    kind: offer.kind,
    coins: offer.coins,
    quantity: offer.quantity,
    currency: 'Coin',
    catalogVersion: catalog.version,
  };
}

function sameBinding(pending: PendingPurchase, offerId: string, catalogVersion: string): boolean {
  return pending.offerId === offerId && pending.catalogVersion === catalogVersion;
}

export function createPurchaseController(options: PurchaseControllerOptions) {
  const gate = { chain: Promise.resolve() as Promise<unknown> };
  const now = options.now ?? (() => Date.now());
  const randomId = options.randomId ?? newRequestId;

  function requireAccount(): string {
    if (!options.accountId) throw new HostSdkError('UNAUTHENTICATED');
    return options.accountId;
  }

  async function recoverIfPossible(pending: PendingPurchase): Promise<Receipt | null> {
    try {
      const receipt = await options.client.getReceipt(pending.requestId);
      clearPending(options.store, pending.accountId, pending.gameId);
      return receipt;
    } catch (error) {
      const mapped = toSdkError(error);
      if (mapped.outcomeUnknown) {
        writePending(options.store, { ...pending, status: 'uncertain' });
        throw new HostSdkError(mapped.code, {
          outcomeUnknown: true,
          requestId: pending.requestId,
          status: mapped.status,
          message: mapped.message,
        });
      }
      if (mapped.code === 'NOT_FOUND' || mapped.code === 'PURCHASE_NOT_FOUND' || mapped.status === 404) {
        return null;
      }
      throw mapped;
    }
  }

  async function dispatchPurchase(pending: PendingPurchase): Promise<Receipt> {
    writePending(options.store, pending);
    try {
      const receipt = await options.client.purchase({
        offerId: pending.offerId,
        catalogVersion: pending.catalogVersion,
        requestId: pending.requestId,
      });
      clearPending(options.store, pending.accountId, pending.gameId);
      return receipt;
    } catch (error) {
      const mapped = toSdkError(error);
      if (mapped.outcomeUnknown) {
        writePending(options.store, { ...pending, status: 'uncertain' });
        throw new HostSdkError(mapped.code, {
          outcomeUnknown: true,
          requestId: pending.requestId,
          status: mapped.status,
          message: mapped.message,
        });
      }
      if (mapped.code === 'OFFER_CHANGED') {
        clearPending(options.store, pending.accountId, pending.gameId);
        throw mapped;
      }
      // Definite failure (insufficient balance, disabled, validation): drop the
      // binding so a later attempt can mint a new ID after a new confirmation.
      clearPending(options.store, pending.accountId, pending.gameId);
      throw mapped;
    }
  }

  return {
    getCatalog() {
      return serialize(gate, () => options.client.getCatalog());
    },

    getInventory(payload: unknown) {
      return serialize(gate, async () => {
        requireAccount();
        const offerId = requireId(
          payload && typeof payload === 'object' ? (payload as { offerId?: unknown }).offerId : payload,
        );
        return options.client.getInventory(offerId);
      });
    },

    getReceipt(payload: unknown) {
      return serialize(gate, async () => {
        const accountId = requireAccount();
        const requestId = requireId(
          payload && typeof payload === 'object' ? (payload as { requestId?: unknown }).requestId : payload,
        );
        const pending = readPending(options.store, accountId, options.gameId);
        try {
          const receipt = await options.client.getReceipt(requestId);
          if (pending?.requestId === requestId) {
            clearPending(options.store, accountId, options.gameId);
          }
          return receipt;
        } catch (error) {
          const mapped = toSdkError(error);
          if (mapped.outcomeUnknown && pending?.requestId === requestId) {
            writePending(options.store, { ...pending, status: 'uncertain' });
          }
          throw mapped;
        }
      });
    },

    requestPurchase(payload: unknown) {
      return serialize(gate, async () => {
        const accountId = requireAccount();
        const offerId = requireId(
          payload && typeof payload === 'object' ? (payload as { offerId?: unknown }).offerId : undefined,
          'INVALID_OFFER',
        );
        const pending = readPending(options.store, accountId, options.gameId);
        const catalog = await options.client.getCatalog();
        if (catalog.gameId && catalog.gameId !== options.gameId) {
          throw new HostSdkError('GAME_MISMATCH');
        }
        const offer = catalog.offers.find((item) => item.id === offerId);
        if (!offer) throw new HostSdkError('OFFER_NOT_FOUND');

        if (pending) {
          if (!sameBinding(pending, offerId, catalog.version)) {
            throw new HostSdkError('PENDING_RECOVERY_REQUIRED', {
              requestId: pending.requestId,
              message: 'Recover the persisted request before starting a different purchase',
            });
          }
          const recovered = await recoverIfPossible(pending);
          if (recovered) return recovered;
          return dispatchPurchase(pending);
        }

        const accepted = await options.confirm(offerPrompt(catalog, offer));
        if (!accepted) throw new HostSdkError('PURCHASE_CANCELLED');

        const next: PendingPurchase = {
          accountId,
          gameId: options.gameId,
          offerId,
          catalogVersion: catalog.version,
          requestId: randomId(),
          status: 'submitted',
          createdAt: now(),
        };
        requireId(next.requestId);
        return dispatchPurchase(next);
      });
    },
  };
}
