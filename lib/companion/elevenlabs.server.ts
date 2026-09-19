/**
 * Server-only ElevenLabs text-to-speech.
 *
 * Ported from the Little Chapters speech stack (`lib/elevenlabs.server.ts`):
 * credentials stay on the server, one convert call, no client key.
 * Current docs: POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
 * with `xi-api-key`. Do not reuse any Flutter-exposed client key.
 */

import { selectSpeechProvider } from './providers.ts';

export type ElevenLabsSpeech = {
  bytes: Buffer;
  contentType: string;
  provider: 'elevenlabs';
};

export function elevenLabsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return selectSpeechProvider(env).provider === 'elevenlabs';
}

export async function synthesizeElevenLabs(
  text: string,
  options: { signal?: AbortSignal; env?: NodeJS.ProcessEnv } = {},
): Promise<ElevenLabsSpeech> {
  const env = options.env ?? process.env;
  const config = selectSpeechProvider(env);
  if (config.provider !== 'elevenlabs' || !config.voiceId) {
    throw new Error('elevenlabs_unconfigured');
  }
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) throw new Error('elevenlabs_unconfigured');

  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.voiceId)}`);
  url.searchParams.set('output_format', 'mp3_44100_128');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: config.modelId || 'eleven_multilingual_v2',
    }),
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(`elevenlabs_${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 32) throw new Error('elevenlabs_empty');
  return { bytes, contentType: 'audio/mpeg', provider: 'elevenlabs' };
}
