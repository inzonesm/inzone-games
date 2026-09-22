'use client';

import Link from 'next/link';
import { memo, useEffect, useRef, useState } from 'react';
import {
  catalogueArtUrl,
  catalogueClipUrl,
  discoveryCategory,
  proxiedCatalogueArt,
} from '@/lib/discovery';
import type { HubGame } from '@/lib/types';

const failedArt = new Set<string>();

function artInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : 'G';
}

function DiscoveryCardImpl({
  game,
  onInvite,
  layout = 'feature',
}: {
  game: HubGame;
  onInvite: (game: HubGame) => void;
  layout?: 'feature' | 'list';
}) {
  const art = catalogueArtUrl(game);
  const clip = catalogueClipUrl(game);
  const [stage, setStage] = useState<0 | 1 | 2>(() => (failedArt.has(art) ? 2 : 0));
  const [hover, setHover] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const showFallback = !art || stage === 2;
  const src = stage === 0 ? proxiedCatalogueArt(art, layout === 'feature' ? 960 : 512) : art;
  const category = discoveryCategory(game);
  const href = `/games/${encodeURIComponent(game.id)}`;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clip) return;
    if (hover) {
      const play = video.play();
      if (play) play.catch(() => {});
    } else {
      video.pause();
      try {
        video.currentTime = 0;
      } catch {
        /* ignore */
      }
    }
  }, [hover, clip]);

  return (
    <article
      className={`discovery-card discovery-card-${layout}`}
      data-testid="discovery-card"
      data-game-id={game.id}
      data-art-kind={showFallback ? 'placeholder' : 'catalogue'}
      data-has-clip={clip ? 'true' : 'false'}
    >
      <div
        className="discovery-cover"
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        {showFallback ? (
          <div className="discovery-cover-fallback" aria-hidden="true">
            <span>{artInitial(game.name)}</span>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={game.name}
            loading="eager"
            decoding="async"
            draggable={false}
            onError={() => {
              setStage((s) => {
                const next = s === 0 ? 1 : 2;
                if (next === 2) failedArt.add(art);
                return next;
              });
            }}
          />
        )}
        {clip && !showFallback ? (
          <video
            ref={videoRef}
            className="discovery-clip"
            muted
            loop
            playsInline
            preload="metadata"
            poster={game.preview?.posterUrl || undefined}
            src={clip}
            aria-hidden="true"
          />
        ) : null}
        <span className="discovery-tag">{category}</span>
      </div>
      <div className="discovery-card-info">
        <h2>{game.name}</h2>
        <div className="discovery-card-actions">
          <Link href={href} className="discovery-play">
            Play
          </Link>
          <button
            type="button"
            className="discovery-invite-btn"
            onClick={() => onInvite(game)}
            aria-label={`Invite someone to ${game.name}`}
          >
            <InviteIcon />
            Invite
          </button>
        </div>
      </div>
    </article>
  );
}

export const DiscoveryCard = memo(DiscoveryCardImpl);

function InviteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="9" cy="7" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3 21v-3a6 6 0 0 1 12 0v3M19 8v8m-4-4h8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
