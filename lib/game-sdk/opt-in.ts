/** Explicit opt-in for the isolated web SDK host (opaque-origin iframe + checkout). */

const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Hardcoded allowlist. Stays empty so production games keep the legacy player
 * frame until a game is named here or via NEXT_PUBLIC_INZONE_WEB_SDK_GAMES.
 */
export const WEB_SDK_HOST_GAME_IDS: readonly string[] = Object.freeze([]);

export function parseWebSdkHostAllowlist(raw?: string | null): string[] {
  if (!raw) return [];
  return raw.split(/[\s,]+/).map((part) => part.trim()).filter((part) => ID_RE.test(part));
}

export function isWebSdkHostEnabled(
  gameId: string,
  envRaw: string | null | undefined = typeof process !== 'undefined'
    ? process.env.NEXT_PUBLIC_INZONE_WEB_SDK_GAMES
    : undefined,
): boolean {
  if (!gameId || !ID_RE.test(gameId)) return false;
  if (WEB_SDK_HOST_GAME_IDS.includes(gameId)) return true;
  return parseWebSdkHostAllowlist(envRaw).includes(gameId);
}
