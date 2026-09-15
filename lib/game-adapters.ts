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
  read(win: Window, mountId: string): GameplaySignal[];
};

type NightclubBridgeState = {
  runId?: unknown;
  ended?: unknown;
  outcome?: unknown;
  snapshot?: unknown;
};

/**
 * Nightclub Showdown.
 *
 * The build ships InZone's own bridge (js/nightclub-bridge.js), which keeps the
 * authoritative run bookkeeping: a run id that changes on every replay, an
 * `ended` flag set from the engine's own hero-death / wave-clear check, and a
 * 4Hz snapshot of wave, hero life and surviving enemies.
 *
 * Activity semantics: this is a turn-based game — it says so on load — so the
 * player spends legitimate time looking at the board without touching anything.
 * Activity is therefore "the board changed", taken from the snapshot plus the
 * hero's column and ammo, and never from input events. Standing still costs the
 * player nothing and gains them nothing.
 */
const nightclub: GameSignalAdapter = {
  gameId: 'nightclub-showdown-inzone-production',
  signalDescription:
    'window.NightclubBridge.getState() — runId, ended, outcome; activity fingerprint from ' +
    'snapshot.waveId/heroLife/mobsAlive plus Game.ME.hero cx and ammo; paused from Main.ME.paused',
  read(win: Window, mountId: string): GameplaySignal[] {
    const w = win as unknown as {
      NightclubBridge?: { getState?: () => NightclubBridgeState };
      __NightclubRuntime?: { Game?: { ME?: unknown }; Main?: { ME?: unknown } };
    };
    const bridge = w.NightclubBridge;
    const runtime = w.__NightclubRuntime;
    if (!bridge || typeof bridge.getState !== 'function' || !runtime) return [];

    let raw: NightclubBridgeState;
    try {
      raw = bridge.getState() || {};
    } catch {
      return [];
    }

    const game = (runtime.Game as { ME?: Record<string, unknown> } | undefined)?.ME;
    const main = (runtime.Main as { ME?: Record<string, unknown> } | undefined)?.ME;
    const bridgeRunId = typeof raw.runId === 'string' && raw.runId ? raw.runId : '';
    if (!bridgeRunId) return [];
    const runId = `${mountId}:${bridgeRunId}`;

    const out: GameplaySignal[] = [{ type: 'ready', runId }];

    // No hero means the title screen: the build is up but nobody is playing.
    const hero = game?.hero as Record<string, unknown> | undefined;
    if (!hero) return out;

    const snap = (raw.snapshot && typeof raw.snapshot === 'object' ? raw.snapshot : {}) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    // Rounded to a tenth of a cell: enough to see a step, not so fine that
    // sub-pixel drift in a walk animation reads as endless activity.
    const cx = Math.round((num(hero.cx) + num(hero.xr)) * 10) / 10;
    const fingerprint = [
      num(snap.waveId),
      num(snap.heroLife),
      num(snap.mobsAlive),
      cx,
      num(hero.ammo),
    ].join(':');

    const ended = raw.ended === true;
    const paused = (main as { paused?: unknown } | undefined)?.paused === true;

    out.push({ type: 'progress', runId, active: !ended && !paused, fingerprint });
    if (ended) {
      out.push({ type: 'over', runId, ...(typeof raw.outcome === 'string' && raw.outcome ? { outcome: raw.outcome } : {}) });
    }
    return out;
  },
};

const ADAPTERS: Record<string, GameSignalAdapter> = {
  [nightclub.gameId]: nightclub,
};

export function gameSignalAdapter(gameId: string): GameSignalAdapter | null {
  return ADAPTERS[gameId] ?? null;
}

/** Games whose gameplay can be verified today. Everything else stays on proxies. */
export function verifiedSignalGameIds(): string[] {
  return Object.keys(ADAPTERS);
}

/**
 * The first state change of a run is its first meaningful gameplay action.
 *
 * An adapter reports `progress` from the moment a run exists, including while
 * the player is still deciding. Comparing consecutive fingerprints is what
 * separates "a hero is on screen" from "the player did something", and it is
 * why a loading page or an idle refresh cannot produce a `game_start`.
 */
export function startSignalFromProgress(
  previousFingerprint: string | null,
  signal: GameplaySignal,
): GameplaySignal | null {
  if (signal.type !== 'progress') return null;
  if (previousFingerprint == null) return null;
  if (signal.fingerprint === previousFingerprint) return null;
  return { type: 'start', runId: signal.runId };
}
