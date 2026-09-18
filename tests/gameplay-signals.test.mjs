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
import { connectNightclubGameplay } from '../lib/nightclub-gameplay-adapter.ts';
import { gameSignalAdapter, progressStartKey, startSignalFromProgress, verifiedSignalGameIds } from '../lib/game-adapters.ts';
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
  let lastTick = opts.lastTick ?? null;
  let lastAction = opts.lastAction ?? null;
  const events = [];
  for (const entry of signals) {
    const result = applyGameplaySignal({
      state,
      signal: entry.signal,
      now: entry.now,
      documentVisible: entry.visible !== false,
      lastTick,
      lastAction,
    });
    state = result.state;
    lastTick = entry.dropTick ? null : result.lastTick;
    lastAction = result.lastAction;
    events.push(...result.events);
  }
  return { state, events, lastTick, lastAction };
}

const names = (events) => events.map((e) => e.name);
/** A stream of ticks that all look like genuine play. */
function playTicks(runId, fromMs, count, stepMs = 1000) {
  return Array.from({ length: count }, (_, i) => ({
    now: fromMs + i * stepMs,
    signal: { type: 'progress', runId, active: true, fingerprint: `f${i}` },
  }));
}

/** Mirrors inspected v2 Nightclub: heroHistory from executeAction, cinematic boot. */
function nightclubFixture() {
  const heroHistory = [];
  const mobs = [];
  const hero = { cx: 8, xr: 0.5, ammo: 6 };
  let cinematic = true;
  let paused = false;
  let ended = false;
  let runId = 'run-1';
  const gameME = {
    hero,
    heroHistory,
    isReplay: false,
    hasCinematic: () => cinematic,
  };
  const win = {
    location: { pathname: '/gcs/games/nightclub-showdown-inzone-production/v2/index.html' },
    NightclubBridge: {
      getState: () => ({
        runId,
        ended,
        outcome: ended ? 'loss' : '',
        snapshot: { waveId: 1, heroLife: 3, mobsAlive: mobs.filter((m) => !m.destroyed).length },
      }),
    },
    __NightclubRuntime: {
      Game: { ME: gameME },
      Main: { ME: { get paused() { return paused; } } },
      en_Mob: { ALL: mobs },
    },
  };
  return {
    win,
    hero,
    heroHistory,
    mobs,
    bootReload() { heroHistory.push({ t: 1, a: { _hx_index: 9 } }); hero.ammo = 6; },
    walkHeroWithoutAction() { hero.cx = 8; hero.xr = 0.2; },
    endCinematic() { cinematic = false; },
    spawnMob() { mobs.push({ cx: 1 + mobs.length, xr: 0, life: 2, destroyed: false }); },
    walkMobs() { for (const m of mobs) m.cx += 0.3; },
    bumpHero() { hero.cx += 0.4; },
    autoReload() { hero.ammo = 6; },
    move() { hero.cx += 1; heroHistory.push({ t: heroHistory.length, a: { _hx_index: 3, x: 0, y: 0 } }); },
    shoot() { hero.ammo -= 1; heroHistory.push({ t: heroHistory.length, a: { _hx_index: 1, e: {} } }); },
    miss() { heroHistory.push({ t: heroHistory.length, a: { _hx_index: 0 } }); },
    setPaused(v) { paused = v; },
    setEnded(v) { ended = v; },
    newRun() {
      runId = 'run-2';
      ended = false;
      cinematic = true;
      heroHistory.length = 0;
      hero.cx = 8; hero.xr = 0.5; hero.ammo = 6;
    },
  };
}

/* ── NEGATIVE: nothing counts a player who did not play ─────────────────── */

