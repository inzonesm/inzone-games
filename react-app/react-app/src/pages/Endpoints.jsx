/* Endpoints — the five SDK endpoints a developer wires into their game.
 * Mirrors the marketing copy from InZone Website Animation/developers.html
 * (the "Five endpoints. Under thirty minutes." pillar). */

const { useState, useEffect } = React;

const ENDPOINTS = [
  {
    method: 'POST',
    path: '/api/game-sdk/coins/tier-{10,50,150,400}',
    title: 'Coins',
    desc: 'Purchase microtransaction coins at one of four tiers. Debits the player wallet and credits your game\'s revenue summary.',
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
    desc: 'Submit a score — writes to the game\'s leaderboard subcollection. Retrieve rankings with GET /api/game-sdk/leaderboard.',
    tags: ['runs', 'global', 'ranked'],
    accent: 'var(--blue-2)',
    sample: `// POST /api/game-sdk/post-score\nawait fetch('/api/game-sdk/post-score', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    gameId: ctx.gameId,\n    playerId: ctx.playerId,\n    playerName: 'ProGamer42',\n    score: 14820,\n    metadata: { lap: 3 },\n  }),\n});\n\n// GET /api/game-sdk/leaderboard?gameId=...&limit=50`,
  },
  {
    method: 'POST',
    path: '/api/game-sdk/open-chat',
    title: 'Chat',
    desc: 'Open or join the game\'s designated group chat. Sends a message to the conversation thread and merges participants automatically.',
    tags: ['groupchat', 'live', 'social'],
    accent: 'var(--blue-1)',
    sample: `// POST /api/game-sdk/open-chat\nawait fetch('/api/game-sdk/open-chat', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    gameId: ctx.gameId,\n    userId: ctx.playerId,\n    message: 'Just joined the game!',\n    sessionId: ctx.sessionId,\n  }),\n});`,
  },
];

