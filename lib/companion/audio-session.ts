/**
 * Client audio-session manager (Little Chapters pattern).
 * Speaking state follows actual playback, not a timer.
 *
 * Incremental PCM uses Web Audio scheduled buffers. MPEG/WAV blob and
 * speechSynthesis remain compatible fallbacks. The companion never ducks
 * its own output; game-audio ducking during voice turns is handled
 * in-frame by the injected shim (lib/game-audio-duck.ts), driven by the
 * voice-turn lifecycle in components/GameCompanion.tsx.
 */

import { BROWSER_SPEECH_PITCH, BROWSER_SPEECH_RATE } from './providers.ts';
import {
  PCM_16000_RATE,
  PCM_CHANNELS,
  bytesAsBlobPart,
  concatBytes,
  pcmS16leToFloat32,
  pcmS16leToWav,
  rmsPcmS16le,
} from './pcm.ts';

/**
 * Soft output cap. Isolated preview-origin TTS previously clipped the Pulse
 * recorder at 32768. That was capture/TTS-chain saturation (speech-dispatcher
 * + null-sink), not HTMLAudioElement distortion — browser speech never uses
 * the audio element. MPEG playback uses this same cap so a hot file cannot
 * sit at element volume 1.0.
 */
export const COMPANION_OUTPUT_GAIN = 0.65;

export type CompanionPlaybackState = 'idle' | 'playing' | 'blocked';
export type CompanionPlaybackMode = 'incremental' | 'blob' | 'browser';
export type CompanionSpeechReactive = 'audio' | 'playback' | 'none';

export type PcmStreamPlayer = {
  start: (info: { sampleRate?: number; channels?: number }) => void;
  append: (pcmS16le: Uint8Array) => void;
  end: () => Promise<CompanionPlaybackState>;
  cancel: () => void;
};

export type CompanionAudioSession = {
  unlock: () => Promise<void>;
  playPcmStream: (generation: number) => PcmStreamPlayer;
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

function AudioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { webkitAudioContext?: typeof AudioContext };
  return window.AudioContext || w.webkitAudioContext || null;
}

