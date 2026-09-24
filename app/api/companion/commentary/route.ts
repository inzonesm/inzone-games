/**
 * TTS-only endpoint for Rook's Nightclub commentator.
 *
 * Every line the client can request is enumerated in
 * `ALLOWED_COMMENTARY_LINES` (lib/companion/commentator.ts). A request for
 * anything else is refused at 400 so the endpoint stays a fixed enum, not
 * an open TTS surface. That is what makes "keep Rook's established voice"
 * safe to serve at ~40 unique lines forever: the server-side speech cache
 * in `speakPrompt` returns cached bytes on every subsequent call for the
 * same line, so paid TTS is spent at most once per line per configured
 * ElevenLabs voice + settings fingerprint.
 *
 * No LLM call, no chat context, no history, no `intent: 'ask'` — the text
 * to speak IS the request payload. The route intentionally does not touch
 * `converseCompanion`.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { verifyCompanionActor } from '@/lib/companion/identity';
import { speakPrompt } from '@/lib/companion/speak-prompt';
import { ALLOWED_COMMENTARY_LINES } from '@/lib/companion/commentator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = new Set<string>(ALLOWED_COMMENTARY_LINES);
const MAX_BYTES = 4 * 1024; // JSON body cap — this endpoint takes one short line

export async function POST(req: NextRequest) {
  const actor = await verifyCompanionActor(req.headers.get('authorization'));
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BYTES) {
      return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const line =
    body && typeof body === 'object' && 'line' in body && typeof (body as { line: unknown }).line === 'string'
      ? (body as { line: string }).line.trim()
      : '';
  if (!line || !ALLOWED.has(line)) {
    return NextResponse.json({ error: 'unknown_line' }, { status: 400 });
  }

  try {
    const result = await speakPrompt(line, { allowPaidSpeech: true });
    if (result.provider === 'browser') {
      // No paid TTS is configured. Fall back to the client's own SpeechSynthesis
      // rather than pretend we produced Rook's voice.
      return new NextResponse(null, { status: 204 });
    }
    const bytes = Uint8Array.from(result.bytes);
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        'Content-Type': result.contentType,
        'Cache-Control': 'private, max-age=86400',
        'X-Cache-Key': result.cacheKey,
        'X-Cached': result.cached ? '1' : '0',
      },
    });
  } catch {
    // Do not leak provider errors — the client's fallback is silence for
    // this trigger, not an error message read aloud.
    return NextResponse.json({ error: 'speech_failed' }, { status: 502 });
  }
}
