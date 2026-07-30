'use client';

/* Preview-video pipeline — upload, read and remove a game's preview clip.
 *
 * A preview is the short video a developer uploads to represent their game in
 * place of the static icon. It is deliberately DECOUPLED from the build
 * pipeline (lib/upload-pipeline.ts): uploading or removing a preview never
 * touches gameUrl, buildType, entryPath or version, so it can't break a live
 * game and doesn't create a version-history entry.
 *
 * ── Storage layout (gs://inzone-html) ─────────────────────────────────────
 *
 *     games/<slug>/preview/video.<ext>    the clip
 *     games/<slug>/preview/poster.jpg     still frame captured at upload time
 *
 * Same `games/<slug>/…` prefix the builds and the icon already live under, so
 * the existing storage.rules match (public read, owner-only write) covers it
 * with no rule change, and deleteGame's clearStoragePrefix already wipes it.
 * The preview sits OUTSIDE the `v<N>/` folders on purpose — like the icon, it
 * survives version pruning and rollback.
 *
 * ── Firestore shape (html_games/<slug>) ───────────────────────────────────
 *
 * Written as flat `preview*` fields on the game doc rather than a subcollection
 * or a nested map, so every existing reader — this site's hub query, the
 * Flutter app's CommunityGameService — picks them up from the doc it already
 * fetches, with zero extra reads:
 *
 *     previewUrl, previewPosterUrl, previewVideoPath, previewPosterPath,
 *     previewMimeType, previewDurationMs, previewWidth, previewHeight,
 *     previewSizeBytes, previewUpdatedAt
 *
 * Removing a preview writes '' / 0 / null rather than deleting the fields, so a
 * client reading a stale cached doc still resolves to "no preview" instead of
 * an undefined it might not guard.
 *
 * CONSUMERS MUST TREAT THE PREVIEW AS OPTIONAL and fall back to iconUrl. */

import { doc, getDoc, serverTimestamp, updateDoc, type Timestamp } from 'firebase/firestore';
import {
  deleteObject,
  getDownloadURL,
  listAll,
  ref as storageRef,
  uploadBytesResumable,
} from 'firebase/storage';
import { getDb, getHtmlStorage } from './firebase';
import type { GamePreview } from './types';

const COLLECTION = 'html_games';

/** Longest edge of the generated poster. Keeps the still small enough to ship
 *  in a card feed without a second network round-trip mattering. */
const POSTER_MAX_EDGE = 1280;
const POSTER_QUALITY = 0.82;

/** Where in the clip to grab the poster from. Videos very often open on a black
 *  or blank frame, so we sample slightly in rather than at t=0 — 10% of the way
 *  through, clamped so a long clip doesn't sample a scene change and a very
 *  short one doesn't run past its own end. */
const POSTER_SEEK_FRACTION = 0.1;
const POSTER_SEEK_MIN_S = 0.1;
const POSTER_SEEK_MAX_S = 2.5;

/** The storage folder holding a game's preview artifacts. */
export function previewPrefix(slug: string): string {
  return `games/${slug}/preview`;
}

// ──────────────────────────────────────────────────────────────────
// Reading
// ──────────────────────────────────────────────────────────────────

