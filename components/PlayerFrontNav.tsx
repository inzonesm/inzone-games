'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { PlayerAuthChip } from '@/components/PlayerAuthChip';
import { frontNavNextPath } from '@/lib/player-front-nav';

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
  // NOTE: useSearchParams requires a Suspense boundary wherever this nav is
  // mounted. The query string must be preserved: invite arrivals carry
  // ?session=<id>, and dropping it on the /login?next= round-trip orphans the
  // invitee outside the conversation.
  const searchParams = useSearchParams();
  const search = searchParams && searchParams.toString() ? `?${searchParams.toString()}` : '';
  const nextPath = frontNavNextPath(pathname, search);

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
