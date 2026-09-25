/**
 * Browser speech fallback and push-to-talk transcription.
 * Web Speech API is the default STT so this feature does not require a
 * new paid transcription service. Azure pronunciation assessment is unused.
 *
 * Little Chapters notes that microphone capture can continue while
 * backgrounded. InZone must abort the recognizer on hide/unmount — stop()
 * alone is not treated as a guarantee.
 */

export type BrowserRecognition = {
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript?: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

/**
 * Errors that mean the mic will not come back on this recognizer. On these,
 * the loop halts and refuses to restart, so the caller's error UI (permission
 * prompt, device chooser, hardware error) reaches the user once instead of
 * flooding.
 */
const TERMINAL_ERROR_CODES = new Set(['not-allowed', 'service-not-allowed', 'audio-capture']);

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function browserSpeechRecognitionAvailable(): boolean {
  return recognitionCtor() !== null;
}

function detach(rec: SpeechRecognitionLike) {
  rec.onresult = null;
  rec.onerror = null;
  rec.onend = null;
  rec.onstart = null;
}

export function startBrowserRecognition(handlers: {
  onText: (text: string) => void;
  onError: (code: string) => void;
  onEnd: () => void;
  /**
   * Fires when an interim (non-final) result carries speech — i.e. the
   * user has audibly started talking, before any final transcript.
   * Callers use it to duck game audio the moment speech begins rather
   * than waiting for the final result. Only fires when interimResults
   * is on (hands-free continuous mode); push-to-talk never emits it.
   */
  onSpeechStart?: () => void;
  /**
   * Fires when Chrome's `onstart` event actually reaches us — the mic is
   * hot. Callers should drive their "Listening" indicator from this and
   * `onReconnecting`, not from a "user wants voice on" flag, so the label
   * matches the recognizer's real state.
   */
  onListening?: () => void;
  /**
   * Fires when a start attempt failed and `safeStart` has scheduled a
   * retry. Callers should drop the "Listening" label to something like
   * "Reconnecting…" until the next `onListening` clears it.
   */
  onReconnecting?: () => void;
  /** Hands-free: keep listening and emit each final phrase. */
  continuous?: boolean;
}): BrowserRecognition | null {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    handlers.onError('unavailable');
    return null;
  }
  const rec = new Ctor();
  const continuous = handlers.continuous === true;
  rec.lang = 'en-US';
  rec.interimResults = continuous;
  rec.continuous = continuous;
  rec.maxAlternatives = 1;
  let halted = false;
  // Set true on terminal errors (permission denied, hardware unavailable).
  // Prevents `onend` from queuing another restart that would fail the same
  // way and either loop or spam the caller's error UI.
  let terminalError = false;
  // Every pending retry timer, so abort()/stop() can cancel them and no
  // late setTimeout callback wakes up and starts the recognizer after the
  // caller thought it had stopped.
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  // Debounce `onReconnecting`: we fire it once when a retry ladder starts,
  // not per attempt inside the same ladder. Cleared when a start succeeds.
  let announcedReconnecting = false;

  /**
   * Chrome's SpeechRecognition throws `InvalidStateError` on start() when
   * the previous recognition instance's mic device hasn't fully released.
   * This is the reported symptom of the reported listen-loop bug: Rook
   * responds once, then "Listening" stays on-screen but nothing more
   * reaches onText because a synchronous throw silently killed the
   * recognizer without notifying the caller.
   *
   * Fix: retry with backoff. If start ultimately fails, surface
   * `start_failed` so the UI can reset `handsFree` and drop the state
   * back to idle instead of showing a false "Listening" chip.
   *
   * Delays are cumulative: 0, 60, 120, 240, 480, 800 → ~1.7s total. In
   * practice Chrome releases within ~100ms after an onend, so the first
   * retry usually succeeds. The initial attempt is synchronous to keep
   * the happy-path latency unchanged.
   */
  const START_BACKOFF_MS = [0, 60, 120, 240, 480, 800] as const;
  function safeStart(): void {
    if (halted) return;
    let idx = 0;
    const attempt = () => {
      if (halted) return;
      try {
        rec.start();
      } catch {
        if (idx >= START_BACKOFF_MS.length - 1) {
          if (!halted) handlers.onError('start_failed');
          return;
        }
        idx += 1;
        // The first scheduled retry is the moment the caller should switch
        // its "Listening" chip to "Reconnecting…". Fire it once per ladder.
        if (!announcedReconnecting) {
          announcedReconnecting = true;
          if (!halted) handlers.onReconnecting?.();
        }
        const t = setTimeout(() => {
          pendingTimers.delete(t);
          attempt();
        }, START_BACKOFF_MS[idx]);
        pendingTimers.add(t);
      }
    };
    attempt();
  }

  rec.onresult = (event) => {
    const results = event.results;
    if (!results) return;
    const last = results[results.length - 1];
    const text = last?.[0]?.transcript?.trim() || '';
    const isFinal = Boolean(last && 'isFinal' in last ? (last as { isFinal?: boolean }).isFinal : true);
    if (!isFinal) {
      // The user is audibly mid-utterance. Not a turn yet — just the
      // signal to duck the game so the rest of the utterance (and Rook's
      // reply) isn't fighting game audio.
      if (text) handlers.onSpeechStart?.();
      return;
    }
    if (text && isFinal) handlers.onText(text);
  };
  rec.onerror = (event) => {
    const code = event.error || 'recognition_error';
    if (code === 'aborted' || halted) return;
    if (continuous && (code === 'no-speech' || code === 'network')) return;
    if (TERMINAL_ERROR_CODES.has(code)) {
      // No more restarts — the mic will not come back on this recognizer.
      // Setting halted is enough to also prevent a late onend from queuing
      // a fresh start. The caller (GameCompanion.onError) already knows how
      // to show the permission-denied message and clear handsFree.
      terminalError = true;
      halted = true;
      for (const t of pendingTimers) clearTimeout(t);
      pendingTimers.clear();
    }
    handlers.onError(code);
  };
  rec.onstart = () => {
    if (halted) return;
    // A real start reached us. Clear the reconnecting debounce so a future
    // ladder can announce reconnection again.
    announcedReconnecting = false;
    handlers.onListening?.();
  };
  rec.onend = () => {
    if (halted || terminalError) {
      handlers.onEnd();
      return;
    }
    if (continuous) {
      // Same backoff path as the initial start: Chrome may still be
      // releasing the mic when onend fires (especially back-to-back
      // after a short utterance). Never throw synchronously here — a
      // silent throw was the original bug.
      safeStart();
      return;
    }
    handlers.onEnd();
  };
  safeStart();

  const halt = (hard: boolean) => {
    halted = true;
    for (const t of pendingTimers) clearTimeout(t);
    pendingTimers.clear();
    detach(rec);
    try {
      if (hard && typeof rec.abort === 'function') rec.abort();
      else rec.stop();
    } catch {
      /* already stopped */
    }
  };

  return {
    start: () => rec.start(),
    stop: () => halt(false),
    abort: () => halt(true),
  };
}

export function browserSpeechSynthesisAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
}
