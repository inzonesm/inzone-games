/**
 * speakPrompt() — speech generation entry.
 *
 * Incremental path: ElevenLabs PCM (`pcm_16000`) is forwarded as NDJSON
 * chunks while it arrives. MPEG/blob remains the compatible fallback.
 * Cache keys include output format so PCM and MPEG never mix.
 */

import { readSpeechCache, speechCacheKey, writeSpeechCache } from './cache.ts';
import {
  ELEVENLABS_PCM_OUTPUT,
  ELEVENLABS_PCM_RATE,
  streamElevenLabsPcm,
  synthesizeElevenLabs,
} from './elevenlabs.server.ts';
import {
  elevenLabsSettingsFingerprint,
  selectSpeechProvider,
  type SpeechProvider,
} from './providers.ts';

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

export type SpeechStreamEvent =
  | {
      type: 'audio-start';
      format: 'pcm_s16le';
      sampleRate: number;
      channels: 1;
      cacheKey: string;
      cached: boolean;
      playback: 'incremental';
    }
  | { type: 'audio-chunk'; data: string }
  | { type: 'audio-end'; cacheKey: string; cached: boolean }
  | { type: 'audio-abort'; reason: string };

export type SpeakPromptStreamResult = SpeakPromptResult & {
  playback: 'incremental' | 'blob' | 'browser';
};

const PCM_EMIT_MIN = 2048;

async function synthesizeOpenAi(
  text: string,
  options: { signal?: AbortSignal; env?: { [key: string]: string | undefined } } = {},
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
  options: {
    signal?: AbortSignal;
    env?: { [key: string]: string | undefined };
    /** Paid ElevenLabs / OpenAI TTS is opt-in after a Firestore reserve. */
    allowPaidSpeech?: boolean;
  } = {},
): Promise<SpeakPromptResult> {
  const spoken = text.replace(/\s+/g, ' ').trim();
  if (!spoken) throw new Error('empty_speech');
  const env = options.env ?? process.env;
  const config = selectSpeechProvider(env);
  if (!options.allowPaidSpeech || config.provider === 'browser') {
    return { provider: 'browser', cacheKey: null, text: spoken };
  }
  const cacheKey = speechCacheKey({
    text: spoken,
    provider: config.provider,
    voiceId: config.voiceId,
    modelId: config.modelId,
    language: config.language,
    settings:
      config.provider === 'elevenlabs'
        ? elevenLabsSettingsFingerprint(config.voiceSettings ?? undefined)
        : config.voiceId,
  });
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

function pcmCacheKey(
  spoken: string,
  config: ReturnType<typeof selectSpeechProvider>,
): string {
  return speechCacheKey({
    text: spoken,
    provider: config.provider,
    voiceId: config.voiceId,
    modelId: config.modelId,
    language: config.language,
    settings:
      config.provider === 'elevenlabs'
        ? elevenLabsSettingsFingerprint(config.voiceSettings ?? undefined)
        : config.voiceId,
    format: ELEVENLABS_PCM_OUTPUT,
  });
}

function emitCachedPcm(
  bytes: Buffer,
  cacheKey: string,
  onEvent?: (event: SpeechStreamEvent) => void,
) {
  onEvent?.({
    type: 'audio-start',
    format: 'pcm_s16le',
    sampleRate: ELEVENLABS_PCM_RATE,
    channels: 1,
    cacheKey,
    cached: true,
    playback: 'incremental',
  });
  for (let i = 0; i < bytes.length; i += PCM_EMIT_MIN) {
    onEvent?.({ type: 'audio-chunk', data: bytes.subarray(i, i + PCM_EMIT_MIN).toString('base64') });
  }
  onEvent?.({ type: 'audio-end', cacheKey, cached: true });
}

/**
 * Prefer incremental PCM. Caller receives audio-start/chunk/end while the
 * upstream stream is still open. MPEG remains in speakPrompt() as fallback.
 */
export async function speakPromptStream(
  text: string,
  options: {
    signal?: AbortSignal;
    env?: { [key: string]: string | undefined };
    allowPaidSpeech?: boolean;
    onEvent?: (event: SpeechStreamEvent) => void;
  } = {},
): Promise<SpeakPromptStreamResult> {
  const spoken = text.replace(/\s+/g, ' ').trim();
  if (!spoken) throw new Error('empty_speech');
  const env = options.env ?? process.env;
  const config = selectSpeechProvider(env);
  if (!options.allowPaidSpeech || config.provider === 'browser') {
    return { provider: 'browser', cacheKey: null, text: spoken, playback: 'browser' };
  }
  if (config.provider !== 'elevenlabs') {
    const blob = await speakPrompt(spoken, options);
    return { ...blob, playback: blob.provider === 'browser' ? 'browser' : 'blob' };
  }
  const cacheKey = pcmCacheKey(spoken, config);
  const cached = readSpeechCache(cacheKey);
  if (cached && cached.contentType.includes('pcm')) {
    emitCachedPcm(cached.bytes, cacheKey, options.onEvent);
    return {
      provider: 'elevenlabs',
      cacheKey,
      bytes: cached.bytes,
      contentType: cached.contentType,
      cached: true,
      playback: 'incremental',
    };
  }

  const stream = await streamElevenLabsPcm(spoken, options);
  options.onEvent?.({
    type: 'audio-start',
    format: 'pcm_s16le',
    sampleRate: stream.sampleRate,
    channels: 1,
    cacheKey,
    cached: false,
    playback: 'incremental',
  });
  const parts: Buffer[] = [];
  let pending = Buffer.alloc(0);
  const reader = stream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const incoming = Buffer.from(value);
      pending = pending.byteLength ? Buffer.concat([pending, incoming]) : incoming;
      while (pending.byteLength >= PCM_EMIT_MIN) {
        const slice = pending.subarray(0, PCM_EMIT_MIN);
        pending = pending.subarray(PCM_EMIT_MIN);
        parts.push(slice);
        options.onEvent?.({ type: 'audio-chunk', data: slice.toString('base64') });
      }
    }
    if (pending.byteLength) {
      parts.push(pending);
      options.onEvent?.({ type: 'audio-chunk', data: pending.toString('base64') });
    }
  } catch (err) {
    options.onEvent?.({ type: 'audio-abort', reason: 'stream_read_failed' });
    throw err;
  }
  const bytes = parts.length === 1 ? parts[0] : Buffer.concat(parts);
  if (bytes.length < 32) {
    options.onEvent?.({ type: 'audio-abort', reason: 'empty_audio' });
    throw new Error('elevenlabs_empty');
  }
  writeSpeechCache(cacheKey, {
    bytes,
    contentType: 'audio/pcm',
    provider: 'elevenlabs',
    createdAt: Date.now(),
  });
  options.onEvent?.({ type: 'audio-end', cacheKey, cached: false });
  return {
    provider: 'elevenlabs',
    cacheKey,
    bytes,
    contentType: 'audio/pcm',
    cached: false,
    playback: 'incremental',
  };
}
