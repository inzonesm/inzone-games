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
  | 'round_over_loss'
  | 'round_over_draw';

export type CommentaryTrigger = {
  kind: CommentaryTriggerKind;
  /** Human-readable, one line, safe to embed in an analytics property. */
  evidence: string;
  /** Optional slot for state-derived values used to build a contextual line. */
  data?: {
    waveId?: number;
    heroLife?: number;
    ammo?: number;
    outcome?: string;
  };
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
/**
 * Pool of allowed lines per trigger. Every string here is served by the
 * commentary endpoint's allowlist — new lines must be added there in the same
 * change or the endpoint will refuse them. That coupling is deliberate: the
 * endpoint is not a general TTS surface, it is a fixed enum.
 *
 * The mix is short direct reactions plus a couple of encouragements or light
 * questions per kind, so Rook does not turn into a play-by-play narrator. The
 * `low_ammo` pool assumes `Reload` is a real Nightclub mechanic — confirmed in
 * lib/nightclub-gameplay-adapter.ts (en.Action index 9 = Reload, called by
 * `Hero.executeAction`).
 */
export const COMMENTARY_LINES: Record<CommentaryTriggerKind, readonly string[]> = {
  round_start: [
    'Here we go.',
    'New round.',
    'Show me.',
    "Let's move.",
  ],
  retry: [
    'Round two.',
    'Again.',
    "You've got this.",
    'Reset and go.',
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
  // A draw is neither win nor loss. Kept separate on purpose — classifying
  // it as a loss punishes the player for a result the game explicitly labels
  // as even.
  round_over_draw: [
    'A draw.',
    'Even one.',
    'That was close.',
  ],
};

/**
 * Every canned line the client is allowed to request from the commentary
 * endpoint, plus every contextual line `buildContextualLine` can produce.
 * The commentary route validates against this exact set — a line outside it
 * is rejected at the request boundary so the endpoint cannot be turned into
 * an open TTS surface by adding a new trigger without updating the allowlist.
 */
export const ALLOWED_COMMENTARY_LINES: readonly string[] = (() => {
  const set = new Set<string>();
  for (const pool of Object.values(COMMENTARY_LINES)) {
    for (const line of pool) set.add(line);
  }
  // Contextual lines that use snapshot state — every one has to be enumerable
  // for the endpoint's allowlist to hold.
  for (let hp = 1; hp <= 3; hp += 1) {
    set.add(hp === 1 ? 'One life left.' : `${hp === 2 ? 'Two' : 'Three'} lives left.`);
  }
  for (let wave = 1; wave <= 20; wave += 1) {
    set.add(`Wave ${wave}. Keep moving.`);
    set.add(`Wave ${wave} cleared.`);
  }
  set.add('One shot left.');
  set.add('Two shots left.');
  return Object.freeze([...set]);
})();

const WAVE_LINE_MAX = 20;

/**
 * Turn a trigger + its data into a line. When the state supports a
 * connected phrasing ("One life left", "Wave 4 cleared", "Two shots left")
 * we prefer that over the generic pool. When state is missing or out of the
 * enumerated range, we fall back to the pool so the endpoint's allowlist
 * still holds.
 *
 * Every string this function can return is present in
 * `ALLOWED_COMMENTARY_LINES`; that invariant is pinned by a test.
 */
export function buildContextualLine(
  trigger: CommentaryTrigger,
  pickIndex: number,
): string | null {
  const pool = COMMENTARY_LINES[trigger.kind];
  const contextual = pickContextualLine(trigger);
  if (contextual) return contextual;
  if (!pool || pool.length === 0) return null;
  return pool[Math.abs(pickIndex) % pool.length];
}

function pickContextualLine(trigger: CommentaryTrigger): string | null {
  const d = trigger.data;
  if (!d) return null;
  if (trigger.kind === 'close_call' && typeof d.heroLife === 'number') {
    if (d.heroLife === 1) return 'One life left.';
    if (d.heroLife === 2) return 'Two lives left.';
    if (d.heroLife === 3) return 'Three lives left.';
  }
  if (
    trigger.kind === 'wave_advance' &&
    typeof d.waveId === 'number' &&
    d.waveId >= 1 &&
    d.waveId <= WAVE_LINE_MAX
  ) {
    return `Wave ${d.waveId}. Keep moving.`;
  }
  if (
    trigger.kind === 'mob_wipe' &&
    typeof d.waveId === 'number' &&
    d.waveId >= 1 &&
    d.waveId <= WAVE_LINE_MAX
  ) {
    return `Wave ${d.waveId} cleared.`;
  }
  if (trigger.kind === 'low_ammo' && typeof d.ammo === 'number') {
    if (d.ammo === 1) return 'One shot left.';
    if (d.ammo === 2) return 'Two shots left.';
  }
  return null;
}

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
      triggers.push({
        kind: 'round_over_win',
        evidence: `outcome=${outcome} runId=${curr.runId}`,
        data: { outcome },
      });
    } else if (outcome === 'lose' || outcome === 'defeat') {
      triggers.push({
        kind: 'round_over_loss',
        evidence: `outcome=${outcome} runId=${curr.runId}`,
        data: { outcome },
      });
    } else if (outcome === 'draw') {
      // A draw is neither win nor loss. Kept separate so Rook does not
      // deliver a "rough one" line on an even result.
      triggers.push({
        kind: 'round_over_draw',
        evidence: `outcome=draw runId=${curr.runId}`,
        data: { outcome },
      });
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
    triggers.push({
      kind: 'wave_advance',
      evidence: `waveId ${prev.waveId} → ${curr.waveId}`,
      data: { waveId: curr.waveId },
    });
  }

  if (
    typeof curr.mobsAlive === 'number' &&
    typeof prev.mobsAlive === 'number' &&
    prev.mobsAlive > 0 &&
    curr.mobsAlive === 0
  ) {
    triggers.push({
      kind: 'mob_wipe',
      evidence: `mobsAlive ${prev.mobsAlive} → 0`,
      data: typeof curr.waveId === 'number' ? { waveId: curr.waveId } : undefined,
    });
  }

  if (
    typeof curr.heroLife === 'number' &&
    typeof prev.heroLife === 'number' &&
    curr.heroLife < prev.heroLife &&
    curr.heroLife > 0
  ) {
    triggers.push({
      kind: 'life_lost',
      evidence: `heroLife ${prev.heroLife} → ${curr.heroLife}`,
      data: { heroLife: curr.heroLife },
    });
    if (curr.heroLife <= 3) {
      triggers.push({
        kind: 'close_call',
        evidence: `heroLife=${curr.heroLife} (≤3)`,
        data: { heroLife: curr.heroLife },
      });
    }
  }

  if (
    typeof curr.ammo === 'number' &&
    curr.ammo <= 2 &&
    (typeof prev.ammo !== 'number' || prev.ammo > 2)
  ) {
    triggers.push({
      kind: 'low_ammo',
      evidence: `ammo ${prev.ammo ?? '?'} → ${curr.ammo}`,
      data: { ammo: curr.ammo },
    });
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
  // Prefer a contextual line that references the actual state. `buildContextualLine`
  // falls back to the trigger's canned pool when state is missing.
  const contextual = buildContextualLine(trigger, seed);
  const pool = COMMENTARY_LINES[trigger.kind];
  if (!pool || pool.length === 0) return contextual ? finalize(trigger, contextual, state, nowMs, noRepeatWindow) : null;
  const recent = new Set(state.recentLines);
  const line = contextual && !recent.has(contextual)
    ? contextual
    : (() => {
        const fresh = pool.filter((l) => !recent.has(l));
        const candidates = fresh.length > 0 ? fresh : pool;
        return candidates[Math.floor(Math.abs(seed) % candidates.length)];
      })();
  return finalize(trigger, line, state, nowMs, noRepeatWindow);
}

function finalize(
  trigger: CommentaryTrigger,
  line: string,
  state: CommentatorState,
  nowMs: number,
  noRepeatWindow: number,
) {
  const nextRecent = [line, ...state.recentLines.filter((l) => l !== line)].slice(0, noRepeatWindow);
  return {
    trigger,
    line,
    nextState: { lastEmittedAtMs: nowMs, recentLines: nextRecent },
  };
}
