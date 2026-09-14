'use client';

import type { HubGame } from '@/lib/types';
import { IX_COPY } from '@/lib/experience-reset';
import { playerFacingDescription } from '@/lib/session-prototype';
import { ExperienceArt } from './ExperienceArt';

export function ExperienceHome({
  feature,
  alternatives,
  picks,
  recents,
  onPlay,
}: {
  feature: HubGame | null;
  alternatives: HubGame[];
  picks: HubGame[];
  recents: HubGame[];
  onPlay: (id: string) => void;
}) {
  return (
    <main className="ix-home">
      <div className="ix-brand">
        <span aria-hidden="true">◎</span>
        InZone
      </div>
      <p className="ix-promise">{IX_COPY.promise}</p>

      {recents.length > 0 && (
        <section className="ix-section" style={{ marginBottom: 28 }}>
          <h2>{IX_COPY.recent}</h2>
          <p>{IX_COPY.recentHint}</p>
          <div className="ix-grid">
            {recents.map((game) => (
              <button key={`recent-${game.id}`} type="button" className="ix-card" onClick={() => onPlay(game.id)}>
                <ExperienceArt game={game} />
                <span>{game.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {feature ? (
        <div className="ix-opening" id="ix-opening">
          <button type="button" className="ix-feature" onClick={() => onPlay(feature.id)}>
            <ExperienceArt game={feature} />
            <div className="ix-feature-copy">
              <p className="ix-kicker">{IX_COPY.kicker}</p>
              <h1>{feature.name}</h1>
              {playerFacingDescription(feature.description, feature.name) && (
                <p className="ix-blurb">{playerFacingDescription(feature.description, feature.name)}</p>
              )}
              <span className="ix-btn ix-btn-primary">{IX_COPY.play}</span>
            </div>
          </button>
          <div className="ix-alts">
            {alternatives.map((game) => (
              <button key={game.id} type="button" className="ix-alt" onClick={() => onPlay(game.id)}>
                <ExperienceArt game={game} />
                <div className="ix-alt-copy">
                  <h2>{game.name}</h2>
                  {playerFacingDescription(game.description, game.name) && (
                    <p className="ix-blurb">{playerFacingDescription(game.description, game.name)}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="ix-status">No approved games are available right now.</p>
      )}

      <button
        type="button"
        className="ix-btn ix-btn-ghost ix-browse"
        onClick={() => document.getElementById(picks.length ? 'ix-picks' : 'ix-opening')?.scrollIntoView({ behavior: 'smooth' })}
      >
        {IX_COPY.browseAll}
      </button>

      {picks.length > 0 && (
        <section className="ix-section" id="ix-picks">
          <h2>{IX_COPY.picks}</h2>
          <p>{IX_COPY.picksHint}</p>
          <div className="ix-grid">
            {picks.map((game) => (
              <button key={game.id} type="button" className="ix-card" onClick={() => onPlay(game.id)}>
                <ExperienceArt game={game} />
                <span>{game.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