function isTimestamp(v: unknown): v is Timestamp {
  return !!v && typeof v === 'object' && 'toMillis' in (v as Record<string, unknown>);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Pull the preview off a raw `html_games` document. Returns null when the game
 *  has no preview — which is the common case, so every caller must handle it.
 *  Exported so lib/games.ts can reuse it while mapping docs. */
export function previewFromDoc(raw: Record<string, unknown>): GamePreview | null {
  const videoUrl = str(raw.previewUrl);
  if (!videoUrl) return null;
  const updated = raw.previewUpdatedAt;
  return {
    videoUrl,
    posterUrl: str(raw.previewPosterUrl),
    videoPath: str(raw.previewVideoPath),
    posterPath: str(raw.previewPosterPath),
    mimeType: str(raw.previewMimeType),
    durationMs: num(raw.previewDurationMs),
    width: num(raw.previewWidth),
    height: num(raw.previewHeight),
    sizeBytes: num(raw.previewSizeBytes),
    updatedAt: isTimestamp(updated) ? updated.toMillis() : null,
  };
}

/** Read one game's preview straight from Firestore. Used by the portal page,
 *  which lands on a slug from the URL and has no game object in hand. */
export async function fetchGamePreview(slug: string): Promise<GamePreview | null> {
  if (!slug) return null;
  const snap = await getDoc(doc(getDb(), COLLECTION, slug));
  if (!snap.exists()) return null;
  return previewFromDoc(snap.data() as Record<string, unknown>);
}

/** The game fields the portal page needs for its header, fetched alongside the
 *  preview so the page costs a single read. Null when the slug doesn't exist or
 *  isn't owned by `uploaderId` (the portal is owner-only). */
export interface PreviewTarget {
  id: string;
  name: string;
  iconUrl: string;
  preview: GamePreview | null;
}

export async function fetchPreviewTarget(
  slug: string,
  uploaderId: string,
): Promise<PreviewTarget | null> {
  if (!slug || !uploaderId) return null;
  const snap = await getDoc(doc(getDb(), COLLECTION, slug));
  if (!snap.exists()) return null;
  const raw = snap.data() as Record<string, unknown>;
  if (str(raw.uploaderId) !== uploaderId) return null;
  return {
    id: snap.id,
    name: str(raw.name) || snap.id,
    iconUrl: str(raw.iconUrl),
    preview: previewFromDoc(raw),
  };
}

// ──────────────────────────────────────────────────────────────────
// Poster capture (client-side, best-effort)
// ──────────────────────────────────────────────────────────────────

export interface VideoProbe {
  width: number;
  height: number;
  durationMs: number;
  /** The captured still, or null when the browser couldn't decode a frame. */
  poster: Blob | null;
}

/** Load a File into a detached <video>, read its intrinsic size and duration,
 *  and draw one frame to a canvas as a JPEG poster.
 *
 *  Entirely best-effort. The browser may refuse the container/codec (HEVC in a
 *  .mov is the usual offender), or the draw may be blocked — in either case the
 *  caller still gets whatever metadata was readable, with `poster: null`, and
 *  the upload proceeds without a poster. Never throws for a decode failure;
 *  only a genuinely unreadable file rejects. */
export function probeAndCapture(file: File): Promise<VideoProbe> {
  return new Promise<VideoProbe>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('Poster capture is only available in the browser.'));
      return;
    }

    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;
    let metadata: { width: number; height: number; durationMs: number } = {
      width: 0,
      height: 0,
      durationMs: 0,
    };

    const cleanup = () => {
      video.removeAttribute('src');
      try { video.load(); } catch { /* detached element — nothing to unload */ }
      URL.revokeObjectURL(url);
    };

    // Resolve with whatever we managed to read. Called from every exit path so
    // a codec the browser won't decode still yields dimensions when it had them.
    const finish = (poster: Blob | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ...metadata, poster });
    };

    // Belt and braces: some browsers fire neither `seeked` nor `error` for an
    // undecodable stream, which would leave the upload hanging on a promise
    // that never settles. Give up after 15s and continue without a poster.
    const timer = setTimeout(() => finish(null), 15_000);
    const finishAndClear = (poster: Blob | null) => {
      clearTimeout(timer);
      finish(poster);
    };

    const draw = () => {
      try {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) { finishAndClear(null); return; }

        const scale = Math.min(1, POSTER_MAX_EDGE / Math.max(vw, vh));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(vw * scale));
        canvas.height = Math.max(1, Math.round(vh * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) { finishAndClear(null); return; }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => finishAndClear(blob), 'image/jpeg', POSTER_QUALITY);
      } catch {
        // Tainted canvas or a decode fault mid-draw — poster is optional.
        finishAndClear(null);
      }
    };

    video.addEventListener('loadedmetadata', () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      metadata = {
        width: video.videoWidth || 0,
        height: video.videoHeight || 0,
        durationMs: duration > 0 ? Math.round(duration * 1000) : 0,
      };
      if (duration <= 0) {
        // Streamed/unknown duration — take the current frame rather than seek.
        video.addEventListener('loadeddata', draw, { once: true });
        if (video.readyState >= 2) draw();
        return;
      }
      const target = Math.min(
        Math.max(duration * POSTER_SEEK_FRACTION, POSTER_SEEK_MIN_S),
        POSTER_SEEK_MAX_S,
        // Never seek past the last moment we can still decode a frame at.
        Math.max(duration - 0.05, 0),
      );
      video.addEventListener('seeked', draw, { once: true });
      try {
        video.currentTime = target;
      } catch {
        draw();
      }
    }, { once: true });

    video.addEventListener('error', () => finishAndClear(null), { once: true });

    // muted + playsInline keep mobile browsers from blocking the decode, and
    // preload='auto' is what actually pulls enough data to draw a frame.
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.src = url;
  });
}

