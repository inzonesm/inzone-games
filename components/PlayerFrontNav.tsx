'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { PlayerAuthChip } from '@/components/PlayerAuthChip';

const ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/games', label: 'Discover' },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PlayerFrontNav() {
  const pathname = usePathname() || '/';
  const nextPath = pathname.startsWith('/games/') ? pathname : pathname === '/games' ? '/games' : '/';

  const links = ITEMS.map((item) => (
    <Link
      key={item.href}
      href={item.href}
      className={`player-nav-link${isActive(pathname, item.href) ? ' is-on' : ''}`}
    >
      {item.label}
    </Link>
  ));

  return (
    <>
      <header className="player-nav player-nav-top">
        <Link href="/" className="player-brand">
          <Logo size={22} />
          InZone
        </Link>
        <nav className="player-nav-items" aria-label="Player">
          {links}
        </nav>
        <PlayerAuthChip nextPath={nextPath} />
      </header>
      <nav className="player-nav player-nav-bottom" aria-label="Player">
        {links}
        <PlayerAuthChip nextPath={nextPath} />
      </nav>
    </>
  );
}
