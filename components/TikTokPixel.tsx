'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  VERIFIED_GAMEPLAY_EVENTS,
  setTikTokPixelDispatcher,
  type CampaignEventData,
  type CampaignEventName,
} from '@/lib/campaign-analytics';
import { mayEmitToAdPlatform, resolveAppEnv, resolveTrafficKind } from '@/lib/qa-traffic';
import { tiktokPixelId } from '@/lib/tiktok/config';

/**
 * TikTok Pixel wiring for the inzone.games website, mirroring MetaPixel.tsx.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Contract
 *
 *   - No base script is loaded unless the pixel is configured
 *     (`NEXT_PUBLIC_TIKTOK_PIXEL_ID`) AND the visit passes
 *     `mayEmitToAdPlatform`. Preview deploys and `?inzone_qa=agent|manual`
 *     runs never load the pixel, matching the Meta gate exactly.
 *   - `PageView` fires on every client-side route change so the campaign
 *     sees the pages a visitor sees, not just the initial load.
 *   - Only VERIFIED_GAMEPLAY_EVENTS reach TikTok (`game_start`,
 *     `engaged_play`, `first_game_over`, `return_play`). Every other
 *     campaign event stays in our own analytics. Chat text, invite links,
 *     session ids, and raw URLs never reach TikTok — sanitisation
 *     happened upstream in `lib/campaign-analytics.ts`.
 *   - Every custom send carries `event_id` so a future TikTok Events API
 *     (server-side) can dedupe browser and server sends with no other
 *     change.
 *
 * The pixel id is a public identifier that ships in the base script to
 * every browser, so defaulting it in code is safe; an env var override
 * lets ops point staging at a different pixel without touching the
 * codebase. Same shape as MetaPixel.tsx's `PIXEL_ID` constant.
 */

// TikTok pixel issued for inzone.games. Public — ships to every browser
// in the base script. Override with NEXT_PUBLIC_TIKTOK_PIXEL_ID.
const TIKTOK_PIXEL_ID_DEFAULT = 'DAQO8QRC77UFPT804MQG';

type TtqOptions = { event_id?: string };
type Ttq = {
  (action: string, ...rest: unknown[]): void;
  load?: (pixelId: string, opts?: Record<string, unknown>) => void;
  page?: () => void;
  track?: (event: string, params?: Record<string, unknown>, options?: TtqOptions) => void;
  identify?: (params: Record<string, unknown>) => void;
};

function ttq(): Ttq | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { ttq?: Ttq };
  return w.ttq && typeof w.ttq === 'object' ? w.ttq : null;
}

export function TikTokPixel() {
  const pixelId = tiktokPixelId(process.env as NodeJS.ProcessEnv) ?? TIKTOK_PIXEL_ID_DEFAULT;
  const pathname = usePathname();
  const [pixelReady, setPixelReady] = useState(false);
  const [emitAllowed, setEmitAllowed] = useState(false);
  useEffect(() => {
    setEmitAllowed(
      mayEmitToAdPlatform({
        appEnv: resolveAppEnv(),
        trafficKind: resolveTrafficKind(window.location.search),
      }),
    );
  }, [pathname]);
  const lastPathSent = useRef<string | null>(null);
  const pending = useRef<{ name: CampaignEventName; data: CampaignEventData; eventId: string }[]>([]);

  // PageView on every route change.
  useEffect(() => {
    if (!pixelId || !emitAllowed || !pixelReady || !pathname || lastPathSent.current === pathname) return;
    const t = ttq();
    if (!t?.page) return;
    t.page();
    lastPathSent.current = pathname;
  }, [pathname, pixelReady, emitAllowed, pixelId]);

  // Register the dispatcher — verified events only. Second layer of the same
  // suppression check `trackCampaignEvent` already applies upstream.
  useEffect(() => {
    if (!pixelId) return;
    setTikTokPixelDispatcher(
      (name: CampaignEventName, data: CampaignEventData, eventId: string) => {
        const t = ttq();
        if (!(VERIFIED_GAMEPLAY_EVENTS as readonly string[]).includes(name)) return;
        if (
          !mayEmitToAdPlatform({
            appEnv: (data as Record<string, unknown>).app_env as string | undefined,
            trafficKind: (data as Record<string, unknown>).traffic_kind as string | undefined,
          })
        ) {
          return;
        }
        if (!t?.track) {
          if (pending.current.length < 100) pending.current.push({ name, data, eventId });
          return;
        }
        t.track(name, { ...data, event_id: eventId }, { event_id: eventId });
      },
    );
    return () => setTikTokPixelDispatcher(null);
  }, [pixelId]);

  useEffect(() => {
    const t = ttq();
    if (!pixelReady || !t?.track) return;
    for (const { name, data, eventId } of pending.current.splice(0)) {
      t.track(name, { ...data, event_id: eventId }, { event_id: eventId });
    }
  }, [pixelReady]);

  if (!pixelId || !emitAllowed) return null;

  return (
    <Script id="tiktok-pixel-init" strategy="afterInteractive" onReady={() => setPixelReady(true)}>
      {`
!function (w, d, t) {
  w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};
  ttq.load('${pixelId}');
  ttq.page();
}(window, document, 'ttq');
      `}
    </Script>
  );
}
