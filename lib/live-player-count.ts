/**
 * Honest "N playing" for hub cards.
 *
 * `html_games/{id}/sessions` rows with `status == 'open'` are not automatically
 * current players. Flutter writes `opened_at` / `updated_at` and does not
 * always close the doc, so a count of every open row can outlive the people
 * who opened them (Claude's calibration: ~15–16 "open" vs ~20 unique 30-day
 * users). This helper only counts a row when it is open AND recently seen.
 *
 * Sessions with no usable timestamp cannot be shown as live — the pill is
 * hidden (count 0) rather than guessed. No Firestore index or rules change:
 * callers still read the existing open-session query and filter here.
 */

/** A session is "playing now" only if last seen within this window. */
export const LIVE_SESSION_FRESHNESS_MS = 15 * 60 * 1000;

/** Tolerate a slightly-fast client clock; far-future stamps are untrusted. */
export const LIVE_SESSION_FUTURE_SKEW_MS = 2 * 60 * 1000;

function toMillis(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Seconds vs milliseconds: session stamps from this project are ms-scale
    // after 2015, or Firestore seconds (~1e9).
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const asNum = Number(trimmed);
    if (Number.isFinite(asNum) && trimmed !== '') return toMillis(asNum);
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'object') {
    const rec = value as { toMillis?: unknown; seconds?: unknown; _seconds?: unknown };
    if (typeof rec.toMillis === 'function') {
      const ms = rec.toMillis();
      return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
    }
    const seconds = rec.seconds ?? rec._seconds;
    if (typeof seconds === 'number' && Number.isFinite(seconds)) {
      return seconds * 1000;
    }
  }
  return null;
}

/** Prefer `updated_at` (heartbeat) then `opened_at`. Null = cannot date it. */
export function sessionLastSeenMs(session: Record<string, unknown>): number | null {
  return toMillis(session.updated_at) ?? toMillis(session.opened_at) ?? toMillis(session.updatedAt) ?? toMillis(session.openedAt);
}

export function isFreshOpenSession(
  session: Record<string, unknown> | null | undefined,
  now = Date.now(),
): boolean {
  if (!session || session.status !== 'open') return false;
  const seen = sessionLastSeenMs(session);
  if (seen == null) return false;
  if (seen > now + LIVE_SESSION_FUTURE_SKEW_MS) return false;
  return now - seen <= LIVE_SESSION_FRESHNESS_MS;
}

export function countFreshOpenSessions(
  sessions: Array<Record<string, unknown> | null | undefined>,
  now = Date.now(),
): number {
  let n = 0;
  for (const session of sessions) {
    if (isFreshOpenSession(session, now)) n += 1;
  }
  return n;
}
