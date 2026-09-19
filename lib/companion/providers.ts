/**
 * Provider selection for speech generation only.
 *
 * Little Chapters @ 9b19d6a2c51ab10e608805e1c26d65e5f85e1ffb:
 * `NEXT_PUBLIC_VOICE_PROVIDER=web-speech` forces the browser. Unset or
 * `elevenlabs` attempts ElevenLabs when `ELEVENLABS_API_KEY` is present.
 * `ELEVENLABS_VOICE_ID` is optional. `NEXT_PUBLIC_VOICE_PROVIDER=elevenlabs`
 * is not required. OpenAI TTS remains an InZone fallback when ElevenLabs
 * is unset. Azure pronunciation assessment is not used.
 */

export type SpeechProvider = 'elevenlabs' | 'openai' | 'browser';

export type ElevenLabsVoiceSettings = {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
};

export type SpeechProviderConfig = {
  provider: SpeechProvider;
  voiceId: string | null;
  modelId: string | null;
  language: string;
  voiceSettings: ElevenLabsVoiceSettings | null;
};

/** Source-labeled “Rachel”. Display-name mapping was not independently verified. */
export const DEFAULT_ELEVENLABS_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';
export const DEFAULT_ELEVENLABS_MODEL_ID = 'eleven_turbo_v2';
export const DEFAULT_ELEVENLABS_VOICE_SETTINGS: ElevenLabsVoiceSettings = {
  stability: 0.55,
  similarity_boost: 0.75,
  style: 0.25,
  use_speaker_boost: true,
};
export const DEFAULT_SPEECH_LANGUAGE = 'en-US';
export const BROWSER_SPEECH_RATE = 0.95;
export const BROWSER_SPEECH_PITCH = 1.05;

export type SpeechEnv = { [key: string]: string | undefined };

export function voiceProviderOverride(
  env: SpeechEnv = process.env,
): 'web-speech' | 'elevenlabs' | null {
  const raw = (env.NEXT_PUBLIC_VOICE_PROVIDER || '').trim().toLowerCase();
  if (raw === 'web-speech') return 'web-speech';
  if (raw === 'elevenlabs') return 'elevenlabs';
  return null;
}

export function elevenLabsSettingsFingerprint(
  settings: ElevenLabsVoiceSettings = DEFAULT_ELEVENLABS_VOICE_SETTINGS,
): string {
  return `stb:${settings.stability}|sim:${settings.similarity_boost}|sty:${settings.style}|spk:${settings.use_speaker_boost}`;
}

export function selectSpeechProvider(
  env: SpeechEnv = process.env,
): SpeechProviderConfig {
  if (voiceProviderOverride(env) === 'web-speech') {
    return {
      provider: 'browser',
      voiceId: null,
      modelId: null,
      language: DEFAULT_SPEECH_LANGUAGE,
      voiceSettings: null,
    };
  }

  const elevenKey = env.ELEVENLABS_API_KEY?.trim();
  if (elevenKey) {
    return {
      provider: 'elevenlabs',
      voiceId: env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_ELEVENLABS_VOICE_ID,
      modelId: env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_ELEVENLABS_MODEL_ID,
      language: DEFAULT_SPEECH_LANGUAGE,
      voiceSettings: DEFAULT_ELEVENLABS_VOICE_SETTINGS,
    };
  }

  const openaiKey = env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    return {
      provider: 'openai',
      voiceId: env.OPENAI_TTS_VOICE?.trim() || 'alloy',
      modelId: env.OPENAI_TTS_MODEL?.trim() || 'gpt-4o-mini-tts',
      language: DEFAULT_SPEECH_LANGUAGE,
      voiceSettings: null,
    };
  }

  return {
    provider: 'browser',
    voiceId: null,
    modelId: null,
    language: DEFAULT_SPEECH_LANGUAGE,
    voiceSettings: null,
  };
}

export function speechProviderConfigured(
  env: SpeechEnv = process.env,
): boolean {
  return selectSpeechProvider(env).provider !== 'browser';
}
