/**
 * Honest companion grounding.
 *
 * Layers, never mixed:
 *   verifiedMechanics — inspected controls that exist on this build
 *   freshState        — last-reported bridge fields that are still fresh
 *   recentEvents      — run/death/restart that stale prior advice
 *   unknown           — things we must not invent
 */

import { flagshipHasVerifiedState, flagshipTitle } from '../flagship-roster.ts';
import { COMPANION_LIMITS } from './config.ts';
import type { NightclubPublicContext } from './nightclub-context.ts';

export type CompanionGrounding = {
  gameId: string;
  title: string;
  verifiedMechanics: string[];
  freshState: string | null;
  recentEvents: string[];
  unknown: string[];
  staleAdvice: boolean;
  runChanged: boolean;
  playActive: boolean;
};

const NIGHTCLUB_MECHANICS = [
  'Click bare floor to walk there.',
  'Click an enemy to shoot. The build labels Head shot on the head and Quick shoot on the body.',
  'Click yourself to reload once ammo is spent.',
  'Click cover to take cover.',
  'Keyboard does not drive play. T restarts only when the canvas is focused and the engine is not paused.',
];

const NIGHTCLUB_UNKNOWN = [
  'enemy positions',
  'who is under the cursor',
  'whether a shot will land',
  'ammo or life unless last-reported in a fresh snapshot',
  'a shared multiplayer match — Nightclub invite is conversation only',
];

export function nightclubPlayActive(ctx: NightclubPublicContext | null): boolean {
  if (!ctx || ctx.stale) return false;
  if (ctx.ended) return false;
  if (ctx.paused) return false;
  if (ctx.cinematic) return false;
  return true;
}

export function buildCompanionGrounding(input: {
  gameId: string;
  nightclub: NightclubPublicContext | null;
  previousRunId?: string | null;
}): CompanionGrounding {
  const title = flagshipTitle(input.gameId) || input.gameId;
  if (input.gameId !== 'nightclub-showdown-inzone-production') {
    return {
      gameId: input.gameId,
      title,
      verifiedMechanics: [],
      freshState: null,
      recentEvents: [],
      unknown: [
        'current score',
        'health',
        'positions',
        'whether a race, bout, or flight has actually started',
      ],
      staleAdvice: false,
      runChanged: false,
      playActive: false,
    };
  }

  const ctx = input.nightclub;
  const runChanged = Boolean(
    ctx?.runId && input.previousRunId && ctx.runId !== input.previousRunId,
  );
  const diedOrEnded = Boolean(ctx && !ctx.stale && ctx.ended);
  const recentEvents: string[] = [];
  if (runChanged) recentEvents.push(`run changed to ${ctx?.runId}`);
  if (diedOrEnded) recentEvents.push('the last-reported match had ended');
  if (ctx?.cinematic && !ctx.stale) recentEvents.push('intro cinematic still running');

  let freshState: string | null = null;
  if (ctx && !ctx.stale) {
    const bits: string[] = [];
    if (ctx.runId) bits.push(ctx.runId);
    if (ctx.waveId !== undefined) bits.push(`wave ${ctx.waveId}`);
    if (ctx.heroLife !== undefined) bits.push(`life ${ctx.heroLife}`);
    if (ctx.mobsAlive !== undefined) bits.push(`${ctx.mobsAlive} mobs`);
    if (ctx.ammo !== undefined) bits.push(`${ctx.ammo} ammo`);
    if (ctx.paused) bits.push('paused');
    freshState = bits.length ? bits.join(', ') : 'a live snapshot with no useful fields';
  }

  return {
    gameId: input.gameId,
    title,
    verifiedMechanics: NIGHTCLUB_MECHANICS,
    freshState,
    recentEvents,
    unknown: NIGHTCLUB_UNKNOWN,
    staleAdvice: runChanged || diedOrEnded || !ctx || ctx.stale,
    runChanged,
    playActive: nightclubPlayActive(ctx),
  };
}

export function groundingPromptBlock(grounding: CompanionGrounding): string {
  const lines = [
    `Grounding for ${grounding.title}.`,
    `Verified mechanics: ${grounding.verifiedMechanics.join(' ') || 'none on this title.'}`,
    grounding.freshState
      ? `Fresh last-reported state: ${grounding.freshState}. Label as last-reported, not live sight.`
      : 'No fresh game state is attached.',
    grounding.recentEvents.length
      ? `Recent session events: ${grounding.recentEvents.join('; ')}. Discard advice that assumed the previous run.`
      : 'No death or restart event is attached.',
    `Unknown — do not invent: ${grounding.unknown.join(', ')}.`,
    'Do not say aim for the head as a tip unless answering how shooting is labeled.',
    'Do not claim you can see enemies, positions, or ammo that are not in the fresh snapshot.',
    grounding.playActive
      ? `The player is in an active run. Keep the spoken reply under ${COMPANION_LIMITS.maxPlayReplyChars} characters. Sparse help, not narration.`
      : 'The player is not in a fresh active run. Stay brief. Do not narrate constantly.',
  ];
  if (!flagshipHasVerifiedState(grounding.gameId)) {
    lines.push('This title has no verified InZone state bridge. Instructions only.');
  }
  return lines.join('\n');
}
