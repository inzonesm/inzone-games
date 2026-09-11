'use client';

import Link from 'next/link';
import { PlayerFrontNav } from '@/components/PlayerFrontNav';

export function PlayerFrontShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="player-front">
      <PlayerFrontNav />
      <div className="player-front-body">{children}</div>
      <footer className="player-dev-footer">
        <Link href="/upload">For developers →</Link>
      </footer>
    </div>
  );
}
