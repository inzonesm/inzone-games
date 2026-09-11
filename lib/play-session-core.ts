/** Pure play-session helpers. Safe to import from tests and client code. */

export const MAX_PLAY_MESSAGE = 500;
export const PLAY_RATE_MS = 800;
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const SESSION_ID_RE = /^[a-f0-9]{32}$/;
export const PLAY_SESSIONS = 'playSessions';

export function validatePlayMessage(text: string): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (t.length > MAX_PLAY_MESSAGE) return null;
  return t;
}

export function sessionIsExpired(expiresAt: number, now = Date.now()): boolean {
  return !expiresAt || now >= expiresAt;
}

export function canPostAt(lastMessageAt: number, now = Date.now()): boolean {
  return now - (lastMessageAt || 0) >= PLAY_RATE_MS;
}

export function liveInviteUrl(
  origin: string,
  opts: { gameId: string; sessionId: string },
): string {
  const base = origin.endsWith('/') ? origin : `${origin}/`;
  const u = new URL('/session-prototype', base);
  if (opts.gameId) u.searchParams.set('game', opts.gameId);
  u.searchParams.set('session', opts.sessionId);
  return u.toString();
}

export function isPlaySessionId(id: string): boolean {
  return SESSION_ID_RE.test(id);
}
