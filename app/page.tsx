'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/games');
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-inzone-bg">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-inzone-primary border-t-transparent" />
    </main>
  );
}
