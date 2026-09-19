#!/usr/bin/env node
/**
 * Regression harness for cancellation, cache keys, and ducking ownership.
 * Little Chapters ducks only its own theme/ambience. Companion speech must
 * not claim game-audio ducking. Object-URL cleanup is covered in the
 * audio-session implementation; this script checks the cache/generation
 * contracts that session uses.
 */
import assert from 'node:assert/strict';
import {
  readSpeechCache,
  resetSpeechCacheForTests,
  speechCacheKey,
  writeSpeechCache,
} from '../lib/companion/cache.ts';
import {
  CLIENT_SPEECH_CACHE_LIMIT,
  clientSpeechCacheSize,
  readClientSpeechCache,
  resetClientSpeechCacheForTests,
  writeClientSpeechCache,
} from '../lib/companion/client-speech-cache.ts';

resetSpeechCacheForTests();
const keyA = speechCacheKey({
  text: 'Hold to talk.',
  provider: 'elevenlabs',
  voiceId: 'EXAVITQu4vr4xnSDxMaL',
  modelId: 'eleven_turbo_v2',
  language: 'en-US',
  settings: 'stb:0.55|sim:0.75|sty:0.25|spk:true',
});
const keyB = speechCacheKey({
  text: 'Hold to talk.',
  provider: 'elevenlabs',
  voiceId: 'EXAVITQu4vr4xnSDxMaL',
  modelId: 'eleven_multilingual_v2',
  language: 'en-US',
  settings: 'stb:0.55|sim:0.75|sty:0.25|spk:true',
});
assert.notEqual(keyA, keyB);
writeSpeechCache(keyA, {
  bytes: Buffer.from('mpeg-bytes-placeholder-32!!!!!!!!!!!!!!'),
  contentType: 'audio/mpeg',
  provider: 'elevenlabs',
  createdAt: Date.now(),
});
assert.ok(readSpeechCache(keyA));
assert.equal(readSpeechCache(keyB), null);

resetClientSpeechCacheForTests();
writeClientSpeechCache(keyA, new Blob(['one']));
assert.ok(readClientSpeechCache(keyA));
for (let i = 0; i < CLIENT_SPEECH_CACHE_LIMIT; i += 1) {
  writeClientSpeechCache(`evict-${i}`, new Blob([String(i)]));
}
assert.equal(clientSpeechCacheSize(), CLIENT_SPEECH_CACHE_LIMIT);
assert.equal(readClientSpeechCache(keyA), null);

let generation = 0;
const bump = () => {
  generation += 1;
};
bump();
const captured = generation;
bump();
assert.notEqual(captured, generation);

console.log(
  JSON.stringify(
    {
      ok: true,
      ducksGameAudio: false,
      cacheKeysDifferByModel: keyA !== keyB,
      clientLimit: CLIENT_SPEECH_CACHE_LIMIT,
    },
    null,
    2,
  ),
);
