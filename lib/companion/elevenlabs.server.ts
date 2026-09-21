/**
 * Server-only ElevenLabs text-to-speech.
 *
 * Reuses Little Chapters synthesis (`lib/elevenlabs.server.ts` @ 9b19d6a)
 * without child/tutor framing. Credentials stay on the server. The selected
 * companion voice is explicit: `ELEVENLABS_VOICE_ID` or the source default
 * `EXAVITQu4vr4xnSDxMaL`. Do not reuse any Flutter-exposed client key.
 *
 * Current docs: POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream
 * ?output_format=mp3_44100_128&optimize_streaming_latency=3 with `xi-api-key`.
 * Failures throw CompanionSpeechError with a sanitized status/code/requestId —
 * never the key, never spoken text.
 */

import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_VOICE_SETTINGS,
  elevenLabsKeyKind,
  selectSpeechProvider,
} from './providers.ts';
import {
  CompanionSpeechError,
  ELEVENLABS_TTS_ENDPOINT,
  fallbackSpeechError,
  sanitizeElevenLabsError,
  type SanitizedSpeechAccount,
  type SanitizedSpeechError,
} from './speech-error.ts';

export type ElevenLabsSpeech = {
  bytes: Buffer;
  contentType: string;
  provider: 'elevenlabs';
};

const TTS_ORIGIN = 'https://api.elevenlabs.io';
const PROBE_MS = 2500;

export function elevenLabsConfigured(env: { [key: string]: string | undefined } = process.env): boolean {
  return selectSpeechProvider(env).provider === 'elevenlabs';
}

function elevenLabsKey(env: { [key: string]: string | undefined }): string | null {
  const key = env.ELEVENLABS_API_KEY?.trim();
  return key || null;
}

function requestIdHeader(response: Response): string | null {
  return response.headers.get('request-id') || response.headers.get('x-request-id');
}

