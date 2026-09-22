import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FLAGSHIP_READINESS,
  deviceJourneyReady,
  pendingFlagships,
  promotableFlagshipIds,
} from '../lib/flagship-readiness.ts';
import { FLAGSHIP_ROSTER } from '../lib/flagship-roster.ts';

test('every claim names its witness and its evidence', () => {
  for (const entry of Object.values(FLAGSHIP_READINESS)) {
    assert.ok(entry.provenance, `${entry.id} has no provenance`);
    assert.ok(entry.evidence && entry.evidence.length > 30, `${entry.id} has no usable evidence line`);
  }
});

test('a title that has not reached a round names a specific dependency', () => {
  for (const entry of pendingFlagships()) {
    assert.notEqual(entry.blockerKind, 'none', `${entry.id} is pending with no blocker kind`);
    assert.ok(entry.blocker && entry.blocker.length > 20, `${entry.id} is pending with no named dependency`);
  }
});

test('only a witnessed round may be promoted', () => {
  const promoted = promotableFlagshipIds();
  for (const id of promoted) {
    assert.equal(FLAGSHIP_READINESS[id].reached, 'round');
  }
  // And the row is not padded to fill itself.
  assert.ok(promoted.length >= 1);
  assert.ok(pendingFlagships().length > 0, 'nothing pending would mean every title is proven — check the evidence');
  // The roster's approved titles lead the row.
  const rosterIds = FLAGSHIP_ROSTER.map((r) => r.id);
  const promotedRoster = promoted.filter((id) => rosterIds.includes(id));
  const promotedOther = promoted.filter((id) => !rosterIds.includes(id));
  assert.deepEqual(promoted, [...promotedRoster, ...promotedOther]);
});

test('a blocked title is never promoted', () => {
  assert.ok(!promotableFlagshipIds().includes('clescaperoad'));
});

test('automation does not make a device journey ready', () => {
  // Chromium proves the build works. It does not prove a thumb can play it.
  assert.equal(FLAGSHIP_READINESS['nightclub-showdown-inzone-production'].reached, 'round');
  assert.equal(deviceJourneyReady('nightclub-showdown-inzone-production'), false);
});

test('a blocker is attributed to a layer, so the fix has an address', () => {
  const kinds = new Set(pendingFlagships().map((e) => e.blockerKind));
  for (const kind of kinds) {
    assert.ok(['host-layout', 'game-canvas', 'touch-controls', 'orientation', 'assets'].includes(kind));
  }
  // None of the current blockers is ours to fix with CSS.
  assert.ok(!kinds.has('host-layout'), 'a host-layout blocker would be ours — fix it rather than recording it');
});