test('a game that is only loading produces no verified start', () => {
  // What the adapter sees before anyone plays: the bridge exists, no hero yet.
  const adapter = gameSignalAdapter('nightclub-showdown-inzone-production');
  const win = {
    NightclubBridge: { getState: () => ({ runId: 'run-1', ended: false, snapshot: {} }) },
    __NightclubRuntime: { Game: { ME: {} }, Main: { ME: { paused: false } } },
  };
  const connection = adapter.connect(win, 'mount1', () => {});
  const signals = connection.read();
  assert.deepEqual(signals.map((s) => s.type), ['ready'], 'no hero means ready only');
  assert.equal(signals[0].runId, undefined, 'ready is about the build, not a run');
  const { events } = run(signals.map((s) => ({ now: 1000, signal: s })));
  assert.deepEqual(names(events), ['game_ready']);
  connection.dispose();
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
  assert.equal(gameSignalAdapter('unsupported-game'), null);
  assert.equal(gameSignalAdapter('karate-bros'), null);
  assert.deepEqual(verifiedSignalGameIds(), ['nightclub-showdown-inzone-production', 'flappybird-inzone-2']);
});

test('frame load and focus are named proxies, never verified gameplay', () => {
  for (const name of PROXY_GAMEPLAY_EVENTS) assert.equal(isVerifiedGameplayEvent(name), false, name);
  for (const name of VERIFIED_GAMEPLAY_EVENTS) assert.equal(isVerifiedGameplayEvent(name), true, name);
  assert.equal(isVerifiedGameplayEvent(CAMPAIGN_EVENTS.gameFrameLoaded), false);
  assert.equal(isVerifiedGameplayEvent(CAMPAIGN_EVENTS.gameStart), true);
  assert.equal(isVerifiedGameplayEvent(CAMPAIGN_EVENTS.appCtaView), false);
  assert.equal(isVerifiedGameplayEvent(CAMPAIGN_EVENTS.appCtaClick), false);
});

/* ── POSITIVE: real play produces the right events ──────────────────────── */

test('the first state change of a run is its start', () => {
  const signal = { type: 'progress', runId: 'r1', active: true, fingerprint: 'after' };
  assert.deepEqual(startSignalFromProgress('before', signal), { type: 'start', runId: 'r1' });
  // With nothing to compare against we do not guess.
  assert.equal(startSignalFromProgress(null, signal), null);
});

test('Nightclub boot cinematic and autonomous board churn are not a verified start', () => {
  const f = nightclubFixture();
  const signals = [];
  const c = connectNightclubGameplay(f.win, 'm', (s) => signals.push(s));
  f.bootReload();
  f.walkHeroWithoutAction();
  f.spawnMob();
  const duringIntro = c.read();
  assert.equal(duringIntro.find((s) => s.type === 'progress').actionFingerprint, '0');
  assert.equal(duringIntro.some((s) => s.type === 'start'), false);
  f.endCinematic();
  f.walkMobs();
  f.bumpHero();
  f.autoReload();
  const afterBoot = c.read();
  const progress = afterBoot.find((s) => s.type === 'progress');
  assert.notEqual(progress.fingerprint, duringIntro.find((s) => s.type === 'progress').fingerprint, 'the board and hero fields changed');
  assert.equal(progress.actionFingerprint, '0', 'heroHistory gained no player action');
  assert.equal(afterBoot.some((s) => s.type === 'start'), false);
  assert.deepEqual(signals, []);
  c.dispose();
});

test('Nightclub start is one real executeAction; boot time does not accrue', () => {
  const f = nightclubFixture();
  let state = emptyEngagement();
  let lastTick = null;
  let lastAction = null;
  const events = [];
  const fold = (now, signal) => {
    const r = applyGameplaySignal({ state, lastTick, lastAction, now, signal, documentVisible: true });
    state = r.state; lastTick = r.lastTick; lastAction = r.lastAction; events.push(...r.events);
  };
  const c = connectNightclubGameplay(f.win, 'm', (s) => fold(now, s));
  let now = 0;
  f.bootReload();
  c.read().forEach((s) => fold(now, s));
  now = 1000;
  f.endCinematic();
  f.walkMobs();
  c.read().forEach((s) => fold(now, s));
  now = 2000;
  f.walkMobs();
  c.read().forEach((s) => fold(now, s));
  assert.deepEqual(names(events), ['game_ready'], 'boot and idle board motion are not play');
  assert.equal(state.activeMs, 0);
  now = 3000;
  f.move();
  c.read().forEach((s) => fold(now, s));
  assert.deepEqual(names(events), ['game_ready', 'game_start']);
  assert.equal(state.startedRuns.length, 1);
  now = 4000;
  f.shoot();
  c.read().forEach((s) => fold(now, s));
  assert.equal(events.filter((e) => e.name === 'game_start').length, 1, 'one run, one start');
  assert.equal(state.activeMs, 1000, 'only the interval after the step is credited');
  c.dispose();
});