async function readJsonBody(response: Response): Promise<unknown> {
  const ctype = response.headers.get('content-type') || '';
  if (!ctype.includes('json')) {
    try {
      return JSON.parse(await response.text());
    } catch {
      return null;
    }
  }
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function synthesizeElevenLabs(
  text: string,
  options: { signal?: AbortSignal; env?: { [key: string]: string | undefined } } = {},
): Promise<ElevenLabsSpeech> {
  const env = options.env ?? process.env;
  const config = selectSpeechProvider(env);
  if (config.provider !== 'elevenlabs' || !config.voiceId) {
    throw new CompanionSpeechError(
      fallbackSpeechError('elevenlabs', {
        code: 'elevenlabs_unconfigured',
        message: 'elevenlabs_unconfigured',
        ttsProviderCharge: 'none',
      }),
    );
  }
  const apiKey = elevenLabsKey(env);
  if (!apiKey) {
    throw new CompanionSpeechError(
      fallbackSpeechError('elevenlabs', {
        code: 'elevenlabs_unconfigured',
        message: 'elevenlabs_unconfigured',
        ttsProviderCharge: 'none',
      }),
    );
  }
  if (elevenLabsKeyKind(env) !== 'secret') {
    throw new CompanionSpeechError(
      fallbackSpeechError('elevenlabs', {
        code: 'invalid_api_key',
        message:
          'ELEVENLABS_API_KEY is a Key ID. Replace it with the secret shown at creation (starts with sk_), not the dashboard Key ID.',
        modelId: config.modelId || DEFAULT_ELEVENLABS_MODEL_ID,
        voiceId: config.voiceId,
        ttsProviderCharge: 'none',
        ownerSetting: 'ELEVENLABS_API_KEY — secret starting with sk_, not the dashboard Key ID',
      }),
    );
  }

  const modelId = config.modelId || DEFAULT_ELEVENLABS_MODEL_ID;
  const url = new URL(`${TTS_ORIGIN}/v1/text-to-speech/${encodeURIComponent(config.voiceId)}/stream`);
  url.searchParams.set('output_format', 'mp3_44100_128');
  url.searchParams.set('optimize_streaming_latency', '3');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: config.voiceSettings || DEFAULT_ELEVENLABS_VOICE_SETTINGS,
      }),
      signal: options.signal,
    });
  } catch (err) {
    if (options.signal?.aborted) throw err;
    throw new CompanionSpeechError(
      fallbackSpeechError('elevenlabs', {
        code: 'elevenlabs_network',
        message: 'upstream_unreachable',
        modelId,
        voiceId: config.voiceId,
        ttsProviderCharge: 'none',
      }),
    );
  }

  if (!response.ok) {
    const body = await readJsonBody(response);
    throw new CompanionSpeechError(
      sanitizeElevenLabsError({
        httpStatus: response.status,
        body,
        requestIdHeader: requestIdHeader(response),
        modelId,
        voiceId: config.voiceId,
        endpoint: ELEVENLABS_TTS_ENDPOINT,
        ttsProviderCharge: 'unknown',
      }),
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 32) {
    throw new CompanionSpeechError(
      fallbackSpeechError('elevenlabs', {
        httpStatus: response.status,
        code: 'elevenlabs_empty',
        message: 'empty_audio',
        requestId: requestIdHeader(response),
        modelId,
        voiceId: config.voiceId,
        ttsProviderCharge: 'unknown',
      }),
    );
  }
  return { bytes, contentType: 'audio/mpeg', provider: 'elevenlabs' };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function probeGet(
  path: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ status: number | null; body: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_MS);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const response = await fetch(`${TTS_ORIGIN}${path}`, {
      method: 'GET',
      headers: {
        'xi-api-key': apiKey,
        Accept: 'application/json',
      },
      signal: ctrl.signal,
    });
    return { status: response.status, body: await readJsonBody(response) };
  } catch {
    return { status: null, body: null };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Account/voice/model snapshot after a TTS failure. Never sends conversation
 * text. Numbers and booleans only.
 */
export async function probeElevenLabsAccount(
  options: {
    env?: { [key: string]: string | undefined };
    voiceId?: string | null;
    modelId?: string | null;
    signal?: AbortSignal;
  } = {},
): Promise<SanitizedSpeechAccount | null> {
  const env = options.env ?? process.env;
  const apiKey = elevenLabsKey(env);
  if (!apiKey) return null;
  const config = selectSpeechProvider(env);
  const voiceId = options.voiceId || config.voiceId;
  const modelId = options.modelId || config.modelId || DEFAULT_ELEVENLABS_MODEL_ID;

  const [user, voice, models] = await Promise.all([
    probeGet('/v1/user', apiKey, options.signal),
    voiceId ? probeGet(`/v1/voices/${encodeURIComponent(voiceId)}`, apiKey, options.signal) : Promise.resolve({ status: null, body: null }),
    probeGet('/v1/models', apiKey, options.signal),
  ]);

  const subscription = asRecord(asRecord(user.body).subscription);
  const characterCount = Number(subscription.character_count);
  const characterLimit = Number(subscription.character_limit);
  const countOk = Number.isFinite(characterCount);
  const limitOk = Number.isFinite(characterLimit);

  let modelAvailable: boolean | null = null;
  let canDoTextToSpeech: boolean | null = null;
  if (Array.isArray(models.body)) {
    const found = models.body.find((row) => asRecord(row).model_id === modelId);
    if (found) {
      const rec = asRecord(found);
      modelAvailable = true;
      canDoTextToSpeech = rec.can_do_text_to_speech === true;
    } else {
      modelAvailable = false;
      canDoTextToSpeech = false;
    }
  }

  let voiceAvailable: boolean | null = null;
  if (voice.status === 200) voiceAvailable = true;
  else if (voice.status === 404 || voice.status === 403) voiceAvailable = false;

  return {
    charactersRemaining: countOk && limitOk ? Math.max(0, characterLimit - characterCount) : null,
    characterLimit: limitOk ? characterLimit : null,
    characterCount: countOk ? characterCount : null,
    voiceAvailable,
    modelAvailable,
    canDoTextToSpeech,
  };
}

export function ownerSettingFromAccount(
  err: SanitizedSpeechError,
  account: SanitizedSpeechAccount | null,
): string | null {
  if (err.ownerSetting) return err.ownerSetting;
  if (!account) return null;
  if (account.charactersRemaining === 0) {
    return 'ElevenLabs workspace credits (owner billing — do not purchase from this agent)';
  }
  if (account.voiceAvailable === false) return 'ELEVENLABS_VOICE_ID';
  if (account.modelAvailable === false || account.canDoTextToSpeech === false) {
    return 'ELEVENLABS_MODEL_ID';
  }
  return null;
}
