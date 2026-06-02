'use client';

/* Endpoints — the five SDK endpoints a developer wires into their game, plus
 * live integration-health metrics. Ported from the standalone portal's
 * Endpoints.jsx into the Next.js app as a parallel /endpoints route. The
 * endpoint reference cards are static copy; the "Integration health" panel
 * reads live game_sdk_metrics via lib/endpoints.ts and refreshes every 60s. */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Shell } from '@/components/Shell';
import { fetchDeveloperGames } from '@/lib/games';
import { fetchIntegrationHealth, type IntegrationHealth } from '@/lib/endpoints';
import type { DeveloperGame } from '@/lib/types';

interface EndpointDef {
  method: string;
  path: string;
  title: string;
  desc: string;
  tags: string[];
  accent: string;
  sample: string;
}

const ENDPOINTS: EndpointDef[] = [
  {
    method: 'POST',
    path: '/api/game-sdk/coins/tier-{10,50,150,400}',
    title: 'Coins',
    desc: "Purchase microtransaction coins at one of four tiers. Debits the player wallet and credits your game's revenue summary.",
    tags: ['microtx', 'wallet', '4-tier'],
    accent: 'var(--warm)',
    sample: `// POST /api/game-sdk/coins/tier-10\nawait fetch('/api/game-sdk/coins/tier-10', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    userId: 'usr_4982',\n    gameId: ctx.gameId,\n    sessionId: ctx.sessionId,\n  }),\n});\n// Tiers: 10 / 50 / 150 / 400`,
  },
  {
    method: 'POST',
    path: '/api/game-sdk/send-challenge',
    title: 'Challenge',
    desc: 'Challenge a friend — sends a game link with your score, generates a share card, and writes to game_challenges. Like the "Challenge a Friend" button.',
    tags: ['social', 'deep-link', 'share'],
    accent: 'var(--pink)',
    sample: `// POST /api/game-sdk/send-challenge\nawait fetch('/api/game-sdk/send-challenge', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    gameId: ctx.gameId,\n    senderId: ctx.playerId,\n    recipientId: 'friend_abc',\n    score: 14820,\n    message: 'Can you beat this score?',\n  }),\n});`,
  },
  {
    method: 'POST',
    path: '/api/game-sdk/progress/share',
    title: 'Progress',
    desc: 'Share a progress snapshot — generates a shareable visual of an achievement or run. Like the "Share Progress" button in the app.',
    tags: ['feed', 'visual', 'share'],
    accent: 'var(--pos)',
    sample: `// POST /api/game-sdk/progress/share\nawait fetch('/api/game-sdk/progress/share', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    gameId: ctx.gameId,\n    userId: ctx.playerId,\n    score: 14820,\n    title: 'New high score — Wind Cup',\n    visual: 'auto',\n    metrics: { score: 14820, lap: 3 },\n  }),\n});`,
  },
  {
    method: 'POST',
    path: '/api/game-sdk/post-score',
    title: 'Leaderboard',
    desc: "Submit a score — writes to the game's leaderboard subcollection. Retrieve rankings with GET /api/game-sdk/leaderboard.",
    tags: ['runs', 'global', 'ranked'],
    accent: 'var(--blue-2)',
    sample: `// POST /api/game-sdk/post-score\nawait fetch('/api/game-sdk/post-score', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    gameId: ctx.gameId,\n    playerId: ctx.playerId,\n    playerName: 'ProGamer42',\n    score: 14820,\n    metadata: { lap: 3 },\n  }),\n});\n\n// GET /api/game-sdk/leaderboard?gameId=...&limit=50`,
  },
  {
    method: 'POST',
    path: '/api/game-sdk/open-chat',
    title: 'Chat',
    desc: "Open or join the game's designated group chat. Sends a message to the conversation thread and merges participants automatically.",
    tags: ['groupchat', 'live', 'social'],
    accent: 'var(--blue-1)',
    sample: `// POST /api/game-sdk/open-chat\nawait fetch('/api/game-sdk/open-chat', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    gameId: ctx.gameId,\n    userId: ctx.playerId,\n    message: 'Just joined the game!',\n    sessionId: ctx.sessionId,\n  }),\n});`,
  },
];

