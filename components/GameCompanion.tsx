'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createCompanionAudioSession } from '@/lib/companion/audio-session';
import {
  browserSpeechRecognitionAvailable,
  startBrowserRecognition,
} from '@/lib/companion/browser-speech';
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

async function companionAuthHeader(): Promise<string | null> {
  const user = await ensurePlaySessionUser();
  const token = await user.getIdToken();
  return token ? `Bearer ${token}` : null;
}

async function readNdjson(response: Response): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const text = await response.text();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      /* ignore a torn line */
    }
  }
  return rows;
}

export function GameCompanion({ gameId, gameName, iframeRef, active }: Props) {
  const enabled = active && isFlagshipId(gameId);
  const name = useMemo(() => companionName(), []);
  const [state, setState] = useState<CompanionUiState>('idle');
  const [muted, setMuted] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [caption, setCaption] = useState('');
  const [needsGesture, setNeedsGesture] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.8);
  const generationRef = useRef(0);
  const introForGame = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const sessionRef = useRef<ReturnType<typeof createCompanionAudioSession> | null>(null);
  const pendingIntro = useRef(false);

  const bumpGeneration = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    recRef.current?.stop();
    recRef.current = null;
    sessionRef.current?.stop();
    setState('idle');
  }, []);

  useEffect(() => {
    const session = createCompanionAudioSession({
      currentGeneration: () => generationRef.current,
      onPlaying: (playing) => {
        setState((prev) => {
          if (playing) return 'speaking';
          return prev === 'speaking' ? 'idle' : prev;
        });
      },
    });
    sessionRef.current = session;
    return () => {
      session.dispose();
      sessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    sessionRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    sessionRef.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    bumpGeneration();
    introForGame.current = '';
    pendingIntro.current = false;
    setCaption('');
    setError(null);
    setNeedsGesture(false);
  }, [gameId, bumpGeneration]);

  useEffect(() => {
    if (!enabled) {
      bumpGeneration();
      return;
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') bumpGeneration();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [enabled, bumpGeneration]);

  const playTurn = useCallback(
    async (intent: 'intro' | 'ask', transcript = '') => {
      if (!enabled) return;
      const generation = generationRef.current;
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;
      setState('thinking');
      setError(null);
      const started = Date.now();
      try {
        const auth = await companionAuthHeader();
        if (!auth) throw new Error('unauthorized');
        const peek = gameId === 'nightclub-showdown-inzone-production'
          ? readNightclubHostState(iframeRef.current)
          : null;
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
            gameContext: peek?.raw ?? null,
            observedAt: peek?.observedAt ?? 0,
          }),
          signal: abort.signal,
        });
        if (generation !== generationRef.current) return;
        if (response.status === 429) {
          setError('Give me a moment — too many asks.');
          setState('idle');
          trackCampaignEvent(CAMPAIGN_EVENTS.companionTurn, {
            game_id: gameId,
            outcome: 'rate_limited',
            companion_state: 'idle',
          });
          return;
        }
        if (!response.ok) throw new Error(`http_${response.status}`);
        const rows = await readNdjson(response);
        if (generation !== generationRef.current) return;
        const meta = rows.find((row) => row.type === 'meta');
        const textRow = rows.find((row) => row.type === 'text');
        const audioRow = rows.find((row) => row.type === 'audio');
        const text = typeof textRow?.text === 'string' ? textRow.text : '';
        setCaption(text);
        const provider =
          meta?.provider === 'elevenlabs' || meta?.provider === 'openai' || meta?.provider === 'browser'
            ? meta.provider
            : 'browser';
        const turn: TurnMeta = {
          provider,
          text,
          cacheKey: typeof audioRow?.cacheKey === 'string' ? audioRow.cacheKey : undefined,
        };
        let playback: 'idle' | 'playing' | 'blocked' = 'idle';
        if (turn.provider !== 'browser' && turn.cacheKey) {
          const audioRes = await fetch(`/api/companion/audio?key=${encodeURIComponent(turn.cacheKey)}`, {
            headers: { Authorization: auth },
            signal: abort.signal,
          });
          if (!audioRes.ok) throw new Error('audio_missing');
          const blob = await audioRes.blob();
          if (generation !== generationRef.current) return;
          playback = (await sessionRef.current?.play(blob, generation)) ?? 'blocked';
        } else {
          playback = (await sessionRef.current?.speakBrowser(text, generation)) ?? 'blocked';
        }
        if (generation !== generationRef.current) return;
        if (playback === 'blocked') {
          setNeedsGesture(true);
          setState('idle');
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
        trackCampaignEvent(
          intent === 'intro' ? CAMPAIGN_EVENTS.companionIntro : CAMPAIGN_EVENTS.companionTurn,
          {
            game_id: gameId,
            outcome: 'ok',
            companion_provider: turn.provider,
            companion_state: playback === 'playing' ? 'speaking' : 'idle',
            latency_ms: Date.now() - started,
          },
        );
      } catch (err) {
        if (abort.signal.aborted || generation !== generationRef.current) return;
        setState('idle');
        setError('I could not answer just then.');
        trackCampaignEvent(CAMPAIGN_EVENTS.companionAudioFail, {
          game_id: gameId,
          outcome: 'audio_fail',
          latency_ms: Date.now() - started,
        });
        void err;
      }
    },
    [enabled, gameId, iframeRef],
  );

  const enableAudio = useCallback(() => {
    setNeedsGesture(false);
    if (!introForGame.current && enabled) {
      introForGame.current = gameId;
      void playTurn('intro');
    }
  }, [enabled, gameId, playTurn]);

  const onHoldStart = useCallback(() => {
    if (!enabled || muted) return;
    if (!introForGame.current) {
      pendingIntro.current = true;
      enableAudio();
    }
    if (!browserSpeechRecognitionAvailable()) {
      setError('This browser has no speech recognition. Type is not wired; try Chrome.');
      return;
    }
    recRef.current?.stop();
    setState('listening');
    setError(null);
    trackCampaignEvent(CAMPAIGN_EVENTS.companionListen, {
      game_id: gameId,
      companion_state: 'listening',
      outcome: 'ok',
    });
    recRef.current = startBrowserRecognition({
      onText: (text) => {
        recRef.current = null;
        void playTurn('ask', text);
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
  }, [enableAudio, enabled, gameId, muted, playTurn]);

  const onHoldEnd = useCallback(() => {
    recRef.current?.stop();
    recRef.current = null;
  }, []);

  if (!enabled) return null;

  return (
    <aside
      className={`companion-dock companion-${state}`}
      data-testid="game-companion"
      data-companion-state={state}
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
          <button type="button" className="companion-sound" onClick={enableAudio}>
            Enable sound
          </button>
        ) : null}
      </div>
      <div className="companion-controls">
        <button
          type="button"
          className={`companion-ptt${state === 'listening' ? ' is-hot' : ''}`}
          data-testid="companion-ptt"
          onPointerDown={onHoldStart}
          onPointerUp={onHoldEnd}
          onPointerCancel={onHoldEnd}
          onClick={() => {
            if (!introForGame.current) enableAudio();
          }}
        >
          {state === 'listening' ? 'Listening' : 'Hold to talk'}
        </button>
        <button type="button" onClick={() => setMuted((v) => !v)} aria-pressed={muted}>
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <button type="button" onClick={bumpGeneration}>
          Stop
        </button>
        <button type="button" onClick={() => setCaptionsOn((v) => !v)} aria-pressed={captionsOn}>
          {captionsOn ? 'Captions on' : 'Captions off'}
        </button>
        <label className="companion-vol">
          <span className="sr-only">Companion volume</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label={`${name} volume`}
          />
        </label>
      </div>
      <span className="sr-only">
        Spoken companion for {gameName}. Microphone starts only when you hold to talk.
      </span>
    </aside>
  );
}
