/**
 * The measurement definitions, tested rather than asserted.
 *
 * Each test here corresponds to a claim we intend to make about a number in a
 * report, and most of them are negative: the value of this file is that it
 * fails when something starts counting a player who never played.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITY_TIMEOUT_MS,
  ENGAGED_PLAY_THRESHOLD_MS,
  VISIT_IDLE_EXPIRY_MS,
  applyGameplaySignal,
  emptyEngagement,
  localDay,
  noteVerifiedPlayDay,
  parseGameplayMessage,
  resolveVisit,
} from '../lib/gameplay-signals.ts';
import { gameSignalAdapter, startSignalFromProgress, verifiedSignalGameIds } from '../lib/game-adapters.ts';
import {
  CAMPAIGN_EVENTS,
  PROXY_GAMEPLAY_EVENTS,
  VERIFIED_GAMEPLAY_EVENTS,
  isVerifiedGameplayEvent,
  sanitizeData,
} from '../lib/campaign-analytics.ts';
import { liveInviteUrl } from '../lib/play-session-core.ts';

/** Drive a sequence of signals through the accumulator and collect the events. */
function run(signals, opts = {}) {
  let state = opts.state ?? emptyEngagement();
  let lastTick = null;
  const events = [];
  for (const entry of signals) {
    const result = applyGameplaySignal({
      state,
      signal: entry.signal,
      now: entry.now,
      documentVisible: entry.visible !== false,
      lastTick,
    });
    state = result.state;
    lastTick = entry.dropTick ? null : result.lastTick;
    events.push(...result.events);
  }
  return { state, events };
}

const names = (events) => events.map((e) => e.name);
/** A stream of ticks that all look like genuine play. */
function playTicks(runId, fromMs, count, stepMs = 1000) {
  return Array.from({ length: count }, (_, i) => ({
    now: fromMs + i * stepMs,
    signal: { type: 'progress', runId, active: true, fingerprint: `f${i}` },
  }));
}

/* ── NEGATIVE: nothing counts a player who did not play ─────────────────── */

test('a game that is only loading produces no verified start', () => {
  // What the adapter sees before anyone plays: the bridge exists, no hero yet.
  const adapter = gameSignalAdapter('nightclub-showdown-inzone-production');
  const win = {
    NightclubBridge: { getState: () => ({ runId: 'run-1', ended: false, snapshot: {} }) },
    __NightclubRuntime: { Game: { ME: {} }, Main: { ME: { paused: false } } },
  };
  const signals = adapter.read(win, 'mount1');
  assert.deepEqual(signals.map((s) => s.type), ['ready'], 'no hero means ready only');
  const { events } = run(signals.map((s) => ({ now: 1000, signal: s })));
  assert.deepEqual(names(events), ['game_ready']);
});

test('an idle refresh produces no verified start', () => {
  // The build reports in, but nothing about it has changed.
  const prev = 'w0:l3:m2:4.7:6';
  const signal = { type: 'progress', runId: 'm:run-1', active: true, fingerprint: prev };
  assert.equal(startSignalFromProgress(prev, signal), null);
  const { events } = run([
    { now: 1000, signal },
    { now: 2000, signal },
    { now: 3000, signal },
  ]);
  assert.deepEqual(names(events), [], 'an unchanging game emits nothing');
});

test('hidden-tab time does not advance engagement', () => {
  const ticks = playTicks('r1', 0, 200).map((t) => ({ ...t, visible: false }));
  const { state, events } = run([{ now: 0, signal: { type: 'start', runId: 'r1' } }, ...ticks]);
  assert.equal(state.activeMs, 0);
  assert.deepEqual(names(events), ['game_start']);
});

test('paused time does not advance engagement', () => {
  const ticks = Array.from({ length: 200 }, (_, i) => ({
    now: i * 1000,
    signal: { type: 'progress', runId: 'r1', active: false, fingerprint: `f${i}` },
  }));
  const { state, events } = run([{ now: 0, signal: { type: 'start', runId: 'r1' } }, ...ticks]);
  assert.equal(state.activeMs, 0, 'active:false is never credited');
  assert.deepEqual(names(events), ['game_start']);
});

