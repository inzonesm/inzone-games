/**
 * Isolated experience-reset prototype helpers.
 * Production home rows, campaign routing, and player chrome stay untouched.
 */

import type { HubGame } from './types';

export const EXPERIENCE_PATH = '/experience';
export const EXPERIENCE_RECENT_KEY = 'ix-recent-ids';

/**
 * Curator preference for the opening three. Missing ids are skipped.
 * This is not measured trending, recency, or multiplayer suitability.
 */
export const EXPERIENCE_OPENING: readonly string[] = [
  'nightclub-showdown-inzone-production',
  '2048-inzone-upload',
  'snake',
];

/** Used only when Firestore is unavailable in a review environment.
 *  IDs and embed URLs are taken from this repo's existing tests. */
export const REVIEW_FALLBACK_GAMES: HubGame[] = [
  {
    id: 'nightclub-showdown-inzone-production',
    source: 'community',
    name: 'Nightclub Showdown',
    description: 'A nightclub brawler. Review catalogue — live Firestore was unavailable.',
    iconUrl: '',
    gameUrl: 'https://storage.googleapis.com/inzone-html/games/nightclub-showdown-inzone-production/v2/index.html',
    serverUrl: '',
    uploaderId: 'review-fallback',
    preview: null,
    createdAt: 0,
    updatedAt: null,
  },
  {
    id: 'snake',
    source: 'community',
    name: 'Snake',
    description: 'The classic, reimagined. Review catalogue — live Firestore was unavailable.',
    iconUrl: '',
    gameUrl: 'https://storage.googleapis.com/inzone-html/games/snake/v2/src/index.html',
    serverUrl: '',
    uploaderId: 'review-fallback',
    preview: null,
    createdAt: 0,
    updatedAt: null,
  },
];

export type ExperienceScene =
  | 'home'
  | 'play'
  | 'invite-preview'
  | 'load-fail'
  | 'expired'
  | 'return';

export type ExperienceOverlay = 'none' | 'discover' | 'session';

export const IX_COPY = {
  banner: 'Design prototype — not the live product. Labelled fixtures stay on this route.',
  promise: 'Find your next obsession. Bring your people. Play your way.',
  kicker: 'Our pick',
  play: 'Play',
  browseAll: 'Browse all',
  picks: 'Our picks',
  picksHint: 'Curated from the live catalogue. Not trending or new.',
  discover: 'Discover',
  invite: 'Invite',
  session: 'Session',
  fullscreen: 'Fullscreen',
  backTo: 'Back to',
  copyLink: 'Copy link',
  copyHint: 'Copies a link. Nobody is notified. A copied link is not a delivered invitation.',
  copied: 'Link copied. Send it yourself — InZone does not notify anyone.',
  copyFailed: 'Could not copy. Copy it from the address bar.',
  join: 'Join session',
  joinHint: 'Private conversation stays locked until you join. People in a session can play different games.',
  playAlone: 'Play independently',
  newSession: 'Start a new session',
  leave: 'Leave session',
  emptySession: 'No one else is here yet. You can keep playing.',
  inviteTitle: 'Invite a friend',
  previewTitle: 'You’ve been invited',
  expiredTitle: 'This invitation has expired',
  expiredBody: 'You can still play this game on your own, or start a new session.',
  loadFailTitle: 'This game didn’t load',
  loadFailBody: 'Retry, or pick another game. An empty stage is not a playable state.',
  retry: 'Retry',
  another: 'Another game',
  switchTitle: 'Switch games?',
  switchBody: 'Your latest progress may not be saved.',
  keepPlaying: 'Keep playing',
  switchGame: 'Switch game',
  suggest: 'Suggest',
  search: 'Search games',
  chat: 'Message',
  send: 'Send',
  browsing: 'The current game stays running while you browse.',
  recent: 'Recent on this browser',
  recentHint: 'Proposed return feature. This list is local to this browser, not an account history.',
  fixture: 'Review fixture',
  rotate: 'Turn your phone sideways for this game.',
  unknownFit: 'Orientation is not in the catalogue for this title.',
  differentGames: 'People in this session can play different games.',
} as const;

export function coverUrl(game: Pick<HubGame, 'iconUrl' | 'preview' | 'name'>): string {
  return game.preview?.posterUrl?.trim() || game.iconUrl.trim();
}

export function withServerUrl(gameUrl: string, serverUrl: string): string {
  if (!gameUrl || !serverUrl) return gameUrl;
  try {
    const u = new URL(gameUrl);
    u.searchParams.set('serverUrl', serverUrl);
    return u.toString();
  } catch {
    const sep = gameUrl.includes('?') ? '&' : '?';
    return `${gameUrl}${sep}serverUrl=${encodeURIComponent(serverUrl)}`;
  }
}

export function gamesById(games: HubGame[]): Map<string, HubGame> {
  return new Map(games.map((g) => [g.id, g]));
}

function preferArt(games: HubGame[]): HubGame[] {
  return [...games].sort((a, b) => {
    const as = coverUrl(a) ? 1 : 0;
    const bs = coverUrl(b) ? 1 : 0;
    return bs - as;
  });
}

export function composeExperienceHome(games: HubGame[]): {
  feature: HubGame | null;
  alternatives: HubGame[];
  picks: HubGame[];
  all: HubGame[];
} {
  const byId = gamesById(games);
  const opening: HubGame[] = [];
  const used = new Set<string>();
  for (const id of EXPERIENCE_OPENING) {
    const hit = byId.get(id);
    if (!hit || used.has(hit.id)) continue;
    opening.push(hit);
    used.add(hit.id);
  }
  const rest = preferArt(games.filter((g) => !used.has(g.id)));
  while (opening.length < 3 && rest.length) {
    const next = rest.shift();
    if (!next) break;
    opening.push(next);
    used.add(next.id);
  }
  return {
    feature: opening[0] ?? null,
    alternatives: opening.slice(1, 3),
    picks: games.filter((g) => !used.has(g.id)),
    all: games,
  };
}

export function readRecentIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(EXPERIENCE_RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function rememberRecentId(id: string): string[] {
  if (!id || typeof window === 'undefined') return readRecentIds();
  const next = [id, ...readRecentIds().filter((x) => x !== id)].slice(0, 8);
  try {
    window.sessionStorage.setItem(EXPERIENCE_RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
  return next;
}

export function experienceHref(opts: {
  gameId?: string;
  sessionId?: string;
  scene?: ExperienceScene | '';
}): string {
  const params = new URLSearchParams();
  if (opts.gameId) params.set('game', opts.gameId);
  if (opts.sessionId) params.set('session', opts.sessionId);
  if (opts.scene && opts.scene !== 'home' && opts.scene !== 'play') params.set('scene', opts.scene);
  const qs = params.toString();
  return qs ? `${EXPERIENCE_PATH}?${qs}` : EXPERIENCE_PATH;
}
