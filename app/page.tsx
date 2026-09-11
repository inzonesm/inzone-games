'use client';

import { useEffect, useMemo, useState } from 'react';
import { HomeView } from '@/lib/home-view';
import { PlayerFrontShell } from '@/components/PlayerFrontShell';
import { CAMPAIGN_EVENTS, trackCampaignEvent } from '@/lib/campaign-analytics';
import { fetchApprovedGames } from '@/lib/games';
import { resolveHomeRows } from '@/lib/home-rows';
import type { HubGame } from '@/lib/types';

export default function HomePage() {
  const [games, setGames] = useState<HubGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trackCampaignEvent(CAMPAIGN_EVENTS.homeView);
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

  const { hero, rows } = useMemo(() => resolveHomeRows(games), [games]);

  return (
    <PlayerFrontShell>
      {loading && games.length === 0 ? (
        <main className="player-home">
          <p className="home-status">Loading games…</p>
        </main>
      ) : error && games.length === 0 ? (
        <main className="player-home">
          <p className="home-status">{error}</p>
        </main>
      ) : (
        <HomeView hero={hero} rows={rows} />
      )}
    </PlayerFrontShell>
  );
}
