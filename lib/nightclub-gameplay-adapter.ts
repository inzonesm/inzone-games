import type { GameplaySignal } from './gameplay-signals';
import type { GameSignalConnection } from './game-adapters';

export const NIGHTCLUB_V2_PATH = '/gcs/games/nightclub-showdown-inzone-production/v2/';

type NightclubBridgeState = {
  runId?: unknown;
  ended?: unknown;
  outcome?: unknown;
  snapshot?: unknown;
};

type ActionLike = { _hx_index?: unknown };
type HistoryEntry = { a?: ActionLike; t?: unknown };

/**
 * Inspected v2 `client.js` (ETag f509e7c6a3a839ac0597692e4749317f).
 *
 * Player actions enter the engine only through `Hero.executeAction`. That
 * method appends `{ t, a }` to `Game.ME.heroHistory` unless `isReplay`.
 * `en.Action` indices: 0 None, 1 BlindShot, 2 HeadShot, 3 Move, 4 TurnBack,
 * 5 TakeCover, 6 Wait, 7 GrabMob, 8 KickGrab, 9 Reload.
 *
 * Those history entries are the validated gameplay-action signal. Hero cell
 * and ammo are not: the boot cinematic walks the hero (`moveTarget`) and
 * calls `executeAction(Reload)` while `hasCinematic()` is true; `setAmmo(6)`
 * runs at construction; `setPosCase` runs on the skip-intro path; walking
 * interpolates `cx` after a Move without a new click. None of those are
 * human input.
 *
 * Cinematic / replay history is baselined out. `None` (index 0) is ignored
 * so a miss-click does not start or renew activity.
 */
export function isNightclubV2Path(pathname: string | undefined): boolean {
  return typeof pathname === 'string' && pathname.includes(NIGHTCLUB_V2_PATH);
}

export function nightclubActionIndex(entry: unknown): number {
  if (!entry || typeof entry !== 'object') return 0;
  const raw = entry as HistoryEntry & ActionLike;
  const action = raw.a && typeof raw.a === 'object' ? raw.a : raw;
  const idx = (action as ActionLike)._hx_index;
  return typeof idx === 'number' && Number.isFinite(idx) ? idx : 0;
}

export function isMeaningfulNightclubAction(entry: unknown): boolean {
  return nightclubActionIndex(entry) > 0;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function cell(e: Record<string, unknown>): number {
  return Math.round((num(e.cx) + num(e.xr)) * 10) / 10;
}

/**
 * Same-origin Nightclub v2. `read()` is a snapshot; `connect()` owns the
 * cinematic baseline so boot Reload / auto-walk cannot mint a start.
 */
export function connectNightclubGameplay(
  win: Window,
  mountId: string,
  emit: (signal: GameplaySignal) => void,
): GameSignalConnection | null {
  void emit;
  const pathname = (win as { location?: { pathname?: string } }).location?.pathname;
  if (pathname && !isNightclubV2Path(pathname)) return null;

  const w = win as unknown as {
    NightclubBridge?: { getState?: () => NightclubBridgeState };
    __NightclubRuntime?: {
      Game?: { ME?: Record<string, unknown> };
      Main?: { ME?: Record<string, unknown> };
      en_Mob?: { ALL?: unknown };
    };
  };
  if (!w.NightclubBridge || typeof w.NightclubBridge.getState !== 'function' || !w.__NightclubRuntime) {
    return null;
  }

  let disposed = false;
  let started = false;
  let armed = false;
  let baseline = 0;
  let lastBridgeRunId = '';

  const snapshot = (): GameplaySignal[] => {
    if (disposed) return [];

    let raw: NightclubBridgeState;
    try {
      raw = w.NightclubBridge?.getState?.() || {};
    } catch {
      return [];
    }

    const runtime = w.__NightclubRuntime;
    const game = runtime?.Game?.ME;
    const main = runtime?.Main?.ME;
    const out: GameplaySignal[] = [{ type: 'ready' }];

    const bridgeRunId = typeof raw.runId === 'string' && raw.runId ? raw.runId : '';
    if (!bridgeRunId) return out;
    if (bridgeRunId !== lastBridgeRunId) {
      lastBridgeRunId = bridgeRunId;
      started = false;
      armed = false;
      baseline = 0;
    }
    const runId = `${mountId}:${bridgeRunId}`;

    const hero = game?.hero as Record<string, unknown> | undefined;
    if (!hero || !game) return out;

    const cinematic = typeof game.hasCinematic === 'function' && game.hasCinematic() === true;
    const replay = game.isReplay === true;
    const history = Array.isArray(game.heroHistory) ? (game.heroHistory as unknown[]) : [];

    if (cinematic || replay) {
      armed = true;
      baseline = history.length;
    } else if (!armed) {
      // Attach-late / skip-intro: ignore actions that already happened.
      armed = true;
      baseline = history.length;
    }

    let nonce = 0;
    if (!cinematic && !replay) {
      for (let i = baseline; i < history.length; i++) {
        if (isMeaningfulNightclubAction(history[i])) nonce += 1;
      }
    }

    const snap = (raw.snapshot && typeof raw.snapshot === 'object' ? raw.snapshot : {}) as Record<string, unknown>;
    const mobs = (runtime?.en_Mob?.ALL ?? []) as Record<string, unknown>[];
    const mobPart = Array.isArray(mobs)
      ? mobs
          .filter((m) => m && !m.destroyed)
          .map((m) => `${cell(m)}/${num(m.life)}`)
          .join(',')
      : '';
    const fingerprint = [
      num(snap.waveId),
      num(snap.heroLife),
      num(snap.mobsAlive),
      cell(hero),
      num(hero.ammo),
      mobPart,
    ].join(':');

    const ended = raw.ended === true;
    const paused = main?.paused === true;
    const active = !ended && !paused && !cinematic && !replay;

    if (!started && nonce > 0 && active) {
      started = true;
      out.push({ type: 'start', runId });
    }

    out.push({
      type: 'progress',
      runId,
      active,
      fingerprint,
      actionFingerprint: String(nonce),
    });
    if (ended) {
      out.push({
        type: 'over',
        runId,
        ...(typeof raw.outcome === 'string' && raw.outcome ? { outcome: raw.outcome } : {}),
      });
    }
    return out;
  };

  return {
    read: snapshot,
    dispose() {
      disposed = true;
    },
  };
}
