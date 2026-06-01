import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';

export const metadata: Metadata = {
  title: 'InZone',
  description: 'Play and ship community games on the InZone hub.',
};

export const viewport: Viewport = {
  themeColor: '#0a0d12',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* Drifting motes are part of the global atmospheric backdrop —
            keeping them in the root layout so every page inherits them. */}
        <div className="motes" aria-hidden="true">
          <i /><i /><i /><i /><i /><i /><i /><i />
        </div>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
