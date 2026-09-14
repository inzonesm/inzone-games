'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CAMPAIGN_EVENTS, trackCampaignEvent } from '@/lib/campaign-analytics';

function HomeRedirect() {
  const router = useRouter();
  const search = useSearchParams();

  // The hub is public — anyone landing on / should go straight to /games.
  // Sign-in is only required for /upload (the studio side).
  //
  // The query string is carried across so paid-campaign UTMs and deep-link
  // params survive the hop; the pre-player-front version dropped them.
  useEffect(() => {
    trackCampaignEvent(CAMPAIGN_EVENTS.homeView);
    const qs = search.toString();
    router.replace(qs ? `/games?${qs}` : '/games');
  }, [router, search]);

  return null;
}

export default function HomePage() {
  return (
    <main style={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <Suspense fallback={null}>
        <HomeRedirect />
      </Suspense>
      <div
        style={{
          width: 40, height: 40, borderRadius: '50%',
          borderTop: '4px solid var(--blue-1)', borderRight: '4px solid transparent',
          borderBottom: '4px solid var(--blue-2)', borderLeft: '4px solid transparent',
          animation: 'spin 1s linear infinite',
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </main>
  );
}
