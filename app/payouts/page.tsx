'use client';

/* Payouts — unified studio + creator earnings view.
 *
 * One payout history table covers BOTH sides of the platform (game-developer
 * payouts and creator-program commissions) with a Creators filter tab ahead
 * of the game titles. Automated payouts are live via /api/payouts (port of
 * the hub's payout_scheduler.py — 15th monthly, 30-day holdback, bank→Stripe
 * / paypal+venmo→PayPal at the provider seam).
 *
 * Loading is PROGRESSIVE: each section (games, history, API status) fetches
 * independently and renders as it lands, and the next payout date is
 * computed locally (it's deterministic) so the schedule card never waits on
 * the network. The payment-method widget is the shared PaymentMethodCard,
 * also used by Settings. */

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { Shell } from '@/components/Shell';
import { PaymentMethodCard } from '@/components/PaymentMethodCard';
import { fetchDeveloperGames } from '@/lib/games';
import {
  cancelScheduledPayout,
  computeNextPayoutDate,
  fetchPayoutHistory,
  fetchPayoutStatus,
  processPayoutNow,
  schedulePayout,
  type PayoutApiStatus,
  type PayoutRecord,
  type PayoutStatus,
} from '@/lib/payouts';
import { resolveCandidateIds } from '@/lib/creators';
import type { DeveloperGame } from '@/lib/types';

const mono: CSSProperties = { fontFamily: "'Geist Mono', monospace" };

const payStyles: Record<string, CSSProperties> = {
  heroCard: { background: 'linear-gradient(160deg, oklch(0.30 0.08 235 / 0.55), oklch(0.18 0.04 250 / 0.55))', borderColor: 'oklch(0.78 0.12 232 / 0.30)', padding: '32px 36px' },
  heroGrid: { display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 36, alignItems: 'center' },
  heroBig: { fontSize: 'clamp(56px, 8vw, 88px)', fontWeight: 400, letterSpacing: '-0.04em', lineHeight: 0.95, fontFeatureSettings: "'tnum'" },
  ring: { position: 'relative', width: 180, height: 180 },
  iconBox: { width: 40, height: 40, borderRadius: 10, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', flexShrink: 0 },
  table: { display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr 1fr 0.8fr 80px', fontSize: 13 },
  th: { padding: '14px 20px', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--line-soft)', fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 500, background: 'oklch(0.18 0.02 245 / 0.3)' },
  td: { padding: '14px 20px', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--line-soft)' },
};

function Badge({ status }: { status: PayoutStatus }) {
  const styles: Record<PayoutStatus, CSSProperties> = {
    paid: { color: 'var(--pos)', background: 'oklch(0.78 0.14 155 / 0.15)', border: '1px solid oklch(0.78 0.14 155 / 0.25)' },
    pending: { color: 'var(--warm)', background: 'oklch(0.78 0.14 75 / 0.15)', border: '1px solid oklch(0.78 0.14 75 / 0.25)' },
    processing: { color: 'var(--blue-1)', background: 'oklch(0.72 0.13 235 / 0.15)', border: '1px solid oklch(0.72 0.13 235 / 0.25)' },
    failed: { color: 'var(--neg)', background: 'oklch(0.72 0.16 25 / 0.15)', border: '1px solid oklch(0.72 0.16 25 / 0.25)' },
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', ...styles[status] }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', boxShadow: '0 0 6px currentColor' }} />
      {status}
    </span>
  );
}

