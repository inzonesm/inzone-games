'use client';

import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';

function initialsFromUser(displayName: string | null | undefined, email: string | null | undefined): string {
  if (displayName) {
    return displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '·';
  }
  if (!email) return '·';
  const local = email.split('@')[0] || '';
  return (local[0] || '·').toUpperCase();
}

export function PlayerAuthChip({ nextPath }: { nextPath: string }) {
  const { user, loading, signOut } = useAuth();
  const next = nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/';

  if (loading) {
    return <span className="player-auth player-auth-loading" aria-hidden="true" />;
  }

  if (!user || user.isAnonymous) {
    return (
      <Link href={`/login?next=${encodeURIComponent(next)}`} className="player-auth-link">
        Sign in
      </Link>
    );
  }

  const label = user.displayName || user.email || 'You';
  return (
    <span className="player-auth">
      <span className="player-avatar" title={label} aria-label={label}>
        {initialsFromUser(user.displayName, user.email)}
      </span>
      <button type="button" className="player-signout" onClick={() => { void signOut(); }}>
        Sign out
      </button>
    </span>
  );
}
