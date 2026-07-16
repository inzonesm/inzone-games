'use client';

/* Players — audience view. KPI cards (total / active-7d / paying / new) are
 * driven by the live dashboard metrics, and the per-player table is LIVE:
 * lib/players.ts aggregates the game's session docs per player (sessions,
 * coins spent, cohort, last seen) with names from humanUsers. The tier
 * filter buttons and sortable columns from the original table carry over
 * unchanged. Ported from the standalone portal's Players.jsx. */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Shell } from '@/components/Shell';
import { fetchDeveloperGames } from '@/lib/games';
import { fetchDashboard, type DashboardData } from '@/lib/dashboard';
import { fetchTopPlayers, type PlayerRow, type PlayerTier } from '@/lib/players';
import type { DeveloperGame } from '@/lib/types';

const TIER_COLOR: Record<PlayerTier, string> = {
  Whale: 'var(--blue-1)',
  Dolphin: 'var(--pink)',
  Casual: 'var(--warm)',
  New: 'var(--ink-3)',
};

const plStyles: Record<string, CSSProperties> = {
  hero: { paddingTop: 8, paddingBottom: 16, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' },
  crumb: { fontFamily: "'Geist Mono', monospace", fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 10 },
  h1: { margin: 0, fontSize: 30, fontWeight: 500, letterSpacing: '-0.026em', lineHeight: 1.05 },
  controls: { display: 'flex', gap: 8, alignItems: 'center' },
  table: { width: '100%', borderCollapse: 'collapse', fontFeatureSettings: "'tnum'" },
  th: { textAlign: 'left', padding: '12px 14px', fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--ink-3)', textTransform: 'uppercase', borderBottom: '1px solid var(--line-soft)', fontWeight: 500, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' },
  td: { padding: '14px 14px', fontSize: 13.5, borderBottom: '1px solid var(--line-soft)', color: 'var(--ink-2)', verticalAlign: 'middle' },
  handleCell: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 },
  avatar: { width: 30, height: 30, borderRadius: '50%', flexShrink: 0, boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.25)' },
  handle: { color: 'var(--ink)', fontWeight: 500, fontSize: 13.5 },
  uid: { fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: '0.04em', marginTop: 2 },
  num: { fontFamily: "'Geist Mono', monospace", fontSize: 13, color: 'var(--ink)', fontWeight: 500 },
  tierPill: { display: 'inline-flex', padding: '3px 9px', borderRadius: 999, fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', border: '1px solid currentColor' },
  cohortGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 },
};

function avatarBg(hue: number): string {
  return `radial-gradient(120% 100% at 30% 20%, oklch(0.82 0.13 ${hue}), oklch(0.55 0.16 ${(hue + 40) % 360}))`;
}

type SortKey = 'handle' | 'sessions' | 'coinsSpent';

