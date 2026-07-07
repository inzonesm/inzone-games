'use client';

/* Client half of the Unity-hub publish flow (the counterpart of
 * app/api/unity-publish/route.ts):
 *
 *   1. inspect  — parse the zipped Addressables build (lib/unity-build.ts)
 *   2. sign     — ask the server for V4 signed PUT URLs (needs the dev's ID token)
 *   3. upload   — PUT each bundle/catalog/hash DIRECTLY to gs://inzone-unity-bundles
 *                 (XHR for real progress; bypasses any serverless body limit)
 *   4. commit   — server verifies the objects landed, then writes the unityGames doc
 *
 * Returns a PipelineResult so the upload page can render the same success UI it
 * uses for HTML5 games.
 */

import { inspectAddressablesBuild } from './unity-build';
import { slugify, type PipelineResult } from './upload-pipeline';
import type {
  CommitRequest,
  CommitResponse,
  SignRequest,
  SignResponse,
  UnityPlatform,
} from './unity-hub';
import { unityBucketBase } from './unity-hub';

export interface UnityPublishOptions {
  zipFile: File;
  gameTitle: string;
  description?: string;
  /** Addressable address of the entry scene, e.g. "Assets/Scenes/Foo/FooScene.unity". */
  sceneAddress: string;
  category?: string;
  /** Present → update this existing game (its slug / doc id). */
  gameId?: string;
  /** Firebase ID token of the signed-in developer (route auth). */
  idToken: string;
  platform?: UnityPlatform;
  onProgress?: (percent: number) => void;
  onStep?: (stepIndex: number, meta?: { message?: string }) => void;
}

async function postJson<T>(body: SignRequest | CommitRequest, idToken: string): Promise<T> {
  const res = await fetch('/api/unity-publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`UNITY_PUBLISH_${payload.error || res.status}`);
  }
  return payload as T;
}

/** PUT one blob to a signed URL with byte-level progress via XHR. */
function putWithProgress(
  url: string,
  blob: Blob,
  contentType: string,
  onBytes: (sent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => onBytes(e.loaded);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`UPLOAD_FAILED_HTTP_${xhr.status}`));
    xhr.onerror = () => reject(new Error('UPLOAD_FAILED_NETWORK (is bucket CORS configured?)'));
    xhr.send(blob);
  });
}

export async function runUnityPublishPipeline(opts: UnityPublishOptions): Promise<PipelineResult> {
  const step = opts.onStep ?? (() => {});
  const platform = opts.platform ?? 'iOS';
  const isUpdate = !!opts.gameId;
  const slug = opts.gameId || slugify(opts.gameTitle);
  const version = 1; // monotonic versioning for unity docs can come later; commit merges.

  // ── 1. Inspect the Addressables build ────────────────────────────
  step(0, { message: 'Inspecting Addressables build' });
  const inspection = await inspectAddressablesBuild(opts.zipFile, platform);
  if (inspection.bundleFiles.length === 0) {
    throw new Error(
      'NO_BUNDLES: this zip has no *.bundle files. Zip the CONTENTS of your ServerData/iOS folder ' +
        '(Addressables → Build → New Build), not a player build.',
    );
  }
  if (!inspection.catalogFile) {
    throw new Error(
      'NO_REMOTE_CATALOG: no catalog_*.json found. Enable "Build Remote Catalog" in Addressables ' +
        'settings and rebuild — the hub needs it to resolve your scenes.',
    );
  }
  step(1, {
    message: `Found ${inspection.bundleFiles.length} bundle(s) + catalog · ${(inspection.totalBytes / 1e6).toFixed(1)} MB`,
  });

  // ── 2. Get signed upload URLs ─────────────────────────────────────
  const uploadables = inspection.files.filter(
    (f) => f.kind === 'bundle' || f.kind === 'catalog' || f.kind === 'hash',
  );
  const signRes = await postJson<SignResponse>(
    {
      action: 'sign',
      platform,
      slug,
      version,
      files: uploadables.map((f) => ({ name: f.fileName, contentType: f.contentType, kind: f.kind })),
    },
    opts.idToken,
  );

  // ── 3. Direct PUTs to GCS with aggregate progress ─────────────────
  step(2, { message: 'Uploading to inzone-unity-bundles' });
  const totalBytes = uploadables.reduce((n, f) => n + f.size, 0) || 1;
  const sentByFile = new Map<string, number>();
  const report = () => {
    let sent = 0;
    sentByFile.forEach((n) => { sent += n; });
    opts.onProgress?.(Math.min(99, Math.round((sent / totalBytes) * 100)));
  };
  const CONCURRENCY = 3;
  const queue = [...signRes.targets];
  async function worker(): Promise<void> {
    for (;;) {
      const target = queue.shift();
      if (!target) return;
      const file = uploadables.find((f) => f.fileName === target.name);
      if (!file) throw new Error(`INTERNAL: signed target ${target.name} has no local file`);
      await putWithProgress(target.uploadUrl, file.blob, target.contentType, (sent) => {
        sentByFile.set(target.name, sent);
        report();
      });
      sentByFile.set(target.name, file.size);
      report();
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  opts.onProgress?.(100);

  // ── 4. Commit: verify + write the unityGames doc ──────────────────
  step(3, { message: 'Publishing to the game hub' });
  // Entry bundle: the largest one (best offline coverage; the rest stream via catalog).
  const entryBundle = uploadables
    .filter((f) => f.kind === 'bundle')
    .sort((a, b) => b.size - a.size)[0];
  const commitRes = await postJson<CommitResponse>(
    {
      action: 'commit',
      platform,
      slug,
      version,
      doc: {
        title: opts.gameTitle,
        description: opts.description || '',
        category: opts.category || 'Community',
        thumbnailUrl: '',
        bannerUrl: '',
        sceneName: opts.sceneAddress.trim(),
        bundleFile: entryBundle.fileName,
        bundleSizeBytes: entryBundle.size,
        catalogFile: signRes.catalogFile || '',
        sizeMb: Math.round(inspection.totalBytes / 1e6),
        version: '1.0',
        isActive: true,
      },
      expectObjects: signRes.targets.map((t) => t.objectName),
    },
    opts.idToken,
  );

  step(5, { message: 'Published to the Unity game hub' });
  const catalogUrl = `${unityBucketBase(platform)}/${signRes.catalogFile}`;
  return {
    slug: commitRes.gameId,
    gameUrl: catalogUrl,
    iconUrl: '',
    gameKey: `unity_${commitRes.gameId}`,
    liveUrl: catalogUrl,
    groupChatId: null,
    source: 'local',
    engine: 'unity',
    isBundle: true,
    isUpdate,
    version,
    buildType: 'unity',
    bundleStats: { entryPath: opts.sceneAddress.trim(), fileCount: uploadables.length },
  };
}
