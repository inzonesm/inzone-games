'use client';

/* Upload pipeline — ported from inzone-games-upload/src/upload-pipeline.jsx
 * to TypeScript using the modular Firebase SDK.
 *
 * IDENTITY & VERSIONING
 * ─────────────────────
 * A game's identity is its Firestore doc id (the slug), minted once from the
 * title on first upload and immutable thereafter. Updates target an existing
 * game by `gameId` and never re-slugify, so the live URL is stable across
 * renames and new builds.
 *
 * Every build is stored under a per-game, per-version prefix so old builds
 * survive for rollback:
 *
 *   • .html / .zip HTML5 build → gs://inzone-html/games/<slug>/v<N>/...
 *       gameUrl = storage.googleapis.com/<bucket>/games/<slug>/v<N>/<entry>
 *       (public path-style URL, so relative refs in index.html resolve to
 *        siblings inside the iframe)
 *   • .zip / .unitypackage      → gs://inzone-html/games/<slug>/unity/v<N>/build.<ext>
 *       (tokenized URL; Firestore status=pending-unity-runtime)
 *   • icon                      → gs://inzone-html/games/<slug>/icon.<ext>
 *       (NOT versioned — it's display metadata, kept stable & prune-safe)
 *
 * Each shipped build also writes an immutable entry to the
 * `html_games/<slug>/versions/<vN>` subcollection (the changelog / rollback
 * source). Retention prunes build *files* beyond RETENTION_VERSIONS while
 * keeping the version metadata.
 */

import JSZip from 'jszip';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  deleteObject,
  getDownloadURL,
  listAll,
  ref as storageRef,
  uploadBytesResumable,
  type StorageReference,
} from 'firebase/storage';
import { getDb, getHtmlStorage, HTML_BUCKET } from './firebase';
import type { BuildType } from './types';

// ──────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────

export type Engine = 'html5' | 'unity';

/** How many recent versions keep their build files on disk. Older versions
 *  keep their changelog metadata but are pruned from storage (no rollback). */
export const RETENTION_VERSIONS = 10;

export interface RunOptions {
  htmlFile: File;
  iconFile?: File | null;
  gameTitle: string;
  description?: string;
  uploaderId: string;
  uploaderName?: string;
  /** Present → update an existing game (this is its slug / doc id). The title is
   *  NOT re-slugified and the engine is locked to the existing game's engine. */
  gameId?: string;
  /** Optional release note attached to this build's version entry. */
  note?: string;
  engine?: Engine;
  /** Optional WebSocket endpoint for multiplayer games (wss://…). Passed
   *  through to the iframe so clients know where to dial. */
  serverUrl?: string;
  onProgress?: (percent: number) => void;
  onStep?: (stepIndex: number, meta?: StepMeta) => void;
}

export interface StepMeta {
  slug?: string;
  engine?: Engine;
  isBundle?: boolean;
  isUpdate?: boolean;
  version?: number;
  message?: string;
  entryPath?: string;
  fileCount?: number;
  iconFound?: boolean;
  descriptionFound?: boolean;
}

export interface BundleStats {
  entryPath: string;
  fileCount: number;
}

export interface PipelineResult {
  slug: string;
  gameUrl: string;
  iconUrl: string;
  gameKey: string;
  liveUrl: string;
  groupChatId: string | null;
  source: 'local' | 'backend' | 'skipped';
  engine: Engine;
  isBundle: boolean;
  isUpdate: boolean;
  version: number;
  buildType: BuildType;
  bundleStats: BundleStats | null;
}

export interface BundleFile {
  path: string;
  blob: Blob;
  contentType: string;
}

