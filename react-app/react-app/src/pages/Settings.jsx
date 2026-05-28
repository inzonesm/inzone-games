/* Settings — studio profile, game keys, billing, notifications.
 * Placeholder controls — none are wired to the backend yet. */

const { useState } = React;

const stStyles = {
  hero: { paddingTop: 8, paddingBottom: 16 },
  crumb: { fontFamily: "'Geist Mono', monospace", fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 10 },
  h1: { margin: 0, fontSize: 30, fontWeight: 500, letterSpacing: '-0.026em', lineHeight: 1.05 },

  group: { display: 'grid', gridTemplateColumns: '240px 1fr', gap: 24, paddingBottom: 22, marginBottom: 22, borderBottom: '1px solid var(--line-soft)' },
  groupLast: { display: 'grid', gridTemplateColumns: '240px 1fr', gap: 24 },
  groupHead: { display: 'flex', flexDirection: 'column', gap: 6 },
  groupTitle: { fontSize: 16, fontWeight: 500, letterSpacing: '-0.012em', color: 'var(--ink)' },
  groupDesc: { color: 'var(--ink-3)', fontSize: 13, lineHeight: 1.5, margin: 0, maxWidth: '32ch' },

  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 },
  full: { gridColumn: '1 / -1' },

  toggle: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '14px 0', borderBottom: '1px solid var(--line-soft)' },

  keyBox: { background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' },
  keyText: { fontFamily: "'Geist Mono', monospace", fontSize: 12.5, color: 'var(--blue-1)', wordBreak: 'break-all' },
};

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      style={{
        width: 42, height: 24, borderRadius: 999,
        background: checked ? 'oklch(0.55 0.13 240)' : 'var(--bg-3)',
        border: '1px solid ' + (checked ? 'var(--blue-2)' : 'var(--line)'),
        position: 'relative', cursor: 'pointer',
        transition: 'background .2s, border-color .2s',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: checked ? 20 : 2,
        width: 18, height: 18, borderRadius: '50%',
        background: 'var(--ink)',
        boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.3)',
        transition: 'left .2s',
      }}></span>
    </button>
  );
}

function CopyKey({ value }) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    navigator.clipboard?.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div style={stStyles.keyBox}>
      <span style={stStyles.keyText}>{value}</span>
      <button
        onClick={onCopy}
        style={{
          height: 30, padding: '0 12px', borderRadius: 8, background: 'var(--bg-3)',
          border: '1px solid var(--line)', color: 'var(--ink-2)', cursor: 'pointer',
          fontFamily: "'Geist Mono', monospace", fontSize: 11, letterSpacing: '0.04em',
        }}
      >{copied ? 'Copied ✓' : 'Copy'}</button>
    </div>
  );
}

