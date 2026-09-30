/**
 * What each title has actually been seen to do, broken into the steps that
 * can fail independently.
 *
 * A single "works / broken" verdict is useless, and worse, it is easy to
 * overclaim. A canvas that animates and repaints under a tap proves the build
 * is alive and receiving input. It does not prove a menu is usable, that a
 * race started, that the controls a player needs are reachable on a phone, or
 * that a round can be finished and restarted. Those are five separate
 * questions and this records them separately, because a title can pass the
 * first three and fail the fourth, and shipping it on the strength of the
 * first three is how a device journey gets advertised before it exists.
 *
 * Every field carries how it was established. `unknown` is a first-class
 * answer and the most common one here.
 *
 * WHERE THE EVIDENCE COMES FROM, AND ITS LIMIT
 * -------------------------------------------
 * Four of the five flagships load part of their own build from third-party
 * hosts. Agent sandboxes run behind an egress proxy that refuses those hosts,
 * so those builds arrive incomplete and then, naturally, do very little. That
 * is a fact about the runner, never about the game, and it is recorded as
 * `unknown` with the refused host named — not as a defect.
 *
 * The two titles any sandbox has ever played end to end are exactly the two
 * served entirely from our own /gcs path. That correlation is a property of
 * the test rig at least as much as of the games, and no amount of further
 * automation from inside the same rig will resolve it. The open items below
 * need a person on a device or a runner with open egress.
 */

import { FLAGSHIP_ROSTER } from './flagship-roster.ts';

/** Tri-state. `unknown` means nobody who could judge has looked. */
export type Checked = 'yes' | 'no' | 'unknown';

/** Where a result was established. Never blank, never assumed. */
export type Provenance =
  /** Chromium automation in this repo, with the script named. */
  | 'automated'
  /** A person on a physical device. */
  | 'device'
  /** This runner cannot fetch the build, so it cannot judge. */
  | 'blocked-egress'
  /** Nobody has looked. */
  | 'unobserved';

/**
 * The steps, in the order a player meets them. Each can fail on its own and
 * each is answered on its own.
 */
export type TitleEvidence = {
  id: string;
  title: string;
  /** In the approved five-title roster, or an extra verified recommendation. */
  role: 'flagship' | 'additional';
  /** The build's own files arrive. */
  assetsLoaded: Checked;
  /** A menu or lobby comes up and can be operated. */
  menuUsable: Checked;
  /** Play actually started: a race, flight, bout, drive or wave — not a lobby. */
  gameplayEntered: Checked;
  /** The controls a player has on the device under test reach the game. */
  ordinaryControlsWork: Checked;
  /** A round can end and be started again. */
  roundRestartWorks: Checked;
  /** Device classes and orientations anyone has actually tried. */
  devicesTested: string[];
  provenance: Provenance;
  /** One line naming the specific dependency, never a generic complaint. */
  openDependency: string | null;
  /** What was run or seen, so the next person can re-check rather than retake. */
  evidence: string;
};

const NOTHING_OBSERVED = {
  menuUsable: 'unknown',
  gameplayEntered: 'unknown',
  ordinaryControlsWork: 'unknown',
  roundRestartWorks: 'unknown',
} as const;

