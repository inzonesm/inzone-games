'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COMPANION_OUTPUT_GAIN, createCompanionAudioSession } from '@/lib/companion/audio-session';
import {
  browserSpeechRecognitionAvailable,
  startBrowserRecognition,
} from '@/lib/companion/browser-speech';
import { readClientSpeechCache, writeClientSpeechCache } from '@/lib/companion/client-speech-cache';
import { companionName } from '@/lib/companion/config';
import { isFlagshipId } from '@/lib/flagship-roster';
import { readNightclubHostState } from '@/lib/companion/read-nightclub-state';
import { CAMPAIGN_EVENTS, trackCampaignEvent } from '@/lib/campaign-analytics';
import { ensurePlaySessionUser } from '@/lib/play-session';

export type CompanionUiState = 'idle' | 'listening' | 'thinking' | 'speaking';

type Props = {
  gameId: string;
  gameName: string;
  iframeRef: { current: HTMLIFrameElement | null };
  active: boolean;
};

type TurnMeta = {
  provider: 'elevenlabs' | 'openai' | 'browser';
  cacheKey?: string;
  text: string;
};

type TranscriptSource = 'injected' | 'microphone' | 'unknown';

async function companionAuthHeader(): Promise<string | null> {
  const user = await ensurePlaySessionUser();
  const token = await user.getIdToken();
  return token ? `Bearer ${token}` : null;
}

async function readNdjsonStream(
  response: Response,
  onRow: (row: Record<string, unknown>) => void,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  if (!response.body) {
    const text = await response.text();
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed) as Record<string, unknown>;
        rows.push(row);
        onRow(row);
      } catch {
        /* ignore a torn line */
      }
    }
    return rows;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed) as Record<string, unknown>;
        rows.push(row);
        onRow(row);
      } catch {
        /* ignore a torn line */
      }
    }
  }
  const tail = buffer.trim();
  if (tail) {
    try {
      const row = JSON.parse(tail) as Record<string, unknown>;
      rows.push(row);
      onRow(row);
    } catch {
      /* ignore */
    }
  }
  return rows;
}

function returnGameFocus(iframeRef: { current: HTMLIFrameElement | null }) {
  const frame = iframeRef.current;
  if (!frame) return;
  try {
    frame.focus({ preventScroll: true });
    frame.contentWindow?.focus();
  } catch {
    /* cross-origin or torn down */
  }
}

