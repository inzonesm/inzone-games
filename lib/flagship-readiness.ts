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
    devicesTested: ['chromium 390x844', 'chromium 834x1112', 'chromium 1440x900', 'chromium 820x1180'],
    provenance: 'automated',
    openDependency:
      'On a physical iPhone in landscape the build sat on its own "PAUSED — click anywhere to resume" overlay for the whole of a 29-second recording and never resumed. Not reproduced in automation, where clicks on the canvas do resume it. Needs a device pass to find what differs.',
    evidence:
      'scripts/nightclub-acceptance.mjs drives a full run with ordinary clicks; the v2 adapter reads heroHistory for verified start and activity; scripts/flagship-matrix.mjs measured canvas 390x136, 750x262 and 1356x474 with tap response at 834x1112.',
  },
  'kart-bros': {
    id: 'kart-bros',
    title: 'Kart Bros',
    role: 'flagship',
    assetsLoaded: 'yes',
    // Responsiveness is not a menu verdict and certainly not a race.
    menuUsable: 'unknown',
    gameplayEntered: 'unknown',
    ordinaryControlsWork: 'unknown',
    roundRestartWorks: 'unknown',
    devicesTested: ['chromium 390x844', 'chromium 834x1112', 'chromium 1440x900', 'chromium 820x1180'],
    provenance: 'automated',
    openDependency:
      'Whether a race can be entered and finished. The build fills the stage, animates and repaints under a tap at every size, which establishes that it is alive and receiving input and nothing more.',
    evidence:
      'Canvas 390x780 on phone and 1356x900 on desktop, 100% of the stage at both, with idle animation and post-tap repaint. Zero failed requests to our own host: everything it needs comes from /gcs. Only ads and analytics were refused by the runner.',
  },
  clelytraflight: {
    id: 'clelytraflight',
    title: 'Elytra Flight',
    role: 'flagship',
    assetsLoaded: 'yes',
    ...NOTHING_OBSERVED,
    devicesTested: ['chromium 390x844', 'chromium 1440x900', 'chromium 820x1180'],
    provenance: 'automated',
    openDependency:
      'Whether takeoff can be reached, and with what input. An earlier report said WASD with no touch equivalent; that has not been confirmed or refuted. The build itself loads and presents a full-stage canvas.',
    evidence:
      'Canvas 390x780 on phone and 1356x900 on desktop, 100% of the stage at both, with unity-mobile applied on the phone by the injected fit script. Zero failed requests to our own host — the earlier "loader blocked" reading was wrong: its files come from /gcs.',
  },
  'karate-bros': {
    id: 'karate-bros',
    title: 'Karate Bros',
    role: 'flagship',
    assetsLoaded: 'unknown',
    ...NOTHING_OBSERVED,
    devicesTested: ['chromium 390x844', 'chromium 1440x900'],
    provenance: 'blocked-egress',
    openDependency:
      'Its own KarateBros.js loads from /gcs with no failures, and the page then sits on div#loading with no canvas. The one thing it cannot reach here is api.adinplay.com, its ad library — a preroll gate is the common pattern for this kind of build, and removing monetization to test that is not authorised. A device with ad hosts reachable settles it in seconds.',
    evidence:
      'div#loading and div#game2 present, no canvas, zero failed requests to our own host; api.adinplay.com and www.googletagmanager.com refused by the runner.',
  },
  clescaperoad: {
    id: 'clescaperoad',
    title: 'Escape Road',
    role: 'flagship',
    assetsLoaded: 'yes',
    ...NOTHING_OBSERVED,
    devicesTested: ['chromium 390x844', 'chromium 820x1180', 'chromium 1356x900'],
    provenance: 'automated',
    openDependency:
      'Whether a driving session starts and can be restarted. The canvas problem is fixed: it shipped unsized at the browser default 300x150 — 4% of a 390pt phone — and the injected fit script now sizes a canvas no build ever sized, and switches Unity to its mobile layout on a touch viewport.',
    evidence:
      'Before: canvas 300x150, 4% of the stage, container unity-desktop on a phone. After: 100% of the stage at phone, tablet and desktop, container unity-mobile on the phone. On production the bar never overlaps the stage at any of the three. The build pulls cdn.jsdelivr.net, which this rig answers with a 403 CONNECT, so a run here sometimes shows no canvas at all; that is the egress proxy and not the build, which serves 200 and 21,775 bytes on a direct fetch.',
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
 * it will not do is show a title that has been *seen* to fail: Karate Bros
 * presents no canvas here, held behind an ad library this runner cannot reach,
 * so it stays out of the row until someone with ad hosts reachable confirms it
 * and its exact dependency is reported instead.
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
