/**
 * Verified gameplay measurement.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * `game_start` used to be emitted from the iframe's `load` event. That counts
 * downloads, not players: it fires for someone who lands, sees the loading
 * screen and leaves, and it fires again on every refresh. Anything optimised
 * against it is optimised against arrivals.
 *
 * So four things are kept strictly apart here, and only the last one counts as
 * gameplay:
 *
 *   1. landing rendered  — our page painted.                 (`home_view` / `game_open`)
 *   2. iframe loaded     — the bundle's `load` fired.        (`game_frame_loaded`, a PROXY)
 *   3. game ready        — the build says it is initialised. (`game_ready`)
 *   4. first meaningful gameplay action — the build says the
 *      player did something in the game.                     (`game_start`, VERIFIED)
 *
 * A game that cannot report (4) never produces a `game_start`. It keeps its
 * clearly-named proxy events instead, and those are excluded from verified
 * player counts. We would rather report a smaller honest number.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OPERATIONAL DEFINITIONS
 *
 * Visit
 *   One tab's measurement session, identified by `visit_id` in sessionStorage.
 *   It ends when the tab is closed (sessionStorage dies with it) or after
 *   VISIT_IDLE_EXPIRY_MS of no recorded activity, whichever comes first. A
 *   refresh continues the same visit; a second tab is a SECOND visit, because
 *   sessionStorage is per-tab. That is why per-visit counts must not be read as
 *   people — see "Identification limits".
 *
 * Run
 *   One playable attempt inside a game, identified by whatever run id the build
 *   reports. Replaying produces a new run.
 *
 * game_start — counting scope: once per run.
 *   Emitted on the first meaningful gameplay action of a run, and deduped on
 *   `run_id`, so a repeated callback, a re-read of the same run, or a refresh
 *   that lands back in a run already counted cannot emit twice. Replaying is a
 *   new run and is a new `game_start`; the number of `game_start`s is therefore
 *   a count of ROUNDS, not of people. Nightclub's bridge issues a new `runId`
 *   (`run-1`, `run-2`, …) on every restart; many starts in one visit are
 *   many rounds, not unique acquired players.
 *
 * game_over — counting scope: first per visit per game (`first_game_over`).
 *   Only a genuine end-of-run signal from the build counts. Losing a life,
 *   taking damage or closing the tab do not.
 *
 * Active gameplay
 *   Time is accumulated only while ALL of these hold:
 *     - the document is visible (hidden-tab time is excluded);
 *     - the build reports it is not paused, not ended, and not sitting on a
 *       menu / intro cinematic;
 *     - a verified activity signal is still inside ACTIVITY_TIMEOUT_MS (the
 *       inactivity grace).
 *
 *   Activity policy — two adapter modes, never mixed:
 *
 *   1. Player-action gate (`progress.actionFingerprint` present).
 *      The key changes only on a validated player action from the build.
 *      Each change opens a wall-clock grace window of ACTIVITY_TIMEOUT_MS
 *      from the observation time (or from `actionAt` when the adapter
 *      supplies an accurate timestamp that lies on the current interval).
 *      Credit is the overlap of [previous eligible tick, now] with the
 *      window that was **already open** during that interval. A newly
 *      observed action does not move lastAction backward to price idle
 *      time after the previous window expired. Autonomous enemy / wave
 *      / physics changes do NOT renew the window. Hidden, paused, menu,
 *      and ended ticks are never credited; a long hide or pause expires
 *      the grace because the clock is wall time from the last action.
 *      Idle after the grace is not play.
 *
 *   2. State-change gate (no actionFingerprint — Flappy in-flight).
 *      `fingerprint` must change within ACTIVITY_TIMEOUT_MS. Used when the
 *      engine-validated play state is itself the activity (bird.state ===
 *      'play' with changing physics). Title, get-ready, pause, and dead
 *      are inactive and do not credit.
 *
 *   Raw DOM clicks are never activity. Nightclub's action key is the v2
 *   engine's own `heroHistory` of non-None `executeAction` calls after the
 *   intro cinematic. Hero cell and ammo are not used: boot walks the hero,
 *   auto-reloads, interpolates a Move, and can setPos / setAmmo without a
 *   player click.
 *
 * engaged_play
 *   Once per visit per game, when accumulated active gameplay first reaches
 *   ENGAGED_PLAY_THRESHOLD_MS. Accumulation spans attempts, game-overs and
 *   refreshes within the visit, so several short attempts add up. Switching to
 *   another game freezes this game's total and starts the other game's own.
 *
 * return_play
 *   A verified `game_start` on the immediately following local calendar day after we
 *   recorded verified gameplay for this browser. The day boundary is the
 *   visitor's own device timezone, formatted YYYY-MM-DD; the day and the
 *   timezone name both ride along on the event so a report can be recomputed in
 *   another zone. At most one per day.
 *
 * Identification limits
 *   `visitor_id` is a random id in localStorage. It identifies a browser
 *   profile on one device, and nothing more: it does not survive clearing site
 *   data or private browsing, it cannot be joined across devices, and two
 *   people sharing a laptop share one. It must never be reported as a count of
 *   unique humans, and "unique engaged visitors" derived from it must be
 *   labelled as browsers. Rounds (`game_start`) and engaged visitors
 *   (`engaged_play` by `visitor_id`) are different numbers and are reported
 *   separately.
 */

