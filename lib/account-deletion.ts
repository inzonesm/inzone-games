/**
 * Client for the InZone account deletion API (inzone-backend
 * routes/user/account_management.py). Ownership is proven by a Firebase ID
 * token from a fresh sign-in; the backend takes the uid from the token and
 * rejects a body UID that differs. The UID is also sent so this page works
 * against a backend that predates token verification.
 *
 * No analytics are emitted from this flow.
 */

export const DELETION_WINDOW_DAYS = 30;

export type DeletionStatus = 'none' | 'pending_window' | 'processing' | 'failed' | 'completed' | 'needs_attention';

export interface DeletionState {
  status: DeletionStatus;
  requestedAt: string | null;
  purgeAfter: string | null;
  completedAt: string | null;
}

export type DeletionErrorCode =
  | 'requires_recent_login'
  | 'auth_required'
  | 'invalid_token'
  | 'token_revoked'
  | 'uid_mismatch'
  | 'deletion_in_progress'
  | 'network'
  | 'server';

export class DeletionApiError extends Error {
  code: DeletionErrorCode;
  status?: number;

  constructor(code: DeletionErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'DeletionApiError';
    this.code = code;
    this.status = status;
  }
}

type Fetch = typeof fetch;

const KNOWN_STATUSES: DeletionStatus[] = ['none', 'pending_window', 'processing', 'failed', 'completed', 'needs_attention'];

export function parseDeletionState(body: unknown): DeletionState {
  const b = (body ?? {}) as Record<string, unknown>;
  const raw = typeof b.status === 'string' ? b.status : 'none';
  const status = (KNOWN_STATUSES as string[]).includes(raw) ? (raw as DeletionStatus) : 'processing';
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return { status, requestedAt: str(b.requestedAt), purgeAfter: str(b.purgeAfter), completedAt: str(b.completedAt) };
}

function errorFrom(status: number, body: Record<string, unknown>): DeletionApiError {
  const code = typeof body.code === 'string' ? body.code : '';
  const message = typeof body.error === 'string' && body.error ? body.error : 'Something went wrong. Try again.';
  const known: DeletionErrorCode[] = ['requires_recent_login', 'auth_required', 'invalid_token', 'token_revoked', 'uid_mismatch', 'deletion_in_progress'];
  if ((known as string[]).includes(code)) return new DeletionApiError(code as DeletionErrorCode, message, status);
  if (status === 401) return new DeletionApiError('invalid_token', message, status);
  return new DeletionApiError('server', message, status);
}

async function call(
  fetchImpl: Fetch,
  origin: string,
  path: string,
  init: { method: 'GET' | 'POST'; idToken: string; uid: string; body?: Record<string, unknown> },
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    const url = init.method === 'GET' ? `${origin}${path}?uid=${encodeURIComponent(init.uid)}` : `${origin}${path}`;
    res = await fetchImpl(url, {
      method: init.method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${init.idToken}` },
      body: init.method === 'POST' ? JSON.stringify({ UID: init.uid, ...(init.body ?? {}) }) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch {
    throw new DeletionApiError('network', 'Could not reach InZone. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok || body.success === false) throw errorFrom(res.status, body);
  return body;
}

export interface DeletionClientOptions {
  origin: string;
  fetchImpl?: Fetch;
  timeoutMs?: number;
}

export function createDeletionClient({ origin, fetchImpl = fetch, timeoutMs = 20000 }: DeletionClientOptions) {
  const base = origin.replace(/\/+$/, '');
  return {
    async status(idToken: string, uid: string): Promise<DeletionState> {
      return parseDeletionState(await call(fetchImpl, base, '/user/account-deletion-status', { method: 'GET', idToken, uid }, timeoutMs));
    },
    /** Idempotent: safe to retry after a timeout or a lost response. */
    async request(idToken: string, uid: string): Promise<DeletionState> {
      return parseDeletionState(
        await call(fetchImpl, base, '/user/request-account-deletion', { method: 'POST', idToken, uid, body: { source: 'web' } }, timeoutMs),
      );
    },
    async cancel(idToken: string, uid: string): Promise<void> {
      await call(fetchImpl, base, '/user/reactivate-account', { method: 'POST', idToken, uid, body: { cancelPendingDeletion: true } }, timeoutMs);
    },
  };
}

export function formatDeletionDate(iso: string | null, locale?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
}
