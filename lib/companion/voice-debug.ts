/**
 * Voice debug log: a tiny in-memory ring buffer of voice-pipeline events.
 *
 * Why this exists: the hands-free voice loop (speech recognition → turn →
 * TTS → mic re-arm) fails only on real phones — iOS Safari's
 * webkitSpeechRecognition can't be exercised from a VM with no mic. When
 * Jayme reports "Rook didn't respond", code review can't tell whether the
 * recognizer never delivered a result, the fetch failed, or TTS never
 * ended. This log records the pipeline's actual event trail with relative
 * timestamps; the Rook panel's "Copy debug log" button puts it on the
 * clipboard so a failed phone test arrives as data instead of a vibe.
 *
 * Deliberately not persisted and not sent anywhere automatically — the
 * user copies it explicitly.
 */

export type VoiceDebugEvent = {
  /** ms since epoch, for relative rendering */
  t: number;
  name: string;
  detail?: string;
};

const MAX_EVENTS = 80;

const events: VoiceDebugEvent[] = [];

export function voiceDebug(name: string, detail?: string): void {
  events.push({ t: Date.now(), name, detail });
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
}

export function clearVoiceDebugLog(): void {
  events.length = 0;
}

/** Number of events currently buffered (for tests). */
export function voiceDebugCount(): number {
  return events.length;
}

/**
 * Human-readable log, one event per line, timestamps relative to the
 * first buffered event so a pasted log reads as a timeline.
 */
export function getVoiceDebugLog(): string {
  if (!events.length) return '(voice log empty)';
  const start = events[0].t;
  return events
    .map((e) => {
      const rel = ((e.t - start) / 1000).toFixed(1);
      return `+${rel}s ${e.name}${e.detail ? ` ${e.detail}` : ''}`;
    })
    .join('\n');
}
