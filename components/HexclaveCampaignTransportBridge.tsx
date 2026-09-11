'use client';

import { useHexclaveApp } from '@hexclave/next';
import { useLayoutEffect } from 'react';
import { bindHexclaveCampaignTransportFromProviderApp } from '@/lib/campaign-analytics-hexclave';

/**
 * HexclaveProvider serializes the server app and reconstructs a browser client
 * via fromClientJson. Automatic $page-view / $click and campaign events must
 * share that reconstructed client. useHexclaveApp is the SDK's supported hook.
 */
export function HexclaveCampaignTransportBridge() {
  const app = useHexclaveApp();
  useLayoutEffect(() => {
    bindHexclaveCampaignTransportFromProviderApp(app);
  }, [app]);
  return null;
}
