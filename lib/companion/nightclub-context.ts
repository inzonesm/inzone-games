import { COMPANION_LIMITS } from './config.ts';

/**
 * Nightclub v2 bridge fields we are willing to mention.
 *
 * Inspected meaning (not a coaching guarantee):
 * - runId: engine run label (`run-1`, …). Changes on restart.
 * - ended / outcome: match-over flags from NightclubBridge.getState().
 * - snapshot.waveId / heroLife / mobsAlive: last bridge snapshot.
 * - ammo: hero.ammo on the runtime hero, not a start signal.
 * - paused / cinematic: host-side exclusions for active play.
 *
 * All of this is untrusted structured data from the embed. Stale snapshots
 * must not be used as if they are this second.
 */
export type NightclubPublicContext = {
  source: 'nightclub_bridge';
  freshnessMs: number | null;
  stale: boolean;
  runId?: string;
  ended?: boolean;
  outcome?: string;
  waveId?: number;
  heroLife?: number;
  mobsAlive?: number;
  ammo?: number;
  paused?: boolean;
  cinematic?: boolean;
};

const OUTCOMES = new Set(['win', 'lose', 'draw', 'complete', 'defeat', 'victory']);

function finiteInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const n = Math.round(value);
  if (n < min || n > max) return undefined;
  return n;
}

function finiteBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function sanitizeNightclubContext(
  raw: unknown,
  observedAt: number,
  now = Date.now(),
): NightclubPublicContext | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const snap =
    input.snapshot && typeof input.snapshot === 'object' && !Array.isArray(input.snapshot)
      ? (input.snapshot as Record<string, unknown>)
      : input;

  const freshnessMs =
    Number.isFinite(observedAt) && observedAt > 0 ? Math.max(0, now - observedAt) : null;
  const stale = freshnessMs === null || freshnessMs > COMPANION_LIMITS.staleContextMs;

  const runId = typeof input.runId === 'string' ? input.runId.trim().slice(0, 32) : '';
  const outcomeRaw = typeof input.outcome === 'string' ? input.outcome.trim().toLowerCase() : '';

  const out: NightclubPublicContext = {
    source: 'nightclub_bridge',
    freshnessMs,
    stale,
  };
  if (runId && /^run-\d{1,4}$/.test(runId)) out.runId = runId;
  const ended = finiteBool(input.ended);
  if (ended !== undefined) out.ended = ended;
  if (outcomeRaw && OUTCOMES.has(outcomeRaw)) out.outcome = outcomeRaw;
  const waveId = finiteInt(snap.waveId ?? input.waveId, 0, 99);
  if (waveId !== undefined) out.waveId = waveId;
  const heroLife = finiteInt(snap.heroLife ?? input.heroLife, 0, 20);
  if (heroLife !== undefined) out.heroLife = heroLife;
  const mobsAlive = finiteInt(snap.mobsAlive ?? input.mobsAlive, 0, 40);
  if (mobsAlive !== undefined) out.mobsAlive = mobsAlive;
  const ammo = finiteInt(snap.ammo ?? input.ammo, 0, 30);
  if (ammo !== undefined) out.ammo = ammo;
  const paused = finiteBool(input.paused);
  if (paused !== undefined) out.paused = paused;
  const cinematic = finiteBool(input.cinematic);
  if (cinematic !== undefined) out.cinematic = cinematic;
  return out;
}

export function describeNightclubContext(ctx: NightclubPublicContext | null): string {
  if (!ctx) return 'No Nightclub snapshot is attached.';
  if (ctx.stale) {
    return `A Nightclub snapshot is attached but it is stale (${ctx.freshnessMs ?? 'unknown'} ms). Do not coach as if it is current.`;
  }
  const bits = ['The build last reported'];
  if (ctx.ended) bits.push('the match had ended');
  if (ctx.outcome) bits.push(`outcome ${ctx.outcome}`);
  if (ctx.waveId !== undefined) bits.push(`wave ${ctx.waveId}`);
  if (ctx.heroLife !== undefined) bits.push(`hero life ${ctx.heroLife}`);
  if (ctx.mobsAlive !== undefined) bits.push(`${ctx.mobsAlive} mobs alive`);
  if (ctx.ammo !== undefined) bits.push(`ammo ${ctx.ammo}`);
  if (ctx.paused) bits.push('paused');
  if (ctx.cinematic) bits.push('intro cinematic still running');
  if (bits.length === 1) return 'A fresh Nightclub snapshot is attached but empty.';
  return `${bits.join(', ')}. Label these as last-reported, not as live coaching.`;
}
