/**
 * Marking a visit as test traffic, and classifying where it happened.
 *
 * Three behaviours are involved and they are NOT the same. Conflating them is
 * how a test session ends up teaching an ad platform what a customer looks
 * like:
 *
 *   1. SUPPRESSING META — a Preview deployment or a marked test visit must
 *      never initialise the pixel or send a verified conversion. A fake
 *      conversion is not merely noise in a report: it trains delivery toward
 *      the wrong people and cannot be retracted once sent.
 *   2. PRESERVING HEXCLAVE DIAGNOSTICS — those same visits should still record
 *      events. They are how a check is later shown to have run at all. They
 *      carry `app_env` and `traffic_kind` so a report can tell them apart.
 *   3. EXCLUDING FROM CUSTOMER REPORTS — acquisition and engagement figures
 *      count production, unmarked traffic only.
 *
 * This module holds only the classification and the predicates: no transport,
 * no React, so the analytics path, the pixel component, a report and a test
 * harness can all import it.
 *
 * WHY A DEDICATED PARAMETER, NOT A UTM
 * ------------------------------------
 * Every key in `UTM_KEYS` carries acquisition meaning. Marking test traffic by
 * setting `utm_source=qa` would overwrite the very attribution a test of the
 * acquisition flow needs to keep. A separate parameter marks the visit while
 * leaving its campaign attribution untouched, so a marked session can drive a
 * real ad URL end to end and still be excluded everywhere.
 */

/** The query parameter that marks a visit as test traffic. */
export const QA_QUERY_PARAM = 'inzone_qa';

/** Recorded on every event, so a report can separate diagnostics from customers. */
export const TRAFFIC_KIND_KEY = 'traffic_kind';
export const APP_ENV_KEY = 'app_env';

export const TRAFFIC_KINDS = ['agent', 'manual'] as const;
export type TrafficKind = (typeof TRAFFIC_KINDS)[number];

/**
 * Where the visit happened.
 *
 * `unknown` is a real answer, not a fallback to production. A hostname we do
 * not recognise might be a staging alias, a rename, or a proxy; counting it as
 * customer traffic because we failed to classify it is exactly the mistake
 * this field exists to prevent.
 */