export const VISIT_STORAGE_KEY = 'inzone.visit.v1';
export const VISITOR_STORAGE_KEY = 'inzone.visitor.v1';

/** A visit with no recorded activity for this long is over. */
export const VISIT_IDLE_EXPIRY_MS = 30 * 60 * 1000;
/** Active gameplay needed for one `engaged_play`. */
export const ENGAGED_PLAY_THRESHOLD_MS = 60 * 1000;
/**
 * Inactivity grace. Player-action adapters: wall-clock from the last
 * validated action. State-change adapters: max gap between fingerprint
 * changes. Autonomous board motion must not refresh this window.
 */
export const ACTIVITY_TIMEOUT_MS = 5 * 1000;

/** What a build told us, in the only shapes we accept. */
export type GameplaySignal =
  | { type: 'ready'; runId?: string }
  | { type: 'start'; runId: string }
  | { type: 'over'; runId: string; outcome?: string }
/** A heartbeat carrying the build's own notion of whether play is happening. */
  | { type: 'progress'; runId: string; active: boolean; fingerprint: string; actionFingerprint?: string; actionAt?: number };

export type SignalSource = 'postmessage-bridge' | 'same-origin-adapter';

/* ── The postMessage schema games can implement ─────────────────────────────
 * A build that wants to be measured properly posts to its parent:
 *
 *   parent.postMessage({
 *     inzone: 'gameplay', v: 1,
 *     type: 'ready' | 'start' | 'over' | 'progress',
 *     gameId: '<the id the host loaded>',
 *     runId: '<stable within one attempt>',
 *     active: true,               // 'progress' only
 *     fingerprint: 'w3:l2:s400',  // 'progress' only: changes iff state changed
 *     outcome: 'loss',            // 'over' only, optional
 *   }, '<host origin>');
 *
 * Everything else is dropped. Validation is deliberately strict because this is
 * the boundary between a third-party bundle and numbers we are going to report.
 */
export const GAMEPLAY_MESSAGE_TAG = 'gameplay';
export const GAMEPLAY_MESSAGE_VERSION = 1;

export type ValidateContext = {
  /** Origin the host page is served from. */
  hostOrigin: string;
  /** The game id currently mounted. */
  gameId: string;
  /** The window of the iframe currently mounted. */
  frameWindow: unknown;
};

export type IncomingMessage = {
  origin?: unknown;
  source?: unknown;
  data?: unknown;
};

/**
 * Accept a gameplay message only if it came from the iframe we are currently
 * showing, from our own origin, for the game we currently have mounted, in the
 * shape we documented. Anything else returns null — including a late message
 * from a previous mount, which is what `gameId` and the source check catch.
 */
