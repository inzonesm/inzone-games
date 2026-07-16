'use client';

/* Creators — the influencer-hub dashboard (referral link + stats, content
 * performance, earnings) ported into the Next.js app as /creators, rebuilt on
 * the NEW creator-economy model (July 2026 brief):
 *
 *   · earnings = 25% of the PLATFORM's net take on coin purchases made by
 *     referred users inside their 12-month attribution window
 *   · a signup creates a pending attribution only — no money moves until a
 *     referred user actually buys coins (no $10/signup, 30/ad, 5/post bounties
 *     — the hub's EventYieldBreakdown/retention-rate cards are deliberately
 *     NOT ported; the brief removes flat bounties from the earnings path)
 *   · every rate is config-driven (lib/creator-economy.ts); the simulator
 *     below runs the real split engine so the numbers match the ledger
 *
 * Carried over from the hub: the working referral link
 * (inzone.ai/download?ref=CODE — device-aware store redirect), link
 * click/conversion stats, quick-share buttons, referred-user stats, and the
 * content performance table. Data comes from lib/creators.ts. */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Shell } from '@/components/Shell';
import {
  computeSplit,
  type Channel,
  type EconomyConfig,
  type SpendContext,
} from '@/lib/creator-economy';
import {
  ensureCreatorDocs,
  fetchCreatorDashboard,
  type CommissionEntry,
  type ContentPost,
  type CreatorDashboardData,
} from '@/lib/creators';

/* ── Format helpers ────────────────────────────────────────────────── */
function fmt$(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtInt(n: number): string {
  return (n || 0).toLocaleString('en-US');
}
function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
/** Payouts run monthly on the 1st (see /payouts) — next payout date. */
function nextPayoutDate(): string {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return next.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const mono: CSSProperties = { fontFamily: "'Geist Mono', monospace" };

/* ── Referral link pill with copy ──────────────────────────────────── */
function ReferralLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <button className="pill" onClick={copy} title={link} type="button">
      <span className="dot" />
      <span>Referral Link</span>
      <span style={{ color: copied ? 'var(--pos)' : 'var(--ink-3)' }}>{copied ? '✓ copied' : 'copy'}</span>
    </button>
  );
}