// ──────────────────────────────────────────────────────────────────
// Uploading
// ──────────────────────────────────────────────────────────────────

export type PreviewStage = 'capturing' | 'video' | 'poster' | 'saving' | 'done';

export interface PreviewProgress {
  stage: PreviewStage;
  /** 0–100 for the current stage. The video upload is the only long one. */
  percent: number;
  bytesTransferred: number;
  totalBytes: number;
}

export interface PreviewUploadOptions {
  /** Pre-captured metadata + poster. Pass the result of probeAndCapture when
   *  the UI already ran it (so the preview player and the upload agree on the
   *  same still); omit to have the upload capture one itself. */
  probe?: VideoProbe;
  /** A poster the developer supplied by hand — wins over the captured one. */
  posterOverride?: Blob | null;
  onProgress?: (p: PreviewProgress) => void;
}

export interface PreviewUploadHandle {
  result: Promise<GamePreview>;
  /** Abort an in-flight upload. The partially written object is cleaned up on
   *  the next successful upload (stale files under the prefix are pruned). */
  cancel: () => void;
}

/** File extension for the stored clip, normalized and whitelisted so a hostile
 *  filename can't smuggle a path segment into the storage key. */
function videoExt(file: File): string {
  const raw = (file.name.split('.').pop() || '').toLowerCase();
  return /^[a-z0-9]{2,5}$/.test(raw) ? raw : 'mp4';
}

/** Delete every object under the preview prefix except the ones just written.
 *  Handles the extension changing between uploads (an .mp4 replaced by a .webm
 *  writes a new key, leaving the old one orphaned) and cleans up any partial
 *  object left behind by a cancelled run. Best-effort by design — a failure
 *  here leaves cruft in the bucket but must not fail the upload. */
async function pruneStalePreviewFiles(slug: string, keep: string[]): Promise<void> {
  try {
    const listing = await listAll(storageRef(getHtmlStorage(), previewPrefix(slug)));
    await Promise.all(
      listing.items
        .filter((item) => !keep.includes(item.fullPath))
        .map((item) => deleteObject(item).catch(() => undefined)),
    );
  } catch {
    /* listing denied or prefix absent — nothing to prune */
  }
}

/**
 * Upload a preview clip for a game and point its doc at it.
 *
 * Returns a handle rather than a bare promise so the portal can offer a Cancel
 * button — preview clips are much larger than icons and an accidental 200 MB
 * upload should be abortable.
 */
