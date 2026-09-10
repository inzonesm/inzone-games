/** Trusted-host backend origin and existing save/load proxy. Tokens stay here. */

export const DEFAULT_INZONE_API_ORIGIN = 'https://inzoneapi-912424781531.us-central1.run.app';

export function resolveInzoneApiOrigin(raw?: string | null): string {
  const value = (raw && raw.trim()) || DEFAULT_INZONE_API_ORIGIN;
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('INVALID_BASE_URL');
  }
  return url.origin;
}

export function publicApiOrigin(): string {
  return resolveInzoneApiOrigin(process.env.NEXT_PUBLIC_INZONE_API_ORIGIN);
}

const STATE_MAX_BYTES = 256 * 1024;

export type SaveLoadClient = {
  loadState(): Promise<unknown>;
  saveState(state: unknown, metadata?: unknown): Promise<unknown>;
};

export function createSaveLoadClient(options: {
  baseUrl?: string;
  gameId: string;
  getUserId: () => string | null;
  getToken: () => Promise<string | null>;
  fetch?: typeof globalThis.fetch;
}): SaveLoadClient {
  const origin = resolveInzoneApiOrigin(options.baseUrl);
  const fetcher = options.fetch ?? globalThis.fetch;

  async function headers(json = false): Promise<Record<string, string>> {
    const token = await options.getToken();
    if (!token || !token.trim()) {
      const err = Object.assign(new Error('UNAUTHENTICATED'), { code: 'UNAUTHENTICATED' });
      throw err;
    }
    const userId = options.getUserId();
    if (!userId) {
      throw Object.assign(new Error('UNAUTHENTICATED'), { code: 'UNAUTHENTICATED' });
    }
    const h: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  return {
    async loadState() {
      const userId = options.getUserId();
      if (!userId) throw Object.assign(new Error('UNAUTHENTICATED'), { code: 'UNAUTHENTICATED' });
      const url = `${origin}/api/game-sdk/state?gameId=${encodeURIComponent(options.gameId)}&userId=${encodeURIComponent(userId)}`;
      const res = await fetcher(url, { headers: await headers(), credentials: 'omit', cache: 'no-store', redirect: 'error' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || body.success !== true) {
        throw Object.assign(new Error(body?.error?.code || 'SAVE_LOAD_UNAVAILABLE'), {
          code: body?.error?.code || 'SAVE_LOAD_UNAVAILABLE',
          status: res.status,
        });
      }
      return body.data ?? body;
    },
    async saveState(state: unknown, metadata?: unknown) {
      const userId = options.getUserId();
      if (!userId) throw Object.assign(new Error('UNAUTHENTICATED'), { code: 'UNAUTHENTICATED' });
      if (state === null || typeof state !== 'object' || Array.isArray(state)) {
        throw Object.assign(new Error('INVALID_STATE'), { code: 'INVALID_STATE' });
      }
      const serialized = JSON.stringify({
        gameId: options.gameId,
        userId,
        state,
        ...(metadata && typeof metadata === 'object' ? { metadata } : {}),
      });
      if (serialized.length > STATE_MAX_BYTES) {
        throw Object.assign(new Error('STATE_TOO_LARGE'), { code: 'STATE_TOO_LARGE' });
      }
      const res = await fetcher(`${origin}/api/game-sdk/state`, {
        method: 'POST',
        headers: await headers(true),
        body: serialized,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || body.success !== true) {
        throw Object.assign(new Error(body?.error?.code || 'SAVE_LOAD_UNAVAILABLE'), {
          code: body?.error?.code || 'SAVE_LOAD_UNAVAILABLE',
          status: res.status,
        });
      }
      return body.data ?? body;
    },
  };
}
