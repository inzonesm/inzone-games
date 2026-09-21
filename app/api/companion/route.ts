import { NextResponse, type NextRequest } from 'next/server';
import { COMPANION_LIMITS, companionName, companionReserveAmounts } from '@/lib/companion/config';
import { converseCompanion } from '@/lib/companion/converse';
import { companionPublicHealth } from '@/lib/companion/health';
import { verifyCompanionActor } from '@/lib/companion/identity';
import { sanitizeNightclubContext } from '@/lib/companion/nightclub-context';
import {
  REQUIRED_QUOTA_SETTING,
  commitCompanionUsage,
  finishFreeCompanionTurn,
  releaseCompanionUsage,
  reserveCompanionUsage,
  reserveFreeCompanionTurn,
} from '@/lib/companion/quota';
import { type CompanionIntent } from '@/lib/companion/reply';
import { speakPrompt } from '@/lib/companion/speak-prompt';
import {
  asCompanionSpeechError,
  fallbackSpeechError,
  logSanitizedSpeechError,
  ttsChargeForOutcome,
  type SanitizedSpeechError,
} from '@/lib/companion/speech-error';
import {
  ownerSettingFromAccount,
  probeElevenLabsAccount,
} from '@/lib/companion/elevenlabs.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(code: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: code, ...extra }, { status });
}

function parseIntent(value: unknown): CompanionIntent {
  return value === 'intro' ? 'intro' : 'ask';
}

