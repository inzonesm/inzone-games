'use client';

/* Dashboard — the developer growth/analytics portal, ported from the
 * standalone react-app (Dashboard.jsx) into the Next.js app so it lives
 * alongside the hub, upload, and My Games as a parallel /dashboard endpoint.
 *
 * A game switcher in the page head lets a dev with multiple games pick which
 * one to inspect; the cards (Sessions, Community, Coin Activity, Payout) read
 * live Firestore metrics via lib/dashboard.ts. */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Shell } from '@/components/Shell';
import { fetchDeveloperGames } from '@/lib/games';
import {
  fetchCoinBreakdown,
  fetchDashboard,
  type CoinActivityItem,
  type CoinTitleBreakdown,
  type DashboardData,
} from '@/lib/dashboard';
import type { DeveloperGame } from '@/lib/types';

// ── Format helpers (verbatim from the portal) ─────────────────────
function fmtUSD(n: number): string {
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(n).toLocaleString('en-US');
}
function fmtMillions(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n || 0);
}
function fmtPct(d: number): string {
  return (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + '%';
}

// ── Sessions hero — big number + growth curve ─────────────────────
function SessionsHero({ sessions, delta }: { sessions: number; delta?: number }) {
  return (
    <article className="card gh-sessions">
      <div className="gh-head">
        <span className="gh-label"><span className="gh-dot" />SESSIONS · LIVE</span>
        <span className="gh-meta">last 30 days</span>
      </div>
      <div className="gh-num">{fmtMillions(sessions)}</div>
      <div className="gh-delta">
        <span className="gh-arrow">↗</span>
        <b>{fmtPct(delta || 0)}</b>
        <span className="gh-since">since launch</span>
      </div>

      <div className="gh-chart-wrap">
        <svg className="gh-chart-svg" viewBox="0 0 600 220" preserveAspectRatio="none">
          <defs>
            <linearGradient id="gh-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="oklch(0.78 0.12 232)" stopOpacity="0.5" />
              <stop offset="100%" stopColor="oklch(0.78 0.12 232)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g className="gh-grid">
            <line x1="0" y1="55" x2="600" y2="55" vectorEffect="non-scaling-stroke" />
            <line x1="0" y1="110" x2="600" y2="110" vectorEffect="non-scaling-stroke" />
            <line x1="0" y1="165" x2="600" y2="165" vectorEffect="non-scaling-stroke" />
          </g>
          <path className="gh-area" d="M0,200 C60,196 120,192 180,182 S260,162 320,140 S400,108 460,72 S540,32 600,8 L600,220 L0,220 Z" />
          <path className="gh-line" d="M0,200 C60,196 120,192 180,182 S260,162 320,140 S400,108 460,72 S540,32 600,8" />
          <circle className="gh-now-dot" cx="600" cy="8" r="6" />
        </svg>
      </div>
    </article>
  );
}

// ── Community network — radiating nodes around a centre ───────────
function CommunityNet({ connected }: { connected: number }) {
  return (
    <article className="card gh-community">
      <div className="gh-head">
        <span className="gh-label"><span className="gh-dot" />COMMUNITY · CONNECTED</span>
        <span className="gh-count">{(connected || 0).toLocaleString()}</span>
      </div>
      <div className="gh-net">
        <svg viewBox="0 0 460 240" preserveAspectRatio="xMidYMid meet">
          <g className="gh-conns">
            <line x1="230" y1="120" x2="120" y2="60" />
            <line x1="230" y1="120" x2="340" y2="70" />
            <line x1="230" y1="120" x2="200" y2="200" />
            <line x1="230" y1="120" x2="60" y2="100" />
            <line x1="230" y1="120" x2="400" y2="160" />
            <line x1="230" y1="120" x2="290" y2="210" />
            <line x1="230" y1="120" x2="160" y2="40" />
            <line x1="230" y1="120" x2="380" y2="30" />
            <line x1="230" y1="120" x2="100" y2="200" />
            <line x1="230" y1="120" x2="430" y2="100" />
            <line x1="230" y1="120" x2="20" y2="160" />
            <line x1="230" y1="120" x2="350" y2="220" />
            <line x1="230" y1="120" x2="80" y2="30" />
            <line x1="230" y1="120" x2="440" y2="200" />
          </g>
          <circle className="gh-node" cx="120" cy="60" r="5" />
          <circle className="gh-node warm" cx="340" cy="70" r="5" />
          <circle className="gh-node pink" cx="200" cy="200" r="5" />
          <circle className="gh-node" cx="60" cy="100" r="4.5" />
          <circle className="gh-node green" cx="400" cy="160" r="4.5" />
          <circle className="gh-node warm" cx="290" cy="210" r="4.5" />
          <circle className="gh-node" cx="160" cy="40" r="4.5" />
          <circle className="gh-node pink" cx="380" cy="30" r="4" />
          <circle className="gh-node" cx="100" cy="200" r="4" />
          <circle className="gh-node green" cx="430" cy="100" r="4" />
          <circle className="gh-node warm" cx="20" cy="160" r="4" />
          <circle className="gh-node" cx="350" cy="220" r="4" />
          <circle className="gh-node" cx="80" cy="30" r="3.5" />
          <circle className="gh-node pink" cx="440" cy="200" r="3.5" />
          <circle className="gh-core-ring" cx="230" cy="120" r="36" />
          <circle className="gh-core-ring" cx="230" cy="120" r="56" style={{ animationDelay: '1s' }} />
          <circle className="gh-core" cx="230" cy="120" r="18" />
        </svg>
      </div>
    </article>
  );
}

// ── Coin activity stream — rolling rows + per-title expand ────────
function CoinActivity({
  totalCoins,
  recentActivity,
  gameId,
}: {
  totalCoins: number;
  recentActivity: CoinActivityItem[];
  gameId: string;
}) {
  const stream = recentActivity || [];
  const [expanded, setExpanded] = useState(false);
  const [txBreakdown, setTxBreakdown] = useState<CoinTitleBreakdown[] | null>(null);
  const [txLoading, setTxLoading] = useState(false);

  useEffect(() => {
    if (!expanded || !gameId || txBreakdown) return;
    let cancelled = false;
    setTxLoading(true);
    (async () => {
      const rows = await fetchCoinBreakdown(gameId);
      if (!cancelled) {
        setTxBreakdown(rows);
        setTxLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [expanded, gameId, txBreakdown]);

  // Reset the cached breakdown when switching games.
  useEffect(() => { setTxBreakdown(null); setExpanded(false); }, [gameId]);

  const maxCount = txBreakdown ? Math.max(...txBreakdown.map((t) => t.count), 1) : 1;

  return (
    <article className="card gh-coins" style={{ position: 'relative' }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{ position: 'absolute', top: 30, right: 14, background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: expanded ? 'var(--blue-1)' : 'var(--ink-3)', padding: 0, lineHeight: 1, zIndex: 1 }}
        title={expanded ? 'Collapse' : 'Expand'}
      >
        {expanded ? '⤫' : '⤢'}
      </button>
      <div className="gh-head">
        <span className="gh-label"><span className="gh-dot gh-warm" />COIN ACTIVITY · LIVE</span>
        <span className="gh-running">{fmtMillions(totalCoins)} coins</span>
      </div>

      {!expanded && (
        <div className="gh-stream">
          {stream.length > 0 ? stream.map((c, i) => (
            <div key={i} className={`gh-coin-row gh-c${i + 1}`}>
              <span className="gh-coin-ic" />
              <span className="gh-coin-nm">{c.nm || 'anon'}</span>
              <span className="gh-coin-amt">+{c.amt}</span>
              <span className="gh-coin-ts">{c.ago}</span>
            </div>
          )) : (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--ink-4)', fontFamily: "'Geist Mono', monospace", fontSize: 12, letterSpacing: '0.04em' }}>
              No coin activity yet
            </div>
          )}
        </div>
      )}

      {expanded && (
        <div style={{ paddingTop: 10, overflow: 'hidden', flex: 1, position: 'relative' }}>
          {txLoading && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--ink-4)', fontFamily: "'Geist Mono', monospace", fontSize: 11 }}>Loading…</div>
          )}
          {!txLoading && txBreakdown && txBreakdown.length === 0 && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--ink-4)', fontFamily: "'Geist Mono', monospace", fontSize: 11 }}>No transactions yet</div>
          )}
          {!txLoading && txBreakdown && txBreakdown.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {txBreakdown.map((t) => (
                <div key={t.title} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 11, color: 'var(--ink-2)', minWidth: 0, flex: '0 0 auto', maxWidth: '45%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                  <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'oklch(0.15 0.02 245 / 0.6)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(t.count / maxCount) * 100}%`, borderRadius: 3, background: 'linear-gradient(90deg, var(--warm), oklch(0.82 0.16 60))' }} />
                  </div>
                  <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10, color: 'var(--warm)', whiteSpace: 'nowrap', flex: '0 0 auto' }}>{t.coins} · {t.count}×</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 30, background: 'linear-gradient(transparent, var(--bg-1))', pointerEvents: 'none' }} />
        </div>
      )}
    </article>
  );
}

// ── Payout — emerald card with gross / fee / net ──────────────────
function PayoutPanel({ gross, fee, net, delta }: { gross: number; fee: number; net: number; delta?: number }) {
  return (
    <article className="card gh-payout">
      <div className="gh-head">
        <span className="gh-label"><span className="gh-dot gh-pos" />PAYOUT · NET</span>
        <span className="gh-next">NET · <b>90% developer share</b></span>
      </div>
      <div className="gh-pay-num">{fmtUSD(net)}</div>
      <div className="gh-pay-delta">
        <span className="gh-pay-badge">{fmtPct(delta || 0)} W/W</span>
        <span className="gh-since">coins valued at $0.01 each</span>
      </div>
      <div className="gh-breakdown">
        <div className="gh-cell"><span className="gh-cell-l">GROSS</span><span className="gh-cell-v"><b>{fmtUSD(gross)}</b></span></div>
        <div className="gh-cell"><span className="gh-cell-l">FEE · 10%</span><span className="gh-cell-v">{fmtUSD(fee)}</span></div>
        <div className="gh-cell"><span className="gh-cell-l">NET</span><span className="gh-cell-v"><b>{fmtUSD(net)}</b></span></div>
      </div>
    </article>
  );
}

function DashboardSkeleton() {
  return (
    <div className="gh-grid">
      <div className="card gh-sessions"><div className="skeleton" style={{ height: '90%' }} /></div>
      <div className="gh-right-col">
        <div className="card"><div className="skeleton" style={{ height: '80%' }} /></div>
        <div className="card"><div className="skeleton" style={{ height: '80%' }} /></div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [games, setGames] = useState<DeveloperGame[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string>('');

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashLoading, setDashLoading] = useState(false);

  // Anonymous → /login.
  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  // Load the developer's games to populate the switcher.
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

  // Load dashboard metrics whenever the selected game changes.
  useEffect(() => {
    if (!currentId) { setDashboard(null); return; }
    let cancelled = false;
    setDashLoading(true);
    (async () => {
      const d = await fetchDashboard(currentId);
      if (!cancelled) {
        setDashboard(d);
        setDashLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentId]);

  const currentGame = games.find((g) => g.id === currentId) ?? null;
  const studio = user?.displayName || user?.email?.split('@')[0] || 'Studio';
  const nowTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

  const grossUSD = (dashboard?.grossCoins || 0) * 0.01;
  const feeUSD = grossUSD * 0.1;
  const netUSD = grossUSD - feeUSD;

  return (
    <Shell>
      <main className="stage gh-stage">
        {gamesLoading ? (
          <>
            <div className="skeleton" style={{ height: 40, borderRadius: 10 }} />
            <DashboardSkeleton />
          </>
        ) : error ? (
          <div className="empty">
            <div style={{ fontSize: 36, marginBottom: 8 }}>⚠️</div>
            <h2>Couldn&apos;t load your dashboard</h2>
            <p>{error}</p>
            <button onClick={loadGames} className="btn-primary">Retry</button>
          </div>
        ) : games.length === 0 ? (
          <div className="empty">
            <div style={{ fontSize: 36, marginBottom: 8 }}>📊</div>
            <h2>No games to analyze yet</h2>
            <p>Upload a game and its sessions, players, and coin activity will show up here.</p>
            <Link href="/upload" className="btn-primary">Upload a game</Link>
          </div>
        ) : (
          <>
            <header className="gh-page-head">
              <h1>{currentGame?.name || 'Your game'} is live.</h1>
              <span className="gh-crumb">/ <b>{studio.toUpperCase()}</b></span>
              {games.length > 1 ? (
                <select
                  className="select"
                  value={currentId}
                  onChange={(e) => setCurrentId(e.target.value)}
                  style={{ width: 'auto', maxWidth: 260, marginLeft: 'auto', height: 38 }}
                  aria-label="Select game"
                >
                  {games.map((g) => (
                    <option key={g.id} value={g.id}>{g.name || g.id}</option>
                  ))}
                </select>
              ) : (
                <span className="gh-day">DAY <b>{dashboard?.daysSinceLaunch || 1}</b> · {nowTime}</span>
              )}
            </header>

            {dashLoading || !dashboard ? (
              <DashboardSkeleton />
            ) : (
              <>
                <div className="gh-grid">
                  <SessionsHero sessions={dashboard.sessionCount} delta={dashboard.deltas?.sessions} />
                  <div className="gh-right-col">
                    <CommunityNet connected={dashboard.activePlayers7d} />
                    <CoinActivity totalCoins={dashboard.totalCoinsUsed} recentActivity={dashboard.recentCoinActivity} gameId={currentId} />
                  </div>
                </div>
                <PayoutPanel gross={grossUSD} fee={feeUSD} net={netUSD} delta={dashboard.deltas?.payout} />
              </>
            )}
          </>
        )}
      </main>
    </Shell>
  );
}
