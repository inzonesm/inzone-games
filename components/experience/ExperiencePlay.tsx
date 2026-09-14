'use client';

import { useRef } from 'react';
import type { HubGame } from '@/lib/types';
import { IX_COPY, withServerUrl } from '@/lib/experience-reset';
import { sameOriginGameUrl } from '@/lib/game-hosting';
import { gameFitFor } from '@/lib/session-prototype';
import { ExperienceArt } from './ExperienceArt';

export function ExperiencePlay({
  game,
  reloadKey,
  loading,
  loadError,
  frameLoaded,
  failScene,
  onFrameLoaded,
  onRetry,
  onAnother,
  onDiscover,
  onSession,
  onHome,
  overlay,
  sessionLabel,
  children,
}: {
  game: HubGame | null;
  reloadKey: number;
  loading: boolean;
  loadError: string | null;
  frameLoaded: boolean;
  failScene: boolean;
  onFrameLoaded: () => void;
  onRetry: () => void;
  onAnother: () => void;
  onDiscover: () => void;
  onSession: () => void;
  onHome: () => void;
  overlay: 'none' | 'discover' | 'session';
  sessionLabel: string;
  children?: React.ReactNode;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const fit = game ? gameFitFor(game.id, game.name) : 'unknown';
  const showCover = failScene || !!loadError || loading || !frameLoaded;
  const src = game ? sameOriginGameUrl(withServerUrl(game.gameUrl, game.serverUrl)) : '';

  function toggleFullscreen() {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }

  return (
    <div className="ix-play">
      <header className="ix-host">
        <button type="button" className="ix-identity" onClick={onHome} aria-label="Back to home">
          {game ? <ExperienceArt game={game} /> : <div className="ix-fallback">I</div>}
          <span>
            <strong>{game?.name || 'InZone'}</strong>
            <small>InZone</small>
          </span>
        </button>
        <div className="ix-host-actions">
          <button
            type="button"
            className={`ix-btn ix-btn-ghost${overlay === 'discover' ? ' is-on' : ''}`}
            onClick={onDiscover}
          >
            {IX_COPY.discover}
          </button>
          <button
            type="button"
            className={`ix-btn ix-btn-ghost${overlay === 'session' ? ' is-on' : ''}`}
            onClick={onSession}
          >
            {sessionLabel}
          </button>
          <button type="button" className="ix-btn ix-btn-ghost" onClick={toggleFullscreen}>
            {IX_COPY.fullscreen}
          </button>
        </div>
      </header>
      <div className="ix-body">
        <div
          className={`ix-stage${fit === 'landscape' ? ' is-landscape-hint' : ''}`}
          ref={stageRef}
        >
          {game && !failScene && !loadError && (
            <iframe
              key={`${game.id}:${reloadKey}`}
              src={src}
              title={game.name}
              scrolling="no"
              onLoad={onFrameLoaded}
              allow="camera; microphone; geolocation; encrypted-media; autoplay; fullscreen; gamepad; accelerometer; gyroscope"
              allowFullScreen
            />
          )}
          {showCover && (
            <div className="ix-cover">
              {game && <ExperienceArt game={game} />}
              <h2>{failScene || loadError ? IX_COPY.loadFailTitle : game?.name || 'Loading'}</h2>
              {(failScene || loadError) ? (
                <>
                  <p className="ix-note">{loadError || IX_COPY.loadFailBody}</p>
                  {failScene && <span className="ix-fixture">{IX_COPY.fixture}</span>}
                  <div className="ix-dialog-actions" style={{ justifyContent: 'center' }}>
                    <button type="button" className="ix-btn ix-btn-primary" onClick={onRetry}>{IX_COPY.retry}</button>
                    <button type="button" className="ix-btn ix-btn-ghost" onClick={onAnother}>{IX_COPY.another}</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="ix-note">Loading {game?.name || 'game'}…</p>
                  <div className="ix-spin" aria-hidden="true" />
                </>
              )}
            </div>
          )}
          {fit === 'landscape' && (
            <p className="ix-rotate">{IX_COPY.rotate}</p>
          )}
          {fit === 'unknown' && game && !showCover && (
            <p className="ix-fit-note">{IX_COPY.unknownFit}</p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
