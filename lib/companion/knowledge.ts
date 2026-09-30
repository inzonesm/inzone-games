import {
  FLAGSHIP_IDS,
  flagshipHasVerifiedState,
  flagshipTitle,
  type FlagshipId,
} from '../flagship-roster.ts';
import { COMPANION_KNOWLEDGE_VERSION, companionName } from './config.ts';

export type CompanionContextMode = 'instructions_only' | 'untrusted_state';

export type FlagshipKnowledge = {
  version: number;
  id: FlagshipId;
  title: string;
  contextMode: CompanionContextMode;
  objective: string;
  controls: string[];
  guidance: string[];
  volume: string;
  honesty: string;
  verifiedAgainst: string;
};

const KNOWLEDGE: Record<FlagshipId, Omit<FlagshipKnowledge, 'version' | 'id' | 'title' | 'contextMode'>> = {
  'kart-bros': {
    objective: 'Finish a race against the bots. Quick Play is a solo race; Host and Join are optional online rooms.',
    controls: [
      'Tap Quick Play, pick an unlocked bro, tap Ready, pick a track, tap Ready. You race bots — no code needed.',
      'In the race: hold the Gas pedal, drag to steer, tap Item to use a pickup. The game shows that tutorial itself.',
    ],
    guidance: [
      'Start with Quick Play. Join is only for a friend\'s room code; if a code box opens, close it with the X.',
      'Turn the phone sideways — the race is drawn for landscape. I cannot see your kart or place.',
    ],
    volume: 'The embed did not expose a host volume API. Companion speech uses its own slider.',
    honesty: 'No verified InZone gameplay-state bridge. Instructions only, checked in emulated Chromium, not on a phone.',
    verifiedAgainst: 'UGS-Assets@9cf4332 via /mirror, emulated Chromium touch 2026-09-30 — Quick Play race entered',
  },
  clelytraflight: {
    objective: 'Fly the course and collect the green coins. There is no takeoff step: 1 Player launches you into a glide.',
    controls: [
      'Tap 1 Player. You start in the air. Left stick steers, right stick turns the camera.',
      'Upright, the game shows its own rotate screen and will not start. Turn the phone sideways.',
    ],
    guidance: [
      'If you only see a rotate icon, turn the phone sideways. I cannot see your altitude or coins.',
    ],
    volume: 'The embed did not expose a host volume API. Companion speech is independent of game audio.',
    honesty: 'No verified InZone gameplay-state bridge. Instructions only, checked in emulated Chromium, not on a phone.',
    verifiedAgainst: 'lopx@dfa64e2 via /mirror, emulated Chromium touch 2026-09-30 — flight entered',
  },
  'karate-bros': {
    objective: 'Win the bout. Character select is one tap: a fighter is already chosen.',
    controls: [
      'Tap Play Now, then Ready. Round 1 starts. Use the on-screen arrows, the fist to strike and the up arrow to jump.',
      'On a keyboard: arrows or WASD, up to jump. The game shows move hints during play.',
    ],
    guidance: [
      'Tap Ready to fight with the chosen bro; change fighter later. I cannot see health or who is winning.',
    ],
    volume: 'The embed did not expose a host volume API. Companion speech is independent of game audio.',
    honesty: 'No verified InZone gameplay-state bridge. Instructions only, checked in emulated Chromium, not on a phone.',
    verifiedAgainst: 'UGS-Assets@ba0d391 via /mirror, emulated Chromium touch 2026-09-30 — Round 1 entered',
  },
  clescaperoad: {
    objective: 'Escape the police for as long as you can. A crash ends the run with a Wanted card and your score.',
    controls: [
      'Tap the ◀ or ▶ pad to start. Hold them to steer; the car drives itself.',
      'On a keyboard: A/D or the arrow keys. After a crash, tap ▶ on the card, then a pad to go again.',
    ],
    guidance: [
      'Hold a pad to turn away from the police cars. I cannot see your score live.',
    ],
    volume: 'The embed did not expose a host volume API. Companion speech is independent of game audio.',
    honesty: 'No verified InZone gameplay-state bridge. Instructions only, checked in emulated Chromium, not on a phone.',
    verifiedAgainst: 'classroom.google.com@45b2d69 via /mirror + InZone pads, emulated Chromium touch 2026-09-30 — run and restart',
  },
  'nightclub-showdown-inzone-production': {
    objective: 'A turn-based club fight: move, shoot, reload, and take cover until the match ends.',
    controls: [
      'Click bare floor to walk there.',
      'Click an enemy to shoot. The build labels Head shot on the head and Quick shoot on the body.',
      'Click yourself to reload once ammo is spent.',
      'Click cover to take cover.',
      'Keyboard does not drive play. T restarts only when the canvas is focused and the engine is not paused. Replay is the Match Complete button.',
    ],
    guidance: [
      'Empty floor clicks only walk. Shoot by clicking the enemy hitbox.',
      'If I mention wave, life, or ammo, that is what the build last reported — not a guarantee I am coaching this second.',
      'Turn the phone sideways for a bigger view. Portrait leaves a very short canvas.',
    ],
    volume: 'Nightclub draws its own Mute in the game HUD. The host cannot duck that audio. Companion volume is separate.',
    honesty: 'Untrusted v2 bridge fields only. Access to state is not reliable coaching.',
    verifiedAgainst: 'v2 client.js ETag f509e7c6a3a839ac0597692e4749317f, game-controls.ts 2026-09',
  },
};

export function flagshipKnowledge(id: string): FlagshipKnowledge | null {
  if (!FLAGSHIP_IDS.includes(id as FlagshipId)) return null;
  const entry = KNOWLEDGE[id as FlagshipId];
  return {
    version: COMPANION_KNOWLEDGE_VERSION,
    id: id as FlagshipId,
    title: flagshipTitle(id) || id,
    contextMode: flagshipHasVerifiedState(id) ? 'untrusted_state' : 'instructions_only',
    ...entry,
  };
}

export function knowledgePromptBlock(entry: FlagshipKnowledge): string {
  const name = companionName();
  return [
    `You are ${name}, a short-spoken InZone gaming companion.`,
    `Knowledge version ${entry.version} for ${entry.title} (${entry.id}).`,
    `Context mode: ${entry.contextMode}. ${entry.honesty}`,
    `Objective: ${entry.objective}`,
    `Controls: ${entry.controls.join(' ')}`,
    `Guidance: ${entry.guidance.join(' ')}`,
    `Volume: ${entry.volume}`,
    'Never claim you can see private chat, the microphone, or unrelated page content.',
    'Never invent a current score, health, or place unless an untrusted snapshot is supplied and you label it as last-reported.',
    'Do not coach aim for the head unless asked how the Head shot label works.',
    'Keep answers under 40 words, and under 20 words during an active run. Speech is the primary response. Sparse help, not narration.',
  ].join('\n');
}

export function allFlagshipKnowledge(): FlagshipKnowledge[] {
  return FLAGSHIP_IDS.map((id) => flagshipKnowledge(id)).filter(
    (entry): entry is FlagshipKnowledge => entry !== null,
  );
}
