import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySeatAction, createSeat, needsProgressConfirm } from '../lib/session-prototype.ts';
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
  noteGameOpened,
  noteGameSdkActivity,
  noteGameplayStarted,
  publicAnalyticsUrl,
  resetCampaignAnalyticsForTests,
  sanitizeAnalyticsBatchBody,
  sanitizeAutomaticEventData,
  sanitizeData,
  setCampaignTransport,
  trackCampaignEvent,
  trackInviteCopiedAfterWrite,
  wrapHexclaveAnalyticsTransport,
} from '../lib/campaign-analytics.ts';
import {
  decodeHexclaveAnalyticsBody,
  isHexclaveAnalyticsBatchUrl,
  rewriteHexclaveAnalyticsFetchArgs,
} from '../lib/hexclave-analytics-outbound.ts';
import { gzipSync, gunzipSync } from 'node:zlib';

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

test('automatic $page-view and $click batches drop chat, invite secrets, and session URLs', () => {
  const sessionId = 'aabbccddeeff00112233445566778899';
  const secretPage =
    `https://www.inzone.games/session-prototype?utm_source=gtm&utm_medium=cpc&utm_campaign=play-together-2026&game=${nightclub}&session=${sessionId}`;
  const inviteHref = `https://www.inzone.games/session-prototype?game=${nightclub}&session=${sessionId}`;
  const body = sanitizeAnalyticsBatchBody(
    JSON.stringify({
      batch_id: 'test',
      events: [
        {
          event_type: '$page-view',
          event_at_ms: 1,
          data: {
            url: secretPage,
            path: '/session-prototype',
            referrer: inviteHref,
            title: 'Play together',
            text: 'secret chat must never ship',
            entry_type: 'initial',
            viewport_width: 1280,
          },
        },
        {
          event_type: '$click',
          event_at_ms: 2,
          data: {
            text: 'hi from the live chat thread',
            href: inviteHref,
            url: secretPage,
            elements_chain: `button:hi from the live chat thread session=${sessionId}`,
            tag_name: 'button',
          },
        },
        {
          event_type: CAMPAIGN_EVENTS.keepPlaying,
          event_at_ms: 3,
          data: {
            utm_campaign: 'play-together-2026',
            game_id: puzzle,
            session: sessionId,
            text: 'nope',
            url: secretPage,
          },
        },
      ],
    }),
  );
  const parsed = JSON.parse(body);
  const dumped = JSON.stringify(parsed);
  assert.equal(dumped.includes(sessionId), false);
  assert.equal(dumped.includes('secret chat'), false);
  assert.equal(dumped.includes('live chat thread'), false);
  assert.equal(dumped.includes('session='), false);

  const page = parsed.events[0].data;
  assert.match(page.url, /utm_campaign=play-together-2026/);
  assert.match(page.url, new RegExp(`game=${nightclub}`));
  assert.equal(page.path, '/session-prototype');
  assert.equal(page.viewport_width, 1280);
  assert.equal(page.text, undefined);
  assert.equal(new URL(page.url).searchParams.get('session'), null);
  assert.equal(new URL(page.referrer).searchParams.get('session'), null);

  const click = parsed.events[1].data;
  assert.equal(click.text, undefined);
  assert.equal(click.elements_chain, undefined);
  assert.equal(new URL(click.href).searchParams.get('session'), null);
  assert.equal(click.tag_name, 'button');

  const keep = parsed.events[2].data;
  assert.deepEqual(keep, { utm_campaign: 'play-together-2026', game_id: puzzle });

  const cleaned = publicAnalyticsUrl(secretPage);
  assert.ok(cleaned);
  assert.equal(isForbiddenCampaignValue(cleaned), false);
  assert.equal(sanitizeAutomaticEventData({ url: secretPage, text: 'chat' }).text, undefined);
});

