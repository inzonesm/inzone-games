'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { fetchGameById } from '@/lib/games';
import type { HubGame } from '@/lib/types';

export default function GamePlayerPage() {
  const params = useParams<{ id: string }>();
  const rawId = params?.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  const [game, setGame] = useState<HubGame | null>(null);
  const [loading, setLoading] = useState(true);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const g = await fetchGameById(decodeURIComponent(id));
      if (!g) {
        setError('Game not found or no longer available.');
        setGame(null);
      } else {
        setGame(g);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load game.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) load();
  }, [id, load]);

  function handleReload() {
    setFrameLoaded(false);
    setReloadKey((k) => k + 1);
  }

  return (
    <main className="flex h-screen flex-col bg-inzone-bg dark:bg-inzone-dark-bg">
      <header className="flex items-center gap-2 border-b border-inzone-divider/60 px-3 py-2 dark:border-white/5">
        <Link
          href="/games"
          aria-label="Back"
          className="rounded-full p-2 text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10"
        >
          <BackIcon />
        </Link>
        <h1 className="flex-1 truncate text-base font-semibold text-black dark:text-white">
          {game?.name ?? (loading ? 'Loading…' : 'Game')}
        </h1>
        <button
          onClick={handleReload}
          disabled={!game}
          aria-label="Reload game"
          className="rounded-full p-2 text-black/70 hover:bg-black/5 disabled:opacity-40 dark:text-white/70 dark:hover:bg-white/10"
        >
          <ReloadIcon />
        </button>
      </header>

      <div className="relative flex-1">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="text-5xl">⚠️</div>
            <h2 className="text-lg font-semibold text-black dark:text-white">
              Error Loading Game
            </h2>
            <p className="max-w-sm text-sm text-black/60 dark:text-white/60">{error}</p>
            <button
              onClick={load}
              className="mt-2 rounded-button bg-inzone-primary px-5 py-2 text-sm font-semibold text-white"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            {game && (
              <iframe
                ref={iframeRef}
                key={reloadKey}
                src={game.gameUrl}
                title={game.name}
                onLoad={() => setFrameLoaded(true)}
                allow="camera; microphone; geolocation; encrypted-media; autoplay; fullscreen; gamepad; accelerometer; gyroscope"
                allowFullScreen
                className="h-full w-full border-0 bg-black"
              />
            )}
            {(loading || !frameLoaded) && (
              <div className="absolute inset-0 flex items-center justify-center bg-inzone-bg dark:bg-inzone-dark-bg">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-10 w-10 animate-spin rounded-full border-4 border-inzone-primary border-t-transparent" />
                  <p className="text-sm text-black/70 dark:text-white/70">
                    Loading {game?.name ?? 'game'}…
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ReloadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}
