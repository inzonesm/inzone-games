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
}): BrowserRecognition | null {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    handlers.onError('unavailable');
    return null;
  }
  const rec = new Ctor();
  rec.lang = 'en-US';
  rec.interimResults = false;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  rec.onresult = (event) => {
    const text = event.results?.[0]?.[0]?.transcript?.trim() || '';
    if (text) handlers.onText(text);
  };
  rec.onerror = (event) => handlers.onError(event.error || 'recognition_error');
  rec.onend = () => handlers.onEnd();
  rec.start();

  const halt = (hard: boolean) => {
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
