/**
 * Rook's opt-in commentator, first shipped for Nightclub Showdown.
 *
 * Nothing here calls the model or the network. Every trigger is a transition
 * between two adjacent NightclubBridge snapshots the host already reads through
 * `readNightclubHostState`, and every reaction is a canned line picked to match
 * that transition. The point is inexpensive event-driven commentary — no
 * screenshots, no polling of an LLM, no quota spend beyond the browser's own
 * `speechSynthesis`.
 *
 * If a game does not surface reliable state (no adapter, no bridge), no
 * transitions are detectable and the commentator emits nothing. Rook stays
 * conversational for those titles; the mode is Nightclub-only until a second
 * game earns its telemetry.
 *
 * The rules this module encodes:
 *   1. Only real transitions between snapshots trigger commentary. Never a
 *      poll count, never an iframe load, never a heuristic on time.
 *   2. `paused` or `cinematic` suppresses all reactions for that snapshot.
 *   3. A cooldown enforces the minimum time between commentaries; a trigger
 *      that fires inside the cooldown is dropped, not queued.
 *   4. Recent lines are kept out of rotation so Rook does not repeat.
 *   5. Line selection is deterministic given seed + history so tests can
 *      pin the shape without pinning a specific string.
 *
 * The host module (components/GameCompanion.tsx) owns the audio path and the
 * user-speech-priority. This module only decides `what` and `whether`, not
 * `how loud` or `who wins`.
 */

/** The public-safe shape returned by lib/companion/nightclub-context.ts. */
export type NightclubSnapshot = {
  runId?: string;
  ended?: boolean;
  outcome?: string;
  waveId?: number;
  heroLife?: number;
  mobsAlive?: number;
  ammo?: number;
  paused?: boolean;
  cinematic?: boolean;
};

/** The kinds of transitions Rook can honestly react to. Every kind carries
 *  a compact real-event citation so the PR demo table (and any operator
 *  looking at emitted analytics) can point at the state change that
 *  produced it. */
export type CommentaryTriggerKind =
  | 'round_start'
  | 'retry'
  | 'wave_advance'
  | 'life_lost'
  | 'close_call'
  | 'low_ammo'
  | 'mob_wipe'
  | 'round_over_win'
  | 'round_over_loss';

export type CommentaryTrigger = {
  kind: CommentaryTriggerKind;
  /** Human-readable, one line, safe to embed in an analytics property. */
  evidence: string;
};

/** How many seconds must pass between two emitted commentaries. Set on the low
 *  end of "not annoying" so a hectic round still lets Rook speak more than
 *  once. Adjust by feel; a test pins the boundary. */
export const COMMENTARY_COOLDOWN_MS = 12_000;

/** How many recent lines to keep out of rotation. Roughly one full round's
 *  worth of variety before a repeat is allowed. */
export const COMMENTARY_NO_REPEAT_WINDOW = 6;

/**
 * The line pool per trigger. Each kind carries a mix of:
 *  - direct reactions ("Ouch"),
 *  - encouragement ("You got this"),
 *  - a light question ("Ready for round two?"),
 * so Rook does not turn into a play-by-play narrator.
 *
 * Copy is deliberately short (≤ 5 words in most cases). Browser TTS reads
 * short lines cleanly and they land inside a gameplay beat instead of
 * stepping on the next one.
 */
export const COMMENTARY_LINES: Record<CommentaryTriggerKind, readonly string[]> = {
  round_start: [
    'Here we go.',
    'New round.',
    'Show me.',
    'Take it.',
    "Let's move.",
  ],
  retry: [
    'Round two.',
    'Again.',
    "You've got this.",
    'Reset and go.',
    'Ready for another?',
  ],
  wave_advance: [
    'Next wave.',
    'Level up.',
    'Keep pushing.',
    'Another one.',
  ],
  life_lost: [
    'Ouch.',
    'Careful.',
    'Watch it.',
    'Took a hit.',
  ],
  close_call: [
    'Close!',
    'Hang in there.',
    'One more.',
    "Don't go down now.",
  ],
  low_ammo: [
    'Reload.',
    'Ammo low.',
    'Watch your bullets.',
  ],
  mob_wipe: [
    'Clean.',
    'Clear.',
    "That's the room.",
    'Nice.',
  ],
  round_over_win: [
    'Yes!',
    'Got it.',
    'Clean win.',
    "That's how.",
  ],
  round_over_loss: [
    'Oof.',
    'Rough one.',
    'Next one.',
    'Shake it off.',
  ],
};

/**
 * Detect every commentary trigger between two adjacent snapshots.
 *
 * A trigger is a discrete transition, not a state. `paused` and `cinematic`
 * suppress everything for THIS pair so a game paused mid-wave does not
 * fire "wave advance" when it resumes. First-ever snapshot returns [] so
 * the initial state alone never speaks — a transition needs two frames.
 *
 * Order in the returned list reflects natural narrative priority (result >
 * major state > minor state), so the caller's cooldown can pick the first
 * one and ignore the rest.
 */
