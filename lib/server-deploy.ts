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
}

export interface DeployResponse {
  deploymentId: string;
  flyApp: string;
  serverUrl: string;
}

/** Fire off a deploy. Resolves once the backend returns (after the build +
 *  rollout finish, which can be several minutes), or rejects on backend
 *  error. Use `subscribeToDeployment` in parallel to show live progress. */
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

  const form = new FormData();
  form.append('serverZip', req.serverZip, req.serverZip.name);
  form.append('gameSlug', req.gameSlug);

  const res = await fetch(`${STUDIO_API_BASE}/deploy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = body;
    try { detail = JSON.parse(body).error ?? body; } catch { /* leave as-is */ }
    throw new Error(`Deploy failed (HTTP ${res.status}): ${detail}`);
  }
  return (await res.json()) as DeployResponse;
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
 *  unsubscribe function. Fires once immediately with the current snapshot. */
export function subscribeToDeployment(
  deploymentId: string,
  cb: (snap: DeploymentSnapshot | null) => void,
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
  });
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

/** Live subscription to log lines as they're appended by the backend. */
export function subscribeToDeploymentLogs(
  deploymentId: string,
  cb: (lines: DeploymentLogLine[]) => void,
): () => void {
  const ref = collection(getDb(), 'server_deployments', deploymentId, 'logs');
  return onSnapshot(query(ref, orderBy('at', 'asc')), (qs) => {
    cb(qs.docs.map((d) => ({
      id: d.id,
      line: (d.data().line as string) ?? '',
      at: d.data().at as Timestamp | undefined,
    })));
  });
}
