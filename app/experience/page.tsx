'use client';

import { Suspense } from 'react';
import { ExperienceApp } from '@/components/experience/ExperienceApp';

export default function ExperiencePage() {
  return (
    <Suspense fallback={<div className="ix-root"><p className="ix-status">Loading prototype…</p></div>}>
      <ExperienceApp />
    </Suspense>
  );
}
