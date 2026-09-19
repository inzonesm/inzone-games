#!/usr/bin/env node
/**
 * Probes provider configuration for the current process env.
 * Does not synthesize unless --speak is passed and a key is present.
 * NEXT_PUBLIC_APP_URL overrides the optional HTTP probe target.
 */
import { selectSpeechProvider } from '../lib/companion/providers.ts';

const config = selectSpeechProvider();
const target = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const result: Record<string, unknown> = {
  provider: config.provider,
  voiceId: config.provider === 'browser' ? null : config.voiceId,
  modelId: config.modelId,
  language: config.language,
  elevenLabsKeyPresent: Boolean(process.env.ELEVENLABS_API_KEY?.trim()),
  openaiKeyPresent: Boolean(process.env.OPENAI_API_KEY?.trim()),
  voiceProviderOverride: process.env.NEXT_PUBLIC_VOICE_PROVIDER || null,
  probeUrl: `${target}/api/companion`,
};

if (process.argv.includes('--http')) {
  const res = await fetch(String(result.probeUrl));
  result.http = { status: res.status, body: await res.json() };
}

console.log(JSON.stringify(result, null, 2));
if (config.provider === 'browser' && !process.env.ELEVENLABS_API_KEY?.trim()) {
  console.error('ELEVENLABS_API_KEY is absent. Browser fallback will speak if the client has speechSynthesis.');
}
