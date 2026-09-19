import { companionName } from './config.ts';
import { selectChatProvider } from './converse.ts';
import { elevenLabsKeyKind, selectSpeechProvider } from './providers.ts';
import { REQUIRED_QUOTA_SETTING, paidQuotaReady, quotaBackend } from './quota.ts';

export function companionPublicHealth(
  env: { [key: string]: string | undefined } = process.env,
) {
  const speech = selectSpeechProvider(env);
  const chat = selectChatProvider(env);
  const ready = paidQuotaReady(env);
  const paidChatConfigured = chat.provider === 'openai';
  const paidSpeechConfigured = speech.provider !== 'browser';
  const speechKeyKind = elevenLabsKeyKind(env);
  return {
    companionName: companionName(),
    provider: speech.provider,
    speechProvider: speech.provider,
    modelProvider: chat.provider,
    modelId: chat.modelId,
    voiceId: speech.provider === 'browser' ? null : speech.voiceId,
    speechModelId: speech.modelId,
    voiceProviderOverride: env.NEXT_PUBLIC_VOICE_PROVIDER || null,
    quotaBackend: quotaBackend(env),
    paidQuotaReady: ready,
    paidChatConfigured,
    paidSpeechConfigured,
    speechKeyKind: speechKeyKind === 'missing' ? null : speechKeyKind,
    requiredSetting: ready ? null : REQUIRED_QUOTA_SETTING,
    quotaUnavailable: !ready && (paidChatConfigured || paidSpeechConfigured),
    ok: true,
  };
}