export interface BundleManifest {
  files: BundleFile[];
  entryPath: string;
  iconPath: string | null;
  readmeText: string;
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

export const slugify = (value: string): string =>
  (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'game';

const MIME_BY_EXT: Record<string, string> = {
  html: 'text/html', htm: 'text/html',
  css: 'text/css',
  js: 'application/javascript', mjs: 'application/javascript', cjs: 'application/javascript',
  json: 'application/json', map: 'application/json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  ico: 'image/x-icon', bmp: 'image/bmp', avif: 'image/avif',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  eot: 'application/vnd.ms-fontobject',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
  mp4: 'video/mp4', webm: 'video/webm',
  txt: 'text/plain', md: 'text/markdown', xml: 'application/xml', csv: 'text/csv',
  wasm: 'application/wasm',
  glsl: 'text/plain', vert: 'text/plain', frag: 'text/plain',
  obj: 'text/plain', mtl: 'text/plain', coffee: 'text/plain',
  appcache: 'text/cache-manifest', manifest: 'text/cache-manifest',
};

function contentTypeFor(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  if (!m) return 'application/octet-stream';
  return MIME_BY_EXT[m[1].toLowerCase()] || 'application/octet-stream';
}

export function isZipBundle(file: File | null | undefined): boolean {
  return !!file && /\.zip$/i.test(file.name);
}

// storage.googleapis.com/<bucket>/<path> keeps '/' as a path separator, so
// relative URLs inside the served index.html resolve to sibling objects.
// (firebasestorage.googleapis.com/o/<percent-encoded-path> would not.)
function publicGcsUrl(path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `https://storage.googleapis.com/${HTML_BUCKET}/${encoded}`;
}

// Per-game storage layout. The single `games/<slug>/` root per game makes both
// cleanup (wipe the root) and the ownership storage rule (match the slug) clean.
const gameRoot = (slug: string): string => `games/${slug}`;
/** Build prefix for an HTML5 version (bundle files or the single page). */
const htmlVersionDir = (slug: string, version: number): string => `games/${slug}/v${version}`;
/** Build prefix for a Unity version (the opaque binary). */
const unityVersionDir = (slug: string, version: number): string => `games/${slug}/unity/v${version}`;

function genGameKey(slug: string): string {
  return `gk_${slug}_${Math.random().toString(36).slice(2, 8)}`;
}

// ──────────────────────────────────────────────────────────────────
// Bundle inspection (parse a .zip into uploadable files + metadata)
// ──────────────────────────────────────────────────────────────────

function isJunkPath(p: string): boolean {
  if (!p) return true;
  if (p.startsWith('__MACOSX/') || p.startsWith('.git/')) return true;
  const base = p.split('/').pop() ?? '';
  return base === '.DS_Store' || base === 'Thumbs.db' || base === '.gitignore';
}

// If every entry shares a single top-level folder (e.g. zipping `0hn0/`
// gave `0hn0/src/index.html`), strip it so storage paths stay clean.
function stripCommonRoot(paths: string[]): string {
  if (paths.length === 0) return '';
  const firstSegment = paths[0].split('/')[0];
  if (!firstSegment) return '';
  for (const p of paths) {
    if (p !== firstSegment && !p.startsWith(firstSegment + '/')) return '';
  }
  if (paths.every((p) => !p.includes('/'))) return '';
  return firstSegment + '/';
}

// Entry-point resolution: root index.html → src/index.html → shallowest
// index.html anywhere. Matches html5-games/ layouts.
function findEntryPath(paths: string[]): string | null {
  if (paths.includes('index.html')) return 'index.html';
  if (paths.includes('src/index.html')) return 'src/index.html';
  const candidates = paths.filter((p) => /(^|\/)index\.html?$/i.test(p));
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) => a.split('/').length - b.split('/').length || a.length - b.length,
  );
  return candidates[0];
}

function findIconPath(paths: string[]): string | null {
  const exts = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'];
  for (const ext of exts) {
    if (paths.includes(`logo.${ext}`)) return `logo.${ext}`;
  }
  for (const ext of exts) {
    const m = paths.find((p) => p.toLowerCase().endsWith(`/logo.${ext}`));
    if (m) return m;
  }
  return null;
}

function findReadmePath(paths: string[]): string | null {
  const names = ['README.md', 'readme.md', 'description.md', 'DESCRIPTION.md', 'Readme.md'];
  for (const n of names) {
    if (paths.includes(n)) return n;
    const m = paths.find((p) => p.endsWith('/' + n));
    if (m) return m;
  }
  return null;
}

