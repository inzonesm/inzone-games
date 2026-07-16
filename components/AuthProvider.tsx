'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  GoogleAuthProvider,
  OAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { getFirebaseAuth } from '@/lib/firebase';
import { ensureCreatorDocs } from '@/lib/creators';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  configError: string | null;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    let unsub = () => {};
    try {
      const auth = getFirebaseAuth();
      unsub = onAuthStateChanged(auth, (u) => {
        setUser(u);
        setLoading(false);
        // Every sign-in (fresh or returning): provision whichever of
        // humanUsers/{uid} / influencers/{uid} is missing — same seeding the
        // Flutter app does in auth_work.dart. Fire-and-forget; never blocks.
        if (u) {
          void ensureCreatorDocs(u.uid, u.email ?? null, u.displayName ?? null, u.photoURL ?? null);
        }
      });
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : 'Firebase init failed');
      setLoading(false);
    }
    return () => unsub();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      configError,
      async signInWithGoogle() {
        const auth = getFirebaseAuth();
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await signInWithPopup(auth, provider);
      },
      async signInWithApple() {
        const auth = getFirebaseAuth();
        const provider = new OAuthProvider('apple.com');
        provider.addScope('email');
        provider.addScope('name');
        await signInWithPopup(auth, provider);
      },
      async signOut() {
        await fbSignOut(getFirebaseAuth());
      },
    }),
    [user, loading, configError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
