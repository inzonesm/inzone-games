import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HexclaveClientApp, hexclaveAppInternalsSymbol } from '@hexclave/js';
import {
  CAMPAIGN_EVENTS,
  PUBLIC_CAMPAIGN_URL,
  captureCampaignArrival,
  resetCampaignAnalyticsForTests,
  trackCampaignEvent,
} from '../lib/campaign-analytics.ts';
import { bindHexclaveCampaignTransportFromProviderApp } from '../lib/campaign-analytics-hexclave.ts';
import { decodeHexclaveAnalyticsBody } from '../lib/hexclave-analytics-outbound.ts';

const PROJECT_ID = '00000000-0000-4000-8000-0000000000aa';

function providerJson(uniqueIdentifier) {
  return {
    baseUrl: 'https://api.hexclave.com',
    projectId: PROJECT_ID,
    publishableClientKey: 'pck_test',
    tokenStore: 'memory',
    urls: { default: { type: 'hosted' } },
    redirectMethod: 'none',
    uniqueIdentifier,
    automaticSideEffects: false,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectFetch(run) {
  /** @type {{ url: string, json: string, gzip: boolean }[]} */
  const batches = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (String(url).includes('/analytics/events/batch') && init?.body) {
      const contentType =
        init.headers instanceof Headers
          ? init.headers.get('Content-Type')
          : init.headers?.['Content-Type'] || init.headers?.['content-type'] || null;
      const decoded = await decodeHexclaveAnalyticsBody(init.body, contentType);
      batches.push({ url: String(url), json: decoded.json, gzip: decoded.gzip });
    }
    return new Response(JSON.stringify({ inserted: 1 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    await run();
    await sleep(50);
    return batches;
  } finally {
    globalThis.fetch = previous;
  }
}

test('campaign events use the Provider fromClientJson client, not a stray HexclaveClientApp', async () => {
  resetCampaignAnalyticsForTests();
  const providerApp = HexclaveClientApp[hexclaveAppInternalsSymbol].fromClientJson(
    providerJson('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  );
  const strayApp = new HexclaveClientApp({
    projectId: PROJECT_ID,
    publishableClientKey: 'pck_stray',
    tokenStore: 'memory',
    redirectMethod: 'none',
    urls: { default: { type: 'hosted' } },
    automaticSideEffects: false,
  });

  assert.notEqual(providerApp, strayApp);

  let straySends = 0;
  const strayIface = strayApp._interface;
  const strayOriginal = strayIface.sendAnalyticsEventBatch.bind(strayIface);
  strayIface.sendAnalyticsEventBatch = (...args) => {
    straySends += 1;
    return strayOriginal(...args);
  };

  const batches = await collectFetch(async () => {
    bindHexclaveCampaignTransportFromProviderApp(providerApp);
    const arrival = captureCampaignArrival(PUBLIC_CAMPAIGN_URL);
    assert.ok(arrival);
    assert.equal(arrival.name, CAMPAIGN_EVENTS.arrival);
    trackCampaignEvent(CAMPAIGN_EVENTS.inviteCopied, { game_id: '2048-inzone-upload' });
    await sleep(80);
  });

  assert.equal(straySends, 0, 'stray HexclaveClientApp must not send campaign events');
  const types = batches.flatMap((batch) => JSON.parse(batch.json).events.map((event) => event.event_type));
  assert.equal(types.includes(CAMPAIGN_EVENTS.arrival), true);
  assert.equal(types.includes(CAMPAIGN_EVENTS.inviteCopied), true);
  assert.equal(
    batches.every((batch) => batch.url.includes('/api/v1/analytics/events/batch')),
    true,
  );
  assert.equal(
    batches.some((batch) => batch.gzip),
    true,
    'Provider keepalive:false batches are gzip application/octet-stream',
  );
  for (const batch of batches) {
    assert.equal(batch.json.includes('session='), false);
    assert.equal(batch.json.includes('aabbccddeeff'), false);
  }
});

test('Provider bind throws when sendAnalyticsEventBatch is missing', () => {
  assert.throws(
    () => bindHexclaveCampaignTransportFromProviderApp(null),
    /missing/i,
  );
  assert.throws(
    () => bindHexclaveCampaignTransportFromProviderApp({}),
    /sendAnalyticsEventBatch/,
  );
});

test('Provider _interface wrap sanitizes automatic $page-view JSON before gzip fetch', async () => {
  const sessionId = 'aabbccddeeff00112233445566778899';
  const providerApp = HexclaveClientApp[hexclaveAppInternalsSymbol].fromClientJson(
    providerJson('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  );
  bindHexclaveCampaignTransportFromProviderApp(providerApp);

  const batches = await collectFetch(async () => {
    await providerApp._interface.sendAnalyticsEventBatch(
      JSON.stringify({
        batch_id: 'auto',
        events: [
          {
            event_type: '$page-view',
            data: {
              url: `https://www.inzone.games/session-prototype?session=${sessionId}&utm_campaign=play-together-2026`,
              text: 'chat leak from click',
            },
          },
        ],
      }),
      null,
      { keepalive: false },
    );
  });

  assert.equal(batches.length >= 1, true);
  const dumped = batches.map((batch) => batch.json).join('\n');
  assert.equal(dumped.includes(sessionId), false);
  assert.equal(dumped.includes('chat leak'), false);
  assert.equal(dumped.includes('session='), false);
  assert.match(dumped, /utm_campaign=play-together-2026/);
  assert.equal(batches.some((batch) => batch.gzip), true);
});