export function parseGameplayMessage(event: IncomingMessage, ctx: ValidateContext): GameplaySignal | null {
  // Bucket-hosted builds are proxied through our own /gcs route, so a genuine
  // signal is same-origin. A cross-origin game cannot be verified this way and
  // is left to its proxy events.
  if (event.origin !== ctx.hostOrigin) return null;
  if (!ctx.frameWindow || event.source !== ctx.frameWindow) return null;

  const d = event.data;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const m = d as Record<string, unknown>;
  if (m.inzone !== GAMEPLAY_MESSAGE_TAG) return null;
  if (m.v !== GAMEPLAY_MESSAGE_VERSION) return null;
  if (typeof m.gameId !== 'string' || m.gameId !== ctx.gameId) return null;

  const runId = typeof m.runId === 'string' && m.runId.length > 0 && m.runId.length <= 120 ? m.runId : '';

  switch (m.type) {
    case 'ready':
      return { type: 'ready', ...(runId ? { runId } : {}) };
    case 'start':
      return runId ? { type: 'start', runId } : null;
    case 'over':
      return runId
        ? { type: 'over', runId, ...(typeof m.outcome === 'string' && m.outcome.length <= 40 ? { outcome: m.outcome } : {}) }
        : null;
    case 'progress': {
      if (!runId) return null;
      if (typeof m.active !== 'boolean') return null;
      if (typeof m.fingerprint !== 'string' || m.fingerprint.length > 200) return null;
      const actionFingerprint =
        typeof m.actionFingerprint === 'string' && m.actionFingerprint.length > 0 && m.actionFingerprint.length <= 200
          ? m.actionFingerprint
          : undefined;
      const actionAt =
        typeof m.actionAt === 'number' && Number.isFinite(m.actionAt) && m.actionAt >= 0 && m.actionAt <= 1e15
          ? m.actionAt
          : undefined;
      return {
        type: 'progress',
        runId,
        active: m.active,
        fingerprint: m.fingerprint,
        ...(actionFingerprint ? { actionFingerprint } : {}),
        ...(actionAt != null ? { actionAt } : {}),
      };
    }
    default:
      return null;
  }
}

/* ── The accumulator ────────────────────────────────────────────────────────
 * Pure and time-injected so the definitions above can be tested rather than
 * asserted. It owns no storage and no analytics; the caller feeds it signals
 * and ships whatever it hands back.
 */

export type EmittedEvent =
  | { name: 'game_ready'; runId?: string }
  | { name: 'game_start'; runId: string }
  | { name: 'engaged_play'; runId: string; activeMs: number }
  | { name: 'first_game_over'; runId: string; outcome?: string };

/** Per-visit, per-game state. Serialisable so a refresh can resume mid-count. */
export type GameEngagement = {
  /** Cumulative active gameplay for this game in this visit. */
  activeMs: number;
  /** Runs already counted, so a duplicate callback cannot inflate starts. */
  startedRuns: string[];
  /** Set once `engaged_play` has been emitted for this game in this visit. */
  engagedSent: boolean;
  /** Set once `first_game_over` has been emitted for this game in this visit. */
  gameOverSent: boolean;
  /** Runs whose ready has been announced. */
  readyRuns: string[];
};

export function emptyEngagement(): GameEngagement {
  return { activeMs: 0, startedRuns: [], engagedSent: false, gameOverSent: false, readyRuns: [] };
}

/** Only an eligible tick from the same run may begin a credited interval. */
export type ProgressTick = { at: number; fingerprint: string; runId: string };

/**
 * Last validated player-action key. Survives hidden/paused ticks (those
 * drop `lastTick` so the gap is never priced) but is wall-clock, so a
 * long hide still expires the grace. Memory-only — not persisted across
 * refresh. `at` is the window start: observation time, or a clamped
 * `actionAt` when the adapter has an accurate timestamp.
 */
export type LastPlayerAction = { key: string; at: number; runId: string };

