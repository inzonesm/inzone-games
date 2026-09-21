/**
 * Marking a visit as test traffic.
 *
 * Three behaviours are involved and they are NOT the same thing. Conflating
 * them is how test activity ends up teaching an ad platform what a customer
 * looks like:
 *
 *   1. SUPPRESSING META EMISSION — a test session must never send a verified
 *      conversion to the pixel. A fake conversion is not merely noise in a
 *      report; it trains delivery toward the wrong people and cannot be
 *      retracted once sent.
 *   2. PRESERVING HEXCLAVE DIAGNOSTICS — a test session's events should still
 *      be recorded. They are how a check is later shown to have run at all.
 *   3. EXCLUDING FROM CUSTOMER REPORTS — acquisition and engagement figures
 *      must not count test activity, whether or not it was emitted anywhere.
 *
 * This module supplies only the marker and the predicates. It deliberately
 * holds no transport, no storage and no React, so it can be imported from the
 * analytics path, from a report, or from a test harness without pulling any
 * of those along.
 *
 * WHY A DEDICATED PARAMETER, NOT A UTM
 * ------------------------------------
 * Every key in `UTM_KEYS` carries acquisition meaning. Marking test traffic by
 * setting `utm_source=qa` would overwrite the very attribution a test of the
 * acquisition flow needs to keep. A separate parameter marks the visit as test
 * traffic while leaving whatever campaign attribution it carries intact, so a
 * marked session can still exercise a real campaign URL end to end.
 */

/** The query parameter that marks a visit as test traffic. */
export const QA_QUERY_PARAM = 'inzone_qa';

/**
 * The value recorded on the event payload.
 *
 * A single field with a closed set of values, rather than a boolean, so the
 * origin of a marked visit stays legible in a report: an automated browser
 * check reads differently from a person testing by hand.
 */
export const TRAFFIC_KIND_KEY = 'traffic_kind';
export const TRAFFIC_KINDS = ['agent', 'manual'] as const;
export type TrafficKind = (typeof TRAFFIC_KINDS)[number];

function isTrafficKind(v: string): v is TrafficKind {
  return (TRAFFIC_KINDS as readonly string[]).includes(v);
}

/**
 * Read the marker out of a query string.
 *
 * Returns null for unmarked traffic, which is the case that must stay cheap
 * and must never be guessed at: an ordinary visitor carries no marker, and
 * nothing about their URL may be read as one. An unrecognised value is
 * treated as unmarked rather than as some third kind, so a typo fails toward
 * counting the visit rather than silently dropping it.
 */
export function trafficKindFromSearch(search: string | URLSearchParams | null | undefined): TrafficKind | null {
  if (!search) return null;
  let params: URLSearchParams;
  try {
    params = typeof search === 'string' ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search) : search;
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
 * Deliberately phrased around the recorded field rather than the URL: by the
 * time a `game_start` happens the visitor may be several navigations past the
 * marked entry, so the decision has to rest on what was remembered for the
 * visit, not on the address bar at that moment.
 */
export function mayEmitToAdPlatform(trafficKind: string | null | undefined): boolean {
  return !trafficKind;
}

/** Whether customer-facing acquisition and engagement figures may count this visit. */
export function countsAsCustomerTraffic(trafficKind: string | null | undefined): boolean {
  return !trafficKind;
}

/**
 * Add the marker to a URL, for test harnesses.
 *
 * Existing query parameters are preserved untouched, so a harness can drive a
 * real campaign URL — UTMs, click ids and all — and still have the visit
 * excluded. That is the property that makes it possible to test the
 * acquisition path without corrupting acquisition data.
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
