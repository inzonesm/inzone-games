'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Footer } from '@/components/Footer';
import { GameCard } from '@/components/GameCard';
import { Shell } from '@/components/Shell';
import { fetchApprovedGames } from '@/lib/games';
import type { HubGame } from '@/lib/types';

/** Name keywords that bucket a game into the Sports row. */
const SPORTS_RE = /(golf|basket|soccer|football|\bball\b|8ball|kick|fighter|box|dunk|hopper|tennis|pool|gladi|sport|goal|hoop|arena)/i;

/** Games created on or after this date also join the Trending row, even when
 *  they fall outside the newest-14 (recently added creator games stay
 *  visible). Midnight July 7, 2026 UTC. */
const TRENDING_CREATED_SINCE_MS = Date.UTC(2026, 6, 7);

/** Group the flat game list into the homepage rows. Games can appear in more
 *  than one row, and every game also shows in the full "All games" grid at the
 *  bottom — overlap is intentional. */
function buildRows(games: HubGame[]): { title: string; games: HubGame[] }[] {
  if (games.length === 0) return [];
  const sports = games.filter((g) => SPORTS_RE.test(g.name));
  // Newest 14 as before, plus any older game whose createdAt is on/after the
  // cutoff. The list is already newest-first, so time ordering is preserved.
  const trending = [
    ...games.slice(0, 14),
    ...games.slice(14).filter(
      (g) => g.createdAt >= TRENDING_CREATED_SINCE_MS,
    ),
  ];
  const restStart = Math.min(14, Math.max(0, games.length - 14));
  const recommended = games.slice(restStart, restStart + 14);
  return [
    { title: 'Trending', games: trending },
    { title: 'Sports', games: sports },
    { title: 'Recommended for you', games: recommended },
  ].filter((row) => row.games.length > 0);
}

function GameRow({ title, games }: { title: string; games: HubGame[] }) {
  return (
    <section className="hub-section">
      <h2 className="hub-section-title">{title}</h2>
      <div className="hub-row">
        {games.map((g) => (
          <GameCard key={`${title}-${g.source}-${g.id}`} game={g} />
        ))}
      </div>
    </section>
  );
}

export default function GamesPage() {
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

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => buildRows(games), [games]);

  return (
    <Shell>
      <main className="stage" style={{ paddingTop: 32, paddingBottom: 96 }}>
        <header style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 'clamp(28px, 3.4vw, 40px)', fontWeight: 500, letterSpacing: '-0.028em', lineHeight: 1 }}>
            Game Hub
          </h1>
          <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
            {loading ? 'Loading…' : `${games.length} games`}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={load} disabled={loading} className="btn-ghost" style={{ height: 36 }}>
              <RefreshIcon spinning={loading} />
              Refresh
            </button>
            <Link href="/upload" className="btn-primary" style={{ height: 36, padding: '0 16px' }}>
              <UploadIcon />
              Upload a game
            </Link>
          </div>
        </header>

        {loading && games.length === 0 ? (
          <div className="empty">
            <div className="h-10 w-10 animate-spin rounded-full border-4" style={{ width: 40, height: 40, borderRadius: '50%', borderTop: '4px solid var(--blue-1)', borderRight: '4px solid transparent', borderBottom: '4px solid var(--blue-2)', borderLeft: '4px solid transparent', margin: '0 auto', animation: 'spin 1s linear infinite' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : error && games.length === 0 ? (
          <div className="empty">
            <div style={{ fontSize: 36, marginBottom: 8 }}>⚠️</div>
            <h2>No games yet</h2>
            <p>{error}</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={load} className="btn-primary">Retry</button>
              <Link href="/upload" className="btn-ghost">Upload one</Link>
            </div>
          </div>
        ) : (
          <div className="hub-sections">
            {rows.map((row) => (
              <GameRow key={row.title} title={row.title} games={row.games} />
            ))}
            <section className="hub-section">
              <h2 className="hub-section-title">All games</h2>
              <div className="hub-grid">
                {games.map((g) => (
                  <GameCard key={`all-${g.source}-${g.id}`} game={g} />
                ))}
              </div>
            </section>
          </div>
        )}

      </main>
      {/* Rendered as a sibling of .stage (not inside it): .stage carries a
          transform from its fadein animation, which would otherwise become
          the containing block for this position:fixed bar. */}
      <Footer fixed />
    </Shell>
  );
}

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      style={spinning ? { animation: 'spin 1s linear infinite' } : undefined}
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v13" />
      <path d="m6 9 6-6 6 6" />
      <path d="M5 21h14" />
    </svg>
  );
}
