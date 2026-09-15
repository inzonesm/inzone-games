/**
 * Campaign conversion events for /session-prototype, sent through Hexclave's
 * existing analytics batch ingest. Automatic $page-view / $click stay on the SDK
 * but every analytics batch is rewritten so url/href/referrer never include
 * session ids or invite links, and click `text` (chat) is dropped.
 *
 * First-touch UTM is stored in sessionStorage so attribution survives in-app
 * game switches and invite replaceState (which would otherwise drop query params).
 * Chat text, invite URLs, and session ids are never attached to events.
 * iframe focus and SDK save/load/purchase are labeled as proxies, not
 * gameplay_started. The current host has no explicit game-start signal.
 */

export const CAMPAIGN_STORAGE_KEY = 'inzone.campaign.v1';

export const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const;

export type UtmKey = (typeof UTM_KEYS)[number];

export type CampaignAttribution = Partial<Record<UtmKey, string>>;

export const CAMPAIGN_EVENTS = {
  arrival: 'campaign_arrival',
  inviteCopied: 'invite_copied',
  inviteJoined: 'invite_joined',
  gameSuggested: 'game_suggested',
  gameOpened: 'game_opened',
  keepPlaying: 'keep_playing',
  gameFrameFocused: 'game_frame_focused',
  gameSdkActivity: 'game_sdk_activity',
  homeView: 'home_view',
  discoverView: 'discover_view',
  gameOpen: 'game_open',
  gameStart: 'game_start',
  inviteSheetOpen: 'invite_sheet_open',
  inviteReceive: 'invite_receive',
  inviteAccepted: 'invite_accepted',
  sessionMessage: 'session_message',
  sessionEnded: 'session_ended',
  /* ── Gameplay measurement (see lib/gameplay-signals.ts) ──────────────────
     The first two are the honest names for the two things that are NOT
     gameplay, so neither can be mistaken for it in a report:
       - game_frame_loaded: the bundle's `load` fired. A PROXY. This is what
         `game_start` was wrongly being emitted from.
       - game_ready: the build reported itself initialised.
     The rest are verified: they only exist because a build told us the player
     did something. */
  gameFrameLoaded: 'game_frame_loaded',
  gameReady: 'game_ready',
  engagedPlay: 'engaged_play',
  firstGameOver: 'first_game_over',
  returnPlay: 'return_play',
} as const;

/**
 * Events that are only ever emitted from a build's own gameplay signal.
 *
 * Verified-player reporting must be built from these and nothing else. Anything
 * outside this set — frame loads, focus, SDK calls — is a proxy and belongs in a
 * separate column.
 */
export const VERIFIED_GAMEPLAY_EVENTS = [
  'game_start',
  'engaged_play',
  'first_game_over',
  'return_play',
] as const;

/** Named proxies. Real signals, but not evidence that anyone played. */
export const PROXY_GAMEPLAY_EVENTS = [
  'game_frame_loaded',
  'game_frame_focused',
  'game_sdk_activity',
] as const;

export function isVerifiedGameplayEvent(name: string): boolean {
  return (VERIFIED_GAMEPLAY_EVENTS as readonly string[]).includes(name);
}

/** Hexclave ingest only allows `$page-view` / `$click`; campaign names live here. */
export const HEXCLAVE_CAMPAIGN_EVENT_FIELD = 'inzone_event';

export type CampaignEventName = (typeof CAMPAIGN_EVENTS)[keyof typeof CAMPAIGN_EVENTS];

export const SDK_ACTIVITY_OPERATIONS = ['saveState', 'loadState', 'requestPurchase'] as const;
export type SdkActivityOperation = (typeof SDK_ACTIVITY_OPERATIONS)[number];

/**
 * Extra string properties measurement events are allowed to carry.
 *
 * The allowlist is the whole point: `sanitizeData` drops anything it does not
 * recognise, so a new property cannot reach the wire by accident. None of these
 * is derived from a person — `visitor_id` and `visit_id` are random ids, and the
 * rest are our own bookkeeping.
 */
export const MEASUREMENT_STRING_KEYS = [
  'run_id',
  'visit_id',
  'visitor_id',
  'day',
  'timezone',
  'signal_source',
  'acquisition',
  'outcome',
] as const;

/** Numeric properties that may ride along. Counts and durations only. */
export const MEASUREMENT_NUMBER_KEYS = ['active_seconds'] as const;

export type CampaignEventData = CampaignAttribution & {
  game_id?: string;
  operation?: SdkActivityOperation;
} & Partial<Record<(typeof MEASUREMENT_STRING_KEYS)[number], string>>
  & Partial<Record<(typeof MEASUREMENT_NUMBER_KEYS)[number], number>>;

