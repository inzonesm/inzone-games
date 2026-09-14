'use client';

import { useState } from 'react';
import { coverUrl } from '@/lib/experience-reset';
import type { HubGame } from '@/lib/types';
import { coverFallbackHue, coverInitial } from '@/lib/session-prototype';

const failed = new Set<string>();

export function ExperienceArt({
  game,
  className,
}: {
  game: Pick<HubGame, 'id' | 'name' | 'iconUrl' | 'preview'>;
  className?: string;
}) {
  const url = coverUrl(game);
  const [broken, setBroken] = useState(() => !url || failed.has(url));
  if (!url || broken) {
    const hue = coverFallbackHue(game.id || game.name);
    return (
      <div
        className={`ix-fallback ${className || ''}`}
        style={{ background: `oklch(0.28 0.06 ${hue})` }}
        aria-hidden="true"
      >
        {coverInitial(game.name)}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src={url}
      alt=""
      draggable={false}
      onError={() => {
        failed.add(url);
        setBroken(true);
      }}
    />
  );
}
