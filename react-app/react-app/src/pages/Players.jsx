/* Players — top players, cohorts, and a sortable table.
 * Same dashboard data shape as the Overview page; just sliced differently. */

const { useState, useEffect } = React;

const MOCK_PLAYERS = [
  { id: 'usr_4982', handle: 'nova_',     country: 'US', cohort: 'Mar 26', tier: 'Whale',    sessions: 142, coinsSpent: 9420, last: '3s', avatarHue: 220 },
  { id: 'usr_2014', handle: 'kit.x',     country: 'UK', cohort: 'Feb 26', tier: 'Whale',    sessions: 118, coinsSpent: 7110, last: '42s', avatarHue: 340 },
  { id: 'usr_8821', handle: 'jay-runs',  country: 'CA', cohort: 'Apr 26', tier: 'Dolphin',  sessions: 91,  coinsSpent: 3210, last: '1m', avatarHue: 75 },
  { id: 'usr_3318', handle: 'sam_',      country: 'AU', cohort: 'Mar 26', tier: 'Dolphin',  sessions: 88,  coinsSpent: 2940, last: '3m', avatarHue: 155 },
  { id: 'usr_1042', handle: 'rio',       country: 'BR', cohort: 'Apr 26', tier: 'Dolphin',  sessions: 76,  coinsSpent: 2180, last: '4m', avatarHue: 250 },
  { id: 'usr_6611', handle: 'mira',      country: 'DE', cohort: 'May 26', tier: 'Casual',   sessions: 64,  coinsSpent:  890, last: '7m', avatarHue: 30 },
  { id: 'usr_9930', handle: 'tariq',     country: 'AE', cohort: 'May 26', tier: 'Casual',   sessions: 58,  coinsSpent:  640, last: '9m', avatarHue: 295 },
  { id: 'usr_7728', handle: 'ines',      country: 'PT', cohort: 'May 26', tier: 'Casual',   sessions: 51,  coinsSpent:  410, last: '14m', avatarHue: 190 },
  { id: 'usr_5142', handle: 'oki',       country: 'JP', cohort: 'May 26', tier: 'New',      sessions: 22,  coinsSpent:   80, last: '21m', avatarHue: 130 },
  { id: 'usr_4002', handle: 'lex_',      country: 'KR', cohort: 'May 26', tier: 'New',      sessions: 18,  coinsSpent:   60, last: '34m', avatarHue: 12 },
];

const TIER_COLOR = {
  Whale:   'var(--blue-1)',
  Dolphin: 'var(--pink)',
  Casual:  'var(--warm)',
  New:     'var(--ink-3)',
};

