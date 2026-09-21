'use client';

import { useRef } from 'react';
import { CompanionRibbon } from '@/components/CompanionRibbon';
import { GameCompanion } from '@/components/GameCompanion';
import { DISCOVERY_COPY, DISCOVERY_ROOK_GAME_ID } from '@/lib/discovery';
import { isFlagshipId } from '@/lib/flagship-roster';

const idleLevel = { current: 0 };

export function DiscoveryRook({
  gameId,
  gameName,
}: {
  gameId?: string;
  gameName?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const rookId = gameId && isFlagshipId(gameId) ? gameId : DISCOVERY_ROOK_GAME_ID;
  const canTalk = isFlagshipId(rookId);

  return (
    <footer className="discovery-rook" data-testid="discovery-rook">
      {canTalk ? (
        <GameCompanion
          gameId={rookId}
          gameName={gameName || 'InZone'}
          iframeRef={iframeRef}
          active
          surface="discovery"
        />
      ) : (
        <aside className="companion-dock" data-companion-layout="shelf" data-companion-surface="discovery">
          <div className="companion-presence" aria-hidden="true">
            <CompanionRibbon
              state="idle"
              muted
              levelRef={idleLevel}
              speechReactive="none"
            />
          </div>
          <div className="companion-copy">
            <p className="companion-name">
              ROOK
              <span className="companion-dot" aria-hidden="true" />
              <span className="companion-status">Ready</span>
            </p>
            <p className="companion-caption">{DISCOVERY_COPY.rookPrompt}</p>
          </div>
        </aside>
      )}
    </footer>
  );
}
