/* Payouts page — currently no backend endpoint, uses local mock.
 * When you add /api/game-sdk/payouts, wire it in api.jsx getPayoutHistory. */

const { useState, useEffect } = React;

const payStyles = {
  heroCard: { background: 'linear-gradient(160deg, oklch(0.30 0.08 235 / 0.55), oklch(0.18 0.04 250 / 0.55))', borderColor: 'oklch(0.78 0.12 232 / 0.30)', padding: '32px 36px' },
  heroGrid: { display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 36, alignItems: 'center' },
  heroBig: { fontSize: 'clamp(56px, 8vw, 88px)', fontWeight: 400, letterSpacing: '-0.04em', lineHeight: 0.95, fontFeatureSettings: "'tnum'" },

  ring: { position: 'relative', width: 180, height: 180 },
  setupCard: {},
  iconBox: { width: 40, height: 40, borderRadius: 10, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', flexShrink: 0 },

  table: { display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr 1fr 0.9fr 0.7fr 80px', fontSize: 13 },
  th: { padding: '14px 20px', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--line-soft)', fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 500, background: 'oklch(0.18 0.02 245 / 0.3)' },
  td: { padding: '14px 20px', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--line-soft)' },
};

function Badge({ status }) {
  const styles = {
    paid: { color: 'var(--pos)', background: 'oklch(0.78 0.14 155 / 0.15)', border: '1px solid oklch(0.78 0.14 155 / 0.25)' },
    pending: { color: 'var(--warm)', background: 'oklch(0.78 0.14 75 / 0.15)', border: '1px solid oklch(0.78 0.14 75 / 0.25)' },
    processing: { color: 'var(--blue-1)', background: 'oklch(0.72 0.13 235 / 0.15)', border: '1px solid oklch(0.72 0.13 235 / 0.25)' },
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', ...styles[status] }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', boxShadow: '0 0 6px currentColor' }}></span>
      {status}
    </span>
  );
}