export const TITLE_EVIDENCE: Readonly<Record<string, TitleEvidence>> = {
  'nightclub-showdown-inzone-production': {
    id: 'nightclub-showdown-inzone-production',
    title: 'Nightclub Showdown',
    role: 'flagship',
    assetsLoaded: 'yes',
    menuUsable: 'yes',
    gameplayEntered: 'yes',
    ordinaryControlsWork: 'yes',
    roundRestartWorks: 'yes',
    devicesTested: ['chromium 390x844', 'chromium 834x1112', 'chromium 1440x900', 'chromium 820x1180', 'chromium touch 844x390'],
    provenance: 'automated',
    openDependency:
      'A physical iPhone pass to confirm the touch-focus fix. Cause found and reproduced in automation with touch input: the engine only counts focus from a mouse, its touchstart cancels the mouse events, so a tap resumed the game and the focus check paused it again 0.2 s later.',
    evidence:
      'scripts/nightclub-acceptance.mjs drives a full run with ordinary clicks; the v2 adapter reads heroHistory for verified start and activity; scripts/flagship-matrix.mjs measured canvas 390x136, 750x262 and 1356x474 with tap response at 834x1112.',
  },
  /* The four hosted stubs below were re-checked on 2026-09-30 through the
   * production transform (lib/hosted-builds.ts: pinned /mirror, ad and tracker
   * scripts removed) in Chromium with touch emulation, the build files fetched
   * from GitHub at the pinned commit because this rig refuses jsDelivr. That
   * is automation, not a thumb: every entry keeps a device pass as its open
   * dependency, and a step nobody exercised stays `unknown`. */
  'kart-bros': {
    id: 'kart-bros',
    title: 'Kart Bros',
    role: 'flagship',
    assetsLoaded: 'yes',
    menuUsable: 'yes',
    gameplayEntered: 'yes',
    ordinaryControlsWork: 'yes',
    // Nobody finished three laps.
    roundRestartWorks: 'unknown',
    devicesTested: ['chromium touch 390x780', 'chromium touch 844x390', 'chromium 390x844', 'chromium 1440x900'],
    provenance: 'automated',
    openDependency:
      'Finishing a race and starting the next one, and a device pass in portrait: the build draws a 16:9 strip there, so the landscape prompt carries the journey.',
    evidence:
      'QUICK PLAY (solo vs bots) → Choose your bro → Choose a track → race; holding the build\'s own Gas pedal moved the kart from 6th to 5th. Served as …/v1/index.html the build read "index.html" as a room code and opened INVALID CODE over the menu on every load; the entry-URL shim removed it. pleaserotate\'s white wall is off.',
  },
  clelytraflight: {
    id: 'clelytraflight',
    title: 'Elytra Flight',
    role: 'flagship',
    assetsLoaded: 'yes',
    menuUsable: 'yes',
    gameplayEntered: 'yes',
    // The sticks were drawn; nobody steered with them.
    ordinaryControlsWork: 'unknown',
    roundRestartWorks: 'unknown',
    devicesTested: ['chromium touch 390x780', 'chromium touch 844x390', 'chromium 1440x900'],
    provenance: 'automated',
    openDependency:
      'Steering with the on-screen sticks and reaching a finish, on a phone held sideways. Upright, the engine itself refuses to start.',
    evidence:
      '1 PLAYER launches straight into a glide — there is no takeoff key, so the reported missing Fly button does not exist. Portrait shows the build\'s own "Please rotate your device to landscape mode" screen and nothing else, which is what an upright phone saw.',
  },
  'karate-bros': {
    id: 'karate-bros',
    title: 'Karate Bros',
    role: 'flagship',
    assetsLoaded: 'yes',
    menuUsable: 'yes',
    gameplayEntered: 'yes',
    // The pads were drawn; nobody landed a punch with them.
    ordinaryControlsWork: 'unknown',
    roundRestartWorks: 'unknown',
    devicesTested: ['chromium touch 390x780', 'chromium touch 844x390'],
    provenance: 'automated',
    openDependency:
      'Landing a hit with the on-screen pads and finishing a bout, on a phone. The old "sits on div#loading" reading was the synchronous adinplay tag, which the host no longer serves.',
    evidence:
      'PLAY NOW → Choose your bro with a fighter already selected → READY → Round 1 with the build\'s own ◀ ▶, punch and jump pads. No preroll: without the ad tag, the page\'s own ShowVideo() completes at once. Portrait stage centred instead of pinned to the top.',
  },
  clescaperoad: {
    id: 'clescaperoad',
    title: 'Escape Road',
    role: 'flagship',
    assetsLoaded: 'yes',
    menuUsable: 'yes',
    gameplayEntered: 'yes',
    ordinaryControlsWork: 'yes',
    roundRestartWorks: 'yes',
    devicesTested: ['chromium touch 390x780', 'chromium 820x1180', 'chromium 1356x900'],
    provenance: 'automated',
    openDependency:
      'A device pass with a thumb on the ◀ ▶ pads. Before them, a phone could not start a run at all: the build reads only A/D or arrow keys and ignores taps.',
    evidence:
      'With only the pads: run starts, car steers, the police chase is on at score 31; a crash shows the WANTED/ARRESTED card, its ▶ returns to the title and a pad starts run two. Removing the build\'s third-party Firebase used to abort Unity on the first key; the inert stub keeps it running.',
  },
  'flappybird-inzone-2': {
    id: 'flappybird-inzone-2',
    title: 'Flappy Bird',
    // Not a flagship. It is the second title anyone has played end to end, and
    // saying so is useful; quietly promoting it into the approved five is not.
    role: 'additional',
    assetsLoaded: 'yes',
    menuUsable: 'yes',
    gameplayEntered: 'yes',
    ordinaryControlsWork: 'yes',
    roundRestartWorks: 'yes',
    devicesTested: ['chromium 390x844'],
    provenance: 'automated',
    openDependency: 'A device pass. Nobody has played it on real hardware.',
    evidence:
      'tests/flappy-gameplay.test.mjs and tests/flappy-measurement.browser.mjs against the real public v9 build: first flap starts a round, the engine reports its own game over, and Retry recovers the frame in scripts/player-journey.mjs.',
  },
} as const;

/** The approved five, in roster order, whatever their evidence says. */
export function flagshipEvidence(): TitleEvidence[] {
  return FLAGSHIP_ROSTER
    .map((item) => TITLE_EVIDENCE[item.id])
    .filter((entry): entry is TitleEvidence => Boolean(entry));
}

/** Verified titles outside the approved roster, kept visibly separate. */
export function additionalVerified(): TitleEvidence[] {
  return Object.values(TITLE_EVIDENCE).filter((e) => e.role === 'additional' && playedEndToEnd(e));
}

