/**
 * Client audio-session manager (Little Chapters pattern).
 * Speaking state follows the HTMLAudioElement, not a timer.
 *
 * Ducking is intentionally omitted: Little Chapters only ducks its own
 * theme/ambience elements. Companion speech must not mute game audio,
 * music, or UI effects.
 */

import { BROWSER_SPEECH_PITCH, BROWSER_SPEECH_RATE } from './providers.ts';

export type CompanionPlaybackState = 'idle' | 'playing' | 'blocked';

export type CompanionAudioSession = {
  play: (src: string | Blob, generation: number) => Promise<CompanionPlaybackState>;
  speakBrowser: (text: string, generation: number) => Promise<CompanionPlaybackState>;
  stop: () => void;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  dispose: () => void;
};

function whenVoicesReady(): Promise<void> {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve();
  if (speechSynthesis.getVoices().length > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 600);
  });
}

export function createCompanionAudioSession(handlers: {
  currentGeneration: () => number;
  onPlaying: (playing: boolean) => void;
}): CompanionAudioSession {
  const audio = typeof Audio === 'undefined' ? null : new Audio();
  let objectUrl: string | null = null;
  let muted = false;
  let volume = 0.85;
  let utterance: SpeechSynthesisUtterance | null = null;

  function clearObjectUrl() {
    if (!objectUrl) return;
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  function syncAudio() {
    if (!audio) return;
    audio.muted = muted;
    audio.volume = Math.min(1, Math.max(0, volume));
  }

  function resetElement() {
    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }

  function stopSpeech() {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    utterance = null;
  }

  function stop() {
    resetElement();
    stopSpeech();
    clearObjectUrl();
    handlers.onPlaying(false);
  }

  if (audio) {
    audio.addEventListener('playing', () => handlers.onPlaying(true));
    audio.addEventListener('pause', () => handlers.onPlaying(false));
    audio.addEventListener('ended', () => {
      handlers.onPlaying(false);
      clearObjectUrl();
    });
    audio.addEventListener('emptied', () => handlers.onPlaying(false));
    audio.addEventListener('error', () => {
      handlers.onPlaying(false);
      clearObjectUrl();
    });
  }

  return {
    async play(src, generation) {
      if (!audio) return 'blocked';
      stopSpeech();
      resetElement();
      clearObjectUrl();
      const created = typeof src !== 'string';
      const url = created ? URL.createObjectURL(src) : src;
      if (created) objectUrl = url;
      audio.src = url;
      syncAudio();
      try {
        await audio.play();
        if (generation !== handlers.currentGeneration()) {
          stop();
          return 'idle';
        }
        if (audio.paused) {
          if (created) clearObjectUrl();
          return 'blocked';
        }
        return 'playing';
      } catch {
        if (created) clearObjectUrl();
        handlers.onPlaying(false);
        return 'blocked';
      }
    },
    async speakBrowser(text, generation) {
      if (typeof speechSynthesis === 'undefined') return 'blocked';
      resetElement();
      clearObjectUrl();
      stopSpeech();
      await whenVoicesReady();
      if (generation !== handlers.currentGeneration()) return 'idle';
      return await new Promise<CompanionPlaybackState>((resolve) => {
        let settled = false;
        const finish = (state: CompanionPlaybackState) => {
          if (settled) return;
          settled = true;
          clearTimeout(startTimer);
          resolve(state);
        };
        const next = new SpeechSynthesisUtterance(text);
        next.rate = BROWSER_SPEECH_RATE;
        next.pitch = BROWSER_SPEECH_PITCH;
        next.volume = muted ? 0 : Math.min(1, Math.max(0, volume));
        next.lang = 'en-US';
        const startTimer = setTimeout(() => {
          if (generation !== handlers.currentGeneration()) {
            speechSynthesis.cancel();
            finish('idle');
            return;
          }
          handlers.onPlaying(false);
          finish('blocked');
        }, 2500);
        next.onstart = () => {
          if (generation !== handlers.currentGeneration()) {
            speechSynthesis.cancel();
            handlers.onPlaying(false);
            finish('idle');
            return;
          }
          handlers.onPlaying(true);
          finish('playing');
        };
        next.onend = () => {
          handlers.onPlaying(false);
          utterance = null;
        };
        next.onerror = () => {
          handlers.onPlaying(false);
          utterance = null;
          finish('blocked');
        };
        utterance = next;
        try {
          speechSynthesis.speak(next);
        } catch {
          handlers.onPlaying(false);
          finish('blocked');
        }
      });
    },
    stop,
    setMuted(next) {
      muted = next;
      syncAudio();
      if (utterance) utterance.volume = muted ? 0 : volume;
    },
    setVolume(next) {
      volume = next;
      syncAudio();
      if (utterance && !muted) utterance.volume = volume;
    },
    dispose() {
      stop();
    },
  };
}
