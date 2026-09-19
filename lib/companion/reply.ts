import { flagshipHasVerifiedState } from '../flagship-roster.ts';
import { COMPANION_LIMITS, companionName } from './config.ts';
import {
  flagshipKnowledge,
  knowledgePromptBlock,
  type CompanionContextMode,
  type FlagshipKnowledge,
} from './knowledge.ts';
import { describeNightclubContext, type NightclubPublicContext } from './nightclub-context.ts';

export type CompanionIntent = 'intro' | 'ask';

export type CompanionReply = {
  text: string;
  gameId: string;
  knowledgeVersion: number;
  contextMode: CompanionContextMode;
  usedUntrustedState: boolean;
};

function clip(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= COMPANION_LIMITS.maxReplyChars) return clean;
  return `${clean.slice(0, COMPANION_LIMITS.maxReplyChars - 1).trim()}…`;
}

function classifyAsk(transcript: string): 'controls' | 'objective' | 'state' | 'volume' | 'general' {
  const t = transcript.toLowerCase();
  if (/\b(mute|volume|sound|audio|duck)\b/.test(t)) return 'volume';
  if (/\b(what do i do|how do i|control|move|shoot|steer|punch|kick|boost|lane|click)\b/.test(t)) {
    return 'controls';
  }
  if (/\b(goal|objective|win|point|what is this)\b/.test(t)) return 'objective';
  if (/\b(where am i|what wave|how much|ammo|health|life|score|am i winning|look)\b/.test(t)) {
    return 'state';
  }
  return 'general';
}

function groundedAsk(
  entry: FlagshipKnowledge,
  transcript: string,
  nightclub: NightclubPublicContext | null,
): { text: string; usedUntrustedState: boolean } {
  const kind = classifyAsk(transcript);
  const name = companionName();
  if (kind === 'volume') {
    return { text: `${name} here. ${entry.volume}`, usedUntrustedState: false };
  }
  if (kind === 'controls') {
    return { text: `${entry.controls[0]} ${entry.controls[1] || ''}`.trim(), usedUntrustedState: false };
  }
  if (kind === 'objective') {
    return { text: entry.objective, usedUntrustedState: false };
  }
  if (kind === 'state') {
    if (entry.contextMode === 'instructions_only') {
      return {
        text: `I cannot see ${entry.title}. ${entry.honesty} ${entry.controls[0]}`,
        usedUntrustedState: false,
      };
    }
    if (!nightclub || nightclub.stale) {
      return {
        text: `I have a Nightclub bridge, but I will not coach from a stale or missing snapshot. ${entry.controls[0]}`,
        usedUntrustedState: false,
      };
    }
    const bits = [];
    if (nightclub.ended) bits.push('the match had ended');
    if (nightclub.waveId !== undefined) bits.push(`wave ${nightclub.waveId}`);
    if (nightclub.ammo !== undefined) bits.push(`${nightclub.ammo} ammo`);
    if (nightclub.heroLife !== undefined) bits.push(`life ${nightclub.heroLife}`);
    if (nightclub.mobsAlive !== undefined) bits.push(`${nightclub.mobsAlive} mobs`);
    return {
      text: `Last reported: ${bits.join(', ') || 'a live snapshot with no useful fields'}. That is not a guarantee I see this second.`,
      usedUntrustedState: true,
    };
  }
  return {
    text: `${entry.guidance[0]} ${entry.honesty}`,
    usedUntrustedState: false,
  };
}

export function buildCompanionReply(input: {
  gameId: string;
  intent: CompanionIntent;
  transcript: string;
  nightclub: NightclubPublicContext | null;
}): CompanionReply | { error: 'unknown_game' | 'empty_ask' } {
  const entry = flagshipKnowledge(input.gameId);
  if (!entry) return { error: 'unknown_game' };
  const name = companionName();
  if (input.intent === 'intro') {
    const see = flagshipHasVerifiedState(input.gameId)
      ? 'I can read a few last-reported club numbers, not reliable coaching.'
      : 'I cannot see this game. I can talk controls and the goal.';
    return {
      text: clip(`Hey, I'm ${name}. ${entry.controls[0]} ${see}`),
      gameId: entry.id,
      knowledgeVersion: entry.version,
      contextMode: entry.contextMode,
      usedUntrustedState: false,
    };
  }
  const transcript = input.transcript.replace(/\s+/g, ' ').trim();
  if (!transcript) return { error: 'empty_ask' };
  const ask = groundedAsk(entry, transcript, input.nightclub);
  return {
    text: clip(ask.text),
    gameId: entry.id,
    knowledgeVersion: entry.version,
    contextMode: entry.contextMode,
    usedUntrustedState: ask.usedUntrustedState,
  };
}

export function companionSystemPrompt(
  entry: FlagshipKnowledge,
  nightclub: NightclubPublicContext | null,
): string {
  return `${knowledgePromptBlock(entry)}\n${describeNightclubContext(nightclub)}`;
}
