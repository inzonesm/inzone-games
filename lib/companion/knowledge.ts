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
    objective: 'Finish the race ahead of the other karts. Menus and character select are not a race.',
    controls: [
      'Desktop: arrow keys or WASD to steer; hold the drive key to keep moving.',
      'Touch: on-screen steer and accelerate pads, if the build shows them.',
    ],
    guidance: [
      'Stay on the track. Cutting corners into walls usually costs more time than it saves.',
      'I cannot see your kart, lap, or item. Ask about controls or the goal, not "what should I do right now."',
    ],
    volume: 'This embed has not exposed a host volume API. Use the game mute if it has one; companion speech uses its own slider.',
    honesty: 'No verified InZone gameplay-state bridge. Instructions only.',
    verifiedAgainst: 'knowledge v1 — controls to be confirmed in ordinary-play verification',
  },
  clelytraflight: {
    objective: 'Stay airborne and complete the flight course. The lobby or hangar is not a flight.',
    controls: [
      'Desktop: look/steer with the pointer or keys; boost or flap with the action the build labels on first flight.',
      'Touch: drag to steer if the build shows a flight stick; tap the boost control if present.',
    ],
    guidance: [
      'Build speed before you pull up. Stalling is usually a steep climb with no airspeed.',
      'I cannot see altitude or heading. I will not pretend I am watching this flight.',
    ],
    volume: 'This embed has not exposed a host volume API. Companion speech is independent of game audio.',
    honesty: 'No verified InZone gameplay-state bridge. Instructions only.',
    verifiedAgainst: 'knowledge v1 — controls to be confirmed in ordinary-play verification',
  },
  'karate-bros': {
    objective: 'Win the bout by landing hits and avoiding the other fighter. Character select is not a bout.',
    controls: [
      'Desktop: move with A/D or arrows; punch and kick on the keys the bout HUD shows.',
      'Touch: on-screen move and attack pads, if the build draws them.',
    ],
    guidance: [
      'Do not mash every button. Space and punish after you see a miss.',
      'I cannot see health or who is winning. Ask how to play, not what to throw this second.',
    ],
    volume: 'This embed has not exposed a host volume API. Companion speech is independent of game audio.',
    honesty: 'No verified InZone gameplay-state bridge. Instructions only.',
    verifiedAgainst: 'knowledge v1 — controls to be confirmed in ordinary-play verification',
  },
  clescaperoad: {
    objective: 'Drive the escape route without crashing. The title or garage screen is not a run.',
    controls: [
      'Desktop: left/right or A/D to change lanes; hold accelerate if the build requires it.',
      'Touch: swipe or tap lane controls the build draws.',
    ],
    guidance: [
      'Look ahead one obstacle, not at the car. Late swerves into walls end the run.',
      'I cannot see your lane or score. I will not claim I can see this road.',
    ],
    volume: 'This embed has not exposed a host volume API. Companion speech is independent of game audio.',
    honesty: 'No verified InZone gameplay-state bridge. Instructions only.',
    verifiedAgainst: 'knowledge v1 — controls to be confirmed in ordinary-play verification',
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
      'Aim for the head. Empty clicks on the floor only walk.',
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
    'Keep answers under 40 words. Speech is the primary response.',
  ].join('\n');
}

export function allFlagshipKnowledge(): FlagshipKnowledge[] {
  return FLAGSHIP_IDS.map((id) => flagshipKnowledge(id)).filter(
    (entry): entry is FlagshipKnowledge => entry !== null,
  );
}
