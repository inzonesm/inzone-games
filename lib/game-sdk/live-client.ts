'use client';

import { createCheckoutClient } from '@inzone/checkout-host-client';
import { publicApiOrigin } from './backend';

export function createLiveCheckoutClient(options: {
  gameId: string;
  getToken: () => Promise<string | null>;
}) {
  return createCheckoutClient({
    baseUrl: publicApiOrigin(),
    gameId: options.gameId,
    getToken: options.getToken,
  });
}
