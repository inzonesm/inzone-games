'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { GameCard } from '@/components/GameCard';
import { Logo } from '@/components/Logo';
import { fetchApprovedGames } from '@/lib/games';
import type { HubGame } from '@/lib/types';

export default function GamesPage() {
  const { user, signOut } = useAuth();
  const [games, setGames] = useState<HubGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await fetchApprovedGames();
      setGames(items);
      if (items.length === 0) setError('No games available right now.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load games.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="min-h-screen bg-inzone-bg dark:bg-inzone-dark-bg">
      <header className="sticky top-0 z-10 border-b border-inzone-divider/60 bg-inzone-bg/90 backdrop-blur dark:border-white/5 dark:bg-inzone-dark-bg/90">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Logo size={36} />
          <h1 className="flex-1 text-lg font-semibold text-black dark:text-white">
            Game Hub
          </h1>
          <button
            onClick={load}
            disabled={loading}
            aria-label="Refresh"
            className="rounded-full p-2 text-black/70 transition hover:bg-black/5 disabled:opacity-50 dark:text-white/70 dark:hover:bg-white/10"
          >
            <RefreshIcon spinning={loading} />
          </button>
          {user ? (
            <button
              onClick={() => signOut()}
              className="rounded-button px-3 py-1.5 text-xs font-semibold text-inzone-primary hover:bg-inzone-primary/10"
            >
              Sign out
            </button>
          ) : (
            <Link
              href="/login"
              className="rounded-button px-3 py-1.5 text-xs font-semibold text-inzone-primary hover:bg-inzone-primary/10"
            >
              Sign in
            </Link>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-3 py-4">
        {loading && games.length === 0 ? (
          <div className="flex h-[60vh] items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-inzone-primary border-t-transparent" />
          </div>
        ) : error && games.length === 0 ? (
          <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-center">
            <div className="text-4xl">⚠️</div>
            <p className="text-sm text-black/70 dark:text-white/70">{error}</p>
            <button
              onClick={load}
              className="rounded-button bg-inzone-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {games.map((g) => (
              <GameCard key={`${g.source}-${g.id}`} game={g} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      className={spinning ? 'animate-spin' : undefined}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}
