'use client';

/* Preview video portal — /preview?game=<slug>
 *
 * Reached from the "Preview video" button on My Games. Uploads a short clip
 * that will stand in for a game's static icon on the hub and in the Flutter
 * app. Deliberately its own route rather than an inline panel: a video needs a
 * player, a poster and a progress bar, which would swamp a manage-page row.
 *
 * Nothing here touches the game's build, version or live URL — see the header
 * comment in lib/game-preview.ts for why the preview is stored outside the
 * versioned build folders. */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Shell } from '@/components/Shell';
import {
  deleteGamePreview,
  fetchPreviewTarget,
  formatBytes,
  formatDuration,
  isCancelled,
  probeAndCapture,
  uploadGamePreview,
  type PreviewProgress,
  type PreviewTarget,
  type VideoProbe,
} from '@/lib/game-preview';
import { fetchDeveloperGames } from '@/lib/games';
import type { DeveloperGame, GamePreview } from '@/lib/types';

const MONO = "'Geist Mono', monospace";

const styles: Record<string, CSSProperties> = {
  crumb: { display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 14, fontFamily: MONO, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)' },
  h1: { margin: 0, fontSize: 'clamp(28px, 3.6vw, 42px)', fontWeight: 500, letterSpacing: '-0.028em', lineHeight: 1.05 },
  lede: { margin: '14px 0 0', maxWidth: '58ch', color: 'var(--ink-2)', fontSize: 14.5, lineHeight: 1.55 },

  shell: { marginTop: 28, borderRadius: 24, background: 'linear-gradient(180deg, oklch(0.20 0.02 245 / 0.5), oklch(0.165 0.018 245 / 0.5))', border: '1px solid var(--line)', backdropFilter: 'blur(14px) saturate(160%)', overflow: 'hidden', boxShadow: '0 30px 80px -30px oklch(0.50 0.15 250 / 0.4), inset 0 1px 0 oklch(1 0 0 / 0.05)' },
  panel: { padding: '28px 28px 26px', display: 'flex', flexDirection: 'column', gap: 18 },

  drop: { border: '1px dashed oklch(0.55 0.12 220 / 0.35)', borderRadius: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '52px 24px', textAlign: 'center', transition: 'border-color .25s, background .25s, box-shadow .25s', cursor: 'pointer' },
  dropHover: { borderColor: 'var(--blue-2)', borderStyle: 'solid', background: 'oklch(0.20 0.06 245 / 0.3)', boxShadow: 'inset 0 0 80px oklch(0.55 0.18 240 / 0.18), 0 0 60px -10px oklch(0.55 0.18 240 / 0.4)' },
  dropGlyph: { width: 64, height: 64, borderRadius: 20, background: 'linear-gradient(135deg, oklch(0.30 0.06 245 / 0.5), oklch(0.20 0.04 245 / 0.5))', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', marginBottom: 20, boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.08)', color: 'var(--blue-1)' },
  dropTitle: { margin: 0, fontSize: 20, fontWeight: 500, letterSpacing: '-0.02em' },
  dropHint: { marginTop: 10, fontFamily: MONO, fontSize: 11.5, color: 'var(--ink-3)', letterSpacing: '0.04em' },

  player: { width: '100%', maxHeight: 460, borderRadius: 14, border: '1px solid var(--line)', background: '#000', display: 'block', objectFit: 'contain' },

  metaRow: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: '0.05em' },
  chip: { padding: '4px 10px', borderRadius: 999, background: 'oklch(0.20 0.02 245 / 0.6)', border: '1px solid var(--line)', whiteSpace: 'nowrap' },

  barTrack: { height: 8, borderRadius: 4, background: 'oklch(0.20 0.02 245 / 0.6)', overflow: 'hidden' },
  barFill: { height: '100%', background: 'linear-gradient(90deg, var(--blue-3), var(--blue-1))', borderRadius: 4, boxShadow: '0 0 12px oklch(0.72 0.13 235 / 0.6)', transition: 'width .3s ease' },

  posterBox: { width: 104, height: 66, flexShrink: 0, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)', background: 'var(--bg-2)', display: 'grid', placeItems: 'center' },

  banner: { padding: '10px 14px', borderRadius: 10, fontSize: 12.5, lineHeight: 1.5 },
};

