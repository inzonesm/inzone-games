/**
 * Controls shown on the player's pre-game overlay.
 *
 * Every entry here must be verified by playing the build that is live on the
 * hub — not read off a design doc and not inferred from the genre. A game with
 * no entry shows no controls text at all, which is the correct outcome: an
 * invented control is worse than silence, because the player trusts it and
 * then loses.
 *
 * `verifiedAgainst` records what was actually exercised, so the next person can
 * tell a stale entry from a current one after a game is re-uploaded.
 */

export type GameControls = {
  /** One short line naming the input that actually drives the game. */
  primary: string;
  /** Optional second line for a real, verified caveat. Omitted when there is none. */
  note?: string;
  /** Set only when a layout measurably gives the game more room. */
  orientationHint?: string;
  /** Build/date this was checked against, for staleness triage. */
  verifiedAgainst: string;
};

const CONTROLS: Record<string, GameControls> = {
  /* Verified by playing /gcs/games/nightclub-showdown-inzone-production/v2
   * (client.js ETag f509e7c6a3a839ac0597692e4749317f, 8,407,409 bytes) with
   * ordinary mouse input in Chromium at 1440x900. Full run recorded in
   * scripts/nightclub-acceptance.mjs.
   *
   * This build is turn-based — it announces "A fast turned-based action game"
   * on load — and every action is a click on a target, resolved by the hero's
   * own getActionAt(x,y):
   *   - click bare floor  -> walk there (hero x 8.04 -> 11.08, ammo unchanged)
   *   - click an enemy    -> shoot it. The game labels the target under the
   *     cursor itself: "Head shot" over the head, "Quick shoot" over the body.
   *     Observed ammo 6->5->4->3 with three enemies killed and the wave
   *     advancing 0 -> 1.
   *   - click yourself    -> reload, once ammo is spent
   *   - click cover       -> take cover behind it
   * An earlier note here claimed shooting was unreachable. That was wrong: the
   * clicks in that check all landed on empty floor, which is the move action.
   * Shooting requires the click to land on the enemy's own hitbox.
   *
   * Keyboard drives nothing in play. Arrows, WASD, Space, Enter, E, F, Q, R, X,
   * Z, Shift and Ctrl all left hero position, ammo, life and every mob's life
   * unchanged, with the canvas focused and without. The only bound key is T
   * (restart), and it works solely while the canvas holds focus and the engine
   * is not paused — which is why the "T to restart" the game draws on death is
   * unreliable. Replay is the button on the game's own Match Complete card.
   *
   * Portrait gives the game a 390x136 canvas; landscape gives 844x295 on the
   * same device, so the orientation hint is measured, not a preference. */
  'nightclub-showdown-inzone-production': {
    primary: 'Click the floor to move. Click an enemy to shoot.',
    note: 'Aim for the head. Out of ammo? Click yourself to reload.',
    orientationHint: 'Turn your phone sideways for a bigger view.',
    verifiedAgainst: 'v2 build, checked 2026-09',
  },
};

export function gameControls(gameId: string): GameControls | null {
  return CONTROLS[gameId] ?? null;
}
