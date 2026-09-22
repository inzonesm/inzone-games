/**
 * Discovery catalogue helpers.
 *
 * Featured composition follows the attached desktop/mobile image
 * (Nightclub, Karate, Elytra). Artwork is always live catalogue
 * poster/icon — never kit cover-*.svg or invented imagery. Escape Road
 * stays in the full catalogue but is not recommended while its play
 * journey is unresolved.
 */

import { FLAGSHIP_ROSTER } from './flagship-roster.ts';
import type { HubGame } from './types.ts';

export const DISCOVERY_COPY = {
  headline: 'Your next good time.',
  lede: 'Find a game. Make it a moment.',
  searchPlaceholder: 'Search games…',
  paceTitle: 'Find your pace',
  companyTitle: 'Better with company.',
  companyLede: 'Send a link. Bring the conversation.',
  inviteFriend: 'Invite a friend',
  rookPrompt: 'Need a recommendation?',
  talkToRook: 'Talking to Rook',
  micOff: 'Mic off',
  play: 'Play',
  friends: 'Friends',
  you: 'You',
  invite: 'Invite',
  joinTitle: 'A game. A little company.',
  joinBody:
    'Join the conversation and open this game. Each of you keeps your own game.',
  joinAction: 'Join & open game',
  expiredTitle: 'Catch the next one.',
  expiredBody:
    'This conversation is no longer available. You can still start a game and send a fresh invitation.',
  inviteTitle: 'Bring someone into the moment.',
  inviteHint:
    'They’ll join your conversation and open this game. Each of you keeps your own game. No shared-match promise.',
  creating: 'Creating invitation…',
} as const;

export const DISCOVERY_FEATURED_IDS = [
  'nightclub-showdown-inzone-production',
  'karate-bros',
  'clelytraflight',
] as const;

/** Titles that remain in the catalogue but are not recommended on discovery. */
export const DISCOVERY_UNRESOLVED_IDS = ['clescaperoad'] as const;

export const DISCOVERY_CATEGORY: Record<string, string> = {
  'nightclub-showdown-inzone-production': 'Tactical action',
  'karate-bros': 'Arcade fighting',
  'clelytraflight': 'Flight',
  'kart-bros': 'Kart racing',
  clescaperoad: 'Arcade driving',
  'flappybird-inzone-2': 'Arcade',
};

export type DiscoveryPace = 'quick' | 'action' | 'explore' | 'all';

export const DISCOVERY_PACE: { id: DiscoveryPace; title: string; line: string }[] = [
  { id: 'quick', title: 'Quick break', line: 'Short games. Big mood.' },
  { id: 'action', title: 'Action', line: 'Jump in. Turn it up.' },
  { id: 'explore', title: 'Explore', line: 'See what’s out there.' },
  { id: 'all', title: 'All games', line: 'A wider world awaits.' },
];

const QUICK_RE = /(flappy|2048|click|idle|puzzle|solitaire|match|word|quiz|break|short|casual|io\b)/i;
const ACTION_RE =
  /(fight|fighter|action|shoot|kart|nightclub|escape|arena|battle|box|war|race|bros|gladi)/i;
const EXPLORE_RE = /(flight|elytra|explore|adventure|world|sim|tycoon|build|farm|city)/i;

export function discoveryCategory(game: Pick<HubGame, 'id' | 'name' | 'description'>): string {
  const known = DISCOVERY_CATEGORY[game.id];
  if (known) return known;
  if (ACTION_RE.test(game.name) || ACTION_RE.test(game.description)) return 'Action';
  if (EXPLORE_RE.test(game.name) || EXPLORE_RE.test(game.description)) return 'Explore';
  if (QUICK_RE.test(game.name) || QUICK_RE.test(game.description)) return 'Quick play';
  return 'Game';
}

export function gamesForDiscoveryFeatured(games: HubGame[]): HubGame[] {
  if (games.length === 0) return [];
  const byId = new Map(games.map((game) => [game.id, game]));
  const out: HubGame[] = [];
  const seen = new Set<string>();
  const take = (id: string) => {
    if (seen.has(id) || out.length >= 3) return;
    const hit = byId.get(id);
    if (!hit) return;
    seen.add(id);
    out.push(hit);
  };
  for (const id of DISCOVERY_FEATURED_IDS) take(id);
  if (out.length < 3) {
    for (const item of FLAGSHIP_ROSTER) {
      if ((DISCOVERY_UNRESOLVED_IDS as readonly string[]).includes(item.id)) continue;
      take(item.id);
    }
  }
  if (out.length < 3) {
    for (const game of games) {
      if ((DISCOVERY_UNRESOLVED_IDS as readonly string[]).includes(game.id)) continue;
      take(game.id);
    }
  }
  return out.slice(0, 3);
}

export function gameMatchesPace(game: HubGame, pace: DiscoveryPace): boolean {
  if (pace === 'all') return true;
  const hay = `${game.name} ${game.description} ${game.id}`;
  if (pace === 'quick') return QUICK_RE.test(hay);
  if (pace === 'action') return ACTION_RE.test(hay);
  return EXPLORE_RE.test(hay) && !ACTION_RE.test(hay);
}

export function filterDiscoveryGames(
  games: HubGame[],
  opts: { query?: string; pace?: DiscoveryPace; excludeIds?: readonly string[] },
): HubGame[] {
  const q = (opts.query || '').trim().toLowerCase();
  const exclude = new Set(opts.excludeIds || []);
  return games.filter((game) => {
    if (exclude.has(game.id)) return false;
    if (opts.pace && !gameMatchesPace(game, opts.pace)) return false;
    if (!q) return true;
    return (
      game.name.toLowerCase().includes(q) ||
      game.description.toLowerCase().includes(q) ||
      game.id.toLowerCase().includes(q)
    );
  });
}

/** Official catalogue still. Never a kit cover SVG. */
export function catalogueArtUrl(game: Pick<HubGame, 'iconUrl' | 'preview'>): string {
  return (game.preview?.posterUrl || game.iconUrl || '').trim();
}

export function catalogueClipUrl(game: Pick<HubGame, 'preview'>): string | null {
  const url = game.preview?.videoUrl?.trim() || '';
  return url || null;
}

export function proxiedCatalogueArt(url: string, size: number): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;
  const noScheme = trimmed.replace(/^https?:\/\//, '');
  return `https://images.weserv.nl/?url=ssl:${encodeURIComponent(noScheme)}&w=${size}&h=${size}&fit=cover&output=webp&q=80`;
}

export function isKitCoverPath(value: string): boolean {
  return /cover-(night|karate|flight)\.svg/i.test(value);
}

export const DISCOVERY_ROOK_GAME_ID = 'nightclub-showdown-inzone-production';