export type CampaignEvent = {
  name: CampaignEventName;
  at: number;
  data: CampaignEventData;
};

export type CampaignTransport = (event: CampaignEvent) => void;

/** Public paid-campaign landing URL. No session id. */
export const PUBLIC_CAMPAIGN_URL =
  'https://www.inzone.games/session-prototype?utm_source=gtm&utm_medium=cpc&utm_campaign=play-together-2026&game=nightclub-showdown-inzone-production';

const SECRET_KEY = /^(session|session_id|sessionid|room|invite|text|message|body|url|href|link|clipboard)$/i;
const AUTO_DROP_KEY = /^(session|session_id|sessionid|room|invite|text|message|body|clipboard|secret|token|password|elements_chain)$/i;
const AUTO_URL_KEY = /^(url|href|link|referrer)$/i;
const SESSION_QUERY_KEYS = new Set(['session', 'invite', 'invite_code', 'token']);
const SESSION_ID_RE = /^[a-f0-9]{32}$/;
const wrappedAnalyticsInterfaces = new WeakSet<object>();

const SDK_ACTIVITY_SET = new Set<string>(SDK_ACTIVITY_OPERATIONS);

let transport: CampaignTransport | null = null;
const memoryStore = new Map<string, string>();
let arrivalSent = false;
let frameFocusedForGame = '';
const sdkActivitySent = new Set<string>();
let lastGameOpenedKey = '';

function storage(): { getItem(k: string): string | null; setItem(k: string, v: string): void } {
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage;
  } catch {
    /* private mode */
  }
  return {
    getItem: (k) => memoryStore.get(k) ?? null,
    setItem: (k, v) => {
      memoryStore.set(k, v);
    },
  };
}

export function setCampaignTransport(next: CampaignTransport | null): void {
  transport = next;
}

export function resetCampaignAnalyticsForTests(): void {
  transport = null;
  memoryStore.clear();
  arrivalSent = false;
  frameFocusedForGame = '';
  sdkActivitySent.clear();
  lastGameOpenedKey = '';
  try {
    sessionStorage?.removeItem(CAMPAIGN_STORAGE_KEY);
    sessionStorage?.removeItem(ARRIVAL_SENT_KEY);
  } catch {
    /* ignore */
  }
}

export function parseAttribution(source: string | URLSearchParams | { search?: string; href?: string }): CampaignAttribution {
  let params: URLSearchParams;
  if (typeof source === 'string') {
    try {
      params = source.includes('://')
        ? new URL(source).searchParams
        : new URL(source, 'https://www.inzone.games').searchParams;
    } catch {
      params = new URLSearchParams(source.startsWith('?') ? source.slice(1) : source);
    }
  } else if (source instanceof URLSearchParams) {
    params = source;
  } else {
    try {
      params = source.href
        ? new URL(source.href).searchParams
        : new URL(source.search || '', 'https://www.inzone.games').searchParams;
    } catch {
      params = new URLSearchParams();
    }
  }
  const out: CampaignAttribution = {};
  for (const key of UTM_KEYS) {
    const raw = params.get(key)?.trim() || '';
    if (!raw || raw.length > 200) continue;
    if (SESSION_ID_RE.test(raw)) continue;
    out[key] = raw;
  }
  return out;
}

export function hasAttribution(attr: CampaignAttribution): boolean {
  return UTM_KEYS.some((key) => Boolean(attr[key]));
}

export function readStoredAttribution(): CampaignAttribution {
  const raw = storage().getItem(CAMPAIGN_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return sanitizeData(parsed as Record<string, unknown>);
  } catch {
    return {};
  }
}

export function rememberAttribution(attr: CampaignAttribution): CampaignAttribution {
  const stored = readStoredAttribution();
  if (hasAttribution(stored)) return stored;
  if (!hasAttribution(attr)) return stored;
  const clean = sanitizeData({ ...attr });
  storage().setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(clean));
  return clean;
}

/** Strip session/invite query params from a URL while keeping UTM + game. */
export function publicAnalyticsUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed, 'https://www.inzone.games');
    for (const key of SESSION_QUERY_KEYS) u.searchParams.delete(key);
    for (const [key, value] of [...u.searchParams.entries()]) {
      if (SESSION_ID_RE.test(value.trim())) u.searchParams.delete(key);
    }
    if (/session=|invite=/i.test(u.hash)) u.hash = '';
    const out = u.toString();
    if (isForbiddenCampaignValue(out)) return null;
    return out;
  } catch {
    return null;
  }
}

