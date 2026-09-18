/**
 * Per-game adapters that turn a build's own state into gameplay signals.
 *
 * Bucket-hosted games are served through our same-origin /gcs proxy, so the
 * host can read a build's state directly instead of waiting for the build to be
 * re-uploaded with a postMessage integration. That is not a workaround for a
 * missing signal — it is the same signal, read from the other side of a
 * same-origin boundary. Where a build keeps no authoritative state, there is no
 * adapter and no verified `game_start`: see lib/gameplay-signals.ts.
 *
 * Adding a game here is a deliberate act. It requires reading that build and
 * naming the exact field the signal comes from, because every number we report
 * downstream inherits whatever this returns.
 */

import type { GameplaySignal } from './gameplay-signals';
import { connectFlappyGameplay, isFlappyV9EnginePresent } from './flappy-gameplay-adapter.ts';
import { connectNightclubGameplay } from './nightclub-gameplay-adapter.ts';

export type GameSignalConnection = {
  read(): GameplaySignal[];
  dispose(): void;
};

export type GameSignalAdapter = {
  /** Catalogue id this adapter is valid for. */
  gameId: string;
  /** Exactly which field in the build the signal is read from, for the audit trail. */
  signalDescription: string;
  /**
   * Read the current state of a same-origin game window.
   *
   * Returns the signals to fold in, or an empty array while the build has not
   * reached a state worth reporting. `mountId` scopes run ids to this mount so
   * a refresh starts a fresh round and a late read from a previous mount cannot
   * be mistaken for the current one.
   */
  read?: (win: Window, mountId: string) => GameplaySignal[];
  /** Subscribe to authoritative engine transitions that can happen between polls. */
  connect?: (win: Window, mountId: string, emit: (signal: GameplaySignal) => void) => GameSignalConnection | null;
  /**
   * Host recovery only: the inspected engine is on screen. This is not a
   * verified gameplay signal and must not be used as `game_start`. Flappy's
   * title screen (START) is mounted before the bird script enters `getready`.
   */
  isPresent?: (win: Window) => boolean;
};

/**
 * Nightclub Showdown (inspected v2 client.js).
 *
 * The build ships InZone's own bridge (js/nightclub-bridge.js): runId, ended,
 * outcome, and a snapshot of wave / hero life / mobs alive. Start and
 * activity do **not** come from that snapshot or from hero cell/ammo.
 *
 * Validated player action: `Game.ME.heroHistory` entries written by
 * `Hero.executeAction` with `en.Action` index > 0 (not None), counted
 * after the intro cinematic queue drains. See lib/nightclub-gameplay-adapter.ts.
 *
 * Activity policy: each such action opens ACTIVITY_TIMEOUT_MS of grace.
 * Enemy motion, wave spawns, cinematic walk/reload, knockback-like dx, and
 * ammo restores without executeAction do not renew it.
 */
const nightclub: GameSignalAdapter = {
  gameId: 'nightclub-showdown-inzone-production',
  signalDescription:
    'window.NightclubBridge.getState() — runId, ended, outcome; paused from Main.ME.paused; ' +
    'start/activity from Game.ME.heroHistory non-None executeAction after hasCinematic() clears ' +
    '(not hero cx/ammo — boot cinematic walks and auto-reloads)',
  connect: connectNightclubGameplay,
};

const ADAPTERS: Record<string, GameSignalAdapter> = {
  [nightclub.gameId]: nightclub,
  'flappybird-inzone-2': {
    gameId: 'flappybird-inzone-2',
    signalDescription: 'v9 PlayCanvas Game/Bird.script.bird: game:play from first flap, ' +
      'game:gameover after continue resolution; state/paused/position/velocity for activity',
    connect: connectFlappyGameplay,
    isPresent: isFlappyV9EnginePresent,
  },
};

export function gameSignalAdapter(gameId: string): GameSignalAdapter | null {
  return ADAPTERS[gameId] ?? null;
}

/** Games whose gameplay can be verified today. Everything else stays on proxies. */
export function verifiedSignalGameIds(): string[] {
  return Object.keys(ADAPTERS);
}

/**
 * The first *player* action of a run is its start.
 *
 * Connected adapters (Nightclub, Flappy) emit an explicit `start` from the
 * engine. postMessage builds without that emit still infer start from the
 * first change of `actionFingerprint` (when present) or `fingerprint`.
 * `actionFingerprint` is a validated player-action key, never a board hash.
 * Nightclub's key is the heroHistory action nonce, not hero cell/ammo.
 */
export function progressStartKey(signal: GameplaySignal): string | null {
  if (signal.type !== 'progress') return null;
  return signal.actionFingerprint ?? signal.fingerprint;
}

export function startSignalFromProgress(
  previousKey: string | null,
  signal: GameplaySignal,
): GameplaySignal | null {
  if (signal.type !== 'progress' || !signal.active) return null;
  if (previousKey == null) return null;
  const key = progressStartKey(signal);
  if (key == null || key === previousKey) return null;
  return { type: 'start', runId: signal.runId };
}