const errorBanner: CSSProperties = {
  ...styles.banner,
  background: 'oklch(0.72 0.16 25 / 0.12)',
  border: '1px solid oklch(0.72 0.16 25 / 0.3)',
  color: 'var(--neg)',
};
const okBanner: CSSProperties = {
  ...styles.banner,
  background: 'oklch(0.78 0.14 155 / 0.12)',
  border: '1px solid oklch(0.78 0.14 155 / 0.3)',
  color: 'var(--pos)',
};
const warnBanner: CSSProperties = {
  ...styles.banner,
  background: 'oklch(0.78 0.14 75 / 0.12)',
  border: '1px solid oklch(0.78 0.14 75 / 0.3)',
  color: 'var(--warm)',
};

function stageLabel(p: PreviewProgress): string {
  switch (p.stage) {
    case 'capturing': return 'Reading your video…';
    case 'video': return `Uploading · ${p.percent}%`;
    case 'poster': return 'Uploading poster frame…';
    case 'saving': return 'Linking it to your game…';
    default: return 'Done';
  }
}

/** A picked-but-not-yet-uploaded clip, with its local object URLs. */
interface PendingPick {
  file: File;
  /** Object URL for the local <video> so the dev sees it before committing. */
  url: string;
  probe: VideoProbe | null;
  /** Object URL of the poster we'll actually upload (captured or hand-picked). */
  posterUrl: string | null;
  posterOverride: Blob | null;
}

