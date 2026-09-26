'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CompanionRibbon } from '@/components/CompanionRibbon';
import { bottomBandOfFrame, captionMayOverlay } from '@/lib/letterbox';
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
import { GAME_DUCK_LEVEL, setGameAudioDuck } from '@/lib/game-audio-duck';
import { shouldDuckGameAudio } from '@/lib/companion/voice-duck-policy';
import {
  clearVoiceDebugLog,
  getVoiceDebugLog,
  voiceDebug,
} from '@/lib/companion/voice-debug';
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
  /**
   * Where the caption and the sheet are painted. They cannot live inside the
   * bar: `.game-rail` is positioned and scrolls its overflow, so a child
   * absolutely positioned against it is clipped to the bar on a desktop rail
   * and measured against the wrong box on a phone. The cell stays in the bar;
   * everything that floats goes through this node instead. Optional: without
   * one the floating parts simply do not paint, which is the right failure for
   * a surface that has not decided where they go yet.
   */
  overlayRef?: { current: HTMLElement | null };
  /**
   * Which screen this instance is on. Today both render the same bar cell:
   * the player's presentation is settled and discovery's is not — the approved
   * discovery image is the target for a later pass, and guessing at it now
   * would be a third Rook presentation to unpick. Carried so the discovery
   * components keep compiling and nothing about them is lost, and reported on
   * the element so a check can tell the two apart.
   */
  surface?: 'player' | 'discovery';
};

type TurnMeta = {
  provider: 'elevenlabs' | 'openai' | 'browser';
  cacheKey?: string;
  text: string;
};

type TranscriptSource = CompanionTranscriptSource;

/**
 * Delay before the mic re-arms after Rook finishes speaking. Without it
 * the recognizer can pick up the tail of Rook's own TTS (or the game
 * audio swelling back) and fire a bogus turn the moment speech ends.
 */
const VOICE_LISTEN_RESTART_GUARD_MS = 400;

/**
 * How long "user is speaking" stays true after the last interim result
 * without a final. Cleared by onText; the timeout is the backstop for
 * utterances Chrome never finalizes.
 */
const USER_SPEAKING_TIMEOUT_MS = 2500;

/**
 * How long a fresh recognizer gets before we require proof the mic is
 * hot (onstart). Past this with no onstart, the watchdog treats the
 * recognizer as silently dead: tear it down and retry, bounded. Long
 * enough for a normal permission/start round-trip; short enough that a
 * fake "Listening" can't linger unnoticed.
 */
const VOICE_RECOGNIZER_HOT_TIMEOUT_MS = 6000;

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

/**
 * Keeps a tap on our chrome from pulling focus out of the game.
 *
 * Only ever on `mousedown`. The same call on `pointerdown` also cancels the
 * compatibility mouse events a touch screen synthesises — including `click` —
 * so every control that carried it was inert on a phone while looking and
 * feeling fine on a desktop. A hosted run on a touch viewport caught it: the
 * mute chip reported `pointerdown` and `touchstart` and no click at all.
 */
function keepChromeFromStealingFocus(event: { preventDefault: () => void }) {
  event.preventDefault();
}

