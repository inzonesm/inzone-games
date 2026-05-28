/* Bundle specifications panel — shown on the upload page idle state.
 * Explains what to include in the Unity bundle so backend extraction works. */

function BundleSpecs() {
  const card = {
    padding: '16px 18px',
    borderRadius: 14,
    border: '1px solid var(--line-soft)',
    background: 'oklch(0.18 0.02 245 / 0.3)',
  };
  const num = {
    width: 28, height: 28, borderRadius: 8,
    background: 'var(--bg-3)', border: '1px solid var(--line)',
    display: 'grid', placeItems: 'center',
    color: 'var(--blue-1)',
    fontFamily: "'Geist Mono', monospace",
    fontSize: 11, fontWeight: 600,
  };
  const code = {
    fontFamily: "'Geist Mono', monospace",
    fontSize: 11.5,
    color: 'var(--blue-1)',
    marginBottom: 6,
  };
  const body = {
    margin: 0,
    color: 'var(--ink-3)',
    fontSize: 12.5,
    lineHeight: 1.5,
  };

  return (
    <section style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
        <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
          What to include in your bundle
        </span>
        <span style={{ flex: 1, height: 1, background: 'var(--line-soft)' }}></span>
      </div>
      <div className="bundle-spec-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={num}>01</span>
            <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>Title</span>
          </div>
          <div style={code}>your-game-name.zip</div>
          <p style={body}>Bundle filename becomes your game title (Title Cased). Use hyphens or underscores between words; version tags like v1.4.2 are stripped.</p>
        </div>

        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={num}>02</span>
            <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>Icon</span>
          </div>
          <div style={code}>/logo.jpg</div>
          <p style={body}>Place a logo.jpg at the root of your bundle. Square works best — we render it at 1x, 2x, and 3x for store listings.</p>
        </div>

        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={num}>03</span>
            <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>Description</span>
          </div>
          <div style={code}>/README.md</div>
          <p style={body}>Include a README.md or description.md. First paragraph becomes the library blurb on inzone.gg.</p>
        </div>
      </div>

      <style>{`@media (max-width: 720px) { .bundle-spec-grid { grid-template-columns: 1fr !important; } }`}</style>
    </section>
  );
}

window.BundleSpecs = BundleSpecs;
