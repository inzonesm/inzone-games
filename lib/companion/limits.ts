import { COMPANION_LIMITS } from './config.ts';

type WindowHit = { at: number; chars: number };

const turns = new Map<string, number[]>();
const inflight = new Map<string, number>();
const spend = new Map<string, WindowHit[]>();
let globalSpend: WindowHit[] = [];

function prune(list: number[], now: number, windowMs: number): number[] {
  return list.filter((at) => now - at < windowMs);
}

function pruneHits(list: WindowHit[], now: number): WindowHit[] {
  const start = startOfUtcDay(now);
  return list.filter((hit) => hit.at >= start);
}

function startOfUtcDay(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function companionLimitError(
  uid: string,
  chars: number,
  now = Date.now(),
): 'rate_limited' | 'concurrency' | 'spend_limited' | null {
  const current = inflight.get(uid) ?? 0;
  if (current >= COMPANION_LIMITS.maxConcurrentPerUid) return 'concurrency';
  const recent = prune(turns.get(uid) ?? [], now, COMPANION_LIMITS.turnWindowMs);
  if (recent.length >= COMPANION_LIMITS.maxTurnsPerWindow) return 'rate_limited';
  const uidSpend = pruneHits(spend.get(uid) ?? [], now);
  const uidChars = uidSpend.reduce((sum, hit) => sum + hit.chars, 0);
  if (uidChars + chars > COMPANION_LIMITS.maxTtsCharsPerUidDay) return 'spend_limited';
  globalSpend = pruneHits(globalSpend, now);
  const globalChars = globalSpend.reduce((sum, hit) => sum + hit.chars, 0);
  if (globalChars + chars > COMPANION_LIMITS.maxTtsCharsGlobalDay) return 'spend_limited';
  return null;
}

export function beginCompanionTurn(uid: string): void {
  inflight.set(uid, (inflight.get(uid) ?? 0) + 1);
}

export function finishCompanionTurn(uid: string, chars: number, now = Date.now()): void {
  const current = inflight.get(uid) ?? 1;
  if (current <= 1) inflight.delete(uid);
  else inflight.set(uid, current - 1);
  const recent = prune(turns.get(uid) ?? [], now, COMPANION_LIMITS.turnWindowMs);
  recent.push(now);
  turns.set(uid, recent);
  if (chars > 0) {
    const uidSpend = pruneHits(spend.get(uid) ?? [], now);
    uidSpend.push({ at: now, chars });
    spend.set(uid, uidSpend);
    globalSpend = pruneHits(globalSpend, now);
    globalSpend.push({ at: now, chars });
  }
}

export function resetCompanionLimitsForTests(): void {
  turns.clear();
  inflight.clear();
  spend.clear();
  globalSpend = [];
}