const epStyles: Record<string, CSSProperties> = {
  hero: { paddingTop: 8, paddingBottom: 18 },
  crumb: { fontFamily: "'Geist Mono', monospace", fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 10 },
  h1: { margin: 0, fontSize: 36, fontWeight: 500, letterSpacing: '-0.028em', lineHeight: 1.05, maxWidth: '20ch' },
  lede: { marginTop: 14, color: 'var(--ink-2)', fontSize: 15, lineHeight: 1.55, maxWidth: '60ch' },
  list: { display: 'grid', gap: 14 },
  row: { display: 'grid', gridTemplateColumns: '1fr 1.05fr', gap: 22, alignItems: 'stretch' },
  meta: { display: 'flex', flexDirection: 'column', gap: 10 },
  pathLine: { display: 'flex', alignItems: 'baseline', gap: 10, fontFamily: "'Geist Mono', monospace", fontSize: 13.5, letterSpacing: '0.01em' },
  methodPill: { display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 6, background: 'oklch(0.78 0.14 155 / 0.15)', border: '1px solid oklch(0.78 0.14 155 / 0.3)', color: 'var(--pos)', fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: '0.08em', fontWeight: 500 },
  title: { fontSize: 22, fontWeight: 500, letterSpacing: '-0.018em', margin: 0 },
  desc: { color: 'var(--ink-3)', fontSize: 13.5, lineHeight: 1.55, margin: 0, maxWidth: '38ch' },
  tagRow: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 },
  tag: { padding: '3px 8px', borderRadius: 999, background: 'oklch(0.20 0.02 245 / 0.5)', border: '1px solid var(--line-soft)', fontFamily: "'Geist Mono', monospace", fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.04em' },
  status: { marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase' },
  statusDot: { width: 7, height: 7, borderRadius: '50%', boxShadow: '0 0 6px currentColor' },
  codeFrame: { background: 'oklch(0.085 0.015 245 / 0.85)', border: '1px solid var(--line)', borderRadius: 12, padding: 14, overflow: 'auto', position: 'relative' },
  codeChrome: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 },
  chromeDot: { width: 8, height: 8, borderRadius: '50%', background: 'oklch(0.32 0.02 245)' },
  filename: { fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: '0.06em', marginLeft: 8 },
  code: { margin: 0, fontFamily: "'Geist Mono', monospace", fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  intGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 },
  intCard: { padding: 18 },
};

function CodeBlock({ children, file }: { children: React.ReactNode; file: string }) {
  return (
    <div style={epStyles.codeFrame}>
      <div style={epStyles.codeChrome}>
        <span style={epStyles.chromeDot} />
        <span style={epStyles.chromeDot} />
        <span style={epStyles.chromeDot} />
        <span style={epStyles.filename}>{file}</span>
      </div>
      <pre style={epStyles.code}>{children}</pre>
    </div>
  );
}

