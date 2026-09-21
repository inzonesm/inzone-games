import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { Analytics } from '@vercel/analytics/next';
import { HexclaveAnalyticsOutboundGuard } from '@/components/HexclaveAnalyticsOutboundGuard';
import { HexclaveCampaignTransportBridge } from '@/components/HexclaveCampaignTransportBridge';
import { HexclaveProvider } from '@hexclave/next';
import { createHexclaveClientApp } from '@/hexclave/client';
import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';
import { InstallPrompt } from '@/components/InstallPrompt';
import { MetaPixel } from '@/components/MetaPixel';
import { TrackingConsent } from '@/components/TrackingConsent';
import { CONSENT_COOKIE, parseTrackingConsent, type TrackingConsent as TrackingConsentState } from '@/lib/tracking-consent';

export const metadata: Metadata = {
  title: 'InZone',
  description: 'Play and ship community games on the InZone hub.',
  applicationName: 'InZone',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'InZone',
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0d12',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

// Capture Chrome's beforeinstallprompt as early as possible. It can fire before
// React hydrates, so we stash it on window and notify the InstallPrompt component.
const captureInstallPrompt = `
(function(){
  window.__pwaInstallPrompt = window.__pwaInstallPrompt || null;
  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault();
    window.__pwaInstallPrompt = e;
    window.dispatchEvent(new Event('pwaPromptReady'));
  });
})();
`;

function AppProviders({
  children,
  consent,
}: {
  children: React.ReactNode;
  consent: TrackingConsentState;
}) {
  const tree = <AuthProvider>{children}</AuthProvider>;
  const hexclaveApp =
    consent.analytics || consent.replay
      ? createHexclaveClientApp({ analytics: consent.analytics, replay: consent.replay })
      : null;
  return (
    <>
      <HexclaveAnalyticsOutboundGuard />
      {hexclaveApp ? (
        <HexclaveProvider app={hexclaveApp}>
          {consent.analytics ? <HexclaveCampaignTransportBridge /> : null}
          {tree}
        </HexclaveProvider>
      ) : (
        tree
      )}
    </>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const consent = parseTrackingConsent(cookies().get(CONSENT_COOKIE)?.value);
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: captureInstallPrompt }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Game icons are served from Firebase Storage - warm the connection up
            front so the hub thumbnails start downloading immediately. */}
        <link rel="preconnect" href="https://firebasestorage.googleapis.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://firebasestorage.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* Drifting motes are part of the global atmospheric backdrop -
            keeping them in the root layout so every page inherits them. */}
        <div className="motes" aria-hidden="true">
          <i /><i /><i /><i /><i /><i /><i /><i />
        </div>
        <InstallPrompt />
        <TrackingConsent initial={consent} />
        <AppProviders consent={consent}>{children}</AppProviders>
        {consent.analytics ? <Analytics /> : null}
        {/* Meta pixel loads only after advertising measurement is granted.
            PageView + verified trackCustom + noscript PageView stay off until
            then. See components/MetaPixel.tsx. */}
        {consent.advertising ? <MetaPixel /> : null}
      </body>
    </html>
  );
}