export async function prepareGameBundle(zipFile: File): Promise<BundleManifest> {
  const zip = await JSZip.loadAsync(zipFile);

  const rawEntries: JSZip.JSZipObject[] = [];
  zip.forEach((_relPath, entry) => {
    if (!entry.dir) rawEntries.push(entry);
  });
  const entries = rawEntries.filter((e) => !isJunkPath(e.name));
  if (entries.length === 0) {
    throw new Error('EMPTY_BUNDLE: zip contained no usable files.');
  }

  const root = stripCommonRoot(entries.map((e) => e.name));
  const normalised = entries
    .map((e) => ({ entry: e, path: root ? e.name.slice(root.length) : e.name }))
    .filter((x) => x.path.length > 0);

  const paths = normalised.map((x) => x.path);
  const entryPath = findEntryPath(paths);
  if (!entryPath) {
    throw new Error(
      'NO_ENTRY_POINT: bundle has no index.html (looked at root, src/, and one level deeper).',
    );
  }

  const iconPath = findIconPath(paths);
  const readmePath = findReadmePath(paths);

  const files: BundleFile[] = await Promise.all(
    normalised.map(async ({ entry, path }) => ({
      path,
      blob: await entry.async('blob'),
      contentType: contentTypeFor(path),
    })),
  );

  let readmeText = '';
  if (readmePath) {
    const r = files.find((f) => f.path === readmePath);
    if (r) {
      try { readmeText = await r.blob.text(); } catch { readmeText = ''; }
    }
  }

  return { files, entryPath, iconPath, readmeText };
}

// ──────────────────────────────────────────────────────────────────
// Storage cleanup
// ──────────────────────────────────────────────────────────────────

/** Recursively delete every object under a storage prefix. Best-effort: a
 *  missing object/prefix is not an error. */
export async function wipeStoragePrefix(prefix: string): Promise<void> {
  const storage = getHtmlStorage();
  async function clear(ref: StorageReference): Promise<void> {
    let listing;
    try { listing = await listAll(ref); } catch { return; }
    await Promise.all([
      ...listing.items.map((r) => deleteObject(r).catch(() => undefined)),
      ...listing.prefixes.map((sub) => clear(sub)),
    ]);
  }
  try { await clear(storageRef(storage, prefix)); } catch { /* nothing to clean */ }
}

// ──────────────────────────────────────────────────────────────────
// HTML5 build upload (single page or multi-file bundle) → games/<slug>/v<N>/
// ──────────────────────────────────────────────────────────────────

/** Upload a single .html as the sole file of a version: games/<slug>/v<N>/index.html. */
async function uploadSingleHtml(
  file: File,
  destDir: string,
  onProgress?: (percent: number) => void,
): Promise<{ gameUrl: string }> {
  const storage = getHtmlStorage();
  const ref = storageRef(storage, `${destDir}/index.html`);
  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(ref, file, { contentType: 'text/html' });
    task.on(
      'state_changed',
      (snap) => onProgress?.(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      (err) => reject(err),
      () => resolve(),
    );
  });
  return { gameUrl: publicGcsUrl(`${destDir}/index.html`) };
}

interface UploadBundleArgs {
  files: BundleFile[];
  entryPath: string;
  destDir: string;
  onProgress?: (percent: number) => void;
}

/** Upload every file of a bundle under destDir (a fresh, version-scoped prefix,
 *  so no wipe is needed first). Returns the public entry URL. */
async function uploadBundleFiles(args: UploadBundleArgs): Promise<{ gameUrl: string }> {
  const storage = getHtmlStorage();
  const totalBytes = args.files.reduce((n, f) => n + f.blob.size, 0) || 1;
  let uploadedBytes = 0;

  const CONCURRENCY = 4;
  const queue = args.files.slice();
  async function worker(): Promise<void> {
    while (queue.length) {
      const f = queue.shift();
      if (!f) break;
      const ref = storageRef(storage, `${args.destDir}/${f.path}`);
      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(ref, f.blob, { contentType: f.contentType });
        task.on(
          'state_changed',
          (snap) => {
            if (args.onProgress) {
              const pct = ((uploadedBytes + snap.bytesTransferred) / totalBytes) * 100;
              args.onProgress(Math.min(99, pct));
            }
          },
          (err) => reject(err),
          () => { uploadedBytes += f.blob.size; resolve(); },
        );
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, args.files.length) }, worker));
  args.onProgress?.(100);

  return { gameUrl: publicGcsUrl(`${args.destDir}/${args.entryPath}`) };
}

