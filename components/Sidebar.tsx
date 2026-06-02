'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { Logo } from './Logo';

const NavIcons = {
  hub: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="8" height="9" rx="1.5" />
      <rect x="13" y="3" width="8" height="5" rx="1.5" />
      <rect x="13" y="10" width="8" height="11" rx="1.5" />
      <rect x="3" y="14" width="8" height="7" rx="1.5" />
    </svg>
  ),
  upload: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v13" />
      <path d="m6 9 6-6 6 6" />
      <path d="M5 21h14" />
    </svg>
  ),
  signout: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  ),
};

interface NavItemProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onNavigate?: () => void;
}

function NavItem({ href, icon, label, active, onNavigate }: NavItemProps) {
  return (
    <Link href={href} className={`sb-item ${active ? 'active' : ''}`} onClick={onNavigate}>
      <span className="sb-icon" aria-hidden="true">{icon}</span>
      <span className="sb-label">{label}</span>
    </Link>
  );
}

function initialsFromEmail(email: string | null | undefined): string {
  if (!email) return '··';
  const local = email.split('@')[0];
  const parts = local.split(/[.\-_]/).filter(Boolean);
  const pick = parts.length >= 2 ? parts.slice(0, 2) : [local];
  return pick.map((p) => p[0]?.toUpperCase() ?? '').join('').slice(0, 2) || '··';
}

export function Sidebar({ className = '', onNavigate }: { className?: string; onNavigate?: () => void }) {
  const pathname = usePathname() ?? '';
  const { user, signOut } = useAuth();

  // /games and /games/[id] both highlight Hub. /upload highlights Upload.
  const onHub = pathname === '/games' || pathname.startsWith('/games/');
  const onUpload = pathname.startsWith('/upload');

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Developer';
  const initials = user?.displayName
    ? user.displayName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('')
    : initialsFromEmail(user?.email);

  return (
    <aside className={`sidebar ${className}`} aria-label="InZone navigation">
      <Link href="/games" className="sb-brand" onClick={onNavigate}>
        <span className="brand-mark"><Logo size={24} /></span>
        <span className="sb-brand-text">
          <span className="name">InZone</span>
          <span className="sub">Hub + Studio</span>
        </span>
      </Link>

      <div className="sb-section">Workspace</div>
      <nav className="sb-nav">
        <NavItem href="/games" icon={NavIcons.hub} label="Game Hub" active={onHub} onNavigate={onNavigate} />
        <NavItem href="/upload" icon={NavIcons.upload} label="Upload" active={onUpload} onNavigate={onNavigate} />
      </nav>

      <div className="sb-spacer" />

      <div className="sb-status">
        <span className="dot" />
        <div className="lbl">
          <div className="t">Platform · Live</div>
          <div className="s">Firebase + GCS ready</div>
        </div>
      </div>

      {user ? (
        <div className="sb-foot">
          <span className="avatar" title={user.email ?? undefined}>{initials}</span>
          <div className="user">
            <div className="n">{displayName}</div>
            <div className="e">{user.email}</div>
          </div>
          <button
            className="signout"
            onClick={() => { void signOut(); }}
            aria-label="Sign out"
            title="Sign out"
          >
            {NavIcons.signout}
          </button>
        </div>
      ) : (
        <Link href="/login" className="sb-foot sb-foot-anon" aria-label="Sign in" onClick={onNavigate}>
          <span className="avatar sb-foot-anon-avatar" aria-hidden="true">→</span>
          <div className="user">
            <div className="n">Sign in</div>
            <div className="e">to upload your game</div>
          </div>
        </Link>
      )}
    </aside>
  );
}
