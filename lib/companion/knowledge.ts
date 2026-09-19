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
    objective: 'Finish a race against other karts. The Host/Join lobby and a room-code dialog are not a race.',
    controls: [
      'This build first shows an online lobby: Host, Join, and a room code. An empty Join opens Invalid code.',
      'A solo/local race start was not reached in the 2026-09-19 emulated session. That is an incomplete journey, not by itself a product defect, so I will not invent WASD.',
    ],
    guidance: [
      'Dismiss Invalid code, then Host a room if you want a race. I cannot see your lobby or kart.',
      'Portrait leaves a large letterbox. That is not proof the race inputs work on a phone.',
    ],
    volume: 'The embed did not expose a host volume API. Companion speech uses its own slider.',
    honesty: 'No verified InZone gameplay-state bridge. Instructions only. A race journey was not completed in the emulated session.',
    verifiedAgainst: 'v1 index.html on preview SHA 79b5b01, emulated Chromium 2026-09-19 — lobby only',
  },
  clelytraflight: {
    objective: 'Stay airborne across the course. Standing on the ground with a move pad is not a completed flight.',
    controls: [
      'Observed on-screen Move pad plus W/A/S/D. Hearts sit in the HUD.',
      'Takeoff was not confirmed. That means the flight journey was not completed — I will not call it a broken game or invent a boost key.',
    ],
    guidance: [
      'If you are still walking, look for a jump or glide control the build draws. I cannot see altitude.',
    ],
    volume: 'The embed did not expose a host volume API. Companion speech is independent of game audio.',
    honesty: 'No verified InZone gameplay-state bridge. Instructions only. Flight journey not completed in the emulated session.',
    verifiedAgainst: 'v1 index.html on preview SHA 79b5b01, emulated Chromium 2026-09-19 — world + move pad',
  },
  'karate-bros': {
    objective: 'Win a bout. Character select is not a bout.',
    controls: [
      'Observed: Choose your bro, then a Ready control. Fighter stats are on that screen.',
      'The Ready screen was reached; a bout was not completed. That is an incomplete journey, not by itself a product defect, so I will not invent punch keys.',
    ],
    guidance: [
      'Pick a fighter and press Ready to start a bout. I cannot see health or who is winning.',
    ],
    volume: 'The embed did not expose a host volume API. Companion speech is independent of game audio.',
    honesty: 'No verified InZone gameplay-state bridge. Instructions only. Bout journey not completed in the emulated session.',
    verifiedAgainst: 'v1 index.html on preview SHA 79b5b01, emulated Chromium 2026-09-19 — character select',
  },
  clescaperoad: {
    objective: 'Stay on the road and avoid crashes. A title screen is not a run.',
    controls: [
      'Observed an isometric road, a player car, traffic, and a score chip. Lane-change keys were not proven.',
      'I will not claim I am steering this car.',
    ],
    guidance: [
      'If the car is already on the road, try left/right to change lanes. I cannot see your score live.',
    ],
    volume: 'The embed did not expose a host volume API. Companion speech is independent of game audio.',
    honesty: 'No verified InZone gameplay-state bridge. Instructions only. Input during a run is unverified.',
    verifiedAgainst: 'v1 index.html on preview SHA 79b5b01, emulated Chromium 2026-09-19 — road visible, input unproven',
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
