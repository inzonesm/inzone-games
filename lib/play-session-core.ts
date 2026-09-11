/** Pure play-session helpers. Safe to import from tests and client code. */

export const MAX_PLAY_MESSAGE = 500;
export const MAX_PLAY_MEMBERS = 8;
/** Per-chunk cap. Conversation continues on the next chunk; this is not a lifetime limit. */
export const MAX_PLAY_CHUNK = 40;
/** Max chunks a member listener may retrieve (bounded history window). */
export const PLAY_HISTORY_CHUNKS = 2;
export const PLAY_RATE_MS = 800;
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const SESSION_ID_RE = /^[a-f0-9]{32}$/;
export const PLAY_SESSIONS = 'playSessions';
export const PLAY_CHUNKS = 'chunks';
export const PLAY_SEATS = 'seats';

/** Consumer-facing copy. Technical detail belongs in console.warn diagnostics. */
export const PLAY_SESSION_COPY = {
  createFailed: 'Couldn’t start a live session. Try again.',
  copyFailed: 'Invite is ready, but the link couldn’t be copied. Copy it from the address bar.',
  joinFailed: 'Couldn’t join this session.',
  sendFailed: 'Couldn’t send. Try again.',
  suggestFailed: 'Couldn’t send that suggestion. Try again.',
  leaveFailed: 'Couldn’t leave. Try again.',
  rateLimited: 'Wait a moment before sending again.',
  retry: 'Retry',
  copied: 'Invite link copied. Share it with one other browser.',
  left: 'You left the session.',
  suggested: 'Suggested. Nobody was moved.',
  reconnectFailed: 'Couldn’t reconnect to this session.',
  join: 'Join session',
  joinTitle: 'Join to chat',
  joinBody: 'Chat is only for people in the session.',
} as const;

export function validatePlayMessage(text: string): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (t.length > MAX_PLAY_MESSAGE) return null;
  return t;
}

export function sessionExpiresAt(createdAt: number): number {
  return createdAt + SESSION_TTL_MS;
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
