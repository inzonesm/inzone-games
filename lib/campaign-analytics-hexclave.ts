'use client';

import {
  HEXCLAVE_CAMPAIGN_EVENT_FIELD,
  PUBLIC_CAMPAIGN_URL,
  publicAnalyticsUrl,
  setCampaignTransport,
  wrapHexclaveAnalyticsTransport,
  type CampaignEvent,
} from './campaign-analytics.ts';

/** Same Symbol.for key Hexclave uses for app internals (`hexclaveAppInternalsSymbol`). */
const HEXCLAVE_APP_INTERNALS = Symbol.for(
  'StackAuth--DO-NOT-USE-OR-YOU-WILL-BE-FIRED--StackAppInternals',
);

type AnalyticsSend = (
  body: string,
  options: { keepalive: boolean },
) => Promise<{ status?: string; error?: unknown; data?: { ok?: boolean; status?: number } }>;

type AnalyticsInternals = {
  sendAnalyticsEventBatch?: AnalyticsSend;
};

const campaignSegmentId = newId();

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `batch-${Date.now()}`;
  }
}

function campaignPageUrl(): string {
  if (typeof window === 'undefined') return PUBLIC_CAMPAIGN_URL;
  return publicAnalyticsUrl(window.location.href) || PUBLIC_CAMPAIGN_URL;
}

function providerAnalyticsSend(app: unknown): AnalyticsSend {
  if (!app || typeof app !== 'object') {
    throw new Error('Hexclave Provider analytics client is missing');
  }
  wrapHexclaveAnalyticsTransport(app, { required: true });
  const internals = Reflect.get(app, HEXCLAVE_APP_INTERNALS) as AnalyticsInternals | undefined;
  const send = internals?.sendAnalyticsEventBatch;
  if (typeof send !== 'function') {
    throw new Error(
      'Hexclave Provider analytics client does not expose sendAnalyticsEventBatch',
    );
  }
  return send.bind(app);
}

async function ensureProviderAnalyticsSession(app: unknown): Promise<void> {
  if (typeof window === 'undefined') return;
  const getUser = (app as { getUser?: (opts: { or: 'anonymous' }) => Promise<unknown> }).getUser;
  if (typeof getUser !== 'function') return;
  try {
    await getUser.call(app, { or: 'anonymous' });
  } catch (err) {
    console.error('[hexclave] anonymous analytics session failed', err);
  }
}

/**
 * Hexclave `/analytics/events/batch` only accepts `$page-view` / `$click` and
 * requires `session_replay_segment_id`. Campaign names travel in `data.inzone_event`.
 */
function campaignBatchBody(event: CampaignEvent): string {
  return JSON.stringify({
    session_replay_segment_id: campaignSegmentId,
    batch_id: newId(),
    sent_at_ms: Date.now(),
    events: [
      {
        event_type: '$page-view',
        event_at_ms: event.at,
        data: {
          url: campaignPageUrl(),
          path: '/session-prototype',
          entry_type: event.name,
          [HEXCLAVE_CAMPAIGN_EVENT_FIELD]: event.name,
          ...event.data,
        },
      },
    ],
  });
}

async function sendCampaignEvent(app: unknown, send: AnalyticsSend, event: CampaignEvent): Promise<void> {
  await ensureProviderAnalyticsSession(app);
  const result = await send(campaignBatchBody(event), { keepalive: false });
  if (result && result.status === 'error') {
    console.error('[hexclave] campaign batch failed', result.error);
    return;
  }
  if (result?.data && result.data.ok === false) {
    console.error('[hexclave] campaign batch rejected', result.data.status);
  }
}

/**
 * Bind campaign events to the Provider's reconstructed analytics client.
 * Must be called with `useHexclaveApp()` — not a separately constructed
 * HexclaveClientApp. Throws if that client has no ingest transport.
 */
export function bindHexclaveCampaignTransportFromProviderApp(app: unknown): void {
  const send = providerAnalyticsSend(app);
  setCampaignTransport((event) => {
    void sendCampaignEvent(app, send, event);
  });
}
