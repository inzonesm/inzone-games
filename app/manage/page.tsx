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
import { Shell } from '@/components/Shell';
import {
  deleteGame,
  fetchDeveloperGames,
  updateGameMetadata,
} from '@/lib/games';
import type { DeveloperGame } from '@/lib/types';

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

  const handleUpdated = (id: string, patch: { name: string; description: string; serverUrl: string }) => {
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
  onUpdated: (id: string, patch: { name: string; description: string; serverUrl: string }) => void;
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

  const [name, setName] = useState(game.name);
  const [description, setDescription] = useState(game.description);
  const [serverUrl, setServerUrl] = useState(game.serverUrl);

  const [imgFailed, setImgFailed] = useState(false);
  const showFallback = !game.iconUrl || imgFailed;

  const startEdit = () => {
    setName(game.name);
    setDescription(game.description);
    setServerUrl(game.serverUrl);
    setErr(null);
    setEditing(true);
  };

  const save = async () => {
    if (!name.trim()) { setErr('Name can’t be empty.'); return; }
    setBusy(true);
    setErr(null);
    try {
      const patch = { name: name.trim(), description: description.trim(), serverUrl: serverUrl.trim() };
      await updateGameMetadata(game.id, patch);
      onUpdated(game.id, patch);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save changes.');
    } finally {
      setBusy(false);
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
                /{game.id}{game.serverUrl ? ' · multiplayer' : ''}
              </div>
              {game.description && (
                <p style={{ margin: '10px 0 0', color: 'var(--ink-2)', fontSize: 13.5, lineHeight: 1.5 }}>{game.description}</p>
              )}

              <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {playable && (
                  <Link href={`/games/${encodeURIComponent(game.id)}`} className="btn-ghost" style={{ height: 34, padding: '0 14px', fontSize: 13 }}>Play</Link>
                )}
                <button className="btn-ghost" style={{ height: 34, padding: '0 14px', fontSize: 13 }} onClick={startEdit} disabled={busy}>Edit</button>
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
            </>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              <div className="field">
                <label className="field-label" htmlFor={`name-${game.id}`}>Name</label>
                <input id={`name-${game.id}`} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`desc-${game.id}`}>Description</label>
                <textarea id={`desc-${game.id}`} className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={600} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`server-${game.id}`}>Multiplayer server URL · optional</label>
                <input id={`server-${game.id}`} className="input" type="url" inputMode="url" placeholder="wss://your-game.fly.dev" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} autoComplete="off" spellCheck={false} />
              </div>
              <p style={{ margin: 0, fontFamily: "'Geist Mono', monospace", fontSize: 10, color: 'var(--ink-4)', letterSpacing: '0.04em', lineHeight: 1.5 }}>
                Editing details won’t change your live URL. To replace the build itself, re-upload it from the Upload page.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-primary" style={{ height: 38, padding: '0 18px', fontSize: 13 }} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
                <button className="btn-ghost" style={{ height: 38, padding: '0 16px', fontSize: 13 }} onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
              </div>
            </div>
          )}

          {err && (
            <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: 'oklch(0.72 0.16 25 / 0.12)', border: '1px solid oklch(0.72 0.16 25 / 0.3)', color: 'var(--neg)', fontSize: 12.5 }}>{err}</div>
          )}
        </div>
      </div>
    </div>
  );
}