export const APP_ENVS = ['production', 'preview', 'local', 'unknown'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/** The only hostnames that serve customers. Exact matches, never suffixes. */
export const PRODUCTION_HOSTNAMES = ['inzone.games', 'www.inzone.games'] as const;

function isTrafficKind(v: string): v is TrafficKind {
  return (TRAFFIC_KINDS as readonly string[]).includes(v);
}

/**
 * Classify a hostname.
 *
 * Production is an exact allowlist. A suffix test would let
 * `inzone.games.example.com` through, so it is deliberately not used.
 */
export function classifyHost(hostname: string | null | undefined): AppEnv {
  const h = (hostname ?? '').trim().toLowerCase().replace(/:\d+$/, '');
  if (!h) return 'unknown';
  if ((PRODUCTION_HOSTNAMES as readonly string[]).includes(h)) return 'production';
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.local')) return 'local';
  if (h.endsWith('.vercel.app')) return 'preview';
  return 'unknown';
}

/**
 * Read the marker out of a query string.
 *
 * An unrecognised value is treated as unmarked rather than as some third kind,
 * so a typo fails toward counting a real visitor rather than silently dropping
 * them.
 */
export function trafficKindFromSearch(
  search: string | URLSearchParams | null | undefined,
): TrafficKind | null {
  if (!search) return null;
  let params: URLSearchParams;
  try {
    params =
      typeof search === 'string'
        ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
        : search;
  } catch {
    return null;
  }
  const raw = (params.get(QA_QUERY_PARAM) ?? '').trim().toLowerCase();
  if (!raw) return null;
  return isTrafficKind(raw) ? raw : null;
}

/** Same, from a full href. A malformed URL is unmarked, never an error. */
export function trafficKindFromHref(href: string | null | undefined): TrafficKind | null {
  if (!href) return null;
  try {
    return trafficKindFromSearch(new URL(href).search);
  } catch {
    return null;
  }
}

/**
 * Whether a verified conversion from this visit may reach the ad platform.
 *
 * Only production, unmarked traffic qualifies. Everything else — Preview,
 * local, an unrecognised host, or any marked visit — is withheld.
 */
export function mayEmitToAdPlatform(input: {
  appEnv: string | null | undefined;
  trafficKind: string | null | undefined;
}): boolean {
  if (input.trafficKind) return false;
  return input.appEnv === 'production';
}

/** Whether customer-facing acquisition and engagement figures may count this visit. */
export function countsAsCustomerTraffic(input: {
  appEnv: string | null | undefined;
  trafficKind: string | null | undefined;
}): boolean {
  return mayEmitToAdPlatform(input);
}

/* ── Per-tab classification ───────────────────────────────────────────────
 *
 * Stored in sessionStorage, deliberately: the marker usually appears only on
 * the entry URL, but a `game_start` may happen several navigations later, so
 * the classification has to survive same-tab navigation. sessionStorage dies
 * with the tab, so marking one test visit never turns that browser into a
 * permanently excluded visitor — which localStorage would do, and which would
 * silently delete a real person from the numbers for good.
 */

export const QA_SESSION_KEY = 'inzone.qa-traffic.v1';

/**
 * Resolve this visit's traffic kind, remembering it for the rest of the tab.
 *
 * Reads the marker from the current URL when present; otherwise falls back to
 * what this tab already recorded. Storage failures (private mode, disabled
 * storage) degrade to the URL alone rather than throwing.
 */
export function resolveTrafficKind(
  search: string | URLSearchParams | null | undefined,
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null,
): TrafficKind | null {
  const store =
    storage ??
    (typeof window === 'undefined' ? null : safeSessionStorage());
  const fromUrl = trafficKindFromSearch(search);
  if (fromUrl) {
    try {
      store?.setItem(QA_SESSION_KEY, fromUrl);
    } catch {
      /* storage unavailable: the URL still classified this navigation */
    }
    return fromUrl;
  }
  try {
    const held = (store?.getItem(QA_SESSION_KEY) ?? '').trim().toLowerCase();
    return isTrafficKind(held) ? held : null;
  } catch {
    return null;
  }
}

function safeSessionStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** This visit's environment, from the live location. */
export function resolveAppEnv(hostname?: string | null): AppEnv {
  if (typeof hostname === 'string') return classifyHost(hostname);
  if (typeof window === 'undefined') return 'unknown';
  try {
    return classifyHost(window.location.hostname);
  } catch {
    return 'unknown';
  }
}

/**
 * Add the marker to a URL, for test harnesses.
 *
 * Existing query parameters are preserved untouched, so a harness can drive a
 * real campaign URL — UTMs, click ids and all — and still be excluded. That is
 * what makes it possible to test the acquisition path without corrupting
 * acquisition data.
 */
export function withQaMarker(href: string, kind: TrafficKind = 'agent'): string {
  try {
    const u = new URL(href);
    u.searchParams.set(QA_QUERY_PARAM, kind);
    return u.toString();
  } catch {
    const sep = href.includes('?') ? '&' : '?';
    return `${href}${sep}${QA_QUERY_PARAM}=${encodeURIComponent(kind)}`;
  }
}

/**
 * Decide, for one recorded row, whether it counts as customer traffic.
 *
 * The daily report cannot call this — its filtering runs as SQL inside
 * ClickHouse — so the SQL in `scripts/daily-product-report.mjs` mirrors this
 * function clause for clause, and `tests/qa-traffic-report.test.mjs` asserts
 * both against the same fixtures so the two cannot drift apart unnoticed.
 *
 * `legacyQaUtm` covers conventions that predate the marker
 * (`utm_medium=qa|verification`, `utm_content=exclude_from_acquisition`).
 * They never suppressed anything at emission time; they are honoured here so
 * historical rows are still excluded from customer figures. They are NOT a
 * supported way to mark new traffic.
 */
export type ReportRow = {
  /** Full recorded URL, as stored on the event. */
  url?: string | null;
  traffic_kind?: string | null;
  utm_medium?: string | null;
  utm_content?: string | null;
  user_id?: string | null;
};

export function hostnameOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function classifyReportRow(
  row: ReportRow,
  historicalQaUserIds: readonly string[] = [],
): { bucket: 'customer' | 'diagnostic'; appEnv: AppEnv; reason: string } {
  const host = hostnameOf(row.url);
  // A row with no usable URL is unknown, never production.
  const appEnv: AppEnv = host === null ? 'unknown' : classifyHost(host);
  if (appEnv !== 'production') {
    return { bucket: 'diagnostic', appEnv, reason: `non-production host (${appEnv})` };
  }
  if (row.traffic_kind) {
    return { bucket: 'diagnostic', appEnv, reason: `marked ${row.traffic_kind}` };
  }
  const medium = (row.utm_medium ?? '').trim().toLowerCase();
  if (medium === 'qa' || medium === 'verification') {
    return { bucket: 'diagnostic', appEnv, reason: 'legacy utm_medium convention' };
  }
  if ((row.utm_content ?? '').trim() === 'exclude_from_acquisition') {
    return { bucket: 'diagnostic', appEnv, reason: 'legacy utm_content convention' };
  }
  if (row.user_id && historicalQaUserIds.includes(row.user_id)) {
    return { bucket: 'diagnostic', appEnv, reason: 'documented historical QA id' };
  }
  return { bucket: 'customer', appEnv, reason: 'production, unmarked' };
}
