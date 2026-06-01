'use client';

/* Upload pipeline — ported from inzone-games-upload/src/upload-pipeline.jsx
 * to TypeScript using the modular Firebase SDK. Three input shapes:
 *
 *   • Single .html file        → gs://inzone-html/<slug>.html  (tokenized URL)
 *   • .zip HTML5 bundle        → gs://inzone-html/<slug>/...   (public GCS URL)
 *   • .zip / .unitypackage     → gs://inzone-html/<slug>.<ext> (tokenized URL,
 *     [engine: 'unity']           Firestore doc status=pending-unity-runtime)
 *
 * The bundle path's `gameUrl` is the public path-style URL
 * `storage.googleapis.com/<bucket>/<slug>/<entry>` so relative URLs inside
 * the served index.html resolve to sibling objects in the iframe.
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

// ──────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────

export type Engine = 'html5' | 'unity';

export interface RunOptions {
  htmlFile: File;
  iconFile?: File | null;
  gameTitle: string;
  description?: string;
  uploaderId: string;
  uploaderName?: string;
  isUpdate?: boolean;
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

// ──────────────────────────────────────────────────────────────────
// Single-file HTML upload (legacy path)
// ──────────────────────────────────────────────────────────────────

async function uploadGameHtml(
  file: File,
  slug: string,
  onProgress?: (percent: number) => void,
): Promise<{ gameUrl: string; storageRef: StorageReference }> {
  const storage = getHtmlStorage();
  const ref = storageRef(storage, `${slug}.html`);

  try { await deleteObject(ref); } catch { /* 404 is fine */ }

  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(ref, file, { contentType: 'text/html' });
    task.on(
      'state_changed',
      (snap) => {
        const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
        onProgress?.(Math.round(pct));
      },
      (err) => reject(err),
      async () => {
        const gameUrl = await getDownloadURL(ref);
        resolve({ gameUrl, storageRef: ref });
      },
    );
  });
}

// ──────────────────────────────────────────────────────────────────
// Bundle path (multi-file zip)
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

// Delete every object under <slug>/ best-effort so stale assets don't linger
// after an update.
async function wipeBundlePrefix(slug: string): Promise<void> {
  const storage = getHtmlStorage();
  async function clear(ref: StorageReference): Promise<void> {
    let listing;
    try { listing = await listAll(ref); } catch { return; }
    await Promise.all([
      ...listing.items.map((r) => deleteObject(r).catch(() => undefined)),
      ...listing.prefixes.map((sub) => clear(sub)),
    ]);
  }
  try { await clear(storageRef(storage, slug)); } catch { /* nothing to clean */ }
}

interface UploadFilesArgs {
  files: BundleFile[];
  entryPath: string;
  iconPath: string | null;
  slug: string;
  onProgress?: (percent: number) => void;
}

export async function uploadBundleFiles(args: UploadFilesArgs): Promise<{ gameUrl: string; iconUrl: string }> {
  const storage = getHtmlStorage();
  await wipeBundlePrefix(args.slug);

  const totalBytes = args.files.reduce((n, f) => n + f.blob.size, 0) || 1;
  let uploadedBytes = 0;

  const CONCURRENCY = 4;
  const queue = args.files.slice();
  async function worker(): Promise<void> {
    while (queue.length) {
      const f = queue.shift();
      if (!f) break;
      const ref = storageRef(storage, `${args.slug}/${f.path}`);
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

  return {
    gameUrl: publicGcsUrl(`${args.slug}/${args.entryPath}`),
    iconUrl: args.iconPath ? publicGcsUrl(`${args.slug}/${args.iconPath}`) : '',
  };
}

// ──────────────────────────────────────────────────────────────────
// Unity path (opaque binary)
// ──────────────────────────────────────────────────────────────────

async function uploadUnityBuild(
  file: File,
  slug: string,
  onProgress?: (percent: number) => void,
): Promise<{ gameUrl: string; storageRef: StorageReference }> {
  const storage = getHtmlStorage();
  const extMatch = /\.([a-z0-9]+)$/i.exec(file.name || '');
  const ext = (extMatch ? extMatch[1] : 'zip').toLowerCase();
  const ref = storageRef(storage, `${slug}.${ext}`);

  try { await deleteObject(ref); } catch { /* 404 is fine */ }

  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(ref, file, {
      contentType:
        file.type ||
        (ext === 'unitypackage' ? 'application/octet-stream' : 'application/zip'),
    });
    task.on(
      'state_changed',
      (snap) => {
        const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
        onProgress?.(Math.round(pct));
      },
      (err) => reject(err),
      async () => {
        const gameUrl = await getDownloadURL(ref);
        resolve({ gameUrl, storageRef: ref });
      },
    );
  });
}

