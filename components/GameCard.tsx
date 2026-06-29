'use client';

import Link from 'next/link';
import { memo, useEffect, useState } from 'react';
import { fetchLivePlayerCount } from '@/lib/games';
import type { HubGame } from '@/lib/types';

// Module-level memory of which icon URLs have failed to load this session. It
// survives card re-renders and re-mounts so we don't keep retrying (and
// flickering) a broken icon while the user scrolls the hub.
const failedIcons = new Set<string>();

function GameCardImpl({ game }: { game: HubGame }) {
  const [imgFailed, setImgFailed] = useState(() => failedIcons.has(game.iconUrl));
  const showFallback = !game.iconUrl || imgFailed;

  // Live "currently playing" count (open sessions). null while it resolves so we
  // don't flash a 0 before the real number lands.
  const [players, setPlayers] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchLivePlayerCount(game.id, game.uploaderId).then((n) => { if (!cancelled) setPlayers(n); });
    return () => { cancelled = true; };
  }, [game.id, game.uploaderId]);

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
            loading="eager"
            decoding="async"
            draggable={false}
            onError={() => { failedIcons.add(game.iconUrl); setImgFailed(true); }}
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

export const GameCard = memo(GameCardImpl);
