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
  /** The build is drawn for landscape: in portrait it refuses to start or
   *  shrinks to a strip. Drives the landscape prompt (lib/display-mode.ts). */
  landscape?: boolean;
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
    note: 'The build labels Head shot on the head and Quick shoot on the body. Out of ammo? Click yourself to reload.',
    orientationHint: 'Turn your phone sideways for a bigger view.',
    landscape: true,
    verifiedAgainst: 'v2 build, checked 2026-09',
  },

  /* The four entries below were verified by booting each build through the
   * production transform (lib/hosted-builds.ts) in Chromium with touch
   * emulation, at 390x780 and 844x390, September 2026 — automation, not a
   * physical phone. Screens named here are the builds' own. */

  /* Menu: QUICK PLAY (a race against bots), BRO CUP, and Host/Join for online
   * rooms. QUICK PLAY → Choose your bro → Choose a track → race. In the race
   * the build draws its own touch controls and tutorial: "Drag to steer,
   * press GAS to move, press ITEM to use". Holding the pedal moved the kart
   * from 6th to 5th. Portrait: a 16:9 strip with thumb-hostile buttons. */
  'kart-bros': {
    primary: 'Tap Quick Play to race the bots. Hold Gas, drag to steer.',
    note: 'Host and Join are online rooms for friends — you never need a code to race.',
    orientationHint: 'Turn your phone sideways — the race is drawn for landscape.',
    landscape: true,
    verifiedAgainst: 'UGS-Assets@9cf4332 kart bros, 2026-09-30',
  },

  /* 1 PLAYER launches straight into a glide: there is no takeoff and no fly
   * key. Two on-screen sticks — left steers, right looks. Collect the green
   * coins along the course. Portrait: the engine shows its own "please rotate
   * your device to landscape mode" screen and will not start. */
  clelytraflight: {
    primary: 'Tap 1 Player — you launch straight into the air. Left stick steers.',
    note: 'Right stick turns the camera. Fly through the green coins.',
    orientationHint: 'Turn your phone sideways — this game will not start upright.',
    landscape: true,
    verifiedAgainst: 'lopx@dfa64e2 TPG_ElytraFlight_V01h, 2026-09-30',
  },

  /* PLAY NOW → Choose your bro, with a fighter already selected → READY →
   * Round 1. The build draws ◀ ▶, a punch and a jump pad. Its own help text:
   * arrow keys or WASD, up to jump, hints during play for each move. */
  'karate-bros': {
    primary: 'Tap Play Now, then Ready. Use the on-screen arrows, punch and jump.',
    note: 'On a keyboard: arrows or WASD, up to jump.',
    orientationHint: 'Turn your phone sideways for a bigger fight.',
    landscape: true,
    verifiedAgainst: 'UGS-Assets@ba0d391 karate bros, 2026-09-30',
  },

  /* The build only reads A/D or ←/→ and ignores taps on its canvas, so a
   * phone could not start it at all. The hosted page adds ◀ ▶ pads
   * (lib/touch-controls.ts) that send those keys. The car drives itself; a
   * crash shows the WANTED card with the score, and its ▶ goes again.
   * Portrait fits this build, so no orientation hint. */
  clescaperoad: {
    primary: 'Tap ◀ or ▶ to start, then hold them to steer. The car drives itself.',
    note: 'On a keyboard: A/D or the arrow keys. A crash ends the run — ▶ on the card goes again.',
    verifiedAgainst: 'classroom.google.com@45b2d69 escape road + InZone pads, 2026-09-30',
  },
};

export function gameControls(gameId: string): GameControls | null {
  return CONTROLS[gameId] ?? null;
}
