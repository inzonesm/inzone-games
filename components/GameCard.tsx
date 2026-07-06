'use client';

import Link from 'next/link';
import { memo, useEffect, useState } from 'react';
import { fetchLivePlayerCount } from '@/lib/games';
import type { HubGame } from '@/lib/types';

const failedIcons = new Set<string>();

function thumbSrc(url: string): string {
  const noScheme = url.replace(/^https?:\/\//, '');
  return `https://images.weserv.nl/?url=ssl:${encodeURIComponent(noScheme)}&w=256&h=256&fit=cover&output=webp&q=80`;
}

function GameCardImpl({ game }: { game: HubGame }) {
  const [stage, setStage] = useState<0 | 1 | 2>(() => (failedIcons.has(game.iconUrl) ? 2 : 0));
  const showFallback = !game.iconUrl || stage === 2;
  const src = stage === 0 ? thumbSrc(game.iconUrl) : game.iconUrl;

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
            src={src}
            alt={game.name}
            loading="eager"
            decoding="sync"
            draggable={false}
            onError={() => {
              setStage((s) => {
                const next = s === 0 ? 1 : 2;
                if (next === 2) failedIcons.add(game.iconUrl);
                return next;
              });
            }}
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
