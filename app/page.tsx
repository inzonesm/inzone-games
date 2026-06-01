'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();

  // The hub is public — anyone landing on / should go straight to /games.
  // Sign-in is only required for /upload (the studio side).
  useEffect(() => {
    router.replace('/games');
  }, [router]);

  return (
    <main style={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
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
