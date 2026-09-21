import { createHash } from 'node:crypto';
import { DEFAULT_SPEECH_LANGUAGE } from './providers.ts';

export type CachedSpeech = {
  bytes: Buffer;
  contentType: string;
  provider: string;
  createdAt: number;
};

export type SpeechCacheParts = {
  text: string;
  provider: string;
  voiceId?: string | null;
  modelId?: string | null;
  language?: string | null;
  settings?: string | null;
  /** Output encoding (e.g. pcm_16000 vs mp3_44100_128). Distinct from voice settings. */
  format?: string | null;
};

const serverCache = new Map<string, CachedSpeech>();
const MAX_ENTRIES = 64;
const TTL_MS = 30 * 60 * 1000;

/** Little Chapters normalizes punctuation/whitespace before the cache key. */
export function normalizeSpokenText(text: string): string {
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Key includes text, voice, model, language, and voice settings.
 * Little Chapters' text-only key is insufficient when those can change.
 * This in-process Map is an InZone addition — the LC route/provider pair
 * has no server cache.
 */
export function speechCacheKey(parts: SpeechCacheParts): string {
  const spoken = normalizeSpokenText(parts.text);
  return createHash('sha256')
    .update(
      [
        parts.provider,
        parts.voiceId || '',
        parts.modelId || '',
        parts.language || DEFAULT_SPEECH_LANGUAGE,
        parts.settings || '',
        parts.format || '',
        spoken,
      ].join('\0'),
    )
    .digest('hex')
    .slice(0, 40);
}

export function readSpeechCache(key: string, now = Date.now()): CachedSpeech | null {
  const hit = serverCache.get(key);
  if (!hit) return null;
  if (now - hit.createdAt > TTL_MS) {
    serverCache.delete(key);
    return null;
  }
  return hit;
}

export function writeSpeechCache(key: string, value: CachedSpeech): void {
  if (serverCache.has(key)) serverCache.delete(key);
  if (serverCache.size >= MAX_ENTRIES) {
    const oldest = serverCache.keys().next().value;
    if (oldest) serverCache.delete(oldest);
  }
  serverCache.set(key, value);
}

export function resetSpeechCacheForTests(): void {
  serverCache.clear();
}
