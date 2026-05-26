'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { HubGame } from '@/lib/types';

export function GameCard({ game }: { game: HubGame }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showFallback = !game.iconUrl || imgFailed;

  return (
    <Link
      href={`/games/${encodeURIComponent(game.id)}`}
      className="group flex flex-col overflow-hidden rounded-card bg-white shadow-card transition hover:-translate-y-0.5 hover:shadow-lg dark:bg-inzone-dark-surface"
    >
      <div className="relative aspect-square w-full bg-inzone-light-grey dark:bg-black/30">
        {showFallback ? (
          <div className="flex h-full w-full items-center justify-center text-3xl">
            🎮
          </div>
        ) : (
          <img
            src={game.iconUrl}
            alt={game.name}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => setImgFailed(true)}
          />
        )}
        {game.source === 'community' && (
          <span className="absolute left-1.5 top-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-white">
            Community
          </span>
        )}
      </div>
    </Link>
  );
}