// ──────────────────────────────────────────────────────────────────
// Unity build upload (opaque binary) → games/<slug>/unity/v<N>/build.<ext>
// ──────────────────────────────────────────────────────────────────

async function uploadUnityBuild(
  file: File,
  destDir: string,
  onProgress?: (percent: number) => void,
): Promise<{ gameUrl: string }> {
  const storage = getHtmlStorage();
  const extMatch = /\.([a-z0-9]+)$/i.exec(file.name || '');
  const ext = (extMatch ? extMatch[1] : 'zip').toLowerCase();
  const ref = storageRef(storage, `${destDir}/build.${ext}`);
  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(ref, file, {
      contentType:
        file.type ||
        (ext === 'unitypackage' ? 'application/octet-stream' : 'application/zip'),
    });
    task.on(
      'state_changed',
      (snap) => onProgress?.(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      (err) => reject(err),
      () => resolve(),
    );
  });
  const gameUrl = await getDownloadURL(ref);
  return { gameUrl };
}

// ──────────────────────────────────────────────────────────────────
// Icon upload → games/<slug>/icon.<ext>  (canonical, non-versioned)
// ──────────────────────────────────────────────────────────────────

/** Upload the canonical game icon from a picked File or a bundle's logo blob.
 *  Kept at a stable, non-versioned path so the icon survives version pruning and
 *  rollback. Returns '' when there's no icon source. */
async function uploadCanonicalIcon(
  slug: string,
  source: { blob: Blob; ext: string; contentType: string } | null,
): Promise<string> {
  if (!source) return '';
  const storage = getHtmlStorage();
  const ref = storageRef(storage, `${gameRoot(slug)}/icon.${source.ext}`);
  try { await deleteObject(ref); } catch { /* 404 is fine */ }
  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(ref, source.blob, { contentType: source.contentType });
    task.on('state_changed', undefined, reject, () => resolve());
  });
  return getDownloadURL(ref);
}

function iconSourceFromFile(file: File | null | undefined) {
  if (!file) return null;
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  return { blob: file, ext, contentType: file.type || contentTypeFor(`x.${ext}`) };
}

function iconSourceFromBundle(manifest: BundleManifest) {
  if (!manifest.iconPath) return null;
  const f = manifest.files.find((x) => x.path === manifest.iconPath);
  if (!f) return null;
  const ext = (manifest.iconPath.split('.').pop() || 'png').toLowerCase();
  return { blob: f.blob, ext, contentType: f.contentType || contentTypeFor(`x.${ext}`) };
}

// ──────────────────────────────────────────────────────────────────
// Firestore writes
// ──────────────────────────────────────────────────────────────────

interface WriteHtmlGameArgs {
  slug: string;
  name: string;
  description: string;
  gameUrl: string;
  iconUrl: string;
  uploaderId: string;
  isUpdate: boolean;
  engine: Engine;
  serverUrl: string;
  version: number;
  buildType: BuildType;
  entryPath: string;
  gameKey: string;
}