test('an idle menu does not advance engagement even while it animates', () => {
  // A changing fingerprint on a run that never started: a title screen loop.
  const { state, events } = run(playTicks('r-not-started', 0, 200));
  assert.equal(state.activeMs, 0);
  assert.deepEqual(names(events), []);
});

test('a gap longer than the activity timeout is not credited', () => {
  const { state } = run([
    { now: 0, signal: { type: 'start', runId: 'r1' } },
    { now: 0, signal: { type: 'progress', runId: 'r1', active: true, fingerprint: 'a' } },
    { now: ACTIVITY_TIMEOUT_MS + 5000, signal: { type: 'progress', runId: 'r1', active: true, fingerprint: 'b' } },
  ]);
  assert.equal(state.activeMs, 0, 'the player was away, so the gap is not play');
});

test('duplicate start callbacks do not inflate starts', () => {
  const { events } = run([
    { now: 0, signal: { type: 'start', runId: 'r1' } },
    { now: 10, signal: { type: 'start', runId: 'r1' } },
    { now: 20, signal: { type: 'start', runId: 'r1' } },
  ]);
  assert.deepEqual(names(events), ['game_start'], 'one run, one start');
});

test('a game over for a run that never started is ignored', () => {
  const { events } = run([{ now: 0, signal: { type: 'over', runId: 'never-started', outcome: 'loss' } }]);
  assert.deepEqual(names(events), [], 'a build that reports "over" on load proves nothing');
});

test('duplicate game overs emit once per visit', () => {
  const { events } = run([
    { now: 0, signal: { type: 'start', runId: 'r1' } },
    { now: 100, signal: { type: 'over', runId: 'r1', outcome: 'loss' } },
    { now: 200, signal: { type: 'over', runId: 'r1', outcome: 'loss' } },
  ]);
  assert.deepEqual(names(events), ['game_start', 'first_game_over']);
});

test('engaged_play is emitted at most once per visit', () => {
  const first = run([{ now: 0, signal: { type: 'start', runId: 'r1' } }, ...playTicks('r1', 0, 80)]);
  assert.deepEqual(names(first.events), ['game_start', 'engaged_play']);
  // Continue playing in the same visit: no second engaged_play.
  const second = run(playTicks('r1', 200000, 80, 1000).map((t) => t), { state: first.state });
  assert.equal(second.events.filter((e) => e.name === 'engaged_play').length, 0);
});

test('a message from a previous mount or another game is rejected', () => {
  const ctx = { hostOrigin: 'https://www.inzone.games', gameId: 'game-a', frameWindow: { id: 'current' } };
  const good = {
    origin: 'https://www.inzone.games',
    source: ctx.frameWindow,
    data: { inzone: 'gameplay', v: 1, type: 'start', gameId: 'game-a', runId: 'r1' },
  };
  assert.deepEqual(parseGameplayMessage(good, ctx), { type: 'start', runId: 'r1' });

  // Same message, from the window of a frame we already replaced.
  assert.equal(parseGameplayMessage({ ...good, source: { id: 'stale' } }, ctx), null);
  // Right frame, wrong game: a late signal after a switch.
  assert.equal(
    parseGameplayMessage({ ...good, data: { ...good.data, gameId: 'game-b' } }, ctx),
    null,
  );
  // Another origin entirely.
  assert.equal(parseGameplayMessage({ ...good, origin: 'https://evil.example' }, ctx), null);
});

test('malformed gameplay messages are rejected', () => {
  const ctx = { hostOrigin: 'https://o', gameId: 'g', frameWindow: {} };
  const base = { origin: 'https://o', source: ctx.frameWindow };
  const bad = [
    undefined,
    null,
    'start',
    { inzone: 'other', v: 1, type: 'start', gameId: 'g', runId: 'r' },
    { inzone: 'gameplay', v: 2, type: 'start', gameId: 'g', runId: 'r' },
    { inzone: 'gameplay', v: 1, type: 'start', gameId: 'g' },
    { inzone: 'gameplay', v: 1, type: 'nope', gameId: 'g', runId: 'r' },
    { inzone: 'gameplay', v: 1, type: 'progress', gameId: 'g', runId: 'r', active: 'yes', fingerprint: 'f' },
    { inzone: 'gameplay', v: 1, type: 'progress', gameId: 'g', runId: 'r', active: true },
  ];
  for (const data of bad) assert.equal(parseGameplayMessage({ ...base, data }, ctx), null, JSON.stringify(data));
});

