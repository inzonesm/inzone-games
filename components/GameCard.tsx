'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { HubGame } from '@/lib/types';

export function GameCard({ game }: { game: HubGame }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showFallback = !game.iconUrl || imgFailed;

  return (
    <Link href={`/games/${encodeURIComponent(game.id)}`} className="game-card">
      <div className="thumb">
        {showFallback ? (
          <span aria-hidden="true">🎮</span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={game.iconUrl}
            alt={game.name}
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        )}
        {game.source === 'community' && <span className="source">Community</span>}
      </div>
      <div className="name">{game.name}</div>
    </Link>
  );
}
