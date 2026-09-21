/**
 * Entry resolution: the smallest description of a game the player needs before
 * it can mount the frame.
 *
 * This exists because the player cannot request the game until it has read one
 * Firestore document in the browser. Measured on production, the first
 * Firestore response lands 2.2 s after navigation and the frame enters the DOM
 * ~200 ms later, so nothing about the game starts downloading until then.
 *
 * Two rules this file exists to keep honest:
 *
 * 1. **Allowlist, never passthrough.** Only the fields below leave the server.
 *    A catalogue document may carry owner ids, moderation notes or payout
 *    fields; none of them are entry data and none of them may reach the
 *    browser through this path.
 * 2. **Same semantics as the client read.** `fetchGameById` in lib/games.ts
 *    deliberately does NOT filter on `status`, which is what keeps a direct
 *    link to a withdrawn game working and showing the host's recovery UI
 *    rather than a dead end. This mirrors that exactly, and carries `status`
 *    so the caller can decide, rather than deciding for it.
 */

/** Exactly what the browser is given to open a game. Nothing else. */
export type GameEntry = {
  id: string;
  name: string;
  gameUrl: string;
  serverUrl: string;
  /** Carried, not enforced here — see rule 2. */
  status: string;
  /** Build version, so a version bump changes the resolved entry. */
  version: number;
};

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Shape a raw catalogue document into entry data.
 *
 * Returns null when there is nothing playable to point at — which is the same
 * condition `fetchGameById` uses (`if (!data.gameUrl) return null`).
 */
export function shapeGameEntry(id: string, raw: Record<string, unknown> | null | undefined): GameEntry | null {
  if (!id || !raw) return null;
  const gameUrl = str(raw.gameUrl);
  if (!gameUrl) return null;
  const version = Number(raw.version);
  return {
    id,
    name: str(raw.name),
    gameUrl,
    serverUrl: str(raw.serverUrl),
    status: str(raw.status),
    version: Number.isFinite(version) && version > 0 ? version : 1,
  };
}

/**
 * True when two entries would produce the same mounted frame.
 *
 * The player keys its frame on a reload counter and derives `src` from
 * `gameUrl` + `serverUrl`. So long as those match, replacing a fast entry with
 * the full catalogue document re-renders without remounting the game — which
 * is the property that keeps a metadata-only update (a new icon, a changed
 * description, a like count) from interrupting someone mid-play.
 */
export function sameMountedGame(a: GameEntry | null, b: GameEntry | null): boolean {
  if (!a || !b) return a === b;
  return a.gameUrl === b.gameUrl && a.serverUrl === b.serverUrl;
}

/**
 * Ask the server for a game's entry data.
 *
 * Never throws and never rejects: the player treats this purely as a head
 * start. Any failure — unavailable, 404, offline, slow — simply means the
 * player waits for its own catalogue read, exactly as it did before.
 */
export async function fetchGameEntry(id: string, signal?: AbortSignal): Promise<GameEntry | null> {
  if (!id) return null;
  try {
    const res = await fetch(`/api/game-entry/${encodeURIComponent(id)}`, { signal });
    if (!res.ok) return null;
    const body = (await res.json()) as unknown;
    if (!body || typeof body !== 'object') return null;
    // Re-shape rather than trust the wire, so a changed endpoint cannot widen
    // what the player accepts.
    return shapeGameEntry(id, body as Record<string, unknown>);
  } catch {
    return null;
  }
}

/**
 * A `HubGame` carrying only what entry needs, for the window before the full
 * catalogue document arrives.
 *
 * Everything the player reads off `game` during entry — `gameUrl`,
 * `serverUrl`, `name` — is real. The rest is left empty on purpose: the full
 * document replaces this object moments later, and an invented icon or
 * description would be a worse lie than an absent one.
 */
export function provisionalHubGame(entry: GameEntry): import('./types').HubGame {
  return {
    id: entry.id,
    source: 'community',
    name: entry.name,
    description: '',
    iconUrl: '',
    gameUrl: entry.gameUrl,
    serverUrl: entry.serverUrl,
    uploaderId: '',
    preview: null,
    createdAt: 0,
    updatedAt: null,
  };
}