/** Rewrite Hexclave $page-view / $click payloads so they cannot leak secrets. */
export function sanitizeAutomaticEventData(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (AUTO_DROP_KEY.test(key)) continue;
    if (AUTO_URL_KEY.test(key)) {
      if (typeof value !== 'string') continue;
      const cleaned = publicAnalyticsUrl(value);
      if (cleaned) out[key] = cleaned;
      continue;
    }
    if (typeof value === 'string') {
      const v = value.trim();
      if (!v || isForbiddenCampaignValue(v) || SESSION_ID_RE.test(v)) continue;
      out[key] = value;
      continue;
    }
    if (value == null || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

const CAMPAIGN_EVENT_NAMES = new Set<string>(Object.values(CAMPAIGN_EVENTS));

export function campaignEventNameFromHexclaveEvent(event: {
  event_type?: unknown;
  data?: unknown;
}): CampaignEventName | null {
  const data =
    event.data && typeof event.data === 'object' && !Array.isArray(event.data)
      ? (event.data as Record<string, unknown>)
      : null;
  for (const value of [data?.[HEXCLAVE_CAMPAIGN_EVENT_FIELD], data?.entry_type, event.event_type]) {
    if (typeof value === 'string' && CAMPAIGN_EVENT_NAMES.has(value)) {
      return value as CampaignEventName;
    }
  }
  return null;
}

/** Sanitize a Hexclave analytics batch JSON body (custom + automatic events). */
export function sanitizeAnalyticsBatchBody(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return body;
  const batch = parsed as { events?: unknown };
  if (!Array.isArray(batch.events)) return body;
  const events = batch.events.map((event) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return event;
    const record = event as { event_type?: unknown; data?: unknown };
    if (!record.data || typeof record.data !== 'object' || Array.isArray(record.data)) return event;
    const data = record.data as Record<string, unknown>;
    const name = typeof record.event_type === 'string' ? record.event_type : '';
    const nextData = CAMPAIGN_EVENT_NAMES.has(name)
      ? sanitizeData(data)
      : sanitizeAutomaticEventData(data);
    return { ...record, data: nextData };
  });
  return JSON.stringify({ ...batch, events });
}

/**
 * Intercept Hexclave's analytics ingest so automatic $page-view / $click
 * cannot ship session URLs or chat text. EventTracker flushes through
 * `_interface.sendAnalyticsEventBatch`, not the internals getter.
 * Gzip encoding happens inside that method, so this wrap sees JSON.
 * Production also wraps `fetch` (see hexclave-analytics-outbound) because
 * the Provider reconstructs a different client than a module-level app.
 */
export function wrapHexclaveAnalyticsTransport(
  app: unknown,
  options: { required?: boolean } = {},
): void {
  if (!app || typeof app !== 'object') {
    if (options.required) {
      throw new Error('Hexclave Provider analytics client is missing');
    }
    return;
  }
  const iface = (app as { _interface?: { sendAnalyticsEventBatch?: (...args: unknown[]) => unknown } })._interface;
  if (!iface || typeof iface.sendAnalyticsEventBatch !== 'function') {
    if (options.required) {
      throw new Error('Hexclave Provider analytics transport is missing sendAnalyticsEventBatch');
    }
    return;
  }
  if (wrappedAnalyticsInterfaces.has(iface)) return;
  wrappedAnalyticsInterfaces.add(iface);
  const original = iface.sendAnalyticsEventBatch.bind(iface);
  iface.sendAnalyticsEventBatch = (body: unknown, ...rest: unknown[]) =>
    original(typeof body === 'string' ? sanitizeAnalyticsBatchBody(body) : body, ...rest);
}

const MEASUREMENT_STRING_SET = new Set<string>(MEASUREMENT_STRING_KEYS);
const MEASUREMENT_NUMBER_SET = new Set<string>(MEASUREMENT_NUMBER_KEYS);

export function sanitizeData(input: Record<string, unknown>): CampaignEventData {
  const out: CampaignEventData = {};
  for (const [key, value] of Object.entries(input)) {
    if (SECRET_KEY.test(key)) continue;
    if (key === 'operation') {
      if (typeof value === 'string' && SDK_ACTIVITY_SET.has(value)) {
        out.operation = value as SdkActivityOperation;
      }
      continue;
    }
    if (MEASUREMENT_NUMBER_SET.has(key)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        (out as Record<string, number>)[key] = value;
      }
      continue;
    }
    if (typeof value !== 'string') continue;
    const v = value.trim();
    if (!v || v.length > 200) continue;
    if (SESSION_ID_RE.test(v)) continue;
    if (key === 'game_id') {
      out.game_id = v;
      continue;
    }
    if (MEASUREMENT_STRING_SET.has(key)) {
      (out as Record<string, string>)[key] = v;
      continue;
    }
    if ((UTM_KEYS as readonly string[]).includes(key)) {
      out[key as UtmKey] = v;
    }
  }
  return out;
}

