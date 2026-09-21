'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  VERIFIED_GAMEPLAY_EVENTS,
  setMetaPixelDispatcher,
  type CampaignEventData,
  type CampaignEventName,
} from '@/lib/campaign-analytics';
import { mayEmitToAdPlatform, resolveAppEnv, resolveTrafficKind } from '@/lib/qa-traffic';

/**
 * Meta Pixel wiring for the inzone.games website dataset.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Contract
 *
 *   - PageView fires on every client-side route change (App Router), so the
 *     campaign sees the actual pages a visitor sees, not just the initial load.
 *   - The only custom events sent to Meta are VERIFIED_GAMEPLAY_EVENTS
 *     (game_start, engaged_play, first_game_over, return_play). Proxies stay in
 *     our own analytics; Meta never sees them.
 *   - Every custom send carries a generated event_id, so Conversions API — when
 *     it is added — can deduplicate browser and server sends of the same event
 *     with no further code changes here.
 *   - No chat text, no invite links, no session ids reach Meta. Sanitisation
 *     happens upstream in lib/campaign-analytics.ts; this component receives an
 *     already-clean payload and adds nothing that could reintroduce them.
 *
 *   - The pixel is not initialised at all outside production, and not for a
 *     visit marked `?inzone_qa=agent|manual`. Withholding the base script as
 *     well as the events matters: an initialised pixel sends PageView on every
 *     route change, so gating only the custom events would still teach the
 *     dataset that Preview checks are visitors. Ordinary production visitors
 *     are unaffected.
 *
 * The dataset id is the public Web pixel Meta issued for inzone.games. It is a
 * public identifier that ships in the base script to every browser anyway, so
 * defaulting it in code is safe; an env var override lets ops point staging at
 * a different dataset without touching the codebase.
 */

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || '2983764635290155';

type FbqOptions = { eventID?: string };
type Fbq = (
  action: 'init' | 'track' | 'trackCustom',
  nameOrId: string,
  props?: Record<string, unknown>,
  options?: FbqOptions,
) => void;

function fbq(): Fbq | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { fbq?: Fbq };
  return typeof w.fbq === 'function' ? w.fbq : null;
}

export function MetaPixel() {
  const pathname = usePathname();
  const [pixelReady, setPixelReady] = useState(false);
  // Resolved after mount rather than during render: the classification reads
  // `location` and sessionStorage, which do not exist on the server, and a
  // render-time guess would differ between the two passes. The base script is
  // `afterInteractive` anyway, so a single effect costs an ordinary visitor
  // nothing measurable.
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

  // PageView on every route change. The base script also queues events before
  // fbevents.js has finished loading, so an early call from here is safe.
  useEffect(() => {
    if (!PIXEL_ID || !emitAllowed || !pixelReady || !pathname || lastPathSent.current === pathname) return;
    const f = fbq();
    if (!f) return;
    // usePathname fires an effect on first mount too, and we want that PageView.
    f('track', 'PageView');
    lastPathSent.current = pathname;
  }, [pathname, pixelReady, emitAllowed]);

  // Register the only path by which our analytics can reach Meta. Verified
  // events only; the payload is already sanitized by trackCampaignEvent.
  useEffect(() => {
    if (!PIXEL_ID) return;
    setMetaPixelDispatcher(
      (name: CampaignEventName, data: CampaignEventData, eventId: string) => {
        const f = fbq();
        if (!(VERIFIED_GAMEPLAY_EVENTS as readonly string[]).includes(name)) return;
        // Second layer. `trackCampaignEvent` already withholds these, but the
        // dispatcher is a public seam: anything registering here must not be
        // able to reach Meta from a Preview or a marked visit either.
        if (
          !mayEmitToAdPlatform({
            appEnv: (data as Record<string, unknown>).app_env as string | undefined,
            trafficKind: (data as Record<string, unknown>).traffic_kind as string | undefined,
          })
        ) {
          return;
        }
        if (!f) {
          // Preserve genuine early gameplay while afterInteractive installs fbq.
          // Bound memory if a blocker prevents initialization indefinitely.
          if (pending.current.length < 100) pending.current.push({ name, data, eventId });
          return;
        }
        f(
          'trackCustom',
          name,
          { ...data, event_id: eventId },
          { eventID: eventId },
        );
      },
    );
    return () => setMetaPixelDispatcher(null);
  }, []);

  useEffect(() => {
    const f = fbq();
    if (!pixelReady || !f) return;
    for (const { name, data, eventId } of pending.current.splice(0)) {
      f('trackCustom', name, { ...data, event_id: eventId }, { eventID: eventId });
    }
  }, [pixelReady]);

  // No base script, no noscript beacon: the pixel is never initialised here.
  if (!PIXEL_ID || !emitAllowed) return null;

  return (
    <>
      <Script id="meta-pixel-init" strategy="afterInteractive" onReady={() => setPixelReady(true)}>
        {`
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];
t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${PIXEL_ID}');
        `}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: 'none' }}
          src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>
    </>
  );
}
