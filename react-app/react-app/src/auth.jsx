/* Firebase Authentication wrapper for InZone Studio.
 *
 * Mirrors the pattern used in inzone-influencer-hub (src/firebase.ts and
 * src/utils/authHelpers.ts): real Firebase Auth via the compat SDK, with the
 * `+web@` email convention so web users don't collide with the mobile app's
 * Firebase Auth records. Tokens are persisted via browserLocalPersistence so
 * a returning developer lands directly on the dashboard.
 *
 * Pre-req: firebase-app-compat, firebase-auth-compat, and
 * firebase-firestore-compat are loaded as <script> tags in index.html.
 */

const { useState, useEffect, useContext, createContext } = React;

const STORAGE_KEY = 'inzone.studio.auth.user';
const TOKEN_KEY = 'inzone.studio.auth.token';

const firebaseConfig = {
  apiKey: 'AIzaSyAtCxPBjXhZvv1DnGBALOvBDqfcIsxCMuo',
  authDomain: 'inzone-f93e4.firebaseapp.com',
  projectId: 'inzone-f93e4',
  storageBucket: 'inzone-f93e4.appspot.com',
};

// Initialize Firebase once. The compat namespace lives on window.firebase.
let firebaseApp = null;
let firebaseAuth = null;
let firebaseDb = null;
let firebaseHtmlStorage = null; // Firebase Storage pointed at the inzone-html bucket
try {
  if (window.firebase) {
    firebaseApp = window.firebase.apps?.length
      ? window.firebase.app()
      : window.firebase.initializeApp(firebaseConfig);
    firebaseAuth = window.firebase.auth();
    firebaseAuth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
    firebaseDb = window.firebase.firestore();
    // Storage for the inzone-html bucket (HTML games + icons)
    firebaseHtmlStorage = window.firebase.app().storage('gs://inzone-html');
  }
} catch (err) {
  console.error('Firebase init failed:', err);
}

/* `developer+web@studio.com` → `developer@studio.com`. */
const toOriginalEmail = (email) => (email || '').replace('+web@', '@');

/* `developer@studio.com` → `developer+web@studio.com`. */
const toWebEmail = (email) => {
  if (!email) return email;
  return email.includes('+web@') ? email : email.replace('@', '+web@');
};

const profileFromFirebaseUser = (fbUser, fallbackEmail) => {
  if (!fbUser) return null;
  const original = toOriginalEmail(fbUser.email || fallbackEmail || '');
  const displayName =
    fbUser.displayName ||
    (original ? original.split('@')[0] : 'developer');
  const initials = displayName
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || displayName.slice(0, 2).toUpperCase();
  return {
    uid: fbUser.uid,
    email: original,
    displayName,
    initials,
    photoURL: fbUser.photoURL || null,
    provider:
      fbUser.providerData?.[0]?.providerId?.replace('.com', '') || 'password',
  };
};

const readStored = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeStored = (user) => {
  if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  else localStorage.removeItem(STORAGE_KEY);
};

const AuthContext = createContext(null);

function AuthProvider({ children }) {
  // Hydrate from localStorage so the very first render doesn't flash signin
  // for an already-authenticated developer.
  const [user, setUser] = useState(() => readStored());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Sync with Firebase auth state.
  useEffect(() => {
    if (!firebaseAuth) return;
    const unsub = firebaseAuth.onAuthStateChanged(async (fbUser) => {
      if (!fbUser) {
        // Preserve any explicit local-stub session (design-review path
        // where we don't have Firebase popups available). Only clear
        // sessions that originated from Firebase.
        const stored = readStored();
        if (stored && stored.provider === 'local') {
          setUser(stored);
          return;
        }
        writeStored(null);
        localStorage.removeItem(TOKEN_KEY);
        setUser(null);
        return;
      }
      try {
        const idToken = await fbUser.getIdToken();
        localStorage.setItem(TOKEN_KEY, idToken);
      } catch {}
      const profile = profileFromFirebaseUser(fbUser);
      writeStored(profile);
      setUser(profile);
    });
    return () => unsub();
  }, []);

  /* Email + password sign-in. Tries `email+web@domain` first (matches the
   * mobile-vs-web partition the influencer hub uses); falls back to the raw
   * email if no web-record exists yet. */
  const signInWithEmail = async (email, password) => {
    if (!firebaseAuth) throw new Error('Firebase Auth is not initialised');
    const webEmail = toWebEmail(email);
    try {
      return await firebaseAuth.signInWithEmailAndPassword(webEmail, password);
    } catch (err) {
      const transient = [
        'auth/user-not-found',
        'auth/wrong-password',
        'auth/invalid-credential',
      ];
      if (transient.includes(err.code) && webEmail !== email) {
        return await firebaseAuth.signInWithEmailAndPassword(email, password);
      }
      throw err;
    }
  };

  /* New developer sign-up. Always writes to the +web@ partition. */
  const signUpWithEmail = async (email, password, displayName) => {
    if (!firebaseAuth) throw new Error('Firebase Auth is not initialised');
    const webEmail = toWebEmail(email);
    const credential = await firebaseAuth.createUserWithEmailAndPassword(webEmail, password);
    if (displayName && credential.user) {
      try { await credential.user.updateProfile({ displayName }); } catch {}
    }
    return credential;
  };

  const signInWithProvider = async (providerKey) => {
    if (!firebaseAuth || !window.firebase) {
      throw new Error('Firebase Auth is not initialised');
    }
    let provider;
    if (providerKey === 'google') {
      provider = new window.firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
    } else if (providerKey === 'apple') {
      provider = new window.firebase.auth.OAuthProvider('apple.com');
      provider.addScope('email');
      provider.addScope('name');
    } else if (providerKey === 'github') {
      provider = new window.firebase.auth.GithubAuthProvider();
    } else {
      throw new Error(`Unknown provider: ${providerKey}`);
    }
    return await firebaseAuth.signInWithPopup(provider);
  };

  /* signIn({ email, password }) for password flow, signIn({ provider }) for SSO.
   * Throws on failure so the UI can show the error. */
  const signIn = async ({ email, password, provider, mode } = {}) => {
    setLoading(true);
    setError(null);
    try {
      if (provider) {
        await signInWithProvider(provider);
      } else if (mode === 'signup') {
        await signUpWithEmail(email, password);
      } else if (email && password) {
        await signInWithEmail(email, password);
      } else {
        // No Firebase credentials supplied — fall back to a local stub session
        // so the design-review preview keeps working when Firebase isn't
        // reachable (e.g. offline). Drop this branch once the Firebase
        // project is mandatory for all environments.
        const display = email ? email.split('@')[0] : 'developer';
        const stub = {
          uid: `local_${Math.random().toString(36).slice(2, 10)}`,
          email: email || `${display}@yourstudio.com`,
          displayName: display,
          initials: display.slice(0, 2).toUpperCase(),
          provider: 'local',
        };
        writeStored(stub);
        setUser(stub);
        return stub;
      }
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const signOutUser = async () => {
    setLoading(true);
    try {
      if (firebaseAuth) {
        try { await firebaseAuth.signOut(); } catch {}
      }
      writeStored(null);
      localStorage.removeItem(TOKEN_KEY);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const value = {
    user,
    loading,
    error,
    signIn,
    signOut: signOutUser,
    isFirebaseReady: !!firebaseAuth,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

window.AuthProvider = AuthProvider;
window.useAuth = useAuth;
window.inzoneFirebase = { app: firebaseApp, auth: firebaseAuth, db: firebaseDb, htmlStorage: firebaseHtmlStorage };
