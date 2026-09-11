/**
 * Campaign conversion events for /session-prototype, sent through Hexclave's
 * existing analytics batch ingest. Automatic $page-view / $click stay on the SDK.
 *
 * First-touch UTM is stored in sessionStorage so attribution survives in-app
 * game switches and invite replaceState (which would otherwise drop query params).
 * Chat text, invite URLs, and session ids are never attached to events.
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
  gameplayStarted: 'gameplay_started',
} as const;

export type CampaignEventName = (typeof CAMPAIGN_EVENTS)[keyof typeof CAMPAIGN_EVENTS];

export type GameplaySignal = 'sdk' | 'iframe_focus';

export type CampaignEventData = CampaignAttribution & {
  game_id?: string;
  signal?: GameplaySignal;
};

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
const SESSION_ID_RE = /^[a-f0-9]{32}$/;

const GAMEPLAY_SDK_METHODS = new Set(['saveState', 'loadState', 'requestPurchase']);

let transport: CampaignTransport | null = null;
const memoryStore = new Map<string, string>();
let arrivalSent = false;
let gameplaySentForGame = '';

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
  gameplaySentForGame = '';
  try {
    sessionStorage?.removeItem(CAMPAIGN_STORAGE_KEY);
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

export function sanitizeData(input: Record<string, unknown>): CampaignEventData {
  const out: CampaignEventData = {};
  for (const [key, value] of Object.entries(input)) {
    if (SECRET_KEY.test(key)) continue;
    if (key === 'signal') {
      if (value === 'sdk' || value === 'iframe_focus') out.signal = value;
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
  } catch {
    /* analytics must never break play */
  }
  return event;
}

export function captureCampaignArrival(
  source: string | URLSearchParams | { search?: string; href?: string },
): CampaignEvent | null {
  const incoming = parseAttribution(source);
  const attr = rememberAttribution(incoming);
  if (!hasAttribution(attr) || arrivalSent) return null;
  arrivalSent = true;
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

export function isGameplaySdkMethod(method: string): boolean {
  return GAMEPLAY_SDK_METHODS.has(method);
}

export function noteVerifiedGameplay(gameId: string, signal: GameplaySignal): CampaignEvent | null {
  if (!gameId || gameplaySentForGame === gameId) return null;
  gameplaySentForGame = gameId;
  return trackCampaignEvent(CAMPAIGN_EVENTS.gameplayStarted, { game_id: gameId, signal });
}

export function isForbiddenCampaignValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (SESSION_ID_RE.test(value.trim())) return true;
  if (value.includes('/session-prototype?') && /[?&]session=/.test(value)) return true;
  return false;
}
