/**
 * Temporary companion identity and spend/size bounds.
 * Jayme still owns the final spoken name.
 */

export const COMPANION_NAME_DEFAULT = 'Rook';
export const COMPANION_KNOWLEDGE_VERSION = 1;

export function companionName(): string {
  const raw = (process.env.NEXT_PUBLIC_COMPANION_NAME || COMPANION_NAME_DEFAULT).trim();
  return raw.slice(0, 24) || COMPANION_NAME_DEFAULT;
}

export const COMPANION_LIMITS = {
  maxTranscriptChars: 400,
  maxBodyBytes: 8_192,
  maxTurnsPerWindow: 12,
  turnWindowMs: 10 * 60 * 1000,
  maxConcurrentPerUid: 1,
  maxChatCharsPerUidDay: 40_000,
  maxChatCharsGlobalDay: 400_000,
  maxTtsCharsPerUidDay: 20_000,
  maxTtsCharsGlobalDay: 200_000,
  maxReplyChars: 280,
  staleContextMs: 8_000,
  maxSessionTurns: 6,
} as const;

/** Conservative reserve before a paid chat+TTS turn. Chat is not measured in TTS characters. */
export function companionReserveAmounts(): { chatChars: number; ttsChars: number } {
  return {
    chatChars:
      COMPANION_LIMITS.maxTranscriptChars +
      (COMPANION_LIMITS.maxSessionTurns + 1) * COMPANION_LIMITS.maxReplyChars,
    ttsChars: COMPANION_LIMITS.maxReplyChars,
  };
}

/** Server-only env names. Never put provider keys in NEXT_PUBLIC_*. */
export const COMPANION_SERVER_ENV = [
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_VOICE_ID',
  'ELEVENLABS_MODEL_ID',
  'OPENAI_API_KEY',
  'OPENAI_CHAT_MODEL',
  'OPENAI_TTS_MODEL',
  'OPENAI_TTS_VOICE',
  'FIREBASE_SERVICE_ACCOUNT',
  'NEXT_PUBLIC_FIREBASE_API_KEY',
] as const;

/** Client/build-time: `web-speech` forces browser TTS. Unset or `elevenlabs` attempts ElevenLabs. */
export const COMPANION_PUBLIC_VOICE_PROVIDER = 'NEXT_PUBLIC_VOICE_PROVIDER';
