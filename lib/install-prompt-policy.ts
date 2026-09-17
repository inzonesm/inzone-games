/** Suppression policy for the PWA install banner.
 *
 * See `components/InstallPrompt.tsx` for the surrounding component and the
 * rationale. This file exists so the predicate is loadable by
 * `node --experimental-strip-types` — a `.tsx` file cannot be. Keep the
 * logic here and the copy of the policy inline in InstallPrompt.tsx in sync. */

/** True on any route that belongs to the initial playing journey — the
 *  homepage, the catalog, and the game player. */
export function isOnPlayingJourney(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === '/') return true;
  if (pathname === '/games') return true;
  if (pathname.startsWith('/games/')) return true;
  return false;
}