function fmt$(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ── Payout schedule card (port of the hub's PayoutScheduler) ─────────── */
function PayoutScheduleCard({
  status,
  statusLoading,
  onChanged,
}: {
  status: PayoutApiStatus | null;
  statusLoading: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Deterministic — rendered instantly, no network round-trip. Payout dates
  // are UTC-midnight-of-the-15th markers, so format in UTC or the local
  // timezone renders them as the 14th.
  const nextDate = (status?.nextPayoutDate ? new Date(status.nextPayoutDate) : computeNextPayoutDate())
    .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const scheduled = status?.scheduled ?? [];
  const hasScheduled = scheduled.some((p) => p.status === 'scheduled');
  const available = status?.pendingTotal ?? 0;
  const minimum = status?.minimumPayout ?? 50;

  const act = async (kind: 'schedule' | 'process' | `cancel:${string}`) => {
    setBusy(kind);
    setMessage(null);
    let ok = false;
    let error: string | undefined;
    if (kind === 'schedule') ({ success: ok, error } = await schedulePayout());
    else if (kind === 'process') ({ success: ok, error } = await processPayoutNow());
    else ok = await cancelScheduledPayout(kind.slice(7));
    setBusy(null);
    const nice: Record<string, string> = {
      NO_PAYMENT_METHOD: 'Add a payout method first.',
      NOTHING_TO_PAY: 'No funds available for payout yet.',
      BELOW_MINIMUM: `Balance is below the ${fmt$(minimum)} minimum.`,
      ALREADY_SCHEDULED: 'You already have a scheduled payout.',
    };
    setMessage(ok
      ? { kind: 'ok', text: kind === 'process' ? 'Payout processed — transfer initiated.' : kind === 'schedule' ? 'Payout scheduled.' : 'Scheduled payout cancelled.' }
      : { kind: 'err', text: (error && nice[error]) || 'Something went wrong — try again.' });
    if (ok) onChanged();
  };

  return (
    <article className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        <div style={{ ...payStyles.iconBox, color: 'var(--warm)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></svg>
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: '-0.015em' }}>Payout schedule</div>
          <div style={{ marginTop: 3, ...mono, fontSize: 11, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>
            next run · {nextDate}
          </div>
        </div>
        <span style={{ marginLeft: 'auto', ...mono, fontSize: 11, color: 'var(--ink-2)', letterSpacing: '0.04em' }}>
          available · <b style={{ color: 'var(--ink)' }}>{statusLoading ? '…' : fmt$(available)}</b>
        </span>
      </div>

      <p style={{ margin: '0 0 12px', color: 'var(--ink-2)', fontSize: 13.5, lineHeight: 1.5 }}>
        Payouts process on the 15th of each month for the previous month&apos;s developer and creator earnings, with a 30-day
        holdback for verification.
      </p>

      {scheduled.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {scheduled.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line-soft)' }}>
              <span style={{ ...mono, fontSize: 11.5, color: 'var(--ink-2)', flex: 1 }}>
                {new Date(p.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} · {fmt$(p.amount)}
              </span>
              <span style={{ ...mono, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: p.status === 'scheduled' ? 'var(--blue-1)' : 'var(--warm)' }}>{p.status}</span>
              {p.status === 'scheduled' && (
                <button
                  className="btn-ghost"
                  style={{ height: 26, fontSize: 11, padding: '0 10px', color: 'var(--neg)' }}
                  onClick={() => void act(`cancel:${p.id}`)}
                  disabled={busy !== null}
                  type="button"
                >{busy === `cancel:${p.id}` ? '…' : 'Cancel'}</button>
              )}
            </div>
          ))}
        </div>
      )}

      {message && (
        <div style={{ ...mono, fontSize: 11, color: message.kind === 'ok' ? 'var(--pos)' : 'var(--neg)', marginBottom: 10 }}>
          {message.text}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          className="btn-primary"
          style={{ height: 36, fontSize: 13 }}
          onClick={() => void act('schedule')}
          disabled={busy !== null || statusLoading || hasScheduled || available <= 0 || !status?.paymentMethod}
          type="button"
        >{busy === 'schedule' ? 'Scheduling…' : 'Schedule next payout'}</button>
        <button
          className="btn-ghost"
          style={{ height: 36, fontSize: 13 }}
          onClick={() => void act('process')}
          disabled={busy !== null || statusLoading || available < minimum || !status?.paymentMethod}
          type="button"
        >{busy === 'process' ? 'Processing…' : 'Run payout now'}</button>
      </div>
    </article>
  );
}

/* ── Page ──────────────────────────────────────────────────────────── */
export default function PayoutsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [games, setGames] = useState<DeveloperGame[]>([]);
  const [payouts, setPayouts] = useState<PayoutRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [apiStatus, setApiStatus] = useState<PayoutApiStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [filter, setFilter] = useState('All');

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  // Each section loads independently so nothing blocks anything else.
  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    fetchDeveloperGames(user.uid).then((list) => { if (!cancelled) setGames(list); }).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.uid]);

  const loadHistory = useCallback(async () => {
    if (!user?.uid) return;
    setHistoryLoading(true);
    const ids = await resolveCandidateIds(user.uid, user.email ?? null).catch(() => [user.uid]);
    const rows = await fetchPayoutHistory(ids).catch(() => [] as PayoutRecord[]);
    setPayouts(rows);
    setHistoryLoading(false);
  }, [user?.uid, user?.email]);

  const loadStatus = useCallback(async () => {
    if (!user?.uid) return;
    setStatusLoading(true);
    const status = await fetchPayoutStatus();
    setApiStatus(status);
    setStatusLoading(false);
  }, [user?.uid]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);
  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const refreshAfterAction = useCallback(() => {
    void loadStatus();
    void loadHistory();
  }, [loadStatus, loadHistory]);

  const pendingTotal = apiStatus?.pendingTotal ?? 0;
  const pendingDeveloper = apiStatus?.pendingDeveloper ?? 0;
  const pendingCreator = apiStatus?.pendingCreator ?? 0;
  const threshold = apiStatus?.minimumPayout ?? 50;
  const ringPct = Math.min(100, (pendingTotal / threshold) * 100);
  const circumference = 264; // 2·π·42 ≈ 263.9

  // Unified filter row: Creators tab first, then the game titles.
  const filters = ['All', 'Creators', ...games.map((g) => g.name || g.id)];
  const visible = payouts.filter((p) => {
    if (filter === 'All') return true;
    if (filter === 'Creators') return p.source === 'creators';
    return p.source === 'games'; // per-game linkage arrives with per-game payout records
  });

  const arcLength = (ringPct / 100) * circumference;

  return (
    <Shell>
      <main className="stage narrow" style={{ paddingTop: 32, paddingBottom: 80 }}>
        <div className="page-head">
          <div>
            <div className="sub">Studio + creator program</div>
            <h1>Payouts</h1>
          </div>
        </div>

        {/* Hero */}
        <article className="card" style={payStyles.heroCard}>
          <div style={payStyles.heroGrid} className="hero-responsive">
            <div>
              <div style={{ ...mono, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'oklch(0.85 0.08 232)', marginBottom: 10 }}>
                Pending balance · developer + creator earnings
              </div>
              <div style={payStyles.heroBig}>
                <span style={{ fontSize: 36, color: 'var(--ink-3)', marginRight: 4, fontWeight: 300, verticalAlign: '0.2em' }}>$</span>
                {statusLoading ? '—' : pendingTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div style={{ marginTop: 10, ...mono, fontSize: 12.5, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>
                {statusLoading
                  ? 'calculating…'
                  : `${fmt$(pendingDeveloper)} from ${games.length} game${games.length !== 1 ? 's' : ''} · ${fmt$(pendingCreator)} from the creator program`}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
              <div style={payStyles.ring}>
                <svg viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)', width: '100%', height: '100%' }}>
                  <circle fill="none" stroke="oklch(0.30 0.04 245 / 0.5)" strokeWidth="10" cx="50" cy="50" r="42" />
                  <circle fill="none" stroke="var(--blue-1)" strokeWidth="10" strokeLinecap="round" cx="50" cy="50" r="42" pathLength={circumference} strokeDasharray={`${arcLength} ${circumference}`} />
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
                  <div>
                    <div style={{ ...mono, fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Threshold</div>
                    <div style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.022em', marginTop: 6, fontFeatureSettings: "'tnum'" }}>
                      <span style={{ fontSize: 16, color: 'var(--ink-3)', marginRight: 2 }}>$</span>{threshold}
                      <span style={{ color: 'var(--ink-3)', fontSize: 18, fontWeight: 300 }}> min</span>
                    </div>
                    <div style={{ ...mono, fontSize: 10.5, color: 'var(--ink-3)', marginTop: 4, letterSpacing: '0.04em' }}>
                      {statusLoading ? '…' : ringPct >= 100 ? 'cleared' : `${ringPct.toFixed(0)}%`}
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ ...mono, fontSize: 11, letterSpacing: '0.06em', color: 'var(--ink-3)' }}>
                Payouts · <b style={{ color: 'var(--ink)' }}>monthly, 15th</b>
              </div>
            </div>
          </div>
        </article>

        {/* Automated payouts: method + schedule */}
        <section className="grid-2">
          {user?.uid ? <PaymentMethodCard uid={user.uid} onSaved={() => void loadStatus()} /> : <div className="card" />}
          <PayoutScheduleCard status={apiStatus} statusLoading={statusLoading} onChanged={refreshAfterAction} />
        </section>

        {/* Unified history — developer + creator payouts in one table */}
        <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '22px 24px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--line-soft)', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div className="card-label">Payout history</div>
              <div className="card-meta" style={{ marginTop: 6 }}>game + creator earnings · last 12 months</div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {filters.map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  style={{ height: 30, padding: '0 12px', borderRadius: 999, background: filter === f ? 'var(--bg-3)' : 'transparent', border: `1px solid ${filter === f ? 'var(--line-strong)' : 'var(--line)'}`, color: filter === f ? 'var(--ink)' : 'var(--ink-3)', ...mono, fontSize: 11, letterSpacing: '0.04em', cursor: 'pointer' }}
                >{f}</button>
              ))}
            </div>
          </div>

          {historyLoading ? (
            <div style={{ padding: 40 }}>
              <div className="skeleton" style={{ height: 16, marginBottom: 12 }} />
              <div className="skeleton" style={{ height: 16, marginBottom: 12 }} />
              <div className="skeleton" style={{ height: 16 }} />
            </div>
          ) : visible.length === 0 ? (
            <div className="empty" style={{ padding: '48px 24px' }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}>💸</div>
              <h2 style={{ fontSize: 18 }}>No payouts yet</h2>
              <p>
                Once your combined balance clears the ${threshold} minimum, monthly statements for both your games and
                creator commissions will appear here.
              </p>
            </div>
          ) : (
            <div className="table-responsive">
              <div style={payStyles.table}>
                <div style={payStyles.th}>Period</div>
                <div style={payStyles.th}>Source</div>
                <div style={payStyles.th}>Amount</div>
                <div style={payStyles.th}>Paid</div>
                <div style={payStyles.th}>Status</div>
                <div style={payStyles.th} />
                {visible.map((p, i) => {
                  const last = i === visible.length - 1;
                  const b = last ? 0 : '1px solid var(--line-soft)';
                  return (
                    <div key={p.id} style={{ display: 'contents' }}>
                      <div style={{ ...payStyles.td, color: 'var(--ink)', borderBottom: b }}>{p.period}</div>
                      <div style={{ ...payStyles.td, borderBottom: b }}>
                        <span style={{ ...mono, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: p.source === 'creators' ? 'var(--pink)' : 'var(--blue-1)' }}>
                          {p.source === 'creators' ? 'Creators' : 'Games'}
                        </span>
                      </div>
                      <div style={{ ...payStyles.td, ...mono, color: 'var(--ink)', fontFeatureSettings: "'tnum'", borderBottom: b }}>{fmt$(p.net)}</div>
                      <div style={{ ...payStyles.td, color: 'var(--ink-3)', ...mono, fontSize: 12, letterSpacing: '0.04em', borderBottom: b }}>{p.paid || '—'}</div>
                      <div style={{ ...payStyles.td, borderBottom: b }}><Badge status={p.status} /></div>
                      <div style={{ ...payStyles.td, borderBottom: b }}>
                        <span style={{ color: 'var(--ink-3)', ...mono, fontSize: 11, letterSpacing: '0.06em' }}>{p.status === 'paid' ? 'Receipt →' : 'Detail →'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <style
          dangerouslySetInnerHTML={{
            __html: `
              @media (max-width: 820px) {
                .hero-responsive { grid-template-columns: 1fr !important; gap: 24px !important; }
              }
            `,
          }}
        />
      </main>
    </Shell>
  );
}