/** Overlap of [intervalStart, intervalEnd] with [windowStart, windowStart + grace]. */
export function activityWindowOverlapMs(
  intervalStart: number,
  intervalEnd: number,
  windowStart: number,
  graceMs: number = ACTIVITY_TIMEOUT_MS,
): number {
  const from = Math.max(intervalStart, windowStart);
  const to = Math.min(intervalEnd, windowStart + graceMs);
  return Math.max(0, to - from);
}

/**
 * Window start for a newly observed action. Defaults to `now`. An optional
 * `actionAt` is used only when it lies on the current interval (not in the
 * future, not before the previous eligible tick) so a claimed timestamp
 * cannot backfill idle time.
 */
export function resolveActionObservationAt(
  now: number,
  actionAt: number | undefined,
  previousTickAt: number | null,
): number {
  if (typeof actionAt !== 'number' || !Number.isFinite(actionAt) || actionAt > now) return now;
  if (previousTickAt != null && actionAt < previousTickAt) return now;
  return actionAt;
}

export type AccumulatorInput = {
  state: GameEngagement;
  signal: GameplaySignal;
  /** Monotonic-ish clock in ms. */
  now: number;
  /** Whether the host document is visible right now. */
  documentVisible: boolean;
  /** Previous progress tick, if any, so we can price the interval. */
  lastTick?: ProgressTick | null;
  /** Previous player-action marker, if the adapter gates on actions. */
  lastAction?: LastPlayerAction | null;
};

export type AccumulatorResult = {
  state: GameEngagement;
  events: EmittedEvent[];
  lastTick: ProgressTick | null;
  lastAction: LastPlayerAction | null;
};

/**
 * Fold one signal into the visit state.
 *
 * `progress` is the only signal that can advance the clock. The interval
 * since the previous eligible tick is credited only when it looks like
 * real play: the document was visible, the build said it was active, the
 * gap is within ACTIVITY_TIMEOUT_MS, and the adapter's activity policy
 * agrees. Player-action adapters credit inside the grace window of the
 * last validated action. State-change adapters still require a fingerprint
 * change. A hidden, paused, menu, or idle tick is never priced.
 */
export function applyGameplaySignal(input: AccumulatorInput): AccumulatorResult {
  const state: GameEngagement = {
    ...input.state,
    startedRuns: [...input.state.startedRuns],
    readyRuns: [...input.state.readyRuns],
  };
  const events: EmittedEvent[] = [];
  let lastTick = input.lastTick ?? null;
  let lastAction = input.lastAction ?? null;
  const { signal, now } = input;

  switch (signal.type) {
    case 'ready': {
      const key = signal.runId ?? '';
      if (!state.readyRuns.includes(key)) {
        state.readyRuns.push(key);
        events.push({ name: 'game_ready', ...(signal.runId ? { runId: signal.runId } : {}) });
      }
      break;
    }

    case 'start': {
      if (lastTick?.runId !== signal.runId) lastTick = null;
      if (lastAction?.runId !== signal.runId) lastAction = null;
      if (!input.documentVisible) { lastTick = null; break; }
      if (!state.startedRuns.includes(signal.runId)) {
        state.startedRuns.push(signal.runId);
        events.push({ name: 'game_start', runId: signal.runId });
      }
      break;
    }

    case 'over': {
      lastTick = null;
      lastAction = null;
      // Only a run we actually saw start can end. This is what stops a build
      // that reports "over" on load — or a stale end from the previous mount —
      // from manufacturing a completion.
      if (!state.startedRuns.includes(signal.runId)) break;
      if (!state.gameOverSent) {
        state.gameOverSent = true;
        events.push({ name: 'first_game_over', runId: signal.runId, ...(signal.outcome ? { outcome: signal.outcome } : {}) });
      }
      break;
    }

    case 'progress': {
      const prev = lastTick;
      const gated = Boolean(signal.actionFingerprint);
      const prevAction = lastAction;
      if (gated && signal.actionFingerprint && signal.actionFingerprint !== '0') {
        if (!lastAction || lastAction.runId !== signal.runId || lastAction.key !== signal.actionFingerprint) {
          lastAction = {
            key: signal.actionFingerprint,
            at: resolveActionObservationAt(now, signal.actionAt, prev?.at ?? null),
            runId: signal.runId,
          };
        }
      }
      const eligible = input.documentVisible && signal.active && state.startedRuns.includes(signal.runId);
      lastTick = eligible ? { at: now, fingerprint: signal.fingerprint, runId: signal.runId } : null;

      if (!eligible || prev == null || prev.runId !== signal.runId) break;
      if (now <= prev.at) break;
      // Only a started run accrues engagement, so time on a title screen or an
      // idle menu cannot reach the threshold.
      if (!state.startedRuns.includes(signal.runId)) break;

      let creditMs = 0;
      if (gated) {
        // Price the interval against the window that was already open.
        // Updating lastAction to `now` must not resurrect idle time.
        if (!prevAction || prevAction.runId !== signal.runId) break;
        creditMs = activityWindowOverlapMs(prev.at, now, prevAction.at);
      } else {
        if (now - prev.at > ACTIVITY_TIMEOUT_MS) break;
        if (signal.fingerprint === prev.fingerprint) break;
        creditMs = now - prev.at;
      }
      if (creditMs <= 0) break;

      state.activeMs += creditMs;
      if (!state.engagedSent && state.activeMs >= ENGAGED_PLAY_THRESHOLD_MS) {
        state.engagedSent = true;
        events.push({ name: 'engaged_play', runId: signal.runId, activeMs: state.activeMs });
      }
      break;
    }
  }

  return { state, events, lastTick, lastAction };
}

