'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ACCEPTED_CONSENT,
  CONSENT_OPEN_EVENT,
  REJECTED_CONSENT,
  persistTrackingConsent,
  readStoredTrackingConsent,
  type TrackingConsent,
} from '@/lib/tracking-consent';

/**
 * Compact optional-tracking controls. Kept in the host chrome, not over the
 * game iframe. Play, chat, invites, and Firebase Auth work without a grant.
 * Not a legal-compliance determination.
 */
export function TrackingConsent({ initial }: { initial: TrackingConsent }) {
  const router = useRouter();
  const [consent, setConsent] = useState<TrackingConsent>(initial);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [draft, setDraft] = useState<TrackingConsent>(initial.decided ? initial : REJECTED_CONSENT);

  useEffect(() => {
    const stored = readStoredTrackingConsent();
    if (stored.decided && !initial.decided) {
      persistTrackingConsent(stored);
      router.refresh();
      return;
    }
    if (stored.decided) {
      setConsent(stored);
      setDraft(stored);
    }
  }, [initial.decided, router]);

  useEffect(() => {
    const open = () => {
      setDraft(consent.decided ? consent : REJECTED_CONSENT);
      setPrefsOpen(true);
    };
    window.addEventListener(CONSENT_OPEN_EVENT, open);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, open);
  }, [consent]);

  const commit = useCallback(
    (next: TrackingConsent) => {
      persistTrackingConsent(next);
      setConsent(next);
      setDraft(next);
      setPrefsOpen(false);
      router.refresh();
    },
    [router],
  );

  const showBanner = !consent.decided && !prefsOpen;

  return (
    <>
      {showBanner ? (
        <div className="consent-bar" data-testid="consent-banner" role="dialog" aria-label="Optional tracking">
          <p className="consent-bar__copy">
            Optional tracking. Play, chat, and invites work either way. This is not a legal-compliance notice.
          </p>
          <div className="consent-bar__actions">
            <button type="button" className="consent-btn consent-btn-primary" data-testid="consent-accept" onClick={() => commit(ACCEPTED_CONSENT)}>
              Allow all
            </button>
            <button type="button" className="consent-btn" data-testid="consent-reject" onClick={() => commit(REJECTED_CONSENT)}>
              Reject optional
            </button>
            <button
              type="button"
              className="consent-btn"
              data-testid="consent-preferences"
              onClick={() => {
                setDraft(REJECTED_CONSENT);
                setPrefsOpen(true);
              }}
            >
              Choose
            </button>
          </div>
        </div>
      ) : null}

      {consent.decided && !prefsOpen ? (
        <button
          type="button"
          className="consent-privacy"
          data-testid="consent-privacy"
          onClick={() => {
            setDraft(consent);
            setPrefsOpen(true);
          }}
        >
          Privacy
        </button>
      ) : null}

      {prefsOpen ? (
        <div className="consent-prefs" data-testid="consent-preferences-panel" role="dialog" aria-label="Tracking preferences">
          <p className="consent-bar__copy">
            Choose optional measurement. Gameplay does not depend on these. Withdrawing stops future sends; we do not
            replay activity from before a grant.
          </p>
          <label className="consent-opt">
            <input
              type="checkbox"
              data-testid="consent-opt-analytics"
              checked={draft.analytics}
              onChange={(e) => setDraft({ ...draft, decided: true, analytics: e.target.checked })}
            />
            Analytics (Hexclave events, Vercel page views)
          </label>
          <label className="consent-opt">
            <input
              type="checkbox"
              data-testid="consent-opt-replay"
              checked={draft.replay}
              onChange={(e) => setDraft({ ...draft, decided: true, replay: e.target.checked })}
            />
            Session replay (Hexclave)
          </label>
          <label className="consent-opt">
            <input
              type="checkbox"
              data-testid="consent-opt-advertising"
              checked={draft.advertising}
              onChange={(e) => setDraft({ ...draft, decided: true, advertising: e.target.checked })}
            />
            Advertising measurement (Meta pixel)
          </label>
          <div className="consent-bar__actions">
            <button
              type="button"
              className="consent-btn consent-btn-primary"
              data-testid="consent-save"
              onClick={() => commit({ ...draft, decided: true })}
            >
              Save
            </button>
            <button type="button" className="consent-btn" data-testid="consent-withdraw" onClick={() => commit(REJECTED_CONSENT)}>
              Withdraw
            </button>
            <button type="button" className="consent-btn" data-testid="consent-prefs-close" onClick={() => setPrefsOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
