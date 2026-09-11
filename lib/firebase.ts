'use client';

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import { HTML_BUCKET } from './game-hosting';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// The game-artifacts bucket is defined in lib/game-hosting.ts (server-safe
// module shared with the /gcs proxy route); re-exported here so existing
// imports keep working.
export { HTML_BUCKET };

let app: FirebaseApp | undefined;
let authInstance: Auth | undefined;
let dbInstance: Firestore | undefined;
let htmlStorageInstance: FirebaseStorage | undefined;
let emulatorsConnected = false;

function useFirebaseEmulator(): boolean {
  return process.env.NEXT_PUBLIC_FIREBASE_EMULATOR === '1';
}

function connectEmulatorsIfNeeded(auth: Auth, db: Firestore): void {
  if (emulatorsConnected || !useFirebaseEmulator()) return;
  emulatorsConnected = true;
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

function ensureApp(): FirebaseApp {
  if (typeof window === 'undefined') {
    throw new Error('Firebase client SDK can only be used in the browser.');
  }
  if (!firebaseConfig.apiKey || !firebaseConfig.appId) {
    throw new Error(
      'Missing Firebase web config. Copy .env.local.example to .env.local and fill in NEXT_PUBLIC_FIREBASE_API_KEY and NEXT_PUBLIC_FIREBASE_APP_ID.',
    );
  }
  if (!app) {
    app = getApps()[0] ?? initializeApp(firebaseConfig);
  }
  return app;
}

function ensureAuthAndDb(): { auth: Auth; db: Firestore } {
  const firebaseApp = ensureApp();
  if (!authInstance) authInstance = getAuth(firebaseApp);
  if (!dbInstance) dbInstance = getFirestore(firebaseApp);
  connectEmulatorsIfNeeded(authInstance, dbInstance);
  return { auth: authInstance, db: dbInstance };
}

export function getFirebaseAuth(): Auth {
  return ensureAuthAndDb().auth;
}

export function getDb(): Firestore {
  return ensureAuthAndDb().db;
}

/** Firebase Storage instance pointed at gs://inzone-html (game artifacts bucket). */
export function getHtmlStorage(): FirebaseStorage {
  if (!htmlStorageInstance) {
    htmlStorageInstance = getStorage(ensureApp(), `gs://${HTML_BUCKET}`);
  }
  return htmlStorageInstance;
}
