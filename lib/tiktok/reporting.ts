/**
 * TikTok Ads reporting — read-only Business API client.
 *
 * Server-only. Never import from a `'use client'` module. Every call here
 * uses the `/report/integrated/get/` endpoint with `service_type: 'AUCTION'`
 * and a `data_level` of `campaign` / `adgroup` / `ad`, which are the read
 * paths documented for the Marketing API. There are no write calls in this
 * file — the endpoint list is deliberate, not exhaustive.
 *
 * Nothing here creates campaigns, edits budgets, uploads creatives, or
 * publishes ads. If a future task needs those, they land in a separate
 * file with a different auth check so the write surface stays visible on
 * inspection.
 *
 * Attribution model: TikTok's ad-manager attribution window is exposed on
 * the report response (usually 7-day-click / 1-day-view). We report what
 * TikTok returns and label it as such — customer-journey observations from
 * Hexclave are a separate signal and must NEVER be silently combined with
 * this data. See `docs/TIKTOK_INTEGRATION.md`.
 */

import {
  TIKTOK_BUSINESS_API_BASE,
  tiktokReportingConfig,
  type TikTokReportingConfig,
} from './config.ts';

/** Metrics we pull for every level. ROUND D (2026-09-25): TikTok rejected
 *  all four p-prefix quartile names (`video_watched_p25` etc.). `conversion`
 *  (singular) was NOT named — it is valid. 13 metrics now confirmed valid.
 *  Testing both remaining quartile schemes at once: `video_views_p*` and
 *  `video_watched_*p`. TikTok names every invalid field, so one round
 *  definitively identifies the valid scheme if one exists. If both schemes
 *  fail, quartiles are dropped and the 13-metric set is final.
 *  Confirmed-invalid so far: `campaign_name` (dimension), `conversions`,
 *  `landing_page_view`, `currency`, `video_watched_p25/p50/p75/p100`.
 */
export const TIKTOK_METRICS = [
  'spend',
  'impressions',
  'clicks',
  'ctr',
  'cpc',
  'cpm',
  'reach',
  'conversion',
  'video_play_actions',
  'video_watched_2s',
  'video_watched_6s',
  'video_views_p25',
  'video_views_p50',
  'video_views_p75',
  'video_views_p100',
  'video_watched_25p',
  'video_watched_50p',
  'video_watched_75p',
  'video_watched_100p',
  'cost_per_conversion',
  'conversion_rate',
] as const;

export type TikTokDataLevel = 'AUCTION_CAMPAIGN' | 'AUCTION_ADGROUP' | 'AUCTION_AD';

export type TikTokReportRequest = {
  /** `YYYY-MM-DD`, advertiser-account timezone. Both required. */
  startDate: string;
  endDate: string;
  level: TikTokDataLevel;
  /** Optional page for pagination continuation; TikTok pages via cursor. */
  page?: number;
  /** Optional filtering by ids at the requested level. */
  filterIds?: readonly string[];
};

export type TikTokReportRow = {
  /** Identifier at the requested level (campaign_id / adgroup_id / ad_id). */
  id: string;
  name?: string;
  /** Numeric metrics come back as strings from TikTok. Kept as-is. */
  metrics: Record<string, string>;
};

export type TikTokReportResponse = {
  requested: TikTokReportRequest;
  /** Advertiser timezone name (e.g. `America/Los_Angeles`) from the response header. */
  timezone: string | null;
  currency: string | null;
  /** Attribution window TikTok used to compute the conversion columns. */
  attributionWindow: string | null;
  rows: TikTokReportRow[];
  pageInfo: { page: number; pageSize: number; totalPages: number; totalCount: number };
};

