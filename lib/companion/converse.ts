/**
 * Conversational reply: OpenAI chat when a server key exists, otherwise the
 * scripted grounded fallback. ElevenLabs is speech only — it never reasons.
 */

import { flagshipHasVerifiedState } from '../flagship-roster.ts';
import { COMPANION_LIMITS, companionName } from './config.ts';
import { flagshipKnowledge, knowledgePromptBlock } from './knowledge.ts';
import { describeNightclubContext, type NightclubPublicContext } from './nightclub-context.ts';
import {
  buildCompanionReply,
  type CompanionIntent,
  type CompanionReply,
} from './reply.ts';

export type ConversationTurn = {
  role: 'user' | 'assistant';
  text: string;
};

export type ChatProvider = 'openai' | 'none';
export type ReplySource = 'model' | 'scripted_fallback';

export type ConverseResult = CompanionReply & {
  replySource: ReplySource;
  modelProvider: ChatProvider;
  modelId: string | null;
  /** Billed model characters (prompt history + user + completion). 0 if OpenAI was not used. */
  chatCharsUsed: number;
  fallbackReason: 'quota_unavailable' | 'model_failed' | 'provider_unconfigured' | null;
};

export const MAX_SESSION_TURNS = 6;

const sessions = new Map<string, { turns: ConversationTurn[]; at: number }>();

export function selectChatProvider(
  env: { [key: string]: string | undefined } = process.env,
): { provider: ChatProvider; modelId: string | null } {
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return { provider: 'none', modelId: null };
  return {
    provider: 'openai',
    modelId: env.OPENAI_CHAT_MODEL?.trim() || 'gpt-4o-mini',
  };
}

export function sanitizeHistory(raw: unknown): ConversationTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: ConversationTurn[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as { role?: unknown; text?: unknown };
    const role = rec.role === 'user' || rec.role === 'assistant' ? rec.role : null;
    const text = typeof rec.text === 'string' ? rec.text.replace(/\s+/g, ' ').trim() : '';
    if (!role || !text) continue;
    out.push({ role, text: text.slice(0, COMPANION_LIMITS.maxReplyChars) });
    if (out.length >= MAX_SESSION_TURNS) break;
  }
  return out;
}

export function sessionKey(uid: string, gameId: string): string {
  return `${uid.slice(0, 128)}:${gameId.slice(0, 128)}`;
}

export function readCompanionSession(uid: string, gameId: string, now = Date.now()): ConversationTurn[] {
  const hit = sessions.get(sessionKey(uid, gameId));
  if (!hit) return [];
  if (now - hit.at > COMPANION_LIMITS.turnWindowMs) {
    sessions.delete(sessionKey(uid, gameId));
    return [];
  }
  return hit.turns.slice(-MAX_SESSION_TURNS);
}

export function writeCompanionSession(
  uid: string,
  gameId: string,
  turns: ConversationTurn[],
  now = Date.now(),
): void {
  sessions.set(sessionKey(uid, gameId), {
    turns: turns.slice(-MAX_SESSION_TURNS),
    at: now,
  });
}

export function resetCompanionSessionsForTests(): void {
  sessions.clear();
}

function clip(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= COMPANION_LIMITS.maxReplyChars) return clean;
  return `${clean.slice(0, COMPANION_LIMITS.maxReplyChars - 1).trim()}…`;
}

function inventsSight(text: string, usedUntrustedState: boolean): boolean {
  const t = text.toLowerCase();
  if (/\bi (can |just )?(see|watch|looking at) you\b/.test(t)) return true;
  if (/\byour (score|health|place|kart|fighter) is\b/.test(t)) return true;
  if (!usedUntrustedState && /\b(you have \d+ ammo|wave \d+|hero life \d+)\b/.test(t)) return true;
  return false;
}

function followUpScripted(
  fallback: CompanionReply,
  transcript: string,
  history: ConversationTurn[],
): CompanionReply {
  if (history.length < 1) return fallback;
  const lastAssistant = [...history].reverse().find((t) => t.role === 'assistant')?.text || '';
  const follow =
    /\b(that|those|it|next|then|and (the|that)|what about|how about|same|again)\b/i.test(transcript);
  if (!follow || !lastAssistant) return fallback;
  const tag =
    ' You asked about that last bit — still the same limits. I will not invent a move I have not verified.';
  const room = COMPANION_LIMITS.maxReplyChars - tag.length;
  const base =
    fallback.text.length <= room
      ? fallback.text
      : `${fallback.text.slice(0, Math.max(0, room - 1)).trim()}…`;
  return {
    ...fallback,
    text: clip(`${base}${tag}`),
  };
}

