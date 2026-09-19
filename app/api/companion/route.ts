import { NextResponse, type NextRequest } from 'next/server';
import { COMPANION_LIMITS, companionName } from '@/lib/companion/config';
import { converseCompanion, selectChatProvider } from '@/lib/companion/converse';
import { verifyCompanionActor } from '@/lib/companion/identity';
import { sanitizeNightclubContext } from '@/lib/companion/nightclub-context';
import { selectSpeechProvider } from '@/lib/companion/providers';
import {
  commitCompanionUsage,
  releaseCompanionUsage,
  reserveCompanionUsage,
} from '@/lib/companion/quota';
import { type CompanionIntent } from '@/lib/companion/reply';
import { speakPrompt } from '@/lib/companion/speak-prompt';

export const runtime = 'nodejs';

function jsonError(code: string, status: number) {
  return NextResponse.json({ error: code }, { status });
}

function parseIntent(value: unknown): CompanionIntent {
  return value === 'intro' ? 'intro' : 'ask';
}

export async function POST(req: NextRequest) {
  const contentLength = Number(req.headers.get('content-length') || '0');
  if (Number.isFinite(contentLength) && contentLength > COMPANION_LIMITS.maxBodyBytes) {
    return jsonError('payload_too_large', 413);
  }

  const actor = await verifyCompanionActor(req.headers.get('authorization'));
  if (!actor) return jsonError('unauthorized', 401);

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > COMPANION_LIMITS.maxBodyBytes) return jsonError('payload_too_large', 413);
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return jsonError('invalid_json', 400);
  }

  const gameId = typeof body.gameId === 'string' ? body.gameId.trim().slice(0, 128) : '';
  const intent = parseIntent(body.intent);
  const transcript =
    typeof body.transcript === 'string'
      ? body.transcript.replace(/\s+/g, ' ').trim().slice(0, COMPANION_LIMITS.maxTranscriptChars)
      : '';
  const observedAt = typeof body.observedAt === 'number' ? body.observedAt : 0;
  const nightclub = sanitizeNightclubContext(body.gameContext, observedAt);

  const reservation = await reserveCompanionUsage(actor.uid, COMPANION_LIMITS.maxReplyChars);
  if (!reservation.ok) return jsonError(reservation.error, 429);

  const started = Date.now();
  try {
    const reply = await converseCompanion({
      uid: actor.uid,
      gameId,
      intent,
      transcript,
      nightclub,
      history: body.history,
    });
    if ('error' in reply) {
      await releaseCompanionUsage(reservation);
      return jsonError(reply.error, 400);
    }

    let speech;
    try {
      speech = await speakPrompt(reply.text);
    } catch {
      await commitCompanionUsage(reservation, 0);
      return jsonError('speech_failed', 502);
    }
    const billed = speech.provider === 'browser' ? 0 : reply.text.length;
    await commitCompanionUsage(reservation, billed);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const write = (row: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(row)}\n`));
        };
        write({
          type: 'meta',
          companionName: companionName(),
          knowledgeVersion: reply.knowledgeVersion,
          contextMode: reply.contextMode,
          speechProvider: speech.provider,
          provider: speech.provider,
          modelProvider: reply.modelProvider,
          modelId: reply.modelId,
          replySource: reply.replySource,
          usedUntrustedState: reply.usedUntrustedState,
          quotaBackend: reservation.backend,
        });
        write({ type: 'text', text: reply.text });
        if (speech.provider !== 'browser' && speech.cacheKey) {
          write({
            type: 'audio',
            cacheKey: speech.cacheKey,
            contentType: speech.contentType,
            cached: speech.cached,
          });
        } else {
          write({ type: 'audio', provider: 'browser', cached: false });
        }
        write({ type: 'done', latencyMs: Date.now() - started });
        controller.close();
      },
    });
    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    await releaseCompanionUsage(reservation);
    return jsonError('speech_failed', 502);
  }
}

export async function GET() {
  const speech = selectSpeechProvider();
  const chat = selectChatProvider();
  return NextResponse.json({
    companionName: companionName(),
    provider: speech.provider,
    speechProvider: speech.provider,
    modelProvider: chat.provider,
    modelId: chat.modelId,
    voiceId: speech.provider === 'browser' ? null : speech.voiceId,
    speechModelId: speech.modelId,
    voiceProviderOverride: process.env.NEXT_PUBLIC_VOICE_PROVIDER || null,
    ok: true,
  });
}