export function uploadGamePreview(
  slug: string,
  file: File,
  options: PreviewUploadOptions = {},
): PreviewUploadHandle {
  const { probe, posterOverride, onProgress } = options;
  let cancelled = false;
  let cancelUpload: (() => void) | null = null;

  const report = (
    stage: PreviewStage,
    percent: number,
    bytesTransferred = 0,
    totalBytes = 0,
  ) => onProgress?.({ stage, percent, bytesTransferred, totalBytes });

  const run = async (): Promise<GamePreview> => {
    if (!slug) throw new Error('Missing game id.');

    // 1. Metadata + poster. Reuse the UI's capture when it has one so we don't
    //    decode the same file twice.
    let info: VideoProbe;
    if (probe) {
      info = probe;
    } else {
      report('capturing', 0);
      info = await probeAndCapture(file).catch(
        () => ({ width: 0, height: 0, durationMs: 0, poster: null }),
      );
    }
    if (cancelled) throw new PreviewCancelled();

    const poster = posterOverride ?? info.poster;

    // 2. The clip itself — the only stage worth a progress bar.
    const storage = getHtmlStorage();
    const videoPath = `${previewPrefix(slug)}/video.${videoExt(file)}`;
    const videoRef = storageRef(storage, videoPath);
    const contentType = file.type || 'video/mp4';

    await new Promise<void>((resolve, reject) => {
      const task = uploadBytesResumable(videoRef, file, {
        contentType,
        // Previews are immutable per upload (a replacement writes a new object
        // or overwrites this key and mints a fresh download token), so let CDNs
        // and the Flutter app's video cache hold onto them.
        cacheControl: 'public, max-age=604800',
      });
      cancelUpload = () => task.cancel();
      task.on(
        'state_changed',
        (snap) => {
          const pct = snap.totalBytes
            ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100)
            : 0;
          report('video', pct, snap.bytesTransferred, snap.totalBytes);
        },
        (error) => reject(cancelled ? new PreviewCancelled() : error),
        () => resolve(),
      );
    });
    cancelUpload = null;
    if (cancelled) throw new PreviewCancelled();

    // 3. Poster (optional — a game with no decodable frame still gets a clip).
    let posterUrl = '';
    let posterPath = '';
    if (poster) {
      report('poster', 0);
      posterPath = `${previewPrefix(slug)}/poster.jpg`;
      const posterRef = storageRef(storage, posterPath);
      try {
        await new Promise<void>((resolve, reject) => {
          const task = uploadBytesResumable(posterRef, poster, {
            contentType: 'image/jpeg',
            cacheControl: 'public, max-age=604800',
          });
          task.on('state_changed', undefined, reject, () => resolve());
        });
        posterUrl = await getDownloadURL(posterRef);
      } catch {
        // A failed poster must not sink a successful video upload.
        posterUrl = '';
        posterPath = '';
      }
      report('poster', 100);
    }

    const videoUrl = await getDownloadURL(videoRef);

    // 4. Point the game doc at the new preview.
    report('saving', 0);
    await updateDoc(doc(getDb(), COLLECTION, slug), {
      previewUrl: videoUrl,
      previewPosterUrl: posterUrl,
      previewVideoPath: videoPath,
      previewPosterPath: posterPath,
      previewMimeType: contentType,
      previewDurationMs: info.durationMs,
      previewWidth: info.width,
      previewHeight: info.height,
      previewSizeBytes: file.size,
      previewUpdatedAt: serverTimestamp(),
      // NB: updatedAt is intentionally NOT bumped. It drives "recently updated"
      // ordering on the hub, and adding a preview isn't a new build.
    });

    // 5. Drop anything left under the prefix from a previous clip or a
    //    cancelled run. After the doc write, so a failure here is harmless.
    await pruneStalePreviewFiles(slug, [videoPath, posterPath].filter(Boolean));

    report('done', 100);
    return {
      videoUrl,
      posterUrl,
      videoPath,
      posterPath,
      mimeType: contentType,
      durationMs: info.durationMs,
      width: info.width,
      height: info.height,
      sizeBytes: file.size,
      updatedAt: Date.now(),
    };
  };

  return {
    result: run(),
    cancel: () => {
      cancelled = true;
      cancelUpload?.();
    },
  };
}

/** Thrown when the developer aborts an upload. Callers should swallow it rather
 *  than surfacing it as an error. */
export class PreviewCancelled extends Error {
  constructor() {
    super('Upload cancelled.');
    this.name = 'PreviewCancelled';
  }
}

export function isCancelled(e: unknown): boolean {
  return (
    e instanceof PreviewCancelled ||
    (e instanceof Error && /storage\/canceled|cancell?ed/i.test(e.message))
  );
}

// ──────────────────────────────────────────────────────────────────
// Removal
// ──────────────────────────────────────────────────────────────────

/** Remove a game's preview: clear the doc fields first (so both clients fall
 *  back to the icon immediately), then delete the objects. Storage cleanup is
 *  best-effort — an orphaned file in the bucket is invisible to users, whereas
 *  a doc still pointing at a deleted object would render a broken player. */
export async function deleteGamePreview(slug: string): Promise<void> {
  if (!slug) return;
  await updateDoc(doc(getDb(), COLLECTION, slug), {
    previewUrl: '',
    previewPosterUrl: '',
    previewVideoPath: '',
    previewPosterPath: '',
    previewMimeType: '',
    previewDurationMs: 0,
    previewWidth: 0,
    previewHeight: 0,
    previewSizeBytes: 0,
    previewUpdatedAt: null,
  });
  await pruneStalePreviewFiles(slug, []);
}

// ──────────────────────────────────────────────────────────────────
// Display helpers (shared with whatever ends up rendering previews)
// ──────────────────────────────────────────────────────────────────

/** Human-readable byte count — mirrors the formatter on the manage page. */
export function formatBytes(n: number): string {
  if (!n) return '';
  if (n > 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n > 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
}

/** `0:07` / `1:23` from a millisecond duration. Empty when unknown. */
export function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Aspect ratio as a CSS-ready number, defaulting to 16:9 when the clip's
 *  dimensions weren't readable. */
export function previewAspect(preview: Pick<GamePreview, 'width' | 'height'>): number {
  return preview.width > 0 && preview.height > 0 ? preview.width / preview.height : 16 / 9;
}
