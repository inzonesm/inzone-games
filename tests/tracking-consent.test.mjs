import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCEPTED_CONSENT,
  REJECTED_CONSENT,
  UNDECIDED_CONSENT,
  hexclaveOptionsFromConsent,
  parseTrackingConsent,
  serializeTrackingConsent,
} from '../lib/tracking-consent.ts';

test('undecided and rejected keep every optional destination off', () => {
  assert.deepEqual(parseTrackingConsent(null), UNDECIDED_CONSENT);
  assert.deepEqual(parseTrackingConsent(''), UNDECIDED_CONSENT);
  assert.deepEqual(parseTrackingConsent('not-json'), UNDECIDED_CONSENT);
  assert.deepEqual(hexclaveOptionsFromConsent(UNDECIDED_CONSENT), { analytics: false, replay: false });
  assert.deepEqual(hexclaveOptionsFromConsent(REJECTED_CONSENT), { analytics: false, replay: false });
  assert.equal(REJECTED_CONSENT.advertising, false);
});

test('accept all and selective preferences round-trip', () => {
  assert.deepEqual(parseTrackingConsent(serializeTrackingConsent(ACCEPTED_CONSENT)), ACCEPTED_CONSENT);
  const selective = { decided: true, analytics: true, replay: false, advertising: false };
  assert.deepEqual(parseTrackingConsent(serializeTrackingConsent(selective)), selective);
  assert.deepEqual(hexclaveOptionsFromConsent(selective), { analytics: true, replay: false });
  const adsOnly = { decided: true, analytics: false, replay: false, advertising: true };
  assert.deepEqual(hexclaveOptionsFromConsent(adsOnly), { analytics: false, replay: false });
  assert.equal(adsOnly.advertising, true);
});

test('withdrawal is a decided rejection, not an empty reset that could look undecided', () => {
  const raw = serializeTrackingConsent(REJECTED_CONSENT);
  const parsed = parseTrackingConsent(raw);
  assert.equal(parsed.decided, true);
  assert.equal(parsed.analytics, false);
  assert.equal(parsed.replay, false);
  assert.equal(parsed.advertising, false);
});
