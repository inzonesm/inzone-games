'use client';

/* My Games — the developer's management view. Lists every game the signed-in
 * user has uploaded and lets them edit its display metadata (name, description,
 * multiplayer server URL) or delete it outright. Edits keep the slug/doc id and
 * stored build intact, so the live URL never changes; deletes remove the
 * Firestore doc, the storage artifacts, and the community group chat. */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { GameMetaEditor } from '@/components/GameMetaEditor';
import { Shell } from '@/components/Shell';
import {
  deleteGame,
  fetchDeveloperGames,
  fetchGameVersions,
  gameShareLink,
  rollbackToVersion,
} from '@/lib/games';
import type { DeveloperGame, GameVersion } from '@/lib/types';

const MONO = "'Geist Mono', monospace";

function bytes(n: number): string {
  if (!n) return '';
  if (n > 1e9) return (n / 1e9).toFixed(1) + ' GB';
  if (n > 1e6) return (n / 1e6).toFixed(1) + ' MB';
  if (n > 1e3) return (n / 1e3).toFixed(1) + ' KB';
  return n + ' B';
}

function formatDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

export default function ManagePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [games, setGames] = useState<DeveloperGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Anonymous → /login (wait for auth bootstrap so we don't flash-redirect).
  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  const load = useCallback(async () => {
    if (!user?.uid) return;
    setLoading(true);
    setError(null);
    try {
      setGames(await fetchDeveloperGames(user.uid));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load your games.');
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => { void load(); }, [load]);

  const handleUpdated = (id: string, patch: Partial<DeveloperGame>) => {
    setGames((gs) => gs.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  };
  const handleDeleted = (id: string) => {
    setGames((gs) => gs.filter((g) => g.id !== id));
  };

  return (
    <Shell>
      <main className="stage" style={{ paddingTop: 32, paddingBottom: 60 }}>
        <header style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 'clamp(28px, 3.4vw, 40px)', fontWeight: 500, letterSpacing: '-0.028em', lineHeight: 1 }}>
            My Games
          </h1>
          <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
            {loading ? 'Loading…' : `${games.length} uploaded`}
          </span>
          <div style={{ marginLeft: 'auto' }}>
            <Link href="/upload" className="btn-primary" style={{ height: 36, padding: '0 16px' }}>
              Upload a game
            </Link>
          </div>
        </header>

        {loading ? (
          <div className="empty">
            <div style={{ width: 40, height: 40, borderRadius: '50%', borderTop: '4px solid var(--blue-1)', borderRight: '4px solid transparent', borderBottom: '4px solid var(--blue-2)', borderLeft: '4px solid transparent', margin: '0 auto', animation: 'spin 1s linear infinite' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : error ? (
          <div className="empty">
            <div style={{ fontSize: 36, marginBottom: 8 }}>⚠️</div>
            <h2>Couldn&apos;t load your games</h2>
            <p>{error}</p>
            <button onClick={load} className="btn-primary">Retry</button>
          </div>
        ) : games.length === 0 ? (
          <div className="empty">
            <div style={{ fontSize: 36, marginBottom: 8 }}>🎮</div>
            <h2>No games yet</h2>
            <p>Games you upload will show up here, where you can edit their details or remove them.</p>
            <Link href="/upload" className="btn-primary">Upload your first game</Link>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {games.map((g) => (
              <GameRow key={g.id} game={g} onUpdated={handleUpdated} onDeleted={handleDeleted} />
            ))}
          </div>
        )}
      </main>
    </Shell>
  );
}

// ──────────────────────────────────────────────────────────────────
// One manageable game card (view ↔ edit, with inline delete confirm)
// ──────────────────────────────────────────────────────────────────

interface GameRowProps {
  game: DeveloperGame;
  onUpdated: (id: string, patch: Partial<DeveloperGame>) => void;
  onDeleted: (id: string) => void;
}

function StatusBadge({ status, engine }: { status: string; engine: string }) {
  let label = status || 'unknown';
  let color = 'var(--ink-3)';
  let bg = 'oklch(0.20 0.02 245 / 0.5)';
  let border = 'var(--line)';
  if (status === 'approved') {
    label = 'Live'; color = 'var(--pos)';
    bg = 'oklch(0.78 0.14 155 / 0.15)'; border = 'oklch(0.78 0.14 155 / 0.3)';
  } else if (status === 'pending-unity-runtime' || engine === 'unity') {
    label = 'Runtime pending'; color = 'var(--warm)';
    bg = 'oklch(0.78 0.14 75 / 0.15)'; border = 'oklch(0.78 0.14 75 / 0.3)';
  }
  return (
    <span style={{ padding: '4px 10px', borderRadius: 999, background: bg, border: `1px solid ${border}`, fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color, letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

function GameRow({ game, onUpdated, onDeleted }: GameRowProps) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // Version history (lazy-loaded the first time the panel is opened).
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState<GameVersion[] | null>(null);
  const [versionsBusy, setVersionsBusy] = useState(false);
  const [versionErr, setVersionErr] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState<number | null>(null);

  const [imgFailed, setImgFailed] = useState(false);
  const showFallback = !game.iconUrl || imgFailed;

  // A fresh iconUrl (after a save) should clear a stale broken-image flag.
  useEffect(() => { setImgFailed(false); }, [game.iconUrl]);

  const startEdit = () => {
    setErr(null);
    setEditing(true);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard?.writeText(gameShareLink(game.id));
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  const remove = async () => {
    setBusy(true);
    setErr(null);
    try {
      await deleteGame(game);
      onDeleted(game.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete this game.');
      setBusy(false);
      setConfirming(false);
    }
  };

  const toggleHistory = async () => {
    const next = !showHistory;
    setShowHistory(next);
    // Fetch the build history once, on first open.
    if (next && versions === null && !versionsBusy) {
      setVersionsBusy(true);
      setVersionErr(null);
      try {
        setVersions(await fetchGameVersions(game.id));
      } catch (e) {
        setVersionErr(e instanceof Error ? e.message : 'Failed to load history.');
      } finally {
        setVersionsBusy(false);
      }
    }
  };

  const doRollback = async (version: number) => {
    setRollingBack(version);
    setVersionErr(null);
    try {
      await rollbackToVersion(game.id, version);
      // Repoint the row at the restored version; the live URL/build now match it.
      onUpdated(game.id, { version });
    } catch (e) {
      setVersionErr(e instanceof Error ? e.message : 'Rollback failed.');
    } finally {
      setRollingBack(null);
    }
  };

  const playable = game.status === 'approved' && game.engine !== 'unity';

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Icon */}
        <div style={{ width: 64, height: 64, flexShrink: 0, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)', background: 'var(--bg-2)', display: 'grid', placeItems: 'center' }}>
          {showFallback ? (
            <span style={{ fontSize: 26 }} role="img" aria-label="No icon">🎮</span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={game.iconUrl} alt={game.name} onError={() => setImgFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!editing ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 17, fontWeight: 500, color: 'var(--ink)' }}>{game.name || 'Untitled'}</span>
                <StatusBadge status={game.status} engine={game.engine} />
              </div>
              <div style={{ marginTop: 3, fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: '0.04em' }}>
                /{game.id} · v{game.version}{game.serverUrl ? ' · multiplayer' : ''}
              </div>
              {game.description && (
                <p style={{ margin: '10px 0 0', color: 'var(--ink-2)', fontSize: 13.5, lineHeight: 1.5 }}>{game.description}</p>
              )}

              <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {playable && (
                  <Link href={`/games/${encodeURIComponent(game.id)}`} className="btn-ghost" style={{ height: 34, padding: '0 14px', fontSize: 13 }}>Play</Link>
                )}
                <Link href={`/upload?update=${encodeURIComponent(game.id)}`} className="btn-ghost" style={{ height: 34, padding: '0 14px', fontSize: 13 }}>Update build</Link>
                <button className="btn-ghost" style={{ height: 34, padding: '0 14px', fontSize: 13 }} onClick={startEdit} disabled={busy}>Edit</button>
                <button className="btn-ghost" style={{ height: 34, padding: '0 14px', fontSize: 13 }} onClick={toggleHistory} disabled={busy}>{showHistory ? 'Hide history' : 'History'}</button>
                <button className="btn-ghost" style={{ height: 34, padding: '0 14px', fontSize: 13 }} onClick={copyLink} disabled={busy}>{linkCopied ? 'Copied ✓' : 'Copy link'}</button>
                {!confirming ? (
                  <button
                    className="btn-ghost"
                    style={{ height: 34, padding: '0 14px', fontSize: 13, borderColor: 'oklch(0.72 0.16 25 / 0.35)', color: 'var(--neg)' }}
                    onClick={() => { setErr(null); setConfirming(true); }}
                    disabled={busy}
                  >Delete</button>
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '4px 6px 4px 12px', borderRadius: 999, background: 'oklch(0.72 0.16 25 / 0.1)', border: '1px solid oklch(0.72 0.16 25 / 0.3)' }}>
                    <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>Delete permanently?</span>
                    <button
                      className="btn-primary"
                      style={{ height: 30, padding: '0 14px', fontSize: 12.5, background: 'linear-gradient(135deg, var(--neg), oklch(0.62 0.18 25))', color: 'oklch(0.16 0.04 25)', boxShadow: 'none' }}
                      onClick={remove}
                      disabled={busy}
                    >{busy ? 'Deleting…' : 'Yes, delete'}</button>
                    <button className="btn-ghost" style={{ height: 30, padding: '0 12px', fontSize: 12.5 }} onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
                  </span>
                )}
              </div>

              {showHistory && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line-soft)' }}>
                  <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 10 }}>
                    Build history
                  </div>
                  {versionsBusy ? (
                    <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Loading…</div>
                  ) : versions && versions.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {versions.map((v) => {
                        const isCurrent = v.version === game.version;
                        const meta = [v.buildType, v.fileCount ? `${v.fileCount} files` : '', bytes(v.sizeBytes), v.createdAt ? formatDate(v.createdAt) : '']
                          .filter(Boolean)
                          .join(' · ');
                        return (
                          <div key={v.version} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--ink)', minWidth: 30 }}>v{v.version}</span>
                            <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: '0.03em' }}>{meta}</span>
                            {v.note && <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{v.note}</span>}
                            <span style={{ marginLeft: 'auto' }}>
                              {isCurrent ? (
                                <span style={{ padding: '3px 9px', borderRadius: 999, background: 'oklch(0.78 0.14 155 / 0.15)', border: '1px solid oklch(0.78 0.14 155 / 0.3)', fontFamily: MONO, fontSize: 10, color: 'var(--pos)', letterSpacing: '0.06em' }}>Current</span>
                              ) : v.pruned ? (
                                <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-4)', letterSpacing: '0.04em' }}>pruned</span>
                              ) : (
                                <button className="btn-ghost" style={{ height: 30, padding: '0 12px', fontSize: 12.5 }} onClick={() => doRollback(v.version)} disabled={rollingBack !== null}>
                                  {rollingBack === v.version ? 'Rolling back…' : 'Roll back'}
                                </button>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>No version history yet — ship an update to start one.</div>
                  )}
                  {versionErr && (
                    <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--neg)' }}>{versionErr}</div>
                  )}
                </div>
              )}
            </>
          ) : (
            <GameMetaEditor
              gameId={game.id}
              initial={{ name: game.name, description: game.description, serverUrl: game.serverUrl, iconUrl: game.iconUrl }}
              onSaved={(patch) => { onUpdated(game.id, patch); setEditing(false); }}
              onCancel={() => setEditing(false)}
            />
          )}

          {err && (
            <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: 'oklch(0.72 0.16 25 / 0.12)', border: '1px solid oklch(0.72 0.16 25 / 0.3)', color: 'var(--neg)', fontSize: 12.5 }}>{err}</div>
          )}
        </div>
      </div>
    </div>
  );
}
