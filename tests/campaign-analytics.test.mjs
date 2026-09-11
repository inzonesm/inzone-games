import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySeatAction, createSeat } from '../lib/session-prototype.ts';
import {
  CAMPAIGN_EVENTS,
  PUBLIC_CAMPAIGN_URL,
  captureCampaignArrival,
  eventPayload,
  isForbiddenCampaignValue,
  isGameplaySdkMethod,
  mergeAttributionSearch,
  noteVerifiedGameplay,
  parseAttribution,
  resetCampaignAnalyticsForTests,
  sanitizeData,
  setCampaignTransport,
  trackCampaignEvent,
} from '../lib/campaign-analytics.ts';

const nightclub = 'nightclub-showdown-inzone-production';
const puzzle = '2048-inzone-upload';

function collect() {
  /** @type {import('../lib/campaign-analytics.ts').CampaignEvent[]} */
  const events = [];
  setCampaignTransport((event) => {
    events.push(event);
  });
  return events;
}

test('public campaign URL is the www session-prototype landing with UTM and a catalog game', () => {
  const u = new URL(PUBLIC_CAMPAIGN_URL);
  assert.equal(u.origin, 'https://www.inzone.games');
  assert.equal(u.pathname, '/session-prototype');
  assert.equal(u.searchParams.get('utm_source'), 'gtm');
  assert.equal(u.searchParams.get('utm_medium'), 'cpc');
  assert.equal(u.searchParams.get('utm_campaign'), 'play-together-2026');
  assert.equal(u.searchParams.get('game'), nightclub);
  assert.equal(u.searchParams.get('session'), null);
});

test('campaign arrival stores first-touch UTM and does not include invite secrets', () => {
  resetCampaignAnalyticsForTests();
  const events = collect();
  const secretUrl =
    `${PUBLIC_CAMPAIGN_URL}&session=aabbccddeeff00112233445566778899&utm_content=hero`;
  const arrival = captureCampaignArrival(secretUrl);
  assert.ok(arrival);
  assert.equal(arrival.name, CAMPAIGN_EVENTS.arrival);
  assert.equal(arrival.data.utm_campaign, 'play-together-2026');
  assert.equal(arrival.data.utm_content, 'hero');
  assert.equal(arrival.data.game_id, undefined);
  assert.equal(events.length, 1);
  for (const [key, value] of Object.entries(arrival.data)) {
    assert.equal(isForbiddenCampaignValue(value), false, key);
    assert.notEqual(key, 'session');
    assert.notEqual(key, 'url');
    assert.notEqual(key, 'text');
  }
  assert.equal(captureCampaignArrival(secretUrl), null);
});

test('attribution survives an independent game switch', () => {
  resetCampaignAnalyticsForTests();
  const events = collect();
  captureCampaignArrival(PUBLIC_CAMPAIGN_URL);

  let seat = createSeat('you', 'You', nightclub);
  seat = applySeatAction(seat, { type: 'mark-interacted' });
  const switched = applySeatAction(seat, { type: 'play-game', gameId: puzzle });
  assert.equal(switched.gameId, puzzle);
  assert.notEqual(switched.gameId, nightclub);

  const keep = trackCampaignEvent(CAMPAIGN_EVENTS.keepPlaying, {
    game_id: switched.gameId,
    session: 'aabbccddeeff00112233445566778899',
    text: 'secret chat must never ship',
    url: 'https://www.inzone.games/session-prototype?session=aabbccddeeff00112233445566778899',
  });
  const play = noteVerifiedGameplay(switched.gameId, 'iframe_focus');

  assert.equal(keep.data.utm_source, 'gtm');
  assert.equal(keep.data.utm_medium, 'cpc');
  assert.equal(keep.data.utm_campaign, 'play-together-2026');
  assert.equal(keep.data.game_id, puzzle);
  assert.equal(keep.data.session, undefined);
  assert.equal(keep.data.text, undefined);
  assert.equal(keep.data.url, undefined);
  assert.ok(play);
  assert.equal(play.name, CAMPAIGN_EVENTS.gameplayStarted);
  assert.equal(play.data.utm_campaign, 'play-together-2026');
  assert.equal(play.data.game_id, puzzle);
  assert.equal(play.data.signal, 'iframe_focus');
  assert.equal(noteVerifiedGameplay(switched.gameId, 'iframe_focus'), null);

  assert.deepEqual(
    events.map((e) => e.name),
    [CAMPAIGN_EVENTS.arrival, CAMPAIGN_EVENTS.keepPlaying, CAMPAIGN_EVENTS.gameplayStarted],
  );
});

test('invite address-bar rewrite keeps UTM and copied invites stay secret-free in analytics', () => {
  resetCampaignAnalyticsForTests();
  collect();
  captureCampaignArrival(PUBLIC_CAMPAIGN_URL);
  const rewritten = mergeAttributionSearch(
    '/session-prototype?game=2048-inzone-upload&session=aabbccddeeff00112233445566778899',
  );
  assert.match(rewritten, /utm_campaign=play-together-2026/);
  assert.match(rewritten, /game=2048-inzone-upload/);
  const copied = trackCampaignEvent(CAMPAIGN_EVENTS.inviteCopied, {
    game_id: puzzle,
    session: 'aabbccddeeff00112233445566778899',
  });
  assert.equal(copied.data.utm_campaign, 'play-together-2026');
  assert.equal(copied.data.game_id, puzzle);
  assert.equal(copied.data.session, undefined);
});

test('sanitize drops chat text, invite URLs, and 32-hex ids; iframe load is not gameplay', () => {
  const clean = sanitizeData({
    utm_campaign: 'play-together-2026',
    game_id: puzzle,
    text: 'hi from chat',
    session: 'aabbccddeeff00112233445566778899',
    url: 'https://www.inzone.games/session-prototype?session=aabbccddeeff00112233445566778899',
    signal: 'iframe_load',
  });
  assert.deepEqual(clean, {
    utm_campaign: 'play-together-2026',
    game_id: puzzle,
  });
  assert.equal(isGameplaySdkMethod('saveState'), true);
  assert.equal(isGameplaySdkMethod('loadState'), true);
  assert.equal(isGameplaySdkMethod('requestPurchase'), true);
  assert.equal(isGameplaySdkMethod('getConfig'), false);
  const payload = eventPayload(CAMPAIGN_EVENTS.gameplayStarted, { game_id: puzzle, signal: 'sdk' });
  assert.equal(payload.name, 'gameplay_started');
  assert.notEqual(payload.name, 'play_started');
});