export function GameCompanion({ gameId, gameName, iframeRef, active }: Props) {
  const enabled = active && isFlagshipId(gameId);
  const name = useMemo(() => companionName(), []);
  const [state, setState] = useState<CompanionUiState>('idle');
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const [muted, setMuted] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [caption, setCaption] = useState('');
  const [needsGesture, setNeedsGesture] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(COMPANION_OUTPUT_GAIN);
  const generationRef = useRef(0);
  const introForGame = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const recRef = useRef<{ stop: () => void; abort?: () => void } | null>(null);
  const sessionRef = useRef<ReturnType<typeof createCompanionAudioSession> | null>(null);
  const pendingIntro = useRef(false);
  const voiceEnabledRef = useRef(false);
  const mutedRef = useRef(false);
  const speakingRef = useRef(false);
  const previousRunId = useRef<string | null>(null);
  const [providerHint, setProviderHint] = useState<string>('unknown');
  const [modelHint, setModelHint] = useState<string>('unknown');
  const [replySource, setReplySource] = useState<string>('unknown');
  const [quotaHint, setQuotaHint] = useState<string>('unknown');
  const [fallbackReason, setFallbackReason] = useState<string>('');
  const [speechFallback, setSpeechFallback] = useState<string>('');
  const [speechErrorCode, setSpeechErrorCode] = useState<string>('');
  const [speechErrorHttp, setSpeechErrorHttp] = useState<string>('');
  const [ttsCharge, setTtsCharge] = useState<string>('');
  const [speechKeyKind, setSpeechKeyKind] = useState<string>('');
  const [speechLatencyMs, setSpeechLatencyMs] = useState<number | null>(null);
  const [speakingStateMs, setSpeakingStateMs] = useState<number | null>(null);
  const [playbackOnsetMs, setPlaybackOnsetMs] = useState<number | null>(null);
  const [audioCached, setAudioCached] = useState<boolean | null>(null);
  const [transcriptSource, setTranscriptSource] = useState<TranscriptSource>('unknown');
  const [modelFirstMs, setModelFirstMs] = useState<number | null>(null);
  const [textAvailableMs, setTextAvailableMs] = useState<number | null>(null);
  const [audioAvailableMs, setAudioAvailableMs] = useState<number | null>(null);
  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const turnStartedRef = useRef(0);

  const haltMicrophone = useCallback(() => {
    recRef.current?.abort?.();
    recRef.current?.stop();
    recRef.current = null;
  }, []);

  const clearVisual = useCallback(() => {
    setState('idle');
    setCaption('');
    setError(null);
    setNeedsGesture(false);
    setSpeechLatencyMs(null);
    setAudioCached(null);
  }, []);

  const bumpGeneration = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    haltMicrophone();
    sessionRef.current?.stop();
    speakingRef.current = false;
    clearVisual();
  }, [clearVisual, haltMicrophone]);

  useEffect(() => {
    const session = createCompanionAudioSession({
      currentGeneration: () => generationRef.current,
      onPlaying: (playing) => {
        speakingRef.current = playing;
        setState((prev) => {
          if (playing) {
            if (turnStartedRef.current) {
              setSpeakingStateMs(Date.now() - turnStartedRef.current);
            }
            return 'speaking';
          }
          return prev === 'speaking' ? (voiceEnabledRef.current && !mutedRef.current ? 'listening' : 'idle') : prev;
        });
      },
      onOnset: (at) => {
        if (turnStartedRef.current) setPlaybackOnsetMs(at - turnStartedRef.current);
      },
    });
    sessionRef.current = session;
    return () => {
      recRef.current?.abort?.();
      recRef.current?.stop();
      recRef.current = null;
      abortRef.current?.abort();
      session.dispose();
      sessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    sessionRef.current?.setMuted(muted);
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    sessionRef.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    bumpGeneration();
    introForGame.current = '';
    pendingIntro.current = false;
    historyRef.current = [];
    previousRunId.current = null;
    setVoiceEnabled(false);
    voiceEnabledRef.current = false;
    setHandsFree(false);
  }, [gameId, bumpGeneration]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch('/api/companion')
      .then((res) => res.json())
      .then((body: {
        speechProvider?: string;
        provider?: string;
        modelProvider?: string;
        quotaUnavailable?: boolean;
        quotaBackend?: string;
        requiredSetting?: string | null;
        speechKeyKind?: string | null;
      }) => {
        if (cancelled) return;
        if (typeof body.speechProvider === 'string') setProviderHint(body.speechProvider);
        else if (typeof body.provider === 'string') setProviderHint(body.provider);
        if (typeof body.modelProvider === 'string') setModelHint(body.modelProvider);
        if (typeof body.speechKeyKind === 'string') setSpeechKeyKind(body.speechKeyKind);
        if (body.quotaUnavailable) setQuotaHint('unavailable');
        else if (typeof body.quotaBackend === 'string') setQuotaHint(body.quotaBackend);
      })
      .catch(() => {
        /* health is advisory */
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, gameId]);

  const startHandsFree = useCallback(() => {
    if (!enabled || mutedRef.current || !voiceEnabledRef.current) return;
    if (speakingRef.current) return;
    if (!browserSpeechRecognitionAvailable()) return;
    haltMicrophone();
    setState('listening');
    setError(null);
    recRef.current = startBrowserRecognition({
      continuous: true,
      onText: (text) => {
        if (speakingRef.current) return;
        setTranscriptSource('microphone');
        void playTurnRef.current('ask', text, 'microphone');
      },
      onError: (code) => {
        recRef.current = null;
        setHandsFree(false);
        setState('idle');
        if (code === 'not-allowed') setError('Microphone stayed off until you allow it.');
        else if (code !== 'aborted') setError('Hands-free missed that. Hold to talk still works.');
      },
      onEnd: () => {
        recRef.current = null;
        setState((prev) => (prev === 'listening' ? 'idle' : prev));
      },
    });
    setHandsFree(true);
  }, [enabled, haltMicrophone]);

  useEffect(() => {
    if (!enabled) {
      haltMicrophone();
      bumpGeneration();
      return;
    }
    const onBackground = () => {
      if (document.visibilityState === 'hidden') {
        haltMicrophone();
        abortRef.current?.abort();
        sessionRef.current?.stop();
        speakingRef.current = false;
        setState('idle');
      }
    };
    const onPageHide = () => {
      haltMicrophone();
      abortRef.current?.abort();
      sessionRef.current?.stop();
    };
    document.addEventListener('visibilitychange', onBackground);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('freeze', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onBackground);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('freeze', onPageHide);
    };
  }, [enabled, bumpGeneration, haltMicrophone]);

  const playTurn = useCallback(
    async (intent: 'intro' | 'ask', transcript = '', source: TranscriptSource = 'unknown') => {
      if (!enabled) return;
      const generation = generationRef.current;
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;
      haltMicrophone();
      sessionRef.current?.stop();
      speakingRef.current = false;
      setState('thinking');
      setError(null);
      setPlaybackOnsetMs(null);
      setSpeakingStateMs(null);
      setModelFirstMs(null);
      setTextAvailableMs(null);
      setAudioAvailableMs(null);
      setTranscriptSource(source);
      const started = Date.now();
      turnStartedRef.current = started;
      try {
        const auth = await companionAuthHeader();
        if (!auth) throw new Error('unauthorized');
        const peek = gameId === 'nightclub-showdown-inzone-production'
          ? readNightclubHostState(iframeRef.current)
          : null;
        const runId = typeof peek?.raw.runId === 'string' ? peek.raw.runId : null;
        const response = await fetch('/api/companion', {
          method: 'POST',
          headers: {
            Authorization: auth,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            gameId,
            intent,
            transcript,
            history: historyRef.current,
            gameContext: peek?.raw ?? null,
            observedAt: peek?.observedAt ?? 0,
            previousRunId: previousRunId.current,
            transcriptSource: source,
          }),
          signal: abort.signal,
        });
        if (runId) previousRunId.current = runId;
        if (generation !== generationRef.current) return;
        if (response.status === 429) {
          setError('Give me a moment — too many asks.');
          setState('idle');
          setCaption('');
          setNeedsGesture(false);
          trackCampaignEvent(CAMPAIGN_EVENTS.companionTurn, {
            game_id: gameId,
            outcome: 'rate_limited',
            companion_state: 'idle',
          });
          return;
        }
        if (!response.ok) throw new Error(`http_${response.status}`);
        let text = '';
        let meta: Record<string, unknown> | undefined;
        let audioRow: Record<string, unknown> | undefined;
        await readNdjsonStream(response, (row) => {
          if (generation !== generationRef.current) return;
          if (row.type === 'text' && typeof row.text === 'string') {
            text = row.text;
            setCaption(row.text);
            if (typeof row.modelFirstOutputMs === 'number') setModelFirstMs(row.modelFirstOutputMs);
            if (typeof row.textAvailableMs === 'number') setTextAvailableMs(row.textAvailableMs);
            else setTextAvailableMs(Date.now() - started);
          }
          if (row.type === 'meta') meta = row;
          if (row.type === 'audio') audioRow = row;
        });
        if (generation !== generationRef.current) return;
        const provider =
          meta?.speechProvider === 'elevenlabs' ||
          meta?.speechProvider === 'openai' ||
          meta?.speechProvider === 'browser'
            ? meta.speechProvider
            : meta?.provider === 'elevenlabs' || meta?.provider === 'openai' || meta?.provider === 'browser'
              ? meta.provider
              : 'browser';
        setProviderHint(provider);
        if (typeof meta?.modelProvider === 'string') setModelHint(meta.modelProvider);
        if (typeof meta?.replySource === 'string') setReplySource(meta.replySource);
        if (meta?.quotaUnavailable === true) setQuotaHint('unavailable');
        else if (typeof meta?.quotaBackend === 'string') setQuotaHint(meta.quotaBackend);
        setFallbackReason(typeof meta?.fallbackReason === 'string' ? meta.fallbackReason : '');
        setSpeechFallback(typeof meta?.speechFallback === 'string' ? meta.speechFallback : '');
        const speechError =
          meta?.speechError && typeof meta.speechError === 'object'
            ? (meta.speechError as { code?: unknown; httpStatus?: unknown })
            : null;
        setSpeechErrorCode(typeof speechError?.code === 'string' ? speechError.code : '');
        setSpeechErrorHttp(
          typeof speechError?.httpStatus === 'number' ? String(speechError.httpStatus) : '',
        );
        setTtsCharge(typeof meta?.ttsProviderCharge === 'string' ? meta.ttsProviderCharge : '');
        if (typeof meta?.modelFirstOutputMs === 'number') setModelFirstMs(meta.modelFirstOutputMs);
        if (typeof meta?.textAvailableMs === 'number') setTextAvailableMs(meta.textAvailableMs);
        if (typeof meta?.audioAvailableMs === 'number') setAudioAvailableMs(meta.audioAvailableMs);
        if (intent === 'ask' && transcript) {
          historyRef.current = [
            ...historyRef.current,
            { role: 'user' as const, text: transcript },
            { role: 'assistant' as const, text },
          ].slice(-6);
        } else if (text) {
          historyRef.current = [...historyRef.current, { role: 'assistant' as const, text }].slice(-6);
        }
        const turn: TurnMeta = {
          provider,
          text,
          cacheKey: typeof audioRow?.cacheKey === 'string' ? audioRow.cacheKey : undefined,
        };
        let playback: 'idle' | 'playing' | 'blocked' = 'idle';
        let cachedHit = audioRow?.cached === true;
        if (turn.provider !== 'browser' && turn.cacheKey) {
          let blob = readClientSpeechCache(turn.cacheKey);
          cachedHit = cachedHit || !!blob;
          if (!blob) {
            const audioRes = await fetch(`/api/companion/audio?key=${encodeURIComponent(turn.cacheKey)}`, {
              headers: { Authorization: auth },
              signal: abort.signal,
            });
            if (!audioRes.ok) throw new Error('audio_missing');
            blob = await audioRes.blob();
            writeClientSpeechCache(turn.cacheKey, blob);
          }
          if (generation !== generationRef.current) return;
          setAudioAvailableMs((prev) => prev ?? Date.now() - started);
          playback = (await sessionRef.current?.play(blob, generation)) ?? 'blocked';
        } else {
          setAudioAvailableMs((prev) => prev ?? Date.now() - started);
          playback = (await sessionRef.current?.speakBrowser(text, generation)) ?? 'blocked';
        }
        if (generation !== generationRef.current) return;
        setAudioCached(turn.provider === 'browser' ? null : cachedHit);
        if (playback === 'blocked') {
          setNeedsGesture(true);
          setState('idle');
          setSpeechLatencyMs(null);
          trackCampaignEvent(
            intent === 'intro' ? CAMPAIGN_EVENTS.companionIntro : CAMPAIGN_EVENTS.companionAudioFail,
            {
              game_id: gameId,
              outcome: 'blocked',
              companion_provider: turn.provider,
              latency_ms: Date.now() - started,
            },
          );
          return;
        }
        setNeedsGesture(false);
        const latency = Date.now() - started;
        setSpeechLatencyMs(latency);
        trackCampaignEvent(
          intent === 'intro' ? CAMPAIGN_EVENTS.companionIntro : CAMPAIGN_EVENTS.companionTurn,
          {
            game_id: gameId,
            outcome: 'ok',
            companion_provider: turn.provider,
            companion_model: typeof meta?.modelProvider === 'string' ? meta.modelProvider : undefined,
            companion_reply_source: typeof meta?.replySource === 'string' ? meta.replySource : undefined,
            companion_state: playback === 'playing' ? 'speaking' : 'idle',
            latency_ms: latency,
          },
        );
      } catch (err) {
        if (abort.signal.aborted || generation !== generationRef.current) return;
        setState('idle');
        setCaption('');
        setNeedsGesture(false);
        setAudioCached(null);
        setSpeechLatencyMs(null);
        setError('I could not answer just then.');
        trackCampaignEvent(CAMPAIGN_EVENTS.companionAudioFail, {
          game_id: gameId,
          outcome: 'audio_fail',
          latency_ms: Date.now() - started,
        });
        void err;
      } finally {
        if (generation === generationRef.current && voiceEnabledRef.current && !mutedRef.current) {
          startHandsFree();
        }
      }
    },
    [enabled, gameId, iframeRef, haltMicrophone, startHandsFree],
  );

  const playTurnRef = useRef(playTurn);
  playTurnRef.current = playTurn;

  const enableVoice = useCallback(() => {
    setNeedsGesture(false);
    setMuted(false);
    mutedRef.current = false;
    setVoiceEnabled(true);
    voiceEnabledRef.current = true;
    setError(null);
    if (!introForGame.current && enabled) {
      introForGame.current = gameId;
      void playTurn('intro');
    } else if (browserSpeechRecognitionAvailable()) {
      startHandsFree();
    }
    returnGameFocus(iframeRef);
  }, [enabled, gameId, iframeRef, playTurn, startHandsFree]);

  const endVoice = useCallback(() => {
    voiceEnabledRef.current = false;
    setVoiceEnabled(false);
    setHandsFree(false);
    bumpGeneration();
    returnGameFocus(iframeRef);
  }, [bumpGeneration, iframeRef]);

  const interruptSpeech = useCallback(() => {
    abortRef.current?.abort();
    sessionRef.current?.stop();
    speakingRef.current = false;
    setState(voiceEnabledRef.current && !mutedRef.current ? 'listening' : 'idle');
    if (voiceEnabledRef.current && !mutedRef.current) startHandsFree();
    returnGameFocus(iframeRef);
  }, [iframeRef, startHandsFree]);

  const onHoldStart = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!enabled || muted) return;
    abortRef.current?.abort();
    sessionRef.current?.stop();
    speakingRef.current = false;
    haltMicrophone();
    if (!introForGame.current) {
      pendingIntro.current = true;
      enableVoice();
    }
    if (!browserSpeechRecognitionAvailable()) {
      setError('This browser has no speech recognition. Type is not wired; try Chrome.');
      return;
    }
    setState('listening');
    setError(null);
    setTranscriptSource('microphone');
    trackCampaignEvent(CAMPAIGN_EVENTS.companionListen, {
      game_id: gameId,
      companion_state: 'listening',
      outcome: 'ok',
    });
    recRef.current = startBrowserRecognition({
      continuous: false,
      onText: (text) => {
        recRef.current = null;
        void playTurn('ask', text, 'microphone');
      },
      onError: (code) => {
        recRef.current = null;
        setState('idle');
        if (code === 'not-allowed') setError('Microphone stayed off until you allow it.');
        else if (code !== 'aborted') setError('I missed that. Hold to talk again.');
      },
      onEnd: () => {
        recRef.current = null;
        setState((prev) => (prev === 'listening' ? 'idle' : prev));
      },
    });
  }, [enableVoice, enabled, gameId, haltMicrophone, muted, playTurn]);

  const onHoldEnd = useCallback(() => {
    recRef.current?.stop();
    recRef.current = null;
    returnGameFocus(iframeRef);
  }, [iframeRef]);

  if (!enabled) return null;

  return (
    <aside
      className={`companion-dock companion-${state}${voiceEnabled ? ' is-voice-on' : ''}`}
      data-testid="game-companion"
      data-companion-state={state}
      data-companion-provider={providerHint}
      data-companion-model={modelHint}
      data-companion-reply-source={replySource}
      data-companion-quota={quotaHint}
      data-companion-fallback={fallbackReason}
      data-companion-speech-fallback={speechFallback}
      data-companion-speech-error-code={speechErrorCode}
      data-companion-speech-error-http={speechErrorHttp}
      data-companion-tts-charge={ttsCharge}
      data-companion-speech-key-kind={speechKeyKind}
      data-companion-cached={audioCached == null ? 'n/a' : String(audioCached)}
      data-speech-latency-ms={speechLatencyMs == null ? '' : String(speechLatencyMs)}
      data-speaking-state-ms={speakingStateMs == null ? '' : String(speakingStateMs)}
      data-playback-onset-ms={playbackOnsetMs == null ? '' : String(playbackOnsetMs)}
      data-latency-model-first-ms={modelFirstMs == null ? '' : String(modelFirstMs)}
      data-latency-text-ms={textAvailableMs == null ? '' : String(textAvailableMs)}
      data-latency-audio-ms={audioAvailableMs == null ? '' : String(audioAvailableMs)}
      data-transcript-source={transcriptSource}
      data-voice-enabled={voiceEnabled ? 'true' : 'false'}
      data-hands-free={handsFree ? 'true' : 'false'}
      data-game={gameId}
    >
      <div className="companion-presence" aria-hidden="true" data-testid="companion-presence">
        <span className="companion-face" />
        <span className="companion-wave" />
      </div>
      <div className="companion-copy">
        <p className="companion-name">{name}</p>
        {captionsOn && caption ? <p className="companion-caption">{caption}</p> : null}
        {error ? <p className="companion-error">{error}</p> : null}
        {needsGesture ? (
          <button type="button" className="companion-sound" onClick={enableVoice}>
            Enable sound
          </button>
        ) : null}
      </div>
      <div className="companion-controls">
        {!voiceEnabled ? (
          <button
            type="button"
            className="companion-ptt"
            data-testid="companion-enable-voice"
            onPointerDown={(e) => e.preventDefault()}
            onClick={enableVoice}
          >
            Enable voice
          </button>
        ) : (
          <span className="companion-live" data-testid="companion-voice-state">
            {muted ? 'Muted' : state === 'speaking' ? 'Speaking' : handsFree ? 'Listening' : 'Voice on'}
          </span>
        )}
        <button
          type="button"
          className={`companion-ptt${state === 'listening' && !handsFree ? ' is-hot' : ''}`}
          data-testid="companion-ptt"
          onPointerDown={onHoldStart}
          onPointerUp={onHoldEnd}
          onPointerCancel={onHoldEnd}
        >
          {state === 'listening' && !handsFree ? 'Listening' : 'Hold to talk'}
        </button>
        <button
          type="button"
          data-testid="companion-mute"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            setMuted((v) => {
              const next = !v;
              mutedRef.current = next;
              if (next) {
                haltMicrophone();
                sessionRef.current?.stop();
                speakingRef.current = false;
                setState('idle');
              } else if (voiceEnabledRef.current) {
                startHandsFree();
              }
              returnGameFocus(iframeRef);
              return next;
            });
          }}
          aria-pressed={muted}
        >
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <button
          type="button"
          data-testid="companion-stop"
          onPointerDown={(e) => e.preventDefault()}
          onClick={interruptSpeech}
        >
          Interrupt
        </button>
        {voiceEnabled ? (
          <button
            type="button"
            data-testid="companion-end-voice"
            onPointerDown={(e) => e.preventDefault()}
            onClick={endVoice}
          >
            End
          </button>
        ) : null}
        <button type="button" onClick={() => setCaptionsOn((v) => !v)} aria-pressed={captionsOn}>
          {captionsOn ? 'Captions on' : 'Captions off'}
        </button>
        <label className="companion-vol">
          <span className="sr-only">Companion volume</span>
          <input
            type="range"
            min="0"
            max={String(COMPANION_OUTPUT_GAIN)}
            step="0.05"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label={`${name} volume`}
          />
        </label>
      </div>
      <span className="sr-only">
        Spoken companion for {gameName}. Enable voice for hands-free talk. Hold to talk remains a fallback.
      </span>
    </aside>
  );
}