const plStyles = {
  hero: { paddingTop: 8, paddingBottom: 16, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 },
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

function avatarBg(hue) {
  return `radial-gradient(120% 100% at 30% 20%, oklch(0.82 0.13 ${hue}), oklch(0.55 0.16 ${(hue + 40) % 360}))`;
}

function PlayersPage({ currentGame }) {
  const [sortKey, setSortKey] = useState('coinsSpent');
  const [filter, setFilter] = useState('All');
  const [dash, setDash] = useState(null);

  useEffect(() => {
    if (!currentGame) return;
    (async () => {
      const d = await window.inzoneAPI.getDashboard(currentGame.gameId, 'gk_demo');
      setDash(d.dashboard);
    })();
  }, [currentGame?.gameId]);

  const list = MOCK_PLAYERS
    .filter(p => filter === 'All' || p.tier === filter)
    .sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));

  const tiers = ['All', 'Whale', 'Dolphin', 'Casual', 'New'];
  const totalPlayers = dash?.totalPlayers || 0;
  const active7d = dash?.activePlayers7d || 0;
  const paying = Math.round(totalPlayers * 0.12);
  const newThisWeek = Math.round(active7d * 0.18);

  return (
    <main className="stage">
      <header style={plStyles.hero}>
        <div>
          <div style={plStyles.crumb}>Audience · {currentGame?.name || 'your game'}</div>
          <h1 style={plStyles.h1}>Who's playing right now.</h1>
        </div>
        <div style={plStyles.controls}>
          <span className="pill"><span className="dot"></span>Live</span>
          <span className="pill">Last 30 days <span className="caret">▾</span></span>
        </div>
      </header>

      {/* KPI cohort row */}
      <section style={plStyles.cohortGrid}>
        {[
          { k: 'Total Players',  v: totalPlayers.toLocaleString(), meta: 'all-time',   accent: 'var(--ink)' },
          { k: 'Active · 7d',    v: active7d.toLocaleString(),    meta: 'unique',      accent: 'var(--blue-1)' },
          { k: 'Paying',         v: paying.toLocaleString(),       meta: '~12% of base', accent: 'var(--pos)' },
          { k: 'New · this week',v: newThisWeek.toLocaleString(),  meta: 'first session', accent: 'var(--pink)' },
        ].map(s => (
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

      {/* Filter pills */}
      <section className="card tall" style={{ paddingBottom: 0 }}>
        <div className="card-head" style={{ marginBottom: 18 }}>
          <span className="card-label">Top players</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {tiers.map(t => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                style={{
                  height: 28, padding: '0 10px', borderRadius: 8,
                  background: filter === t ? 'oklch(0.30 0.08 245 / 0.5)' : 'var(--bg-2)',
                  border: `1px solid ${filter === t ? 'var(--blue-2)' : 'var(--line)'}`,
                  color: filter === t ? 'var(--ink)' : 'var(--ink-2)',
                  fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: '0.06em',
                  cursor: 'pointer',
                }}
              >{t}</button>
            ))}
          </div>
        </div>

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
            {list.map((p, i) => (
              <tr key={p.id}>
                <td style={{ ...plStyles.td, borderBottom: i === list.length - 1 ? 0 : plStyles.td.borderBottom }}>
                  <div style={plStyles.handleCell}>
                    <div style={{ ...plStyles.avatar, background: avatarBg(p.avatarHue) }}></div>
                    <div style={{ minWidth: 0 }}>
                      <div style={plStyles.handle}>{p.handle}</div>
                      <div style={plStyles.uid}>{p.id}</div>
                    </div>
                  </div>
                </td>
                <td style={{ ...plStyles.td, borderBottom: i === list.length - 1 ? 0 : plStyles.td.borderBottom }}>
                  <span style={{ ...plStyles.tierPill, color: TIER_COLOR[p.tier] }}>{p.tier}</span>
                </td>
                <td style={{ ...plStyles.td, borderBottom: i === list.length - 1 ? 0 : plStyles.td.borderBottom }}>
                  <span style={plStyles.num}>{p.sessions}</span>
                </td>
                <td style={{ ...plStyles.td, borderBottom: i === list.length - 1 ? 0 : plStyles.td.borderBottom }}>
                  <span style={{ ...plStyles.num, color: 'var(--warm)' }}>{p.coinsSpent.toLocaleString()}</span>
                  <span style={{ marginLeft: 4, fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color: 'var(--ink-4)' }}>coins</span>
                </td>
                <td style={{ ...plStyles.td, borderBottom: i === list.length - 1 ? 0 : plStyles.td.borderBottom }}>
                  <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 11.5, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>{p.cohort}</span>
                </td>
                <td style={{ ...plStyles.td, borderBottom: i === list.length - 1 ? 0 : plStyles.td.borderBottom }}>
                  <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 11.5, color: 'var(--ink-3)', letterSpacing: '0.06em' }}>{p.country}</span>
                </td>
                <td style={{ ...plStyles.td, borderBottom: i === list.length - 1 ? 0 : plStyles.td.borderBottom }}>
                  <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 11.5, color: 'var(--ink-3)' }}>{p.last} ago</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ApiNote commented out
      <window.ApiNote endpoint="/api/game-sdk/players" source="local">
        <span style={{ color: 'var(--ink-4)' }}>· Aggregated from your game-state endpoint</span>
      </window.ApiNote>
      */}
    </main>
  );
}

window.PlayersPage = PlayersPage;
