/**
 * What each flagship has actually been seen to do, and who saw it.
 *
 * This exists because "flagship" was becoming a claim rather than a fact. A
 * title sits in the roster because the product wants it there; whether a
 * player can finish a round on a phone is a separate question, and the two had
 * drifted far enough apart that a row of five could have promoted three games
 * nobody has ever played to completion.
 *
 * So each entry records a reached stage and where that came from. The rule is
 * the one `lib/game-controls.ts` already applies to control text: a claim
 * needs a witness, and the witness is named. `provenance` matters as much as
 * `reached` — an automated Chromium pass and a person holding a phone are not
 * the same evidence, and neither is a previous session's report.
 *
 * Only `round` may be promoted. Everything else stays in the catalogue, stays
 * playable for anyone who opens it, and is not advertised as ready.
 */

import { FLAGSHIP_ROSTER } from './flagship-roster.ts';

/** How far ordinary input has actually got in this build. */
export type ReachedStage =
  /** A real round: a race, a flight, a bout, a driving session, a wave. */
  | 'round'
  /** The build comes up and responds, but only a menu or lobby was reached. */
  | 'menu'
  /** The build does not reach a usable screen at all. */
  | 'blocked';

/** Where a reached stage was observed. Never blank. */
export type Provenance =
  /** Chromium automation in this repo, with the script named. */
  | 'automated'
  /** A person on a physical device. */
  | 'device'
  /** An earlier session's written report, not re-verified here. */
  | 'reported';

/** Which layer a blocker belongs to, because the fix lives in a different place for each. */
export type BlockerKind =
  | 'host-layout'
  | 'game-canvas'
  | 'touch-controls'
  | 'orientation'
  | 'assets'
  | 'none';

export type FlagshipReadiness = {
  /** A catalogue id. The roster's five, plus any other title with a verified
   *  adapter — Flappy Bird is not a flagship and is still the second title
   *  anyone has finished a round on, so a "what can we promote" list that
   *  excluded it would be answering the wrong question. */
  id: string;
  reached: ReachedStage;
  provenance: Provenance;
  blockerKind: BlockerKind;
  /** One line naming the specific dependency, not a generic complaint. */
  blocker: string | null;
  /** What was run or seen, so the next person can re-check rather than retake. */
  evidence: string;
};

export const FLAGSHIP_READINESS: Readonly<Record<string, FlagshipReadiness>> = {
  'nightclub-showdown-inzone-production': {
    id: 'nightclub-showdown-inzone-production',
    reached: 'round',
    provenance: 'automated',
    blockerKind: 'none',
    blocker: null,
    evidence:
      'scripts/nightclub-acceptance.mjs drives a full run with ordinary clicks; the v2 adapter in lib/gameplay-signals.ts reads heroHistory for verified start and activity.',
  },
  'flappybird-inzone-2': {
    id: 'flappybird-inzone-2',
    reached: 'round',
    provenance: 'automated',
    blockerKind: 'none',
    blocker: null,
    evidence:
      'tests/flappy-gameplay.test.mjs plus tests/flappy-measurement.browser.mjs against the real public v9 build: first flap starts a round and the engine reports its own game over.',
  },
  'kart-bros': {
    id: 'kart-bros',
    reached: 'menu',
    provenance: 'reported',
    blockerKind: 'game-canvas',
    blocker:
      'The v1 build opens on a Host/Join room-code lobby with an Invalid code modal and no quick-play route into a race. Entering one needs a change inside the build, not host CSS.',
    evidence:
      'Reported by earlier sessions on the companion branch; automated clicks on the modal and on Host did not dismiss or advance it. Not re-verified on a device.',
  },
  clelytraflight: {
    id: 'clelytraflight',
    reached: 'menu',
    provenance: 'reported',
    blockerKind: 'touch-controls',
    blocker:
      'World select reached; takeoff needs WASD and no touch equivalent was found, so a phone has no way to fly.',
    evidence: 'Reported by earlier sessions. No flight has been confirmed by anyone yet.',
  },
  'karate-bros': {
    id: 'karate-bros',
    reached: 'menu',
    provenance: 'reported',
    blockerKind: 'game-canvas',
    blocker: 'Character select and Ready reached; no bout has been observed starting.',
    evidence: 'Reported by earlier sessions. Not re-verified on a device.',
  },
  clescaperoad: {
    id: 'clescaperoad',
    reached: 'blocked',
    provenance: 'reported',
    blockerKind: 'assets',
    blocker: 'Loader dependencies 404 on the hosted build, so the game does not reliably come up.',
    evidence: 'Documented in the reliability handoff on this branch. The dependency is the uploaded build, not the host.',
  },
} as const;

/** Titles a row may promote: a real round, actually witnessed. Roster order
 *  first, then any other verified title, so the approved set leads. */
export function promotableFlagships(): FlagshipReadiness[] {
  const rosterFirst = FLAGSHIP_ROSTER.map((item) => item.id as string);
  const rest = Object.keys(FLAGSHIP_READINESS).filter((id) => !rosterFirst.includes(id));
  return [...rosterFirst, ...rest]
    .map((id) => FLAGSHIP_READINESS[id])
    .filter((entry): entry is FlagshipReadiness => Boolean(entry) && entry.reached === 'round');
}

/** Ids a row may promote, in roster order. */
export function promotableFlagshipIds(): string[] {
  return promotableFlagships().map((entry) => entry.id);
}

/** Everything not yet promotable, with its named dependency. */
export function pendingFlagships(): FlagshipReadiness[] {
  return Object.values(FLAGSHIP_READINESS).filter((entry) => entry.reached !== 'round');
}

/**
 * A device journey may only be advertised once someone has reached a round on
 * a device. Automation is evidence that the build works; it is not evidence
 * that a thumb can play it.
 */
export function deviceJourneyReady(id: string): boolean {
  const entry = FLAGSHIP_READINESS[id];
  return Boolean(entry && entry.reached === 'round' && entry.provenance === 'device');
}
