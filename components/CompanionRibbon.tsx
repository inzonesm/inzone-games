'use client';

/**
 * Production ribbon using the approved expressive prototype math
 * (docs/rook-handoff/ribbon-renderer.js). Speaking pulse is the real
 * output envelope, not the demo sine. One renderer per player.
 */

import { useEffect, useRef } from 'react';
import type { CompanionSpeechReactive } from '@/lib/companion/audio-session';
import type { CompanionUiState } from '@/lib/companion/ui-state';
import { smoothSpeechEnvelope } from '@/lib/companion/pcm';

const DAMPING = 3.1;
const ATTACK_MS = 85;
const RELEASE_MS = 230;
const STATE_INDEX: Record<CompanionUiState, number> = {
  idle: 0,
  listening: 1,
  thinking: 2,
  speaking: 3,
};

type Props = {
  state: CompanionUiState;
  muted: boolean;
  levelRef: { current: number };
  speechReactive: CompanionSpeechReactive;
};

export function CompanionRibbon({ state, muted, levelRef, speechReactive }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const failedRef = useRef(false);
  const stateRef = useRef(state);
  const mutedRef = useRef(muted);
  const reactiveRef = useRef(speechReactive);
  stateRef.current = state;
  mutedRef.current = muted;
  reactiveRef.current = speechReactive;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const surface = canvas;
    const ctx = surface.getContext('2d');
    if (!ctx) {
      failedRef.current = true;
      return;
    }
    const brush = ctx;

    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let weights = [0, 0, 0, 0];
    weights[STATE_INDEX[stateRef.current]] = 1;
    let phase = 0;
    let twistPhase = 0;
    let last = 0;
    let envelope = 0;
    let frame = 0;
    let paused = reduced;
    let disposed = false;

    const io =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((entries) => {
            paused = reduced || document.hidden || entries.every((entry) => !entry.isIntersecting);
          })
        : null;
    io?.observe(surface);

    const onVisibility = () => {
      if (document.hidden) paused = true;
    };
    document.addEventListener('visibilitychange', onVisibility);

    function point(u: number, v: number, t: number, pulse: number): [number, number, number] {
      const w = weights;
      const action = w[3] * pulse;
      const flow = w[2] * Math.sin(t * 1.7);
      const r =
        0.96 +
        0.17 * Math.cos(3 * u + t * 0.12) +
        0.19 * action * Math.sin(2 * u + t * 0.6) +
        0.16 * w[2] * Math.sin(2 * u - t * 1.6);
      let x = r * Math.cos(u);
      let y = 0.76 * r * Math.sin(u);
      let z =
        0.28 * Math.sin(2 * u + t * 0.16) +
        0.22 * w[2] * Math.sin(3 * u - t * 1.4) +
        0.16 * action * Math.cos(2 * u);
      const width = 0.19 + 0.05 * Math.sin(u * 2 + 0.7) + 0.055 * w[3] * (0.5 + 0.5 * Math.sin(t * 5.6 - u * 2));
      const twist =
        1.5 * u + twistPhase + 0.32 * w[3] * Math.sin(t * 3.3 - u) + 0.3 * w[2] * Math.sin(t * 1.7 - u);
      x += v * width * Math.cos(twist) * Math.cos(u);
      y += v * width * Math.cos(twist) * Math.sin(u);
      z += v * width * Math.sin(twist);
      y *= 1 + w[1] * 0.24 + w[2] * 0.32 + action * 0.22 + 0.13 * flow;
      x *= 1 - w[2] * 0.18 + action * 0.16;
      y += w[1] * 0.07 * Math.cos(u);
      const az = -0.25 + w[2] * 0.28 * Math.sin(t * 1.1) + w[3] * 0.14 * Math.sin(t * 2.1) + 0.08 * Math.sin(t * 0.25);
      const ax = 0.63 + 0.08 * Math.sin(t * 0.2) + w[1] * 0.14;
      const xx = x * Math.cos(az) - y * Math.sin(az);
      const yy = x * Math.sin(az) + y * Math.cos(az);
      return [xx, yy * Math.cos(ax) - z * Math.sin(ax), yy * Math.sin(ax) + z * Math.cos(ax)];
    }

    function draw(t: number, isMuted: boolean) {
      const box = surface.getBoundingClientRect();
      const W = box.width;
      const H = box.height;
      if (!W || !H) return;
      const dpr = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2);
      if (surface.width !== Math.round(W * dpr) || surface.height !== Math.round(H * dpr)) {
        surface.width = Math.round(W * dpr);
        surface.height = Math.round(H * dpr);
      }
      brush.setTransform(dpr, 0, 0, dpr, 0, 0);
      brush.clearRect(0, 0, W, H);
      const size = Math.min(W, H) * 0.37;
      const cx = W * 0.5;
      const cy = H * 0.49;
      const glow = brush.createRadialGradient(cx, cy + size * 0.32, 0, cx, cy + size * 0.32, size * 1.65);
      glow.addColorStop(0, isMuted ? 'rgba(133,157,169,.035)' : 'rgba(120,198,228,.08)');
      glow.addColorStop(1, 'rgba(120,198,228,0)');
      brush.fillStyle = glow;
      brush.fillRect(0, 0, W, H);
      const pulse = speechPulse(weights[3], envelope, reactiveRef.current);
      const quads: { ps: [number, number, number][]; z: number; u: number; v: number }[] = [];
      const N = 90;
      const M = 7;
      for (let i = 0; i < N; i += 1) {
        const u = (i / N) * Math.PI * 2;
        const u2 = ((i + 1) / N) * Math.PI * 2;
        for (let j = 0; j < M; j += 1) {
          const v = (j / M) * 2 - 1;
          const v2 = ((j + 1) / M) * 2 - 1;
          const ps = [point(u, v, t, pulse), point(u2, v, t, pulse), point(u2, v2, t, pulse), point(u, v2, t, pulse)];
          quads.push({ ps, z: ps.reduce((sum, p) => sum + p[2], 0) / 4, u, v: (v + v2) / 2 });
        }
      }
      quads.sort((a, b) => a.z - b.z);
      for (const q of quads) {
        const p = q.ps;
        const a = p[1].map((value, i) => value - p[0][i]);
        const b = p[3].map((value, i) => value - p[0][i]);
        let normal = [
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ];
        const len = Math.hypot(normal[0], normal[1], normal[2]) || 1;
        normal = normal.map((value) => value / len);
        const light = Math.abs(normal[0] * -0.35 + normal[1] * -0.45 + normal[2] * 0.82);
        const spec = light ** 12;
        const edge = Math.abs(q.v) > 0.82;
        const base = 38 + light * 115 + spec * 90;
        const cyan = edge ? 24 : Math.max(0, Math.sin(q.u * 2 + t * 0.16)) * 12;
        brush.fillStyle = isMuted
          ? `rgb(${base * 0.6},${base * 0.65},${base * 0.69})`
          : `rgb(${Math.min(255, base - cyan * 0.9)},${Math.min(255, base + cyan * 0.5)},${Math.min(255, base + cyan + 12)})`;
        brush.beginPath();
        p.forEach((pt, i) => {
          const perspective = 1 / (1 - pt[2] * 0.12);
          const x = cx + pt[0] * size * perspective;
          const y = cy - pt[1] * size * perspective;
          if (i) brush.lineTo(x, y);
          else brush.moveTo(x, y);
        });
        brush.closePath();
        brush.fill();
        brush.strokeStyle = brush.fillStyle;
        brush.lineWidth = 0.45;
        brush.stroke();
      }
    }

    function tick(now: number) {
      if (disposed) return;
      const dt = Math.min((now - last) / 1000 || 0, 0.05);
      last = now;
      const liveMuted = mutedRef.current;
      const liveState = stateRef.current;
      const targetState = liveMuted ? 0 : STATE_INDEX[liveState];
      const hidden = typeof document !== 'undefined' && document.hidden;
      if (!paused && !hidden) {
        phase += dt;
        twistPhase += dt * (0.1 + weights[2] * 0.65);
      }
      const want = levelRef.current;
      envelope = smoothSpeechEnvelope(
        envelope,
        liveState === 'speaking' && !liveMuted ? want : 0,
        dt,
        ATTACK_MS,
        RELEASE_MS,
      );
      weights = weights.map((w, i) => {
        const target = liveMuted ? (i === 0 ? 1 : 0) : i === targetState ? 1 : 0;
        return w + (target - w) * (reduced ? 1 : 1 - Math.exp(-dt * DAMPING));
      });
      try {
        draw(phase, mutedRef.current);
      } catch {
        failedRef.current = true;
        return;
      }
      if (reduced) return;
      frame = requestAnimationFrame(tick);
    }

    if (reduced) {
      draw(0, mutedRef.current);
      return () => {
        disposed = true;
        io?.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
      };
    }
    frame = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      brush.setTransform(1, 0, 0, 1, 0, 0);
      brush.clearRect(0, 0, surface.width, surface.height);
    };
  }, [levelRef]);

  return (
    <canvas
      ref={canvasRef}
      className="companion-ribbon"
      data-testid="companion-ribbon"
      data-speech-reactive={speechReactive}
      width={90}
      height={90}
      aria-hidden="true"
    />
  );
}

function speechPulse(
  speakingWeight: number,
  envelope: number,
  reactive: CompanionSpeechReactive,
): number {
  if (speakingWeight <= 0.01) return 0;
  if (reactive === 'audio') return Math.max(0, Math.min(1, envelope));
  if (reactive === 'playback') return 0.22;
  return 0;
}
