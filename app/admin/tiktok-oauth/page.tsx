'use client';

/**
 * TikTok OAuth admin page.
 *
 * The only entry point for the OAuth flow. Requires a signed-in Firebase
 * account whose email is on `ADMIN_EMAILS`. The button POSTs to
 * `/api/tiktok/oauth/start` with a Bearer ID token; the server verifies the
 * token, sets the state cookie, and returns the TikTok authorize URL. The
 * page then navigates the same window there.
 *
 * No admin key ever appears in a URL, a fetch response body, or the DOM.
 */

import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { isAdminEmail } from '@/lib/admin-shared';

export default function TikTokOAuthAdminPage() {
  const { user, loading, signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const email = user?.email ?? null;
  const admin = isAdminEmail(email);

  async function startOAuth() {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/tiktok/oauth/start', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        credentials: 'include',
      });
      if (!res.ok) {
        const body: { error?: string; detail?: string } = await res.json().catch(() => ({}));
        setError(body.detail || body.error || `HTTP ${res.status}`);
        return;
      }
      const body: { authorizeUrl?: string } = await res.json();
      if (!body.authorizeUrl) {
        setError('start response missing authorizeUrl');
        return;
      }
      window.location.href = body.authorizeUrl;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        maxWidth: 720,
        margin: '3rem auto',
        padding: '0 1rem',
        color: '#eee',
        fontFamily: 'system-ui, sans-serif',
        lineHeight: 1.55,
      }}
    >
      <h1 style={{ fontSize: '1.4rem', marginBottom: '0.25rem' }}>TikTok reporting authorization</h1>
      <p style={{ color: '#b7bcc4' }}>
        Read-only OAuth for TikTok Marketing API reporting. Sign in with an admin account, then start the
        flow.
      </p>

      {loading ? (
        <p>Loading…</p>
      ) : !user ? (
        <>
          <p>You need to sign in first.</p>
          <button
            type="button"
            onClick={() => void signInWithGoogle()}
            style={buttonStyle}
          >
            Sign in with Google
          </button>
        </>
      ) : !admin ? (
        <p style={{ color: '#ff9b9b' }}>
          Signed in as <code>{email}</code>, which is not on the admin allow-list. Sign out and sign in
          with an admin account.
        </p>
      ) : (
        <>
          <p>
            Signed in as <code>{email}</code>. Clicking below opens TikTok&apos;s consent screen for the
            read-only scopes (Reporting + read access to the ad account&apos;s metadata).
          </p>
          <button
            type="button"
            onClick={() => void startOAuth()}
            disabled={busy}
            style={{ ...buttonStyle, opacity: busy ? 0.6 : 1, cursor: busy ? 'wait' : 'pointer' }}
          >
            {busy ? 'Starting…' : 'Start TikTok authorization'}
          </button>
          {error ? <p style={{ color: '#ff9b9b', marginTop: '1rem' }}>Error: {error}</p> : null}
        </>
      )}

      <h2 style={{ fontSize: '1.05rem', color: '#9fd5ff', marginTop: '2rem' }}>What happens next</h2>
      <ol>
        <li>TikTok asks you to approve the scopes.</li>
        <li>
          TikTok bounces to <code>/api/tiktok/oauth/callback</code>. That page shows the access token,
          the advertiser ids you authorized, and the scopes TikTok granted.
        </li>
        <li>Copy the token into Vercel (<code>TIKTOK_ACCESS_TOKEN</code>, Encrypted, Production).</li>
        <li>
          Pick the right advertiser id and paste it into <code>TIKTOK_ADVERTISER_ID</code> (Plain Text,
          Production).
        </li>
      </ol>
    </main>
  );
}

const buttonStyle: React.CSSProperties = {
  background: '#2b64ff',
  color: 'white',
  border: 0,
  padding: '0.6rem 1rem',
  borderRadius: 6,
  font: 'inherit',
  cursor: 'pointer',
};
