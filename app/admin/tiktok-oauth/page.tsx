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
        <li>Redeploy so the new variables reach the runtime, then run yesterday&apos;s report below.</li>
      </ol>

      {admin ? <ReportRunner /> : null}
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

/** Yesterday's read-only report, run server-side with the Vercel env vars.
 *  The access token never leaves the server; this renders only aggregate rows.
 *  Compare against Ads Manager with identical date range, timezone, currency
 *  and attribution settings. */
function ReportRunner() {
  const { user } = useAuth();
  const [level, setLevel] = useState<'campaign' | 'adgroup' | 'ad'>('campaign');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<TikTokReportView | null>(null);

  async function runReport() {
    if (!user) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/tiktok/report?level=${level}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.detail || body.error || `HTTP ${res.status}`);
        return;
      }
      setReport(body as TikTokReportView);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: '2.5rem', borderTop: '1px solid #333', paddingTop: '1.5rem' }}>
      <h2 style={{ fontSize: '1.05rem', color: '#9fd5ff' }}>Run yesterday&apos;s report</h2>
      <p style={{ color: '#b7bcc4' }}>
        Server-side, read-only. Verifies the token and advertiser id are live in this deploy.
      </p>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <label>
          Level:{' '}
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as 'campaign' | 'adgroup' | 'ad')}
            style={{ font: 'inherit', padding: '0.4rem' }}
          >
            <option value="campaign">Campaign</option>
            <option value="adgroup">Ad group</option>
            <option value="ad">Ad</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => void runReport()}
          disabled={busy}
          style={{ ...buttonStyle, opacity: busy ? 0.6 : 1, cursor: busy ? 'wait' : 'pointer' }}
        >
          {busy ? 'Running…' : "Run yesterday's report"}
        </button>
      </div>
      {error ? <p style={{ color: '#ff9b9b', marginTop: '1rem' }}>Error: {error}</p> : null}
      {report ? <ReportTable report={report} /> : null}
    </section>
  );
}

type TikTokReportView = {
  requested: { startDate: string; endDate: string; level: string };
  timezone: string | null;
  currency: string | null;
  attributionWindow: string | null;
  rows: { id: string; name?: string; metrics: Record<string, string> }[];
  pageInfo: { page: number; pageSize: number; totalPages: number; totalCount: number };
};

function ReportTable({ report }: { report: TikTokReportView }) {
  return (
    <div style={{ marginTop: '1rem' }}>
      <p style={{ color: '#b7bcc4' }}>
        {report.requested.startDate} → {report.requested.endDate} · timezone{' '}
        <code>{report.timezone ?? 'unknown'}</code> · currency{' '}
        <code>{report.currency ?? 'unknown'}</code> · attribution{' '}
        <code>{report.attributionWindow ?? 'unknown'}</code> · {report.pageInfo.totalCount} row(s)
      </p>
      {report.rows.length === 0 ? (
        <p style={{ color: '#ffcf7a' }}>
          No rows returned. Check that the advertiser id in Vercel matches the account actually
          running campaigns, and that yesterday had delivery in this account&apos;s timezone.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #444' }}>
                <th style={{ padding: '0.4rem' }}>Name</th>
                <th style={{ padding: '0.4rem' }}>Spend</th>
                <th style={{ padding: '0.4rem' }}>Impr.</th>
                <th style={{ padding: '0.4rem' }}>Clicks</th>
                <th style={{ padding: '0.4rem' }}>Conversions</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.id} style={{ borderBottom: '1px solid #2a2a2a' }}>
                  <td style={{ padding: '0.4rem' }}>{row.name ?? row.id}</td>
                  <td style={{ padding: '0.4rem' }}>{row.metrics.spend ?? '—'}</td>
                  <td style={{ padding: '0.4rem' }}>{row.metrics.impressions ?? '—'}</td>
                  <td style={{ padding: '0.4rem' }}>{row.metrics.clicks ?? '—'}</td>
                  <td style={{ padding: '0.4rem' }}>{row.metrics.conversions ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
