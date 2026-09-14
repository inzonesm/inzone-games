'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Logo } from './Logo';

/** Sidebar + main shell used by every signed-in page (hub + upload).
 *  On phones the sidebar collapses into an off-canvas drawer so the
 *  page content (e.g. the game grid) fills the screen on first paint. */
export function Shell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    document.body.classList.toggle('drawer-open', menuOpen);
    return () => document.body.classList.remove('drawer-open');
  }, [menuOpen]);

  return (
    <div className={`app ${menuOpen ? 'menu-open' : ''}`}>
      <Sidebar className={menuOpen ? 'open' : ''} onNavigate={() => setMenuOpen(false)} />

      <div
        className="sb-backdrop"
        aria-hidden="true"
        onClick={() => setMenuOpen(false)}
      />

      <div className="main">
        <div className="mobile-bar">
          <button
            type="button"
            className="mobile-menu-btn"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M3 6h18" /><path d="M3 12h18" /><path d="M3 18h18" />
            </svg>
          </button>
          <span className="mobile-bar-brand">
            <span className="brand-mark"><Logo size={20} /></span>
            <span className="name">InZone</span>
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
