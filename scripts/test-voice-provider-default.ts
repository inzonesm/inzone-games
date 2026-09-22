#!/usr/bin/env node
/**
 * Checks default provider selection against Little Chapters @ 9b19d6a.
 * ElevenLabs is selected from the API key alone; voice/model have source defaults.
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_VOICE_ID,
  selectSpeechProvider,
  voiceProviderOverride,
} from '../lib/companion/providers.ts';

assert.equal(selectSpeechProvider({}).provider, 'browser');
assert.equal(voiceProviderOverride({}), null);
assert.equal(voiceProviderOverride({ NEXT_PUBLIC_VOICE_PROVIDER: 'web-speech' }), 'web-speech');
assert.equal(voiceProviderOverride({ NEXT_PUBLIC_VOICE_PROVIDER: 'elevenlabs' }), 'elevenlabs');

const eleven = selectSpeechProvider({ ELEVENLABS_API_KEY: 'test-key' });
assert.equal(eleven.provider, 'elevenlabs');
assert.equal(eleven.voiceId, DEFAULT_ELEVENLABS_VOICE_ID);
assert.equal(eleven.modelId, DEFAULT_ELEVENLABS_MODEL_ID);

assert.equal(
  selectSpeechProvider({
    ELEVENLABS_API_KEY: 'test-key',
    NEXT_PUBLIC_VOICE_PROVIDER: 'web-speech',
  }).provider,
  'browser',
);

console.log(
  JSON.stringify(
    {
      ok: true,
      defaultVoiceId: DEFAULT_ELEVENLABS_VOICE_ID,
      defaultModelId: DEFAULT_ELEVENLABS_MODEL_ID,
      selectedWithoutKey: selectSpeechProvider({}).provider,
      selectedWithKey: eleven.provider,
    },
    null,
    2,
  ),
);
