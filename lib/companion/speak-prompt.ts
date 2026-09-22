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

/** OpenAI TTS returns raw 24 kHz mono 16-bit little-endian PCM for
 *  `response_format: 'pcm'`, which is the same shape the incremental player
 *  already consumes from ElevenLabs. */
export const OPENAI_PCM_SAMPLE_RATE = 24000;

/**
 * Streams OpenAI speech as PCM instead of waiting for a whole MP3.
 *
 * Measured on the Preview before this existed: the model's first token came
 * back at ~690ms and the reply text was complete at ~1130ms, but no audio
 * could start until ~3040ms — nearly two seconds spent rendering and
 * buffering a complete MP3 that nobody could hear any of. The incremental
 * path already existed and was ElevenLabs-only, so a deployment without an
 * ElevenLabs key silently took the slow road.
 *
 * Same endpoint, same model, same voice, same cost. Only the container and
 * the waiting change.
 */
export async function streamOpenAiPcm(
  text: string,
  options: { signal?: AbortSignal; env?: { [key: string]: string | undefined } } = {},
): Promise<{ sampleRate: number; channels: 1; contentType: 'audio/pcm'; provider: 'openai'; body: ReadableStream<Uint8Array> }> {
  const env = options.env ?? process.env;
  const config = selectSpeechProvider(env);
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey || config.provider !== 'openai') throw new Error('openai_unconfigured');
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.modelId || 'gpt-4o-mini-tts',
      voice: config.voiceId || 'alloy',
      input: text,
      response_format: 'pcm',
    }),
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`openai_${response.status}`);
  if (!response.body) throw new Error('openai_no_stream');
  return {
    sampleRate: OPENAI_PCM_SAMPLE_RATE,
    channels: 1,
    contentType: 'audio/pcm',
    provider: 'openai',
    body: response.body,
  };
}

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
      // `response_format` is the documented parameter; `format` was ignored,
      // which happened to default to mp3 and hid the mistake.
      response_format: 'mp3',
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

/**
 * Forwards a PCM stream to the client as it arrives, in chunks large enough to
 * be worth a message and small enough to start on. Shared by both providers so
 * they cannot drift: the first version of the OpenAI path would otherwise have
 * been a second copy of this loop, and a second copy is a second set of
 * off-by-one bugs.
 */
async function forwardPcmStream(
  body: ReadableStream<Uint8Array>,
  cacheKey: string,
  provider: 'elevenlabs' | 'openai',
  onEvent?: (event: SpeechStreamEvent) => void,
): Promise<Buffer> {
  const parts: Buffer[] = [];
  let pending = Buffer.alloc(0);
  const reader = body.getReader();
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
        onEvent?.({ type: 'audio-chunk', data: slice.toString('base64') });
      }
    }
    if (pending.byteLength) {
      parts.push(pending);
      onEvent?.({ type: 'audio-chunk', data: pending.toString('base64') });
    }
  } catch (err) {
    onEvent?.({ type: 'audio-abort', reason: 'stream_read_failed' });
    throw err;
  }
  const bytes = parts.length === 1 ? parts[0] : Buffer.concat(parts);
  if (bytes.length < 32) {
    onEvent?.({ type: 'audio-abort', reason: 'empty_audio' });
    throw new Error(`${provider}_empty`);
  }
  writeSpeechCache(cacheKey, { bytes, contentType: 'audio/pcm', provider, createdAt: Date.now() });
  onEvent?.({ type: 'audio-end', cacheKey, cached: false });
  return bytes;
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
  /* OpenAI streams too. This used to return here for anything that was not
     ElevenLabs, which meant a deployment without an ElevenLabs key silently
     took the buffered road: measured on the Preview, audio could not start
     until ~3040ms against reply text complete at ~1130ms. Same endpoint, same
     model, same voice, same cost — only the container changes. A failure here
     falls through to the buffered path rather than losing the turn. */
  if (config.provider === 'openai') {
    try {
      const stream = await streamOpenAiPcm(spoken, options);
      const cacheKey = pcmCacheKey(spoken, config);
      options.onEvent?.({
        type: 'audio-start',
        format: 'pcm_s16le',
        sampleRate: stream.sampleRate,
        channels: 1,
        cacheKey,
        cached: false,
        playback: 'incremental',
      });
      const collected = await forwardPcmStream(stream.body, cacheKey, 'openai', options.onEvent);
      return {
        provider: 'openai',
        cacheKey,
        bytes: collected,
        contentType: 'audio/pcm',
        cached: false,
        playback: 'incremental',
      };
    } catch (err) {
      console.warn('openai pcm stream failed, falling back to buffered', err instanceof Error ? err.message : err);
    }
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
  const bytes = await forwardPcmStream(stream.body, cacheKey, 'elevenlabs', options.onEvent);
  return {
    provider: 'elevenlabs',
    cacheKey,
    bytes,
    contentType: 'audio/pcm',
    cached: false,
    playback: 'incremental',
  };
}
