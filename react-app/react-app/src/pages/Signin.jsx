/* Sign-in page — Firebase auth front-end.
 * Real implementation calls signInWithEmailAndPassword / signInWithPopup. */

const { useState } = React;

const signinStyles = {
  wrap: { position: 'relative', zIndex: 1, minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '40px 24px' },
  card: { width: '100%', maxWidth: 420, background: 'linear-gradient(180deg, oklch(0.20 0.02 245 / 0.5), oklch(0.165 0.018 245 / 0.5))', border: '1px solid var(--line)', borderRadius: 24, padding: '36px 32px 32px', backdropFilter: 'blur(20px) saturate(180%)', boxShadow: '0 30px 80px -30px oklch(0.50 0.15 250 / 0.4), inset 0 1px 0 oklch(1 0 0 / 0.06)' },
  h1: { margin: '28px 0 8px', fontSize: 30, fontWeight: 500, letterSpacing: '-0.028em', lineHeight: 1 },
  lede: { color: 'var(--ink-2)', fontSize: 14.5, lineHeight: 1.5, margin: '0 0 28px' },
  divider: { display: 'flex', alignItems: 'center', gap: 14, margin: '24px 0', fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' },
  dividerLine: { flex: 1, height: 1, background: 'var(--line-soft)' },
  ssoBtn: { height: 44, borderRadius: 12, background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--ink)', fontSize: 14, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%' },
  small: { marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--line-soft)', fontFamily: "'Geist Mono', monospace", fontSize: 11, color: 'var(--ink-3)', letterSpacing: '0.04em', textAlign: 'center' },
  note: { marginTop: 18, textAlign: 'center' },
  notePill: { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 999, background: 'oklch(0.20 0.04 245 / 0.4)', border: '1px solid var(--line-soft)', fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: '0.06em' },
};

function SigninPage() {
  const { signIn, loading, isFirebaseReady } = window.useAuth();
  const navigate = window.useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [errorMsg, setErrorMsg] = useState('');

  const friendlyError = (err) => {
    const code = err?.code || '';
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
      return 'Invalid email or password.';
    }
    if (code === 'auth/email-already-in-use') return 'That email is already registered. Try signing in instead.';
    if (code === 'auth/weak-password') return 'Password should be at least 6 characters.';
    if (code === 'auth/too-many-requests') return 'Too many attempts. Try again in a few minutes.';
    if (code === 'auth/popup-closed-by-user') return '';
    return err?.message || 'Sign in failed.';
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    if (!email || !password) {
      setErrorMsg('Email and password are required.');
      return;
    }
    try {
      await signIn({ email, password, mode });
      navigate('/upload');
    } catch (err) {
      setErrorMsg(friendlyError(err));
    }
  };

  const onSSO = async (provider) => {
    setErrorMsg('');
    try {
      await signIn({ provider });
      navigate('/upload');
    } catch (err) {
      setErrorMsg(friendlyError(err));
    }
  };

  return (
    <div style={signinStyles.wrap}>
      <div style={signinStyles.card}>
        <a href="https://inzone.gg" className="brand" style={{ display: 'inline-flex' }}>
          <window.LogoMark />
          InZone
          <span className="sub">Studio</span>
        </a>

        <h1 style={signinStyles.h1}>{mode === 'signup' ? 'Create your studio account.' : 'Sign in to build.'}</h1>
        <p style={signinStyles.lede}>Upload Unity mobile builds, watch your social loop come alive, and track payouts — all in one place.</p>

        <form onSubmit={onSubmit}>
          <div className="field">
            <label className="field-label" htmlFor="email">Work email</label>
            <input
              className="input"
              id="email"
              type="email"
              placeholder="dev@yourstudio.com"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label className="field-label" htmlFor="password">Password</label>
            <input
              className="input"
              id="password"
              type="password"
              placeholder={mode === 'signup' ? 'Choose a password (6+ characters)' : 'Your password'}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          {errorMsg && (
            <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: 'oklch(0.30 0.10 25 / 0.2)', border: '1px solid oklch(0.65 0.18 25 / 0.4)', color: 'oklch(0.78 0.13 25)', fontSize: 13 }}>
              {errorMsg}
            </div>
          )}
          <button className="btn-primary" type="submit" style={{ width: '100%', marginTop: 18, height: 46, borderRadius: 12 }} disabled={loading}>
            {loading ? (mode === 'signup' ? 'Creating account…' : 'Signing in…') : <>{mode === 'signup' ? 'Create account' : 'Continue'} <span style={{ fontSize: 14 }}>→</span></>}
          </button>
        </form>

        <div style={signinStyles.divider}>
          <span style={signinStyles.dividerLine}></span>
          or
          <span style={signinStyles.dividerLine}></span>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <button style={signinStyles.ssoBtn} type="button" onClick={() => onSSO('google')}>
            <svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M21.35 11.1H12v3.2h5.35c-.5 2.5-2.6 3.9-5.35 3.9a5.7 5.7 0 1 1 0-11.4c1.4 0 2.7.5 3.7 1.4l2.3-2.3A9 9 0 1 0 12 21c5 0 9-3.5 9-9c0-.3 0-.6-.05-.9z"/></svg>
            Continue with Google
          </button>
          <button style={signinStyles.ssoBtn} type="button" onClick={() => onSSO('github')}>
            <svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M12 0a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6c-.5-1.3-1.3-1.7-1.3-1.7c-1.1-.7.1-.7.1-.7c1.2.1 1.8 1.2 1.8 1.2c1 1.8 2.8 1.3 3.5 1c.1-.8.4-1.3.7-1.6c-2.6-.3-5.4-1.3-5.4-5.9c0-1.3.5-2.4 1.2-3.2c-.1-.3-.5-1.5.1-3.2c0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2c.6 1.7.2 2.9.1 3.2c.8.8 1.2 1.9 1.2 3.2c0 4.6-2.8 5.6-5.4 5.9c.4.4.8 1.1.8 2.3v3.4c0 .3.2.7.8.6A12 12 0 0 0 12 0z"/></svg>
            Continue with GitHub
          </button>
        </div>

        <p style={signinStyles.small}>
          {mode === 'signup' ? (
            <>Already have an account? <a href="#" onClick={(e) => { e.preventDefault(); setErrorMsg(''); setMode('signin'); }} style={{ color: 'var(--blue-1)' }}>Sign in →</a></>
          ) : (
            <>New developer? <a href="#" onClick={(e) => { e.preventDefault(); setErrorMsg(''); setMode('signup'); }} style={{ color: 'var(--blue-1)' }}>Create an account →</a></>
          )}
        </p>

        {/* Firebase Auth note commented out
        <div style={signinStyles.note}>
          <span style={signinStyles.notePill}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: isFirebaseReady ? 'var(--pos)' : 'var(--warm)', boxShadow: `0 0 8px ${isFirebaseReady ? 'var(--pos)' : 'var(--warm)'}` }}></span>
            {isFirebaseReady ? 'Firebase Auth · separate from inzone.gg' : 'Firebase offline · using local session'}
          </span>
        </div>
        */}
      </div>
    </div>
  );
}

window.SigninPage = SigninPage;