async function writeHtmlGame(data: WriteHtmlGameArgs): Promise<void> {
  const db = getDb();
  // Unity builds are stored alongside HTML5 games but kept out of the public
  // hub via status='pending-unity-runtime' until there's a runtime that can
  // actually run them.
  const status = data.engine === 'unity' ? 'pending-unity-runtime' : 'approved';
  const docData: Record<string, unknown> = {
    name: data.name,
    description: data.description || '',
    gameUrl: data.gameUrl,
    iconUrl: data.iconUrl || '',
    serverUrl: data.serverUrl || '',
    uploaderId: data.uploaderId,
    engine: data.engine,
    status,
    // `version` is the *active* build; `latestVersion` is the monotonic
    // high-water mark so a post-rollback upload never reuses a number.
    version: data.version,
    latestVersion: data.version,
    buildType: data.buildType,
    entryPath: data.entryPath || '',
    updatedAt: serverTimestamp(),
  };
  // createdAt and gameKey are written once, on create, and preserved across
  // updates by merge (so the developer's key stays stable).
  if (!data.isUpdate) {
    docData.createdAt = serverTimestamp();
    docData.gameKey = data.gameKey;
  }

  await setDoc(doc(db, 'html_games', data.slug), docData, { merge: true });
}

interface WriteVersionArgs {
  slug: string;
  version: number;
  gameUrl: string;
  iconUrl: string;
  buildType: BuildType;
  engine: Engine;
  entryPath: string;
  fileCount: number;
  sizeBytes: number;
  note: string;
  storagePrefix: string;
  uploaderId: string;
}

async function writeVersionDoc(data: WriteVersionArgs): Promise<void> {
  const db = getDb();
  await setDoc(doc(db, 'html_games', data.slug, 'versions', `v${data.version}`), {
    version: data.version,
    gameUrl: data.gameUrl,
    iconUrl: data.iconUrl || '',
    buildType: data.buildType,
    engine: data.engine,
    entryPath: data.entryPath || '',
    fileCount: data.fileCount,
    sizeBytes: data.sizeBytes,
    note: data.note || '',
    storagePrefix: data.storagePrefix,
    uploaderId: data.uploaderId,
    pruned: false,
    createdAt: serverTimestamp(),
  });
}

/** Drop build files for versions older than the retention window, keeping their
 *  changelog docs (marked `pruned`). Best-effort — never throws, never blocks
 *  the deploy. */
async function pruneOldVersions(slug: string, latest: number): Promise<void> {
  if (latest <= RETENTION_VERSIONS) return;
  const cutoff = latest - RETENTION_VERSIONS;
  try {
    const snap = await getDocs(collection(getDb(), 'html_games', slug, 'versions'));
    for (const d of snap.docs) {
      const v = d.data() as Record<string, unknown>;
      const num = Number(v.version);
      if (!v.pruned && num <= cutoff && typeof v.storagePrefix === 'string') {
        await wipeStoragePrefix(v.storagePrefix);
        await updateDoc(d.ref, { pruned: true }).catch(() => undefined);
      }
    }
  } catch {
    /* retention is best-effort */
  }
}

interface CreateGroupChatArgs {
  slug: string;
  name: string;
  description: string;
  gameUrl: string;
  iconUrl: string;
  uploaderId: string;
  uploaderName: string;
}

async function createGameGroupChat(data: CreateGroupChatArgs): Promise<string> {
  const db = getDb();
  const docId = `game_${data.slug}_${Date.now()}`;
  await setDoc(doc(db, 'groupChats', docId), {
    groupchat_name: `${data.name} Community`,
    bio: data.description || `Official community chat for ${data.name}`,
    user_ids: [data.uploaderId],
    usernames: [data.uploaderName || 'Developer'],
    ai_usernames: [],
    messages: [],
    date_created: serverTimestamp(),
    groupchat_doc_id: docId,

    name: `${data.name} Community`,
    description: data.description || `Play ${data.name} and chat with other players`,
    imageUrl: data.iconUrl || '',
    groupChatType: 'free',
    groupChatStatus: 'active',
    groupChatCategory: 'gaming',
    accessTier: 'Free',
    entryFee: 0,
    participants: [{
      uid: data.uploaderId,
      type: 'user',
      name: data.uploaderName || 'Developer',
    }],
    createdAt: serverTimestamp(),

    gameId: data.slug,
    gameUrl: data.gameUrl,
    iconUrl: data.iconUrl || '',
  });
  return docId;
}

// ──────────────────────────────────────────────────────────────────
// Lookups
// ──────────────────────────────────────────────────────────────────