export class TikTokReportingError extends Error {
  code: string;
  status: number;
  /** TikTok's `request_id` for the failed call, when the API supplied one. */
  requestId?: string;
  constructor(code: string, status: number, message: string, requestId?: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

/**
 * Sanitize an upstream TikTok error message before it reaches the admin UI.
 * TikTok's messages are human-readable explanations, but they arrive over
 * the wire next to credentials, so treat them as potentially sensitive:
 * strip raw URLs, header dumps, and long token-looking strings, and cap the
 * length. The TikTok error code and request_id travel separately and are
 * always preserved.
 */
export function sanitizeTikTokErrorMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s"'<>]+/g, '[url]')
    .replace(/[A-Za-z0-9._~-]{40,}/g, '[redacted]')
    .slice(0, 500);
}

function assertConfigured(cfg: TikTokReportingConfig | null): asserts cfg is TikTokReportingConfig {
  if (!cfg) {
    throw new TikTokReportingError(
      'not_configured',
      500,
      'TIKTOK_ACCESS_TOKEN and TIKTOK_ADVERTISER_ID must both be set. See docs/TIKTOK_INTEGRATION.md.',
    );
  }
}

/**
 * Call the TikTok Business API with the token. All requests are GETs;
 * responses come as `{ code, message, data, request_id }`. TikTok returns
 * 200 with `code !== 0` on API errors, so we check both HTTP status and
 * the body code.
 */
async function callBusinessApi(
  path: string,
  query: Record<string, string | number | undefined>,
  cfg: TikTokReportingConfig,
): Promise<{ data: Record<string, unknown>; timezone: string | null }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) params.set(k, String(v));
  }
  const url = `${TIKTOK_BUSINESS_API_BASE}${path}?${params.toString()}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        'Access-Token': cfg.accessToken,
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    throw new TikTokReportingError(
      'network_error',
      0,
      `TikTok Business API unreachable — check network egress. ${(err as Error).message}`,
    );
  }
  const timezone = res.headers.get('X-Advertiser-Timezone');
  let body: { code?: number; message?: string; data?: unknown; request_id?: string };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new TikTokReportingError(
      'invalid_response',
      res.status,
      `TikTok Business API returned non-JSON at ${path} (HTTP ${res.status}).`,
    );
  }
  if (res.status >= 400 || (typeof body.code === 'number' && body.code !== 0)) {
    const requestId = typeof body.request_id === 'string' ? body.request_id : undefined;
    throw new TikTokReportingError(
      `tiktok_${body.code ?? 'http_' + res.status}`,
      res.status,
      body.message || `TikTok error at ${path}`,
      requestId,
    );
  }
  return {
    data: (body.data as Record<string, unknown>) || {},
    timezone,
  };
}

/**
 * Fetch a report at campaign / adgroup / ad level. Read-only.
 *
 * @param req - Range + level + optional filter
 * @param env - Injectable for tests; defaults to process.env
 */
export async function fetchTikTokReport(
  req: TikTokReportRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TikTokReportResponse> {
  const cfg = tiktokReportingConfig(env);
  assertConfigured(cfg);
  // ROUND B (2026-09-25): TikTok rejected `campaign_name` as a dimension
  // ("campaign_name is not supported"), so all levels use id-only
  // dimensions. The admin UI falls back to showing the id where a name
  // would go.
  const dimensions =
    req.level === 'AUCTION_CAMPAIGN'
      ? ['campaign_id']
      : req.level === 'AUCTION_ADGROUP'
        ? ['adgroup_id']
        : ['ad_id'];
  const query: Record<string, string | number | undefined> = {
    advertiser_id: cfg.advertiserId,
    service_type: 'AUCTION',
    report_type: 'BASIC',
    data_level: req.level,
    dimensions: JSON.stringify(dimensions),
    metrics: JSON.stringify(TIKTOK_METRICS),
    start_date: req.startDate,
    end_date: req.endDate,
    page: req.page ?? 1,
    page_size: 100,
  };
  if (req.filterIds && req.filterIds.length > 0) {
    const idField =
      req.level === 'AUCTION_CAMPAIGN'
        ? 'campaign_ids'
        : req.level === 'AUCTION_ADGROUP'
          ? 'adgroup_ids'
          : 'ad_ids';
    query.filtering = JSON.stringify([{ field_name: idField, filter_type: 'IN', filter_value: JSON.stringify(req.filterIds) }]);
  }
  const { data, timezone } = await callBusinessApi('/report/integrated/get/', query, cfg);
  return {
    requested: req,
    timezone,
    currency: (data as { currency?: string }).currency ?? null,
    attributionWindow: (data as { attribution_window?: string }).attribution_window ?? null,
    rows: shapeRows(data, req.level),
    pageInfo: shapePageInfo(data),
  };
}

function shapeRows(data: Record<string, unknown>, level: TikTokDataLevel): TikTokReportRow[] {
  const list = Array.isArray(data.list) ? (data.list as Record<string, unknown>[]) : [];
  const idField =
    level === 'AUCTION_CAMPAIGN' ? 'campaign_id' : level === 'AUCTION_ADGROUP' ? 'adgroup_id' : 'ad_id';
  const nameField =
    level === 'AUCTION_CAMPAIGN' ? 'campaign_name' : level === 'AUCTION_ADGROUP' ? 'adgroup_name' : 'ad_name';
  return list.map((row) => {
    const dims = (row.dimensions as Record<string, unknown> | undefined) || {};
    const mets = (row.metrics as Record<string, unknown> | undefined) || {};
    return {
      id: String(dims[idField] ?? row[idField] ?? ''),
      name: typeof dims[nameField] === 'string' ? (dims[nameField] as string) : undefined,
      metrics: Object.fromEntries(
        Object.entries(mets).map(([k, v]) => [k, v == null ? '' : String(v)]),
      ),
    };
  });
}

function shapePageInfo(data: Record<string, unknown>): TikTokReportResponse['pageInfo'] {
  const info = (data.page_info as Record<string, unknown> | undefined) ?? {};
  return {
    page: Number(info.page ?? 1) || 1,
    pageSize: Number(info.page_size ?? 100) || 100,
    totalPages: Number(info.total_page ?? 1) || 1,
    totalCount: Number(info.total_number ?? 0) || 0,
  };
}
