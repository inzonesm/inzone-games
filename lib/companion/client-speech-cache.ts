/**
 * Little Chapters client cache: 24-entry in-memory LRU.
 * Keyed by the same parts as the server hash (text + voice + model +
 * language + settings), not text alone.
 */

export const CLIENT_SPEECH_CACHE_LIMIT = 24;

const clientCache = new Map<string, Blob>();

export function readClientSpeechCache(key: string): Blob | null {
  const hit = clientCache.get(key);
  if (!hit) return null;
  clientCache.delete(key);
  clientCache.set(key, hit);
  return hit;
}

export function writeClientSpeechCache(key: string, blob: Blob): void {
  if (clientCache.has(key)) clientCache.delete(key);
  clientCache.set(key, blob);
  while (clientCache.size > CLIENT_SPEECH_CACHE_LIMIT) {
    const oldest = clientCache.keys().next().value;
    if (oldest) clientCache.delete(oldest);
  }
}

export function clientSpeechCacheSize(): number {
  return clientCache.size;
}

export function resetClientSpeechCacheForTests(): void {
  clientCache.clear();
}
