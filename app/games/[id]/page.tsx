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
    <div className="game-frame-shell">
      <header className="game-frame-head">
        <Link href="/games" className="icon-btn" aria-label="Back to hub">
          <BackIcon />
        </Link>
        <h1>{game?.name ?? (loading ? 'Loading…' : 'Game')}</h1>
        <button onClick={handleReload} disabled={!game} aria-label="Reload" className="icon-btn">
          <ReloadIcon />
        </button>
      </header>

      <div className="game-frame-body">
        {error ? (
          <div className="empty" style={{ position: 'absolute', inset: 0 }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>⚠️</div>
            <h2>Couldn&apos;t load game</h2>
            <p>{error}</p>
            <button onClick={load} className="btn-primary">Retry</button>
          </div>
        ) : (
          <>
            {game && (
              <iframe
                ref={iframeRef}
                key={reloadKey}
                src={withServerUrl(game.gameUrl, game.serverUrl)}
                title={game.name}
                onLoad={() => setFrameLoaded(true)}
                allow="camera; microphone; geolocation; encrypted-media; autoplay; fullscreen; gamepad; accelerometer; gyroscope"
                allowFullScreen
              />
            )}
            {(loading || !frameLoaded) && (
              <div className="empty" style={{ position: 'absolute', inset: 0, background: 'var(--bg)', zIndex: 1 }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', borderTop: '4px solid var(--blue-1)', borderRight: '4px solid transparent', borderBottom: '4px solid var(--blue-2)', borderLeft: '4px solid transparent', margin: '0 auto', animation: 'spin 1s linear infinite' }} />
                <p style={{ marginTop: 14 }}>Loading {game?.name ?? 'game'}…</p>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Append `?serverUrl=…` to the game's gameUrl so the client iframe can read
 *  it from `window.location.search` and dial the right multiplayer backend.
 *  Skips appending when serverUrl is empty (single-player game). */
function withServerUrl(gameUrl: string, serverUrl: string): string {
  if (!gameUrl) return gameUrl;
  if (!serverUrl) return gameUrl;
  try {
    const u = new URL(gameUrl);
    u.searchParams.set('serverUrl', serverUrl);
    return u.toString();
  } catch {
    const sep = gameUrl.includes('?') ? '&' : '?';
    return `${gameUrl}${sep}serverUrl=${encodeURIComponent(serverUrl)}`;
  }
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
