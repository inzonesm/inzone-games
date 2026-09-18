/**
 * Host-side recovery for the player iframe.
 *
 * iframe `load` only means the browser finished a navigation. A broken
 * shell, a 404 document, or a build that never initialises can all fire
 * `load` and still leave the player with nothing to play. This module
 * keeps that download signal separate from a reliable game-ready probe.
 *
 * Ready probes come only from existing validated adapters
 * (`gameSignalAdapter`). Games without an adapter never get a fabricated
 * ready event: after `load` they enter unverified play with a compact
 * escape hatch, not a success or failure claim.
 *
 * Nothing here remounts the iframe. Retry is a caller decision.
 */

import { gameSignalAdapter } from './game-adapters.ts';

/** Generous wait before offering an escape from a stuck download or ready probe. */
export const FRAME_STALL_AFTER_MS = 20_000;
/** Same-origin empty shells can still be injecting; only inspect after this. */
export const FRAME_SHELL_SETTLE_MS = 2_000;
/** How often the host re-reads an adapter while waiting for ready. */
export const FRAME_READY_POLL_MS = 250;

export type RecoveryPhase =
  | 'waiting-download'
  | 'waiting-ready'
  | 'unverified-play'
  | 'ready'
  | 'stalled'
  | 'failed';

export type RecoveryInput = {
  hasGame: boolean;
  frameLoaded: boolean;
  frameFailed: boolean;
  gameReady: boolean;
  stalled: boolean;
  hasReadyProbe: boolean;
  inspectableBlankShell: boolean;
};

export type ShellInspection = {
  /** contentDocument was reachable (same-origin). */
  reachable: boolean;
  /**
   * An inspectable document with no play surface and almost no markup.
   * Cross-origin frames are never blank here — we cannot see them.
   */
  blankBrokenShell: boolean;
};

export function gameHasReadyProbe(gameId: string): boolean {
  return Boolean(gameId) && gameSignalAdapter(gameId) != null;
}

/**
 * True only when a validated adapter can already read a `ready` signal
 * from this window. A missing engine, a non-v9 Flappy path, or a
 * cross-origin frame all return false — never a guessed ready.
 */
export function probeAdapterReady(win: Window, gameId: string): boolean {
  const adapter = gameSignalAdapter(gameId);
  if (!adapter) return false;
  try {
    if (adapter.connect) {
      const connection = adapter.connect(win, 'recovery-probe', () => {});
      if (!connection) return false;
      try {
        return connection.read().some((signal) => signal.type === 'ready');
      } finally {
        connection.dispose();
      }
    }
    return (adapter.read?.(win, 'recovery-probe') ?? []).some((signal) => signal.type === 'ready');
  } catch {
    return false;
  }
}

type InspectableBody = {
  childElementCount: number;
  textContent: string | null;
  innerText?: string;
  querySelector: (selectors: string) => unknown;
  querySelectorAll: (selectors: string) => { length: number };
};

export type InspectableDocument = {
  URL?: string;
  body: InspectableBody | null;
  scripts?: { length: number };
  querySelector: (selectors: string) => unknown;
};

/**
 * Same-origin empty-shell detector. A canvas, media surface, or any real
 * scripted document is treated as a living build — even if our adapter
 * has not reported ready yet. Only a hollow document is `blankBrokenShell`.
 */
export function inspectGameDocument(doc: InspectableDocument | null | undefined): ShellInspection {
  if (!doc) return { reachable: false, blankBrokenShell: false };
  const body = doc.body;
  if (!body) return { reachable: true, blankBrokenShell: true };

  const playSurface = doc.querySelector('canvas, video, object, embed, iframe');
  if (playSurface) return { reachable: true, blankBrokenShell: false };

  const scripts = doc.scripts?.length ?? 0;
  const descendants = body.querySelectorAll('*').length;
  const text = (body.innerText || body.textContent || '').trim();
  const url = doc.URL || '';
  const aboutBlankEmpty = url === 'about:blank' && descendants === 0 && text.length === 0;
  const hollow =
    scripts === 0 &&
    descendants <= 2 &&
    text.length < 8 &&
    !body.querySelector('canvas, video, object, embed');

  return { reachable: true, blankBrokenShell: aboutBlankEmpty || hollow };
}

export function inspectSameOriginShell(
  frame: { contentDocument?: InspectableDocument | null } | null,
): ShellInspection {
  if (!frame) return { reachable: false, blankBrokenShell: false };
  try {
    return inspectGameDocument(frame.contentDocument ?? null);
  } catch {
    return { reachable: false, blankBrokenShell: false };
  }
}

/**
 * Phase rules, in order:
 *   failed            — iframe error or inspectable hollow shell
 *   ready             — adapter reported ready (never inferred from load)
 *   unverified-play   — load fired, no adapter probe exists
 *   stalled           — still waiting past the stall clock
 *   waiting-ready     — load fired, adapter exists, ready has not
 *   waiting-download  — iframe has not loaded
 *
 * `stalled` never overrides ready or unverified-play. A late stall tick
 * after a healthy session must not cover the game again.
 */
export function resolveRecoveryPhase(input: RecoveryInput): RecoveryPhase {
  if (input.frameFailed || input.inspectableBlankShell) return 'failed';
  if (input.gameReady) return 'ready';
  if (!input.hasGame) return input.stalled ? 'stalled' : 'waiting-download';
  if (!input.hasReadyProbe && input.frameLoaded) return 'unverified-play';
  if (input.stalled) return 'stalled';
  if (input.hasReadyProbe && input.frameLoaded) return 'waiting-ready';
  return 'waiting-download';
}

export function showFullBootOverlay(phase: RecoveryPhase): boolean {
  return phase === 'waiting-download' || phase === 'waiting-ready' || phase === 'stalled' || phase === 'failed';
}

/** Compact Try again / Back after onload when we cannot prove ready or failure. */
export function showCompactRecovery(phase: RecoveryPhase): boolean {
  return phase === 'unverified-play';
}

export function showRecoveryActions(phase: RecoveryPhase): boolean {
  return phase === 'stalled' || phase === 'failed' || phase === 'unverified-play';
}

export function bootStatusCopy(phase: RecoveryPhase): string | null {
  switch (phase) {
    case 'failed':
      return "This game didn't load.";
    case 'stalled':
      return 'Still loading — this one is taking longer than usual.';
    case 'waiting-download':
    case 'waiting-ready':
      return 'Loading…';
    default:
      return null;
  }
}
