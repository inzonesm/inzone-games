'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CompanionRibbon } from '@/components/CompanionRibbon';
import {
  COMPANION_OUTPUT_GAIN,
  createCompanionAudioSession,
  type CompanionPlaybackMode,
  type CompanionSpeechReactive,
  type PcmStreamPlayer,
} from '@/lib/companion/audio-session';
import {
  browserSpeechRecognitionAvailable,
  startBrowserRecognition,
} from '@/lib/companion/browser-speech';
import { readClientSpeechCache, writeClientSpeechCache } from '@/lib/companion/client-speech-cache';
import { companionName } from '@/lib/companion/config';
import {
  attachNightclubFocusHold,
  formatPauseSample,
  sampleNightclubPause,
  setCompanionHoldPlay,
} from '@/lib/nightclub-companion-focus';
import { bytesAsBlobPart, concatBytes, decodeBase64Bytes, pcmS16leToWav } from '@/lib/companion/pcm';
import { readBrowserTranscriptSource, type CompanionTranscriptSource } from '@/lib/companion/transcript-source';
import type { CompanionUiState } from '@/lib/companion/ui-state';
import { isFlagshipId } from '@/lib/flagship-roster';
import { readNightclubHostState } from '@/lib/companion/read-nightclub-state';
import { CAMPAIGN_EVENTS, trackCampaignEvent } from '@/lib/campaign-analytics';
import { ensurePlaySessionUser } from '@/lib/play-session';

export type { CompanionUiState } from '@/lib/companion/ui-state';

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

type TranscriptSource = CompanionTranscriptSource;

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

