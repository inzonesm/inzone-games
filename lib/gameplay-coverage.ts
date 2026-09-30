/**
 * Gameplay coverage: which games can report verified gameplay, and exactly
 * why the rest cannot.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * A zero `game_start` count is ambiguous: it means "measured, and nobody
 * played" for a game with an adapter, and "unmeasurable" for a game without
 * one. Reports that cannot tell the two apart will eventually optimise
 * against the wrong one. This module makes the distinction explicit, static,
 * and queryable: every gameplay event carries `measurement_coverage`, and
 * the proxy-only games scoped so far carry a documented reason.
 *
 * Coverage is a static property of the GAME (what its build can report).
 * `signal_source` on each event is a property of the EVENT (how this row was
 * actually produced). A verified event arriving from a proxy-only game means
 * the build reported through the postMessage bridge — either the registry is
 * stale or the build gained reporting, and that is worth investigating, not
 * suppressing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 0 FEASIBILITY (inspected 2026-09-26)
 *
 * Escape Road (`clescaperoad`) and Elytra Flight (`clelytraflight`) are
 * third-party Unity WebGL mirror builds ("Ultimate Game Stash" files):
 *
 * - Entry HTML: `games/<id>/v1/index.html` in the `inzone-html` bucket.
 * - The Unity payload (loader / data / framework / wasm) loads from
 *   `cdn.jsdelivr.net` mirrors. The host page keeps no reference to the
 *   instance: `myGameInstance` is a closure-local `let`, never assigned to
 *   `window`.
 * - Unity's host API is one-directional. `unityInstance.SendMessage` goes
 *   host → game. There is NO supported call that reads engine state, run
 *   ids, scores, or player actions from the host.
 * - The builds cannot be modified to add an InZone bridge: the Unity payload
 *   is third-party content mirrored on a CDN, not our source. Re-uploading a
 *   modified copy would also fork us from the upstream mirror with no way to
 *   take updates.
 * - Same-origin DOM observation was considered and rejected. Both builds are
 *   served through our same-origin /gcs proxy, so the host CAN read the
 *   frame's document — but the only host-visible signals would be input
 *   events (taps / keys), focus, elapsed time, or canvas pixels. None of
 *   those is a verified gameplay action, and policy forbids labelling any of
 *   them as one. An input event cannot distinguish a menu tap from a move,
 *   and canvas motion cannot distinguish an attract loop from a player.
 *
 * Conclusion: no legitimate, reliable signal for actual play exists for
 * these two builds today. They stay on proxy events (`game_open`,
 * `game_frame_loaded`), explicitly labelled, and are excluded from every
 * verified player count. What would change the classification: a build that
 * reports through the InZone postMessage bridge, or a same-origin build
 * whose engine exposes readable state the way Flappy v9 and Nightclub do.
 */

import { gameSignalAdapter } from './game-adapters.ts';

export type GameplayCoverage = 'verified' | 'proxy-only';

/**
 * Games whose builds cannot report verified gameplay today, with the exact
 * reason. A zero `game_start` count for these games means "unmeasurable",
 * never "no play".
 */
export const PROXY_ONLY_GAMES: Record<string, string> = {
  clescaperoad:
    'Third-party Unity WebGL mirror (jsDelivr "Ultimate Game Stash" file). ' +
    "Unity's host API is host→game only (SendMessage); no host-readable engine " +
    'state exists, the instance is closure-local, and the CDN payload cannot be ' +
    'modified to add a bridge. DOM input/focus/time/pixel observation rejected ' +
    'by policy: none is a verified gameplay action.',
  clelytraflight:
    'Third-party Unity WebGL mirror (jsDelivr, familiapablo/lopx). ' +
    "Unity's host API is host→game only (SendMessage); no host-readable engine " +
    'state exists, the instance is closure-local, and the CDN payload cannot be ' +
    'modified to add a bridge. DOM input/focus/time/pixel observation rejected ' +
    'by policy: none is a verified gameplay action.',
};

/** The documented reason a game is proxy-only, or null when it is not listed. */
export function proxyOnlyReason(gameId: string): string | null {
  return PROXY_ONLY_GAMES[gameId] ?? null;
}

/**
 * Static coverage for a game id.
 *
 * 'verified' only when a same-origin signal adapter exists today. Everything
 * else is 'proxy-only' — conservative by default, so no report can mistake an
 * unmeasured game for a measured one with zero play.
 */
export function gameplayCoverage(gameId: string): GameplayCoverage {
  return gameSignalAdapter(gameId) ? 'verified' : 'proxy-only';
}
