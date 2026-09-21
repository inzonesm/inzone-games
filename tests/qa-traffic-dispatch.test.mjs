/**
 * The three behaviours, exercised through a real verified-start dispatch with
 * a mocked Meta transport. Meta's network being unreachable is irrelevant
 * here: the question is whether our code calls the dispatcher at all.
 *
 *   - marked production visit  -> zero Meta calls, tagged Hexclave event
 *   - Preview deployment       -> zero Meta calls, tagged Hexclave event
 *   - ordinary production      -> existing verified-event behaviour intact
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPAIGN_EVENTS,
  captureCampaignArrival,
  resetCampaignAnalyticsForTests,
  setCampaignTransport,
  setMetaPixelDispatcher,
  trackCampaignEvent,
} from '../lib/campaign-analytics.ts';
import { QA_SESSION_KEY } from '../lib/qa-traffic.ts';

function fakeSessionStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    _map: m,
  };
}

/**
 * Put the module in a given environment: hostname, entry query, per-tab store.
 * `local` is the attribution store (localStorage), kept across navigations in
 * a test the same way a browser keeps it across pages.
 */
function visit({ hostname, search = '', storage = fakeSessionStorage(), local = fakeSessionStorage(), arrive = false }) {
  const href = `https://${hostname}/games/flappybird-inzone-2${search}`;
  globalThis.window = {
    location: { hostname, search, href },
    sessionStorage: storage,
    localStorage: local,
  };
  globalThis.sessionStorage = storage;
  globalThis.localStorage = local;
  // A real visit records its attribution on arrival; later events read it back.
  if (arrive) captureCampaignArrival(href);
  return { storage, local };
}

let hexclave;
let meta;

beforeEach(() => {
  resetCampaignAnalyticsForTests();
  hexclave = [];
  meta = [];
  setCampaignTransport((e) => hexclave.push(e));
  setMetaPixelDispatcher((name, data, eventId) => meta.push({ name, data, eventId }));
});

afterEach(() => {
  setCampaignTransport(null);
  setMetaPixelDispatcher(null);
  delete globalThis.window;
  delete globalThis.sessionStorage;
});

const AD_SEARCH =
  '?utm_source=meta&utm_medium=paid_social&utm_campaign=solo_social_01&utm_content=a_solo_v1';

test('ordinary production visit: verified start still reaches Meta', () => {
  visit({ hostname: 'www.inzone.games', search: AD_SEARCH, arrive: true });
  meta = []; hexclave = [];
  setCampaignTransport((e) => hexclave.push(e));
  setMetaPixelDispatcher((name, data, eventId) => meta.push({ name, data, eventId }));
  trackCampaignEvent(CAMPAIGN_EVENTS.gameStart, { game_id: 'flappybird-inzone-2' });

  assert.equal(meta.length, 1, 'an ordinary visitor is unaffected');
  assert.equal(meta[0].name, 'game_start');
  assert.equal(hexclave.length, 1);
  assert.equal(hexclave[0].data.app_env, 'production');
  assert.equal(hexclave[0].data.traffic_kind, undefined, 'unmarked carries no kind');
  assert.equal(hexclave[0].data.utm_campaign, 'solo_social_01');
});

test('marked production visit: zero Meta calls, tagged Hexclave event', () => {
  visit({ hostname: 'www.inzone.games', search: `${AD_SEARCH}&inzone_qa=agent`, arrive: true });
  meta = []; hexclave = [];
  setCampaignTransport((e) => hexclave.push(e));
  setMetaPixelDispatcher((name, data, eventId) => meta.push({ name, data, eventId }));
  trackCampaignEvent(CAMPAIGN_EVENTS.gameStart, { game_id: 'flappybird-inzone-2' });

  assert.deepEqual(meta, [], 'no conversion may reach the ad platform');
  assert.equal(hexclave.length, 1, 'the diagnostic event is still recorded');
  assert.equal(hexclave[0].data.traffic_kind, 'agent');
  assert.equal(hexclave[0].data.app_env, 'production');
  // Acquisition attribution survives the marking.
  assert.equal(hexclave[0].data.utm_source, 'meta');
  assert.equal(hexclave[0].data.utm_campaign, 'solo_social_01');
  assert.equal(hexclave[0].data.utm_content, 'a_solo_v1');
});

test('Preview deployment: zero Meta calls, tagged Hexclave event', () => {
  visit({
    hostname: 'inzone-games-git-claude-busy-cerf-19mfrm-in-zone-s-projects.vercel.app',
    search: AD_SEARCH,
  });
  trackCampaignEvent(CAMPAIGN_EVENTS.gameStart, { game_id: 'flappybird-inzone-2' });

  assert.deepEqual(meta, [], 'a Preview check is not a conversion');
  assert.equal(hexclave.length, 1);
  assert.equal(hexclave[0].data.app_env, 'preview');
  assert.equal(hexclave[0].data.traffic_kind, undefined, 'unmarked, but still withheld by host');
});

