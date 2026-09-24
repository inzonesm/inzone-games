/**
 * Pure builders for a game page's SEO metadata.
 *
 * Kept off the server module so the same functions can be unit-tested without
 * booting firebase-admin, and so the layout / sitemap / robots files stay thin
 * wrappers around a testable core.
 */

export const SITE_ORIGIN = 'https://inzone.games';

export type SeoGame = {
  name: string;
  description: string;
  iconUrl: string;
};

const DEFAULT_HUB_DESCRIPTION =
  'Play free browser games and chat with friends live on InZone. No install required.';

/** The path a game lives at on the hub. Encodes the id. */
export function gameCanonicalPath(id: string): string {
  return `/games/${encodeURIComponent(id)}`;
}

export function gameCanonicalUrl(id: string, origin: string = SITE_ORIGIN): string {
  return `${origin}${gameCanonicalPath(id)}`;
}

/** The <title> for one game page. Falls back to the hub default when the game
 *  has no name (which shouldn't happen for an approved game, but degrading here
 *  keeps a partial Firestore doc from producing a broken title). */
export function buildGameTitle(game: SeoGame | null): string {
  if (!game || !game.name.trim()) return 'Play Free Browser Games on InZone';
  return `${game.name.trim()} — Play Free on InZone`;
}

/** The meta description. Prefer the stored one, fall back to a name-derived
 *  fill so every page carries a unique description even when the developer
 *  left the field empty. */
export function buildGameDescription(game: SeoGame | null): string {
  if (!game || !game.name.trim()) return DEFAULT_HUB_DESCRIPTION;
  const stored = game.description.trim();
  if (stored) return stored;
  return `Play ${game.name.trim()} free on InZone — a browser game you can start in one tap, no install required.`;
}

/** The VideoGame JSON-LD block Google reads for rich results. Returns null when
 *  we don't have enough data to make an honest claim about the game (name is
 *  the minimum), so we never emit `@type: VideoGame` with no name. */
export function buildGameJsonLd(
  id: string,
  game: SeoGame | null,
  origin: string = SITE_ORIGIN,
): Record<string, unknown> | null {
  if (!game || !game.name.trim()) return null;
  const url = gameCanonicalUrl(id, origin);
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: game.name.trim(),
    description: buildGameDescription(game),
    url,
    image: game.iconUrl.trim() || undefined,
    applicationCategory: 'GameApplication',
    operatingSystem: 'Web browser',
    genre: 'Browser Game',
    playMode: 'SinglePlayer',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url,
    },
  };
}

export type SitemapEntry = {
  url: string;
  lastModified: Date;
  changeFrequency:
    | 'always'
    | 'hourly'
    | 'daily'
    | 'weekly'
    | 'monthly'
    | 'yearly'
    | 'never';
  priority: number;
};

/** Compose the sitemap from the discovered game ids. Static routes always
 *  come first so a Firestore hiccup at build time still produces a valid
 *  sitemap for the homepage and the hub. */
export function buildSitemap(
  gameIds: readonly string[],
  now: Date = new Date(),
  origin: string = SITE_ORIGIN,
): SitemapEntry[] {
  const seen = new Set<string>();
  const uniqueIds = gameIds.filter((id) => {
    if (typeof id !== 'string') return false;
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) return false;
    seen.add(trimmed);
    return true;
  });
  const staticRoutes: SitemapEntry[] = [
    { url: `${origin}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${origin}/games`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
  ];
  const gameRoutes: SitemapEntry[] = uniqueIds.map((id) => ({
    url: gameCanonicalUrl(id, origin),
    lastModified: now,
    changeFrequency: 'weekly',
    priority: 0.7,
  }));
  return [...staticRoutes, ...gameRoutes];
}
