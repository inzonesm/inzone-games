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
  manage: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  endpoints: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  players: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  payouts: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
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
  const onManage = pathname.startsWith('/manage');
  const onDashboard = pathname.startsWith('/dashboard');
  const onEndpoints = pathname.startsWith('/endpoints');
  const onPlayers = pathname.startsWith('/players');
  const onPayouts = pathname.startsWith('/payouts');
  const onSettings = pathname.startsWith('/settings');

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
        {user && (
          <NavItem href="/manage" icon={NavIcons.manage} label="My Games" active={onManage} onNavigate={onNavigate} />
        )}
        {user && (
          <NavItem href="/dashboard" icon={NavIcons.dashboard} label="Dashboard" active={onDashboard} onNavigate={onNavigate} />
        )}
        {user && (
          <NavItem href="/endpoints" icon={NavIcons.endpoints} label="Endpoints" active={onEndpoints} onNavigate={onNavigate} />
        )}
        {user && (
          <NavItem href="/players" icon={NavIcons.players} label="Players" active={onPlayers} onNavigate={onNavigate} />
        )}
        {user && (
          <NavItem href="/payouts" icon={NavIcons.payouts} label="Payouts" active={onPayouts} onNavigate={onNavigate} />
        )}
        {user && (
          <NavItem href="/settings" icon={NavIcons.settings} label="Settings" active={onSettings} onNavigate={onNavigate} />
        )}
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
