/**
 * Review-only social-session prototype helpers.
 *
 * Conversation and invitations are simulated in the /session-prototype route.
 * Nothing here writes chat, presence, or matchmaking to Firebase. Production
 * player, SDK, hosting, auth, analytics, and purchases stay on their routes.
 */

export const SESSION_PROTO_PATH = '/session-prototype';
export const SESSION_PROTO_CHANNEL_PREFIX = 'inzone-session-proto:';

export type Surface = 'play' | 'discover' | 'yours';
export type ReviewMode = 'empty' | 'sample' | 'split';
export type CatalogChip = 'all' | 'action' | 'puzzle';
export type SuggestionSeatStatus = 'pending' | 'opened' | 'kept';

export interface ProtoGameRef {
  id: string;
  name: string;
  description: string;
  iconUrl: string;
}

export interface Suggestion {
  id: string;
  fromSeat: string;
  fromLabel: string;
  game: ProtoGameRef;
  createdAt: number;
}

export interface SeatSnapshot {
  id: string;
  label: string;
  gameId: string;
  playedIds: string[];
  interacted: boolean;
}

export type SeatAction =
  | { type: 'open-surface'; surface: Surface }
  | { type: 'toggle-session'; open: boolean }
  | { type: 'receive-suggestion'; suggestion: Suggestion }
  | { type: 'keep-playing'; suggestionId: string }
  | { type: 'open-suggested'; gameId: string }
  | { type: 'play-game'; gameId: string }
  | { type: 'mark-interacted' };

export const COPY = {
  demo: 'Demo',
  emptyTitle: 'No one else is here',
  emptyBody: 'You can keep playing. An invite is optional.',
  inviteHint: 'Copies a link. Nobody is notified.',
  chatSimulated: 'Chat and invites in this demo stay on this device.',
  sampleLabel: 'Sam · sample',
  sampleHint: 'Sample participant — not a real person.',
  chatPlaceholder: 'Send a message…',
  suggestNever: 'A suggestion never switches another player’s game.',
  switchTitle: 'Switch games?',
  switchBody: 'Your latest progress may not be saved.',
  keepPlaying: 'Keep playing',
  switchGame: 'Switch game',
  openGame: 'Open game',
  play: 'Play',
  suggest: 'Suggest',
  search: 'Search games',
  chat: 'Chat',
  discover: 'Discover',
  fullscreen: 'Fullscreen',
  findNext: 'Find your next game',
  rotatePhone: 'Rotate your phone',
  missingFit: 'Orientation is not in the catalog for this game.',
} as const;

/** Catalog docs have no orientation field. Only in-play verified ids are listed.
 *  Unknown games keep the host’s default fill sizing — never inferred from art. */
export type GameFit = 'landscape' | 'portrait' | 'responsive' | 'unknown';

export const VERIFIED_GAME_FIT: Readonly<Record<string, Exclude<GameFit, 'unknown'>>> = {
  'nightclub-showdown': 'landscape',
};

export function gameFitFor(id: string, name = ''): GameFit {
  if (id && VERIFIED_GAME_FIT[id]) return VERIFIED_GAME_FIT[id];
  if (/^nightclub showdown$/i.test(name.trim()) || /nightclub-showdown/i.test(id)) return 'landscape';
  return 'unknown';
}

/** Approved catalog title as stored. Do not strip or rewrite. */
export function displayGameName(name: string): string {
  return name.trim();
}

export function coverInitial(name: string): string {
  const ch = Array.from(name.trim())[0];
  return ch ? ch.toUpperCase() : '?';
}

export function coverFallbackHue(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 360;
}

const TECHNICAL_DESC_RE =
  /readme\.md|description\.md|backend will pull|bundle root|multi-file html5|single-page html5|unity mobile build|awaiting unity runtime|gameurl|serverurl/i;

/** Show a description only when it looks player-facing. Omit upload placeholders
 *  instead of inventing copy or rewriting catalog metadata. */
export function playerFacingDescription(raw: string, name = ''): string | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (TECHNICAL_DESC_RE.test(text)) return null;
  if (name && new RegExp(`^${escapeRegExp(name)}\\s+[—\\-]\\s+a\\s+(multi-file|single-page|unity)\\b`, 'i').test(text)) {
    return null;
  }
  return text;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ACTION_RE = /blaster|shoot|nightclub|showdown|fighter|arena|war|space|neon|combat|action/i;
