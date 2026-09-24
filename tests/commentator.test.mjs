/**
 * Rules coverage for lib/companion/commentator.ts.
 *
 * The commentator is the whole "what should Rook say and when" layer, split
 * out of GameCompanion so its rules are testable without React or audio APIs.
 * If a rule here is wrong, Rook will speak over the game or repeat itself in a
 * way the player will notice on the first round.
 *
 * Every case pins a rule from lib/companion/commentator.ts's header:
 *   - Only real snapshot-to-snapshot transitions trigger commentary.
 *   - Paused / cinematic snapshots suppress everything for that pair.
 *   - Cooldown drops in-cooldown triggers, does not queue.
 *   - Recent lines are kept out of rotation.
 *   - First snapshot alone never speaks (needs two frames).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_COMMENTARY_LINES,
  COMMENTARY_COOLDOWN_MS,
  COMMENTARY_LINES,
  COMMENTARY_NO_REPEAT_WINDOW,
  buildContextualLine,
  decideCommentary,
  detectTriggers,
  initialCommentatorState,
} from '../lib/companion/commentator.ts';

// ── detectTriggers ──────────────────────────────────────────────────────

test('detectTriggers returns nothing on the first snapshot (no prior to compare)', () => {
  assert.deepEqual(detectTriggers(null, { runId: 'run-1', heroLife: 10 }), []);
});

test('detectTriggers returns nothing while paused or in a cinematic', () => {
  const prev = { runId: 'run-1', heroLife: 10, waveId: 1 };
  assert.deepEqual(
    detectTriggers(prev, { runId: 'run-1', heroLife: 8, waveId: 2, paused: true }),
    [],
  );
  assert.deepEqual(
    detectTriggers(prev, { runId: 'run-1', heroLife: 8, waveId: 2, cinematic: true }),
    [],
  );
});

test('round_start fires when a new runId appears without a prior end', () => {
  const t = detectTriggers({ runId: '' }, { runId: 'run-1' });
  assert.equal(t.length, 1);
  assert.equal(t[0].kind, 'round_start');
  assert.match(t[0].evidence, /run-1/);
});

test('retry fires when a new runId follows an ended run', () => {
  const t = detectTriggers({ runId: 'run-1', ended: true }, { runId: 'run-2' });
  const retry = t.find((x) => x.kind === 'retry');
  assert.ok(retry, 'retry trigger present');
  assert.match(retry.evidence, /run-1.*run-2/);
});

test('wave_advance fires only when waveId strictly increases', () => {
  assert.deepEqual(detectTriggers({ waveId: 3 }, { waveId: 3 }), []);
  const forward = detectTriggers({ waveId: 3 }, { waveId: 4 });
  assert.equal(forward[0].kind, 'wave_advance');
  const backward = detectTriggers({ waveId: 4 }, { waveId: 3 });
  assert.deepEqual(backward, []);
});

test('life_lost fires when heroLife drops but stays above 0; close_call piggybacks at ≤3', () => {
  const t = detectTriggers({ heroLife: 10 }, { heroLife: 8 });
  assert.equal(t.length, 1);
  assert.equal(t[0].kind, 'life_lost');

  const closeCall = detectTriggers({ heroLife: 5 }, { heroLife: 3 });
  const kinds = closeCall.map((c) => c.kind);
  assert.deepEqual(kinds.sort(), ['close_call', 'life_lost'].sort());

  const dead = detectTriggers({ heroLife: 1 }, { heroLife: 0 });
  assert.equal(dead.length, 0, 'heroLife hitting 0 is not life_lost — the round_over_loss carries it');
});

test('low_ammo fires only on the entering transition (prev>2, curr≤2), not while staying low', () => {
  const cross = detectTriggers({ ammo: 5 }, { ammo: 2 });
  assert.ok(cross.some((c) => c.kind === 'low_ammo'));
  const stay = detectTriggers({ ammo: 2 }, { ammo: 1 });
  assert.ok(!stay.some((c) => c.kind === 'low_ammo'));
});

test('mob_wipe fires when mobsAlive crosses to 0 from a positive value', () => {
  const wipe = detectTriggers({ mobsAlive: 4 }, { mobsAlive: 0 });
  assert.ok(wipe.some((c) => c.kind === 'mob_wipe'));
  const stillZero = detectTriggers({ mobsAlive: 0 }, { mobsAlive: 0 });
  assert.ok(!stillZero.some((c) => c.kind === 'mob_wipe'));
});

test('round_over_win / round_over_loss / round_over_draw are three distinct results', () => {
  const win = detectTriggers(
    { runId: 'run-1', ended: false },
    { runId: 'run-1', ended: true, outcome: 'win' },
  );
  assert.equal(win[0].kind, 'round_over_win');

  const loss = detectTriggers(
    { runId: 'run-1', ended: false },
    { runId: 'run-1', ended: true, outcome: 'defeat' },
  );
  assert.equal(loss[0].kind, 'round_over_loss');

  // Regression: an earlier version of detectTriggers classified 'draw' as a
  // loss. A draw is neither win nor loss; it gets its own trigger so Rook does
  // not react with "rough one" on an even result.
  const drawn = detectTriggers(
    { runId: 'run-1', ended: false },
    { runId: 'run-1', ended: true, outcome: 'draw' },
  );
  assert.equal(drawn[0].kind, 'round_over_draw');
  assert.ok(!drawn.some((c) => c.kind === 'round_over_loss'));

  const unknown = detectTriggers(
    { runId: 'run-1', ended: false },
    { runId: 'run-1', ended: true, outcome: 'strange' },
  );
  assert.ok(!unknown.some(
    (c) => c.kind === 'round_over_win' || c.kind === 'round_over_loss' || c.kind === 'round_over_draw',
  ));
});

test('result triggers come first so a cooldown picking triggers[0] favours the highest-priority beat', () => {
  const t = detectTriggers(
    { runId: 'run-1', ended: false, waveId: 3, heroLife: 5, ammo: 5 },
    {
      runId: 'run-1',
      ended: true,
      outcome: 'win',
      waveId: 4,
      heroLife: 2,
      ammo: 1,
    },
  );
  assert.equal(t[0].kind, 'round_over_win', 'result is highest priority');
});

// ── decideCommentary ────────────────────────────────────────────────────

test('decideCommentary returns null when the cooldown is open', () => {
  const state = { lastEmittedAtMs: 1_000_000, recentLines: [] };
  const triggers = [{ kind: 'round_start', evidence: 'runId set to run-1' }];
  assert.equal(
    decideCommentary(triggers, state, 1_000_000 + COMMENTARY_COOLDOWN_MS - 1, 0),
    null,
  );
  const opened = decideCommentary(
    triggers,
    state,
    1_000_000 + COMMENTARY_COOLDOWN_MS,
    0,
  );
  assert.ok(opened, 'cooldown boundary opens exactly at COMMENTARY_COOLDOWN_MS');
  assert.equal(opened.trigger.kind, 'round_start');
});

test('decideCommentary returns null when no triggers were detected', () => {
  assert.equal(
    decideCommentary([], initialCommentatorState(), 1_000_000, 0),
    null,
  );
});

test('decideCommentary avoids the recent-line window before repeating', () => {
  const pool = COMMENTARY_LINES.wave_advance;
  const triggers = [{ kind: 'wave_advance', evidence: 'waveId 1 → 2' }];
  const state = { lastEmittedAtMs: 0, recentLines: [pool[0]] };
  const picked = decideCommentary(triggers, state, 1_000_000, 0);
  assert.ok(picked);
  assert.notEqual(picked.line, pool[0], 'refuses the most recent line while fresh lines exist');
});

test('decideCommentary falls back to the pool when every line is in the recent window', () => {
  // A pool smaller than the recent window (low_ammo has 3 lines) — after all
  // three have been spoken, the next call falls back to the pool rather than
  // returning nothing.
  const triggers = [{ kind: 'low_ammo', evidence: 'ammo 5 → 2' }];
  const allRecent = [...COMMENTARY_LINES.low_ammo];
  const state = { lastEmittedAtMs: 0, recentLines: allRecent };
  const picked = decideCommentary(triggers, state, 1_000_000, 0);
  assert.ok(picked, 'falls back rather than silence');
  assert.ok(COMMENTARY_LINES.low_ammo.includes(picked.line));
});

test('decideCommentary caps recentLines at COMMENTARY_NO_REPEAT_WINDOW', () => {
  // Fire ten sequential commentaries and confirm we never remember more than
  // the window says. Each call advances time past the cooldown.
  let state = initialCommentatorState();
  let now = 0;
  const trig = [{ kind: 'wave_advance', evidence: 'waveId 1 → 2' }];
  for (let i = 0; i < 10; i += 1) {
    now += COMMENTARY_COOLDOWN_MS + 1;
    const picked = decideCommentary(trig, state, now, i);
    assert.ok(picked, `pick ${i}`);
    state = picked.nextState;
    assert.ok(
      state.recentLines.length <= COMMENTARY_NO_REPEAT_WINDOW,
      `recentLines length capped at ${COMMENTARY_NO_REPEAT_WINDOW}`,
    );
  }
});

test('decideCommentary uses the seed to pick between equally-fresh candidates deterministically', () => {
  const trig = [{ kind: 'round_start', evidence: 'runId set to run-1' }];
  const a = decideCommentary(trig, initialCommentatorState(), 999_999, 0);
  const b = decideCommentary(trig, initialCommentatorState(), 999_999, 0);
  assert.ok(a && b);
  assert.equal(a.line, b.line, 'same seed → same line');
});

// ── contextual lines ────────────────────────────────────────────────────

test('buildContextualLine uses state when the trigger carries it', () => {
  assert.equal(
    buildContextualLine({ kind: 'close_call', evidence: '', data: { heroLife: 1 } }, 0),
    'One life left.',
  );
  assert.equal(
    buildContextualLine({ kind: 'close_call', evidence: '', data: { heroLife: 2 } }, 0),
    'Two lives left.',
  );
  assert.equal(
    buildContextualLine({ kind: 'wave_advance', evidence: '', data: { waveId: 4 } }, 0),
    'Wave 4. Keep moving.',
  );
  assert.equal(
    buildContextualLine({ kind: 'mob_wipe', evidence: '', data: { waveId: 4 } }, 0),
    'Wave 4 cleared.',
  );
  assert.equal(
    buildContextualLine({ kind: 'low_ammo', evidence: '', data: { ammo: 1 } }, 0),
    'One shot left.',
  );
});

test('buildContextualLine falls back to the trigger pool when state is missing or out of range', () => {
  const noState = buildContextualLine({ kind: 'wave_advance', evidence: '' }, 0);
  assert.ok(noState, 'a wave_advance with no waveId still returns a line');
  assert.ok(COMMENTARY_LINES.wave_advance.includes(noState));

  const outOfRange = buildContextualLine(
    { kind: 'wave_advance', evidence: '', data: { waveId: 999 } },
    0,
  );
  assert.ok(outOfRange);
  assert.ok(
    COMMENTARY_LINES.wave_advance.includes(outOfRange),
    'a wave beyond the enumerated range falls back to the pool',
  );
});

test('detectTriggers annotates triggers with data the contextual picker uses', () => {
  const t = detectTriggers({ heroLife: 4 }, { heroLife: 2 });
  const closeCall = t.find((x) => x.kind === 'close_call');
  assert.ok(closeCall);
  assert.equal(closeCall.data?.heroLife, 2);

  const wave = detectTriggers({ waveId: 3 }, { waveId: 4 });
  assert.equal(wave[0].data?.waveId, 4);

  const wipe = detectTriggers({ mobsAlive: 3, waveId: 2 }, { mobsAlive: 0, waveId: 2 });
  const wipeTrigger = wipe.find((x) => x.kind === 'mob_wipe');
  assert.ok(wipeTrigger);
  assert.equal(wipeTrigger.data?.waveId, 2);

  const ammo = detectTriggers({ ammo: 4 }, { ammo: 1 });
  const ammoTrigger = ammo.find((x) => x.kind === 'low_ammo');
  assert.ok(ammoTrigger);
  assert.equal(ammoTrigger.data?.ammo, 1);
});

test('decideCommentary picks a contextual line when the trigger carries state', () => {
  const trig = [
    { kind: 'close_call', evidence: 'heroLife=1', data: { heroLife: 1 } },
  ];
  const picked = decideCommentary(trig, initialCommentatorState(), 1_000_000, 0);
  assert.ok(picked);
  assert.equal(picked.line, 'One life left.');
});

test('every line the commentator can pick is in ALLOWED_COMMENTARY_LINES', () => {
  const allowed = new Set(ALLOWED_COMMENTARY_LINES);
  // Every canned line.
  for (const [kind, pool] of Object.entries(COMMENTARY_LINES)) {
    for (const line of pool) {
      assert.ok(allowed.has(line), `pool line "${line}" (${kind}) is missing from ALLOWED_COMMENTARY_LINES`);
    }
  }
  // Every contextual line for every stateful trigger.
  const contextuals = [
    ['close_call', 1, 'One life left.'],
    ['close_call', 2, 'Two lives left.'],
    ['close_call', 3, 'Three lives left.'],
    ['low_ammo', 1, 'One shot left.'],
    ['low_ammo', 2, 'Two shots left.'],
  ];
  for (const [kind, val, expected] of contextuals) {
    const line = buildContextualLine(
      { kind, evidence: '', data: kind === 'low_ammo' ? { ammo: val } : { heroLife: val } },
      0,
    );
    assert.equal(line, expected, `contextual line for ${kind} at ${val}`);
    assert.ok(allowed.has(line), `contextual "${expected}" missing from allowlist`);
  }
  for (let wave = 1; wave <= 20; wave += 1) {
    const advance = buildContextualLine({ kind: 'wave_advance', evidence: '', data: { waveId: wave } }, 0);
    assert.ok(allowed.has(advance), `wave_advance "${advance}" missing from allowlist`);
    const wipe = buildContextualLine({ kind: 'mob_wipe', evidence: '', data: { waveId: wave } }, 0);
    assert.ok(allowed.has(wipe), `mob_wipe "${wipe}" missing from allowlist`);
  }
});
