'use client';

import {
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

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `batch-${Date.now()}`;
  }
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
  return send.bind(internals);
}

async function sendCampaignEvent(send: AnalyticsSend, event: CampaignEvent): Promise<void> {
  const result = await send(
    JSON.stringify({
      batch_id: newId(),
      sent_at_ms: Date.now(),
      events: [
        {
          event_type: event.name,
          event_at_ms: event.at,
          data: event.data,
        },
      ],
    }),
    { keepalive: false },
  );
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
    void sendCampaignEvent(send, event);
  });
}