export function GameCompanion({ gameId, gameName, iframeRef, active, overlayRef, surface = 'player' }: Props) {
  const enabled = active && isFlagshipId(gameId);
  const name = useMemo(() => companionName(), []);
  const [state, setState] = useState<CompanionUiState>('idle');
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  // Recognizer's actual phase, driven by browser-speech.ts's onListening /
  // onReconnecting callbacks — NOT by handsFree. The reported bug was
  // "Listening" showing while the recognizer was dead, which is exactly what
  // happens when the label is driven by user intent (handsFree) rather than
  // by Chrome's onstart / a live retry ladder.
  //   off          — no recognizer / halted
  //   hot          — Chrome's onstart fired; mic is actively listening
  //   reconnecting — safeStart is retrying after an InvalidStateError
  const [micPhase, setMicPhase] = useState<'off' | 'hot' | 'reconnecting'>('off');
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
  /** A playTurn is in flight (fetching the reply / about to speak). */
  const turnActiveRef = useRef(false);
  /** Interim speech seen since the last final result — the user is audible. */
  const userSpeakingRef = useRef(false);
  const userSpeakingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  /** Latest interim transcript while hands-free listening — the live
      "hearing you" indicator. If the mic is hot but this never fills,
      the recognizer is silently dead (the exact failure a bare
      "Listening" label hides). Cleared on every final result / turn. */
  const [heardText, setHeardText] = useState('');
  const [debugCopied, setDebugCopied] = useState(false);
  const [pauseTrace, setPauseTrace] = useState('');
  const [holdPlay, setHoldPlay] = useState(false);
  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const turnStartedRef = useRef(0);
  const speechLevelRef = useRef(0);
  const startHandsFreeRef = useRef<() => void>(() => {});
  const pauseTraceRef = useRef<string[]>([]);
  const voiceHeldRef = useRef(false);
  /** Watchdog: if a fresh recognizer's onstart never arrives, the UI would
      otherwise sit on a fake "Listening" forever (observed on iOS). The
      timer is cleared by onListening; on fire it retries once, bounded. */
  const hotWatchdog = useRef<number | null>(null);
  const watchdogRestarts = useRef(0);
  /** Mirrors the handsFree state for timer callbacks that can't read it. */
  const handsFreeRef = useRef(false);

  const clearHotWatchdog = useCallback(() => {
    if (hotWatchdog.current) {
      clearTimeout(hotWatchdog.current);
      hotWatchdog.current = null;
    }
  }, []);

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

  /**
   * Game-audio arbitration. The game ducks (not mutes) while anyone is
   * talking — Rook speaking, a turn in flight, or the user audibly
   * speaking — and returns to full volume for quiet hands-free
   * listening. Driven into the frame's injected shim
   * (lib/game-audio-duck.ts); cross-origin frames report false and keep
   * full game audio, where the half-duplex mic discipline below is the
   * backstop.
   */
  const syncGameDuck = useCallback(() => {
    const duck = shouldDuckGameAudio({
      voiceEnabled: voiceEnabledRef.current,
      muted: mutedRef.current,
      speaking: speakingRef.current,
      turnActive: turnActiveRef.current,
      userSpeaking: userSpeakingRef.current,
    });
    setGameAudioDuck(iframeRef.current, duck ? GAME_DUCK_LEVEL : 1);
  }, [iframeRef]);

  /** Re-arm the mic after speech, with a guard window so the recognizer
   *  doesn't pick up Rook's TTS tail as a new turn. Debounced: scheduling
   *  again clears the pending one. */
  const restartListeningSoon = useCallback(() => {
    if (restartTimer.current) clearTimeout(restartTimer.current);
    voiceDebug('rec_rearm');
    restartTimer.current = setTimeout(() => {
      restartTimer.current = null;
      startHandsFreeRef.current();
    }, VOICE_LISTEN_RESTART_GUARD_MS);
  }, []);

  const clearUserSpeaking = useCallback(() => {
    userSpeakingRef.current = false;
    if (userSpeakingTimer.current) {
      clearTimeout(userSpeakingTimer.current);
      userSpeakingTimer.current = null;
    }
  }, []);

  const markUserSpeaking = useCallback(() => {
    if (speakingRef.current) return;
    userSpeakingRef.current = true;
    if (userSpeakingTimer.current) clearTimeout(userSpeakingTimer.current);
    userSpeakingTimer.current = setTimeout(() => {
      userSpeakingTimer.current = null;
      userSpeakingRef.current = false;
      syncGameDuck();
    }, USER_SPEAKING_TIMEOUT_MS);
    syncGameDuck();
  }, [syncGameDuck]);

  const haltMicrophone = useCallback((reason: string = 'unspecified') => {
    if (restartTimer.current) {
      clearTimeout(restartTimer.current);
      restartTimer.current = null;
    }
    clearHotWatchdog();
    const hadActive = recRef.current != null;
    recRef.current?.abort?.();
    recRef.current?.stop();
    recRef.current = null;
    // abort() in browser-speech.ts already clears pendingTimers so no
    // deferred retry can start the mic again. Clear the UI phase locally
    // so the label stops showing "Listening" / "Reconnecting…" the moment
    // the caller (mute, background, unmount) asked to stop.
    setMicPhase('off');
    // Cancellation reason for the debug log: distinguishes "the mic went
    // quiet because the user muted" from "the recognizer died". Only
    // logged when a recognizer was actually live — a no-op halt carries
    // no information.
    if (hadActive) voiceDebug('mic_halt', reason);
  }, [clearHotWatchdog]);

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
    haltMicrophone('generation');
    sessionRef.current?.stop();
    speakingRef.current = false;
    turnActiveRef.current = false;
    clearUserSpeaking();
    syncGameDuck();
    clearVisual();
  }, [clearUserSpeaking, clearVisual, haltMicrophone, syncGameDuck]);

  useEffect(() => {
    const session = createCompanionAudioSession({
      currentGeneration: () => generationRef.current,
      onPlaying: (playing) => {
        speakingRef.current = playing;
        voiceDebug('speaking', playing ? 'on' : 'off');
        syncGameDuck();
        setState((prev) => {
          if (playing) {
            if (turnStartedRef.current) {
              setSpeakingStateMs(Date.now() - turnStartedRef.current);
            }
            return 'speaking';
          }
          if (prev === 'speaking' && voiceEnabledRef.current && !mutedRef.current) {
            // Half-duplex: the mic was halted for the whole turn. Re-arm
            // it after a guard window so Rook's TTS tail (or the game
            // audio swelling back) isn't heard as a new turn.
            restartListeningSoon();
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
      // Teardown: haltMicrophone clears the hot watchdog too, so a
      // pending timer can't resurrect the mic after this effect is gone.
      haltMicrophone('teardown');
      abortRef.current?.abort();
      session.dispose();
      sessionRef.current = null;
    };
  }, [haltMicrophone, restartListeningSoon, syncGameDuck]);

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
    handsFreeRef.current = false;
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
    voiceDebug('rec_start');
    setState('listening');
    setError(null);
    recRef.current = startBrowserRecognition({
      continuous: true,
      onText: (text) => {
        if (speakingRef.current) return;
        // Length only in the exported log — never transcript content.
        voiceDebug('onText', `${text.length}ch`);
        setHeardText('');
        // Half-duplex: the mic stays OFF for the whole turn (thinking +
        // speaking). This is the self-interrupt fix — previously the
        // recognizer kept running during "thinking", so a game SFX fired
        // a bogus onText that aborted the in-flight turn and started a
        // new one, forever. The mic re-arms (after a guard window) when
        // Rook finishes speaking.
        haltMicrophone('turn');
        clearUserSpeaking();
        const source = readBrowserTranscriptSource();
        setTranscriptSource(source);
        void playTurnRef.current('ask', text, source);
      },
      onSpeechStart: (interimText) => {
        // The user is audibly mid-utterance: duck the game now so the
        // rest of what they say isn't fighting game audio. The text also
        // feeds the live "hearing you" indicator — if the mic is hot but
        // this never fires, the recognizer is silently dead. The exported
        // log records only the length, never the content.
        voiceDebug('interim', `${interimText.length}ch`);
        setHeardText(interimText);
        markUserSpeaking();
      },
      onListening: () => {
        // Chrome's onstart actually reached us: the mic is genuinely hot.
        // ONLY now is the "Listening" label truthful.
        voiceDebug('rec_hot');
        if (hotWatchdog.current) {
          clearTimeout(hotWatchdog.current);
          hotWatchdog.current = null;
        }
        watchdogRestarts.current = 0;
        setMicPhase('hot');
      },
      onReconnecting: () => {
        // safeStart is retrying — the mic is not hot right now. Drop the
        // "Listening" chip to "Reconnecting…" so we never claim a live
        // mic while the recognizer is dark.
        voiceDebug('rec_reconnecting');
        setMicPhase('reconnecting');
      },
      onError: (code) => {
        recRef.current = null;
        voiceDebug('rec_error', code);
        // The loop is deliberately stopped here (not a transient blip):
        // clear any pending watchdog so it can't retry against a denied
        // permission or a dead device.
        clearHotWatchdog();
        setHandsFree(false);
        handsFreeRef.current = false;
        setMicPhase('off');
        setState('idle');
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          // Terminal in browser-speech.ts: halted flag set, no restart
          // possible on this recognizer. Do not queue another attempt from
          // here either; a permission-denied loop would prompt the browser
          // to blanket-block us for the session.
          setError('Microphone stayed off until you allow it.');
        } else if (code === 'audio-capture') {
          setError('Microphone is unavailable. Check that it is connected and not in use.');
        } else if (code === 'start_failed') {
          setError('Could not start listening. Try Hold to talk, or reload the tab.');
        } else if (code !== 'aborted') {
          setError('Hands-free missed that. Hold to talk still works.');
        }
      },
      onEnd: () => {
        recRef.current = null;
        voiceDebug('rec_end');
        setMicPhase('off');
        if (voiceEnabledRef.current && !mutedRef.current && !speakingRef.current) {
          notePauseTrace('rec_end_restart');
          voiceDebug('rec_restart');
          queueMicrotask(() => startHandsFreeRef.current());
          return;
        }
        setState((prev) => (prev === 'listening' ? 'idle' : prev));
      },
    });
    setHandsFree(true);
    handsFreeRef.current = true;
    // Watchdog: on some phones (observed on iOS) a recognizer can be
    // created without onstart ever arriving — no error, no onend, just a
    // permanently fake "Listening". If the mic isn't provably hot within
    // the window, tear the dead recognizer down and try once more, bounded
    // so a hopeless device can't spin forever. Never retries after the
    // loop was deliberately stopped (permission denial, mute, teardown):
    // retrying against a denied permission would prompt the browser to
    // blanket-block us for the session.
    clearHotWatchdog();
    hotWatchdog.current = window.setTimeout(() => {
      hotWatchdog.current = null;
      if (
        !voiceEnabledRef.current ||
        !handsFreeRef.current ||
        mutedRef.current ||
        speakingRef.current
      ) {
        return;
      }
      if (watchdogRestarts.current >= 3) {
        voiceDebug('watchdog_gave_up');
        return;
      }
      watchdogRestarts.current += 1;
      voiceDebug('watchdog_no_hot', `retry ${watchdogRestarts.current}`);
      haltMicrophone('watchdog');
      startHandsFreeRef.current();
    }, VOICE_RECOGNIZER_HOT_TIMEOUT_MS);
  }, [clearHotWatchdog, clearUserSpeaking, enabled, haltMicrophone, markUserSpeaking, notePauseTrace]);
  startHandsFreeRef.current = startHandsFree;

  useEffect(() => {
    if (!enabled) {
      haltMicrophone('disabled');
      bumpGeneration();
      return;
    }
    const onBackground = () => {
      if (document.visibilityState === 'hidden') {
        notePauseTrace('visibility_hidden');
        setCompanionHoldPlay(false);
        haltMicrophone('background');
        abortRef.current?.abort();
        sessionRef.current?.stop();
        speakingRef.current = false;
        turnActiveRef.current = false;
        clearUserSpeaking();
        syncGameDuck();
        setState('idle');
      } else if (voiceHeldRef.current) {
        notePauseTrace('visibility_visible');
        setCompanionHoldPlay(true);
      }
    };
    const onPageHide = () => {
      haltMicrophone('pagehide');
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
  }, [clearUserSpeaking, enabled, bumpGeneration, gameId, haltMicrophone, iframeRef, notePauseTrace, syncGameDuck]);

  const playTurn = useCallback(
    async (intent: 'intro' | 'ask', transcript = '', source: TranscriptSource = 'unknown') => {
      if (!enabled) return;
      // The turn is in flight from here until the finally: the game stays
      // ducked through "thinking" so game audio can't fire a bogus turn
      // that aborts this one (the reported self-interrupt).
      turnActiveRef.current = true;
      syncGameDuck();
      const generation = generationRef.current;
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;
      sessionRef.current?.stop();
      speakingRef.current = false;
      // Intent only — the transcript itself never enters the exported log.
      voiceDebug('turn_start', intent);
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
      // Hoisted so the finally clause can cancel a partially-consumed PCM
      // stream when the try throws mid-stream.
      const pcmHold: { player: PcmStreamPlayer | null } = { player: null };
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
        voiceDebug('turn_fetch', `http_${response.status}`);
        let text = '';
        let meta: Record<string, unknown> | undefined;
        let audioRow: Record<string, unknown> | undefined;
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
        voiceDebug('turn_playback', `${playback} ${Date.now() - started}ms`);
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
        voiceDebug('turn_error', err instanceof Error ? err.message.slice(0, 80) : String(err).slice(0, 80));
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
        // If the stream threw between playPcmStream(gen).start() and
        // pcmHold.player.end(), the player is left with pcmActive=true and
        // handlers.onPlaying(false) never fires — so speakingRef stays true
        // and the next hands-free onText silently discards on line 383. Cancel
        // is a safe no-op on a player whose end() has already resolved (see
        // audio-session.ts::playPcmStream::cancel), so this runs on both the
        // success and error paths without cutting successful playback short.
        if (pcmHold.player) {
          try {
            pcmHold.player.cancel();
          } catch {
            /* already stopped */
          }
          pcmHold.player = null;
        }
        if (
          generation === generationRef.current &&
          voiceEnabledRef.current &&
          !mutedRef.current &&
          !speakingRef.current
        ) {
          // Half-duplex re-arm, after a guard window (see
          // VOICE_LISTEN_RESTART_GUARD_MS). If Rook is still speaking,
          // onPlaying(false) re-arms instead — never both, the helper
          // debounces.
          restartListeningSoon();
        }
        if (generation === generationRef.current) {
          turnActiveRef.current = false;
          syncGameDuck();
        }
      }
    },
    [enabled, gameId, iframeRef, restartListeningSoon, startHandsFree, syncGameDuck],
  );

  const playTurnRef = useRef(playTurn);
  playTurnRef.current = playTurn;

  const enableVoice = useCallback(() => {
    notePauseTrace('enable_voice');
    // Fresh voice session, fresh log: the next copy-debug paste tells the
    // story of THIS attempt, not yesterday's.
    clearVoiceDebugLog();
    voiceDebug('voice_enabled');
    setNeedsGesture(false);
    setMuted(false);
    mutedRef.current = false;
    setVoiceEnabled(true);
    voiceEnabledRef.current = true;
    setVoiceHold(true);
    attachNightclubFocusHold(iframeRef.current);
    setError(null);
    setHeardText('');
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
    handsFreeRef.current = false;
    setMenuOpen(false);
    setVoiceHold(false);
    bumpGeneration();
  }, [bumpGeneration, notePauseTrace, setVoiceHold]);

  const interruptSpeech = useCallback(() => {
    abortRef.current?.abort();
    sessionRef.current?.stop();
    speakingRef.current = false;
    turnActiveRef.current = false;
    syncGameDuck();
    setState(voiceEnabledRef.current && !mutedRef.current ? 'listening' : 'idle');
    if (voiceEnabledRef.current && !mutedRef.current) startHandsFree();
  }, [startHandsFree, syncGameDuck]);

  const onHoldStart = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!enabled || muted) {
      // A press that does nothing with no feedback reads as a dead button.
      // `enabled` false means the companion isn't active for this game at
      // all; muted is the actionable case.
      if (muted) setError('Microphone is muted. Unmute to talk.');
      return;
    }
    abortRef.current?.abort();
    sessionRef.current?.stop();
    speakingRef.current = false;
    haltMicrophone('ptt');
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
    // The user is holding the button to talk: duck the game for the
    // utterance. playTurn's turnActive takes over from the final result.
    markUserSpeaking();
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
      onListening: () => setMicPhase('hot'),
      onReconnecting: () => setMicPhase('reconnecting'),
      onError: (code) => {
        recRef.current = null;
        setMicPhase('off');
        setState('idle');
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          setError('Microphone stayed off until you allow it.');
        } else if (code === 'audio-capture') {
          setError('Microphone is unavailable.');
        } else if (code === 'start_failed') {
          setError('Could not start listening. Try again.');
        } else if (code !== 'aborted') {
          setError('I missed that. Hold to talk again.');
        }
      },
      onEnd: () => {
        recRef.current = null;
        setMicPhase('off');
        setState((prev) => (prev === 'listening' ? 'idle' : prev));
      },
    });
  }, [enableVoice, enabled, gameId, haltMicrophone, markUserSpeaking, muted, playTurn]);

  const onHoldEnd = useCallback(() => {
    recRef.current?.stop();
    recRef.current = null;
    // If no turn started, release the hold-duck; if one did, turnActive
    // keeps the game ducked.
    clearUserSpeaking();
    syncGameDuck();
  }, [clearUserSpeaking, syncGameDuck]);

  /* Whether a caption may be drawn over the stage at all — measured, not
     assumed. See lib/letterbox.ts: a build that fills the stage leaves no
     band, and an unreadable frame reads the same way, so the caption stays in
     the sheet rather than landing on live controls. */
  const [captionBand, setCaptionBand] = useState(0);
  useEffect(() => {
    if (!caption && !error) return;
    const measure = () => {
      const frame = iframeRef.current;
      const stage = frame?.parentElement ?? null;
      setCaptionBand(bottomBandOfFrame(frame, stage ? stage.clientHeight : 0));
    };
    measure();
    // A build can resize its own canvas mid-round (a cinematic, a pause
    // screen), so the band is re-read while a caption is up rather than once.
    const poll = window.setInterval(measure, 1000);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [caption, error, iframeRef]);

  /* The sheet gives its space back the moment attention returns to the game.
     Getting the signal right matters: the first version polled
     `document.activeElement` and closed when it was the iframe — but after any
     play the iframe already holds focus, so the sheet opened and shut itself
     inside 400ms and the controls were unreachable. A hosted run caught it.
     The signal is a *tap in the game*, read from the frame's own document
     (same-origin for everything we host), plus window blur and Escape. None of
     these touches the frame: companion state must never remount the game. */
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    let frameDoc: Document | null = null;
    try {
      frameDoc = iframeRef.current?.contentDocument ?? null;
    } catch {
      // Cross-origin: blur and Escape remain, which is the honest degradation.
      frameDoc = null;
    }
    frameDoc?.addEventListener('pointerdown', close, true);
    // A pointer that starts inside our own chrome is not attention returning
    // to the game, whatever else fires as a result of it.
    const guard = (e: Event) => {
      const target = e.target as Element | null;
      if (target?.closest?.('.rook-sheet, .player-sheet, .game-rail')) e.stopPropagation();
    };
    document.addEventListener('pointerdown', guard, true);
    return () => {
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', guard, true);
      try { frameDoc?.removeEventListener('pointerdown', close, true); } catch { /* frame gone */ }
    };
  }, [menuOpen, iframeRef]);

  if (!enabled) return null;

  /* One cell, one meaning. Voice off -> the tap turns it on, which is the only
     thing a first-time player needs. Voice on -> the tap opens the sheet, and
     everything else (mute, hold-to-talk, captions, volume, end) lives there.
     Interrupt is the exception: it rides the caption bubble, because the only
     moment you want it is the moment Rook is talking over you. */
  const speaking = state === 'speaking';

  /* Two labels, on purpose.
   *
   * `statusLabel` is what a screen reader hears and what the sheet header
   * shows: the full state, always, because a state nobody can perceive is not
   * a state. `cellLabel` is what the bar's 9px cap prints, and it stays put
   * while Rook works — the word "Thinking" appearing and vanishing under the
   * mark every turn was a second thing moving for no information the ribbon's
   * own processing animation does not already carry, right where the player
   * is trying to watch the game. Motion says busy; the label says which
   * control this is. Reduced motion is handled in the ribbon, which holds a
   * still frame per state rather than animating. */
  const statusLabel = muted
    ? 'Muted'
    : !voiceEnabled
      ? 'Voice'
      : speaking
        ? 'Speaking'
        : state === 'thinking'
          ? 'Thinking'
          // Label the recognizer's ACTUAL phase, not user intent. The
          // reported bug was "Listening" showing while the recognizer was
          // dead: startHandsFree sets state='listening' before the
          // recognizer exists, so `state === 'listening'` alone is not
          // proof of a live mic. Hands-free therefore says "Listening"
          // only after Chrome's onstart (micPhase === 'hot');
          // "Reconnecting…" during safeStart's backoff ladder; "Voice on"
          // while the mic is being requested or is intentionally down
          // between half-duplex turns. Push-to-talk keeps its own path:
          // the press itself starts a single utterance.
          : handsFree && micPhase === 'reconnecting'
            ? 'Reconnecting…'
            : handsFree
              ? micPhase === 'hot'
                ? 'Listening'
                : 'Voice on'
              : state === 'listening'
                ? 'Listening'
                : 'Voice on';
  const cellLabel = muted
    ? 'Muted'
    : !voiceEnabled
      ? 'Voice'
      : state === 'thinking' || speaking
        ? 'Rook'
        : 'Listening';
  const bubbleText = error || (captionsOn ? caption : '');
  const overlayAllowed = captionMayOverlay(captionBand);
  const showBubble = Boolean(bubbleText) && !menuOpen && overlayAllowed;

  /* The sheet opens into the player's overlay, closes on a tap in the game
     (window blur), on Escape and when focus returns to the frame. It is the
     only place Rook is allowed to take space. It also carries the caption
     whenever the stage has no measured room for one, so a player on a build
     that fills the screen can still read what was said. */
  const sheet = menuOpen ? (
    <div
      id="companion-more"
      className="rook-sheet"
      data-testid="companion-more"
      role="dialog"
      aria-label={`${name} controls`}
      onMouseDown={keepChromeFromStealingFocus}
    >
      <div className="rook-sheet-head">
        <span className="rook-sheet-name">{name}</span>
        <span className="rook-sheet-state">{statusLabel}</span>
        <button
          type="button"
          className="rook-sheet-close"
          tabIndex={-1}
          onClick={() => setMenuOpen(false)}
          aria-label="Close"
        >
          <CloseIcon />
        </button>
      </div>

      {bubbleText && !overlayAllowed ? (
        <p className="companion-caption rook-sheet-caption" role="status" data-testid="companion-sheet-caption">
          {bubbleText}
        </p>
      ) : null}

      {/* Live proof the mic hears you: interim speech-recognition text.
          If this never appears while the state says "Listening", the
          recognizer is silently dead — that mismatch is the bug. */}
      {state === 'listening' && heardText ? (
        <p className="rook-sheet-heard" role="status" data-testid="companion-heard">
          Hearing: &ldquo;{heardText}&rdquo;
        </p>
      ) : null}

          <div className="rook-sheet-row">
            <button
              type="button"
              className="rook-chip"
              data-testid="companion-mute"
              tabIndex={-1}
              onMouseDown={keepChromeFromStealingFocus}
              onClick={() => {
                setMuted((v) => {
                  const next = !v;
                  mutedRef.current = next;
                  if (next) {
                    haltMicrophone('mute');
                    sessionRef.current?.stop();
                    speakingRef.current = false;
                    turnActiveRef.current = false;
                    clearUserSpeaking();
                    setState('idle');
                  } else if (voiceEnabledRef.current) {
                    startHandsFree();
                  }
                  syncGameDuck();
                  return next;
                });
              }}
              aria-pressed={muted}
            >
              {muted ? <MicOffIcon /> : <MicIcon />}
              {muted ? 'Unmute' : 'Mute'}
            </button>

            <button
              type="button"
              className={`rook-chip${state === 'listening' && !handsFree ? ' is-hot' : ''}`}
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
              className="rook-chip"
              tabIndex={-1}
              onMouseDown={keepChromeFromStealingFocus}
              onClick={() => setCaptionsOn((v) => !v)}
              aria-pressed={captionsOn}
            >
              {captionsOn ? 'Captions on' : 'Captions off'}
            </button>

            {voiceEnabled ? (
              <button
                type="button"
                className="rook-chip"
                data-testid="companion-end-voice"
                tabIndex={-1}
                  onMouseDown={keepChromeFromStealingFocus}
                onClick={endVoice}
              >
                End
              </button>
            ) : null}

            {/* Diagnostics: copies the in-memory voice event log so a
                failed phone test arrives as data instead of a vibe. */}
            <button
              type="button"
              className="rook-chip"
              data-testid="companion-copy-debug"
              tabIndex={-1}
              onMouseDown={keepChromeFromStealingFocus}
              onClick={() => {
                const log = getVoiceDebugLog();
                const done = () => {
                  setDebugCopied(true);
                  window.setTimeout(() => setDebugCopied(false), 1500);
                };
                if (navigator.clipboard?.writeText) {
                  navigator.clipboard.writeText(log).then(done, done);
                } else {
                  done();
                }
              }}
            >
              {debugCopied ? 'Copied' : 'Copy debug log'}
            </button>
          </div>

          <label className="rook-vol">
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

      <span className="sr-only">
        Spoken companion for {gameName}. Hands-free talk is on while voice is enabled; hold to talk stays as a fallback.
      </span>
    </div>
  ) : null;

  const overlay = overlayRef?.current ?? null;

  const bubble = showBubble ? (
    <div className={`rook-bubble${error ? ' is-error' : ''}`} data-testid="companion-bubble">
      <p className="companion-caption" role="status">{bubbleText}</p>
      {speaking ? (
        <button
          type="button"
          className="rook-bubble-stop"
          data-testid="companion-stop"
          tabIndex={-1}
          onMouseDown={keepChromeFromStealingFocus}
          onClick={interruptSpeech}
          aria-label="Interrupt"
        >
          <StopIcon />
        </button>
      ) : null}
    </div>
  ) : null;

  return (
    <>
      {/* Transient chrome is painted into the player's overlay node, not into
          the bar: `.game-rail` is positioned and scrolls, so a child absolutely
          positioned against it is clipped to the bar on a desktop rail. */}
      {overlay && bubble ? createPortal(bubble, overlay) : null}

      <button
        type="button"
        className={`rail-btn rook-cell companion-${state}${voiceEnabled ? ' is-voice-on' : ''}${muted ? ' is-muted' : ''}`}
        data-testid={voiceEnabled ? 'companion-menu' : 'companion-enable-voice'}
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
        data-companion-layout="cell"
        data-companion-surface={surface}
        data-game={gameId}
        aria-expanded={voiceEnabled ? menuOpen : undefined}
        aria-controls={voiceEnabled ? 'companion-more' : undefined}
        aria-label={voiceEnabled ? `${name} settings` : `Turn on ${name}`}
        tabIndex={-1}
        onMouseDown={keepChromeFromStealingFocus}
        onClick={() => {
          if (needsGesture || !voiceEnabled) {
            void enableVoice();
            return;
          }
          setMenuOpen((open) => !open);
        }}
      >
        <span className="rook-mark" data-testid="companion-presence" aria-hidden="true">
          <CompanionRibbon
            state={muted ? 'idle' : state}
            muted={muted}
            levelRef={speechLevelRef}
            speechReactive={speechReactive}
          />
        </span>
        <span className="rail-cap" data-testid="companion-voice-state" data-state-label={statusLabel}>
          {cellLabel}
        </span>
        {/* The full state, announced but never printed in the bar. */}
        <span className="sr-only" role="status" aria-live="polite">{statusLabel}</span>
      </button>

      {overlay && sheet ? createPortal(sheet, overlay) : null}
    </>
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

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
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