test('a game with no adapter has no verified signal at all', () => {
  assert.equal(gameSignalAdapter('flappybird-inzone-2'), null);
  assert.equal(gameSignalAdapter('karate-bros'), null);
  assert.deepEqual(verifiedSignalGameIds(), ['nightclub-showdown-inzone-production']);
});

test('frame load and focus are named proxies, never verified gameplay', () => {
  for (const name of PROXY_GAMEPLAY_EVENTS) assert.equal(isVerifiedGameplayEvent(name), false, name);
  for (const name of VERIFIED_GAMEPLAY_EVENTS) assert.equal(isVerifiedGameplayEvent(name), true, name);
  assert.equal(isVerifiedGameplayEvent(CAMPAIGN_EVENTS.gameFrameLoaded), false);
  assert.equal(isVerifiedGameplayEvent(CAMPAIGN_EVENTS.gameStart), true);
});

/* ── POSITIVE: real play produces the right events ──────────────────────── */

test('the first state change of a run is its start', () => {
  const signal = { type: 'progress', runId: 'r1', active: true, fingerprint: 'after' };
  assert.deepEqual(startSignalFromProgress('before', signal), { type: 'start', runId: 'r1' });
  // With nothing to compare against we do not guess.
  assert.equal(startSignalFromProgress(null, signal), null);
});

test('the adapter reads the build\'s own run id, end state and activity', () => {
  const adapter = gameSignalAdapter('nightclub-showdown-inzone-production');
  const win = {
    NightclubBridge: { getState: () => ({ runId: 'run-2', ended: false, snapshot: { waveId: 1, heroLife: 3, mobsAlive: 2 } }) },
    __NightclubRuntime: { Game: { ME: { hero: { cx: 8, xr: 0.5, ammo: 5 } } }, Main: { ME: { paused: false } } },
  };
  const signals = adapter.read(win, 'mountX');
  assert.deepEqual(signals.map((s) => s.type), ['ready', 'progress']);
  assert.equal(signals[1].runId, 'mountX:run-2', 'run ids are scoped to the mount');
  assert.equal(signals[1].active, true);
  assert.equal(signals[1].fingerprint, '1:3:2:8.5:5');

  // Paused: still reporting, but not active.
  const paused = adapter.read(
    { ...win, __NightclubRuntime: { ...win.__NightclubRuntime, Main: { ME: { paused: true } } } },
    'mountX',
  );
  assert.equal(paused[1].active, false);

  // Ended: the build's own loss, surfaced as a game over.
  const ended = adapter.read(
    { ...win, NightclubBridge: { getState: () => ({ runId: 'run-2', ended: true, outcome: 'loss', snapshot: {} }) } },
    'mountX',
  );
  assert.deepEqual(ended.map((s) => s.type), ['ready', 'progress', 'over']);
  assert.equal(ended[2].outcome, 'loss');
  assert.equal(ended[1].active, false, 'a finished run is not active play');
});

test('60 cumulative active seconds across several attempts emits one engaged_play', () => {
  // Three short attempts of 25s, 25s and 15s: nobody lasts a minute, but the
  // visit does.
  const seq = [];
  let t = 0;
  for (const [i, secs] of [25, 25, 15].entries()) {
    const runId = `r${i}`;
    seq.push({ now: t, signal: { type: 'start', runId } });
    seq.push(...playTicks(runId, t, secs));
    t += secs * 1000 + 500;
    seq.push({ now: t, signal: { type: 'over', runId, outcome: 'loss' } });
    t += 500;
  }
  const { state, events } = run(seq);
  const engaged = events.filter((e) => e.name === 'engaged_play');
  assert.equal(engaged.length, 1, 'exactly one engaged_play per visit');
  assert.ok(state.activeMs >= ENGAGED_PLAY_THRESHOLD_MS);
  // The three starts and only the first game over.
  assert.equal(events.filter((e) => e.name === 'game_start').length, 3, 'three rounds');
  assert.equal(events.filter((e) => e.name === 'first_game_over').length, 1);
});