/* ── Day and identity helpers ───────────────────────────────────────────── */

/** Local calendar day, YYYY-MM-DD, in the visitor's own timezone. */
export function localDay(at: number | Date = Date.now()): string {
  const d = at instanceof Date ? at : new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
  } catch {
    return 'unknown';
  }
}

export type VisitorRecord = {
  visitorId: string;
  /** Local day of the first verified gameplay we ever saw in this browser. */
  firstPlayDay: string;
  /** Days a `return_play` has already been emitted for. */
  returnDays: string[];
};

/**
 * Decide whether verified gameplay today is a return.
 *
 * A return is gameplay on exactly the next local calendar day after first play.
 * The first day itself is never a return, and a day already reported is not
 * reported twice, so a refresh or a second run cannot inflate it.
 */
export function noteVerifiedPlayDay(
  record: VisitorRecord | null,
  visitorId: string,
  day: string,
): { record: VisitorRecord; isReturn: boolean } {
  if (!record || !record.firstPlayDay) {
    return { record: { visitorId, firstPlayDay: day, returnDays: [] }, isReturn: false };
  }
  const next: VisitorRecord = { ...record, visitorId: record.visitorId || visitorId, returnDays: [...record.returnDays] };
  const [year, month, date] = next.firstPlayDay.split('-').map(Number);
  const following = new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
  if (day !== following) return { record: next, isReturn: false };
  if (next.returnDays.includes(day)) return { record: next, isReturn: false };
  next.returnDays.push(day);
  return { record: next, isReturn: true };
}

/** Random, browser-scoped, and deliberately not derived from anything about the person. */
export function newRandomId(prefix: string): string {
  const bytes = new Uint8Array(16);
  try {
    (globalThis.crypto as Crypto | undefined)?.getRandomValues?.(bytes);
  } catch {
    /* falls through to Math.random below */
  }
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  if (/^0*$/.test(hex)) hex = Math.random().toString(16).slice(2).padEnd(32, '0').slice(0, 32);
  return `${prefix}_${hex}`;
}

export type VisitRecord = { visitId: string; lastActiveAt: number };

/** Continue the tab's visit, or start a new one once it has gone stale. */
export function resolveVisit(stored: VisitRecord | null, now: number): { visit: VisitRecord; started: boolean } {
  if (stored && stored.visitId && now - stored.lastActiveAt < VISIT_IDLE_EXPIRY_MS) {
    return { visit: { visitId: stored.visitId, lastActiveAt: now }, started: false };
  }
  return { visit: { visitId: newRandomId('visit'), lastActiveAt: now }, started: true };
}
