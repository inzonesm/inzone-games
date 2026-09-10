import type { Metadata, Viewport } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { HexclaveProvider } from '@hexclave/next';
import { hexclaveClientApp } from '@/hexclave/client';
import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';
import { InstallPrompt } from '@/components/InstallPrompt';

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

function AppProviders({ children }: { children: React.ReactNode }) {
  const tree = <AuthProvider>{children}</AuthProvider>;
  if (!hexclaveClientApp) return tree;
  return <HexclaveProvider app={hexclaveClientApp}>{tree}</HexclaveProvider>;
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
        <AppProviders>{children}</AppProviders>
        <Analytics />
      </body>
    </html>
  );
}
