'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  GoogleAuthProvider,
  OAuthProvider,
  linkWithPopup,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { getFirebaseAuth } from '@/lib/firebase';
import type { FirebaseError } from 'firebase/app';
import { ensureCreatorDocs } from '@/lib/creators';
import {
  googleSignInMode,
  isCredentialAlreadyInUse,
  pendingInviteSessionId,
} from '@/lib/auth-linking';
import {
  joinPlaySession,
  loadPlaySeat,
  loadPlaySession,
  playSessionActor,
  savePlaySeat,
} from '@/lib/play-session';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  configError: string | null;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
}

/**
 * After an anonymous guest signs into an EXISTING Google account, the
 * anonymous uid can no longer act. If the guest arrived on an invite
 * (`/login?next=/games/<id>?session=<sid>`), re-seat the Google uid in that
 * session: join (memberIds + chunk admission, per the self-join rules) and
 * restore their game seat. The shared conversation survives; earlier
 * messages keep the guest name they were posted under.
 *
 * Best-effort and silent: a failure here must never break sign-in — the
 * guest can still join from the session UI.
 */
async function carryInviteMembership(
  anonUid: string,
  googleUser: User,
  sessionId: string | null,
  seatGameId: string | null,
): Promise<void> {
  try {
    if (!sessionId || googleUser.uid === anonUid) return;
    const loaded = await loadPlaySession(sessionId);
    if ('error' in loaded) return;
    if (!loaded.session.memberIds.includes(anonUid)) return;
    if (loaded.session.memberIds.includes(googleUser.uid)) return;
    const actor = await playSessionActor(googleUser);
    const joinErr = await joinPlaySession(sessionId, actor);
    if (joinErr) return;
    if (seatGameId) await savePlaySeat(sessionId, googleUser.uid, seatGameId);
  } catch (err) {
    console.warn('[auth] carry invite membership failed', err instanceof Error ? err.message : err);
  }
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
        // Never provision on the deletion page: signing in there to delete an
        // account must not create new creator/profile documents.
        const onDeletionPage = window.location.pathname.startsWith('/delete-account');
        if (u && !u.isAnonymous && !onDeletionPage) {
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
        const current = auth.currentUser;
        if (current && googleSignInMode(current) === 'link') {
          // Anonymous guest upgrading to Google: link the credential onto the
          // anonymous account so the uid — and every session membership, seat,
          // and message attribution keyed by it — survives. signInWithPopup
          // would swap the uid and strand the guest outside their invite.
          try {
            await linkWithPopup(current, provider);
            return;
          } catch (err) {
            if (!isCredentialAlreadyInUse(err)) throw err;
            // Guarded above: this is the Firebase credential-already-in-use
            // error, so the FirebaseError cast is safe.
            const credential = GoogleAuthProvider.credentialFromError(err as FirebaseError);
            if (!credential) throw err;
            // The Google account already exists as its own Firebase user:
            // sign into it, then carry the pending invite membership across
            // so the guest lands back in the conversation they came from.
            const anonUid = current.uid;
            const sessionId = pendingInviteSessionId(window.location.search);
            // Still authed as the anonymous uid here: snapshot the game seat
            // now — seats are owner-read-only, so the Google account could
            // not read it after the swap.
            const seatGameId = sessionId ? await loadPlaySeat(sessionId, anonUid) : null;
            const signedIn = await signInWithCredential(auth, credential);
            void carryInviteMembership(anonUid, signedIn.user, sessionId, seatGameId);
            return;
          }
        }
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