function fmt$(n) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function PayoutsPage() {
  const [payouts, setPayouts] = useState([]);
  const [source, setSource] = useState(null);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await window.inzoneAPI.getPayoutHistory();
      setPayouts(res.payouts);
      setSource(res.source);
      setLoading(false);
    })();
  }, []);

  const pending = payouts.find(p => p.status === 'pending');
  const pendingNet = pending?.net || 0;
  const threshold = 50;
  const ringPct = Math.min(100, (pendingNet / threshold) * 100);
  const circumference = 264; // 2*π*42 ≈ 263.9
  const arcLength = (ringPct / 100) * circumference;

  return (
    <main className="stage narrow" style={{ paddingTop: 32, paddingBottom: 80 }}>

      <div className="page-head">
        <div>
          <div className="sub">Studio · all games</div>
          <h1>Payouts</h1>
        </div>
      </div>

      {/* Hero */}
      <article className="card" style={payStyles.heroCard}>
        <div style={{ ...payStyles.heroGrid, gridTemplateColumns: '1.4fr 1fr' }} className="hero-responsive">
          <div>
            <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'oklch(0.85 0.08 232)', marginBottom: 10 }}>
              Pending balance · ready for next payout
            </div>
            <div style={payStyles.heroBig}>
              <span style={{ fontSize: 36, color: 'var(--ink-3)', marginRight: 4, fontWeight: 300, verticalAlign: '0.2em' }}>$</span>
              {pending ? pendingNet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
            </div>
            <div style={{ marginTop: 10, fontFamily: "'Geist Mono', monospace", fontSize: 12.5, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>
              90% of {pending ? fmt$(pending.gross) : '—'} gross · across 3 games
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div style={payStyles.ring}>
              <svg viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)', width: '100%', height: '100%' }}>
                <circle fill="none" stroke="oklch(0.30 0.04 245 / 0.5)" strokeWidth="10" cx="50" cy="50" r="42"/>
                <circle fill="none" stroke="var(--blue-1)" strokeWidth="10" strokeLinecap="round" cx="50" cy="50" r="42"
                  pathLength={circumference}
                  strokeDasharray={`${arcLength} ${circumference}`}
                />
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
                <div>
                  <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Threshold</div>
                  <div style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.022em', marginTop: 6, fontFeatureSettings: "'tnum'" }}>
                    <span style={{ fontSize: 16, color: 'var(--ink-3)', marginRight: 2 }}>$</span>{threshold}
                    <span style={{ color: 'var(--ink-3)', fontSize: 18, fontWeight: 300 }}> min</span>
                  </div>
                  <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color: 'var(--ink-3)', marginTop: 4, letterSpacing: '0.04em' }}>
                    {ringPct >= 100 ? 'cleared' : `${ringPct.toFixed(0)}%`}
                  </div>
                </div>
              </div>
            </div>
            <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 11, letterSpacing: '0.06em', color: 'var(--ink-3)' }}>
              Next payout · <b style={{ color: 'var(--ink)' }}>June 1, 2026</b>
            </div>
          </div>
        </div>
      </article>

      {/* Setup cards */}
      <section className="grid-2">
        <article className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
            <div style={{ ...payStyles.iconBox, color: 'var(--blue-1)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M7 15h2"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: '-0.015em' }}>Payout method</div>
              <div style={{ marginTop: 3, fontFamily: "'Geist Mono', monospace", fontSize: 11, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>Stripe Connect · monthly · 1st</div>
            </div>
            <span style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 999, fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'oklch(0.78 0.14 155 / 0.18)', color: 'var(--pos)', border: '1px solid oklch(0.78 0.14 155 / 0.3)' }}>Connected</span>
          </div>
          <p style={{ margin: '0 0 14px', color: 'var(--ink-2)', fontSize: 13.5, lineHeight: 1.5 }}>Payouts land in your Stripe Connect account. <b style={{ color: 'var(--ink)' }}>**** 4421</b> · Bank of America · USD.</p>
          <a href="#" className="btn-ghost" style={{ height: 36, fontSize: 13 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
            Manage in Stripe
          </a>
        </article>

        <article className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
            <div style={{ ...payStyles.iconBox, color: 'var(--warm)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: '-0.015em' }}>Tax forms</div>
              <div style={{ marginTop: 3, fontFamily: "'Geist Mono', monospace", fontSize: 11, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>W-9 (US) or W-8BEN (non-US)</div>
            </div>
            <span style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 999, fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'oklch(0.78 0.14 75 / 0.18)', color: 'var(--warm)', border: '1px solid oklch(0.78 0.14 75 / 0.3)' }}>Action needed</span>
          </div>
          <p style={{ margin: '0 0 14px', color: 'var(--ink-2)', fontSize: 13.5, lineHeight: 1.5 }}>We need a current tax form on file before your first payout clears. Takes about 3 minutes.</p>
          <a href="#" className="btn-primary" style={{ height: 36, fontSize: 13, borderRadius: 10 }}>
            Complete W-9 <span style={{ fontSize: 14 }}>→</span>
          </a>
        </article>
      </section>

      {/* History */}
      <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '22px 24px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--line-soft)', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="card-label">Payout history</div>
            <div className="card-meta" style={{ marginTop: 6 }}>last 12 months</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['All games', 'Nova Arena', 'Driftwave Karts', 'Rune Runners'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  height: 30, padding: '0 12px', borderRadius: 999,
                  background: filter === f ? 'var(--bg-3)' : 'transparent',
                  border: `1px solid ${filter === f ? 'var(--line-strong)' : 'var(--line)'}`,
                  color: filter === f ? 'var(--ink)' : 'var(--ink-3)',
                  fontFamily: "'Geist Mono', monospace", fontSize: 11, letterSpacing: '0.04em', cursor: 'pointer',
                }}
              >{f}</button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40 }}>
            <div className="skeleton" style={{ height: 16, marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 16, marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 16 }} />
          </div>
        ) : (
          <div className="table-responsive">
            <div style={payStyles.table}>
              <div style={payStyles.th}>Period</div>
              <div style={payStyles.th}>Gross</div>
              <div style={payStyles.th}>Fee (10%)</div>
              <div style={payStyles.th}>Net</div>
              <div style={payStyles.th}>Paid</div>
              <div style={payStyles.th}>Status</div>
              <div style={payStyles.th}></div>

              {payouts.map((p, i) => (
                <React.Fragment key={p.period}>
                  <div style={{ ...payStyles.td, color: 'var(--ink)', borderBottom: i < payouts.length - 1 ? '1px solid var(--line-soft)' : 0 }}>{p.period}</div>
                  <div style={{ ...payStyles.td, fontFamily: "'Geist Mono', monospace", fontFeatureSettings: "'tnum'", borderBottom: i < payouts.length - 1 ? '1px solid var(--line-soft)' : 0 }}>{fmt$(p.gross)}</div>
                  <div style={{ ...payStyles.td, fontFamily: "'Geist Mono', monospace", color: 'var(--ink-3)', fontFeatureSettings: "'tnum'", borderBottom: i < payouts.length - 1 ? '1px solid var(--line-soft)' : 0 }}>−{fmt$(p.fee)}</div>
                  <div style={{ ...payStyles.td, fontFamily: "'Geist Mono', monospace", color: 'var(--ink)', fontFeatureSettings: "'tnum'", borderBottom: i < payouts.length - 1 ? '1px solid var(--line-soft)' : 0 }}>{fmt$(p.net)}</div>
                  <div style={{ ...payStyles.td, color: 'var(--ink-3)', fontFamily: "'Geist Mono', monospace", fontSize: 12, letterSpacing: '0.04em', borderBottom: i < payouts.length - 1 ? '1px solid var(--line-soft)' : 0 }}>{p.paid || '—'}</div>
                  <div style={{ ...payStyles.td, borderBottom: i < payouts.length - 1 ? '1px solid var(--line-soft)' : 0 }}><Badge status={p.status} /></div>
                  <div style={{ ...payStyles.td, borderBottom: i < payouts.length - 1 ? '1px solid var(--line-soft)' : 0 }}>
                    <a href="#" style={{ color: 'var(--ink-3)', textDecoration: 'none', fontFamily: "'Geist Mono', monospace", fontSize: 11, letterSpacing: '0.06em' }}>
                      {p.status === 'paid' ? 'Receipt →' : 'Detail →'}
                    </a>
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ApiNote commented out
      <window.ApiNote endpoint="/api/game-sdk/payouts" source={source}>
        <span style={{ color: 'var(--warm)' }}>· endpoint not in current SDK · TODO</span>
      </window.ApiNote>
      */}

      <style>{`
        @media (max-width: 820px) {
          .hero-responsive { grid-template-columns: 1fr !important; gap: 24px !important; }
        }
        @media (max-width: 1000px) {
          .table-responsive > div { grid-template-columns: 1fr 1fr 1fr !important; font-size: 12px; }
          .table-responsive > div > *:nth-child(7n+4),
          .table-responsive > div > *:nth-child(7n+5),
          .table-responsive > div > *:nth-child(7n+6),
          .table-responsive > div > *:nth-child(7n+7) { display: none; }
        }
      `}</style>
    </main>
  );
}

window.PayoutsPage = PayoutsPage;
