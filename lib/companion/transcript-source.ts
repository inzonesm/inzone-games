/**
 * Honest labels for how a companion transcript was obtained.
 * A Fake SpeechRecognition constructor is simulated recognition, not a microphone.
 */

export type CompanionTranscriptSource =
  | 'injected'
  | 'microphone'
  | 'simulated_recognition'
  | 'unknown';

export function classifyTranscriptSource(input: {
  flagged?: string | null;
  simulatedCtor?: boolean;
  injected?: boolean;
  ctorName?: string | null;
}): CompanionTranscriptSource {
  if (input.flagged === 'injected' || input.injected) return 'injected';
  if (input.flagged === 'simulated_recognition') return 'simulated_recognition';
  if (input.simulatedCtor) return 'simulated_recognition';
  if (input.ctorName && /fake/i.test(input.ctorName)) return 'simulated_recognition';
  if (input.flagged === 'microphone') return 'microphone';
  if (input.flagged) return 'unknown';
  return 'microphone';
}

export function readBrowserTranscriptSource(): CompanionTranscriptSource {
  if (typeof window === 'undefined') return 'unknown';
  const w = window as Window & {
    __INZONE_TRANSCRIPT_SOURCE?: string;
    __INZONE_SIMULATED_RECOGNITION?: boolean;
    SpeechRecognition?: { __inzoneSimulated?: boolean; name?: string };
    webkitSpeechRecognition?: { __inzoneSimulated?: boolean; name?: string };
  };
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  return classifyTranscriptSource({
    flagged: w.__INZONE_TRANSCRIPT_SOURCE,
    simulatedCtor: Boolean(w.__INZONE_SIMULATED_RECOGNITION || Ctor?.__inzoneSimulated),
    ctorName: Ctor?.name ?? null,
  });
}