test('a replay is a new round with its own start', () => {
  const { events } = run([
    { now: 0, signal: { type: 'start', runId: 'mount1:run-1' } },
    { now: 100, signal: { type: 'over', runId: 'mount1:run-1', outcome: 'loss' } },
    { now: 200, signal: { type: 'start', runId: 'mount1:run-2' } },
  ]);
  assert.deepEqual(names(events), ['game_start', 'first_game_over', 'game_start']);
});

/* ── Return play and visits ─────────────────────────────────────────────── */

test('return_play only counts a later day, and only once', () => {
  const first = noteVerifiedPlayDay(null, 'visitor_1', '2026-09-14');
  assert.equal(first.isReturn, false, 'the first day is never a return');

  const sameDay = noteVerifiedPlayDay(first.record, 'visitor_1', '2026-09-14');
  assert.equal(sameDay.isReturn, false, 'more play on day one is not a return');

  const nextDay = noteVerifiedPlayDay(sameDay.record, 'visitor_1', '2026-09-15');
  assert.equal(nextDay.isReturn, true);

  const againSameDay = noteVerifiedPlayDay(nextDay.record, 'visitor_1', '2026-09-15');
  assert.equal(againSameDay.isReturn, false, 'a refresh cannot re-emit the return');

  const dayAfter = noteVerifiedPlayDay(againSameDay.record, 'visitor_1', '2026-09-16');
  assert.equal(dayAfter.isReturn, true, 'a further day is a further return');
});

test('local day is the visitor\'s own calendar day', () => {
  assert.match(localDay(new Date(2026, 8, 14, 23, 59)), /^2026-09-14$/);
  assert.match(localDay(new Date(2026, 8, 15, 0, 1)), /^2026-09-15$/);
});

test('a visit resumes across a refresh and expires when stale', () => {
  const now = 1_000_000;
  const fresh = resolveVisit({ visitId: 'visit_abc', lastActiveAt: now - 60_000 }, now);
  assert.equal(fresh.started, false);
  assert.equal(fresh.visit.visitId, 'visit_abc', 'a refresh continues the visit');

  const stale = resolveVisit({ visitId: 'visit_abc', lastActiveAt: now - VISIT_IDLE_EXPIRY_MS - 1 }, now);
  assert.equal(stale.started, true);
  assert.notEqual(stale.visit.visitId, 'visit_abc');

  const none = resolveVisit(null, now);
  assert.equal(none.started, true);
  assert.match(none.visit.visitId, /^visit_[0-9a-f]{32}$/);
});

/* ── Privacy of the new properties ─────────────────────────────────────── */

test('measurement properties survive sanitising and secrets still do not', () => {
  const clean = sanitizeData({
    game_id: 'nightclub-showdown-inzone-production',
    run_id: 'mount_abc:run-2',
    visit_id: 'visit_1',
    visitor_id: 'visitor_1',
    day: '2026-09-15',
    timezone: 'Europe/London',
    signal_source: 'same-origin-adapter',
    acquisition: 'invite',
    outcome: 'loss',
    active_seconds: 61,
    utm_source: 'facebook',
  });
  assert.equal(clean.run_id, 'mount_abc:run-2');
  assert.equal(clean.active_seconds, 61);
  assert.equal(clean.acquisition, 'invite');
  assert.equal(clean.utm_source, 'facebook');

  const dirty = sanitizeData({
    session: 'a'.repeat(32),
    session_id: 'x',
    invite: 'https://www.inzone.games/session-prototype?session=' + 'a'.repeat(32),
    text: 'hello from chat',
    message: 'private',
    url: 'https://www.inzone.games/x?session=' + 'a'.repeat(32),
    token: 'secret',
    active_seconds: -5,
    nonsense: 'dropped',
  });
  assert.deepEqual(dirty, {}, 'nothing sensitive and nothing unrecognised gets through');
});

test('an invite link carries no campaign attribution', () => {
  const link = liveInviteUrl('https://www.inzone.games', {
    gameId: 'nightclub-showdown-inzone-production',
    sessionId: 'b'.repeat(32),
  });
  const url = new URL(link);
  assert.deepEqual([...url.searchParams.keys()].sort(), ['game', 'session']);
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    assert.equal(url.searchParams.get(key), null, `${key} must not ride along on an invite`);
  }
});