test('Hexclave analytics transport wrap sanitizes $page-view before ingest', async () => {
  const sessionId = 'aabbccddeeff00112233445566778899';
  /** @type {string[]} */
  const sent = [];
  const iface = {
    sendAnalyticsEventBatch(body) {
      sent.push(body);
      return Promise.resolve(null);
    },
  };
  wrapHexclaveAnalyticsTransport({ _interface: iface });
  await iface.sendAnalyticsEventBatch(
    JSON.stringify({
      events: [
        {
          event_type: '$page-view',
          data: {
            url: `https://www.inzone.games/session-prototype?session=${sessionId}&utm_campaign=play-together-2026`,
            text: 'chat leak',
          },
        },
      ],
    }),
  );
  assert.equal(sent.length, 1);
  assert.equal(sent[0].includes(sessionId), false);
  assert.equal(sent[0].includes('chat leak'), false);
  assert.match(sent[0], /utm_campaign=play-together-2026/);
});

test('required Provider wrap throws instead of swallowing a missing transport', () => {
  assert.throws(
    () => wrapHexclaveAnalyticsTransport(null, { required: true }),
    /missing/i,
  );
  assert.throws(
    () => wrapHexclaveAnalyticsTransport({}, { required: true }),
    /sendAnalyticsEventBatch/,
  );
  wrapHexclaveAnalyticsTransport(null);
  wrapHexclaveAnalyticsTransport({});
});

test('invite_copied emits only after clipboard writeText succeeds', async () => {
  resetCampaignAnalyticsForTests();
  const events = collect();
  captureCampaignArrival(PUBLIC_CAMPAIGN_URL);
  const invite =
    `https://www.inzone.games/session-prototype?game=${puzzle}&session=aabbccddeeff00112233445566778899`;

  const rejected = await trackInviteCopiedAfterWrite(
    async () => {
      throw new Error('Clipboard write denied');
    },
    invite,
    puzzle,
  );
  assert.equal(rejected, null);
  assert.equal(events.some((e) => e.name === CAMPAIGN_EVENTS.inviteCopied), false);

  /** @type {string[]} */
  const written = [];
  const copied = await trackInviteCopiedAfterWrite(
    async (text) => {
      written.push(text);
    },
    invite,
    puzzle,
  );
  assert.ok(copied);
  assert.equal(copied.name, CAMPAIGN_EVENTS.inviteCopied);
  assert.equal(copied.data.game_id, puzzle);
  assert.equal(copied.data.utm_campaign, 'play-together-2026');
  assert.equal(copied.data.session, undefined);
  assert.equal(copied.data.url, undefined);
  assert.deepEqual(written, [invite]);
  assert.equal(events.filter((e) => e.name === CAMPAIGN_EVENTS.inviteCopied).length, 1);
  assert.equal(JSON.stringify(copied.data).includes('aabbccddeeff00112233445566778899'), false);
  assert.equal(JSON.stringify(copied.data).includes(invite), false);
});

test('game_opened fires for every confirmed Discover Play and Open suggested remount', () => {
  resetCampaignAnalyticsForTests();
  const events = collect();
  captureCampaignArrival(PUBLIC_CAMPAIGN_URL);

  let seat = createSeat('you', 'You', nightclub);
  assert.equal(
    noteGameOpened({ cause: 'same-game', fromGameId: seat.gameId, toGameId: nightclub }),
    null,
  );
  assert.equal(
    noteGameOpened({ cause: 'restore', fromGameId: '', toGameId: puzzle }),
    null,
  );
  assert.equal(
    noteGameOpened({ cause: 'cancel', fromGameId: nightclub, toGameId: puzzle }),
    null,
  );

  seat = applySeatAction(seat, { type: 'mark-interacted' });
  assert.equal(needsProgressConfirm(seat, puzzle), true);
  // Dialog is showing: not confirmed yet.
  assert.equal(events.some((e) => e.name === CAMPAIGN_EVENTS.gameOpened), false);

  const discoverPlay = noteGameOpened({
    cause: 'play',
    fromGameId: seat.gameId,
    toGameId: puzzle,
  });
  assert.ok(discoverPlay);
  assert.equal(discoverPlay.name, CAMPAIGN_EVENTS.gameOpened);
  assert.equal(discoverPlay.data.game_id, puzzle);
  assert.equal(discoverPlay.data.utm_campaign, 'play-together-2026');
  seat = applySeatAction(seat, { type: 'play-game', gameId: puzzle });
  assert.equal(seat.gameId, puzzle);

  assert.equal(
    noteGameOpened({ cause: 'play', fromGameId: nightclub, toGameId: puzzle }),
    null,
    'consecutive duplicate handling of one switch is ignored',
  );

  const neon = 'neon-blaster-inzone-production';
  const openedSuggested = noteGameOpened({
    cause: 'open-suggested',
    fromGameId: seat.gameId,
    toGameId: neon,
  });
  assert.ok(openedSuggested);
  assert.equal(openedSuggested.data.game_id, neon);
  seat = applySeatAction(seat, { type: 'open-suggested', gameId: neon });
  assert.equal(seat.gameId, neon);

  const backToNightclub = noteGameOpened({
    cause: 'play',
    fromGameId: seat.gameId,
    toGameId: nightclub,
  });
  assert.ok(backToNightclub);
  assert.equal(backToNightclub.data.game_id, nightclub);

  assert.deepEqual(
    events.filter((e) => e.name === CAMPAIGN_EVENTS.gameOpened).map((e) => e.data.game_id),
    [puzzle, neon, nightclub],
  );
  for (const event of events) {
    assert.equal(event.data.session, undefined);
    assert.equal(event.data.text, undefined);
    assert.equal(event.data.url, undefined);
  }
});

