import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TITLE_EVIDENCE,
  flagshipRowIds,
  rendersEverywhereChecked,
  additionalVerified,
  deviceJourneyReady,
  flagshipEvidence,
  openDependencies,
  playedEndToEnd,
  promotableIds,
} from '../lib/flagship-readiness.ts';
import { FLAGSHIP_ROSTER } from '../lib/flagship-roster.ts';

const STEPS = ['assetsLoaded', 'menuUsable', 'gameplayEntered', 'ordinaryControlsWork', 'roundRestartWorks'];

test('the approved five are all present and all labelled flagship', () => {
  const evidence = flagshipEvidence();
  assert.equal(evidence.length, FLAGSHIP_ROSTER.length);
  for (const entry of evidence) assert.equal(entry.role, 'flagship', `${entry.id} lost its roster label`);
});

test('a verified extra is never passed off as a flagship', () => {
  for (const entry of additionalVerified()) {
    assert.equal(entry.role, 'additional');
    assert.ok(!FLAGSHIP_ROSTER.some((r) => r.id === entry.id), `${entry.id} is in the roster and should not be an extra`);
  }
  // Flappy is the case this exists for.
  assert.equal(TITLE_EVIDENCE['flappybird-inzone-2'].role, 'additional');
});

test('every step is answered separately, and unknown is allowed', () => {
  for (const entry of Object.values(TITLE_EVIDENCE)) {
    for (const step of STEPS) {
      assert.ok(['yes', 'no', 'unknown'].includes(entry[step]), `${entry.id}.${step} is not a tri-state`);
    }
  }
});

test('responsiveness alone never counts as gameplay', () => {
  // Kart Bros animates and repaints under a tap. That is not a race, and the
  // record must not say it is.
  const kart = TITLE_EVIDENCE['kart-bros'];
  assert.equal(kart.assetsLoaded, 'yes');
  assert.equal(kart.gameplayEntered, 'unknown');
  assert.equal(kart.roundRestartWorks, 'unknown');
  assert.ok(!promotableIds().includes('kart-bros'));
});

test('a runner that cannot fetch a dependency says so instead of calling it broken', () => {
  for (const entry of Object.values(TITLE_EVIDENCE)) {
    if (entry.provenance !== 'blocked-egress') continue;
    for (const step of STEPS) {
      assert.equal(entry[step], 'unknown', `${entry.id}.${step} claims a result nobody could observe`);
    }
    assert.match(
      entry.openDependency ?? '',
      /refus|blocked|egress|cannot reach|ad library/i,
      `${entry.id} does not say why it could not be judged`,
    );
  }
});

test('a title held back by an ad gate is not recorded as a broken build', () => {
  // Karate Bros loads its own files from /gcs without a single failure and
  // then waits. The one thing it cannot reach here is its ad library, and
  // removing monetization to find out is not ours to authorise.
  const karate = TITLE_EVIDENCE['karate-bros'];
  assert.equal(karate.assetsLoaded, 'unknown');
  assert.match(karate.openDependency ?? '', /not authorised|not authorized/i);
});

test('promotion needs every step, not most of them', () => {
  for (const id of promotableIds()) {
    assert.ok(playedEndToEnd(TITLE_EVIDENCE[id]), `${id} was promoted without a complete journey`);
  }
  assert.ok(promotableIds().length > 0);
  // Flagships lead the row.
  const rosterIds = FLAGSHIP_ROSTER.map((r) => r.id);
  const promoted = promotableIds();
  const firstExtra = promoted.findIndex((id) => !rosterIds.includes(id));
  if (firstExtra !== -1) {
    assert.ok(promoted.slice(firstExtra).every((id) => !rosterIds.includes(id)), 'a flagship trails an extra');
  }
});

test('every title carries an open dependency until a person has played it', () => {
  for (const entry of Object.values(TITLE_EVIDENCE)) {
    if (entry.provenance === 'device') continue;
    assert.ok(entry.openDependency && entry.openDependency.length > 25, `${entry.id} has no named open dependency`);
  }
});

test('automation never makes a device journey ready', () => {
  for (const id of promotableIds()) assert.equal(deviceJourneyReady(id), false);
});

test('open dependencies are addressed to someone, per title', () => {
  const items = openDependencies();
  assert.ok(items.length >= 5);
  for (const item of items) assert.ok(item.title && item.dependency);
});

test('the rig limitation is written down where the next agent will read it', () => {
  const source = readFileSync(new URL('../lib/flagship-readiness.ts', import.meta.url), 'utf8');
  assert.match(source, /egress proxy/);
  assert.match(source, /property of\s*\n? \* the test rig/);
});

test('the flagship row keeps the five-title strategy, minus only what was seen to fail', () => {
  const row = flagshipRowIds();
  const rosterIds = FLAGSHIP_ROSTER.map((r) => r.id);
  // Every id in the row is an approved flagship — never an extra in disguise.
  for (const id of row) assert.ok(rosterIds.includes(id), `${id} is not in the approved roster`);
  // Flappy is an additional recommendation and stays out of this row.
  assert.ok(!row.includes('flappybird-inzone-2'));
  // Karate Bros presented no canvas, so it is held out and reports its reason.
  assert.ok(!row.includes('karate-bros'));
  assert.ok(TITLE_EVIDENCE['karate-bros'].openDependency);
  // And the row is not down to one or two titles — that would be the silent
  // replacement of the strategy this exists to prevent.
  assert.ok(row.length >= 4, `flagship row collapsed to ${row.length}`);
});

test('showing a flagship is a weaker claim than saying it is finished', () => {
  // Rendering everywhere checked is enough to appear in the row; it is not
  // enough to be called a complete journey.
  const kart = TITLE_EVIDENCE['kart-bros'];
  assert.equal(rendersEverywhereChecked(kart), true);
  assert.equal(playedEndToEnd(kart), false);
  assert.ok(flagshipRowIds().includes('kart-bros'));
  assert.ok(!promotableIds().includes('kart-bros'));
});