// ──────────────────────────────────────────────────────────────────
// Icon upload (single file)
// ──────────────────────────────────────────────────────────────────

async function uploadGameIcon(
  file: File | null,
  slug: string,
): Promise<{ iconUrl: string }> {
  if (!file) return { iconUrl: '' };
  const storage = getHtmlStorage();
  const ext = (file.name || 'icon.jpg').split('.').pop() || 'jpg';
  const ref = storageRef(storage, `${slug}-icon.${ext}`);

  try { await deleteObject(ref); } catch { /* 404 is fine */ }

  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(ref, file, {
      contentType: file.type || 'image/jpeg',
    });
    task.on('state_changed', undefined, reject, () => resolve());
  });
  const iconUrl = await getDownloadURL(ref);
  return { iconUrl };
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
  isUpdate?: boolean;
  engine: Engine;
  serverUrl: string;
}

async function writeHtmlGame(data: WriteHtmlGameArgs): Promise<string> {
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
  };
  if (data.isUpdate) docData.updatedAt = serverTimestamp();
  else docData.createdAt = serverTimestamp();

  await setDoc(doc(db, 'html_games', data.slug), docData, { merge: true });
  return data.slug;
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
// Full pipeline
// ──────────────────────────────────────────────────────────────────

export async function runUploadPipeline(opts: RunOptions): Promise<PipelineResult> {
  const slug = slugify(opts.gameTitle);
  const step = opts.onStep ?? (() => {});
  const engine: Engine = opts.engine === 'unity' ? 'unity' : 'html5';
  const isBundle = engine === 'html5' && isZipBundle(opts.htmlFile);

  step(0, { slug, engine, isBundle });

  let gameUrl = '';
  let iconUrl = '';
  let bundledDescription = '';
  let bundleStats: BundleStats | null = null;

  if (engine === 'unity') {
    step(1, { message: 'Uploading Unity build' });
    const r = await uploadUnityBuild(opts.htmlFile, slug, opts.onProgress);
    gameUrl = r.gameUrl;

    step(2, { message: 'Uploading game icon' });
    const i = await uploadGameIcon(opts.iconFile ?? null, slug);
    iconUrl = i.iconUrl;
  } else if (isBundle) {
    step(1, { message: 'Extracting game bundle' });
    const manifest = await prepareGameBundle(opts.htmlFile);
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
      iconPath: manifest.iconPath,
      slug,
      onProgress: opts.onProgress,
    });
    gameUrl = uploaded.gameUrl;
    iconUrl = uploaded.iconUrl;

    if (opts.iconFile) {
      step(2, { message: 'Uploading override icon', iconFound: true });
      const r = await uploadGameIcon(opts.iconFile, slug);
      if (r.iconUrl) iconUrl = r.iconUrl;
    } else {
      step(2, {
        message: manifest.iconPath ? `Icon found at ${manifest.iconPath}` : 'No icon in bundle',
        iconFound: !!manifest.iconPath,
      });
    }
  } else {
    step(1, { message: 'Uploading game to Firebase Storage' });
    const r = await uploadGameHtml(opts.htmlFile, slug, opts.onProgress);
    gameUrl = r.gameUrl;

    step(2, { message: 'Uploading game icon' });
    const i = await uploadGameIcon(opts.iconFile ?? null, slug);
    iconUrl = i.iconUrl;
  }

  step(3, { message: 'Writing to html_games collection' });
  await writeHtmlGame({
    slug,
    name: opts.gameTitle,
    description: opts.description || bundledDescription || '',
    gameUrl,
    iconUrl,
    uploaderId: opts.uploaderId,
    isUpdate: opts.isUpdate,
    engine,
    serverUrl: (opts.serverUrl || '').trim(),
  });

  let groupChatId: string | null = null;
  if (!opts.isUpdate && engine !== 'unity') {
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
    step(4, { message: 'Skipping group chat (update)' });
  }

  // The optional backend register has no Next.js implementation; generate a
  // local game key instead. When the backend lands, replace this block with
  // a real fetch() and mark source: 'backend' on success.
  step(5, { message: 'Generating game key' });
  const gameKey = `gk_${slug}_${Math.random().toString(36).slice(2, 8)}`;

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
    bundleStats,
  };
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
