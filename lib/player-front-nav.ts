/**
 * Post-login return path for the player-front nav.
 *
 * The `next` value sent to `/login` must preserve the full arrival URL,
 * including the query string. Invite arrivals land on
 * `/games/<id>?session=<sessionId>`; dropping the query on the login
 * round-trip silently drops the invite — the second account lands on the
 * game but outside the conversation they were invited to.
 *
 * `search` is the raw query string including the leading `?`, or ''.
 */
export function frontNavNextPath(pathname: string, search: string): string {
  const base = pathname.startsWith('/games/')
    ? pathname
    : pathname === '/games'
      ? '/games'
      : '/';
  return search ? `${base}${search}` : base;
}
