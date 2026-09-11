/**
 * Map legacy /session-prototype query URLs onto the unified player.
 * Next.js `redirects()` cannot interpolate a query value into a path
 * segment, so a route handler uses this helper and issues 308.
 *
 * Fresh invites use `/games/{id}?session=`. Keep this mapping until
 * legacy clipboard / campaign traffic is ~0 (target: two weeks after
 * the follow-up PR merges), then delete the helper and route.
 */

const PASSTHROUGH_DROP = new Set(['game']);

export function sessionPrototypeRedirectPath(search: URLSearchParams | string): string {
  const params = typeof search === 'string'
    ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    : new URLSearchParams(search);
  const game = (params.get('game') || '').trim();
  const next = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    if (PASSTHROUGH_DROP.has(key)) continue;
    next.append(key, value);
  }
  const qs = next.toString();
  if (game) {
    return qs ? `/games/${encodeURIComponent(game)}?${qs}` : `/games/${encodeURIComponent(game)}`;
  }
  return qs ? `/?${qs}` : '/';
}

export const SESSION_PROTOTYPE_REDIRECT_STATUS = 308 as const;

export function sessionPrototypeRedirectLocation(origin: string, search: URLSearchParams | string): string {
  const dest = sessionPrototypeRedirectPath(search);
  const base = origin.endsWith('/') ? origin : `${origin}/`;
  return new URL(dest, base).toString();
}
