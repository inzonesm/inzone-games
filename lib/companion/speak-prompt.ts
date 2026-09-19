/**
 * speakPrompt() — Little Chapters speech generation entry.
 *
 * Server cache first, then ElevenLabs, then OpenAI TTS. The browser fallback
 * is returned as a descriptor so the client can use speechSynthesis.
 */

import { readSpeechCache, speechCacheKey, writeSpeechCache } from './cache.ts';
import { synthesizeElevenLabs } from './elevenlabs.server.ts';
import { selectSpeechProvider, type SpeechProvider } from './providers.ts';

export type SpeakPromptResult =
  | {
      provider: Exclude<SpeechProvider, 'browser'>;
      cacheKey: string;
      bytes: Buffer;
      contentType: string;
      cached: boolean;
    }
  | {
      provider: 'browser';
      cacheKey: null;
      text: string;
    };

async function synthesizeOpenAi(
  text: string,
  options: { signal?: AbortSignal; env?: NodeJS.ProcessEnv } = {},
): Promise<{ bytes: Buffer; contentType: string }> {
  const env = options.env ?? process.env;
  const config = selectSpeechProvider(env);
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey || config.provider !== 'openai') throw new Error('openai_unconfigured');
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.modelId || 'gpt-4o-mini-tts',
      voice: config.voiceId || 'alloy',
      input: text,
      format: 'mp3',
    }),
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`openai_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 32) throw new Error('openai_empty');
  return { bytes, contentType: 'audio/mpeg' };
}

export async function speakPrompt(
  text: string,
  options: { signal?: AbortSignal; env?: NodeJS.ProcessEnv } = {},
): Promise<SpeakPromptResult> {
  const spoken = text.replace(/\s+/g, ' ').trim();
  if (!spoken) throw new Error('empty_speech');
  const env = options.env ?? process.env;
  const config = selectSpeechProvider(env);
  if (config.provider === 'browser') {
    return { provider: 'browser', cacheKey: null, text: spoken };
  }
  const cacheKey = speechCacheKey(spoken, config.provider, config.voiceId);
  const cached = readSpeechCache(cacheKey);
  if (cached) {
    return {
      provider: config.provider,
      cacheKey,
      bytes: cached.bytes,
      contentType: cached.contentType,
      cached: true,
    };
  }
  const produced =
    config.provider === 'elevenlabs'
      ? await synthesizeElevenLabs(spoken, options)
      : await synthesizeOpenAi(spoken, options);
  writeSpeechCache(cacheKey, {
    bytes: produced.bytes,
    contentType: produced.contentType,
    provider: config.provider,
    createdAt: Date.now(),
  });
  return {
    provider: config.provider,
    cacheKey,
    bytes: produced.bytes,
    contentType: produced.contentType,
    cached: false,
  };
}