function keepChromeFromStealingFocus(event: { preventDefault: () => void }) {
  event.preventDefault();
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
  const [playbackMode, setPlaybackMode] = useState<CompanionPlaybackMode | 'none'>('none');
  const [speechReactive, setSpeechReactive] = useState<CompanionSpeechReactive>('none');
  const [menuOpen, setMenuOpen] = useState(false);
  const [pauseTrace, setPauseTrace] = useState('');
  const [holdPlay, setHoldPlay] = useState(false);
  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const turnStartedRef = useRef(0);
  const speechLevelRef = useRef(0);
  const startHandsFreeRef = useRef<() => void>(() => {});
  const pauseTraceRef = useRef<string[]>([]);
  const voiceHeldRef = useRef(false);

  const notePauseTrace = useCallback((name: string) => {
    const row = `${Date.now()}:${name}`;
    pauseTraceRef.current = [...pauseTraceRef.current, row].slice(-12);
    setPauseTrace(pauseTraceRef.current.join('|'));
  }, []);

  const setVoiceHold = useCallback((hold: boolean) => {
    if (voiceHeldRef.current === hold) {
      setCompanionHoldPlay(hold);
      return;
    }
    voiceHeldRef.current = hold;
    setHoldPlay(hold);
    setCompanionHoldPlay(hold);
    notePauseTrace(hold ? 'hold_on' : 'hold_off');
  }, [notePauseTrace]);

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
          if (prev === 'speaking' && voiceEnabledRef.current && !mutedRef.current) {
            queueMicrotask(() => startHandsFreeRef.current());
            return 'listening';
          }
          return prev === 'speaking' ? 'idle' : prev;
        });
      },
      onOnset: (at) => {
        if (turnStartedRef.current) setPlaybackOnsetMs(at - turnStartedRef.current);
      },
      onLevel: (level) => {
        speechLevelRef.current = level;
      },
      onPlaybackMode: (mode, reactive) => {
        setPlaybackMode(mode);
        setSpeechReactive(reactive);
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
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      const dock = event.target instanceof Element ? event.target.closest('[data-testid=game-companion]') : null;
      if (!dock) setMenuOpen(false);
    };
    const onBlur = () => setMenuOpen(false);
    const frame = iframeRef.current?.contentWindow;
    const onGamePointer = () => setMenuOpen(false);
    const onGameKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('blur', onBlur);
    try {
      frame?.addEventListener('pointerdown', onGamePointer);
      frame?.addEventListener('keydown', onGameKey);
    } catch {
      /* cross-origin frames stay closed via Escape on the host */
    }
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('blur', onBlur);
      try {
        frame?.removeEventListener('pointerdown', onGamePointer);
        frame?.removeEventListener('keydown', onGameKey);
      } catch {
        /* ignore */
      }
    };
  }, [menuOpen, iframeRef]);

  useEffect(() => {
    bumpGeneration();
    introForGame.current = '';
    pendingIntro.current = false;
    historyRef.current = [];
    previousRunId.current = null;
    setVoiceEnabled(false);
    voiceEnabledRef.current = false;
    setHandsFree(false);
    setMenuOpen(false);
    setCompanionHoldPlay(false);
    voiceHeldRef.current = false;
    setHoldPlay(false);
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
    if (recRef.current) {
      setState((prev) => (prev === 'idle' || prev === 'thinking' ? 'listening' : prev));
      return;
    }
    notePauseTrace('rec_start');
    setState('listening');
    setError(null);
    recRef.current = startBrowserRecognition({
      continuous: true,
      onText: (text) => {
        if (speakingRef.current) return;
        const source = readBrowserTranscriptSource();
        setTranscriptSource(source);
        void playTurnRef.current('ask', text, source);
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
        if (voiceEnabledRef.current && !mutedRef.current && !speakingRef.current) {
          notePauseTrace('rec_end_restart');
          queueMicrotask(() => startHandsFreeRef.current());
          return;
        }
        setState((prev) => (prev === 'listening' ? 'idle' : prev));
      },
    });
    setHandsFree(true);
  }, [enabled, notePauseTrace]);
  startHandsFreeRef.current = startHandsFree;

  useEffect(() => {
    if (!enabled) {
      haltMicrophone();
      bumpGeneration();
      return;
    }
    const onBackground = () => {
      if (document.visibilityState === 'hidden') {
        notePauseTrace('visibility_hidden');
        setCompanionHoldPlay(false);
        haltMicrophone();
        abortRef.current?.abort();
        sessionRef.current?.stop();
        speakingRef.current = false;
        setState('idle');
      } else if (voiceHeldRef.current) {
        notePauseTrace('visibility_visible');
        setCompanionHoldPlay(true);
      }
    };
    const onPageHide = () => {
      haltMicrophone();
      abortRef.current?.abort();
      sessionRef.current?.stop();
    };
    const onWindowBlur = () => notePauseTrace('window_blur');
    const onWindowFocus = () => notePauseTrace('window_focus');
    let lastSample = '';
    const pollPause = () => {
      if (gameId !== 'nightclub-showdown-inzone-production') return;
      if (voiceHeldRef.current) attachNightclubFocusHold(iframeRef.current);
      const row = formatPauseSample(sampleNightclubPause(iframeRef.current));
      if (row === lastSample) return;
      lastSample = row;
      notePauseTrace(`game_${row}`);
    };
    document.addEventListener('visibilitychange', onBackground);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('freeze', onPageHide);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('focus', onWindowFocus);
    const timer = window.setInterval(pollPause, 400);
    pollPause();
    return () => {
      document.removeEventListener('visibilitychange', onBackground);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('freeze', onPageHide);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('focus', onWindowFocus);
      window.clearInterval(timer);
    };
  }, [enabled, bumpGeneration, gameId, haltMicrophone, iframeRef, notePauseTrace]);

  const playTurn = useCallback(
    async (intent: 'intro' | 'ask', transcript = '', source: TranscriptSource = 'unknown') => {
      if (!enabled) return;
      const generation = generationRef.current;
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;
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
        const pcmHold: { player: PcmStreamPlayer | null } = { player: null };
        let incremental = false;
        let pcmAborted = false;
        const pcmParts: Uint8Array[] = [];
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
          if (row.type === 'audio-start' && row.playback === 'incremental') {
            incremental = true;
            pcmHold.player = sessionRef.current?.playPcmStream(generation) ?? null;
            pcmHold.player?.start({
              sampleRate: typeof row.sampleRate === 'number' ? row.sampleRate : undefined,
              channels: 1,
            });
            setAudioAvailableMs((prev) => prev ?? Date.now() - started);
            setPlaybackMode('incremental');
            setSpeechReactive('audio');
          }
          if (row.type === 'audio-chunk' && typeof row.data === 'string') {
            const bytes = decodeBase64Bytes(row.data);
            pcmParts.push(bytes);
            pcmHold.player?.append(bytes);
          }
          if (row.type === 'audio-abort') {
            pcmAborted = true;
            pcmHold.player?.cancel();
            pcmHold.player = null;
            incremental = false;
          }
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
        if (incremental && pcmHold.player && !pcmAborted) {
          playback = await pcmHold.player.end();
          if (playback === 'blocked' && pcmParts.length) {
            pcmHold.player.cancel();
            const wav = pcmS16leToWav(concatBytes(pcmParts));
            const blob = new Blob([bytesAsBlobPart(wav)], { type: 'audio/wav' });
            playback = (await sessionRef.current?.play(blob, generation)) ?? 'blocked';
          }
        } else if (turn.provider !== 'browser' && turn.cacheKey) {
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
          const contentType =
            typeof audioRow?.contentType === 'string' ? audioRow.contentType : blob.type;
          if (contentType.includes('pcm')) {
            blob = new Blob(
              [bytesAsBlobPart(pcmS16leToWav(new Uint8Array(await blob.arrayBuffer())))],
              { type: 'audio/wav' },
            );
          }
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
        if (
          generation === generationRef.current &&
          voiceEnabledRef.current &&
          !mutedRef.current &&
          !speakingRef.current
        ) {
          startHandsFree();
        }
      }
    },
    [enabled, gameId, iframeRef, startHandsFree],
  );

  const playTurnRef = useRef(playTurn);
  playTurnRef.current = playTurn;

  const enableVoice = useCallback(() => {
    notePauseTrace('enable_voice');
    setNeedsGesture(false);
    setMuted(false);
    mutedRef.current = false;
    setVoiceEnabled(true);
    voiceEnabledRef.current = true;
    setVoiceHold(true);
    attachNightclubFocusHold(iframeRef.current);
    setError(null);
    void sessionRef.current?.unlock();
    if (!introForGame.current && enabled) {
      introForGame.current = gameId;
      void playTurn('intro');
    } else if (browserSpeechRecognitionAvailable()) {
      startHandsFree();
    }
  }, [enabled, gameId, iframeRef, notePauseTrace, playTurn, setVoiceHold, startHandsFree]);

  const endVoice = useCallback(() => {
    notePauseTrace('end_voice');
    voiceEnabledRef.current = false;
    setVoiceEnabled(false);
    setHandsFree(false);
    setMenuOpen(false);
    setVoiceHold(false);
    bumpGeneration();
  }, [bumpGeneration, notePauseTrace, setVoiceHold]);

  const interruptSpeech = useCallback(() => {
    abortRef.current?.abort();
    sessionRef.current?.stop();
    speakingRef.current = false;
    setState(voiceEnabledRef.current && !mutedRef.current ? 'listening' : 'idle');
    if (voiceEnabledRef.current && !mutedRef.current) startHandsFree();
  }, [startHandsFree]);

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
    setTranscriptSource(readBrowserTranscriptSource());
    trackCampaignEvent(CAMPAIGN_EVENTS.companionListen, {
      game_id: gameId,
      companion_state: 'listening',
      outcome: 'ok',
    });
    recRef.current = startBrowserRecognition({
      continuous: false,
      onText: (text) => {
        recRef.current = null;
        void playTurn('ask', text, readBrowserTranscriptSource());
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
  }, []);

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
      data-latency-speech-end-to-audible-ms={playbackOnsetMs == null ? '' : String(playbackOnsetMs)}
      data-transcript-source={transcriptSource}
      data-playback-mode={playbackMode}
      data-speech-reactive={speechReactive}
      data-voice-enabled={voiceEnabled ? 'true' : 'false'}
      data-hands-free={handsFree ? 'true' : 'false'}
      data-hold-play={holdPlay ? 'true' : 'false'}
      data-pause-trace={pauseTrace}
      data-companion-layout="shelf"
      data-game={gameId}
      onMouseDown={keepChromeFromStealingFocus}
    >
      <div className="companion-presence" aria-hidden="true" data-testid="companion-presence">
        <CompanionRibbon
          state={muted ? 'idle' : state}
          muted={muted}
          levelRef={speechLevelRef}
          speechReactive={speechReactive}
        />
      </div>
      <div className="companion-copy">
        <p className="companion-name">
          {name}
          <span className="companion-dot" aria-hidden="true" />
          <span className="companion-status" data-testid="companion-voice-state">
            {muted ? 'Muted' : !voiceEnabled ? 'Ready' : state === 'speaking' ? 'Speaking' : state === 'thinking' ? 'Thinking' : handsFree || state === 'listening' ? 'Listening' : 'Voice on'}
          </span>
        </p>
        {error ? (
          <p className="companion-error">{error}</p>
        ) : captionsOn && caption ? (
          <p className="companion-caption">{caption}</p>
        ) : null}
      </div>
      <div className="companion-controls">
        {needsGesture ? (
          <button
            type="button"
            className="companion-icon-btn companion-voice-label"
            data-testid="companion-enable-voice"
            tabIndex={-1}
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={keepChromeFromStealingFocus}
            onClick={enableVoice}
          >
            Enable sound
          </button>
        ) : !voiceEnabled ? (
          <button
            type="button"
            className="companion-icon-btn companion-voice-label"
            data-testid="companion-enable-voice"
            tabIndex={-1}
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={keepChromeFromStealingFocus}
            onClick={enableVoice}
          >
            Voice
          </button>
        ) : (
          <button
            type="button"
            className="companion-icon-btn"
            data-testid="companion-mute"
            tabIndex={-1}
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={keepChromeFromStealingFocus}
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
                return next;
              });
            }}
            aria-label={muted ? 'Unmute mic' : 'Mute mic'}
            aria-pressed={muted}
          >
            {muted ? <MicOffIcon /> : <MicIcon />}
            <span className="sr-only">{muted ? 'Unmute mic' : 'Mute mic'}</span>
          </button>
        )}
        {state === 'speaking' ? (
          <button
            type="button"
            className="companion-icon-btn"
            data-testid="companion-stop"
            tabIndex={-1}
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={keepChromeFromStealingFocus}
            onClick={interruptSpeech}
            aria-label="Interrupt"
          >
            <StopIcon />
            <span className="sr-only">Interrupt</span>
          </button>
        ) : null}
        <button
          type="button"
          className="companion-icon-btn"
          data-testid="companion-menu"
          tabIndex={-1}
          aria-expanded={menuOpen}
          aria-controls="companion-more"
          aria-label="More companion settings"
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={keepChromeFromStealingFocus}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <MoreIcon />
          <span className="sr-only">More</span>
        </button>
        {menuOpen ? (
          <div id="companion-more" className="companion-more" data-testid="companion-more">
            <button
              type="button"
              className={`companion-ptt${state === 'listening' && !handsFree ? ' is-hot' : ''}`}
              data-testid="companion-ptt"
              tabIndex={-1}
              onPointerDown={onHoldStart}
              onPointerUp={onHoldEnd}
              onPointerCancel={onHoldEnd}
            >
              {state === 'listening' && !handsFree ? 'Listening' : 'Hold to talk'}
            </button>
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={keepChromeFromStealingFocus}
              onClick={() => setCaptionsOn((v) => !v)}
              aria-pressed={captionsOn}
            >
              {captionsOn ? 'Captions on' : 'Captions off'}
            </button>
            <label className="companion-vol">
              <span className="sr-only">Companion volume</span>
              <input
                type="range"
                tabIndex={-1}
                min="0"
                max={String(COMPANION_OUTPUT_GAIN)}
                step="0.05"
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label={`${name} volume`}
              />
            </label>
            {voiceEnabled ? (
              <button
                type="button"
                data-testid="companion-end-voice"
                tabIndex={-1}
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={keepChromeFromStealingFocus}
                onClick={endVoice}
              >
                End
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <span className="sr-only">
        Spoken companion for {gameName}. Enable voice for hands-free talk. Hold to talk remains a fallback in More.
      </span>
    </aside>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="currentColor" d="M4.27 3 3 4.27 9 10.27V11a3 3 0 0 0 3.73 2.91l1.6 1.6A5 5 0 0 1 7 11H5a7 7 0 0 0 6 6.92V21h2v-3.08c.73-.1 1.42-.35 2.05-.72L19.73 21 21 19.73 4.27 3ZM12 4a2 2 0 0 1 2 2v3.18l-4-4V6a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect fill="currentColor" x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle fill="currentColor" cx="6" cy="12" r="1.7" />
      <circle fill="currentColor" cx="12" cy="12" r="1.7" />
      <circle fill="currentColor" cx="18" cy="12" r="1.7" />
    </svg>
  );
}