export default function EndpointsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [games, setGames] = useState<DeveloperGame[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string>('');

  const [health, setHealth] = useState<IntegrationHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // Anonymous → /login.
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

  // Live integration health for the selected game, refreshed every 60s.
  useEffect(() => {
    if (!currentId) { setHealth(null); return; }
    let cancelled = false;
    setHealthLoading(true);
    const run = async () => {
      const data = await fetchIntegrationHealth(currentId);
      if (!cancelled) { setHealth(data); setHealthLoading(false); }
    };
    void run();
    const interval = setInterval(() => { void run(); }, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [currentId]);

  const currentGame = games.find((g) => g.id === currentId) ?? null;
  const hasData = !!health && health.totalRequests > 0;

  const statCards = hasData
    ? [
        {
          k: 'Requests',
          v: health!.requestsFormatted,
          meta: health!.totalRequests >= 1000 ? `${health!.totalRequests.toLocaleString()} total` : 'last 24h',
          color: 'var(--ink)',
        },
        {
          k: 'Error rate',
          v: health!.errorRateFormatted,
          meta: health!.totalErrors === 0 ? 'within SLO' : `${health!.totalErrors} error${health!.totalErrors !== 1 ? 's' : ''}`,
          color: health!.errorRate < 1 ? 'var(--pos)' : health!.errorRate < 5 ? 'var(--warm)' : 'var(--neg)',
        },
        {
          k: 'p95 latency',
          v: health!.p95LatencyFormatted || '—',
          meta: health!.p95LatencyMs > 0 ? `${health!.p95LatencyMs}ms` : 'no samples',
          color: health!.p95LatencyMs < 200 ? 'var(--blue-1)' : health!.p95LatencyMs < 500 ? 'var(--warm)' : 'var(--neg)',
        },
      ]
    : [
        { k: 'Requests', v: '—', meta: 'awaiting traffic', color: 'var(--ink-3)' },
        { k: 'Error rate', v: '—', meta: 'no errors yet', color: 'var(--ink-3)' },
        { k: 'p95 latency', v: '—', meta: 'awaiting data', color: 'var(--ink-3)' },
      ];

  return (
    <Shell>
      <main className="stage">
        <header style={epStyles.hero}>
          <div style={{ ...epStyles.crumb, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ color: 'var(--blue-1)' }}>02 — Integrate</span>
            {currentGame && <span style={{ color: 'var(--ink-4)' }}>· {currentGame.name}</span>}
            {!gamesLoading && games.length > 1 && (
              <select
                className="select"
                value={currentId}
                onChange={(e) => setCurrentId(e.target.value)}
                style={{ width: 'auto', maxWidth: 240, marginLeft: 'auto', height: 34 }}
                aria-label="Select game"
              >
                {games.map((g) => (
                  <option key={g.id} value={g.id}>{g.name || g.id}</option>
                ))}
              </select>
            )}
          </div>
          <h1 style={epStyles.h1}>Five endpoints. <span style={{ color: 'var(--ink-3)' }}>Under thirty minutes.</span></h1>
          <p style={epStyles.lede}>
            Coins, challenge, progress, leaderboard, chat. Each line of code lights a feature in the live game.
            The reference key for <b style={{ color: 'var(--ink)' }}>{currentGame?.name || 'your game'}</b> is on the Upload screen.
          </p>
        </header>

        {error && (
          <div className="empty" style={{ padding: '24px' }}>
            <p>{error}</p>
            <button onClick={loadGames} className="btn-primary">Retry</button>
          </div>
        )}

        {!error && !gamesLoading && games.length === 0 && (
          <div className="empty">
            <div style={{ fontSize: 36, marginBottom: 8 }}>🔌</div>
            <h2>No games to integrate yet</h2>
            <p>Upload a game first — then wire these endpoints into it and watch the integration health light up here.</p>
            <Link href="/upload" className="btn-primary">Upload a game</Link>
          </div>
        )}

        <section style={epStyles.list}>
          {ENDPOINTS.map((ep) => (
            <article key={ep.path} className="card tall" style={{ padding: '22px 26px' }}>
              <div style={epStyles.row}>
                <div style={epStyles.meta}>
                  <div style={epStyles.pathLine}>
                    <span style={epStyles.methodPill}>{ep.method}</span>
                    <span style={{ color: 'var(--blue-1)' }}>{ep.path}</span>
                  </div>
                  <h2 style={{ ...epStyles.title, color: ep.accent }}>{ep.title}</h2>
                  <p style={epStyles.desc}>{ep.desc}</p>
                  <div style={epStyles.tagRow}>
                    {ep.tags.map((t) => <span key={t} style={epStyles.tag}>{t}</span>)}
                  </div>
                  <div style={epStyles.status}>
                    <span style={{ ...epStyles.statusDot, background: 'var(--pos)', color: 'var(--pos)' }} />
                    Live · responding 200 OK
                  </div>
                </div>
                <CodeBlock file={`game-sdk/${ep.title.toLowerCase()}.js`}>{ep.sample}</CodeBlock>
              </div>
            </article>
          ))}
        </section>

        <section className="card tall" style={{ marginTop: 6 }}>
          <div className="card-head">
            <span className="card-label">Integration health</span>
            <span className="card-meta">{healthLoading ? 'loading…' : hasData ? 'live · last 24h' : 'last 24h'}</span>
          </div>
          <div style={epStyles.intGrid}>
            {statCards.map((s) => (
              <div key={s.k} style={epStyles.intCard}>
                <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--ink-3)', textTransform: 'uppercase' }}>{s.k}</div>
                <div style={{ marginTop: 8, fontSize: 28, fontWeight: 500, letterSpacing: '-0.022em', color: s.color, fontFeatureSettings: "'tnum'" }}>{s.v}</div>
                <div style={{ marginTop: 6, fontFamily: "'Geist Mono', monospace", fontSize: 11, color: 'var(--ink-3)' }}>{s.meta}</div>
              </div>
            ))}
          </div>
          {hasData && health!.hourly.length > 1 && (
            <div style={{ marginTop: 14, padding: '0 18px 14px' }}>
              <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10, letterSpacing: '0.1em', color: 'var(--ink-4)', textTransform: 'uppercase', marginBottom: 8 }}>
                Hourly requests (24h)
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 40 }}>
                {(() => {
                  const maxReqs = Math.max(...health!.hourly.map((h) => h.requests), 1);
                  return health!.hourly.map((h) => (
                    <div
                      key={h.hour}
                      title={`${h.hour}: ${h.requests} req${h.errors > 0 ? `, ${h.errors} err` : ''}`}
                      style={{ flex: 1, minWidth: 3, height: `${Math.max(2, (h.requests / maxReqs) * 100)}%`, background: h.errors > 0 ? 'var(--warm)' : 'var(--blue-1)', borderRadius: 2, opacity: 0.7 }}
                    />
                  ));
                })()}
              </div>
            </div>
          )}
        </section>
      </main>
    </Shell>
  );
}
