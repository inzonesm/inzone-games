'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fetchLivePlayerCount } from '@/lib/games';
import type { HubGame } from '@/lib/types';

export function GameCard({ game }: { game: HubGame }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showFallback = !game.iconUrl || imgFailed;

  // Live "currently playing" count (open sessions). null while it resolves so we
  // don't flash a 0 before the real number lands.
  const [players, setPlayers] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchLivePlayerCount(game.id).then((n) => { if (!cancelled) setPlayers(n); });
    return () => { cancelled = true; };
  }, [game.id]);

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
        {players !== null && players > 0 && (
          <span
            className="players live"
            aria-label={`${players} ${players === 1 ? 'person' : 'people'} playing now`}
          >
            <span className="dot" />
            {players} playing
          </span>
        )}
      </div>
      <div className="name">{game.name}</div>
    </Link>
  );
}