test('the adapter reads the build\'s own run id, end state and activity', () => {
  const f = nightclubFixture();
  f.endCinematic();
  const c = connectNightclubGameplay(f.win, 'mountX', () => {});
  const signals = c.read();
  assert.deepEqual(signals.map((s) => s.type), ['ready', 'progress']);
  assert.equal(signals[1].runId, 'mountX:run-1', 'run ids are scoped to the mount');
  assert.equal(signals[1].active, true);
  assert.equal(signals[1].actionFingerprint, '0');
  assert.match(signals[1].fingerprint, /^1:3:0:8.5:6:/);

  f.setPaused(true);
  assert.equal(c.read()[1].active, false);

  f.setPaused(false);
  f.setEnded(true);
  const ended = c.read();
  assert.deepEqual(ended.map((s) => s.type), ['ready', 'progress', 'over']);
  assert.equal(ended[2].outcome, 'loss');
  assert.equal(ended[1].active, false, 'a finished run is not active play');
  c.dispose();
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

test('one player action then autonomous board motion stops after the grace', () => {
  const seq = [
    { now: 0, signal: { type: 'start', runId: 'r1' } },
    { now: 0, signal: { type: 'progress', runId: 'r1', active: true, fingerprint: 'board0', actionFingerprint: '1' } },
  ];
  for (let i = 1; i <= 12; i++) {
    seq.push({
      now: i * 1000,
      signal: { type: 'progress', runId: 'r1', active: true, fingerprint: `board${i}`, actionFingerprint: '1' },
    });
  }
  const { state, events } = run(seq);
  assert.deepEqual(names(events), ['game_start']);
  assert.equal(state.activeMs, ACTIVITY_TIMEOUT_MS, 'grace is 5s; enemy motion does not extend it');
  assert.equal(state.engagedSent, false);
});

test('repeated real actions accumulate 60s into one engaged_play', () => {
  const seq = [{ now: 0, signal: { type: 'start', runId: 'r1' } }];
  for (let i = 0; i <= 70; i++) {
    seq.push({
      now: i * 1000,
      signal: {
        type: 'progress',
        runId: 'r1',
        active: true,
        fingerprint: `board${i}`,
        actionFingerprint: String(1 + Math.floor(i / 3)),
      },
    });
  }
  const { state, events } = run(seq);
  assert.equal(events.filter((e) => e.name === 'game_start').length, 1);
  assert.equal(events.filter((e) => e.name === 'engaged_play').length, 1);
  assert.ok(state.activeMs >= ENGAGED_PLAY_THRESHOLD_MS);
});

test('pause, hidden tab, resume, game-over and refresh do not overcount', () => {
  const act = (now, key, fingerprint, extra = {}) => ({
    now,
    signal: { type: 'progress', runId: extra.runId ?? 'r1', active: extra.active !== false, fingerprint, actionFingerprint: key },
    visible: extra.visible !== false,
  });
  const first = run([
    { now: 0, signal: { type: 'start', runId: 'r1' } },
    act(0, '1', 'a'),
    act(1000, '1', 'b'),
    act(2000, '1', 'c', { active: false }),
    act(3000, '1', 'd'),
  ]);
  assert.equal(first.state.activeMs, 1000, 'paused interval is dropped');

  const hidden = run([
    { now: 0, signal: { type: 'start', runId: 'r1' } },
    act(0, '1', 'a'),
    act(1000, '1', 'b'),
    act(2000, '1', 'c', { visible: false }),
    { now: 3000, signal: { type: 'progress', runId: 'r1', active: true, fingerprint: 'd', actionFingerprint: '1' } },
    act(4000, '1', 'e'),
  ]);
  assert.equal(hidden.state.activeMs, 2000, 'hidden interval is dropped; leftover wall-clock grace is not a new action');

  const over = run([
    { now: 0, signal: { type: 'start', runId: 'r1' } },
    act(0, '1', 'a'),
    act(1000, '1', 'b'),
    { now: 1500, signal: { type: 'over', runId: 'r1', outcome: 'loss' } },
    act(2000, '1', 'c'),
    { now: 2000, signal: { type: 'start', runId: 'r2' } },
    act(2000, '1', 'n0', { runId: 'r2' }),
    act(3000, '1', 'n1', { runId: 'r2' }),
  ]);
  assert.equal(over.events.filter((e) => e.name === 'first_game_over').length, 1);
  assert.equal(over.state.activeMs, 2000, 'post-over idle of the dead run is not credited; new run starts its own grace');

  const engaged = run([
    { now: 0, signal: { type: 'start', runId: 'r1' } },
    ...Array.from({ length: 70 }, (_, i) => ({
      now: i * 1000,
      signal: { type: 'progress', runId: 'r1', active: true, fingerprint: `f${i}`, actionFingerprint: String(1 + Math.floor(i / 2)) },
    })),
  ]);
  assert.equal(engaged.events.filter((e) => e.name === 'engaged_play').length, 1);
  const refresh = run(
    Array.from({ length: 20 }, (_, i) => ({
      now: 80_000 + i * 1000,
      signal: { type: 'progress', runId: 'r1', active: true, fingerprint: `z${i}`, actionFingerprint: '1' },
    })),
    { state: engaged.state },
  );
  assert.equal(refresh.events.filter((e) => e.name === 'engaged_play').length, 0, 'a refresh of persisted engagement cannot re-emit');
});

test('Nightclub miss-clicks and unknown builds fail closed', () => {
  const f = nightclubFixture();
  f.endCinematic();
  const c = connectNightclubGameplay(f.win, 'm', () => {});
  c.read();
  f.miss();
  assert.equal(c.read().some((s) => s.type === 'start'), false, 'None is not a player action');
  c.dispose();
  f.win.location.pathname = '/gcs/games/nightclub-showdown-inzone-production/v3/index.html';
  assert.equal(connectNightclubGameplay(f.win, 'm', () => {}), null);
});

/* ── Return play and visits ─────────────────────────────────────────────── */

test('return_play counts exactly the next day, and only once', () => {
  const first = noteVerifiedPlayDay(null, 'visitor_1', '2026-09-14');
  assert.equal(first.isReturn, false, 'the first day is never a return');

  const sameDay = noteVerifiedPlayDay(first.record, 'visitor_1', '2026-09-14');
  assert.equal(sameDay.isReturn, false, 'more play on day one is not a return');

  const nextDay = noteVerifiedPlayDay(sameDay.record, 'visitor_1', '2026-09-15');
  assert.equal(nextDay.isReturn, true);

  const againSameDay = noteVerifiedPlayDay(nextDay.record, 'visitor_1', '2026-09-15');
  assert.equal(againSameDay.isReturn, false, 'a refresh cannot re-emit the return');

  const dayAfter = noteVerifiedPlayDay(againSameDay.record, 'visitor_1', '2026-09-16');
  assert.equal(dayAfter.isReturn, false, 'later returns are not next-day retention');
  assert.equal(noteVerifiedPlayDay(first.record, 'visitor_1', '2026-09-20').isReturn, false);
  assert.equal(noteVerifiedPlayDay({visitorId:'visitor_1',firstPlayDay:'2026-12-31',returnDays:[]}, 'visitor_1', '2027-01-01').isReturn, true);
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
  assert.equal(
    sanitizeData({ cta_surface: 'hub_nav', outcome: 'apple' }).cta_surface,
    'hub_nav',
  );
  assert.equal(sanitizeData({ cta_surface: 'hub_nav' }).cta_surface, 'hub_nav');
  assert.equal(
    sanitizeData({ cta_surface: 'https://www.inzone.games/session-prototype?session=aabbccddeeff00112233445566778899' }).cta_surface,
    undefined,
    'invite URLs are not a legal cta_surface',
  );
  assert.equal(sanitizeData({ cta_surface: 'install_banner' }).cta_surface, undefined);

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
