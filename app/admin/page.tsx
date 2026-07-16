'use client';

/* Admin — the influencer-hub's admin dashboard (AdminApplicationsComponent)
 * ported to the house style: influencer application review (Accept/Reject),
 * the three view tabs (Pending / Authenticated / Accepted-not-signed-up),
 * Export to CSV, and the Mailchimp sync with its result summary. Only the
 * admin allow-list (lib/admin-shared — hub emails + jshim777@terpmail.umd.edu)
 * sees this page; /api/admin re-verifies every request server-side. */

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Shell } from '@/components/Shell';
import {
  exportInfluencersCsv,
  fetchApplications,
  isAdminEmail,
  reviewApplication,
  syncMailchimp,
  type AdminApplication,
  type AdminView,
  type MailchimpSyncResult,
} from '@/lib/admin';

const mono: CSSProperties = { fontFamily: "'Geist Mono', monospace" };

const VIEWS: Array<{ id: AdminView; label: string; empty: string }> = [
  { id: 'pending', label: 'Pending', empty: 'No pending applications found.' },
  { id: 'authenticated', label: 'Authenticated', empty: 'No authenticated influencers found.' },
  { id: 'accepted-not-signed-up', label: 'Accepted · not signed up', empty: 'No accepted but not signed up applications found.' },
];