export default function PlayersPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [games, setGames] = useState<DeveloperGame[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string>('');

  const [dash, setDash] = useState<DashboardData | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('coinsSpent');
  const [filter, setFilter] = useState<'All' | PlayerTier>('All');

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  const loadGames = useCallback(async () => {
    if (!user?.uid) return;
    setGamesLoading(true);
    setError(null);
    try {
      const list = await fetchDeveloperGames(user.uid);
      setGames(list);
      setCurrentId((prev) => (prev && list.some((g) => g.id === prev) ? prev : list[0]?.id ?? ''));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load your games.');
    } finally {
      setGamesLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => { void loadGames(); }, [loadGames]);

  useEffect(() => {
    if (!currentId) { setDash(null); setPlayers([]); return; }
    let cancelled = false;
    setPlayersLoading(true);
    // Dashboard KPIs and the player aggregates load in parallel.
    (async () => {
      const [d, rows] = await Promise.all([fetchDashboard(currentId), fetchTopPlayers(currentId)]);
      if (!cancelled) {
        setDash(d);
        setPlayers(rows);
        setPlayersLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentId]);

  const currentGame = games.find((g) => g.id === currentId) ?? null;

  const list = players
    .filter((p) => filter === 'All' || p.tier === filter)
    .sort((a, b) => {
      if (sortKey === 'handle') return a.handle.localeCompare(b.handle);
      return (b[sortKey] || 0) - (a[sortKey] || 0);
    });

  const tiers: Array<'All' | PlayerTier> = ['All', 'Whale', 'Dolphin', 'Casual', 'New'];
  const totalPlayers = dash?.totalPlayers || 0;
  const active7d = dash?.activePlayers7d || 0;
  const paying = Math.round(totalPlayers * 0.12);
  const newThisWeek = Math.round(active7d * 0.18);

  return (
    <Shell>
      <main className="stage">
        <header style={plStyles.hero}>
          <div>
            <div style={plStyles.crumb}>Audience · {currentGame?.name || 'your game'}</div>
            <h1 style={plStyles.h1}>Who&apos;s playing right now.</h1>
          </div>
          <div style={plStyles.controls}>
            {!gamesLoading && games.length > 1 && (
              <select className="select" value={currentId} onChange={(e) => setCurrentId(e.target.value)} style={{ width: 'auto', maxWidth: 220, height: 32 }} aria-label="Select game">
                {games.map((g) => <option key={g.id} value={g.id}>{g.name || g.id}</option>)}
              </select>
            )}
            <span className="pill live"><span className="dot" />Live</span>
          </div>
        </header>

        {error ? (
          <div className="empty" style={{ padding: 24 }}>
            <p>{error}</p>
            <button onClick={loadGames} className="btn-primary">Retry</button>
          </div>
        ) : !gamesLoading && games.length === 0 ? (
          <div className="empty">
            <div style={{ fontSize: 36, marginBottom: 8 }}>👥</div>
            <h2>No audience yet</h2>
            <p>Upload a game and your player counts will appear here as people start playing.</p>
            <Link href="/upload" className="btn-primary">Upload a game</Link>
          </div>
        ) : (
          <>
            {/* KPI cohort row — live where the data exists */}
            <section style={plStyles.cohortGrid}>
              {[
                { k: 'Total Players', v: totalPlayers.toLocaleString(), meta: 'all-time', accent: 'var(--ink)' },
                { k: 'Active · 7d', v: active7d.toLocaleString(), meta: 'unique', accent: 'var(--blue-1)' },
                { k: 'Paying', v: paying.toLocaleString(), meta: '~12% est.', accent: 'var(--pos)' },
                { k: 'New · this week', v: newThisWeek.toLocaleString(), meta: 'est.', accent: 'var(--pink)' },
              ].map((s) => (
                <article key={s.k} className="card">
                  <div className="card-head">
                    <span className="card-label">{s.k}</span>
                    <span className="card-meta">{s.meta}</span>
                  </div>
                  <div className="card-row">
                    <div className="stat">
                      <span className="num" style={{ color: s.accent }}>{s.v}</span>
                    </div>
                  </div>
                </article>
              ))}
            </section>

            {/* Player table — live per-player aggregates from session docs */}
            <section className="card tall" style={{ paddingBottom: 0 }}>
              <div className="card-head" style={{ marginBottom: 18 }}>
                <span className="card-label">Top players
                  <span style={{ marginLeft: 10, padding: '2px 8px', borderRadius: 999, background: 'oklch(0.78 0.14 155 / 0.15)', border: '1px solid oklch(0.78 0.14 155 / 0.3)', color: 'var(--pos)', fontSize: 9.5, letterSpacing: '0.08em' }}>LIVE</span>
                </span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {tiers.map((t) => (
                    <button
                      key={t}
                      onClick={() => setFilter(t)}
                      style={{ height: 28, padding: '0 10px', borderRadius: 8, background: filter === t ? 'oklch(0.30 0.08 245 / 0.5)' : 'var(--bg-2)', border: `1px solid ${filter === t ? 'var(--blue-2)' : 'var(--line)'}`, color: filter === t ? 'var(--ink)' : 'var(--ink-2)', fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: '0.06em', cursor: 'pointer' }}
                    >{t}</button>
                  ))}
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={plStyles.table}>
                  <thead>
                    <tr>
                      <th style={plStyles.th} onClick={() => setSortKey('handle')}>Player</th>
                      <th style={plStyles.th}>Tier</th>
                      <th style={plStyles.th} onClick={() => setSortKey('sessions')}>Sessions</th>
                      <th style={plStyles.th} onClick={() => setSortKey('coinsSpent')}>Coins spent</th>
                      <th style={plStyles.th}>Cohort</th>
                      <th style={plStyles.th}>Country</th>
                      <th style={plStyles.th}>Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {playersLoading && (
                      <tr>
                        <td colSpan={7} style={{ ...plStyles.td, borderBottom: 0 }}>
                          <div className="skeleton" style={{ height: 14, margin: '10px 0' }} />
                          <div className="skeleton" style={{ height: 14, margin: '10px 0' }} />
                          <div className="skeleton" style={{ height: 14, margin: '10px 0' }} />
                        </td>
                      </tr>
                    )}
                    {!playersLoading && list.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ ...plStyles.td, borderBottom: 0, textAlign: 'center', padding: '32px 14px', color: 'var(--ink-4)', fontFamily: "'Geist Mono', monospace", fontSize: 12 }}>
                          {players.length === 0
                            ? 'No player sessions yet — they appear here as people play.'
                            : `No ${filter} players yet.`}
                        </td>
                      </tr>
                    )}
                    {!playersLoading && list.map((p, i) => {
                      const last = i === list.length - 1;
                      const cell: CSSProperties = { ...plStyles.td, borderBottom: last ? 0 : (plStyles.td.borderBottom as string) };
                      return (
                        <tr key={p.id}>
                          <td style={cell}>
                            <div style={plStyles.handleCell}>
                              <div style={{ ...plStyles.avatar, background: avatarBg(p.avatarHue) }} />
                              <div style={{ minWidth: 0 }}>
                                <div style={plStyles.handle}>{p.handle}</div>
                                <div style={plStyles.uid}>{p.id}</div>
                              </div>
                            </div>
                          </td>
                          <td style={cell}><span style={{ ...plStyles.tierPill, color: TIER_COLOR[p.tier] }}>{p.tier}</span></td>
                          <td style={cell}><span style={plStyles.num}>{p.sessions}</span></td>
                          <td style={cell}>
                            <span style={{ ...plStyles.num, color: 'var(--warm)' }}>{p.coinsSpent.toLocaleString()}</span>
                            <span style={{ marginLeft: 4, fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color: 'var(--ink-4)' }}>coins</span>
                          </td>
                          <td style={cell}><span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 11.5, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>{p.cohort}</span></td>
                          <td style={cell}><span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 11.5, color: 'var(--ink-3)', letterSpacing: '0.06em' }}>{p.country}</span></td>
                          <td style={cell}><span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 11.5, color: 'var(--ink-3)' }}>{p.last} ago</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </Shell>
  );
}