export default function PreviewPortalPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [slug, setSlug] = useState<string | null>(null);
  const [target, setTarget] = useState<PreviewTarget | null>(null);
  const [preview, setPreview] = useState<GamePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Only populated when the page is opened without ?game= — lets a bookmarked
  // /preview still get somewhere useful instead of dead-ending.
  const [picker, setPicker] = useState<DeveloperGame[] | null>(null);

  const [pick, setPick] = useState<PendingPick | null>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<PreviewProgress | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const posterInputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  // Mirrored into a ref so the unmount cleanup can revoke the latest object
  // URLs without depending on `pick` — a [pick] cleanup would revoke the URL of
  // a clip that's still on screen every time the pick changes.
  const pickRef = useRef<PendingPick | null>(null);
  useEffect(() => { pickRef.current = pick; }, [pick]);

  const uploading = progress !== null;

  // Anonymous → /login (wait for auth bootstrap so we don't flash-redirect).
  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  // Read the slug straight off the URL rather than useSearchParams, matching
  // /upload — keeps this page out of a Suspense boundary.
  useEffect(() => {
    setSlug(new URLSearchParams(window.location.search).get('game'));
  }, []);

  // Revoke every object URL we made when the page goes away.
  useEffect(() => () => {
    const p = pickRef.current;
    if (p?.url) URL.revokeObjectURL(p.url);
    if (p?.posterUrl) URL.revokeObjectURL(p.posterUrl);
  }, []);

  useEffect(() => {
    if (!user?.uid || slug === null) return;
    let cancelled = false;

    // No ?game= — offer a picker instead of an error.
    if (!slug) {
      setLoading(true);
      fetchDeveloperGames(user.uid)
        .then((list) => { if (!cancelled) { setPicker(list); setLoading(false); } })
        .catch(() => { if (!cancelled) { setLoadError('Could not load your games.'); setLoading(false); } });
      return () => { cancelled = true; };
    }

    setLoading(true);
    setLoadError(null);
    fetchPreviewTarget(slug, user.uid)
      .then((t) => {
        if (cancelled) return;
        if (!t) {
          setLoadError('That game doesn’t exist, or it isn’t one of yours.');
        } else {
          setTarget(t);
          setPreview(t.preview);
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError('Could not load that game.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.uid, slug]);

  // Revoking happens here rather than inside the setPick updater: React may run
  // an updater more than once, and a side effect in one would leak (or
  // double-free) object URLs. The ref always holds the committed pick.
  const clearPick = useCallback(() => {
    const prev = pickRef.current;
    if (prev?.url) URL.revokeObjectURL(prev.url);
    if (prev?.posterUrl) URL.revokeObjectURL(prev.posterUrl);
    pickRef.current = null;
    setPick(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const onPickFile = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    setErr(null);
    setNotice(null);
    clearPick();

    const url = URL.createObjectURL(file);
    // Show the clip immediately; the probe (decode + frame grab) can take a
    // moment on a big file and shouldn't hold up the player.
    setPick({ file, url, probe: null, posterUrl: null, posterOverride: null });
    setReading(true);
    try {
      const probe = await probeAndCapture(file);
      const posterUrl = probe.poster ? URL.createObjectURL(probe.poster) : null;
      setPick((prev) => (prev && prev.file === file ? { ...prev, probe, posterUrl } : prev));
    } catch {
      // Undecodable in this browser — still uploadable, just without a poster
      // and without dimensions. The clip may well play fine elsewhere.
      setPick((prev) => (prev && prev.file === file
        ? { ...prev, probe: { width: 0, height: 0, durationMs: 0, poster: null } }
        : prev));
    } finally {
      setReading(false);
    }
  }, [clearPick]);

  const onPickPoster = (file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErr('Pick an image file for the poster.'); return; }
    setErr(null);
    const stale = pickRef.current?.posterUrl;
    const posterUrl = URL.createObjectURL(file);
    setPick((prev) => (prev ? { ...prev, posterOverride: file, posterUrl } : prev));
    if (stale) URL.revokeObjectURL(stale);
    if (posterInputRef.current) posterInputRef.current.value = '';
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (uploading) return;
    void onPickFile(e.dataTransfer.files?.[0]);
  };

  const startUpload = async () => {
    if (!pick || !target) return;
    setErr(null);
    setNotice(null);
    setProgress({ stage: 'capturing', percent: 0, bytesTransferred: 0, totalBytes: pick.file.size });

    const handle = uploadGamePreview(target.id, pick.file, {
      probe: pick.probe ?? undefined,
      posterOverride: pick.posterOverride,
      onProgress: setProgress,
    });
    cancelRef.current = handle.cancel;

    try {
      const saved = await handle.result;
      setPreview(saved);
      clearPick();
      setNotice('Preview saved — it’s live on your game now.');
    } catch (e) {
      if (isCancelled(e)) {
        setNotice('Upload cancelled.');
      } else {
        setErr(e instanceof Error ? e.message : 'Upload failed. Please try again.');
      }
    } finally {
      cancelRef.current = null;
      setProgress(null);
    }
  };

  const remove = async () => {
    if (!target) return;
    setRemoving(true);
    setErr(null);
    try {
      await deleteGamePreview(target.id);
      setPreview(null);
      setConfirmRemove(false);
      setNotice('Preview removed — your game shows its icon again.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not remove the preview.');
    } finally {
      setRemoving(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────

  if (authLoading || (loading && !loadError)) {
    return (
      <Shell>
        <main className="stage" style={{ paddingTop: 32 }}>
          <div className="empty">
            <div style={{ width: 40, height: 40, borderRadius: '50%', borderTop: '4px solid var(--blue-1)', borderRight: '4px solid transparent', borderBottom: '4px solid var(--blue-2)', borderLeft: '4px solid transparent', margin: '0 auto', animation: 'spin 1s linear infinite' }} />
            <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
          </div>
        </main>
      </Shell>
    );
  }

  // Opened bare — let them choose which game to add a preview to.
  if (picker) {
    return (
      <Shell>
        <main className="stage" style={{ paddingTop: 32, paddingBottom: 60 }}>
          <div style={styles.crumb}>
            <Link href="/manage" style={{ color: 'inherit' }}>My Games</Link> <span>/</span> <span>Preview video</span>
          </div>
          <h1 style={styles.h1}>Preview video</h1>
          <p style={styles.lede}>Pick the game you want to add a preview clip to.</p>
          {picker.length === 0 ? (
            <div className="empty">
              <div style={{ fontSize: 36, marginBottom: 8 }}>🎬</div>
              <h2>No games yet</h2>
              <p>Upload a game first — then you can give it a preview clip.</p>
              <Link href="/upload" className="btn-primary">Upload a game</Link>
            </div>
          ) : (
            <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {picker.map((g) => (
                <Link
                  key={g.id}
                  href={`/preview?game=${encodeURIComponent(g.id)}`}
                  className="card"
                  style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 14, textDecoration: 'none', color: 'inherit' }}
                >
                  <div style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line)', background: 'var(--bg-2)', display: 'grid', placeItems: 'center' }}>
                    {g.iconUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={g.iconUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <span style={{ fontSize: 20 }}>🎮</span>}
                  </div>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, fontWeight: 500 }}>{g.name || g.id}</span>
                    <span style={{ display: 'block', fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: '0.04em' }}>
                      /{g.id}{g.preview ? ' · has a preview' : ''}
                    </span>
                  </span>
                  <span style={{ color: 'var(--ink-3)' }}>→</span>
                </Link>
              ))}
            </div>
          )}
        </main>
      </Shell>
    );
  }

  if (loadError || !target) {
    return (
      <Shell>
        <main className="stage" style={{ paddingTop: 32 }}>
          <div className="empty">
            <div style={{ fontSize: 36, marginBottom: 8 }}>⚠️</div>
            <h2>Can’t open that game</h2>
            <p>{loadError ?? 'Something went wrong.'}</p>
            <Link href="/manage" className="btn-primary">Back to My Games</Link>
          </div>
        </main>
      </Shell>
    );
  }

  const probe = pick?.probe;
  const dims = probe && probe.width > 0 ? `${probe.width}×${probe.height}` : '';
  const duration = probe ? formatDuration(probe.durationMs) : '';

  return (
    <Shell>
      <main className="stage" style={{ paddingTop: 32, paddingBottom: 60 }}>
        <div style={styles.crumb}>
          <Link href="/manage" style={{ color: 'inherit' }}>My Games</Link>
          <span>/</span>
          <span>{target.name}</span>
          <span>/</span>
          <span style={{ color: 'var(--ink-2)' }}>Preview video</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ width: 56, height: 56, flexShrink: 0, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)', background: 'var(--bg-2)', display: 'grid', placeItems: 'center' }}>
            {target.iconUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={target.iconUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span style={{ fontSize: 24 }}>🎮</span>}
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 style={styles.h1}>Preview video</h1>
            <p style={styles.lede}>
              A short clip that stands in for <strong style={{ color: 'var(--ink)' }}>{target.name}</strong>’s
              icon wherever the game is shown. Uploading one doesn’t touch your build, your version or
              your live URL — you can add, swap or remove it any time.
            </p>
          </div>
        </div>

        <div style={styles.shell}>
          <div style={styles.panel}>

            {/* ── Currently live preview ─────────────────────────── */}
            {preview && !pick && !uploading && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                    Current preview
                  </span>
                  <span style={{ ...styles.chip, color: 'var(--pos)', background: 'oklch(0.78 0.14 155 / 0.15)', borderColor: 'oklch(0.78 0.14 155 / 0.3)' }}>Live</span>
                </div>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video
                  key={preview.videoUrl}
                  src={preview.videoUrl}
                  poster={preview.posterUrl || undefined}
                  controls
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  style={styles.player}
                />
                <div style={styles.metaRow}>
                  {preview.durationMs > 0 && <span style={styles.chip}>{formatDuration(preview.durationMs)}</span>}
                  {preview.width > 0 && <span style={styles.chip}>{preview.width}×{preview.height}</span>}
                  {preview.sizeBytes > 0 && <span style={styles.chip}>{formatBytes(preview.sizeBytes)}</span>}
                  {preview.mimeType && <span style={styles.chip}>{preview.mimeType}</span>}
                  {!preview.posterUrl && <span style={{ ...styles.chip, color: 'var(--warm)', borderColor: 'oklch(0.78 0.14 75 / 0.3)' }}>no poster frame</span>}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn-primary" style={{ height: 38, padding: '0 18px', fontSize: 13 }} onClick={() => fileInputRef.current?.click()}>
                    Replace video
                  </button>
                  {!confirmRemove ? (
                    <button
                      className="btn-ghost"
                      style={{ height: 38, padding: '0 16px', fontSize: 13, borderColor: 'oklch(0.72 0.16 25 / 0.35)', color: 'var(--neg)' }}
                      onClick={() => setConfirmRemove(true)}
                      disabled={removing}
                    >Remove</button>
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '4px 6px 4px 12px', borderRadius: 999, background: 'oklch(0.72 0.16 25 / 0.1)', border: '1px solid oklch(0.72 0.16 25 / 0.3)' }}>
                      <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>Remove this preview?</span>
                      <button
                        className="btn-primary"
                        style={{ height: 30, padding: '0 14px', fontSize: 12.5, background: 'linear-gradient(135deg, var(--neg), oklch(0.62 0.18 25))', color: 'oklch(0.16 0.04 25)', boxShadow: 'none' }}
                        onClick={remove}
                        disabled={removing}
                      >{removing ? 'Removing…' : 'Yes, remove'}</button>
                      <button className="btn-ghost" style={{ height: 30, padding: '0 12px', fontSize: 12.5 }} onClick={() => setConfirmRemove(false)} disabled={removing}>Cancel</button>
                    </span>
                  )}
                </div>
              </>
            )}

            {/* ── Drop zone (no preview yet, nothing picked) ──────── */}
            {!preview && !pick && !uploading && (
              <div
                role="button"
                tabIndex={0}
                style={{ ...styles.drop, ...(dragging ? styles.dropHover : null) }}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                <div style={styles.dropGlyph}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="2" y="5" width="14" height="14" rx="3" />
                    <path d="m16 11 6-3.5v9L16 13z" />
                  </svg>
                </div>
                <p style={styles.dropTitle}>Drop a video here</p>
                <p style={styles.dropHint}>or click to choose a file · MP4, WebM, MOV</p>
              </div>
            )}

            {/* ── Picked, awaiting confirmation ───────────────────── */}
            {pick && (
              <>
                <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                  {preview ? 'New preview · not saved yet' : 'Ready to upload'}
                </span>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video
                  src={pick.url}
                  controls
                  muted
                  loop
                  autoPlay
                  playsInline
                  style={styles.player}
                />

                <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={styles.posterBox}>
                    {pick.posterUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={pick.posterUrl} alt="Poster frame" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : reading ? (
                      <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--ink-4)' }}>reading…</span>
                    ) : (
                      <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--ink-4)' }}>no frame</span>
                    )}
                  </div>
                  <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                      Poster frame
                    </span>
                    <div style={styles.metaRow}>
                      <span>{pick.file.name}</span>
                      <span style={styles.chip}>{formatBytes(pick.file.size)}</span>
                      {duration && <span style={styles.chip}>{duration}</span>}
                      {dims && <span style={styles.chip}>{dims}</span>}
                    </div>
                    <button
                      className="btn-ghost"
                      style={{ height: 30, padding: '0 12px', fontSize: 12.5, alignSelf: 'flex-start' }}
                      onClick={() => posterInputRef.current?.click()}
                      disabled={uploading}
                    >
                      {pick.posterUrl ? 'Use a different image' : 'Choose an image'}
                    </button>
                  </div>
                </div>

                {!reading && pick.probe && !pick.probe.poster && !pick.posterOverride && (
                  <div style={warnBanner}>
                    Your browser couldn’t decode a frame from this file, so there’s no poster — the clip
                    will still upload and may play fine elsewhere. Pick an image above if you want a
                    still to show before it loads.
                  </div>
                )}

                {!uploading && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn-primary" style={{ height: 38, padding: '0 18px', fontSize: 13 }} onClick={startUpload} disabled={reading}>
                      {reading ? 'Reading video…' : preview ? 'Replace preview' : 'Upload preview'}
                    </button>
                    <button className="btn-ghost" style={{ height: 38, padding: '0 16px', fontSize: 13 }} onClick={clearPick}>Cancel</button>
                    <button className="btn-ghost" style={{ height: 38, padding: '0 16px', fontSize: 13 }} onClick={() => fileInputRef.current?.click()}>Choose another</button>
                  </div>
                )}
              </>
            )}

            {/* ── In-flight upload ────────────────────────────────── */}
            {progress && (
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, fontFamily: MONO, fontSize: 11, letterSpacing: '0.06em', color: 'var(--ink-2)' }}>
                  <span>{stageLabel(progress)}</span>
                  {progress.totalBytes > 0 && (
                    <span style={{ color: 'var(--ink-4)' }}>
                      {formatBytes(progress.bytesTransferred)} / {formatBytes(progress.totalBytes)}
                    </span>
                  )}
                </div>
                <div style={styles.barTrack}>
                  <div style={{ ...styles.barFill, width: `${progress.stage === 'video' ? progress.percent : progress.stage === 'capturing' ? 2 : 100}%` }} />
                </div>
                <button
                  className="btn-ghost"
                  style={{ height: 34, padding: '0 14px', fontSize: 12.5, alignSelf: 'flex-start' }}
                  onClick={() => cancelRef.current?.()}
                >Cancel upload</button>
              </div>
            )}

            {notice && <div style={okBanner}>{notice}</div>}
            {err && <div style={errorBanner}>{err}</div>}

            <p style={{ margin: 0, fontFamily: MONO, fontSize: 10, color: 'var(--ink-4)', letterSpacing: '0.04em', lineHeight: 1.6 }}>
              Keep it short and silent-friendly — previews autoplay muted in feeds. A few seconds of
              actual gameplay reads far better than a title card. Your game keeps its icon as a
              fallback wherever the clip can’t play.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              style={{ display: 'none' }}
              onChange={(e) => void onPickFile(e.target.files?.[0])}
            />
            <input
              ref={posterInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => onPickPoster(e.target.files?.[0])}
            />
          </div>
        </div>

        <div style={{ marginTop: 18, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/manage" className="btn-ghost" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Back to My Games</Link>
          <Link href={`/games/${encodeURIComponent(target.id)}`} className="btn-ghost" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>View game page</Link>
        </div>
      </main>
    </Shell>
  );
}
