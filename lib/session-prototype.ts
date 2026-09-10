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
  banner: 'Social session concept · sample data',
  emptyTitle: 'Just you right now',
  emptyBody:
    'No one else is in this prototype session. Keep playing — you do not need an invite, and nothing waits on another person.',
  inviteHint:
    'Copies a prototype link. Nobody is notified automatically. This is not a live InZone session.',
  sampleLabel: 'Sam · sample',
  sampleHint: 'Labeled fixture, not a real person.',
  chatPlaceholder: 'Message this prototype session…',
  chatNotice: 'Prototype conversation — not sent to InZone servers.',
  suggestNever: 'A suggestion never switches another player’s game.',
  sameMatch:
    'Opening the same title does not put you in the same match. Multiplayer depends on each game.',
  stillRunning: (name: string) => `${name} is still running`,
  footer:
    'Concept only: persistent sessions and chat require implementation. Multiplayer and saved progress depend on each game. Play never requires an invite.',
  switchTitle: (name: string) => `Leave ${name}?`,
  switchBody: (name: string) =>
    `This prototype cannot confirm that ${name} saved your progress. Switching unloads the current game in your seat only. Other people keep whatever they are playing.`,
  keepPlaying: 'Keep playing',
  switchAnyway: 'Switch anyway',
  openGame: 'Open game',
  playThis: 'Play this game',
  suggestToSession: 'Suggest to session',
} as const;

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

export function pickFeaturedIds(games: { id: string; name: string }[], count = 3): string[] {
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