/** Every step a player takes was seen to work. Nothing less counts. */
export function playedEndToEnd(entry: TitleEvidence): boolean {
  return (
    entry.assetsLoaded === 'yes'
    && entry.menuUsable === 'yes'
    && entry.gameplayEntered === 'yes'
    && entry.ordinaryControlsWork === 'yes'
    && entry.roundRestartWorks === 'yes'
  );
}

/**
 * Whether a title presents a real, full-size playable surface on the devices
 * anyone has checked. Weaker than `playedEndToEnd` and deliberately so: it is
 * the bar for *showing* a flagship in its row, not for claiming someone has
 * finished a round on it.
 */
export function rendersEverywhereChecked(entry: TitleEvidence): boolean {
  return entry.assetsLoaded === 'yes' && entry.devicesTested.length >= 2;
}

/**
 * The flagship row.
 *
 * The approved five are the strategy and the row is theirs — it is not quietly
 * replaced by whichever two titles a sandbox happened to be able to play. What
 * it will not do is show a title that has been *seen* to fail. Karate Bros was
 * held out while it presented no canvas behind its ad library; served without
 * that tag it boots and a bout starts, so it is back.
 *
 * Flappy Bird is not in here. It is an additional recommendation and appears
 * in the ordinary catalogue rows like any other title.
 */
export function flagshipRowIds(): string[] {
  return flagshipEvidence().filter(rendersEverywhereChecked).map((e) => e.id);
}

/** Titles where the whole journey has been witnessed. Used for claims, not rows. */
export function promotableIds(): string[] {
  return [
    ...flagshipEvidence().filter(playedEndToEnd).map((e) => e.id),
    ...additionalVerified().map((e) => e.id),
  ];
}

/** Open work, per title, for whoever has a device or an open-egress runner. */
export function openDependencies(): Array<{ id: string; title: string; role: string; dependency: string }> {
  return Object.values(TITLE_EVIDENCE)
    .filter((e) => e.openDependency)
    .map((e) => ({ id: e.id, title: e.title, role: e.role, dependency: e.openDependency as string }));
}

/**
 * A device journey may only be advertised once someone reached a round on a
 * device. Automation shows a build works; it never shows a thumb can play it.
 */
export function deviceJourneyReady(id: string): boolean {
  const entry = TITLE_EVIDENCE[id];
  return Boolean(entry && playedEndToEnd(entry) && entry.provenance === 'device');
}

/**
 * Measurement mode for a title in a report. Three categories, never merged:
 *
 *   verified-adapter    — same-origin build with a state adapter in
 *                         lib/game-adapters.ts. Emits the four
 *                         VERIFIED_GAMEPLAY_EVENTS.
 *   cross-origin-proxy  — no same-origin adapter; parent-side proxies from
 *                         lib/cross-origin-engagement.ts fire instead.
 *                         Emits iframe_engaged, foreground_dwell_15s/60s,
 *                         session_bounce. NEVER verified gameplay.
 *   no-measurement      — game not on the flagship roster; the cross-origin
 *                         probe still runs (the probe is per-game, not
 *                         per-flagship) but the game is not surfaced in the
 *                         daily / weekly reports as a first-class row.
 *
 * A report can group titles by this mode and label its columns accordingly
 * — arrivals, iframe_engaged and dwell_60s belong beside cross-origin titles
 * only; game_start and engaged_play belong beside verified-adapter titles
 * only. Mixing them in the same column is what makes a report lie.
 */
export type MeasurementMode = 'verified-adapter' | 'cross-origin-proxy' | 'no-measurement';

/**
 * The two game ids with same-origin verified adapters, hardcoded here
 * because lib/game-adapters.ts pulls in browser-only modules that can't be
 * imported by report scripts running under Node. The daily report should
 * import `measurementMode` from here rather than reach into game-adapters.
 * A test in tests/flagship-readiness.test.mjs keeps these two lists in sync.
 */
const VERIFIED_ADAPTER_IDS: readonly string[] = [
  'nightclub-showdown-inzone-production',
  'flappybird-inzone-2',
];

/** Return which measurement mode applies to a game id. */
export function measurementMode(gameId: string): MeasurementMode {
  if (VERIFIED_ADAPTER_IDS.includes(gameId)) return 'verified-adapter';
  const entry = TITLE_EVIDENCE[gameId];
  if (entry && entry.role === 'flagship') return 'cross-origin-proxy';
  return 'no-measurement';
}

/** All titles in a given measurement mode. Used by reports to group rows. */
export function idsWithMeasurementMode(mode: MeasurementMode): string[] {
  const out: string[] = [];
  for (const id of Object.keys(TITLE_EVIDENCE)) {
    if (measurementMode(id) === mode) out.push(id);
  }
  // Flappy is not in TITLE_EVIDENCE as flagship but its adapter is verified;
  // include it explicitly under verified-adapter so a report never omits it.
  if (mode === 'verified-adapter') {
    for (const id of VERIFIED_ADAPTER_IDS) {
      if (!out.includes(id)) out.push(id);
    }
  }
  return out;
}