export function detectTriggers(
  prev: NightclubSnapshot | null,
  curr: NightclubSnapshot,
): CommentaryTrigger[] {
  const triggers: CommentaryTrigger[] = [];
  if (!curr) return triggers;
  // The very first snapshot has nothing to transition from.
  if (!prev) return triggers;
  // Suppress everything while the build is paused or in a cinematic — those
  // are the same beats the measurement adapter excludes from active-time.
  if (curr.paused || curr.cinematic) return triggers;

  // Result first — the highest-priority moment in a round.
  if (curr.ended && !prev.ended && curr.runId) {
    const outcome = (curr.outcome || '').toLowerCase();
    if (outcome === 'win' || outcome === 'victory' || outcome === 'complete') {
      triggers.push({ kind: 'round_over_win', evidence: `outcome=${outcome} runId=${curr.runId}` });
    } else if (outcome === 'lose' || outcome === 'defeat' || outcome === 'draw') {
      triggers.push({ kind: 'round_over_loss', evidence: `outcome=${outcome} runId=${curr.runId}` });
    }
  }

  // A new runId that follows an ended run is a retry; otherwise it is a
  // fresh round start.
  if (curr.runId && curr.runId !== prev.runId) {
    if (prev.runId && prev.ended) {
      triggers.push({ kind: 'retry', evidence: `runId ${prev.runId} → ${curr.runId}` });
    } else if (curr.runId) {
      triggers.push({ kind: 'round_start', evidence: `runId set to ${curr.runId}` });
    }
  }

  if (
    typeof curr.waveId === 'number' &&
    typeof prev.waveId === 'number' &&
    curr.waveId > prev.waveId
  ) {
    triggers.push({ kind: 'wave_advance', evidence: `waveId ${prev.waveId} → ${curr.waveId}` });
  }

  if (
    typeof curr.mobsAlive === 'number' &&
    typeof prev.mobsAlive === 'number' &&
    prev.mobsAlive > 0 &&
    curr.mobsAlive === 0
  ) {
    triggers.push({ kind: 'mob_wipe', evidence: `mobsAlive ${prev.mobsAlive} → 0` });
  }

  if (
    typeof curr.heroLife === 'number' &&
    typeof prev.heroLife === 'number' &&
    curr.heroLife < prev.heroLife &&
    curr.heroLife > 0
  ) {
    triggers.push({ kind: 'life_lost', evidence: `heroLife ${prev.heroLife} → ${curr.heroLife}` });
    if (curr.heroLife <= 3) {
      triggers.push({ kind: 'close_call', evidence: `heroLife=${curr.heroLife} (≤3)` });
    }
  }

  if (
    typeof curr.ammo === 'number' &&
    curr.ammo <= 2 &&
    (typeof prev.ammo !== 'number' || prev.ammo > 2)
  ) {
    triggers.push({ kind: 'low_ammo', evidence: `ammo ${prev.ammo ?? '?'} → ${curr.ammo}` });
  }

  return triggers;
}

/** Tracks state a caller needs across polls to make good decisions. Kept as a
 *  plain shape so the host can persist it as a ref without ceremony. */
export type CommentatorState = {
  lastEmittedAtMs: number;
  recentLines: string[];
};

export function initialCommentatorState(): CommentatorState {
  return { lastEmittedAtMs: 0, recentLines: [] };
}

/**
 * Given the triggers detected in this poll and the commentator's state, decide
 * whether Rook should say anything and which line to say. Returns null if the
 * cooldown is open or the trigger list is empty.
 *
 * The picker prefers the highest-priority trigger in the list (result > start
 * > state), then a line from that pool that is NOT in `recentLines`. If every
 * line is in the recent window (which requires the pool to be smaller than the
 * window; only relevant for very short pools like `low_ammo`), the least
 * recently used one is picked.
 *
 * `nowMs` and `seed` are injected so tests are deterministic; production wires
 * `Date.now()` and `Math.random()`. The seed picks between lines that all
 * qualify — the trigger and the cooldown are not random.
 */
export function decideCommentary(
  triggers: readonly CommentaryTrigger[],
  state: CommentatorState,
  nowMs: number,
  seed: number,
  cooldownMs: number = COMMENTARY_COOLDOWN_MS,
  noRepeatWindow: number = COMMENTARY_NO_REPEAT_WINDOW,
): { trigger: CommentaryTrigger; line: string; nextState: CommentatorState } | null {
  if (triggers.length === 0) return null;
  if (nowMs - state.lastEmittedAtMs < cooldownMs) return null;
  const trigger = triggers[0];
  const pool = COMMENTARY_LINES[trigger.kind];
  if (!pool || pool.length === 0) return null;
  const recent = new Set(state.recentLines);
  const fresh = pool.filter((line) => !recent.has(line));
  const candidates = fresh.length > 0 ? fresh : pool;
  const line = candidates[Math.floor(Math.abs(seed) % candidates.length)];
  const nextRecent = [line, ...state.recentLines.filter((l) => l !== line)].slice(0, noRepeatWindow);
  return {
    trigger,
    line,
    nextState: { lastEmittedAtMs: nowMs, recentLines: nextRecent },
  };
}
