/**
 * Client audio-session manager (Little Chapters pattern).
 * Speaking state follows the HTMLAudioElement, not a timer.
 */

export type CompanionPlaybackState = 'idle' | 'playing' | 'blocked';

export type CompanionAudioSession = {
  play: (src: string | Blob, generation: number) => Promise<CompanionPlaybackState>;
  speakBrowser: (text: string, generation: number) => Promise<CompanionPlaybackState>;
  stop: () => void;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  dispose: () => void;
};

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
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  function syncAudio() {
    if (!audio) return;
    audio.muted = muted;
    audio.volume = Math.min(1, Math.max(0, volume));
  }

  function stopSpeech() {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    utterance = null;
  }

  function stop() {
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    stopSpeech();
    clearObjectUrl();
    handlers.onPlaying(false);
  }

  if (audio) {
    audio.addEventListener('playing', () => handlers.onPlaying(true));
    audio.addEventListener('pause', () => handlers.onPlaying(false));
    audio.addEventListener('ended', () => handlers.onPlaying(false));
    audio.addEventListener('emptied', () => handlers.onPlaying(false));
  }

  return {
    async play(src, generation) {
      if (!audio) return 'blocked';
      stopSpeech();
      clearObjectUrl();
      const url = typeof src === 'string' ? src : URL.createObjectURL(src);
      if (typeof src !== 'string') objectUrl = url;
      audio.src = url;
      syncAudio();
      try {
        await audio.play();
        if (generation !== handlers.currentGeneration()) {
          stop();
          return 'idle';
        }
        return audio.paused ? 'blocked' : 'playing';
      } catch {
        handlers.onPlaying(false);
        return 'blocked';
      }
    },
    async speakBrowser(text, generation) {
      if (typeof speechSynthesis === 'undefined') return 'blocked';
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
      }
      clearObjectUrl();
      stopSpeech();
      return await new Promise<CompanionPlaybackState>((resolve) => {
        const next = new SpeechSynthesisUtterance(text);
        next.volume = muted ? 0 : Math.min(1, Math.max(0, volume));
        next.onstart = () => {
          if (generation !== handlers.currentGeneration()) {
            speechSynthesis.cancel();
            resolve('idle');
            return;
          }
          handlers.onPlaying(true);
        };
        next.onend = () => {
          handlers.onPlaying(false);
          resolve('idle');
        };
        next.onerror = () => {
          handlers.onPlaying(false);
          resolve('blocked');
        };
        utterance = next;
        try {
          speechSynthesis.speak(next);
        } catch {
          handlers.onPlaying(false);
          resolve('blocked');
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