function SocialLine({ app }: { app: AdminApplication }) {
  const items = [
    ['IG', app.instagram],
    ['X', app.twitter],
    ['TT', app.tiktok],
    ['TW', app.twitch],
  ].filter(([, v]) => v);
  if (items.length === 0) return null;
  return (
    <div style={{ ...mono, fontSize: 11, color: 'var(--ink-3)', letterSpacing: '0.04em', marginTop: 4 }}>
      {items.map(([k, v]) => `${k} ${v}`).join(' · ')}
    </div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [view, setView] = useState<AdminView>('pending');
  const [apps, setApps] = useState<AdminApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [syncResult, setSyncResult] = useState<MailchimpSyncResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const admin = isAdminEmail(user?.email);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login?next=/admin');
  }, [authLoading, user, router]);

  const load = useCallback(async () => {
    if (!user || !admin) return;
    setLoading(true);
    setError(null);
    try {
      setApps(await fetchApplications(view));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load applications.');
    } finally {
      setLoading(false);
    }
  }, [user, admin, view]);

  useEffect(() => { void load(); }, [load]);

  const review = async (email: string, status: 'accepted' | 'rejected') => {
    setReviewing(`${email}:${status}`);
    setNotice(null);
    try {
      await reviewApplication(email, status);
      setNotice(`Application ${status}: ${email}`);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Review failed.');
    } finally {
      setReviewing(null);
    }
  };

  const runSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    setNotice(null);
    try {
      setSyncResult(await syncMailchimp());
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Mailchimp sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const runExport = async () => {
    setExporting(true);
    setNotice(null);
    try {
      await exportInfluencersCsv();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  if (!authLoading && user && !admin) {
    return (
      <Shell>
        <main className="stage narrow" style={{ paddingTop: 32 }}>
          <div className="empty">
            <div style={{ fontSize: 36, marginBottom: 8 }}>🔒</div>
            <h2>Admin access only</h2>
            <p>This account ({user.email}) isn&apos;t on the admin list.</p>
          </div>
        </main>
      </Shell>
    );
  }

  return (
    <Shell>
      <main className="stage narrow" style={{ paddingTop: 32, paddingBottom: 80 }}>
        <div className="page-head">
          <div>
            <div className="sub">Admin · influencer program</div>
            <h1>Applications</h1>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-ghost" style={{ height: 36, fontSize: 13 }} onClick={() => void runExport()} disabled={exporting} type="button">
              {exporting ? 'Exporting…' : 'Export to CSV'}
            </button>
            <button className="btn-primary" style={{ height: 36, fontSize: 13 }} onClick={() => void runSync()} disabled={syncing} type="button">
              {syncing ? 'Syncing…' : 'Sync with Mailchimp'}
            </button>
          </div>
        </div>

        {notice && (
          <div className="api-note" style={{ marginTop: 0 }}>
            <b>→</b>
            <span style={{ color: 'var(--ink-3)' }}>{notice}</span>
          </div>
        )}

        {/* Mailchimp sync result (hub's summary panel) */}
        {syncResult && (
          <article className="card" style={{ borderColor: syncResult.success ? 'oklch(0.78 0.14 155 / 0.3)' : 'oklch(0.78 0.14 75 / 0.3)' }}>
            <div className="card-head">
              <span className="card-label">Mailchimp sync {syncResult.success ? 'successful' : 'completed with errors'}</span>
              <span className="card-meta">Accepted Ambassador / Not Accepted influencer tags</span>
            </div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', ...mono, fontSize: 12.5 }}>
              <span>Total · <b>{syncResult.total}</b></span>
              <span style={{ color: 'var(--pos)' }}>Synced · <b>{syncResult.synced}</b></span>
              {syncResult.failed > 0 && <span style={{ color: 'var(--neg)' }}>Failed · <b>{syncResult.failed}</b></span>}
            </div>
            {syncResult.errors.length > 0 && (
              <div style={{ marginTop: 10 }}>
                {syncResult.errors.slice(0, 3).map((e, i) => (
                  <div key={i} style={{ ...mono, fontSize: 11, color: 'var(--neg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.email}: {e.error}
                  </div>
                ))}
                {syncResult.errors.length > 3 && (
                  <div style={{ ...mono, fontSize: 11, color: 'var(--ink-4)' }}>…and {syncResult.errors.length - 3} more errors</div>
                )}
              </div>
            )}
          </article>
        )}

        {/* View tabs (hub's three list modes) */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              style={{ height: 32, padding: '0 14px', borderRadius: 999, background: view === v.id ? 'var(--bg-3)' : 'transparent', border: `1px solid ${view === v.id ? 'var(--line-strong)' : 'var(--line)'}`, color: view === v.id ? 'var(--ink)' : 'var(--ink-3)', ...mono, fontSize: 11, letterSpacing: '0.04em', cursor: 'pointer' }}
              type="button"
            >{v.label}</button>
          ))}
        </div>

        {/* Applications list */}
        <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 32 }}>
              <div className="skeleton" style={{ height: 16, marginBottom: 12 }} />
              <div className="skeleton" style={{ height: 16, marginBottom: 12 }} />
              <div className="skeleton" style={{ height: 16 }} />
            </div>
          ) : error ? (
            <div className="empty" style={{ padding: '40px 24px' }}>
              <h2 style={{ fontSize: 17 }}>Couldn&apos;t load applications</h2>
              <p>{error}</p>
              <button className="btn-primary" onClick={() => void load()} type="button">Retry</button>
            </div>
          ) : apps.length === 0 ? (
            <div className="empty" style={{ padding: '40px 24px' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
              <h2 style={{ fontSize: 17 }}>{VIEWS.find((v) => v.id === view)?.empty}</h2>
            </div>
          ) : (
            <div>
              {apps.map((app, i) => (
                <div key={app.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '16px 24px', borderBottom: i === apps.length - 1 ? 'none' : '1px solid var(--line-soft)', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 500 }}>
                      {app.name || app.username || 'Unnamed'}{' '}
                      <span style={{ ...mono, fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400 }}>({app.email})</span>
                    </div>
                    <div style={{ ...mono, fontSize: 11, color: 'var(--ink-3)', letterSpacing: '0.04em', marginTop: 4 }}>
                      Followers · {app.followers || 'N/A'}
                    </div>
                    <SocialLine app={app} />
                    {app.why && (
                      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.5 }}>
                        Why: {app.why}
                      </div>
                    )}
                    {view === 'authenticated' && (
                      <div style={{ ...mono, fontSize: 10.5, color: 'var(--pos)', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 6 }}>Authenticated</div>
                    )}
                    {view === 'accepted-not-signed-up' && (
                      <div style={{ ...mono, fontSize: 10.5, color: 'var(--warm)', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 6 }}>Accepted · not signed up</div>
                    )}
                  </div>
                  {view === 'pending' && app.email && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn-primary"
                        style={{ height: 32, fontSize: 12.5, padding: '0 14px' }}
                        onClick={() => void review(app.email as string, 'accepted')}
                        disabled={reviewing !== null}
                        type="button"
                      >{reviewing === `${app.email}:accepted` ? '…' : 'Accept'}</button>
                      <button
                        className="btn-ghost"
                        style={{ height: 32, fontSize: 12.5, padding: '0 14px', color: 'var(--neg)' }}
                        onClick={() => void review(app.email as string, 'rejected')}
                        disabled={reviewing !== null}
                        type="button"
                      >{reviewing === `${app.email}:rejected` ? '…' : 'Reject'}</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </Shell>
  );
}