export function eventPayload(
  name: CampaignEventName,
  extra: Record<string, unknown> = {},
  at = Date.now(),
): CampaignEvent {
  const data = sanitizeData({
    ...readStoredAttribution(),
    ...extra,
  });
  return { name, at, data };
}

export function trackCampaignEvent(name: CampaignEventName, extra: Record<string, unknown> = {}): CampaignEvent {
  const event = eventPayload(name, extra);
  try {
    transport?.(event);
  } catch (err) {
    console.error('[hexclave] campaign event failed', err);
  }
  return event;
}

/** Set once an arrival has been counted for this tab, so a refresh cannot recount it. */
export const ARRIVAL_SENT_KEY = 'inzone.arrival-sent.v1';

export function captureCampaignArrival(
  source: string | URLSearchParams | { search?: string; href?: string },
): CampaignEvent | null {
  const incoming = parseAttribution(source);
  const attr = rememberAttribution(incoming);
  if (!hasAttribution(attr) || arrivalSent) return null;
  // The module flag dies with the page, so on its own it lets a refresh count a
  // second arrival for the same visitor on the same campaign click. One arrival
  // per tab is the honest number.
  if (storage().getItem(ARRIVAL_SENT_KEY)) {
    arrivalSent = true;
    return null;
  }
  arrivalSent = true;
  storage().setItem(ARRIVAL_SENT_KEY, '1');
  return trackCampaignEvent(CAMPAIGN_EVENTS.arrival);
}

/** Keep first-touch UTM on the address bar without adding them to copied invites. */
export function mergeAttributionSearch(pathAndSearch: string): string {
  const u = new URL(pathAndSearch, 'https://www.inzone.games');
  const attr = readStoredAttribution();
  for (const key of UTM_KEYS) {
    const value = attr[key];
    if (value && !u.searchParams.get(key)) u.searchParams.set(key, value);
  }
  return `${u.pathname}${u.search}`;
}

export function isSdkActivityOperation(method: string): method is SdkActivityOperation {
  return SDK_ACTIVITY_SET.has(method);
}

export function noteGameFrameFocused(gameId: string): CampaignEvent | null {
  if (!gameId || frameFocusedForGame === gameId) return null;
  frameFocusedForGame = gameId;
  return trackCampaignEvent(CAMPAIGN_EVENTS.gameFrameFocused, { game_id: gameId });
}

export function noteGameSdkActivity(gameId: string, operation: string): CampaignEvent | null {
  if (!gameId || !isSdkActivityOperation(operation)) return null;
  const key = `${gameId}:${operation}`;
  if (sdkActivitySent.has(key)) return null;
  sdkActivitySent.add(key);
  return trackCampaignEvent(CAMPAIGN_EVENTS.gameSdkActivity, { game_id: gameId, operation });
}

/**
 * SDK traffic is not gameplay.
 *
 * A save, a load or a purchase proves the SDK is wired up, not that anyone is
 * playing — a build can save on load. Verified starts come from a build's own
 * gameplay signal instead (lib/gameplay-signals.ts), so this stays false and
 * these proxies keep their own event names.
 */
export function isExplicitGameStartSignal(_data: unknown): boolean {
  return false;
}

export function noteGameplayStarted(_gameId: string, data?: unknown): CampaignEvent | null {
  if (!_gameId || !isExplicitGameStartSignal(data)) return null;
  return null;
}

export type GameOpenedCause = 'play' | 'open-suggested' | 'cancel' | 'same-game' | 'restore';

/**
 * User-confirmed remounts only: Discover → Play and Open suggested.
 * Canceled switch dialogs, same-game taps, and refresh restoration do not emit.
 * Consecutive duplicate handling of one switch (same from→to twice in a
 * row) is ignored. A later repeat after an intervening remount is not:
 * A→B, B→A, A→B records all three.
 */
export function noteGameOpened(opts: {
  cause: GameOpenedCause;
  fromGameId: string;
  toGameId: string;
}): CampaignEvent | null {
  if (opts.cause !== 'play' && opts.cause !== 'open-suggested') return null;
  if (!opts.toGameId || opts.fromGameId === opts.toGameId) return null;
  const key = `${opts.fromGameId}=>${opts.toGameId}`;
  if (lastGameOpenedKey === key) return null;
  lastGameOpenedKey = key;
  return trackCampaignEvent(CAMPAIGN_EVENTS.gameOpened, { game_id: opts.toGameId });
}

