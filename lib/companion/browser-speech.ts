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
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

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
}

export function startBrowserRecognition(handlers: {
  onText: (text: string) => void;
  onError: (code: string) => void;
  onEnd: () => void;
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
        setTimeout(attempt, START_BACKOFF_MS[idx]);
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
    if (text && isFinal) handlers.onText(text);
  };
  rec.onerror = (event) => {
    const code = event.error || 'recognition_error';
    if (code === 'aborted' || halted) return;
    if (continuous && (code === 'no-speech' || code === 'network')) return;
    handlers.onError(code);
  };
  rec.onend = () => {
    if (halted) {
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
