/**
 * Browser speech fallback and push-to-talk transcription.
 * Web Speech API is the default STT so this feature does not require a
 * new paid transcription service. Azure pronunciation assessment is unused.
 */

export type BrowserRecognition = {
  start: () => void;
  stop: () => void;
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
  return {
    start: () => rec.start(),
    stop: () => {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}

export function browserSpeechSynthesisAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
}