async function askOpenAi(input: {
  system: string;
  history: ConversationTurn[];
  user: string;
  env: { [key: string]: string | undefined };
  signal?: AbortSignal;
}): Promise<string | null> {
  const chat = selectChatProvider(input.env);
  const apiKey = input.env.OPENAI_API_KEY?.trim();
  if (!apiKey || chat.provider !== 'openai' || !chat.modelId) return null;
  const messages = [
    { role: 'system', content: input.system },
    ...input.history.map((turn) => ({
      role: turn.role === 'assistant' ? 'assistant' : 'user',
      content: turn.text,
    })),
    { role: 'user', content: input.user },
  ];
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: chat.modelId,
      temperature: 0.4,
      max_tokens: 120,
      messages,
    }),
    signal: input.signal,
  });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = body.choices?.[0]?.message?.content?.replace(/\s+/g, ' ').trim() || '';
  return text || null;
}

export function measureChatUsage(
  transcript: string,
  history: ConversationTurn[],
  reply: string,
): number {
  const hist = history.reduce((sum, turn) => sum + turn.text.length, 0);
  return transcript.length + hist + reply.length;
}

export async function converseCompanion(input: {
  uid: string;
  gameId: string;
  intent: CompanionIntent;
  transcript: string;
  nightclub: NightclubPublicContext | null;
  history?: unknown;
  env?: { [key: string]: string | undefined };
  signal?: AbortSignal;
  /** Paid OpenAI is opt-in. Hosted callers must only set this after a Firestore reserve. */
  allowPaidChat?: boolean;
  paidBlockReason?: 'quota_unavailable' | null;
}): Promise<ConverseResult | { error: 'unknown_game' | 'empty_ask' }> {
  const env = input.env ?? process.env;
  const chat = selectChatProvider(env);
  const scripted = buildCompanionReply({
    gameId: input.gameId,
    intent: input.intent,
    transcript: input.transcript,
    nightclub: input.nightclub,
  });
  if ('error' in scripted) return scripted;

  const entry = flagshipKnowledge(input.gameId);
  if (!entry) return { error: 'unknown_game' };

  const incoming = sanitizeHistory(input.history);
  const stored = readCompanionSession(input.uid, input.gameId);
  const history = (incoming.length ? incoming : stored).slice(-MAX_SESSION_TURNS);
  const fallbackBase =
    input.intent === 'ask' ? followUpScripted(scripted, input.transcript, history) : scripted;

  const asFallback = (
    reply: CompanionReply,
    fallbackReason: ConverseResult['fallbackReason'],
    chatCharsUsed = 0,
  ): ConverseResult => ({
    ...reply,
    replySource: 'scripted_fallback',
    modelProvider: chat.provider,
    modelId: chat.modelId,
    chatCharsUsed,
    fallbackReason,
  });

  if (!input.allowPaidChat || chat.provider !== 'openai') {
    const next = asFallback(
      fallbackBase,
      chat.provider === 'openai'
        ? input.paidBlockReason ?? 'quota_unavailable'
        : 'provider_unconfigured',
    );
    writeCompanionSession(input.uid, input.gameId, [
      ...history,
      ...(input.intent === 'ask' ? [{ role: 'user' as const, text: input.transcript }] : []),
      { role: 'assistant', text: next.text },
    ]);
    return next;
  }

  const userLine =
    input.intent === 'intro'
      ? 'Give a one-breath hello. Do not invent sight or controls.'
      : input.transcript;
  const system = [
    knowledgePromptBlock(entry),
    describeNightclubContext(input.nightclub),
    flagshipHasVerifiedState(input.gameId)
      ? 'You may mention last-reported Nightclub fields only when the snapshot is fresh, and you must label them last-reported.'
      : 'You cannot see this game. Do not invent a score, place, or current move.',
    `You are ${companionName()}. Answer the follow-up using prior turns if they are about this same game.`,
  ].join('\n');

  try {
    const raw = await askOpenAi({
      system,
      history,
      user: userLine,
      env,
      signal: input.signal,
    });
    const usedUntrustedState = Boolean(
      input.nightclub && !input.nightclub.stale && /\b(last reported|wave|ammo|life)\b/i.test(raw || ''),
    );
    const billed = raw ? measureChatUsage(userLine, history, clip(raw)) : 0;
    if (raw && !inventsSight(raw, usedUntrustedState)) {
      const text = clip(raw);
      const next: ConverseResult = {
        text,
        gameId: entry.id,
        knowledgeVersion: entry.version,
        contextMode: entry.contextMode,
        usedUntrustedState,
        replySource: 'model',
        modelProvider: 'openai',
        modelId: chat.modelId,
        chatCharsUsed: billed,
        fallbackReason: null,
      };
      writeCompanionSession(input.uid, input.gameId, [
        ...history,
        { role: 'user', text: userLine },
        { role: 'assistant', text: next.text },
      ]);
      return next;
    }
    const rejected = asFallback(fallbackBase, 'model_failed', billed);
    writeCompanionSession(input.uid, input.gameId, [
      ...history,
      { role: 'user', text: userLine },
      { role: 'assistant', text: rejected.text },
    ]);
    return rejected;
  } catch {
    /* fall through to scripted */
  }

  const next = asFallback(fallbackBase, 'model_failed');
  writeCompanionSession(input.uid, input.gameId, [
    ...history,
    { role: 'user', text: userLine },
    { role: 'assistant', text: next.text },
  ]);
  return next;
}
