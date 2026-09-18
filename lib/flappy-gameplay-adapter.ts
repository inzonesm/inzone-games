import type { GameplaySignal } from './gameplay-signals';
import type { GameSignalConnection } from './game-adapters';

type Entity = {
  enabled: boolean;
  findByName(name: string): Entity | null;
  getPosition(): { y: number };
  script?: { bird?: { state: string; paused: boolean; velocity: number } };
};
type App = {
  root: Entity;
  on(name: string, callback: () => void): void;
  off(name: string, callback: () => void): void;
};

export const FLAPPY_V9_PATH = '/gcs/games/flappybird-inzone-2/v9/index.html';

/**
 * The inspected v9 engine is on screen. START is a PlayCanvas sprite on this
 * shell; the bird script may still be disabled. Host recovery may dismiss the
 * boot overlay here. Measurement still waits for getready/play/dead.
 */
export function isFlappyV9EnginePresent(win: Window): boolean {
  try {
    if (win.location.pathname !== FLAPPY_V9_PATH) return false;
    const app = (win as unknown as { pc?: { Application?: { getApplication?: () => App } } })
      .pc?.Application?.getApplication?.();
    const birdEntity = app?.root.findByName('Game')?.findByName('Bird');
    const overScreen = app?.root.findByName('Game Over Screen');
    return Boolean(app && birdEntity && overScreen);
  } catch {
    return false;
  }
}

/**
 * Verified against /gcs/games/flappybird-inzone-2/v9, September 2026.
 * bird.js: flap() fires game:play only when leaving getready; resume() does
 * not fire it. game.js: game:gameover enables Game Over Screen only after a
 * declined/unavailable continue. A dead bird alone is NOT a completed run.
 * Nothing here changes engine state or treats a raw input event as gameplay.
 */
export function connectFlappyGameplay(
  win: Window,
  mountId: string,
  emit: (signal: GameplaySignal) => void,
): GameSignalConnection | null {
  // Fail closed on a different build until its state contract is inspected.
  if (win.location.pathname !== FLAPPY_V9_PATH) return null;
  const app = (win as unknown as { pc?: { Application?: { getApplication?: () => App } } })
    .pc?.Application?.getApplication?.();
  const birdEntity = app?.root.findByName('Game')?.findByName('Bird');
  const bird = birdEntity?.script?.bird;
  const overScreen = app?.root.findByName('Game Over Screen');
  if (!app || !birdEntity || !bird || !overScreen || typeof app.on !== 'function' || typeof app.off !== 'function') return null;
  if (!['getready', 'play', 'dead'].includes(bird.state) || typeof bird.paused !== 'boolean') return null;

  let sequence = 0;
  let runId: string | null = null;
  let ended = false;
  let disposed = false;
  const send = (signal: GameplaySignal) => { if (!disposed) emit(signal); };
  const progress = (): GameplaySignal | null => {
    if (!runId) return null;
    const y = birdEntity.getPosition().y;
    const velocity = bird.velocity;
    const valid = Number.isFinite(y) && Number.isFinite(velocity);
    return {
      type: 'progress', runId,
      active: valid && birdEntity.enabled && bird.state === 'play' && !bird.paused && !ended,
      // Physics changes while flying, but never credit animated title/ready screens.
      fingerprint: valid ? `${y.toFixed(4)}:${velocity.toFixed(4)}` : 'invalid',
    };
  };
  const start = () => {
    // game:play fires inside flap(), BEFORE bird.state becomes play.
    if (runId || !birdEntity.enabled || bird.paused || bird.state !== 'getready') return;
    runId = `${mountId}:flappy-${++sequence}`;
    ended = false;
    send({ type: 'start', runId });
  };
  const over = () => {
    if (!runId || ended || bird.state !== 'dead' || !overScreen.enabled) return;
    ended = true;
    send({ type: 'over', runId, outcome: 'loss' });
  };
  const pause = () => {
    if (runId) send({ type: 'progress', runId, active: false, fingerprint: 'paused' });
  };
  const reset = () => { pause(); runId = null; ended = false; };
  const handlers: [string, () => void][] = [
    ['game:play', start], ['game:gameover', over], ['game:pause', pause],
    ['game:menu', reset], ['game:getready', reset],
  ];
  for (const [name, handler] of handlers) app.on(name, handler);
  return {
    read() {
      if (disposed) return [];
      const tick = progress();
      return [{ type: 'ready' }, ...(tick ? [tick] : [])];
    },
    dispose() {
      disposed = true;
      for (const [name, handler] of handlers) app.off(name, handler);
    },
  };
}
