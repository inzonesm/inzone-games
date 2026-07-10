/* Server-only Firebase Admin init. NEVER import this from a 'use client' module.
 *
 * Used by the Unity publish route to (1) mint V4 signed upload URLs for the
 * gs://inzone-unity-bundles bucket and (2) write the `unityGames` Firestore doc —
 * both privileged operations the client Web SDK is denied by the security rules.
 *
 * Credentials: set FIREBASE_SERVICE_ACCOUNT to the service-account JSON (raw or
 * base64) in the server environment (Vercel project env / .env.local — NOT
 * NEXT_PUBLIC_*, so it never reaches the browser). Falls back to Application
 * Default Credentials when unset. Use the same Firebase Admin service account as
 * the manual scripts (project inzone-f93e4) with Storage Object Admin on the
 * inzone-unity-bundles bucket.
 */

import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App,
} from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { UNITY_BUNDLES_BUCKET } from './unity-hub';

let cached: App | undefined;

function adminApp(): App {
  if (cached) return cached;
  if (getApps().length) {
    cached = getApps()[0];
    return cached;
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  const credential = raw
    ? cert(JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')))
    : applicationDefault();
  cached = initializeApp({ credential, projectId: 'inzone-f93e4' });
  return cached;
}

export function adminAuth(): Auth {
  return getAuth(adminApp());
}

export function adminDb(): Firestore {
  return getFirestore(adminApp());
}

/** The gs://inzone-unity-bundles bucket (the app's Unity content storage). */
export function unityBundlesBucket() {
  return getStorage(adminApp()).bucket(UNITY_BUNDLES_BUCKET);
}
