import type { HubGame } from './types';

/** Firestore `html_games` document ids used to seed player-home shelves. */
export type GameSlug = string;

/**
 * Featured hero is the first slug in this list (a single catalog id).
 * Titles are never hardcoded — resolve against `fetchApprovedGames()`.
 */
export const FEATURED_HERO: readonly GameSlug[] = ['snake'];

/** Games that work well as a two-player icebreaker (invite loop). */
export const PLAY_WITH_A_FRIEND: readonly GameSlug[] = [
  'nightclub-showdown-inzone-production',
  'snake',
  '2048-inzone-upload',
];

export const TRENDING: readonly GameSlug[] = [
  '2048-inzone-upload',
  'snake',
  'clcookieclicker',
];

export const NEW: readonly GameSlug[] = [
  'clcookieclicker',
  '2048-inzone-upload',
  'snake',
];

export const HOME_ROW_DEFS = [
  { id: 'play-with-a-friend', title: 'Play with a friend', slugs: PLAY_WITH_A_FRIEND },
  { id: 'trending', title: 'Trending', slugs: TRENDING },
  { id: 'new', title: 'New', slugs: NEW },
] as const;

export type HomeRowId = (typeof HOME_ROW_DEFS)[number]['id'];

export interface HomeRow {
  id: HomeRowId;
  title: string;
  games: HubGame[];
}

export function featuredHeroSlug(): GameSlug {
  return FEATURED_HERO[0];
}

/**
 * Resolve catalog docs for a slug list. Missing ids are skipped with a warning
 * so a stale seed cannot blank the whole shelf.
 */
export function gamesForSlugs(games: HubGame[], slugs: readonly GameSlug[]): HubGame[] {
  if (games.length === 0) return [];
  const byId = new Map(games.map((game) => [game.id, game]));
  const out: HubGame[] = [];
  for (const slug of slugs) {
    const hit = byId.get(slug);
    if (!hit) {
      console.warn(`[home-rows] skipping unknown game slug: ${slug}`);
      continue;
    }
    out.push(hit);
  }
  return out;
}

export function resolveHomeRows(games: HubGame[]): {
  hero: HubGame | null;
  rows: HomeRow[];
} {
  const heroList = gamesForSlugs(games, FEATURED_HERO);
  return {
    hero: heroList[0] ?? null,
    rows: HOME_ROW_DEFS.map((def) => ({
      id: def.id,
      title: def.title,
      games: gamesForSlugs(games, def.slugs),
    })),
  };
}
