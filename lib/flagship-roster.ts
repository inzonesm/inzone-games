import type { HubGame } from './types.ts';

/**
 * Approved InZone web flagship roster.
 *
 * This is the product set for the spoken companion, ordinary-play
 * verification, and daily usage reporting. Titles are catalog ids from
 * `html_games`, not a new product direction. Hub presentation still uses
 * the existing Game Hub visual system.
 */
export const FLAGSHIP_ROSTER = [
  { id: 'kart-bros', title: 'Kart Bros' },
  { id: 'clelytraflight', title: 'Elytra Flight' },
  { id: 'karate-bros', title: 'Karate Bros' },
  { id: 'clescaperoad', title: 'Escape Road' },
  { id: 'nightclub-showdown-inzone-production', title: 'Nightclub Showdown' },
] as const;

export type FlagshipId = (typeof FLAGSHIP_ROSTER)[number]['id'];

export const FLAGSHIP_IDS: readonly FlagshipId[] = FLAGSHIP_ROSTER.map((item) => item.id);

const FLAGSHIP_ID_SET = new Set<string>(FLAGSHIP_IDS);

export function isFlagshipId(id: string): id is FlagshipId {
  return FLAGSHIP_ID_SET.has(id);
}

export function flagshipTitle(id: string): string | null {
  return FLAGSHIP_ROSTER.find((item) => item.id === id)?.title ?? null;
}

/**
 * Resolve roster cards from the live approved catalogue.
 * Missing ids are skipped so a stale slug cannot blank the hub.
 */
export function gamesForFlagship(games: HubGame[]): HubGame[] {
  if (games.length === 0) return [];
  const byId = new Map(games.map((game) => [game.id, game]));
  const out: HubGame[] = [];
  for (const item of FLAGSHIP_ROSTER) {
    const hit = byId.get(item.id);
    if (!hit) continue;
    out.push(hit);
  }
  return out;
}

/** Games that have a verified InZone gameplay-state adapter today. */
export const VERIFIED_STATE_FLAGSHIP_IDS = [
  'nightclub-showdown-inzone-production',
] as const satisfies readonly FlagshipId[];

export function flagshipHasVerifiedState(id: string): boolean {
  return (VERIFIED_STATE_FLAGSHIP_IDS as readonly string[]).includes(id);
}
