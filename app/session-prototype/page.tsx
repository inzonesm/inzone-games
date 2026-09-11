import { Suspense } from 'react';
import { SessionPrototypeClient } from './SessionPrototypeClient';

export default function SessionPrototypePage() {
  return (
    <Suspense
      fallback={
        <div className="sp-boot">
          <p>Loading session prototype…</p>
        </div>
      }
    >
      <SessionPrototypeClient />
    </Suspense>
  );
}
