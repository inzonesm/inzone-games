/* Dashboard — growth view matching InZone growth-late.png design.
 *
 *  ┌─────────────────────────┬──────────────────────────┐
 *  │                         │  COMMUNITY · CONNECTED   │
 *  │   SESSIONS · LIVE       │  ┌── network graph ──┐   │
 *  │                         │  └───────────────────┘   │
 *  │     [BIG NUMBER]        ├──────────────────────────┤
 *  │     +xxxx% since launch │  COIN ACTIVITY · LIVE    │
 *  │                         │  ┌── coin rows ──────┐   │
 *  │   ┌── growth curve ──┐  │  └───────────────────┘   │
 *  │   └─────────────────-┘  │                          │
 *  ├─────────────────────────┴──────────────────────────┤
 *  │  PAYOUT · NET                                       │
 *  │  $ [BIG NUMBER]   GROSS · FEE · NET                 │
 *  └────────────────────────────────────────────────────┘
 */

const { useState, useEffect } = React;

/* ── Format helpers ──────────────────────────────────────── */
function fmtUSD(n) {
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(n).toLocaleString('en-US');
}
function fmtMillions(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n || 0);
}
function fmtPct(d) { return (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + '%'; }

/* ── Sessions hero — big number + growth curve ─────────────── */
function SessionsHero({ sessions, delta }) {
  return (
    <article className="card gh-sessions">
      <div className="gh-head">
        <span className="gh-label"><span className="gh-dot"></span>SESSIONS · LIVE</span>
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
              <stop offset="0%"  stopColor="oklch(0.78 0.12 232)" stopOpacity="0.5"/>
              <stop offset="100%" stopColor="oklch(0.78 0.12 232)" stopOpacity="0"/>
            </linearGradient>
          </defs>
          <g className="gh-grid">
            <line x1="0" y1="55"  x2="600" y2="55"  vectorEffect="non-scaling-stroke"/>
            <line x1="0" y1="110" x2="600" y2="110" vectorEffect="non-scaling-stroke"/>
            <line x1="0" y1="165" x2="600" y2="165" vectorEffect="non-scaling-stroke"/>
          </g>
          <path className="gh-area" d="M0,200 C60,196 120,192 180,182 S260,162 320,140 S400,108 460,72 S540,32 600,8 L600,220 L0,220 Z"/>
          <path className="gh-line" d="M0,200 C60,196 120,192 180,182 S260,162 320,140 S400,108 460,72 S540,32 600,8"/>
          <circle className="gh-now-dot" cx="600" cy="8" r="6"/>
        </svg>
      </div>
    </article>
  );
}

/* ── Community network — radiating nodes around a centre ──── */
function CommunityNet({ connected }) {
  return (
    <article className="card gh-community">
      <div className="gh-head">
        <span className="gh-label"><span className="gh-dot"></span>COMMUNITY · CONNECTED</span>
        <span className="gh-count">{(connected || 0).toLocaleString()}</span>
      </div>
      <div className="gh-net">
        <svg viewBox="0 0 460 240" preserveAspectRatio="xMidYMid meet">
          <g className="gh-conns">
            <line x1="230" y1="120" x2="120" y2="60"  />
            <line x1="230" y1="120" x2="340" y2="70"  />
            <line x1="230" y1="120" x2="200" y2="200" />
            <line x1="230" y1="120" x2="60"  y2="100" />
            <line x1="230" y1="120" x2="400" y2="160" />
            <line x1="230" y1="120" x2="290" y2="210" />
            <line x1="230" y1="120" x2="160" y2="40"  />
            <line x1="230" y1="120" x2="380" y2="30"  />
            <line x1="230" y1="120" x2="100" y2="200" />
            <line x1="230" y1="120" x2="430" y2="100" />
            <line x1="230" y1="120" x2="20"  y2="160" />
            <line x1="230" y1="120" x2="350" y2="220" />
            <line x1="230" y1="120" x2="80"  y2="30"  />
            <line x1="230" y1="120" x2="440" y2="200" />
          </g>

          <circle className="gh-node"       cx="120" cy="60"  r="5"/>
          <circle className="gh-node warm"  cx="340" cy="70"  r="5"/>
          <circle className="gh-node pink"  cx="200" cy="200" r="5"/>
          <circle className="gh-node"       cx="60"  cy="100" r="4.5"/>
          <circle className="gh-node green" cx="400" cy="160" r="4.5"/>
          <circle className="gh-node warm"  cx="290" cy="210" r="4.5"/>
          <circle className="gh-node"       cx="160" cy="40"  r="4.5"/>
          <circle className="gh-node pink"  cx="380" cy="30"  r="4"/>
          <circle className="gh-node"       cx="100" cy="200" r="4"/>
          <circle className="gh-node green" cx="430" cy="100" r="4"/>
          <circle className="gh-node warm"  cx="20"  cy="160" r="4"/>
          <circle className="gh-node"       cx="350" cy="220" r="4"/>
          <circle className="gh-node"       cx="80"  cy="30"  r="3.5"/>
          <circle className="gh-node pink"  cx="440" cy="200" r="3.5"/>

          <circle className="gh-core-ring" cx="230" cy="120" r="36" />
          <circle className="gh-core-ring" cx="230" cy="120" r="56" style={{ animationDelay: '1s' }}/>
          <circle className="gh-core" cx="230" cy="120" r="18"/>
        </svg>
      </div>
    </article>
  );
}

/* ── Coin activity stream — rolling rows of coin events ───── */

/* MOCK DATA — commented out. Coin activity is now driven by live Firestore data
 * passed via the recentActivity prop.
 *
 * const COIN_STREAM = [
 *   { nm: 'nova_', amt: 50,  ago: '0.1s' },
 *   { nm: 'kit',   amt: 100, ago: '0.3s' },
 *   { nm: 'jay',   amt: 25,  ago: '0.4s' },
 *   { nm: 'sam',   amt: 150, ago: '0.6s' },
 *   { nm: 'aurel', amt: 80,  ago: '0.8s' },
 *   { nm: 'mel',   amt: 200, ago: '1.1s' },
 *   { nm: 'ren',   amt: 65,  ago: '1.3s' },
 *   { nm: 'vex',   amt: 120, ago: '1.5s' },
 *   { nm: 'tia',   amt: 90,  ago: '1.7s' },
 *   { nm: 'leo',   amt: 175, ago: '1.9s' },
 * ];
 */

function CoinActivity({ totalCoins, recentActivity, gameId }) {
  const stream = recentActivity || [];
  const [expanded, setExpanded] = useState(false);
  const [txBreakdown, setTxBreakdown] = useState(null);
  const [txLoading, setTxLoading] = useState(false);

  useEffect(() => {
    if (!expanded || !gameId) return;
    if (txBreakdown) return; // already fetched

    let cancelled = false;
    setTxLoading(true);

    (async () => {
      const db = window.inzoneFirebase?.db;
      if (!db) { setTxLoading(false); return; }
      try {
        const snap = await db.collection('game_coin_transactions')
          .where('game_id', '==', gameId)
          .get();

        const byTitle = {};
        snap.docs.forEach((d) => {
          const tx = d.data();
          const title = tx.title || 'Unknown';
          const coins = tx.coins || 0;
          if (!byTitle[title]) {
            byTitle[title] = { title, coins, count: 0, totalCoins: 0 };
          }
          byTitle[title].count += 1;
          byTitle[title].totalCoins += coins;
        });

        const sorted = Object.values(byTitle).sort((a, b) => b.count - a.count);
        if (!cancelled) setTxBreakdown(sorted);
      } catch (e) {
        console.warn('game_coin_transactions fetch failed:', e);
        if (!cancelled) setTxBreakdown([]);
      }
      if (!cancelled) setTxLoading(false);
    })();

    return () => { cancelled = true; };
  }, [expanded, gameId]);

  const maxCount = txBreakdown ? Math.max(...txBreakdown.map(t => t.count), 1) : 1;

  return (
    <article className="card gh-coins" style={{ position: 'relative' }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          position: 'absolute',
          top: 30,
          right: 14,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 22,
          color: expanded ? 'var(--blue-1)' : 'var(--ink-3)',
          padding: 0,
          lineHeight: 1,
          zIndex: 1,
        }}
        title={expanded ? 'Collapse' : 'Expand'}
      >
        {expanded ? '⤫' : '⤢'}
      </button>
      <div className="gh-head">
        <span className="gh-label"><span className="gh-dot gh-warm"></span>COIN ACTIVITY · LIVE</span>
        <span className="gh-running">{fmtMillions(totalCoins)} coins</span>
      </div>

      {!expanded && (
        <div className="gh-stream">
          {stream.length > 0 ? stream.map((c, i) => (
            <div key={i} className={`gh-coin-row gh-c${i + 1}`}>
              <span className="gh-coin-ic"></span>
              <span className="gh-coin-nm">{c.nm}</span>
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
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--ink-4)', fontFamily: "'Geist Mono', monospace", fontSize: 11 }}>
              Loading…
            </div>
          )}
          {!txLoading && txBreakdown && txBreakdown.length === 0 && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--ink-4)', fontFamily: "'Geist Mono', monospace", fontSize: 11 }}>
              No transactions yet
            </div>
          )}
          {!txLoading && txBreakdown && txBreakdown.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {txBreakdown.map((t) => (
                <div key={t.title} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 11, color: 'var(--ink-2)', minWidth: 0, flex: '0 0 auto', maxWidth: '45%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.title}
                  </span>
                  <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'oklch(0.15 0.02 245 / 0.6)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${(t.count / maxCount) * 100}%`,
                      borderRadius: 3,
                      background: 'linear-gradient(90deg, var(--warm), oklch(0.82 0.16 60))',
                    }} />
                  </div>
                  <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10, color: 'var(--warm)', whiteSpace: 'nowrap', flex: '0 0 auto' }}>
                    {t.coins} · {t.count}×
                  </span>
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

/* ── Payout — emerald card with gross / fee / net ────────── */
function PayoutPanel({ gross, fee, net, delta }) {
  return (
    <article className="card gh-payout">
      <div className="gh-head">
        <span className="gh-label"><span className="gh-dot gh-pos"></span>PAYOUT · NET</span>
        <span className="gh-next">NEXT PAYOUT · <b>JUN 01</b></span>
      </div>
      <div className="gh-pay-num">{fmtUSD(net)}</div>
      <div className="gh-pay-delta">
        <span className="gh-pay-badge">{fmtPct(delta || 0)} W/W</span>
        <span className="gh-since">net 90% developer share</span>
      </div>
      <div className="gh-breakdown">
        <div className="gh-cell"><span className="gh-cell-l">GROSS</span><span className="gh-cell-v"><b>{fmtUSD(gross)}</b></span></div>
        <div className="gh-cell"><span className="gh-cell-l">FEE · 10%</span><span className="gh-cell-v">{fmtUSD(fee)}</span></div>
        <div className="gh-cell"><span className="gh-cell-l">NET</span><span className="gh-cell-v"><b>{fmtUSD(net)}</b></span></div>
      </div>
    </article>
  );
}

function Skeleton() {
  return (
    <main className="stage gh-stage">
      <div className="skeleton" style={{ height: 40, borderRadius: 10 }} />
      <div className="gh-grid">
        <div className="card" style={{ minHeight: 420 }}><div className="skeleton" style={{ height: '90%' }} /></div>
        <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr', gap: 20 }}>
          <div className="card"><div className="skeleton" style={{ height: '80%' }} /></div>
          <div className="card"><div className="skeleton" style={{ height: '80%' }} /></div>
        </div>
      </div>
      <div className="card" style={{ minHeight: 200 }}><div className="skeleton" style={{ height: '80%' }} /></div>
    </main>
  );
}

/* ── Page ──────────────────────────────────────────────────── */
function DashboardPage({ games, currentGame, onSelectGame }) {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentGame) return;
    setLoading(true);
    (async () => {
      const d = await window.inzoneAPI.getDashboard(currentGame.gameId, 'gk_demo');
      setDashboard(d.dashboard);
      setLoading(false);
    })();
  }, [currentGame?.gameId]);

  if (loading || !dashboard) return <Skeleton />;

  const d = dashboard;
  const grossUSD = (d.grossCoins || 0) * 0.01;
  const feeUSD = grossUSD * 0.10;
  const netUSD = grossUSD - feeUSD;
  const nowTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <main className="stage gh-stage">

      {/* Page head */}
      <header className="gh-page-head">
        <h1>{currentGame.name} is live.</h1>
        <span className="gh-crumb">/ <b>{(currentGame.studio || 'Studio').toUpperCase()}</b></span>
        <span className="gh-day">DAY <b>{d.daysSinceLaunch || 1}</b> · {nowTime}</span>
      </header>

      {/* Sessions (left) + Community (right-top) + Coin Activity (right-bottom) */}
      <div className="gh-grid">
        <SessionsHero sessions={d.sessionCount} delta={d.deltas?.sessions} />
        <div className="gh-right-col">
          <CommunityNet connected={d.activePlayers7d} />
          <CoinActivity totalCoins={d.totalCoinsUsed} recentActivity={d.recentCoinActivity} gameId={currentGame.gameId} />
        </div>
      </div>

      {/* Payout — full width beneath */}
      <PayoutPanel
        gross={grossUSD}
        fee={feeUSD}
        net={netUSD}
        delta={d.deltas?.payout}
      />

    </main>
  );
}

