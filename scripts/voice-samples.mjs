/**
 * Three ElevenLabs voices, one line of text, so the choice is about the voice.
 *
 * Same words, same model, same settings for all three — otherwise the
 * comparison is between four variables and the winner is whichever sample
 * happened to get the best sentence. The text is a real reply Rook would give
 * during play, not a neutral phrase, because what matters is how it sounds
 * over a game at the moment someone needs it.
 *
 * Nothing about billing or the default voice changes here. This writes three
 * files and prints the mapping; the default only moves when a person picks one.
 *
 * Requires ELEVENLABS_API_KEY (a real `sk_…` secret, not a dashboard Key ID).
 * Refuses to run without it rather than quietly producing something else, so
 * a missing key can never be mistaken for a voice nobody liked.
 *
 * Usage: ELEVENLABS_API_KEY=sk_… node scripts/voice-samples.mjs [outDir]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { elevenLabsKeyKind, DEFAULT_ELEVENLABS_MODEL_ID, DEFAULT_ELEVENLABS_VOICE_SETTINGS } from '../lib/companion/providers.ts';

const OUT = process.argv[2] || '.voice-samples';

/** The line every sample speaks. Short, in-game, and it has to carry a limit
 *  as well as an instruction — that is the hardest thing for a voice to do
 *  without sounding either bored or apologetic. */
const SAMPLE_TEXT =
  'Click an enemy to shoot, and click yourself to reload when the ammo runs out. I cannot see your screen, so tell me what is happening.';

/** Candidates from ElevenLabs' shared library. Ids are stable; display names
 *  are what the library shows and are not independently verified. */
const CANDIDATES = [
  { key: 'a', voiceId: 'EXAVITQu4vr4xnSDxMaL', label: 'library voice A (current default)' },
  { key: 'b', voiceId: 'onwK4e9ZLuTAKqWW03F9', label: 'library voice B' },
  { key: 'c', voiceId: 'XrExE9yKIg1WjnnlVkGX', label: 'library voice C' },
];

const kind = elevenLabsKeyKind(process.env);
if (kind !== 'secret') {
  console.error(
    kind === 'missing'
      ? 'ELEVENLABS_API_KEY is not set. No samples were produced — an absent key must not be mistaken for a voice nobody liked.'
      : 'ELEVENLABS_API_KEY looks like a dashboard Key ID, not a secret. ElevenLabs rejects those with HTTP 400 invalid_api_key. The secret starts with sk_ and is shown once, at key creation.',
  );
  process.exit(2);
}

await mkdir(OUT, { recursive: true });
const results = [];
for (const candidate of CANDIDATES) {
  const started = Date.now();
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${candidate.voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: SAMPLE_TEXT,
      model_id: DEFAULT_ELEVENLABS_MODEL_ID,
      voice_settings: DEFAULT_ELEVENLABS_VOICE_SETTINGS,
    }),
  });
  if (!res.ok) {
    // Surface the upstream reason without echoing anything sent.
    let detail = '';
    try { detail = JSON.stringify((await res.json())?.detail ?? {}).slice(0, 200); } catch { /* not json */ }
    console.error(`voice ${candidate.key}: HTTP ${res.status} ${detail}`);
    results.push({ ...candidate, ok: false, status: res.status });
    continue;
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const file = `${OUT}/rook-voice-${candidate.key}.mp3`;
  await writeFile(file, bytes);
  results.push({ ...candidate, ok: true, file, bytes: bytes.length, ms: Date.now() - started });
  console.log(`voice ${candidate.key}  ${candidate.label.padEnd(34)} ${String(bytes.length).padStart(7)} bytes  ${Date.now() - started}ms  ${file}`);
}
await writeFile(`${OUT}/samples.json`, JSON.stringify({ text: SAMPLE_TEXT, model: DEFAULT_ELEVENLABS_MODEL_ID, results }, null, 2));
console.log(`\nSame text, same model, same settings for all three. Pick one and the default moves; nothing changes until then.`);