export function createCompanionAudioSession(handlers: {
  currentGeneration: () => number;
  onPlaying: (playing: boolean) => void;
  onOnset?: (at: number) => void;
  onLevel?: (level: number) => void;
  onPlaybackMode?: (mode: CompanionPlaybackMode, reactive: CompanionSpeechReactive) => void;
}): CompanionAudioSession {
  const audio = typeof Audio === 'undefined' ? null : new Audio();
  let objectUrl: string | null = null;
  let muted = false;
  let volume = COMPANION_OUTPUT_GAIN;
  let utterance: SpeechSynthesisUtterance | null = null;
  let ctx: AudioContext | null = null;
  let gain: GainNode | null = null;
  let pcmSources: AudioBufferSourceNode[] = [];
  let pcmNextTime = 0;
  let pcmLeftover = new Uint8Array(0);
  let pcmActive = false;

  function reportLevel(level: number) {
    handlers.onLevel?.(Math.max(0, Math.min(1, level)));
  }

  function clearObjectUrl() {
    if (!objectUrl) return;
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  function cappedVolume() {
    return Math.min(COMPANION_OUTPUT_GAIN, Math.max(0, volume));
  }

  function syncAudio() {
    if (!audio) return;
    audio.muted = muted;
    audio.volume = cappedVolume();
    if (gain) gain.gain.value = muted ? 0 : cappedVolume();
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

  function stopPcm() {
    for (const source of pcmSources) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
      try {
        source.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    pcmSources = [];
    pcmNextTime = 0;
    pcmLeftover = new Uint8Array(0);
    pcmActive = false;
  }

  function stop() {
    stopPcm();
    resetElement();
    stopSpeech();
    clearObjectUrl();
    reportLevel(0);
    handlers.onPlaying(false);
  }

  async function ensureContext(): Promise<AudioContext | null> {
    const Ctor = AudioContextCtor();
    if (!Ctor) return null;
    if (!ctx) {
      try {
        ctx = new Ctor();
        gain = ctx.createGain();
        gain.gain.value = muted ? 0 : cappedVolume();
        gain.connect(ctx.destination);
      } catch {
        ctx = null;
        gain = null;
        return null;
      }
    }
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        return null;
      }
    }
    return ctx;
  }

  if (audio) {
    audio.addEventListener('playing', () => {
      handlers.onOnset?.(Date.now());
      handlers.onPlaying(true);
    });
    audio.addEventListener('pause', () => {
      if (!pcmActive) handlers.onPlaying(false);
    });
    audio.addEventListener('ended', () => {
      if (!pcmActive) handlers.onPlaying(false);
      clearObjectUrl();
      reportLevel(0);
    });
    audio.addEventListener('emptied', () => {
      if (!pcmActive) handlers.onPlaying(false);
    });
    audio.addEventListener('error', () => {
      if (!pcmActive) handlers.onPlaying(false);
      clearObjectUrl();
    });
  }

  return {
    async unlock() {
      await ensureContext();
      if (!audio) return;
      try {
        const silent = pcmS16leToWav(new Uint8Array(2), PCM_16000_RATE, PCM_CHANNELS);
        const blob = new Blob([bytesAsBlobPart(silent)], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        audio.src = url;
        audio.muted = true;
        await audio.play().catch(() => undefined);
        audio.pause();
        audio.muted = muted;
        audio.removeAttribute('src');
        audio.load();
        URL.revokeObjectURL(url);
      } catch {
        /* unlock is best-effort */
      }
    },
    playPcmStream(generation) {
      stopSpeech();
      resetElement();
      clearObjectUrl();
      stopPcm();
      pcmActive = true;
      let sampleRate = PCM_16000_RATE;
      let channels = PCM_CHANNELS;
      let onset = false;
      let finished: ((state: CompanionPlaybackState) => void) | null = null;
      const ended = new Promise<CompanionPlaybackState>((resolve) => {
        finished = resolve;
      });
      const finish = (state: CompanionPlaybackState) => {
        finished?.(state);
        finished = null;
      };

      const schedule = (pcm: Uint8Array) => {
        if (!ctx || !gain || generation !== handlers.currentGeneration()) return;
        const floats = Float32Array.from(pcmS16leToFloat32(pcm));
        if (!floats.length) return;
        const buffer = ctx.createBuffer(channels, floats.length, sampleRate);
        buffer.copyToChannel(floats, 0);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(gain);
        const now = ctx.currentTime;
        if (pcmNextTime < now + 0.02) pcmNextTime = now + 0.02;
        const startAt = pcmNextTime;
        pcmNextTime += buffer.duration;
        source.onended = () => {
          pcmSources = pcmSources.filter((item) => item !== source);
          if (!pcmSources.length && !pcmActive) {
            reportLevel(0);
            handlers.onPlaying(false);
            finish('playing');
          }
        };
        try {
          source.start(startAt);
        } catch {
          finish('blocked');
          return;
        }
        pcmSources.push(source);
        if (!onset) {
          onset = true;
          const delayMs = Math.max(0, (startAt - now) * 1000);
          setTimeout(() => {
            if (generation !== handlers.currentGeneration()) return;
            handlers.onOnset?.(Date.now());
            handlers.onPlaying(true);
            finish('playing');
          }, delayMs);
        }
      };

      return {
        start(info) {
          if (typeof info.sampleRate === 'number' && info.sampleRate > 0) sampleRate = info.sampleRate;
          if (info.channels === 1) channels = 1;
          handlers.onPlaybackMode?.('incremental', 'audio');
          void ensureContext();
        },
        append(pcmS16le) {
          if (generation !== handlers.currentGeneration()) return;
          const merged = pcmLeftover.byteLength
            ? concatBytes([pcmLeftover, pcmS16le])
            : pcmS16le;
          const aligned = merged.byteLength - (merged.byteLength % 2);
          pcmLeftover = aligned < merged.byteLength ? new Uint8Array(merged.subarray(aligned)) : new Uint8Array(0);
          if (aligned < 2) return;
          const slice = new Uint8Array(merged.subarray(0, aligned));
          reportLevel(rmsPcmS16le(slice));
          if (!ctx || !gain) {
            void ensureContext().then((ready) => {
              if (ready && generation === handlers.currentGeneration()) schedule(slice);
            });
            return;
          }
          schedule(slice);
        },
        async end() {
          pcmActive = false;
          if (generation !== handlers.currentGeneration()) {
            stopPcm();
            return 'idle';
          }
          if (!onset) {
            if (pcmLeftover.byteLength >= 2 && ctx) schedule(pcmLeftover);
            pcmLeftover = new Uint8Array(0);
          }
          if (!onset) {
            reportLevel(0);
            handlers.onPlaying(false);
            return 'blocked';
          }
          if (!pcmSources.length) {
            reportLevel(0);
            return 'playing';
          }
          return ended;
        },
        cancel() {
          pcmActive = false;
          stopPcm();
          reportLevel(0);
          handlers.onPlaying(false);
          finish('idle');
        },
      };
    },
    async play(src, generation) {
      if (!audio) return 'blocked';
      stopSpeech();
      stopPcm();
      resetElement();
      clearObjectUrl();
      handlers.onPlaybackMode?.('blob', 'playback');
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
      stopPcm();
      stopSpeech();
      handlers.onPlaybackMode?.('browser', 'playback');
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
        next.volume = muted ? 0 : cappedVolume();
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
          handlers.onOnset?.(Date.now());
          handlers.onPlaying(true);
          finish('playing');
        };
        next.onend = () => {
          handlers.onPlaying(false);
          reportLevel(0);
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
      if (ctx) {
        void ctx.close().catch(() => undefined);
        ctx = null;
        gain = null;
      }
    },
  };
}
