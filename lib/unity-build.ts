'use client';

/* Client-side inspection of a dev's zipped Unity Addressables build.
 *
 * The dev zips the contents of their `ServerData/<platform>/` folder (the output
 * of Addressables → Build → New Build with a remote catalog enabled) and uploads
 * it. We parse it here — without a Unity runtime — to enumerate the bundles, find
 * the remote catalog, total the size, and surface problems early. We deliberately
 * do NOT parse the catalog's internal structure (its key/id encoding is opaque
 * and version-specific); the dev supplies the entry scene ADDRESS explicitly,
 * which is the scene they marked Addressable (e.g. Assets/Scenes/Foo/FooScene.unity).
 */

import JSZip from 'jszip';
import {
  CONTENT_TYPES,
  type UnityBuildFile,
  type UnityBuildInspection,
  type UnityFileKind,
  type UnityPlatform,
} from './unity-hub';

function isJunk(path: string): boolean {
  if (!path) return true;
  if (path.startsWith('__MACOSX/') || path.startsWith('.git/')) return true;
  const base = path.split('/').pop() ?? '';
  return base === '.DS_Store' || base === 'Thumbs.db';
}

/** If every entry shares one top-level folder, strip it (e.g. a zipped
 *  `iOS/` folder → `iOS/catalog.json`). Keeps flat filenames clean. */
function stripCommonRoot(paths: string[]): string {
  if (paths.length === 0) return '';
  const first = paths[0].split('/')[0];
  if (!first) return '';
  for (const p of paths) {
    if (p !== first && !p.startsWith(first + '/')) return '';
  }
  if (paths.every((p) => !p.includes('/'))) return '';
  return first + '/';
}

function classify(fileName: string): UnityFileKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.bundle')) return 'bundle';
  // Addressables 1.x writes catalog_*.json; 2.x writes binary catalog_*.bin.
  if (/^catalog.*\.(json|bin)$/.test(lower)) return 'catalog';
  if (lower.endsWith('.hash')) return 'hash';
  if (lower.endsWith('settings.json') || lower === 'settings.json') return 'settings';
  return 'other';
}

function contentTypeFor(kind: UnityFileKind, fileName: string): string {
  switch (kind) {
    case 'bundle': return CONTENT_TYPES.bundle;
    case 'catalog':
      return fileName.toLowerCase().endsWith('.json') ? CONTENT_TYPES.json : CONTENT_TYPES.bundle;
    case 'settings': return CONTENT_TYPES.json;
    case 'hash': return CONTENT_TYPES.hash;
    default: return 'application/octet-stream';
  }
}

export async function inspectAddressablesBuild(
  zipFile: File,
  platform: UnityPlatform,
): Promise<UnityBuildInspection> {
  const zip = await JSZip.loadAsync(zipFile);

  const entries: JSZip.JSZipObject[] = [];
  zip.forEach((_p, entry) => {
    if (!entry.dir && !isJunk(entry.name)) entries.push(entry);
  });
  if (entries.length === 0) {
    throw new Error('EMPTY_BUILD: the zip contained no usable files.');
  }

  const root = stripCommonRoot(entries.map((e) => e.name));
  const files: UnityBuildFile[] = await Promise.all(
    entries.map(async (entry) => {
      const buildPath = root ? entry.name.slice(root.length) : entry.name;
      const fileName = buildPath.split('/').pop() || buildPath;
      // Extract the content now — the blob is both the size source and the body
      // for the signed-URL PUT during publish.
      const blob = await entry.async('blob');
      const kind = classify(fileName);
      return { buildPath, fileName, size: blob.size, contentType: contentTypeFor(kind, fileName), kind, blob };
    }),
  );

  const bundleFiles = files.filter((f) => f.kind === 'bundle').map((f) => f.fileName);
  const catalog = files.find((f) => f.kind === 'catalog') ?? null;
  const hash = files.find((f) => f.kind === 'hash') ?? null;
  const totalBytes = files.reduce((n, f) => n + f.size, 0);

  const warnings: string[] = [];
  if (bundleFiles.length === 0) {
    warnings.push('No *.bundle files found — this does not look like an Addressables build.');
  }
  if (!catalog) {
    warnings.push(
      'No remote catalog (catalog_*.bin / catalog_*.json) found. Enable "Build Remote Catalog" ' +
        'in the Addressables settings and rebuild — the hub needs it to resolve your scenes.',
    );
  }
  // Flat layout requires the build to have been made with the inzone Remote.LoadPath.
  // We cannot verify the baked URLs here, so we remind rather than block.
  warnings.push(
    `Confirm the build used Remote.LoadPath = https://storage.googleapis.com/inzone-unity-bundles/${platform}`,
  );

  return {
    platform,
    files,
    bundleFiles,
    catalogFile: catalog?.fileName ?? null,
    hashFile: hash?.fileName ?? null,
    totalBytes,
    warnings,
  };
}
