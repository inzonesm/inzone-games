/**
 * Display-name helpers for community games.
 *
 * The stored-name policy is set in `lib/session-prototype.ts::displayGameName`
 * ("Approved catalog title as stored. Do not strip or rewrite.") — this file
 * respects it. What it adds is a synchronous fallback derived from the game
 * id, so the pre-Firestore-resolve state on `/games/[id]` no longer reads
 * "Loading game" for the first second of a paid-social arrival when the id
 * itself already tells us what the game is called (see
 * `docs/hexclave-findings-2026-09-17.md` §D1).
 *
 *   fallbackGameName(id)          → id-derived preview (never touches
 *                                    the stored name; only used when the
 *                                    stored name is empty or absent).
 *   normalizeGameIdFromRoute(raw) → trailing-punctuation hygiene for
 *                                    ids pulled from a URL segment (§D5).
 *
 * Neither helper changes analytics, verified events, the invite funnel, or
 * the catalog's stored copy. Only what a person reads.
 */

const NOISE_TOKENS = new Set(["inzone", "production", "upload", "client"]);

function titleCase(word: string): string {
  if (/^\d+$/.test(word)) return word;
  if (word.length === 0) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Derive a display name from a `game.id` slug. Splits on `-`/`_`, drops
 *  known internal noise tokens (`inzone`, `production`, `upload`, `client`),
 *  and title-cases the rest. Returns the raw slug only when every token is
 *  noise. A slug like `2048-inzone-upload` becomes `2048` because 2048 is a
 *  legitimate title. */
export function displayNameFromId(id: string): string {
  if (!id) return "";
  const tokens = id.split(/[-_]+/).filter(Boolean);
  const kept = tokens.filter((t) => !NOISE_TOKENS.has(t.toLowerCase()));
  if (kept.length === 0) return id;
  return kept.map(titleCase).join(" ");
}

/** Preferred display name for a game whose stored `name` may not have loaded
 *  yet (or was empty in Firestore). Prefers the stored value when present,
 *  matching `lib/session-prototype.ts::displayGameName` — this helper never
 *  rewrites what the catalog stores. Falls back to `displayNameFromId(id)`
 *  when nothing is stored so the pre-Firestore boot screen carries a real
 *  title instead of a placeholder. */
export function fallbackGameName(id: string, storedName: string | null | undefined): string {
  const stored = (storedName ?? "").trim();
  if (stored.length > 0) return stored;
  return displayNameFromId(id);
}

/** Decode and sanitise a game id read from a URL segment. Trims trailing
 *  punctuation that markdown formatting bleeds in (backticks and asterisks
 *  most commonly, from links pasted into Slack/WhatsApp/Meta) so a share
 *  link like `.../games/nightclub-showdown-inzone-production%60**` still
 *  resolves. Leaves the middle of the id alone. */
export function normalizeGameIdFromRoute(raw: string): string {
  try {
    const decoded = decodeURIComponent(raw);
    return decoded.replace(/[`*'"<>]+$/u, "");
  } catch {
    return raw.replace(/[`*'"<>]+$/u, "");
  }
}