const PUZZLE_RE = /2048|puzzle|match|block|cookie|snake|solitaire|word|cube/i;
const FEATURED_RES = [/nightclub/i, /neon blaster/i, /\b2048\b/i, /snake/i];

export function createSeat(id: string, label: string, gameId: string): SeatSnapshot {
  return {
    id,
    label,
    gameId,
    playedIds: gameId ? [gameId] : [],
    interacted: false,
  };
}

function mountGame(seat: SeatSnapshot, gameId: string): SeatSnapshot {
  if (!gameId || seat.gameId === gameId) return seat;
  const playedIds = seat.playedIds.includes(gameId) ? seat.playedIds : [...seat.playedIds, gameId];
  return { ...seat, gameId, playedIds, interacted: false };
}

/** Surfaces, suggestions, and “keep playing” never remount this seat’s game. */
export function applySeatAction(seat: SeatSnapshot, action: SeatAction): SeatSnapshot {
  switch (action.type) {
    case 'open-surface':
    case 'toggle-session':
    case 'receive-suggestion':
    case 'keep-playing':
      return seat;
    case 'mark-interacted':
      return seat.interacted ? seat : { ...seat, interacted: true };
    case 'open-suggested':
      return mountGame(seat, action.gameId);
    case 'play-game':
      return mountGame(seat, action.gameId);
  }
}

export function needsProgressConfirm(seat: SeatSnapshot, nextGameId: string): boolean {
  return Boolean(seat.interacted && nextGameId && seat.gameId !== nextGameId);
}

export function iframeShouldRemount(prevGameId: string, nextGameId: string): boolean {
  return prevGameId !== nextGameId;
}

export function pickFeaturedIds(games: { id: string; name: string }[], count = 5): string[] {
  const ids: string[] = [];
  for (const re of FEATURED_RES) {
    const hit = games.find((g) => re.test(g.name) && !ids.includes(g.id));
    if (hit) ids.push(hit.id);
    if (ids.length >= count) return ids;
  }
  for (const g of games) {
    if (!ids.includes(g.id)) ids.push(g.id);
    if (ids.length >= count) break;
  }
  return ids;
}

export function filterCatalog<T extends { id: string; name: string; description: string }>(
  games: T[],
  opts: { query: string; chip: CatalogChip },
): T[] {
  const q = opts.query.trim().toLowerCase();
  return games.filter((g) => {
    if (opts.chip === 'action' && !ACTION_RE.test(g.name) && !ACTION_RE.test(g.description)) return false;
    if (opts.chip === 'puzzle' && !PUZZLE_RE.test(g.name) && !PUZZLE_RE.test(g.description)) return false;
    if (!q) return true;
    return (
      g.name.toLowerCase().includes(q) ||
      g.description.toLowerCase().includes(q) ||
      g.id.toLowerCase().includes(q)
    );
  });
}

export function withServerUrl(gameUrl: string, serverUrl: string): string {
  if (!gameUrl) return gameUrl;
  if (!serverUrl) return gameUrl;
  try {
    const u = new URL(gameUrl);
    u.searchParams.set('serverUrl', serverUrl);
    return u.toString();
  } catch {
    const sep = gameUrl.includes('?') ? '&' : '?';
    return `${gameUrl}${sep}serverUrl=${encodeURIComponent(serverUrl)}`;
  }
}

export function prototypeInviteUrl(
  origin: string,
  opts: { gameId: string; room: string; seat?: string },
): string {
  const u = new URL(SESSION_PROTO_PATH, origin.endsWith('/') ? origin : `${origin}/`);
  u.searchParams.set('game', opts.gameId);
  u.searchParams.set('room', opts.room);
  if (opts.seat) u.searchParams.set('seat', opts.seat);
  return u.toString();
}

export function newPrototypeRoomId(): string {
  return `proto-${Math.random().toString(36).slice(2, 10)}`;
}

export function channelNameForRoom(room: string): string {
  return `${SESSION_PROTO_CHANNEL_PREFIX}${room}`;
}

export type ProtoWireEvent =
  | { v: 1; type: 'suggest'; suggestion: Suggestion }
  | { v: 1; type: 'chat'; id: string; fromSeat: string; fromLabel: string; text: string; createdAt: number }
  | { v: 1; type: 'suggestion-status'; suggestionId: string; seatId: string; status: SuggestionSeatStatus };

export function toGameRef(game: ProtoGameRef): ProtoGameRef {
  return {
    id: game.id,
    name: game.name,
    description: game.description,
    iconUrl: game.iconUrl,
  };
}