export async function getExistingHtmlGame(slug: string): Promise<Record<string, unknown> | null> {
  try {
    const snap = await getDoc(doc(getDb(), 'html_games', slug));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch {
    return null;
  }
}

export async function listDeveloperHtmlGames(uploaderId: string): Promise<Array<Record<string, unknown>>> {
  try {
    const snap = await getDocs(
      query(collection(getDb(), 'html_games'), where('uploaderId', '==', uploaderId)),
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

/** Find a free slug for a NEW game: <base>, then <base>-2, <base>-3, … The
 *  dedicated update path (gameId) is the only way to overwrite an existing game,
 *  so new uploads never clobber — they always land on a fresh id. */
async function uniqueSlug(base: string): Promise<string> {
  let candidate = base;
  for (let n = 2; n < 60; n++) {
    if (!(await getExistingHtmlGame(candidate))) return candidate;
    candidate = `${base}-${n}`;
  }
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

// ──────────────────────────────────────────────────────────────────
// Full pipeline (create OR update)
// ──────────────────────────────────────────────────────────────────

export async function runUploadPipeline(opts: RunOptions): Promise<PipelineResult> {
  const step = opts.onStep ?? (() => {});
  const isUpdate = !!opts.gameId;

  // ── Resolve identity, engine, version, and game key ──────────────
  let slug: string;
  let engine: Engine;
  let version: number;
  let gameKey: string;
  let existingIconUrl = '';

  if (isUpdate) {
    slug = opts.gameId!;
    const existing = await getExistingHtmlGame(slug);
    if (!existing) {
      throw new Error('GAME_NOT_FOUND: no game with that id to update.');
    }
    if (existing.uploaderId && existing.uploaderId !== opts.uploaderId) {
      throw new Error('NOT_OWNER: you can only update games you uploaded.');
    }
    // Engine is locked to the existing game — you can't morph an HTML5 game into
    // a Unity build (the storage layout and runtime differ).
    engine = existing.engine === 'unity' ? 'unity' : 'html5';
    // Default to 1 for legacy (pre-versioning) games: their existing build is
    // implicitly v1, so the first update becomes v2.
    const prevLatest = Number(existing.latestVersion) || Number(existing.version) || 1;
    version = prevLatest + 1;
    gameKey = (existing.gameKey as string) || genGameKey(slug);
    existingIconUrl = (existing.iconUrl as string) || '';
  } else {
    slug = await uniqueSlug(slugify(opts.gameTitle));
    engine = opts.engine === 'unity' ? 'unity' : 'html5';
    version = 1;
    gameKey = genGameKey(slug);
  }

  const isBundle = engine === 'html5' && isZipBundle(opts.htmlFile);
  step(0, { slug, engine, isBundle, isUpdate, version });

  // ── Upload the build under its version-scoped prefix ─────────────
  let gameUrl = '';
  let iconUrl = '';
  let entryPath = '';
  let buildType: BuildType = 'single';
  let fileCount = 1;
  let sizeBytes = opts.htmlFile.size;
  let bundledDescription = '';
  let bundleStats: BundleStats | null = null;
  let storagePrefix: string;

  if (engine === 'unity') {
    buildType = 'unity';
    storagePrefix = unityVersionDir(slug, version);
    step(1, { message: isUpdate ? `Uploading Unity build v${version}` : 'Uploading Unity build' });
    const r = await uploadUnityBuild(opts.htmlFile, storagePrefix, opts.onProgress);
    gameUrl = r.gameUrl;

    step(2, { message: 'Uploading game icon' });
    iconUrl = await uploadCanonicalIcon(slug, iconSourceFromFile(opts.iconFile));
  } else if (isBundle) {
    buildType = 'bundle';
    storagePrefix = htmlVersionDir(slug, version);
    step(1, { message: 'Extracting game bundle' });
    const manifest = await prepareGameBundle(opts.htmlFile);
    entryPath = manifest.entryPath;
    fileCount = manifest.files.length;
    sizeBytes = manifest.files.reduce((n, f) => n + f.blob.size, 0);
    bundleStats = { entryPath: manifest.entryPath, fileCount: manifest.files.length };

    if (manifest.readmeText) {
      const cleaned = manifest.readmeText
        .replace(/^﻿/, '')
        .split(/\n\s*\n/)
        .map((p) => p.replace(/^#.*$/m, '').trim())
        .find((p) => p.length > 0);
      bundledDescription = cleaned || '';
    }

    step(1, {
      message: `Found ${manifest.files.length} files · entry ${manifest.entryPath}`,
      entryPath: manifest.entryPath,
      fileCount: manifest.files.length,
      iconFound: !!manifest.iconPath,
      descriptionFound: !!bundledDescription,
    });

    const uploaded = await uploadBundleFiles({
      files: manifest.files,
      entryPath: manifest.entryPath,
      destDir: storagePrefix,
      onProgress: opts.onProgress,
    });
    gameUrl = uploaded.gameUrl;

    // Canonical icon: an explicitly-picked file wins, else the bundle's logo.
    const iconSource = iconSourceFromFile(opts.iconFile) ?? iconSourceFromBundle(manifest);
    if (iconSource) {
      step(2, { message: opts.iconFile ? 'Uploading override icon' : `Icon found at ${manifest.iconPath}`, iconFound: true });
      iconUrl = await uploadCanonicalIcon(slug, iconSource);
    } else {
      step(2, { message: 'No icon in bundle', iconFound: false });
    }
  } else {
    buildType = 'single';
    storagePrefix = htmlVersionDir(slug, version);
    step(1, { message: 'Uploading game to Firebase Storage' });
    const r = await uploadSingleHtml(opts.htmlFile, storagePrefix, opts.onProgress);
    gameUrl = r.gameUrl;
    entryPath = 'index.html';

    step(2, { message: 'Uploading game icon' });
    iconUrl = await uploadCanonicalIcon(slug, iconSourceFromFile(opts.iconFile));
  }

  // On update with no new icon, keep the existing one rather than blanking it.
  if (!iconUrl && isUpdate) iconUrl = existingIconUrl;

  // ── Write Firestore: parent doc + immutable version entry ────────
  step(3, { message: isUpdate ? `Publishing v${version}` : 'Writing to html_games collection' });
  await writeHtmlGame({
    slug,
    name: opts.gameTitle,
    description: opts.description || bundledDescription || '',
    gameUrl,
    iconUrl,
    uploaderId: opts.uploaderId,
    isUpdate,
    engine,
    serverUrl: (opts.serverUrl || '').trim(),
    version,
    buildType,
    entryPath,
    gameKey,
  });

  await writeVersionDoc({
    slug,
    version,
    gameUrl,
    iconUrl,
    buildType,
    engine,
    entryPath,
    fileCount,
    sizeBytes,
    note: (opts.note || '').trim(),
    storagePrefix,
    uploaderId: opts.uploaderId,
  });

  // Drop build files older than the retention window (keeps the changelog).
  await pruneOldVersions(slug, version);

  // ── Community chat (created once, on the first upload) ───────────
  let groupChatId: string | null = null;
  if (!isUpdate && engine !== 'unity') {
    step(4, { message: 'Creating game community chat' });
    try {
      groupChatId = await createGameGroupChat({
        slug,
        name: opts.gameTitle,
        description: opts.description || '',
        gameUrl,
        iconUrl,
        uploaderId: opts.uploaderId,
        uploaderName: opts.uploaderName || 'Developer',
      });
    } catch (err) {
      // Group-chat creation is best-effort; the game still went live.
      console.warn('Group chat creation failed (non-fatal):', err);
    }
  } else if (engine === 'unity') {
    step(4, { message: 'Skipping group chat (Unity runtime pending)' });
  } else {
    step(4, { message: `Updated to v${version} · community chat unchanged` });
  }

  step(5, { message: isUpdate ? 'Update published' : 'Generating game key' });

  return {
    slug,
    gameUrl,
    iconUrl,
    gameKey,
    liveUrl: gameUrl,
    groupChatId,
    source: 'local',
    engine,
    isBundle,
    isUpdate,
    version,
    buildType,
    bundleStats,
  };
}
