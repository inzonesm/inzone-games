'use client';

/* Payouts — studio-wide earnings view. Ported from the portal's Payouts.jsx.
 * There's no payouts backend yet, so the pending balance and history reflect
 * the real (empty) state, the game filter is built from the developer's actual
 * games, and a banner makes clear that automated payout processing isn't live.
 * The Stripe/tax setup cards are illustrative of the planned flow. */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Shell } from '@/components/Shell';
import { fetchDeveloperGames } from '@/lib/games';
import { fetchPayoutHistory, type PayoutRecord, type PayoutStatus } from '@/lib/payouts';
import type { DeveloperGame } from '@/lib/types';

const payStyles: Record<string, CSSProperties> = {
  heroCard: { background: 'linear-gradient(160deg, oklch(0.30 0.08 235 / 0.55), oklch(0.18 0.04 250 / 0.55))', borderColor: 'oklch(0.78 0.12 232 / 0.30)', padding: '32px 36px' },
  heroGrid: { display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 36, alignItems: 'center' },
  heroBig: { fontSize: 'clamp(56px, 8vw, 88px)', fontWeight: 400, letterSpacing: '-0.04em', lineHeight: 0.95, fontFeatureSettings: "'tnum'" },
  ring: { position: 'relative', width: 180, height: 180 },
  iconBox: { width: 40, height: 40, borderRadius: 10, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', flexShrink: 0 },
  table: { display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr 1fr 0.9fr 0.7fr 80px', fontSize: 13 },
  th: { padding: '14px 20px', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--line-soft)', fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 500, background: 'oklch(0.18 0.02 245 / 0.3)' },
  td: { padding: '14px 20px', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--line-soft)' },
};

function Badge({ status }: { status: PayoutStatus }) {
  const styles: Record<PayoutStatus, CSSProperties> = {
    paid: { color: 'var(--pos)', background: 'oklch(0.78 0.14 155 / 0.15)', border: '1px solid oklch(0.78 0.14 155 / 0.25)' },
    pending: { color: 'var(--warm)', background: 'oklch(0.78 0.14 75 / 0.15)', border: '1px solid oklch(0.78 0.14 75 / 0.25)' },
    processing: { color: 'var(--blue-1)', background: 'oklch(0.72 0.13 235 / 0.15)', border: '1px solid oklch(0.72 0.13 235 / 0.25)' },
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

export default function PayoutsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [games, setGames] = useState<DeveloperGame[]>([]);
  const [payouts, setPayouts] = useState<PayoutRecord[]>([]);
  const [filter, setFilter] = useState('All games');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  const load = useCallback(async () => {
    if (!user?.uid) return;
    setLoading(true);
    const [list, history] = await Promise.all([
      fetchDeveloperGames(user.uid),
      fetchPayoutHistory(),
    ]);
    setGames(list);
    setPayouts(history);
    setLoading(false);
  }, [user?.uid]);

  useEffect(() => { void load(); }, [load]);

  const pending = payouts.find((p) => p.status === 'pending');
  const pendingNet = pending?.net || 0;
  const threshold = 50;
  const ringPct = Math.min(100, (pendingNet / threshold) * 100);
  const circumference = 264; // 2·π·42 ≈ 263.9
  const arcLength = (ringPct / 100) * circumference;
  const gameFilters = ['All games', ...games.map((g) => g.name || g.id)];

  return (
    <Shell>
      <main className="stage narrow" style={{ paddingTop: 32, paddingBottom: 80 }}>
        <div className="page-head">
          <div>
            <div className="sub">Studio · all games</div>
            <h1>Payouts</h1>
          </div>
        </div>

        {/* Honest banner — payout processing isn't live yet */}
        <div className="api-note" style={{ marginTop: 0 }}>
          <b>Heads up →</b>
          <span style={{ color: 'var(--ink-4)' }}>Automated payouts aren&apos;t live yet. Your earnings accrue on the Dashboard; this page previews the payout flow.</span>
        </div>

        {/* Hero */}
        <article className="card" style={payStyles.heroCard}>
          <div style={payStyles.heroGrid} className="hero-responsive">
            <div>
              <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'oklch(0.85 0.08 232)', marginBottom: 10 }}>
                Pending balance · ready for next payout
              </div>
              <div style={payStyles.heroBig}>
                <span style={{ fontSize: 36, color: 'var(--ink-3)', marginRight: 4, fontWeight: 300, verticalAlign: '0.2em' }}>$</span>
                {pending ? pendingNet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
              </div>
              <div style={{ marginTop: 10, fontFamily: "'Geist Mono', monospace", fontSize: 12.5, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>
                90% of {pending ? fmt$(pending.gross) : '—'} gross · across {games.length} game{games.length !== 1 ? 's' : ''}
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
                Payouts · <b style={{ color: 'var(--ink)' }}>monthly, 1st</b>
              </div>
            </div>
          </div>
        </article>

        {/* Setup cards (illustrative of the planned flow) */}
        <section className="grid-2">
          <article className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
              <div style={{ ...payStyles.iconBox, color: 'var(--blue-1)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /><path d="M7 15h2" /></svg>
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: '-0.015em' }}>Payout method</div>
                <div style={{ marginTop: 3, fontFamily: "'Geist Mono', monospace", fontSize: 11, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>Stripe Connect · monthly · 1st</div>
              </div>
              <span style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 999, fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'var(--bg-3)', color: 'var(--ink-3)', border: '1px solid var(--line)' }}>Not set up</span>
            </div>
            <p style={{ margin: '0 0 14px', color: 'var(--ink-2)', fontSize: 13.5, lineHeight: 1.5 }}>Connect a Stripe account to receive the 90% developer share each month.</p>
            <Link href="/settings" className="btn-ghost" style={{ height: 36, fontSize: 13 }}>Set up in Settings</Link>
          </article>

          <article className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
              <div style={{ ...payStyles.iconBox, color: 'var(--warm)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" /></svg>
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: '-0.015em' }}>Tax forms</div>
                <div style={{ marginTop: 3, fontFamily: "'Geist Mono', monospace", fontSize: 11, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>W-9 (US) or W-8BEN (non-US)</div>
              </div>
              <span style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 999, fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'var(--bg-3)', color: 'var(--ink-3)', border: '1px solid var(--line)' }}>Pending</span>
            </div>
            <p style={{ margin: '0 0 14px', color: 'var(--ink-2)', fontSize: 13.5, lineHeight: 1.5 }}>A current tax form is required before your first payout clears. Takes about 3 minutes.</p>
            <button className="btn-ghost" type="button" disabled style={{ height: 36, fontSize: 13, opacity: 0.6 }}>Available at payout setup</button>
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
              {gameFilters.map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  style={{ height: 30, padding: '0 12px', borderRadius: 999, background: filter === f ? 'var(--bg-3)' : 'transparent', border: `1px solid ${filter === f ? 'var(--line-strong)' : 'var(--line)'}`, color: filter === f ? 'var(--ink)' : 'var(--ink-3)', fontFamily: "'Geist Mono', monospace", fontSize: 11, letterSpacing: '0.04em', cursor: 'pointer' }}
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
          ) : payouts.length === 0 ? (
            <div className="empty" style={{ padding: '48px 24px' }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}>💸</div>
              <h2 style={{ fontSize: 18 }}>No payouts yet</h2>
              <p>Once payout processing is live and your balance clears the ${threshold} minimum, your monthly statements will appear here.</p>
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
                <div style={payStyles.th} />
                {payouts.map((p, i) => {
                  const last = i === payouts.length - 1;
                  const b = last ? 0 : '1px solid var(--line-soft)';
                  return (
                    <div key={p.period} style={{ display: 'contents' }}>
                      <div style={{ ...payStyles.td, color: 'var(--ink)', borderBottom: b }}>{p.period}</div>
                      <div style={{ ...payStyles.td, fontFamily: "'Geist Mono', monospace", fontFeatureSettings: "'tnum'", borderBottom: b }}>{fmt$(p.gross)}</div>
                      <div style={{ ...payStyles.td, fontFamily: "'Geist Mono', monospace", color: 'var(--ink-3)', fontFeatureSettings: "'tnum'", borderBottom: b }}>−{fmt$(p.fee)}</div>
                      <div style={{ ...payStyles.td, fontFamily: "'Geist Mono', monospace", color: 'var(--ink)', fontFeatureSettings: "'tnum'", borderBottom: b }}>{fmt$(p.net)}</div>
                      <div style={{ ...payStyles.td, color: 'var(--ink-3)', fontFamily: "'Geist Mono', monospace", fontSize: 12, letterSpacing: '0.04em', borderBottom: b }}>{p.paid || '—'}</div>
                      <div style={{ ...payStyles.td, borderBottom: b }}><Badge status={p.status} /></div>
                      <div style={{ ...payStyles.td, borderBottom: b }}>
                        <span style={{ color: 'var(--ink-3)', fontFamily: "'Geist Mono', monospace", fontSize: 11, letterSpacing: '0.06em' }}>{p.status === 'paid' ? 'Receipt →' : 'Detail →'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <style>{`
          @media (max-width: 820px) {
            .hero-responsive { grid-template-columns: 1fr !important; gap: 24px !important; }
          }
        `}</style>
      </main>
    </Shell>
  );
}
