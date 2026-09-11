'use client';

import { hexclaveAppInternalsSymbol } from '@hexclave/next';
import { hexclaveClientApp } from '@/hexclave/client';
import {
  setCampaignTransport,
  type CampaignEvent,
} from '@/lib/campaign-analytics';

type AnalyticsInternals = {
  sendAnalyticsEventBatch: (body: string, options: { keepalive: boolean }) => Promise<unknown>;
};

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `batch-${Date.now()}`;
  }
}

async function sendViaHexclave(event: CampaignEvent): Promise<void> {
  if (!hexclaveClientApp) return;
  const internals = (hexclaveClientApp as unknown as Record<symbol, AnalyticsInternals | undefined>)[
    hexclaveAppInternalsSymbol
  ];
  if (!internals?.sendAnalyticsEventBatch) return;
  await internals.sendAnalyticsEventBatch(
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
}

/** Install Hexclave ingest as the campaign transport. Safe to call more than once. */
export function installHexclaveCampaignTransport(): void {
  setCampaignTransport((event) => {
    void sendViaHexclave(event).catch(() => {
      /* ad blockers / missing project id */
    });
  });
}
