/**
 * The marker must be readable, must not be guessed at, and must keep the
 * three behaviours it governs distinct. An ordinary visitor carrying no
 * marker must never be treated as test traffic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QA_QUERY_PARAM, TRAFFIC_KIND_KEY,
  trafficKindFromSearch, trafficKindFromHref,
  mayEmitToAdPlatform, countsAsCustomerTraffic, withQaMarker,
} from '../lib/qa-traffic.ts';

const REAL_AD_URL =
  'https://www.inzone.games/games/flappybird-inzone-2?utm_source=meta&utm_medium=paid_social'
  + '&utm_campaign=solo_social_01&utm_content=a_solo_v1&fbclid=IwAbC123&utm_term=120250586091480718';

test('unmarked traffic is never read as a marker', () => {
  assert.equal(trafficKindFromSearch(''), null);
  assert.equal(trafficKindFromSearch(null), null);
  assert.equal(trafficKindFromHref(REAL_AD_URL), null);
  assert.equal(trafficKindFromHref('https://www.inzone.games/games/flappybird-inzone-2'), null);
  assert.equal(trafficKindFromHref('not a url'), null);
});

test('an unrecognised value fails toward counting the visit', () => {
  // A typo must not silently drop a real visitor from the numbers.
  assert.equal(trafficKindFromSearch(`?${QA_QUERY_PARAM}=ture`), null);
  assert.equal(trafficKindFromSearch(`?${QA_QUERY_PARAM}=1`), null);
  assert.equal(countsAsCustomerTraffic(trafficKindFromSearch(`?${QA_QUERY_PARAM}=ture`)), true);
});

test('reads the marker from a search string or a full href', () => {
  assert.equal(trafficKindFromSearch(`?${QA_QUERY_PARAM}=agent`), 'agent');
  assert.equal(trafficKindFromSearch(`${QA_QUERY_PARAM}=manual`), 'manual');
  assert.equal(trafficKindFromSearch(`?${QA_QUERY_PARAM}=AGENT`), 'agent');
  assert.equal(trafficKindFromHref(`https://www.inzone.games/g?${QA_QUERY_PARAM}=agent`), 'agent');
});

test('marking a real ad URL leaves its acquisition attribution intact', () => {
  const marked = withQaMarker(REAL_AD_URL);
  const u = new URL(marked);
  assert.equal(u.searchParams.get('utm_source'), 'meta');
  assert.equal(u.searchParams.get('utm_campaign'), 'solo_social_01');
  assert.equal(u.searchParams.get('utm_content'), 'a_solo_v1');
  assert.equal(u.searchParams.get('utm_term'), '120250586091480718');
  assert.equal(u.searchParams.get('fbclid'), 'IwAbC123');
  assert.equal(u.searchParams.get(QA_QUERY_PARAM), 'agent');
  assert.equal(trafficKindFromHref(marked), 'agent');
});

test('the three behaviours are decided separately but agree on the two clear cases', () => {
  // Marked: no ad-platform emission, not customer traffic. Diagnostics are a
  // transport concern and are deliberately NOT gated by this module.
  assert.equal(mayEmitToAdPlatform('agent'), false);
  assert.equal(countsAsCustomerTraffic('agent'), false);
  assert.equal(mayEmitToAdPlatform('manual'), false);
  // Unmarked: eligible for both.
  assert.equal(mayEmitToAdPlatform(null), true);
  assert.equal(countsAsCustomerTraffic(null), true);
  assert.equal(mayEmitToAdPlatform(undefined), true);
  assert.equal(mayEmitToAdPlatform(''), true);
});

test('the recorded field name is stable', () => {
  // The report and the analytics payload must agree on this string.
  assert.equal(TRAFFIC_KIND_KEY, 'traffic_kind');
  assert.equal(QA_QUERY_PARAM, 'inzone_qa');
});

test('withQaMarker is idempotent and does not duplicate the parameter', () => {
  const once = withQaMarker(REAL_AD_URL);
  const twice = withQaMarker(once);
  assert.equal(new URL(twice).searchParams.getAll(QA_QUERY_PARAM).length, 1);
  assert.equal(trafficKindFromHref(twice), 'agent');
});