/* ── Quick share (port of the hub's ReferralLinksSection buttons) ──── */
function ShareRow({ link }: { link: string }) {
  const [note, setNote] = useState<string | null>(null);
  const shareText = 'Check out InZone - the ultimate app for gamers! Join using my link:';

  const copyWithNote = async (msg: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setNote(msg);
      setTimeout(() => setNote(null), 2200);
    } catch { /* clipboard unavailable */ }
  };
  const share = (platform: 'x' | 'tiktok' | 'instagram' | 'twitch') => {
    if (platform === 'x') {
      window.open(
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(link)}`,
        '_blank',
        'noopener,noreferrer',
      );
      return;
    }
    const notes = {
      tiktok: 'copied — paste in your TikTok bio',
      instagram: 'copied — paste in your bio or story',
      twitch: 'copied — add to your Twitch panel',
    } as const;
    void copyWithNote(notes[platform]);
  };

  const btn: CSSProperties = { height: 28, padding: '0 12px', borderRadius: 999, background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink-3)', ...mono, fontSize: 10.5, letterSpacing: '0.06em', cursor: 'pointer' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 16 }}>
      <span style={{ ...mono, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', marginRight: 4 }}>Share</span>
      <button style={btn} type="button" onClick={() => share('x')}>X / Twitter</button>
      <button style={btn} type="button" onClick={() => share('tiktok')}>TikTok</button>
      <button style={btn} type="button" onClick={() => share('instagram')}>Instagram</button>
      <button style={btn} type="button" onClick={() => share('twitch')}>Twitch</button>
      {note ? <span style={{ ...mono, fontSize: 10.5, color: 'var(--pos)', letterSpacing: '0.04em' }}>✓ {note}</span> : null}
    </div>
  );
}

/* ── Stat card (port of the hub's StatsCard, house style) ──────────── */
function StatCard({ label, value, sub, subColor }: { label: string; value: string; sub: string; subColor?: string }) {
  return (
    <article className="card">
      <div className="card-label" style={{ marginBottom: 12 }}>{label}</div>
      <div className="stat">
        <span className="num">{value}</span>
        <span style={{ ...mono, fontSize: 11, letterSpacing: '0.05em', color: subColor || 'var(--ink-3)' }}>{sub}</span>
      </div>
    </article>
  );
}

/* ── Earnings simulator — runs the real split engine ───────────────── */
function EarningsSimulator({ config }: { config: EconomyConfig }) {
  const [gross, setGross] = useState(10);
  const [channel, setChannel] = useState<Channel>('ios');
  const [spend, setSpend] = useState<SpendContext>('in_game');

  const split = useMemo(
    () => computeSplit({ gross: gross || 0, channel, spend, referred: true }, config),
    [gross, channel, spend, config],
  );

  const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--line-soft)' };
  const lbl: CSSProperties = { ...mono, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)' };
  const val: CSSProperties = { ...mono, fontSize: 13, fontFeatureSettings: "'tnum'" };

  return (
    <article className="card tall">
      <div className="card-head">
        <span className="card-label">Earnings simulator</span>
        <span className="card-meta">config-driven · live rates</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
        <label className="field">
          <span className="field-label">Purchase $</span>
          <input
            className="input" type="number" min={0} step={1} value={gross}
            onChange={(e) => setGross(Math.max(0, Number(e.target.value)))}
            style={{ height: 36, fontSize: 13 }}
          />
        </label>
        <label className="field">
          <span className="field-label">Channel</span>
          <select className="select" value={channel} onChange={(e) => setChannel(e.target.value as Channel)} style={{ height: 36, fontSize: 13 }}>
            <option value="ios">iOS</option>
            <option value="android">Android</option>
            <option value="web">Web</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Spent on</span>
          <select className="select" value={spend} onChange={(e) => setSpend(e.target.value as SpendContext)} style={{ height: 36, fontSize: 13 }}>
            <option value="in_game">A dev&apos;s game</option>
            <option value="platform">Platform features</option>
          </select>
        </label>
      </div>

      <div>
        <div style={rowStyle}>
          <span style={lbl}>Gross purchase</span>
          <span style={val}>{fmt$(split.gross)}</span>
        </div>
        <div style={rowStyle}>
          <span style={lbl}>{channel === 'web' ? 'Payment processing' : 'App-store cut'} · {pct(1 - config.netFactors[channel])}</span>
          <span style={{ ...val, color: 'var(--neg)' }}>−{fmt$(split.storeFee)}</span>
        </div>
        <div style={rowStyle}>
          <span style={{ ...lbl, color: 'var(--ink-2)' }}>Net revenue</span>
          <span style={{ ...val, fontWeight: 600 }}>{fmt$(split.net)}</span>
        </div>
        <div style={rowStyle}>
          <span style={lbl}>Developer · {spend === 'in_game' ? `${pct(config.devShare)} of net` : 'no game leg'}</span>
          <span style={{ ...val, color: spend === 'in_game' ? 'var(--blue-1)' : 'var(--ink-4)' }}>
            {spend === 'in_game' ? fmt$(split.developer) : '—'}
          </span>
        </div>
        <div style={rowStyle}>
          <span style={lbl}>Platform take · {spend === 'in_game' ? pct(config.platformShareInGame) : '100%'} of net</span>
          <span style={val}>{fmt$(split.platformBase)}</span>
        </div>
        <div style={{ ...rowStyle, borderBottom: 'none', background: 'oklch(0.78 0.14 155 / 0.08)', margin: '4px -10px 0', padding: '11px 10px', borderRadius: 10 }}>
          <span style={{ ...lbl, color: 'var(--pos)' }}>Your commission · {pct(config.creatorCommission)} of platform take</span>
          <span style={{ ...val, color: 'var(--pos)', fontWeight: 600, fontSize: 15 }}>{fmt$(split.creator)}</span>
        </div>
      </div>

      <p style={{ margin: '12px 0 0', fontSize: 12, lineHeight: 1.55, color: 'var(--ink-3)' }}>
        Paid from the platform&apos;s share — the developer&apos;s {fmt$(split.developer)} is identical whether or not the buyer
        was referred. Applies to purchases made within {config.attributionWindowMonths} months of your referral&apos;s signup.
      </p>
    </article>
  );
}

/* ── Recent commissions feed ───────────────────────────────────────── */
function CommissionFeed({ entries, ledgerLive }: { entries: CommissionEntry[]; ledgerLive: boolean }) {
  return (
    <article className="card tall" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="card-head">
        <span className="card-label">Commission activity</span>
        <span className="card-meta">{ledgerLive ? 'immutable ledger' : 'estimated · ledger pending'}</span>
      </div>
      {entries.length === 0 ? (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: '32px 16px', textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 26, marginBottom: 8 }}>🪙</div>
            <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginBottom: 4 }}>No commissions yet</div>
            <div style={{ ...mono, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.04em', maxWidth: '32ch', lineHeight: 1.6 }}>
              You earn when a referred user buys coins — signups alone don&apos;t move money.
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {entries.map((e) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--line-soft)' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--pos)', boxShadow: '0 0 6px var(--pos)', flexShrink: 0 }} />
              <span style={{ ...mono, fontSize: 11.5, color: 'var(--ink-2)', flex: 1 }}>
                Referred purchase{e.channel ? ` · ${e.channel}` : ''}
              </span>
              <span style={{ ...mono, fontSize: 12.5, color: 'var(--pos)', fontFeatureSettings: "'tnum'" }}>+{fmt$(e.amount)}</span>
              <span style={{ ...mono, fontSize: 10.5, color: 'var(--ink-4)', width: 34, textAlign: 'right' }}>{e.ago}</span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

/* ── Content performance table (port of ContentPerformanceTable) ───── */
function ContentTable({ posts }: { posts: ContentPost[] }) {
  const th: CSSProperties = { ...mono, padding: '12px 20px', fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 500, borderBottom: '1px solid var(--line-soft)', background: 'oklch(0.18 0.02 245 / 0.3)', display: 'flex', alignItems: 'center' };
  const td: CSSProperties = { padding: '12px 20px', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--line-soft)', fontSize: 13 };
  return (
    <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--line-soft)' }}>
        <div className="card-label">Content performance</div>
        <div className="card-meta" style={{ marginTop: 6 }}>metrics only — content no longer earns bounties</div>
      </div>
      {posts.length === 0 ? (
        <div className="empty" style={{ padding: '36px 24px' }}>
          <div style={{ fontSize: 26, marginBottom: 8 }}>📝</div>
          <h2 style={{ fontSize: 16 }}>No posts yet</h2>
          <p>Your InZone posts and their views, likes, and comments will show up here.</p>
        </div>
      ) : (
        <div className="table-responsive">
          <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 0.8fr 0.8fr 0.9fr 0.6fr' }}>
            <div style={th}>Post</div>
            <div style={th}>Views</div>
            <div style={th}>Likes</div>
            <div style={th}>Comments</div>
            <div style={th}>Age</div>
            {posts.map((p, i) => {
              const last = i === posts.length - 1;
              const b = last ? 'none' : '1px solid var(--line-soft)';
              return (
                <div key={p.id} style={{ display: 'contents' }}>
                  <div style={{ ...td, color: 'var(--ink-2)', borderBottom: b, minWidth: 0 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                  </div>
                  <div style={{ ...td, ...mono, fontFeatureSettings: "'tnum'", borderBottom: b }}>{fmtInt(p.views)}</div>
                  <div style={{ ...td, ...mono, fontFeatureSettings: "'tnum'", borderBottom: b }}>{fmtInt(p.likes)}</div>
                  <div style={{ ...td, ...mono, fontFeatureSettings: "'tnum'", borderBottom: b }}>{fmtInt(p.comments)}</div>
                  <div style={{ ...td, ...mono, fontSize: 11, color: 'var(--ink-4)', borderBottom: b }}>{p.ago}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function CreatorsSkeleton() {
  return (
    <>
      <div className="skeleton" style={{ height: 170, borderRadius: 16 }} />
      <div className="grid-2">
        <div className="card"><div className="skeleton" style={{ height: 60 }} /></div>
        <div className="card"><div className="skeleton" style={{ height: 60 }} /></div>
        <div className="card"><div className="skeleton" style={{ height: 60 }} /></div>
        <div className="card"><div className="skeleton" style={{ height: 60 }} /></div>
      </div>
      <div className="grid-2">
        <div className="card"><div className="skeleton" style={{ height: 220 }} /></div>
        <div className="card"><div className="skeleton" style={{ height: 220 }} /></div>
      </div>
    </>
  );
}

/* ── Page ──────────────────────────────────────────────────────────── */
export default function CreatorsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [data, setData] = useState<CreatorDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Anonymous → account creation, same pattern as the upload portal; ?next
  // returns them here after signing up so their influencer doc gets created.
  useEffect(() => {
    if (!authLoading && !user) router.replace('/login?next=/creators');
  }, [authLoading, user, router]);

  const load = useCallback(async () => {
    if (!user?.uid) return;
    setLoading(true);
    setError(null);
    try {
      // Signed-in user entering the page (first time or returning): create
      // whichever of humanUsers/{uid} and influencers/{uid} is missing, with
      // the app/backend/hub field shapes. Fire-and-forget — AuthProvider
      // already provisions on sign-in, so the dashboard NEVER waits on it.
      void ensureCreatorDocs(user.uid, user.email ?? null, user.displayName ?? null, user.photoURL ?? null);
      setData(await fetchCreatorDashboard(user.uid, user.email ?? null, user.displayName ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load your creator dashboard.');
    } finally {
      setLoading(false);
    }
  }, [user?.uid, user?.email, user?.displayName, user?.photoURL]);

  useEffect(() => { void load(); }, [load]);

  const cfg = data?.config;
  const conversionRate =
    data && data.referrals.clicks > 0
      ? Math.round((data.referrals.conversions / data.referrals.clicks) * 100)
      : 0;

  return (
    <Shell>
      <main className="stage narrow" style={{ paddingTop: 32, paddingBottom: 80 }}>
        <div className="page-head">
          <div>
            <div className="sub">Creator program · revenue share</div>
            <h1>Creators</h1>
          </div>
          {data?.profile.referralLink ? <ReferralLink link={data.profile.referralLink} /> : null}
        </div>

        {/* The one principle that governs the whole build */}
        <div className="api-note" style={{ marginTop: 0 }}>
          <b>New model →</b>
          <span style={{ color: 'var(--ink-4)' }}>
            You earn a <code>{cfg ? pct(cfg.creatorCommission) : '25%'}</code> commission on the platform&apos;s net take when
            your referred users <b>buy coins</b>. Flat signup / ad / post bounties no longer create earnings — nothing is owed
            until a coin is actually spent.
          </span>
        </div>

        {loading || !data ? (
          <CreatorsSkeleton />
        ) : error ? (
          <div className="empty">
            <div style={{ fontSize: 36, marginBottom: 8 }}>⚠️</div>
            <h2>Couldn&apos;t load your creator dashboard</h2>
            <p>{error}</p>
            <button onClick={load} className="btn-primary" type="button">Retry</button>
          </div>
        ) : (
          <>
            {/* Hero — lifetime commission (derived from the ledger) */}
            <article
              className="card"
              style={{ background: 'linear-gradient(160deg, oklch(0.28 0.07 155 / 0.45), oklch(0.16 0.03 250 / 0.55))', borderColor: 'oklch(0.78 0.14 155 / 0.25)', padding: '30px 34px' }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', gap: 28, alignItems: 'end' }} className="creators-hero">
                <div>
                  <div style={{ ...mono, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'oklch(0.85 0.1 155)', marginBottom: 10 }}>
                    Lifetime commission · {data.earnings.ledgerLive ? 'from the ledger' : 'estimated'}
                  </div>
                  <div style={{ fontSize: 'clamp(44px, 6.5vw, 68px)', fontWeight: 400, letterSpacing: '-0.04em', lineHeight: 0.95, fontFeatureSettings: "'tnum'" }}>
                    <span style={{ fontSize: 30, color: 'var(--ink-3)', marginRight: 4, fontWeight: 300, verticalAlign: '0.2em' }}>$</span>
                    {data.earnings.lifetime.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div style={{ ...mono, marginTop: 10, fontSize: 12, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>
                    {pct(data.config.creatorCommission)} of platform net · referred coin purchases only
                  </div>
                  <ShareRow link={data.profile.referralLink} />
                </div>
                <div>
                  <div style={{ ...mono, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>Pending</div>
                  <div style={{ fontSize: 26, fontWeight: 500, fontFeatureSettings: "'tnum'" }}>{fmt$(data.earnings.pending)}</div>
                  <div style={{ ...mono, marginTop: 4, fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: '0.04em' }}>next payout · {nextPayoutDate()}</div>
                </div>
                <div>
                  <div style={{ ...mono, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>Paid out</div>
                  <div style={{ fontSize: 26, fontWeight: 500, fontFeatureSettings: "'tnum'", color: 'var(--ink-2)' }}>{fmt$(data.earnings.paid)}</div>
                  <div style={{ ...mono, marginTop: 4, fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: '0.04em' }}>code · {data.profile.referralCode}</div>
                </div>
              </div>
            </article>

            {/* Referral + link + content metrics (carried over from the hub) */}
            <div className="grid-2">
              <StatCard
                label="Referred users"
                value={fmtInt(data.referrals.total)}
                sub={`${fmtInt(data.referrals.inWindow)} inside the ${data.config.attributionWindowMonths}-mo window`}
                subColor="var(--pos)"
              />
              <StatCard
                label="Link performance"
                value={`${fmtInt(data.referrals.clicks)} clicks`}
                sub={`${fmtInt(data.referrals.conversions)} conversions · ${conversionRate}% rate`}
              />
              <StatCard
                label="Active · 24h"
                value={fmtInt(data.referrals.active24h)}
                sub={data.referrals.total > 0 ? `${Math.round((data.referrals.active24h / data.referrals.total) * 100)}% of your referrals` : 'no referrals yet'}
              />
              <StatCard
                label="Content"
                value={fmtInt(data.content.totalPosts)}
                sub={`${fmtInt(data.content.totalViews)} views · ${data.content.engagementRate}% engagement`}
              />
            </div>

            {/* Simulator (real split engine) + live commission feed */}
            <div className="grid-2">
              <EarningsSimulator config={data.config} />
              <CommissionFeed entries={data.earnings.entries} ledgerLive={data.earnings.ledgerLive} />
            </div>

            {/* Content performance (carried over — metrics only) */}
            <ContentTable posts={data.content.recentPosts} />

            {/* Payout history lives on the Payouts page (influencer section) */}
            <div className="api-note">
              <b>Payouts →</b>
              <span style={{ color: 'var(--ink-4)' }}>
                Your creator payout history now lives alongside your game payouts.
              </span>
              <Link href="/payouts" className="btn-ghost" style={{ height: 32, fontSize: 12.5, marginLeft: 'auto' }}>
                View payout history
              </Link>
            </div>
          </>
        )}

        {/* dangerouslySetInnerHTML avoids the SSR/client entity-escaping
            mismatch (`>` vs `&gt;`) that a text-child <style> causes. */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              @media (max-width: 820px) {
                .creators-hero { grid-template-columns: 1fr 1fr !important; }
                .creators-hero > div:first-child { grid-column: 1 / -1; }
              }
            `,
          }}
        />
      </main>
    </Shell>
  );
}
