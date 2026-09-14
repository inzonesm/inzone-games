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
  /* Verified by playing /gcs/games/nightclub-showdown-inzone-production/v2 in
   * Chromium at 1440x900, 390x844 and 844x390:
   *  - Tap/click on the floor sets the hero's move target: hero.cx tracked the
   *    tapped column (8->2, 2->8, 8->13). Synthetic touch taps moved it too, so
   *    the control is genuinely pointer-and-touch, not mouse-only.
   *  - Keyboard does nothing: ArrowLeft/Right/Up/Down, WASD, Space, Enter, R, E
   *    and F left hero.cx, hero.ammo, hero.life and every mob's life unchanged.
   *  - No input found fires the gun. hero.ammo stayed 6/6 through taps on
   *    enemies, taps on the floor, click-and-hold, drag from hero to enemy,
   *    long press, double click, right click and swipe. The bundle has
   *    blindShot/headShot skills, so the capability exists but is not reachable
   *    by ordinary interaction — raised as a game-owner task rather than
   *    guessed at here.
   *  - Portrait gives the game a 390x136 canvas; landscape gives 844x295 for
   *    the same device, so the orientation hint is measured, not a preference. */
  'nightclub-showdown-inzone-production': {
    primary: 'Tap where you want to move.',
    note: 'Pointer and touch only — this build has no keyboard controls.',
    orientationHint: 'Turn your phone sideways for a bigger view.',
    verifiedAgainst: 'v2 build, checked 2026-09',
  },
};

export function gameControls(gameId: string): GameControls | null {
  return CONTROLS[gameId] ?? null;
}
