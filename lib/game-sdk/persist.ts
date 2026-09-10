/** Account- and game-scoped pending checkout request persistence. */

export type PendingPurchase = {
  accountId: string;
  gameId: string;
  offerId: string;
  catalogVersion: string;
  requestId: string;
  status: 'submitted' | 'uncertain';
  createdAt: number;
};

export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export const PENDING_STORAGE_KEY = 'inzone.checkout.pending.v1';

type PendingMap = Record<string, PendingPurchase>;

function slotKey(accountId: string, gameId: string): string {
  return `${accountId}\n${gameId}`;
}

function readMap(store: KeyValueStore): PendingMap {
  try {
    const raw = store.getItem(PENDING_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as PendingMap;
  } catch {
    return {};
  }
}

function writeMap(store: KeyValueStore, map: PendingMap): void {
  store.setItem(PENDING_STORAGE_KEY, JSON.stringify(map));
}

export function readPending(
  store: KeyValueStore,
  accountId: string,
  gameId: string,
): PendingPurchase | null {
  if (!accountId || !gameId) return null;
  const row = readMap(store)[slotKey(accountId, gameId)];
  if (!row || row.accountId !== accountId || row.gameId !== gameId) return null;
  if (typeof row.requestId !== 'string' || typeof row.offerId !== 'string') return null;
  if (typeof row.catalogVersion !== 'string') return null;
  return row;
}

export function writePending(store: KeyValueStore, pending: PendingPurchase): void {
  const map = readMap(store);
  map[slotKey(pending.accountId, pending.gameId)] = pending;
  writeMap(store, map);
}

export function clearPending(store: KeyValueStore, accountId: string, gameId: string): void {
  const map = readMap(store);
  delete map[slotKey(accountId, gameId)];
  writeMap(store, map);
}

export function createMemoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = { ...initial };
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = value; },
    removeItem: (key) => { delete data[key]; },
  };
}