function ndjsonStream(write: (push: (row: Record<string, unknown>) => void) => Promise<void>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const push = (row: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(row)}\n`));
      };
      try {
        await write(push);
      } finally {
        controller.close();
      }
    },
  });
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
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
  const health = companionPublicHealth();
  const wantPaid = health.paidChatConfigured || health.paidSpeechConfigured;
  const started = Date.now();

  const converseInput = {
    uid: actor.uid,
    gameId,
    intent,
    transcript,
    nightclub,
    history: body.history,
    previousRunId: typeof body.previousRunId === 'string' ? body.previousRunId : null,
  };

  const respond = async (
    reply: Awaited<ReturnType<typeof converseCompanion>>,
    extra: Record<string, unknown>,
    speak: () => Promise<{
      speech: Awaited<ReturnType<typeof speakPrompt>>;
      extra?: Record<string, unknown>;
    }>,
  ) => {
    if ('error' in reply) return jsonError(reply.error, 400);
    const textAt = Date.now() - started;
    return ndjsonStream(async (push) => {
      push({
        type: 'text',
        text: reply.text,
        modelFirstOutputMs: reply.modelFirstOutputMs,
        playActive: reply.playActive,
        textAvailableMs: textAt,
      });
      const spoken = await speak();
      const speech = spoken.speech;
      extra = { ...extra, ...spoken.extra };
      const audioAt = Date.now() - started;
      push({
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
        fallbackReason: reply.fallbackReason,
        chatCharsUsed: reply.chatCharsUsed,
        ttsCharsUsed: speech.provider === 'browser' ? 0 : reply.text.length,
        modelFirstOutputMs: reply.modelFirstOutputMs,
        playActive: reply.playActive,
        textAvailableMs: textAt,
        audioAvailableMs: audioAt,
        ttsProviderCharge: extra.ttsProviderCharge ?? ttsChargeForOutcome({
          failed: extra.speechFallback === 'paid_tts_failed',
          provider: speech.provider,
          cached: speech.provider !== 'browser' ? speech.cached : false,
        }),
        ...extra,
      });
      if (speech.provider !== 'browser' && speech.cacheKey) {
        push({
          type: 'audio',
          cacheKey: speech.cacheKey,
          contentType: speech.contentType,
          cached: speech.cached,
        });
      } else {
        push({ type: 'audio', provider: 'browser', cached: false });
      }
      push({ type: 'done', latencyMs: Date.now() - started, textAvailableMs: textAt, audioAvailableMs: audioAt });
    });
  };

  if (wantPaid && health.paidQuotaReady) {
    const reservation = await reserveCompanionUsage(actor.uid, companionReserveAmounts());
    if (reservation.ok) {
      try {
        const reply = await converseCompanion({
          ...converseInput,
          allowPaidChat: health.paidChatConfigured,
        });
        if ('error' in reply) {
          await releaseCompanionUsage(reservation);
          return jsonError(reply.error, 400);
        }
        return respond(reply, {
          quotaBackend: reservation.backend,
          paidQuotaReady: true,
          quotaUnavailable: false,
          requiredSetting: null,
          reservationId: reservation.reservationId,
          quotaReserved: true,
          reservedChatChars: reservation.reservedChatChars,
          reservedTtsChars: reservation.reservedTtsChars,
        }, async () => {
          let speech;
          let speechFallback: string | null = null;
          let speechError: SanitizedSpeechError | null = null;
          try {
            speech = await speakPrompt(reply.text, { allowPaidSpeech: health.paidSpeechConfigured });
          } catch (err) {
            speech = await speakPrompt(reply.text, { allowPaidSpeech: false });
            speechFallback = 'paid_tts_failed';
            speechError = asCompanionSpeechError(err) ?? fallbackSpeechError('elevenlabs');
            if (speechError.ttsProviderCharge !== 'none') {
              try {
                const account = await probeElevenLabsAccount({
                  voiceId: speechError.voiceId,
                  modelId: speechError.modelId,
                });
                speechError = {
                  ...speechError,
                  account,
                  ownerSetting: ownerSettingFromAccount(speechError, account),
                };
              } catch {
                /* probe is diagnostic only */
              }
            }
            logSanitizedSpeechError(speechError);
          }
          const ttsCharsUsed = speech.provider === 'browser' ? 0 : reply.text.length;
          const ttsProviderCharge =
            speechError?.ttsProviderCharge ??
            ttsChargeForOutcome({
              failed: speechFallback === 'paid_tts_failed',
              provider: speech.provider,
              cached: speech.provider !== 'browser' ? speech.cached : false,
            });
          await commitCompanionUsage(reservation, {
            chatChars: reply.chatCharsUsed,
            ttsChars: ttsCharsUsed,
          });
          return {
            speech,
            extra: { speechFallback, speechError, ttsProviderCharge },
          };
        });
      } catch {
        try {
          await releaseCompanionUsage(reservation);
        } catch {
          /* reserve already held; lease expiry reclaims it */
        }
        return jsonError('speech_failed', 502, {
          stage: 'turn',
          quotaBackend: reservation.backend,
          reservationId: reservation.reservationId,
        });
      }
    }
    if (reservation.error !== 'quota_unavailable') {
      return jsonError(reservation.error, 429);
    }
  }

  const free = reserveFreeCompanionTurn(actor.uid);
  if (!free.ok) return jsonError(free.error, 429);
  try {
    const reply = await converseCompanion({
      ...converseInput,
      allowPaidChat: false,
      paidBlockReason: wantPaid ? 'quota_unavailable' : null,
    });
    if ('error' in reply) {
      finishFreeCompanionTurn(actor.uid);
      return jsonError(reply.error, 400);
    }
    return respond(reply, {
      quotaBackend: health.quotaBackend,
      paidQuotaReady: health.paidQuotaReady,
      quotaUnavailable: Boolean(wantPaid && !health.paidQuotaReady),
      requiredSetting: wantPaid && !health.paidQuotaReady ? REQUIRED_QUOTA_SETTING : null,
      ttsProviderCharge: 'none',
    }, async () => {
      const speech = await speakPrompt(reply.text, { allowPaidSpeech: false });
      finishFreeCompanionTurn(actor.uid);
      return { speech, extra: { ttsProviderCharge: 'none' } };
    });
  } catch {
    finishFreeCompanionTurn(actor.uid);
    return jsonError('speech_failed', 502);
  }
}

export async function GET() {
  return NextResponse.json(companionPublicHealth());
}
