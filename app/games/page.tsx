'use client';

import { useEffect, useMemo, useState } from 'react';
import { GameCard } from '@/components/GameCard';
import { PlayerFrontShell } from '@/components/PlayerFrontShell';
import { CAMPAIGN_EVENTS, trackCampaignEvent } from '@/lib/campaign-analytics';
import { fetchApprovedGames } from '@/lib/games';
import type { HubGame } from '@/lib/types';

export default function DiscoverPage() {
  const [games, setGames] = useState<HubGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    trackCampaignEvent(CAMPAIGN_EVENTS.discoverView);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchApprovedGames()
      .then((items) => {
        if (cancelled) return;
        setGames(items);
        if (items.length === 0) setError('No games available right now.');
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load games.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return games;
    return games.filter((g) => g.name.toLowerCase().includes(q));
  }, [games, query]);

  return (
    <PlayerFrontShell>
      <main className="player-discover">
        <header className="discover-head">
          <h1>Discover</h1>
          <p className="discover-count">
            {loading ? 'Loading…' : `${filtered.length} games`}
          </p>
        </header>
        <input
          className="discover-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search games"
          aria-label="Search games"
        />
        {loading && games.length === 0 ? (
          <p className="home-status">Loading games…</p>
        ) : error && games.length === 0 ? (
          <p className="home-status">{error}</p>
        ) : (
          <div className="hub-grid">
            {filtered.map((g) => (
              <GameCard key={`discover-${g.id}`} game={g} />
            ))}
          </div>
        )}
      </main>
    </PlayerFrontShell>
  );
}
