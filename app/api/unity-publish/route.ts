/* POST /api/unity-publish — the portal → Unity-hub bridge.
 *
 * Two actions, both requiring a signed-in developer (Firebase ID token in the
 * Authorization header):
 *
 *   { action: 'sign',  ... }  → returns short-lived V4 signed PUT URLs so the
 *      client can upload the Addressables build (bundles + catalog + hash)
 *      DIRECTLY to gs://inzone-unity-bundles (bypassing serverless body limits).
 *      The catalog `.json`/`.hash` are renamed to a per-game-unique stem so the
 *      flat layout stays collision-free.
 *
 *   { action: 'commit', ... } → verifies the uploaded objects exist, then writes
 *      the `unityGames` Firestore doc (Admin SDK) so the game appears in the hub.
 *      Ownership is enforced: a slug can only be (re)published by its uploader.
 *
 * Why a server route at all: `unityGames` writes are backend-only in the security
 * rules, and the bucket isn't in the portal's client Firebase config. The signed
 * URLs are minted with the service account's private key (no extra IAM needed).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { adminAuth, adminDb, unityBundlesBucket } from '@/lib/firebase-admin';
import {
  UNITY_GAMES_COLLECTION,
  catalogStem,
  unityBucketBase,
  unityObjectName,
  type CommitRequest,
  type CommitResponse,
  type SignRequest,
  type SignResponse,
  type SignedTarget,
  type UnityPlatform,
} from '@/lib/unity-hub';

export const runtime = 'nodejs';

const SIGN_TTL_MS = 15 * 60 * 1000;
// Local-dev escape hatch ONLY: skip ID-token verification. Never set in prod.
const ALLOW_UNAUTH = process.env.UNITY_PUBLISH_ALLOW_UNAUTH === '1';

function bad(code: string, status = 400) {
  return NextResponse.json({ error: code }, { status });
}
function isPlatform(p: unknown): p is UnityPlatform {
  return p === 'iOS' || p === 'Android';
}

/** Resolve the developer uid from the Bearer ID token (or '' in unauth dev mode). */
async function requireUid(req: NextRequest): Promise<string | null> {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return ALLOW_UNAUTH ? 'dev-unauth' : null;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

/** Final flat object name for a build file (catalog/hash renamed per-game).
 *  The catalog keeps its original extension — Addressables 1.x ships .json,
 *  2.x ships binary .bin, and the runtime loads either by URL. */
function finalObjectName(
  platform: UnityPlatform,
  slug: string,
  version: number,
  file: { name: string; kind: string },
): string {
  const stem = catalogStem(slug, version);
  if (file.kind === 'catalog') {
    const dot = file.name.lastIndexOf('.');
    const ext = dot >= 0 ? file.name.slice(dot) : '.bin';
    return unityObjectName(platform, `${stem}${ext}`);
  }
  if (file.kind === 'hash') return unityObjectName(platform, `${stem}.hash`);
  return unityObjectName(platform, file.name);
}

export async function POST(req: NextRequest) {
  const uid = await requireUid(req);
  if (!uid) return bad('UNAUTHENTICATED', 401);

  let body: SignRequest | CommitRequest;
  try {
    body = await req.json();
  } catch {
    return bad('INVALID_JSON');
  }

  if (body.action === 'sign') return handleSign(body, uid);
  if (body.action === 'commit') return handleCommit(body, uid);
  return bad('UNKNOWN_ACTION');
}

async function assertOwner(slug: string, uid: string): Promise<NextResponse | null> {
  const snap = await adminDb().collection(UNITY_GAMES_COLLECTION).doc(slug).get();
  if (snap.exists && snap.get('uploaderId') && snap.get('uploaderId') !== uid) {
    return bad('NOT_OWNER', 403);
  }
  return null;
}

async function handleSign(body: SignRequest, uid: string): Promise<NextResponse> {
  if (!isPlatform(body.platform)) return bad('BAD_PLATFORM');
  if (!body.slug || !Number.isInteger(body.version)) return bad('BAD_IDENTITY');
  if (!Array.isArray(body.files) || body.files.length === 0) return bad('NO_FILES');

  const ownerErr = await assertOwner(body.slug, uid);
  if (ownerErr) return ownerErr;

  const bucket = unityBundlesBucket();
  const expires = Date.now() + SIGN_TTL_MS;
  let catalogFile: string | null = null;

  const targets: SignedTarget[] = await Promise.all(
    body.files
      // Only the app-relevant artifacts are published; anything else is ignored.
      .filter((f) => f.kind === 'bundle' || f.kind === 'catalog' || f.kind === 'hash')
      .map(async (f) => {
        const objectName = finalObjectName(body.platform, body.slug, body.version, f);
        if (f.kind === 'catalog') catalogFile = objectName.split('/').pop() || null;
        const [uploadUrl] = await bucket.file(objectName).getSignedUrl({
          version: 'v4',
          action: 'write',
          expires,
          contentType: f.contentType,
        });
        return {
          name: f.name,
          objectName,
          publicUrl: `${unityBucketBase(body.platform)}/${objectName.split('/').pop()}`,
          uploadUrl,
          contentType: f.contentType,
        };
      }),
  );

  const res: SignResponse = { targets, catalogFile };
  return NextResponse.json(res);
}

async function handleCommit(body: CommitRequest, uid: string): Promise<NextResponse> {
  if (!isPlatform(body.platform)) return bad('BAD_PLATFORM');
  if (!body.slug || !body.doc) return bad('BAD_REQUEST');
  const { doc } = body;
  if (!doc.sceneName?.trim()) return bad('MISSING_SCENE_NAME');
  if (!doc.bundleFile?.trim()) return bad('MISSING_BUNDLE_FILE');

  const ownerErr = await assertOwner(body.slug, uid);
  if (ownerErr) return ownerErr;

  // Verify every promised object actually landed in the bucket before publishing.
  const bucket = unityBundlesBucket();
  const missing: string[] = [];
  await Promise.all(
    (body.expectObjects || []).map(async (name) => {
      const [exists] = await bucket.file(name).exists();
      if (!exists) missing.push(name);
    }),
  );
  if (missing.length) {
    return NextResponse.json({ error: 'OBJECTS_MISSING', missing }, { status: 409 });
  }

  const ref = adminDb().collection(UNITY_GAMES_COLLECTION).doc(body.slug);
  const existing = await ref.get();
  const now = new Date();
  await ref.set(
    {
      ...doc,
      // sceneName must be the exact addressable address; trim stray whitespace
      // (the Terminal-demo bug was a trailing "\n").
      sceneName: doc.sceneName.trim(),
      uploaderId: uid,
      updatedAt: now,
      ...(existing.exists ? {} : { createdAt: now }),
    },
    { merge: true },
  );

  const res: CommitResponse = { ok: true, gameId: body.slug };
  return NextResponse.json(res);
}
