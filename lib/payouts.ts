'use client';

/* Payout history — the standalone portal's getPayoutHistory() is a stub (no
 * payouts backend exists yet), and that's still true here. This returns an
 * empty history so the Payouts page renders its real "nothing paid out yet"
 * state instead of fabricated transactions. When a payouts collection/endpoint
 * lands, query it here and the page will fill in automatically. */

export type PayoutStatus = 'paid' | 'pending' | 'processing';

export interface PayoutRecord {
  period: string;
  gross: number;
  fee: number;
  net: number;
  paid: string | null;
  status: PayoutStatus;
}

export async function fetchPayoutHistory(): Promise<PayoutRecord[]> {
  // No payouts backend yet — see file header.
  return [];
}