test('local and unrecognised hosts are withheld too', () => {
  for (const [hostname, expected] of [
    ['localhost', 'local'],
    ['127.0.0.1', 'local'],
    ['staging.example.com', 'unknown'],
    ['inzone.games.evil.example', 'unknown'],
  ]) {
    resetCampaignAnalyticsForTests();
    meta = []; hexclave = [];
    setCampaignTransport((e) => hexclave.push(e));
    setMetaPixelDispatcher((n, d, i) => meta.push({ n, d, i }));
    visit({ hostname });
    trackCampaignEvent(CAMPAIGN_EVENTS.gameStart, { game_id: 'g' });
    assert.deepEqual(meta, [], `${hostname} must not emit`);
    assert.equal(hexclave[0].data.app_env, expected, `${hostname} -> ${expected}`);
  }
});

test('every verified event is withheld on a marked visit, not just game_start', () => {
  visit({ hostname: 'www.inzone.games', search: '?inzone_qa=manual' });
  for (const name of ['game_start', 'engaged_play', 'first_game_over', 'return_play']) {
    trackCampaignEvent(name, { game_id: 'g' });
  }
  assert.deepEqual(meta, []);
  assert.equal(hexclave.length, 4, 'all four still recorded as diagnostics');
  assert.ok(hexclave.every((e) => e.data.traffic_kind === 'manual'));
});

test('classification survives same-tab navigation away from the marked URL', () => {
  const { storage: store, local } = visit({
    hostname: 'www.inzone.games', search: `${AD_SEARCH}&inzone_qa=agent`, arrive: true,
  });
  trackCampaignEvent(CAMPAIGN_EVENTS.gameOpen, { game_id: 'flappybird-inzone-2' });
  assert.equal(store.getItem(QA_SESSION_KEY), 'agent');

  // Second page in the same tab: the marker is gone from the URL, the
  // acquisition params are gone too, but the tab is still a test session.
  visit({ hostname: 'www.inzone.games', search: '', storage: store, local });
  trackCampaignEvent(CAMPAIGN_EVENTS.gameStart, { game_id: 'flappybird-inzone-2' });

  assert.deepEqual(meta, [], 'still withheld after navigating');
  const start = hexclave.at(-1);
  assert.equal(start.data.traffic_kind, 'agent');
  // Attribution is remembered by the module's own storage, not invented here.
  assert.equal(start.data.utm_campaign, 'solo_social_01', 'acquisition attribution retained');
});

test('a fresh tab is not marked: sessionStorage never brands the browser', () => {
  const { storage: marked } = visit({ hostname: 'www.inzone.games', search: '?inzone_qa=agent' });
  trackCampaignEvent(CAMPAIGN_EVENTS.gameStart, { game_id: 'g' });
  assert.deepEqual(meta, []);

  // A new tab gets a new sessionStorage. The same person is a customer again.
  visit({ hostname: 'www.inzone.games', search: '', storage: fakeSessionStorage() });
  trackCampaignEvent(CAMPAIGN_EVENTS.gameStart, { game_id: 'g' });
  assert.equal(meta.length, 1, 'marking one visit must not exclude this browser for good');
  assert.notEqual(marked.getItem(QA_SESSION_KEY), null);
});

test('an unrecognised marker value counts the visitor rather than dropping them', () => {
  visit({ hostname: 'www.inzone.games', search: '?inzone_qa=ture' });
  trackCampaignEvent(CAMPAIGN_EVENTS.gameStart, { game_id: 'g' });
  assert.equal(meta.length, 1, 'a typo must not silently delete a real visitor');
  assert.equal(hexclave[0].data.traffic_kind, undefined);
});

test('the classification fields cannot be spoofed by an event caller', () => {
  visit({ hostname: 'inzone-games-x.vercel.app', search: '' });
  trackCampaignEvent(CAMPAIGN_EVENTS.gameStart, { game_id: 'g', app_env: 'production' });
  assert.deepEqual(meta, [], 'a caller cannot promote a Preview visit to production');
  assert.equal(hexclave[0].data.app_env, 'preview');
});

test('no secret-shaped value can ride in on the new fields', () => {
  visit({ hostname: 'www.inzone.games', search: '' });
  trackCampaignEvent(CAMPAIGN_EVENTS.gameStart, {
    game_id: 'g',
    traffic_kind: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    app_env: 'https://www.inzone.games/?session=abc',
  });
  const d = hexclave[0].data;
  assert.equal(d.traffic_kind, undefined, 'closed set: anything else is dropped');
  assert.equal(d.app_env, 'production', 'recomputed, not taken from the caller');
});
