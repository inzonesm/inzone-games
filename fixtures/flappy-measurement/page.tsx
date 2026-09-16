'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useGameplayMeasurement } from '@/lib/use-gameplay-measurement';
import { captureCampaignArrival, recordAcquisition, setCampaignTransport } from '@/lib/campaign-analytics';

export default function MeasurementFixture() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setCampaignTransport(event => window.dispatchEvent(new CustomEvent('measurement-test', { detail: event })));
    captureCampaignArrival(window.location.href);
    recordAcquisition({ viaInvite: false });
    return () => setCampaignTransport(null);
  }, []);
  useGameplayMeasurement({ gameId: 'flappybird-inzone-2', iframeRef, frameLoaded: loaded, reloadKey: 0 });
  return <>
    <iframe ref={iframeRef} title="Flappy test" src="/gcs/games/flappybird-inzone-2/v9/index.html"
      onLoad={() => setLoaded(true)} style={{ width: '100vw', height: '90vh', border: 0 }} />
    <Link href="/second">Second route</Link>
  </>;
}
