/**
 * Sanitized speech-provider errors for companion TTS.
 *
 * Never include credentials, Authorization / xi-api-key headers, or user
 * conversation content. Allowlisted codes and a truncated redacted message
 * are the only text that may leave this module.
 */

export type TtsProviderCharge = 'none' | 'unknown' | 'billed';

export type SanitizedSpeechAccount = {
  charactersRemaining: number | null;
  characterLimit: number | null;
  characterCount: number | null;
  voiceAvailable: boolean | null;
  modelAvailable: boolean | null;
  canDoTextToSpeech: boolean | null;
};

export type SanitizedSpeechError = {
  provider: 'elevenlabs' | 'openai';
  httpStatus: number | null;
  code: string;
  message: string;
  requestId: string | null;
  endpoint: string;
  modelId: string | null;
  voiceId: string | null;
  param: string | null;
  ttsProviderCharge: TtsProviderCharge;
  ownerSetting: string | null;
  account: SanitizedSpeechAccount | null;
};

export const ELEVENLABS_TTS_ENDPOINT = '/v1/text-to-speech/{voice_id}';

const ALLOWED_CODES = new Set([
  'invalid_api_key',
  'unauthorized',
  'forbidden',
  'insufficient_credits',
  'quota_exceeded',
  'payment_required',
  'voice_access_denied',
  'model_access_denied',
  'voice_not_found',
  'model_not_found',
  'invalid_voice_settings',
  'voice_settings_invalid',
  'unsupported_model',
  'invalid_output_format',
  'invalid_request',
  'invalid_parameters',
  'validation_error',
  'bad_request',
  'rate_limited',
  'too_many_requests',
  'detected_unusual_activity',
  'missing_permissions',
  'permission_denied',
  'free_users_not_allowed',
  'max_character_limit_exceeded',
  'not_found',
  'elevenlabs_unconfigured',
  'elevenlabs_empty',
  'elevenlabs_network',
  'openai_unconfigured',
  'openai_empty',
  'openai_network',
  'upstream_error',
]);

const ALLOWED_PARAMS = new Set([
  'stability',
  'similarity_boost',
  'style',
  'use_speaker_boost',
  'speed',
  'model_id',
  'voice_id',
  'output_format',
  'text',
  'voice_settings',
]);

const SECRET_SHAPE =
  /sk-[A-Za-z0-9_-]{8,}|xi[-_]?api[^\s]*|Bearer\s+\S+|BEGIN [A-Z ]+PRIVATE|AIza[0-9A-Za-z_-]{10,}|eyJ[A-Za-z0-9_-]{10,}/gi;

export class CompanionSpeechError extends Error {
  readonly speechError: SanitizedSpeechError;

  constructor(speechError: SanitizedSpeechError) {
    super(speechError.code);
    this.name = 'CompanionSpeechError';
    this.speechError = speechError;
  }
}

export function asCompanionSpeechError(err: unknown): SanitizedSpeechError | null {
  if (err instanceof CompanionSpeechError) return err.speechError;
  return null;
}

export function fallbackSpeechError(
  provider: SanitizedSpeechError['provider'],
  extra: Partial<SanitizedSpeechError> = {},
): SanitizedSpeechError {
  return {
    provider,
    httpStatus: extra.httpStatus ?? null,
    code: extra.code && ALLOWED_CODES.has(extra.code) ? extra.code : 'upstream_error',
    message: extra.message ? sanitizeSpeechMessage(extra.message) : 'paid_tts_failed',
    requestId: extra.requestId ?? null,
    endpoint: extra.endpoint ?? (provider === 'elevenlabs' ? ELEVENLABS_TTS_ENDPOINT : '/v1/audio/speech'),
    modelId: extra.modelId ?? null,
    voiceId: extra.voiceId ?? null,
    param: extra.param ?? null,
    ttsProviderCharge: extra.ttsProviderCharge ?? 'unknown',
    ownerSetting: extra.ownerSetting ?? null,
    account: extra.account ?? null,
  };
}

export function ttsChargeForOutcome(input: {
  failed: boolean;
  provider: string;
  cached?: boolean;
}): TtsProviderCharge {
  if (input.failed) return 'unknown';
  if (input.provider === 'browser') return 'none';
  if (input.cached) return 'none';
  return 'billed';
}

