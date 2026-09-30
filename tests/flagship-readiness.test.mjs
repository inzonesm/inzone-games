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
  idsWithMeasurementMode,
  measurementMode,
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
  // Kart Bros was once recorded as alive-and-repainting, which is not a race.
  // It now has a race entered, but nobody finished one, so it is still not a
  // complete journey and still not promotable.
  const kart = TITLE_EVIDENCE['kart-bros'];
  assert.equal(kart.assetsLoaded, 'yes');
  assert.equal(kart.gameplayEntered, 'yes');
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

test('the ad gate that held Karate Bros back is removed at the host, and the record says so', () => {
  const karate = TITLE_EVIDENCE['karate-bros'];
  assert.equal(karate.assetsLoaded, 'yes');
  assert.equal(karate.gameplayEntered, 'yes');
  // Pads drawn is not pads working.
  assert.equal(karate.ordinaryControlsWork, 'unknown');
  assert.match(karate.openDependency ?? '', /adinplay/i);
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
  // Karate Bros is back now that it boots; it still names what is open.
  assert.ok(row.includes('karate-bros'));
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

test('measurementMode: Nightclub and Flappy get verified-adapter — the two same-origin builds', () => {
  assert.equal(measurementMode('nightclub-showdown-inzone-production'), 'verified-adapter');
  assert.equal(measurementMode('flappybird-inzone-2'), 'verified-adapter');
});

test('measurementMode: Escape Road is verified-lifecycle — the build reports start and game over, nothing in between', () => {
  assert.equal(measurementMode('clescaperoad'), 'verified-lifecycle');
  assert.deepEqual(idsWithMeasurementMode('verified-lifecycle'), ['clescaperoad']);
  assert.ok(!idsWithMeasurementMode('verified-adapter').includes('clescaperoad'), 'no engaged_play column for it');
});

test('measurementMode: the other three third-party flagships get cross-origin-proxy — no build-authoritative state', () => {
  assert.equal(measurementMode('clelytraflight'), 'cross-origin-proxy');
  assert.equal(measurementMode('kart-bros'), 'cross-origin-proxy');
  assert.equal(measurementMode('karate-bros'), 'cross-origin-proxy');
});

test('measurementMode: non-flagship games get no-measurement — probe still runs, report doesn\'t call them out', () => {
  assert.equal(measurementMode('some-random-game-id'), 'no-measurement');
  assert.equal(measurementMode(''), 'no-measurement');
});

test('idsWithMeasurementMode: verified-adapter includes Flappy even though it isn\'t in TITLE_EVIDENCE as flagship', () => {
  const verified = idsWithMeasurementMode('verified-adapter');
  assert.ok(verified.includes('nightclub-showdown-inzone-production'));
  assert.ok(verified.includes('flappybird-inzone-2'), 'Flappy must appear here — it has a verified adapter');
});

test('Elytra stays proxy-only and says why: no lifecycle hook, and the game plays itself', () => {
  const elytra = TITLE_EVIDENCE.clelytraflight;
  assert.equal(measurementMode('clelytraflight'), 'cross-origin-proxy');
  assert.match(elytra.evidence, /no exposed lifecycle hook/);
  assert.match(elytra.evidence, /plays itself/);
  assert.match(elytra.evidence, /foreground_dwell_15s \/ 60s are the operative signals/);
  // A round and a restart were seen; steering was not.
  assert.equal(elytra.roundRestartWorks, 'yes');
  assert.equal(elytra.ordinaryControlsWork, 'unknown');
});

test('idsWithMeasurementMode: cross-origin-proxy is exactly the three flagships with no build signal', () => {
  const proxied = idsWithMeasurementMode('cross-origin-proxy').sort();
  assert.deepEqual(proxied, ['clelytraflight', 'karate-bros', 'kart-bros'].sort());
});

test('every flagship falls in exactly ONE measurement mode — no title is both, none is neither', () => {
  const seen = new Set();
  for (const item of FLAGSHIP_ROSTER) {
    const mode = measurementMode(item.id);
    assert.notEqual(mode, 'no-measurement', `${item.id} is a flagship but has no measurement mode`);
    assert.ok(!seen.has(`${item.id}:${mode}`), `${item.id} appeared twice`);
    seen.add(`${item.id}:${mode}`);
  }
});
