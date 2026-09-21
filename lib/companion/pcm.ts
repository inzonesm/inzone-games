/**
 * PCM helpers for incremental companion playback.
 * ElevenLabs `pcm_16000` is signed 16-bit little-endian mono.
 */

export const PCM_S16LE = 'pcm_s16le';
export const PCM_16000_RATE = 16_000;
export const PCM_CHANNELS = 1;

export function bytesAsBlobPart(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function decodeBase64Bytes(data: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(data, 'base64'));
  const binary = atob(data);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/** Root-mean-square of s16le samples, 0..1. Odd trailing bytes are ignored. */
export function rmsPcmS16le(pcm: Uint8Array): number {
  const bytes = pcm.byteLength - (pcm.byteLength % 2);
  if (bytes < 2) return 0;
  const view = new DataView(pcm.buffer, pcm.byteOffset, bytes);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < bytes; i += 2) {
    const sample = view.getInt16(i, true) / 32768;
    sum += sample * sample;
    n += 1;
  }
  return n ? Math.sqrt(sum / n) : 0;
}

export function pcmS16leToFloat32(pcm: Uint8Array): Float32Array {
  const samples = Math.floor(pcm.byteLength / 2);
  const view = new DataView(pcm.buffer, pcm.byteOffset, samples * 2);
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

/** Compatible HTMLAudioElement fallback when Web Audio incremental play is unavailable. */
export function pcmS16leToWav(
  pcm: Uint8Array,
  sampleRate = PCM_16000_RATE,
  channels = PCM_CHANNELS,
): Uint8Array {
  const aligned = pcm.byteLength - (pcm.byteLength % 2);
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + aligned, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, aligned, true);
  const out = new Uint8Array(44 + aligned);
  out.set(new Uint8Array(header), 0);
  out.set(pcm.subarray(0, aligned), 44);
  return out;
}

export function smoothSpeechEnvelope(
  current: number,
  target: number,
  dtSeconds: number,
  attackMs: number,
  releaseMs: number,
): number {
  const ms = target > current ? attackMs : releaseMs;
  const coeff = 1 - Math.exp(-Math.max(0, dtSeconds) / Math.max(0.001, ms / 1000));
  return current + (target - current) * coeff;
}
