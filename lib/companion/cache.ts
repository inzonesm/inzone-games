import { createHash } from 'node:crypto';

export type CachedSpeech = {
  bytes: Buffer;
  contentType: string;
  provider: string;
  createdAt: number;
};

const serverCache = new Map<string, CachedSpeech>();
const MAX_ENTRIES = 64;
const TTL_MS = 30 * 60 * 1000;

export function speechCacheKey(text: string, provider: string, voiceId: string | null): string {
  return createHash('sha256')
    .update(`${provider}\0${voiceId || ''}\0${text}`)
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
  if (serverCache.size >= MAX_ENTRIES) {
    const oldest = serverCache.keys().next().value;
    if (oldest) serverCache.delete(oldest);
  }
  serverCache.set(key, value);
}

export function resetSpeechCacheForTests(): void {
  serverCache.clear();
}
