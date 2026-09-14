'use client';

import { useEffect, useRef } from 'react';
import type { HubGame } from '@/lib/types';
import { IX_COPY } from '@/lib/experience-reset';
import { playerFacingDescription } from '@/lib/session-prototype';
import { ExperienceArt } from './ExperienceArt';

export function ExperienceDiscover({
  games,
  current,
  query,
  detailId,
  canSuggest,
  onQuery,
  onDetail,
  onClose,
  onPlay,
  onSuggest,
}: {
  games: HubGame[];
  current: HubGame | null;
  query: string;
  detailId: string | null;
  canSuggest: boolean;
  onQuery: (q: string) => void;
  onDetail: (id: string | null) => void;
  onClose: () => void;
  onPlay: (id: string) => void;
  onSuggest: (game: HubGame) => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const selected = detailId ? games.find((g) => g.id === detailId) || null : null;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? games.filter((g) => g.name.toLowerCase().includes(q))
    : games;

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [detailId]);

  return (
    <div className="ix-sheet">
      <button type="button" className="ix-scrim" aria-label="Close discover" onClick={onClose} />
      <aside className="ix-panel" aria-label={IX_COPY.discover}>
        <div className="ix-panel-head">
          {selected ? (
            <button type="button" className="ix-btn ix-btn-ghost" onClick={() => onDetail(null)}>
              {IX_COPY.backTo} catalogue
            </button>
          ) : (
            <h2>{IX_COPY.discover}</h2>
          )}
          <button type="button" className="ix-btn ix-btn-ghost" onClick={onClose}>
            {current ? `${IX_COPY.backTo} ${current.name}` : 'Close'}
          </button>
        </div>
        <div className="ix-panel-body" ref={bodyRef}>
          <p className="ix-note">{IX_COPY.browsing}</p>
          {selected ? (
            <div className="ix-detail">
              <ExperienceArt game={selected} />
              <h3>{selected.name}</h3>
              {playerFacingDescription(selected.description, selected.name) && (
                <p className="ix-note">{playerFacingDescription(selected.description, selected.name)}</p>
              )}
              <div className="ix-dialog-actions">
                <button type="button" className="ix-btn ix-btn-primary" onClick={() => onPlay(selected.id)}>
                  {IX_COPY.play}
                </button>
                {canSuggest && (
                  <button type="button" className="ix-btn ix-btn-ghost" onClick={() => onSuggest(selected)}>
                    {IX_COPY.suggest}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              <input
                className="ix-search"
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                placeholder={IX_COPY.search}
                aria-label={IX_COPY.search}
              />
              <div className="ix-grid">
                {filtered.map((game) => (
                  <button key={game.id} type="button" className="ix-card" onClick={() => onDetail(game.id)}>
                    <ExperienceArt game={game} />
                    <span>{game.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
