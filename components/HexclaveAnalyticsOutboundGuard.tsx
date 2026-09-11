'use client';

import { installHexclaveAnalyticsFetchSanitizer } from '@/lib/hexclave-analytics-outbound';

// Module evaluation runs when this client boundary loads, before the
// HexclaveProvider reconstructs its browser app and EventTracker starts.
installHexclaveAnalyticsFetchSanitizer();

export function HexclaveAnalyticsOutboundGuard() {
  return null;
}