/** Emit invite_copied only after clipboard.writeText resolves. Rejections emit nothing. */
export async function trackInviteCopiedAfterWrite(
  writeText: (value: string) => Promise<void>,
  link: string,
  gameId: string,
): Promise<CampaignEvent | null> {
  try {
    await writeText(link);
  } catch {
    return null;
  }
  return trackCampaignEvent(CAMPAIGN_EVENTS.inviteCopied, { game_id: gameId });
}

/* ── Acquisition, kept apart from how someone arrived today ──────────────────
 *
 * Two different questions get confused constantly:
 *
 *   "where did this visitor come from originally?"  -> acquisition, written once
 *   "how did they get to this page just now?"        -> arrival, per navigation
 *
 * A paid click is a direct acquisition. Someone who has never been here before
 * and follows a friend's invite link is an INVITE acquisition, not a paid one:
 * the campaign did not buy them. And someone who was already acquired stays
 * acquired the way they were, however they turn up later.
 *
 * The record lives in localStorage, because acquisition has to outlive the tab
 * for `return_play` to mean anything, and it is written exactly once.
 */
export const ACQUISITION_STORAGE_KEY = 'inzone.acquisition.v1';

/** Deliberately only two values. Splitting paid from organic is the reporting
 *  layer's job, using the UTMs carried alongside; inventing that taxonomy here
 *  would bake a guess into the record. */
export type AcquisitionChannel = 'direct' | 'invite';

export type AcquisitionRecord = {
  channel: AcquisitionChannel;
  /** First-touch UTM for a direct acquisition. Always empty for an invite. */
  attribution: CampaignAttribution;
};

function durableStore(): { getItem(k: string): string | null; setItem(k: string, v: string): void } | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* private mode / blocked storage */
  }
  return null;
}

export function readAcquisition(): AcquisitionRecord | null {
  const raw = durableStore()?.getItem(ACQUISITION_STORAGE_KEY) ?? memoryStore.get(ACQUISITION_STORAGE_KEY) ?? null;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const rec = parsed as { channel?: unknown; attribution?: unknown };
    if (rec.channel !== 'direct' && rec.channel !== 'invite') return null;
    const attribution =
      rec.attribution && typeof rec.attribution === 'object' && !Array.isArray(rec.attribution)
        ? sanitizeData(rec.attribution as Record<string, unknown>)
        : {};
    const utmOnly: CampaignAttribution = {};
    for (const key of UTM_KEYS) if (attribution[key]) utmOnly[key] = attribution[key];
    return { channel: rec.channel, attribution: rec.channel === 'invite' ? {} : utmOnly };
  } catch {
    return null;
  }
}

/**
 * Record how this browser was acquired, the first time we can tell, and never
 * again.
 *
 * `viaInvite` must be true whenever the visitor is arriving on an invitation,
 * because that is the one case where the arrival must NOT be credited to a
 * campaign. Note what is missing: the inviter's UTMs. `liveInviteUrl` builds
 * invite links from scratch with only `game` and `session`, so there is nothing
 * to copy across even by accident, and this function would refuse to anyway.
 */
export function recordAcquisition(opts: { viaInvite: boolean; arrivalAttribution?: CampaignAttribution }): AcquisitionRecord {
  const existing = readAcquisition();
  if (existing) return existing;

  const next: AcquisitionRecord = opts.viaInvite
    ? { channel: 'invite', attribution: {} }
    : { channel: 'direct', attribution: sanitizeAttributionOnly(opts.arrivalAttribution ?? readStoredAttribution()) };

  const serialized = JSON.stringify(next);
  const store = durableStore();
  if (store) {
    try {
      store.setItem(ACQUISITION_STORAGE_KEY, serialized);
    } catch {
      memoryStore.set(ACQUISITION_STORAGE_KEY, serialized);
    }
  } else {
    memoryStore.set(ACQUISITION_STORAGE_KEY, serialized);
  }
  return next;
}

function sanitizeAttributionOnly(attr: CampaignAttribution): CampaignAttribution {
  const clean = sanitizeData({ ...attr });
  const out: CampaignAttribution = {};
  for (const key of UTM_KEYS) if (clean[key]) out[key] = clean[key];
  return out;
}

export function resetAcquisitionForTests(): void {
  memoryStore.delete(ACQUISITION_STORAGE_KEY);
  try {
    localStorage?.removeItem(ACQUISITION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function isForbiddenCampaignValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (SESSION_ID_RE.test(value.trim())) return true;
  if (value.includes('/session-prototype?') && /[?&]session=/.test(value)) return true;
  return false;
}