window.DashboardPage = DashboardPage;

/* ═══════════════════════════════════════════════════════════════
 * COMMENTED OUT — dashboard.html-style analytics layout
 * (retention chart, sparkline KPI rows, donut, bars)
 * Kept for reference; restore by uncommenting and swapping
 * the DashboardPage body above.
 * ═══════════════════════════════════════════════════════════════

function Spark({ d, fillStyle, strokeStyle }) {
  return (
    <svg className="spark" viewBox="0 0 96 36" preserveAspectRatio="none">
      <path className="fill" d={`${d} L96,36 L0,36 Z`} style={fillStyle} />
      <path className="line" d={d} style={strokeStyle} />
    </svg>
  );
}

function Bars({ heights }) {
  return (
    <div className="bars" aria-hidden="true">
      {heights.map((h, i) => <span key={i} style={{ height: h + '%' }} />)}
    </div>
  );
}

function Donut({ pct }) {
  const r = 26;
  const C = 2 * Math.PI * r;
  const dash = (pct / 100) * C;
  return (
    <div className="donut" aria-hidden="true">
      <svg viewBox="0 0 64 64">
        <circle className="track" cx="32" cy="32" r={r} />
        <circle className="arc" cx="32" cy="32" r={r}
          strokeDasharray={`${dash.toFixed(0)} ${(C - dash).toFixed(0)}`} />
      </svg>
      <span className="pct">{pct}%</span>
    </div>
  );
}

function RetentionChart({ d1, d7, d30 }) {
  return (
    <section className="card chart-card">
      <div className="card-head">
        <span className="card-label">Retention</span>
        <div className="legend">
          <span className="l1"><i></i>D1</span>
          <span className="l2"><i></i>D7</span>
          <span className="l3"><i></i>D30</span>
        </div>
      </div>
      <div className="chart-wrap">
        <div className="axis-y-html">
          <span>80%</span><span>60%</span><span>40%</span><span>20%</span>
        </div>
        <div className="axis-x-html">
          <span>W1</span><span>W2</span><span>W3</span><span>W4</span><span>W5</span>
          <span>W6</span><span>W7</span><span>W8</span><span>W9</span><span>W10</span>
        </div>
        <svg className="chart-svg" viewBox="0 0 800 200" preserveAspectRatio="none">
          <g className="axis-grid">
            <line x1="0" y1="10"  x2="800" y2="10"  vectorEffect="non-scaling-stroke" />
            <line x1="0" y1="65"  x2="800" y2="65"  vectorEffect="non-scaling-stroke" />
            <line x1="0" y1="120" x2="800" y2="120" vectorEffect="non-scaling-stroke" />
            <line x1="0" y1="175" x2="800" y2="175" vectorEffect="non-scaling-stroke" />
          </g>
          <line className="axis-base" x1="0" y1="200" x2="800" y2="200" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <path d="M0,30 C40,28 80,32 120,28 ..." fill="url(#area-1)" />
          <path d="M0,90 C40,92 80,86 120,92 ..." fill="url(#area-2)" />
          <path d="M0,150 C40,152 80,148 120,150 ..." fill="url(#area-3)" />
        </svg>
      </div>
      <div className="chart-stat">
        <div className="item"><span className="v b1">{Math.round(d1 * 100)}%</span><span className="k">D1</span></div>
        <div className="item"><span className="v b2">{Math.round(d7 * 100)}%</span><span className="k">D7</span></div>
        <div className="item"><span className="v b3">{Math.round(d30 * 100)}%</span><span className="k">D30</span></div>
      </div>
    </section>
  );
}

// Dashboard.html-style layout (9 KPI cards + retention chart):
//
// <main className="stage dash-stage">
//   <header className="dash-head">...</header>
//   <section className="grid-3">
//     Total Players | Active 7d | Sessions  (sparklines + bars)
//   </section>
//   <RetentionChart d1={...} d7={...} d30={...} />
//   <section className="grid-3 money">
//     Developer Earnings (featured) | Gross Spend | InZone Fee (donut)
//   </section>
//   <section className="grid-3">
//     Coins Used | Avg Spend/Session | Avg Session Length
//   </section>
// </main>

═══════════════════════════════════════════════════════════════ */