test('A→B→A→B records all three game_opened switches', () => {
  resetCampaignAnalyticsForTests();
  const events = collect();
  captureCampaignArrival(PUBLIC_CAMPAIGN_URL);

  const first = noteGameOpened({ cause: 'play', fromGameId: nightclub, toGameId: puzzle });
  const back = noteGameOpened({ cause: 'play', fromGameId: puzzle, toGameId: nightclub });
  const again = noteGameOpened({ cause: 'play', fromGameId: nightclub, toGameId: puzzle });
  const doubleSubmit = noteGameOpened({ cause: 'play', fromGameId: nightclub, toGameId: puzzle });

  assert.ok(first);
  assert.ok(back);
  assert.ok(again);
  assert.equal(doubleSubmit, null);
  assert.deepEqual(
    [first.data.game_id, back.data.game_id, again.data.game_id],
    [puzzle, nightclub, puzzle],
  );
  assert.deepEqual(
    events.filter((e) => e.name === CAMPAIGN_EVENTS.gameOpened).map((e) => e.data.game_id),
    [puzzle, nightclub, puzzle],
  );
});

test('gzip analytics batches are sanitized on the outbound fetch path', async () => {
  const sessionId = 'aabbccddeeff00112233445566778899';
  const secretPage =
    `https://www.inzone.games/session-prototype?utm_campaign=play-together-2026&session=${sessionId}`;
  const json = JSON.stringify({
    batch_id: 'gzip-test',
    events: [
      {
        event_type: '$page-view',
        data: { url: secretPage, text: 'secret chat must never ship' },
      },
      {
        event_type: CAMPAIGN_EVENTS.inviteCopied,
        data: {
          utm_campaign: 'play-together-2026',
          game_id: puzzle,
          session: sessionId,
          text: 'copied invite chat',
        },
      },
    ],
  });
  const gzipped = gzipSync(Buffer.from(json));
  assert.equal(isHexclaveAnalyticsBatchUrl('https://r.hexclave.com/api/v1/analytics/events/batch'), true);
  const rewritten = await rewriteHexclaveAnalyticsFetchArgs(
    'https://r.hexclave.com/api/v1/analytics/events/batch',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(gzipped),
    },
  );
  const decoded = await decodeHexclaveAnalyticsBody(
    rewritten.init.body,
    'application/octet-stream',
  );
  assert.equal(decoded.gzip, true);
  assert.equal(decoded.json.includes(sessionId), false);
  assert.equal(decoded.json.includes('secret chat'), false);
  assert.equal(decoded.json.includes('session='), false);
  assert.match(decoded.json, /utm_campaign=play-together-2026/);
  assert.match(decoded.json, /campaign_arrival|invite_copied|\$page-view/);
  const parsed = JSON.parse(decoded.json);
  assert.equal(new URL(parsed.events[0].data.url).searchParams.get('session'), null);
  assert.deepEqual(parsed.events[1].data, {
    utm_campaign: 'play-together-2026',
    game_id: puzzle,
  });
  const again = gunzipSync(Buffer.from(rewritten.init.body)).toString('utf8');
  assert.equal(again.includes(sessionId), false);
});
