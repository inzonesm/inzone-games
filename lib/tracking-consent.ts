/**
 * Optional tracking choice.
 *
 * Gameplay, Firebase Auth, invites, and chat do not depend on this record.
 * Until the visitor decides, analytics, session replay, and advertising
 * measurement stay off. A later accept does not flush events from before
 * the choice. This is a product control, not a legal-compliance determination.
 */

export const CONSENT_COOKIE = 'inzone_consent';
export const CONSENT_STORAGE_KEY = 'inzone.tracking-consent.v1';
export const CONSENT_OPEN_EVENT = 'inzone-open-privacy';
export const CONSENT_MAX_AGE_SEC = 60 * 60 * 24 * 400;

export type TrackingConsent = {
  /** True once the visitor has accepted, rejected, or saved preferences. */
  decided: boolean;
  /** Hexclave campaign + automatic SDK events, and Vercel Analytics. */
  analytics: boolean;
  /** Hexclave session replay (SDK `analytics.replays`). */
  replay: boolean;
  /** Meta pixel PageView, noscript PageView, and verified trackCustom. */
  advertising: boolean;
};

export const UNDECIDED_CONSENT: TrackingConsent = {
  decided: false,
  analytics: false,
  replay: false,
  advertising: false,
};

export const REJECTED_CONSENT: TrackingConsent = {
  decided: true,
  analytics: false,
  replay: false,
  advertising: false,
};

export const ACCEPTED_CONSENT: TrackingConsent = {
  decided: true,
  analytics: true,
  replay: true,
  advertising: true,
};

export function parseTrackingConsent(raw: string | undefined | null): TrackingConsent {
  if (!raw) return { ...UNDECIDED_CONSENT };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...UNDECIDED_CONSENT };
    const rec = parsed as Record<string, unknown>;
    if (rec.decided !== true) return { ...UNDECIDED_CONSENT };
    return {
      decided: true,
      analytics: rec.analytics === true,
      replay: rec.replay === true,
      advertising: rec.advertising === true,
    };
  } catch {
    return { ...UNDECIDED_CONSENT };
  }
}

export function serializeTrackingConsent(consent: TrackingConsent): string {
  return JSON.stringify({
    v: 1,
    decided: Boolean(consent.decided),
    analytics: Boolean(consent.analytics),
    replay: Boolean(consent.replay),
    advertising: Boolean(consent.advertising),
  });
}

export function hexclaveOptionsFromConsent(consent: TrackingConsent): { analytics: boolean; replay: boolean } {
  if (!consent.decided) return { analytics: false, replay: false };
  return { analytics: consent.analytics, replay: consent.replay };
}

export function consentCookieHeader(consent: TrackingConsent): string {
  const secure = typeof window === 'undefined' || window.location.protocol === 'https:';
  return [
    `${CONSENT_COOKIE}=${encodeURIComponent(serializeTrackingConsent(consent))}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${CONSENT_MAX_AGE_SEC}`,
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

export function readStoredTrackingConsent(): TrackingConsent {
  try {
    if (typeof document !== 'undefined') {
      const match = document.cookie.split('; ').find((row) => row.startsWith(`${CONSENT_COOKIE}=`));
      if (match) {
        const parsed = parseTrackingConsent(decodeURIComponent(match.slice(CONSENT_COOKIE.length + 1)));
        if (parsed.decided) return parsed;
      }
    }
  } catch {
    /* cookie blocked */
  }
  try {
    if (typeof localStorage !== 'undefined') {
      return parseTrackingConsent(localStorage.getItem(CONSENT_STORAGE_KEY));
    }
  } catch {
    /* storage blocked */
  }
  return { ...UNDECIDED_CONSENT };
}

export function persistTrackingConsent(consent: TrackingConsent): void {
  const serialized = serializeTrackingConsent(consent);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(CONSENT_STORAGE_KEY, serialized);
  } catch {
    /* storage blocked */
  }
  try {
    if (typeof document !== 'undefined') document.cookie = consentCookieHeader(consent);
  } catch {
    /* cookie blocked */
  }
}

export function openPrivacyPreferences(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CONSENT_OPEN_EVENT));
}
