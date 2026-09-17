'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  APP_STORE_URL,
  APP_VALUE_COPY,
  PLAY_STORE_URL,
  type AppCtaSurface,
  webAppHandoffLink,
} from '@/lib/app-links';
import { CAMPAIGN_EVENTS, trackCampaignEvent } from '@/lib/campaign-analytics';

export function GetAppMenu({
  surface,
  gameId,
  compact = false,
}: {
  surface: AppCtaSurface;
  gameId?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const viewed = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open || viewed.current) return;
    viewed.current = true;
    trackCampaignEvent(CAMPAIGN_EVENTS.appCtaView, { cta_surface: surface, game_id: gameId });
  }, [open, surface, gameId]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const clickStore = useCallback(
    (dest: 'apple' | 'play') => {
      trackCampaignEvent(CAMPAIGN_EVENTS.appCtaClick, {
        cta_surface: surface,
        game_id: gameId,
        outcome: dest,
      });
    },
    [surface, gameId],
  );

  const copyPhoneLink = useCallback(async () => {
    const url = webAppHandoffLink({ gameId, pid: 'web_get_app' });
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      trackCampaignEvent(CAMPAIGN_EVENTS.appCtaClick, {
        cta_surface: surface,
        game_id: gameId,
        outcome: 'phone_link',
      });
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      window.open(url, '_blank', 'noopener');
      trackCampaignEvent(CAMPAIGN_EVENTS.appCtaClick, {
        cta_surface: surface,
        game_id: gameId,
        outcome: 'phone_link_open',
      });
    }
  }, [gameId, surface]);

  return (
    <div className={`get-app${compact ? ' is-compact' : ''}`} ref={rootRef}>
      <button
        type="button"
        className={compact ? 'sp-btn sp-btn-ghost' : 'btn-ghost'}
        data-testid="get-app"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        style={compact ? undefined : { height: 36, padding: '0 16px' }}
      >
        Get the app
      </button>
      {open && (
        <div
          id={panelId}
          className="get-app-panel"
          role="dialog"
          aria-label={APP_VALUE_COPY.panelTitle}
          data-testid="get-app-panel"
        >
          <p className="get-app-kicker">{APP_VALUE_COPY.panelTitle}</p>
          <p className="get-app-body">{compact ? APP_VALUE_COPY.socialInvite : APP_VALUE_COPY.panelBody}</p>
          <p className="get-app-limit">{APP_VALUE_COPY.progressLimit}</p>
          <div className="get-app-actions">
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost"
              data-testid="get-app-apple"
              onClick={() => clickStore('apple')}
            >
              App Store
            </a>
            <a
              href={PLAY_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost"
              data-testid="get-app-play"
              onClick={() => clickStore('play')}
            >
              Google Play
            </a>
            <button
              type="button"
              className="btn-primary"
              data-testid="get-app-phone-link"
              onClick={() => void copyPhoneLink()}
            >
              {copied ? 'Copied' : 'Copy phone link'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
