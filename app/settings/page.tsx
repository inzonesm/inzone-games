'use client';

/* Settings — studio profile, game keys, payouts, notifications. Ported from
 * the portal's Settings.jsx. Real bits are wired: the contact email and studio
 * name seed from the signed-in account, the game-key section reflects the
 * selected game, and Sign out works. Profile/payout/notification controls are
 * not persisted yet (no settings backend), which the note at the top makes
 * explicit so nothing looks saved when it isn't.
 * */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Shell } from '@/components/Shell';
import { ensureGameKey, fetchDeveloperGames, gameShareLink } from '@/lib/games';
import type { DeveloperGame } from '@/lib/types';

const stStyles: Record<string, CSSProperties> = {
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

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      style={{ width: 42, height: 24, borderRadius: 999, background: checked ? 'oklch(0.55 0.13 240)' : 'var(--bg-3)', border: '1px solid ' + (checked ? 'var(--blue-2)' : 'var(--line)'), position: 'relative', cursor: 'pointer', transition: 'background .2s, border-color .2s' }}
    >
      <span style={{ position: 'absolute', top: 2, left: checked ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: 'var(--ink)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.3)', transition: 'left .2s' }} />
    </button>
  );
}

function CopyKey({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    navigator.clipboard?.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div style={stStyles.keyBox}>
      <span style={stStyles.keyText}>{value}</span>
      <button onClick={onCopy} style={{ height: 30, padding: '0 12px', borderRadius: 8, background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--ink-2)', cursor: 'pointer', fontFamily: "'Geist Mono', monospace", fontSize: 11, letterSpacing: '0.04em' }}>
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
    </div>
  );
}

const NOTIFICATIONS = [
  { k: 'payouts', label: 'Payout sent', sub: 'When a monthly payout is initiated.' },
  { k: 'milestones', label: 'Milestone moments', sub: '10K / 50K / 100K player thresholds.' },
  { k: 'weekly', label: 'Weekly summary', sub: 'Monday digest — sessions, revenue, retention.' },
  { k: 'security', label: 'Security & access', sub: 'New sign-ins, key rotations, billing.' },
  { k: 'marketing', label: 'Product updates', sub: 'Roadmap notes from the InZone team.' },
] as const;

export default function SettingsPage() {
  const router = useRouter();
  const { user, loading: authLoading, signOut } = useAuth();

  const [games, setGames] = useState<DeveloperGame[]>([]);
  const [currentId, setCurrentId] = useState<string>('');
  const [gameKeyMap, setGameKeyMap] = useState<Record<string, string>>({});
  const [keyLoading, setKeyLoading] = useState(false);

  const [studio, setStudio] = useState('');
  const [email, setEmail] = useState('');
  const [payoutMethod, setPayoutMethod] = useState('ach');
  const [notify, setNotify] = useState<Record<string, boolean>>({ payouts: true, milestones: true, weekly: true, security: true, marketing: false });

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  // Seed editable profile fields from the signed-in account.
  useEffect(() => {
    if (!user) return;
    setStudio((s) => s || user.displayName || user.email?.split('@')[0] || 'My Studio');
    setEmail((e) => e || user.email || '');
  }, [user]);

  const loadGames = useCallback(async () => {
    if (!user?.uid) return;
    const list = await fetchDeveloperGames(user.uid);
    setGames(list);
    setCurrentId((prev) => (prev && list.some((g) => g.id === prev) ? prev : list[0]?.id ?? ''));
  }, [user?.uid]);

  useEffect(() => { void loadGames(); }, [loadGames]);

  // Ensure the selected game has a gameKey — read from Firestore or create if missing.
  useEffect(() => {
    if (!currentId || !user?.uid) return;
    if (gameKeyMap[currentId]) return;
    let cancelled = false;
    setKeyLoading(true);
    ensureGameKey(currentId, user.uid).then((key) => {
      if (cancelled) return;
      setGameKeyMap((prev) => ({ ...prev, [currentId]: key }));
    }).catch(() => {
      if (cancelled) return;
      setGameKeyMap((prev) => ({ ...prev, [currentId]: `gk_live_${currentId}_${user!.uid}` }));
    }).finally(() => { if (!cancelled) setKeyLoading(false); });
    return () => { cancelled = true; };
  }, [currentId, user?.uid, gameKeyMap]);

  const currentGame = games.find((g) => g.id === currentId) ?? null;
  const currentKey = gameKeyMap[currentId] || '';

  return (
    <Shell>
      <main className="stage">
        <header style={stStyles.hero}>
          <div style={stStyles.crumb}>Account · Studio settings</div>
          <h1 style={stStyles.h1}>Settings.</h1>
        </header>

        {/* Honest banner — these controls don't persist yet */}
        <div className="api-note" style={{ marginTop: 0 }}>
          <b>Preview →</b>
          <span style={{ color: 'var(--ink-4)' }}>Profile, payout, and notification settings aren&apos;t saved yet. Game keys and Sign out are live.</span>
        </div>

        <section className="card tall">
          {/* Studio profile */}
          <div style={stStyles.group}>
            <div style={stStyles.groupHead}>
              <div style={stStyles.groupTitle}>Studio profile</div>
              <p style={stStyles.groupDesc}>Public on your game&apos;s InZone page and used for revenue contracts.</p>
            </div>
            <div>
              <div style={stStyles.row}>
                <div className="field">
                  <label className="field-label">Studio name</label>
                  <input className="input" value={studio} onChange={(e) => setStudio(e.target.value)} />
                </div>
                <div className="field">
                  <label className="field-label">Contact email</label>
                  <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="field" style={stStyles.full}>
                  <label className="field-label">Studio description</label>
                  <textarea className="textarea" placeholder="A line or two for your studio page." />
                </div>
              </div>
            </div>
          </div>

          {/* Game keys */}
          <div style={stStyles.group}>
            <div style={stStyles.groupHead}>
              <div style={stStyles.groupTitle}>Game keys</div>
              <p style={stStyles.groupDesc}>Each game has a server-side key for the SDK and a public ID.</p>
            </div>
            <div>
              {games.length > 1 && (
                <div className="field" style={{ marginBottom: 14 }}>
                  <label className="field-label">Game</label>
                  <select className="select" value={currentId} onChange={(e) => setCurrentId(e.target.value)}>
                    {games.map((g) => <option key={g.id} value={g.id}>{g.name || g.id}</option>)}
                  </select>
                </div>
              )}
              <div className="field">
                <label className="field-label">Server key · {currentGame?.name || '—'}</label>
                <CopyKey value={keyLoading ? 'Loading…' : (currentKey || '—')} />
              </div>
              <div style={{ marginTop: 14 }} className="field">
                <label className="field-label">Game ID (public)</label>
                <CopyKey value={currentGame?.id || '—'} />
              </div>
            </div>
          </div>

          {/* Share links */}
          <div style={stStyles.group}>
            <div style={stStyles.groupHead}>
              <div style={stStyles.groupTitle}>Share links</div>
              <p style={stStyles.groupDesc}>Links that open your games on the InZone Game Hub. Share them in posts and messages.</p>
            </div>
            <div>
              {games.length === 0 ? (
                <CopyKey value="—" />
              ) : (
                games.map((g, i) => (
                  <div key={g.id} className="field" style={i > 0 ? { marginTop: 14 } : undefined}>
                    <label className="field-label">{g.name || g.id}</label>
                    <CopyKey value={gameShareLink(g.id)} />
                  </div>
                ))
              )}
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
                ].map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setPayoutMethod(m.id)}
                    style={{ height: 36, padding: '0 14px', borderRadius: 10, background: payoutMethod === m.id ? 'oklch(0.30 0.08 245 / 0.5)' : 'var(--bg-2)', border: `1px solid ${payoutMethod === m.id ? 'var(--blue-2)' : 'var(--line)'}`, color: payoutMethod === m.id ? 'var(--ink)' : 'var(--ink-2)', fontFamily: "'Geist Mono', monospace", fontSize: 11.5, letterSpacing: '0.04em', cursor: 'pointer' }}
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
                Payout cycle starts 30 days after your first paying user.
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
              {NOTIFICATIONS.map((n) => (
                <div key={n.k} style={stStyles.toggle}>
                  <div>
                    <div style={{ fontSize: 13.5, color: 'var(--ink)' }}>{n.label}</div>
                    <div style={{ marginTop: 3, fontFamily: "'Geist Mono', monospace", fontSize: 11, color: 'var(--ink-3)' }}>{n.sub}</div>
                  </div>
                  <Toggle checked={!!notify[n.k]} onChange={(v) => setNotify((s) => ({ ...s, [n.k]: v }))} />
                </div>
              ))}
            </div>
          </div>

          {/* Danger zone */}
          <div style={stStyles.groupLast}>
            <div style={stStyles.groupHead}>
              <div style={{ ...stStyles.groupTitle, color: 'var(--neg)' }}>Danger zone</div>
              <p style={stStyles.groupDesc}>Sign out of this session, or manage your games.</p>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn-ghost" onClick={() => { void signOut(); }}>Sign out</button>
              <Link href="/manage" className="btn-ghost">Manage games</Link>
            </div>
          </div>
        </section>
      </main>
    </Shell>
  );
}
