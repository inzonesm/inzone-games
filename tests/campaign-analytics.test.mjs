import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySeatAction, createSeat } from '../lib/session-prototype.ts';
import {
  CAMPAIGN_EVENTS,
  PUBLIC_CAMPAIGN_URL,
  captureCampaignArrival,
  eventPayload,
  isExplicitGameStartSignal,
  isForbiddenCampaignValue,
  isSdkActivityOperation,
  mergeAttributionSearch,
  noteGameFrameFocused,
  noteGameSdkActivity,
  noteGameplayStarted,
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
  const focused = noteGameFrameFocused(switched.gameId);
  const sdk = noteGameSdkActivity(switched.gameId, 'saveState');
  const started = noteGameplayStarted(switched.gameId, { method: 'saveState' });

  assert.equal(keep.data.utm_source, 'gtm');
  assert.equal(keep.data.utm_medium, 'cpc');
  assert.equal(keep.data.utm_campaign, 'play-together-2026');
  assert.equal(keep.data.game_id, puzzle);
  assert.equal(keep.data.session, undefined);
  assert.equal(keep.data.text, undefined);
  assert.equal(keep.data.url, undefined);
  assert.ok(focused);
  assert.equal(focused.name, CAMPAIGN_EVENTS.gameFrameFocused);
  assert.equal(focused.data.utm_campaign, 'play-together-2026');
  assert.equal(focused.data.game_id, puzzle);
  assert.ok(sdk);
  assert.equal(sdk.name, CAMPAIGN_EVENTS.gameSdkActivity);
  assert.equal(sdk.data.operation, 'saveState');
  assert.equal(sdk.data.utm_campaign, 'play-together-2026');
  assert.equal(started, null);
  assert.equal(noteGameFrameFocused(switched.gameId), null);

  assert.deepEqual(
    events.map((e) => e.name),
    [CAMPAIGN_EVENTS.arrival, CAMPAIGN_EVENTS.keepPlaying, CAMPAIGN_EVENTS.gameFrameFocused, CAMPAIGN_EVENTS.gameSdkActivity],
  );
  assert.equal(events.some((e) => e.name === 'gameplay_started'), false);
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

test('iframe focus and SDK save/load/purchase are proxies, not gameplay_started', () => {
  const clean = sanitizeData({
    utm_campaign: 'play-together-2026',
    game_id: puzzle,
    text: 'hi from chat',
    session: 'aabbccddeeff00112233445566778899',
    url: 'https://www.inzone.games/session-prototype?session=aabbccddeeff00112233445566778899',
    signal: 'iframe_load',
    operation: 'saveState',
  });
  assert.deepEqual(clean, {
    utm_campaign: 'play-together-2026',
    game_id: puzzle,
    operation: 'saveState',
  });
  assert.equal(isSdkActivityOperation('saveState'), true);
  assert.equal(isSdkActivityOperation('loadState'), true);
  assert.equal(isSdkActivityOperation('requestPurchase'), true);
  assert.equal(isSdkActivityOperation('getConfig'), false);
  assert.equal(isExplicitGameStartSignal({ method: 'saveState' }), false);
  assert.equal(isExplicitGameStartSignal({ type: 'gameplay_started' }), false);
  resetCampaignAnalyticsForTests();
  const events = collect();
  assert.equal(noteGameplayStarted(puzzle, { method: 'requestPurchase' }), null);
  assert.equal(events.length, 0);
  const activity = eventPayload(CAMPAIGN_EVENTS.gameSdkActivity, { game_id: puzzle, operation: 'loadState' });
  assert.equal(activity.name, 'game_sdk_activity');
  assert.equal(activity.data.operation, 'loadState');
  assert.notEqual(activity.name, 'gameplay_started');
  assert.notEqual(activity.name, 'play_started');
});
