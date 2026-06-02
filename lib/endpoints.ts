'use client';

/* Endpoints integration-health data — ported from the standalone portal's
 * react-app/react-app/src/pages/Endpoints.jsx (fetchIntegrationHealth) to the
 * modular Firebase SDK.
 *
 * Reads the game_sdk_metrics collection, which the SDK writes to in hourly
 * buckets keyed `game_sdk_metrics/{gameId}_{YYYY-MM-DDTHH}` (UTC). We pull the
 * last 24 buckets and aggregate them into request/error/latency totals plus an
 * hourly series for the sparkline. Best-effort: returns null on failure so the
 * page shows its "awaiting traffic" placeholder instead of erroring. */

import { doc, getDoc } from 'firebase/firestore';
import { getDb } from './firebase';

export interface HourlyBucket {
  hour: string;
  requests: number;
  errors: number;
}

export interface IntegrationHealth {
  totalRequests: number;
  requestsFormatted: string;
  totalErrors: number;
  errorRate: number;
  errorRateFormatted: string;
  p95LatencyMs: number;
  p95LatencyFormatted: string | null;
  endpointsHit: string[];
  hourly: HourlyBucket[];
}

type Row = Record<string, unknown>;

function fmtCount(c: number): string {
  if (c >= 1_000_000) return `${(c / 1_000_000).toFixed(2)}M`;
  if (c >= 1_000) return `${(c / 1_000).toFixed(1)}K`;
  return String(c);
}

/** Aggregate the last 24 hourly metric buckets for a game. */
export async function fetchIntegrationHealth(gameId: string): Promise<IntegrationHealth | null> {
  if (!gameId) return null;
  const db = getDb();

  try {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const hourKeys: string[] = [];
    for (let i = 0; i < 24; i++) {
      const h = new Date(now.getTime() - i * 60 * 60 * 1000);
      const hourStr = `${h.getUTCFullYear()}-${pad(h.getUTCMonth() + 1)}-${pad(h.getUTCDate())}T${pad(h.getUTCHours())}`;
      hourKeys.push(`${gameId}_${hourStr}`);
    }

    const snapshots = await Promise.all(
      hourKeys.map((k) => getDoc(doc(db, 'game_sdk_metrics', k))),
    );

    let totalRequests = 0;
    let totalErrors = 0;
    const allSamples: number[] = [];
    const endpointsHit = new Set<string>();
    const hourly: HourlyBucket[] = [];

    for (const snap of snapshots) {
      if (!snap.exists()) continue;
      const d = snap.data() as Row;
      const reqs = (d.requests as number) || 0;
      const errs = (d.errors as number) || 0;
      const samples = (d.latency_samples as number[]) || [];
      const eps = (d.endpoints_hit as string[]) || [];

      totalRequests += reqs;
      totalErrors += errs;
      allSamples.push(...samples);
      eps.forEach((e) => endpointsHit.add(e));
      hourly.push({ hour: (d.hour as string) || snap.id, requests: reqs, errors: errs });
    }

    allSamples.sort((a, b) => a - b);
    const n = allSamples.length;
    const p95 = n > 0 ? allSamples[Math.min(Math.floor(n * 0.95), n - 1)] : 0;
    const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
    const roundedErrorRate = Math.round(errorRate * 1000) / 1000;

    return {
      totalRequests,
      requestsFormatted: fmtCount(totalRequests),
      totalErrors,
      errorRate: roundedErrorRate,
      errorRateFormatted: `${roundedErrorRate}%`,
      p95LatencyMs: Math.round(p95 * 10) / 10,
      p95LatencyFormatted: p95 > 0 ? `${Math.round(p95)}ms` : null,
      endpointsHit: [...endpointsHit],
      hourly: hourly.sort((a, b) => a.hour.localeCompare(b.hour)),
    };
  } catch (err) {
    console.warn('Integration health fetch failed:', err);
    return null;
  }
}
