'use client';

import { Suspense } from 'react';
import { DiscoveryPage } from '@/components/DiscoveryPage';

export default function GamesPage() {
  return (
    <Suspense fallback={<div className="discovery" data-testid="discovery" aria-busy="true" />}>
      <DiscoveryPage />
    </Suspense>
  );
}
