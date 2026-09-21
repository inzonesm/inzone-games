/**
 * Entry repair: clearing a build's dead menu gate so arrival lands on a
 * playable screen.
 *
 * This is NOT measurement and must never become measurement. It removes an
 * obstacle in front of the player; it never stands in for the player. The
 * verified `game_start` still comes from the build's own first-flap
 * transition (see lib/flappy-gameplay-adapter.ts) and still requires the
 * person to touch the screen themselves. Nothing here emits a gameplay
 * signal, and nothing here may ever be used to.
 *
 * Why this file exists, from production session replays (19–21 Sep 2026):
 * visitors arriving on `flappybird-inzone-2` from the paid campaign tapped
 * the game canvas 19, 35, 53, 74 and 113 times across sessions of 37–91
 * seconds and never started a round. A controlled reproduction on an
 * iPhone-sized viewport tapped 12 positions spread over the whole frame;
 * all 12 were inert. Only the 13th, on the build's small START button at
 * roughly 29% across and 74% down, began the game. Once past that button,
 * a tap anywhere flaps — the game itself is fine. The title screen is the
 * entire failure.
 *
 * Adding a game here requires naming the exact gate and the exact engine
 * event that clears it, verified against the deployed build.
 */

export type GameEntryFix = {
  /** Catalogue id this fix is valid for. */
  gameId: string;
  /** The exact dead gate this clears, for the audit trail. */
  gateDescription: string;
  /**
   * Clear the gate on a same-origin game window.
   *
   * Returns true once the gate is gone (or was never up). Returning false
   * means "not ready yet, ask again"; throwing is treated as not-ready.
   */
  clear(win: Window): boolean;
};

type PcEntity = { enabled: boolean; findByName(name: string): PcEntity | null };
type PcApp = { root: PcEntity; fire(name: string): void };

/**
 * Flappy Bird (`flappybird-inzone-2`, inspected v9 build).
 *
 * The build boots to a title screen holding `Game > Bird` disabled until its
 * START button is hit. The engine's own `game:getready` event is what that
 * button fires; firing it enables the Bird and hands control to the player at
 * the "get ready" screen, exactly as pressing START does. Verified against
 * the deployed v9 build: before firing, `Bird.enabled === false`; after,
 * `Bird.enabled === true` with `bird.state === 'getready'`, and a tap
 * anywhere then flaps.
 */
const flappy: GameEntryFix = {
  gameId: 'flappybird-inzone-2',
  gateDescription:
    "title screen holds Game > Bird disabled until the START button fires the engine's game:getready",
  clear(win: Window): boolean {
    // Fail closed on a different build until its gate is inspected.
    if (win.location.pathname !== '/gcs/games/flappybird-inzone-2/v9/index.html') return true;
    const app = (win as unknown as { pc?: { Application?: { getApplication?: () => PcApp } } })
      .pc?.Application?.getApplication?.();
    const bird = app?.root.findByName('Game')?.findByName('Bird');
    // Engine not up yet: not a failure, just not ready.
    if (!app || !bird) return false;
    // Already past the gate — the player is in control, leave them alone.
    if (bird.enabled) return true;
    app.fire('game:getready');
    return bird.enabled;
  },
};

const FIXES: GameEntryFix[] = [flappy];

export function entryFixFor(gameId: string): GameEntryFix | null {
  return FIXES.find(f => f.gameId === gameId) ?? null;
}

/**
 * How long to keep trying to clear the gate after the frame reports loaded.
 * Long enough for a slow build to boot on a phone, short enough that a build
 * which never comes up is not polled forever.
 */
export const ENTRY_FIX_WINDOW_MS = 30_000;
