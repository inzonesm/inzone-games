'use client';

/* Client SDK for the InZone Studio backend.
 *
 * The backend (inzone-studio-backend) runs the deploy on InZone's Fly.io
 * org. From the browser's perspective we:
 *   1. POST the server zip + game slug + Firebase ID token to /deploy
 *   2. Receive a deploymentId and subscribe to its Firestore doc to see
 *      "extracting → building → live" progress with streamed log lines
 *   3. On 'live', the html_games/<slug>.serverUrl is already populated by
 *      the backend, so the upload page can resolve.
 *
 * Configure NEXT_PUBLIC_STUDIO_API_BASE in .env.local to point at the
 * backend (e.g. https://studio-api.inzone.gg). Empty/undefined disables
 * server-zip uploads gracefully (the input still renders but submits no-op).
 */

import { collection, doc, getDocs, onSnapshot, orderBy, query, type Timestamp } from 'firebase/firestore';
import { getFirebaseAuth, getDb } from './firebase';

export const STUDIO_API_BASE = (process.env.NEXT_PUBLIC_STUDIO_API_BASE ?? '').replace(/\/+$/, '');

export function studioApiConfigured(): boolean {
  return STUDIO_API_BASE.length > 0;
}

export type DeployStatus =
  | 'queued'
  | 'extracting'
  | 'validating'
  | 'building'
  | 'releasing'
  | 'live'
  | 'failed';

export interface DeploymentSnapshot {
  id: string;
  gameSlug: string;
  uploaderId: string;
  flyApp: string;
  status: DeployStatus;
  serverUrl?: string;
  error?: string;
  updatedAt?: Timestamp;
}

export interface DeploymentLogLine {
  id: string;
  line: string;
  at?: Timestamp;
}

export interface DeployRequest {
  serverZip: File;
  gameSlug: string;
  /** Fires with the deployment doc id before the upload starts, so the UI
   *  can subscribe to live status instead of waiting minutes for the POST
   *  to resolve. Backends that predate the client-supplied id mint their
   *  own — the id in the response stays authoritative. */
  onDeploymentId?: (deploymentId: string) => void;
  /** Streams upload progress in bytes. `loaded === total` means the zip has
   *  fully left the browser — the backend keeps the request open during the
   *  build after that, often for several minutes. */
  onUploadProgress?: (loaded: number, total: number) => void;
}

export interface DeployResponse {
  deploymentId: string;
  flyApp: string;
  serverUrl: string;
}

/** Fire off a deploy. Resolves once the backend returns (after the build +
 *  rollout finish, which can be several minutes), or rejects on backend
 *  error. Pass `onDeploymentId` + `subscribeToDeployment` to show live
 *  progress and `onUploadProgress` for the upload itself. */
export async function startServerDeploy(req: DeployRequest): Promise<DeployResponse> {
  if (!studioApiConfigured()) {
    throw new Error(
      'Studio backend not configured. Set NEXT_PUBLIC_STUDIO_API_BASE in .env.local.',
    );
  }
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to deploy a server.');
  const token = await user.getIdToken(/* forceRefresh */ false);

  // Generated client-side so the panel can watch the Firestore status doc
  // while this request is still in flight (matches the backend's own
  // randomBytes(8).hex format).
  const deploymentId = newDeploymentId();
  req.onDeploymentId?.(deploymentId);

  const form = new FormData();
  form.append('serverZip', req.serverZip, req.serverZip.name);
  form.append('gameSlug', req.gameSlug);
  form.append('deploymentId', deploymentId);

  // XMLHttpRequest instead of fetch: fetch can't observe request-body upload
  // progress, which is the bulk of the wait for large zips.
  return new Promise<DeployResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${STUDIO_API_BASE}/deploy`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) req.onUploadProgress?.(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as DeployResponse);
        } catch {
          reject(new Error('Deploy finished but the backend returned an unreadable response.'));
        }
        return;
      }
      let detail = xhr.responseText;
      try { detail = JSON.parse(xhr.responseText).error ?? detail; } catch { /* leave as-is */ }
      reject(new Error(`Deploy failed (HTTP ${xhr.status}): ${detail}`));
    };
    xhr.onerror = () => reject(new Error('Network error while uploading the server zip.'));
    xhr.send(form);
  });
}

function newDeploymentId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Tear down the Fly app(s) backing a game. Called before the game doc is
 *  deleted so removing a game never leaves a billed server running. Resolves
 *  with the destroyed app names; throws when the backend is unreachable or
 *  refuses — callers should treat that as "do not proceed with deletion". */
export async function destroyGameServer(gameSlug: string): Promise<{ destroyed: string[] }> {
  if (!studioApiConfigured()) {
    throw new Error(
      'This game has a multiplayer server, but the studio backend is not configured (NEXT_PUBLIC_STUDIO_API_BASE), so it can\'t be torn down.',
    );
  }
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to remove a game server.');
  const token = await user.getIdToken(/* forceRefresh */ false);

  const res = await fetch(`${STUDIO_API_BASE}/server/${encodeURIComponent(gameSlug)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = body;
    try { detail = JSON.parse(body).error ?? body; } catch { /* leave as-is */ }
    throw new Error(`Server teardown failed (HTTP ${res.status}): ${detail}`);
  }
  return (await res.json()) as { destroyed: string[] };
}

/** Subscribe to live status updates on a deployment doc. Returns the
 *  unsubscribe function. Fires once immediately with the current snapshot.
 *  `onError` fires if the listener dies (e.g. rules deny reads while the doc
 *  doesn't exist yet) — Firestore does not recover it; re-subscribe. */
export function subscribeToDeployment(
  deploymentId: string,
  cb: (snap: DeploymentSnapshot | null) => void,
  onError?: (err: Error) => void,
): () => void {
  const ref = doc(getDb(), 'server_deployments', deploymentId);
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) { cb(null); return; }
    const data = snap.data();
    cb({
      id: snap.id,
      gameSlug: data.gameSlug,
      uploaderId: data.uploaderId,
      flyApp: data.flyApp,
      status: data.status,
      serverUrl: data.serverUrl,
      error: data.error,
      updatedAt: data.updatedAt,
    });
  }, onError);
}

/** One-shot read of the log subcollection. For most UIs a single fetch
 *  after each status change is enough — logs don't change retroactively. */
export async function fetchDeploymentLogs(deploymentId: string): Promise<DeploymentLogLine[]> {
  const ref = collection(getDb(), 'server_deployments', deploymentId, 'logs');
  const snap = await getDocs(query(ref, orderBy('at', 'asc')));
  return snap.docs.map((d) => ({
    id: d.id,
    line: (d.data().line as string) ?? '',
    at: d.data().at as Timestamp | undefined,
  }));
}

/** Live subscription to log lines as they're appended by the backend.
 *  Same `onError` semantics as `subscribeToDeployment`. */
export function subscribeToDeploymentLogs(
  deploymentId: string,
  cb: (lines: DeploymentLogLine[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const ref = collection(getDb(), 'server_deployments', deploymentId, 'logs');
  return onSnapshot(query(ref, orderBy('at', 'asc')), (qs) => {
    cb(qs.docs.map((d) => ({
      id: d.id,
      line: (d.data().line as string) ?? '',
      at: d.data().at as Timestamp | undefined,
    })));
  }, onError);
}