const epStyles = {
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

function CodeBlock({ children, file }) {
  return (
    <div style={epStyles.codeFrame}>
      <div style={epStyles.codeChrome}>
        <span style={epStyles.chromeDot}></span>
        <span style={epStyles.chromeDot}></span>
        <span style={epStyles.chromeDot}></span>
        <span style={epStyles.filename}>{file}</span>
      </div>
      <pre style={epStyles.code}>{children}</pre>
    </div>
  );
}

/**
 * Fetch integration health metrics from Firestore (game_sdk_metrics collection).
 * Aggregates the last 24 hourly buckets for the given gameId.
 *
 * Each bucket doc: game_sdk_metrics/{gameId}_{YYYY-MM-DDTHH}
 *   requests (int), errors (int), total_latency_ms (float),
 *   latency_samples (float[]), endpoints_hit (string[])
 */
async function fetchIntegrationHealth(gameId) {
  const db = window.inzoneFirebase?.db;
  if (!db || !gameId) return null;

  try {
    const now = new Date();
    const hourKeys = [];
    for (let i = 0; i < 24; i++) {
      const h = new Date(now.getTime() - i * 60 * 60 * 1000);
      const pad = (n) => String(n).padStart(2, '0');
      const hourStr = `${h.getUTCFullYear()}-${pad(h.getUTCMonth() + 1)}-${pad(h.getUTCDate())}T${pad(h.getUTCHours())}`;
      hourKeys.push(`${gameId}_${hourStr}`);
    }

    // Firestore get() on individual docs (batch-style)
    const docRefs = hourKeys.map(k => db.collection('game_sdk_metrics').doc(k));
    const snapshots = await Promise.all(docRefs.map(r => r.get()));

    let totalRequests = 0;
    let totalErrors = 0;
    let totalLatencyMs = 0;
    const allSamples = [];
    const endpointsHit = new Set();
    const hourly = [];

    for (const snap of snapshots) {
      if (!snap.exists) continue;
      const d = snap.data();
      const reqs = d.requests || 0;
      const errs = d.errors || 0;
      const latSum = d.total_latency_ms || 0;
      const samples = d.latency_samples || [];
      const eps = d.endpoints_hit || [];

      totalRequests += reqs;
      totalErrors += errs;
      totalLatencyMs += latSum;
      allSamples.push(...samples);
      eps.forEach(e => endpointsHit.add(e));
      hourly.push({ hour: d.hour || snap.id, requests: reqs, errors: errs });
    }

    // Percentiles
    allSamples.sort((a, b) => a - b);
    const n = allSamples.length;
    const p95 = n > 0 ? allSamples[Math.min(Math.floor(n * 0.95), n - 1)] : 0;

    // Error rate
    const errorRate = totalRequests > 0 ? ((totalErrors / totalRequests) * 100) : 0;

    // Format helpers
    const fmtCount = (c) => {
      if (c >= 1_000_000) return `${(c / 1_000_000).toFixed(2)}M`;
      if (c >= 1_000) return `${(c / 1_000).toFixed(1)}K`;
      return String(c);
    };

    return {
      totalRequests,
      requestsFormatted: fmtCount(totalRequests),
      totalErrors,
      errorRate: Math.round(errorRate * 1000) / 1000,
      errorRateFormatted: `${(Math.round(errorRate * 1000) / 1000)}%`,
      p95LatencyMs: Math.round(p95 * 10) / 10,
      p95LatencyFormatted: p95 > 0 ? `${Math.round(p95)}ms` : null,
      endpointsHit: [...endpointsHit],
      hourly: hourly.sort((a, b) => a.hour.localeCompare(b.hour)),
    };
  } catch (err) {
    console.warn('Integration health fetch failed:', err);
    return null;
  }
}

function EndpointsPage({ currentGame }) {
  const [active, setActive] = useState(ENDPOINTS[0]);
  const [health, setHealth] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // Fetch live integration health from Firestore
  useEffect(() => {
    const gameId = currentGame?.gameId;
    if (!gameId) { setHealth(null); return; }

    let cancelled = false;
    setHealthLoading(true);
    fetchIntegrationHealth(gameId).then(data => {
      if (!cancelled) {
        setHealth(data);
        setHealthLoading(false);
      }
    });

    // Refresh every 60s
    const interval = setInterval(() => {
      fetchIntegrationHealth(gameId).then(data => {
        if (!cancelled) setHealth(data);
      });
    }, 60000);

    return () => { cancelled = true; clearInterval(interval); };
  }, [currentGame?.gameId]);

  // Build the three stat cards from live data (or placeholder)
  const hasData = health && health.totalRequests > 0;
  const statCards = hasData
    ? [
        {
          k: 'Requests',
          v: health.requestsFormatted,
          meta: health.totalRequests >= 1000 ? `${health.totalRequests.toLocaleString()} total` : 'last 24h',
          color: 'var(--ink)',
        },
        {
          k: 'Error rate',
          v: health.errorRateFormatted,
          meta: health.totalErrors === 0 ? 'within SLO' : `${health.totalErrors} error${health.totalErrors !== 1 ? 's' : ''}`,
          color: health.errorRate < 1 ? 'var(--pos)' : health.errorRate < 5 ? 'var(--warm)' : 'var(--neg, #f44)',
        },
        {
          k: 'p95 latency',
          v: health.p95LatencyFormatted || '—',
          meta: health.p95LatencyMs > 0 ? `${health.p95LatencyMs}ms` : 'no samples',
          color: health.p95LatencyMs < 200 ? 'var(--blue-1)' : health.p95LatencyMs < 500 ? 'var(--warm)' : 'var(--neg, #f44)',
        },
      ]
    : [
        { k: 'Requests', v: '—', meta: 'awaiting traffic', color: 'var(--ink-3)' },
        { k: 'Error rate', v: '—', meta: 'no errors yet', color: 'var(--ink-3)' },
        { k: 'p95 latency', v: '—', meta: 'awaiting data', color: 'var(--ink-3)' },
      ];

  return (
    <main className="stage">
      <header style={epStyles.hero}>
        <div style={epStyles.crumb}>
          <span style={{ color: 'var(--blue-1)' }}>02 — Integrate</span>
          {currentGame && <span style={{ marginLeft: 12, color: 'var(--ink-4)' }}>· {currentGame.name}</span>}
        </div>
        <h1 style={epStyles.h1}>Five endpoints. <span style={{ color: 'var(--ink-3)' }}>Under thirty minutes.</span></h1>
        <p style={epStyles.lede}>
          Coins, challenge, progress, leaderboard, chat. Each line of code lights a feature in the live game.
          The reference key for <b style={{ color: 'var(--ink)' }}>{currentGame?.name || 'your game'}</b> is on the Upload screen.
        </p>
      </header>

      <section style={epStyles.list}>
        {ENDPOINTS.map((ep, i) => (
          <article key={ep.path} className="card tall" style={{ padding: '22px 26px' }}>
            <div style={epStyles.row}>
              <div style={epStyles.meta}>
                <div style={epStyles.pathLine}>
                  <span style={{ ...epStyles.methodPill }}>{ep.method}</span>
                  <span style={{ color: 'var(--blue-1)' }}>{ep.path}</span>
                </div>
                <h2 style={{ ...epStyles.title, color: ep.accent }}>{ep.title}</h2>
                <p style={epStyles.desc}>{ep.desc}</p>
                <div style={epStyles.tagRow}>
                  {ep.tags.map(t => <span key={t} style={epStyles.tag}>{t}</span>)}
                </div>
                <div style={epStyles.status}>
                  <span style={{ ...epStyles.statusDot, background: 'var(--pos)', color: 'var(--pos)' }}></span>
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
          <span className="card-meta">
            {healthLoading ? 'loading…' : hasData ? 'live · last 24h' : 'last 24h'}
          </span>
        </div>
        <div style={epStyles.intGrid}>
          {statCards.map(s => (
            <div key={s.k} style={epStyles.intCard}>
              <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--ink-3)', textTransform: 'uppercase' }}>{s.k}</div>
              <div style={{ marginTop: 8, fontSize: 28, fontWeight: 500, letterSpacing: '-0.022em', color: s.color, fontFeatureSettings: "'tnum'" }}>{s.v}</div>
              <div style={{ marginTop: 6, fontFamily: "'Geist Mono', monospace", fontSize: 11, color: 'var(--ink-3)' }}>{s.meta}</div>
            </div>
          ))}
        </div>
        {hasData && health.hourly && health.hourly.length > 1 && (
          <div style={{ marginTop: 14, padding: '0 18px 14px' }}>
            <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10, letterSpacing: '0.1em', color: 'var(--ink-4)', textTransform: 'uppercase', marginBottom: 8 }}>
              Hourly requests (24h)
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 40 }}>
              {(() => {
                const maxReqs = Math.max(...health.hourly.map(h => h.requests), 1);
                return health.hourly.map((h, i) => (
                  <div
                    key={h.hour}
                    title={`${h.hour}: ${h.requests} req${h.errors > 0 ? `, ${h.errors} err` : ''}`}
                    style={{
                      flex: 1,
                      minWidth: 3,
                      height: `${Math.max(2, (h.requests / maxReqs) * 100)}%`,
                      background: h.errors > 0 ? 'var(--warm)' : 'var(--blue-1)',
                      borderRadius: 2,
                      opacity: 0.7,
                    }}
                  />
                ));
              })()}
            </div>
          </div>
        )}
      </section>

      {/* ApiNote commented out
      <window.ApiNote endpoint="/api/game-sdk/*" source="local">
        <span style={{ color: 'var(--ink-4)' }}>· Five endpoints · 30-minute integration target</span>
      </window.ApiNote>
      */}
    </main>
  );
}

window.EndpointsPage = EndpointsPage;
