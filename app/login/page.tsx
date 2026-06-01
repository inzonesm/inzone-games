'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { Logo } from '@/components/Logo';

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, configError, signInWithGoogle, signInWithApple } = useAuth();
  const [busy, setBusy] = useState<'google' | 'apple' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace('/games');
  }, [user, loading, router]);

  async function handle(provider: 'google' | 'apple') {
    setError(null);
    setBusy(provider);
    try {
      if (provider === 'google') await signInWithGoogle();
      else await signInWithApple();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sign-in failed.';
      if (!msg.includes('popup-closed-by-user')) setError(msg);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="app signin">
      <main className="signin-stage">
        <div className="signin-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <Logo size={32} />
            <span style={{ fontSize: 16, fontWeight: 500 }}>InZone</span>
            <span
              style={{
                fontFamily: "'Geist Mono', monospace",
                fontSize: 10.5,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--ink-3)',
                paddingLeft: 10,
                borderLeft: '1px solid var(--line)',
              }}
            >
              Hub + Studio
            </span>
          </div>

          <h1>Sign in.</h1>
          <p className="lede">
            One sign-in. Play community games, and ship your own.
          </p>

          {configError && <div className="err">{configError}</div>}
          {error && <div className="err">{error}</div>}

          <div className="providers">
            <button
              className="provider"
              onClick={() => handle('google')}
              disabled={!!busy || !!configError}
            >
              <GoogleIcon />
              {busy === 'google' ? 'Signing in…' : 'Continue with Google'}
            </button>

            <button
              className="provider"
              onClick={() => handle('apple')}
              disabled={!!busy || !!configError}
            >
              <AppleIcon />
              {busy === 'apple' ? 'Signing in…' : 'Continue with Apple'}
            </button>
          </div>

          <p
            style={{
              marginTop: 22,
              textAlign: 'center',
              fontFamily: "'Geist Mono', monospace",
              fontSize: 10.5,
              letterSpacing: '0.04em',
              color: 'var(--ink-4)',
            }}
          >
            By continuing you agree to the InZone Terms of Service.
          </p>
        </div>
      </main>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.32A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.42 5.42 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.32z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.32C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M17.564 12.747c-.027-2.748 2.244-4.07 2.347-4.135-1.279-1.87-3.27-2.128-3.978-2.158-1.692-.171-3.305 1-4.166 1-.876 0-2.188-.975-3.598-.948-1.852.027-3.56 1.075-4.51 2.733-1.92 3.327-.49 8.252 1.385 10.953.917 1.319 2.01 2.8 3.444 2.747 1.385-.056 1.91-.896 3.585-.896 1.673 0 2.146.896 3.612.868 1.494-.028 2.44-1.343 3.355-2.668 1.058-1.531 1.494-3.014 1.521-3.092-.034-.014-2.918-1.119-2.997-4.404zM14.85 4.835c.762-.93 1.279-2.21 1.137-3.49-1.097.046-2.443.732-3.235 1.65-.71.81-1.336 2.114-1.17 3.37 1.226.09 2.486-.61 3.268-1.53z" />
    </svg>
  );
}
