'use client';

/* Sign-in + request panel for /delete-account. Ownership is proven by
 * signing in to the account itself (Google, Apple, or email + password);
 * the backend derives the uid from the ID token, so a request can never be
 * made for someone else's email address. No analytics fire from here. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { getFirebaseAuth } from '@/lib/firebase';
import { publicApiOrigin } from '@/lib/game-sdk/backend';
import {
  createDeletionClient,
  DeletionApiError,
  formatDeletionDate,
  type DeletionState,
} from '@/lib/account-deletion';
import styles from '@/app/delete-account/delete-account.module.css';

type Phase = 'loading' | 'signed-out' | 'ready' | 'working';

function providerOf(user: User): 'google.com' | 'apple.com' | 'password' | 'other' {
  const id = user.providerData[0]?.providerId;
  return id === 'google.com' || id === 'apple.com' || id === 'password' ? id : 'other';
}

function friendlyAuthError(e: unknown): string | null {
  const code = (e as { code?: string })?.code ?? '';
  if (code.includes('popup-closed-by-user') || code.includes('cancelled-popup-request')) return null;
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found'))
    return 'That email and password do not match an InZone account.';
  if (code.includes('too-many-requests')) return 'Too many attempts. Wait a few minutes and try again.';
  if (code.includes('network-request-failed')) return 'Network error. Check your connection and try again.';
  if (code.includes('popup-blocked')) return 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.';
  if (code.includes('account-exists-with-different-credential'))
    return 'This email is registered with a different sign-in method. Try the other buttons.';
  return e instanceof Error ? e.message : 'Sign-in failed. Try again.';
}

export function AccountDeletionPanel() {
  const client = useMemo(() => createDeletionClient({ origin: publicApiOrigin() }), []);
  const [phase, setPhase] = useState<Phase>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [state, setState] = useState<DeletionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  const refresh = useCallback(async (u: User) => {
    try {
      setState(await client.status(await u.getIdToken(), u.uid));
      setPhase('ready');
    } catch (e) {
      setState({ status: 'none', requestedAt: null, purgeAfter: null, completedAt: null });
      setPhase('ready');
      if (e instanceof DeletionApiError && e.code === 'network') setError(e.message);
    }
  }, [client]);

  useEffect(() => {
    let unsub = () => {};
    try {
      unsub = onAuthStateChanged(getFirebaseAuth(), (u) => {
        setUser(u && !u.isAnonymous ? u : null);
        if (u && !u.isAnonymous) void refresh(u);
        else setPhase('signed-out');
      });
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : 'Sign-in is unavailable.');
      setPhase('signed-out');
    }
    return () => unsub();
  }, [refresh]);

  async function run(fn: () => Promise<void>) {
    setError(null);
    setNotice(null);
    setPhase('working');
    try {
      await fn();
    } catch (e) {
      const msg = friendlyAuthError(e);
      if (msg) setError(msg);
    } finally {
      setPhase((p) => (p === 'working' ? (getFirebaseAuth().currentUser ? 'ready' : 'signed-out') : p));
    }
  }

  const signInGoogle = () => run(async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(getFirebaseAuth(), provider);
  });
  const signInApple = () => run(async () => {
    const provider = new OAuthProvider('apple.com');
    provider.addScope('email');
    await signInWithPopup(getFirebaseAuth(), provider);
  });
  const signInEmail = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
      setPassword('');
    });
  };
  const resetPassword = () => run(async () => {
    if (!email.trim()) {
      setError('Enter the email address on your InZone account first.');
      return;
    }
    await sendPasswordResetEmail(getFirebaseAuth(), email.trim());
    // Same message whether or not the address exists, so this cannot be used to probe for accounts.
    setNotice('If that address has an InZone account, a reset link is on its way. Check your inbox and spam folder.');
  });

  const reauthenticate = async (u: User) => {
    const kind = providerOf(u);
    if (kind === 'google.com') await reauthenticateWithPopup(u, new GoogleAuthProvider());
    else if (kind === 'apple.com') await reauthenticateWithPopup(u, new OAuthProvider('apple.com'));
    else if (kind === 'password') {
      if (!password) throw new Error('Enter your password to confirm.');
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email ?? '', password));
      setPassword('');
    } else {
      await signOut(getFirebaseAuth());
      throw new Error('Sign in again to confirm.');
    }
  };

  const requestDeletion = () => run(async () => {
    const u = getFirebaseAuth().currentUser;
    if (!u) return;
    if (needsReauth) {
      await reauthenticate(u);
      setNeedsReauth(false);
    }
    try {
      setState(await client.request(await u.getIdToken(true), u.uid));
    } catch (e) {
      if (e instanceof DeletionApiError && e.code === 'requires_recent_login') {
        setNeedsReauth(true);
        throw new Error('For your security, confirm it is you, then press the button again.');
      }
      throw e;
    }
  });

  const cancelDeletion = () => run(async () => {
    const u = getFirebaseAuth().currentUser;
    if (!u) return;
    await client.cancel(await u.getIdToken(true), u.uid);
    await refresh(u);
    setNotice('Your deletion request is cancelled and your account is active again.');
  });

  const busy = phase === 'working' || phase === 'loading';
  const purgeDate = formatDeletionDate(state?.purgeAfter ?? null);

  if (phase === 'loading') {
    return <div className={styles.panel} aria-busy="true"><p className={styles.muted}>Loading…</p></div>;
  }

  return (
    <div className={styles.panel} id="request">
      {configError && <p className={styles.err} role="alert">{configError}</p>}
      {error && <p className={styles.err} role="alert">{error}</p>}
      {notice && <p className={styles.ok} role="status">{notice}</p>}

      {!user && (
        <>
          <h2 className={styles.panelTitle}>1. Sign in to the account you want to delete</h2>
          <p className={styles.muted}>Use the same method you use in the InZone app. This is how we confirm the account is yours.</p>
          <div className={styles.providers}>
            <button className={styles.provider} onClick={signInGoogle} disabled={busy || !!configError}>Continue with Google</button>
            <button className={styles.provider} onClick={signInApple} disabled={busy || !!configError}>Continue with Apple</button>
          </div>
          <form className={styles.emailForm} onSubmit={signInEmail}>
            <label>
              <span>Email</span>
              <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label>
              <span>Password</span>
              <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <div className={styles.row}>
              <button className="btn-primary" type="submit" disabled={busy || !!configError}>Sign in with email</button>
              <button className={styles.linkButton} type="button" onClick={resetPassword} disabled={busy || !!configError}>Forgot password?</button>
            </div>
          </form>
        </>
      )}

      {user && state && (
        <>
          <p className={styles.signedInAs}>
            Signed in as <strong>{user.email ?? 'your InZone account'}</strong>
            <button className={styles.linkButton} onClick={() => run(() => signOut(getFirebaseAuth()))} disabled={busy}>Not you? Sign out</button>
          </p>

          {state.status === 'none' && (
            <>
              <h2 className={styles.panelTitle}>2. Request deletion</h2>
              <label className={styles.confirm}>
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>I understand my InZone account and the data listed below will be permanently deleted 30 days from now, and that this cannot be undone after that date.</span>
              </label>
              {needsReauth && providerOf(user) === 'password' && (
                <label className={styles.reauth}>
                  <span>Confirm your password</span>
                  <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </label>
              )}
              <button className={styles.danger} onClick={requestDeletion} disabled={busy || !confirmed}>
                {phase === 'working' ? 'Submitting…' : needsReauth ? 'Confirm it is me and delete my account' : 'Delete my InZone account'}
              </button>
            </>
          )}

          {state.status === 'pending_window' && (
            <div className={styles.statusBox}>
              <h2 className={styles.panelTitle}>Deletion scheduled</h2>
              <p>Your profile is hidden now. {purgeDate ? <>Permanent deletion starts on <strong>{purgeDate}</strong>.</> : 'Permanent deletion starts 30 days after your request.'}</p>
              <p className={styles.muted}>Changed your mind? You can cancel until then.</p>
              <button className="btn-ghost" onClick={cancelDeletion} disabled={busy}>Keep my account</button>
            </div>
          )}

          {(state.status === 'processing' || state.status === 'failed' || state.status === 'needs_attention') && (
            <div className={styles.statusBox}>
              <h2 className={styles.panelTitle}>Deletion in progress</h2>
              <p>Your data is being deleted now. This can no longer be cancelled. If a step fails it is retried automatically, and our team is alerted if it keeps failing.</p>
            </div>
          )}

          {state.status === 'completed' && (
            <div className={styles.statusBox}>
              <h2 className={styles.panelTitle}>Deletion complete</h2>
              <p>Your InZone account data has been deleted{formatDeletionDate(state.completedAt) ? ` on ${formatDeletionDate(state.completedAt)}` : ''}.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