export function ownerSettingForSpeechError(err: Pick<SanitizedSpeechError, 'code'>): string | null {
  switch (err.code) {
    case 'invalid_api_key':
    case 'unauthorized':
    case 'missing_permissions':
    case 'permission_denied':
      return 'ELEVENLABS_API_KEY';
    case 'insufficient_credits':
    case 'quota_exceeded':
    case 'payment_required':
    case 'free_users_not_allowed':
    case 'max_character_limit_exceeded':
      return 'ElevenLabs workspace credits (owner billing — do not purchase from this agent)';
    case 'voice_access_denied':
    case 'voice_not_found':
      return 'ELEVENLABS_VOICE_ID';
    case 'model_access_denied':
    case 'model_not_found':
    case 'unsupported_model':
      return 'ELEVENLABS_MODEL_ID';
    default:
      return null;
  }
}

export function sanitizeSpeechMessage(raw: string): string {
  const redacted = String(raw || '')
    .replace(SECRET_SHAPE, '[redacted]')
    .replace(/["'`][^"'`]{40,}["'`]/g, '"[redacted]"')
    .replace(/\s+/g, ' ')
    .trim();
  return redacted.slice(0, 160);
}

export function sanitizeSpeechCode(raw: unknown, httpStatus: number | null): string {
  const fromBody = typeof raw === 'string' ? raw.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
  if (fromBody && ALLOWED_CODES.has(fromBody)) return fromBody;
  if (httpStatus === 401) return 'unauthorized';
  if (httpStatus === 402) return 'payment_required';
  if (httpStatus === 403) return 'forbidden';
  if (httpStatus === 404) return 'not_found';
  if (httpStatus === 422) return 'invalid_request';
  if (httpStatus === 429) return 'rate_limited';
  if (httpStatus === 400) return 'bad_request';
  return 'upstream_error';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readElevenLabsDetail(body: unknown): {
  code: unknown;
  message: string;
  requestId: string | null;
  param: string | null;
} {
  const root = asRecord(body);
  const detail = root.detail;
  const rec = typeof detail === 'string' ? { message: detail } : asRecord(detail || root);
  const message =
    typeof rec.message === 'string'
      ? rec.message
      : typeof detail === 'string'
        ? detail
        : '';
  const code = rec.code ?? rec.status ?? rec.type ?? rec.error;
  const requestId = typeof rec.request_id === 'string' ? rec.request_id : null;
  const paramRaw = rec.param ?? rec.parameter;
  const param = typeof paramRaw === 'string' && ALLOWED_PARAMS.has(paramRaw) ? paramRaw : null;
  return { code, message, requestId, param };
}

export function sanitizeElevenLabsError(input: {
  httpStatus: number | null;
  body: unknown;
  requestIdHeader?: string | null;
  modelId?: string | null;
  voiceId?: string | null;
  endpoint?: string;
  ttsProviderCharge?: TtsProviderCharge;
}): SanitizedSpeechError {
  const detail = readElevenLabsDetail(input.body);
  const code = sanitizeSpeechCode(detail.code, input.httpStatus);
  const requestId =
    (typeof input.requestIdHeader === 'string' && input.requestIdHeader.trim()) ||
    detail.requestId ||
    null;
  const err: SanitizedSpeechError = {
    provider: 'elevenlabs',
    httpStatus: Number.isFinite(input.httpStatus) ? input.httpStatus : null,
    code,
    message: sanitizeSpeechMessage(detail.message || `elevenlabs_${input.httpStatus ?? 'error'}`),
    requestId: requestId ? String(requestId).slice(0, 64) : null,
    endpoint: input.endpoint || ELEVENLABS_TTS_ENDPOINT,
    modelId: input.modelId ?? null,
    voiceId: input.voiceId ?? null,
    param: detail.param,
    ttsProviderCharge: input.ttsProviderCharge ?? 'unknown',
    ownerSetting: null,
    account: null,
  };
  err.ownerSetting = ownerSettingForSpeechError(err);
  return err;
}

export function logSanitizedSpeechError(err: SanitizedSpeechError): void {
  console.error(
    JSON.stringify({
      scope: 'companion_tts',
      provider: err.provider,
      httpStatus: err.httpStatus,
      code: err.code,
      message: err.message,
      requestId: err.requestId,
      endpoint: err.endpoint,
      modelId: err.modelId,
      voiceId: err.voiceId,
      param: err.param,
      ttsProviderCharge: err.ttsProviderCharge,
      ownerSetting: err.ownerSetting,
      account: err.account,
    }),
  );
}
