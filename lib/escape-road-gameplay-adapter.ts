import type { GameplaySignal } from './gameplay-signals';
import type { GameSignalConnection } from './game-adapters';

/**
 * Escape Road (clescaperoad), the pinned mirror build only.
 *
 * Both signals are the build's own, recorded by BUILD_EVENTS_SHIM in
 * lib/hosted-builds.ts on their way to where the build already sends them:
 *
 *   start  `firebase.analytics().logEvent('Press_play_game')` — the build logs
 *          it on the first steer of every run and at no other time.
 *   over   PlayerPrefs `ads` changing after that start — the build adds one to
 *          it at every game over (the ARRESTED card) and at nothing else we
 *          could make it do, and persists it to IndexedDB.
 *
 * What this build does NOT expose is anything that moves while a run is on:
 * no score, no position, no per-steer record. So there is no `progress`, and
 * `engaged_play` can never fire for this title — a timer standing in for
 * activity is exactly what the contract forbids. Dwell stays with the
 * cross-origin proxies, which is why the adapter is `lifecycleOnly`.
 *
 * If IndexedDB is unavailable (some private modes), the build keeps its prefs
 * in memory, no write happens and no `over` is reported. That undercounts;
 * it never invents one.
 */

export const ESCAPE_ROAD_PATH_PREFIX = '/gcs/games/clescaperoad/v1/';
/** `<gameId>@<first 12 of the pinned SHA>`, as the served entry's marker writes it. */
export const ESCAPE_ROAD_BUILD_PIN = 'clescaperoad@45b2d69c626d';
export const ESCAPE_ROAD_START_EVENT = 'Press_play_game';
export const ESCAPE_ROAD_OVER_PREF = 'ads';
export const BUILD_EVENT_NAME = 'inzone:build-event';

type BuildEvent =
  | { kind: 'log'; name: string }
  | { kind: 'pref'; key: string; value: number };

type BuildEventsProbe = { v: number; events: BuildEvent[]; prefs: { ads?: number } };

function pinnedBuildOnScreen(win: Window): boolean {
  if (!win.location.pathname.startsWith(ESCAPE_ROAD_PATH_PREFIX)) return false;
  const marker = win.document.querySelector('meta[data-inzone-hosted]');
  return marker?.getAttribute('data-inzone-hosted') === ESCAPE_ROAD_BUILD_PIN;
}

export function connectEscapeRoadGameplay(
  win: Window,
  mountId: string,
  emit: (signal: GameplaySignal) => void,
): GameSignalConnection | null {
  // Fail closed on any other build, or a page served without the recorder.
  if (!pinnedBuildOnScreen(win)) return null;
  const probe = (win as unknown as { __inzoneBuildEvents?: BuildEventsProbe }).__inzoneBuildEvents;
  if (!probe || probe.v !== 1 || typeof probe.prefs !== 'object' || probe.prefs === null) return null;

  let sequence = 0;
  let runId: string | null = null;
  let ended = false;
  let adsAtStart: number | null = null;
  let disposed = false;

  const onEvent = (event: Event) => {
    if (disposed) return;
    const detail = (event as CustomEvent<BuildEvent>).detail;
    if (!detail || typeof detail !== 'object') return;
    if (detail.kind === 'log' && detail.name === ESCAPE_ROAD_START_EVENT) {
      runId = `${mountId}:escape-${++sequence}`;
      ended = false;
      // Measured from here, so a boot-time load of an older count can never
      // read as this run ending.
      adsAtStart = typeof probe.prefs.ads === 'number' ? probe.prefs.ads : null;
      emit({ type: 'start', runId });
      return;
    }
    if (detail.kind === 'pref' && detail.key === ESCAPE_ROAD_OVER_PREF && typeof detail.value === 'number') {
      if (!runId || ended || detail.value === adsAtStart) return;
      ended = true;
      emit({ type: 'over', runId, outcome: 'loss' });
    }
  };
  win.addEventListener(BUILD_EVENT_NAME, onEvent);

  return {
    // No ready and no progress: see the header. Signals arrive through emit.
    read() {
      return [];
    },
    dispose() {
      disposed = true;
      win.removeEventListener(BUILD_EVENT_NAME, onEvent);
    },
  };
}
