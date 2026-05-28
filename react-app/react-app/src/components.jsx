/* Shared chrome — Sidebar, GameSwitcher, ApiNote, atmosphere.
 * Sidebar replaces the old top bar; nav lives on the left so the dashboard
 * has more vertical room for charts and KPI rows. */

const { useState, useEffect, useRef } = React;

function LogoMark() {
  return (
    <span className="brand-mark">
      <img
        src="assets/logo-mark.png"
        alt="InZone"
        style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 0 12px oklch(0.78 0.12 232 / 0.55))' }}
      />
    </span>
  );
}

/* Drifting motes — particles that float upward across the viewport. */
function Motes() {
  return (
    <div className="motes" aria-hidden="true">
      <i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>
    </div>
  );
}

function SparkDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }}>
      <defs>
        <linearGradient id="sg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.72 0.13 235)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="oklch(0.72 0.13 235)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="area-1" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.82 0.10 220)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="oklch(0.82 0.10 220)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="area-2" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.72 0.13 235)" stopOpacity="0.30" />
          <stop offset="100%" stopColor="oklch(0.72 0.13 235)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="area-3" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.58 0.13 250)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="oklch(0.58 0.13 250)" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* Compact game switcher — sits inside the sidebar between brand and nav. */
function GameSwitcher({ games, current, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = window.useNavigate();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [open]);

  if (!current) return null;

  const pickGame = (g) => {
    onSelect(g);
    setOpen(false);
    navigate('/dashboard');
  };

  return (
    <div className="sb-switcher" ref={ref} onClick={() => setOpen(v => !v)}>
      <span className="ico" style={{ background: current.gradient }}>{current.initials}</span>
      <div className="lbl">
        <div className="crumb">Studio · {current.studio}</div>
        <div className="name">{current.name}</div>
      </div>
      <span className="caret">▾</span>
      {open && (
        <div className="sb-switcher-menu" onClick={e => e.stopPropagation()}>
          {games.map(g => (
            <div
              key={g.gameId}
              className={`item ${g.gameId === current.gameId ? 'current' : ''}`}
              onClick={() => pickGame(g)}
            >
              <span className="ico" style={{ background: g.gradient }}>{g.initials}</span>
              <div className="label">
                <div className="name">{g.name}</div>
                <div className="meta">{g.status}</div>
              </div>
            </div>
          ))}
          <div className="div"></div>
          <window.RouterLink to="/upload" className="new" onClick={() => setOpen(false)}>
            <span className="plus">+</span>
            <span>Register a new game</span>
          </window.RouterLink>
        </div>
      )}
    </div>
  );
}

/* Sidebar nav item with icon */
function NavItem({ to, icon, label, active, badge }) {
  const Link = window.RouterLink;
  return (
    <Link to={to} className={`sb-item ${active ? 'active' : ''}`}>
      <span className="sb-icon" aria-hidden="true">{icon}</span>
      <span className="sb-label">{label}</span>
      {badge && <span className="sb-badge">{badge}</span>}
    </Link>
  );
}

const NavIcons = {
  overview: (
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
  endpoints: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h10" />
      <path d="M10 17h10" />
      <circle cx="17" cy="7" r="2.4" />
      <circle cx="7" cy="17" r="2.4" />
    </svg>
  ),
  players: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="3.4" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17" cy="7.5" r="2.6" />
      <path d="M14.5 15.5c1-.6 2.1-.9 2.5-.9 2.5 0 4.5 2 4.5 4.5" />
    </svg>
  ),
  payouts: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h3" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7.1 4.2l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
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

function Sidebar({ active, games, currentGame, onSelectGame, hasGames }) {
  const Link = window.RouterLink;
  const { user, signOut } = window.useAuth();

  return (
    <aside className="sidebar" aria-label="Studio navigation">
      <Link to={hasGames ? '/dashboard' : '/upload'} className="sb-brand">
        <LogoMark />
        <span className="sb-brand-text">
          <span className="name">InZone</span>
          <span className="sub">Studio</span>
        </span>
      </Link>

      {hasGames && currentGame ? (
        <GameSwitcher games={games} current={currentGame} onSelect={onSelectGame} />
      ) : (
        <Link to="/upload" className="sb-switcher empty">
          <span className="ico empty">+</span>
          <div className="lbl">
            <div className="crumb">No game yet</div>
            <div className="name">Register your first build</div>
          </div>
        </Link>
      )}

      <div className="sb-section">Workspace</div>
      <nav className="sb-nav">
        {hasGames && (
          <NavItem to="/dashboard" icon={NavIcons.overview} label="Overview" active={active === 'dashboard'} />
        )}
        <NavItem to="/upload"    icon={NavIcons.upload}   label="Upload"   active={active === 'upload'} />
        <NavItem to="/endpoints" icon={NavIcons.endpoints} label="Endpoints" active={active === 'endpoints'} />
        {hasGames && (
          <NavItem to="/players"   icon={NavIcons.players}  label="Players"  active={active === 'players'} />
        )}
        {hasGames && (
          <NavItem to="/payouts"   icon={NavIcons.payouts}  label="Payouts"  active={active === 'payouts'} />
        )}
      </nav>

      <div className="sb-section">Account</div>
      <nav className="sb-nav">
        <NavItem to="/settings" icon={NavIcons.settings} label="Settings" active={active === 'settings'} />
      </nav>

      <div className="sb-spacer"></div>

      <div className="sb-status">
        <span className="dot"></span>
        <div className="lbl">
          <div className="t">Platform · Live</div>
          <div className="s">All endpoints healthy</div>
        </div>
      </div>

      {user && (
        <div className="sb-foot">
          <span className="avatar" title={user.email}>{user.initials}</span>
          <div className="user">
            <div className="n">{user.displayName}</div>
            <div className="e">{user.email}</div>
          </div>
          <button className="signout" onClick={signOut} aria-label="Sign out" title="Sign out">
            {NavIcons.signout}
          </button>
        </div>
      )}
    </aside>
  );
}

function ApiNote({ endpoint, source, children }) {
  return (
    <div className="api-note">
      <b>Wired to →</b>
      <code>{endpoint}</code>
      {children}
      {source && (
        <span className={`src ${source}`}>{source === 'backend' ? '● Live' : '○ Mock'}</span>
      )}
    </div>
  );
}

function Pill({ children, live, onClick }) {
  return (
    <button type="button" className={`pill ${live ? 'live' : ''}`} onClick={onClick}>
      {live && <span className="dot"></span>}
      {children}
    </button>
  );
}

Object.assign(window, {
  LogoMark, SparkDefs, GameSwitcher, Sidebar, NavItem, ApiNote, Pill, Motes,
});