function SettingsPage({ currentGame }) {
  const { user, signOut } = window.useAuth();
  const [studio, setStudio] = useState('Volta Games');
  const [email, setEmail] = useState(user?.email || 'dev@yourstudio.com');
  const [payoutMethod, setPayoutMethod] = useState('ach');
  const [notify, setNotify] = useState({ payouts: true, milestones: true, weekly: true, security: true, marketing: false });

  return (
    <main className="stage">
      <header style={stStyles.hero}>
        <div style={stStyles.crumb}>Account · Studio settings</div>
        <h1 style={stStyles.h1}>Settings.</h1>
      </header>

      <section className="card tall">

        {/* Studio profile */}
        <div style={stStyles.group}>
          <div style={stStyles.groupHead}>
            <div style={stStyles.groupTitle}>Studio profile</div>
            <p style={stStyles.groupDesc}>Public on your game's InZone page and used for revenue contracts.</p>
          </div>
          <div>
            <div style={stStyles.row}>
              <div className="field">
                <label className="field-label">Studio name</label>
                <input className="input" value={studio} onChange={e => setStudio(e.target.value)} />
              </div>
              <div className="field">
                <label className="field-label">Contact email</label>
                <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              <div className="field" style={stStyles.full}>
                <label className="field-label">Studio description</label>
                <textarea className="textarea" placeholder="A line or two for your studio page." defaultValue="Tight-knit team out of Brooklyn, shipping Unity mobile games for friend groups." />
              </div>
            </div>
          </div>
        </div>

        {/* Game keys */}
        <div style={stStyles.group}>
          <div style={stStyles.groupHead}>
            <div style={stStyles.groupTitle}>Game keys</div>
            <p style={stStyles.groupDesc}>Each game has a server-side key for the SDK and a public ID. Rotate the key any time.</p>
          </div>
          <div>
            <div className="field">
              <label className="field-label">Server key · {currentGame?.name || '—'}</label>
              <CopyKey value={`gk_live_${currentGame?.gameId || 'demo'}_8a1f2c4e6d`} />
            </div>
            <div style={{ marginTop: 14 }} className="field">
              <label className="field-label">Game ID (public)</label>
              <CopyKey value={currentGame?.gameId || '—'} />
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
              <button className="btn-ghost" type="button">Rotate key</button>
              <button className="btn-ghost" type="button">Revoke</button>
            </div>
          </div>
        </div>

        {/* Payouts */}
        <div style={stStyles.group}>
          <div style={stStyles.groupHead}>
            <div style={stStyles.groupTitle}>Payouts</div>
            <p style={stStyles.groupDesc}>Where we send the 90% developer share each month.</p>
          </div>
          <div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              {[
                { id: 'ach', label: 'ACH · USD' },
                { id: 'wire', label: 'Wire · USD' },
                { id: 'sepa', label: 'SEPA · EUR' },
                { id: 'usdc', label: 'USDC · Base' },
              ].map(m => (
                <button
                  key={m.id}
                  onClick={() => setPayoutMethod(m.id)}
                  style={{
                    height: 36, padding: '0 14px', borderRadius: 10,
                    background: payoutMethod === m.id ? 'oklch(0.30 0.08 245 / 0.5)' : 'var(--bg-2)',
                    border: `1px solid ${payoutMethod === m.id ? 'var(--blue-2)' : 'var(--line)'}`,
                    color: payoutMethod === m.id ? 'var(--ink)' : 'var(--ink-2)',
                    fontFamily: "'Geist Mono', monospace", fontSize: 11.5, letterSpacing: '0.04em',
                    cursor: 'pointer',
                  }}
                >{m.label}</button>
              ))}
            </div>
            <div style={stStyles.row}>
              <div className="field">
                <label className="field-label">Routing number</label>
                <input className="input" placeholder="•••• 4421" />
              </div>
              <div className="field">
                <label className="field-label">Account number</label>
                <input className="input" placeholder="•••• 8902" />
              </div>
            </div>
            <p style={{ marginTop: 4, fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: '0.04em' }}>
              Next payout · June 1 · cycle starts 30 days after first paying user.
            </p>
          </div>
        </div>

        {/* Notifications */}
        <div style={stStyles.group}>
          <div style={stStyles.groupHead}>
            <div style={stStyles.groupTitle}>Notifications</div>
            <p style={stStyles.groupDesc}>Email digests and system alerts.</p>
          </div>
          <div>
            {[
              { k: 'payouts',    label: 'Payout sent',        sub: 'When a monthly payout is initiated.' },
              { k: 'milestones', label: 'Milestone moments',  sub: '10K / 50K / 100K player thresholds.' },
              { k: 'weekly',     label: 'Weekly summary',     sub: 'Monday digest — sessions, revenue, retention.' },
              { k: 'security',   label: 'Security & access',  sub: 'New sign-ins, key rotations, billing.' },
              { k: 'marketing',  label: 'Product updates',    sub: 'Roadmap notes from the InZone team.' },
            ].map(n => (
              <div key={n.k} style={stStyles.toggle}>
                <div>
                  <div style={{ fontSize: 13.5, color: 'var(--ink)' }}>{n.label}</div>
                  <div style={{ marginTop: 3, fontFamily: "'Geist Mono', monospace", fontSize: 11, color: 'var(--ink-3)' }}>{n.sub}</div>
                </div>
                <Toggle checked={notify[n.k]} onChange={v => setNotify(s => ({ ...s, [n.k]: v }))} />
              </div>
            ))}
          </div>
        </div>

        {/* Danger zone */}
        <div style={stStyles.groupLast}>
          <div style={stStyles.groupHead}>
            <div style={{ ...stStyles.groupTitle, color: 'var(--neg)' }}>Danger zone</div>
            <p style={stStyles.groupDesc}>Sign out of this session or delete the studio account. Account deletion is irreversible.</p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn-ghost" onClick={signOut}>Sign out</button>
            <button
              className="btn-ghost"
              style={{ borderColor: 'oklch(0.72 0.16 25 / 0.4)', color: 'var(--neg)' }}
            >Delete studio account</button>
          </div>
        </div>

      </section>

      {/* ApiNote commented out
      <window.ApiNote endpoint="/api/game-sdk/settings" source="local">
        <span style={{ color: 'var(--ink-4)' }}>· Profile, keys, payout method · session: {user?.uid}</span>
      </window.ApiNote>
      */}
    </main>
  );
}

window.SettingsPage = SettingsPage;
