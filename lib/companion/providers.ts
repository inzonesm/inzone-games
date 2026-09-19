/**
 * Provider selection for speech generation only.
 *
 * Little Chapters used the same order: ElevenLabs when a server key exists,
 * otherwise OpenAI TTS, otherwise the browser's speechSynthesis. No extra
 * paid service is introduced here. Azure pronunciation assessment is not used.
 */

export type SpeechProvider = 'elevenlabs' | 'openai' | 'browser';

export type SpeechProviderConfig = {
  provider: SpeechProvider;
  voiceId: string | null;
  modelId: string | null;
};

export function selectSpeechProvider(
  env: NodeJS.ProcessEnv = process.env,
): SpeechProviderConfig {
  const elevenKey = env.ELEVENLABS_API_KEY?.trim();
  const elevenVoice = env.ELEVENLABS_VOICE_ID?.trim();
  if (elevenKey && elevenVoice) {
    return {
      provider: 'elevenlabs',
      voiceId: elevenVoice,
      modelId: env.ELEVENLABS_MODEL_ID?.trim() || 'eleven_multilingual_v2',
    };
  }
  const openaiKey = env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    return {
      provider: 'openai',
      voiceId: env.OPENAI_TTS_VOICE?.trim() || 'alloy',
      modelId: env.OPENAI_TTS_MODEL?.trim() || 'gpt-4o-mini-tts',
    };
  }
  return { provider: 'browser', voiceId: null, modelId: null };
}

export function speechProviderConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return selectSpeechProvider(env).provider !== 'browser';
}
