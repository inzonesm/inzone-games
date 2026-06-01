'use client';

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// The bucket that holds uploaded HTML5 games and Unity builds. Separate from
// the default project bucket so storage rules can be scoped (public read for
// the bundle path, authed writes only).
export const HTML_BUCKET = 'inzone-html';

let app: FirebaseApp | undefined;
let authInstance: Auth | undefined;
let dbInstance: Firestore | undefined;
let htmlStorageInstance: FirebaseStorage | undefined;

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

export function getFirebaseAuth(): Auth {
  if (!authInstance) authInstance = getAuth(ensureApp());
  return authInstance;
}

export function getDb(): Firestore {
  if (!dbInstance) dbInstance = getFirestore(ensureApp());
  return dbInstance;
}

/** Firebase Storage instance pointed at gs://inzone-html (game artifacts bucket). */
export function getHtmlStorage(): FirebaseStorage {
  if (!htmlStorageInstance) {
    htmlStorageInstance = getStorage(ensureApp(), `gs://${HTML_BUCKET}`);
  }
  return htmlStorageInstance;
}
