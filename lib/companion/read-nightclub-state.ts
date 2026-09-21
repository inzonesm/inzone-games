/**
 * Same-origin peek of Nightclub v2. Fields are untrusted.
 * Returns null when the iframe is not the inspected v2 path or the bridge
 * is missing. Never reads chat or unrelated page content.
 */

import { isNightclubV2Path } from '../nightclub-gameplay-adapter.ts';

export type NightclubHostPeek = {
  observedAt: number;
  raw: Record<string, unknown>;
};

export function readNightclubHostState(frame: HTMLIFrameElement | null): NightclubHostPeek | null {
  if (!frame) return null;
  try {
    const win = frame.contentWindow as
      | (Window & {
          NightclubBridge?: { getState?: () => Record<string, unknown> };
          __NightclubRuntime?: {
            Game?: { ME?: { hero?: { ammo?: unknown }; hasCinematic?: () => boolean } };
            Main?: { ME?: { paused?: unknown } };
          };
        })
      | null;
    if (!win) return null;
    const pathname = win.location?.pathname;
    if (pathname && !isNightclubV2Path(pathname)) return null;
    if (!win.NightclubBridge || typeof win.NightclubBridge.getState !== 'function') return null;
    const raw = win.NightclubBridge.getState() || {};
    const game = win.__NightclubRuntime?.Game?.ME;
    const main = win.__NightclubRuntime?.Main?.ME;
    return {
      observedAt: Date.now(),
      raw: {
        runId: raw.runId,
        ended: raw.ended,
        outcome: raw.outcome,
        snapshot: raw.snapshot,
        ammo: game?.hero && typeof game.hero === 'object' ? (game.hero as { ammo?: unknown }).ammo : undefined,
        paused: main?.paused,
        cinematic: typeof game?.hasCinematic === 'function' ? game.hasCinematic() === true : undefined,
      },
    };
  } catch {
    return null;
  }
}
