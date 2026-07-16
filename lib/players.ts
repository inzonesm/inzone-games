'use client';

/* Top-players data layer — replaces the Players page's sample rows with live
 * per-player aggregates from the same Firestore the dashboard reads:
 *
 *   html_games/{gameId}/sessions  → user_id, coins_spent, opened_at,
 *                                   updated_at (written by the Flutter app)
 *   humanUsers/{uid}              → username / name / country for display
 *
 * Aggregation per player: session count, coins spent, first-seen cohort,
 * last-seen. Tier is a simple spend classification (same labels the sample
 * table used): Whale ≥ 5 000 coins · Dolphin ≥ 1 000 · Casual ≥ 100 · New.
 * Best-effort like lib/dashboard.ts — failures return an empty list. */

import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { getDb } from './firebase';

export type PlayerTier = 'Whale' | 'Dolphin' | 'Casual' | 'New';

export interface PlayerRow {
  id: string;
  handle: string;
  country: string;
  cohort: string;
  tier: PlayerTier;
  sessions: number;
  coinsSpent: number;
  last: string;
  lastMs: number;
  avatarHue: number;
}

type Row = Record<string, unknown>;

function toDate(val: unknown): Date | null {
  if (!val) return null;
  if (typeof (val as { toDate?: unknown }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate();
  }
  if (val instanceof Date) return val;
  if (typeof val === 'string' || typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function timeAgo(date: Date | null): string {
  if (!date) return '—';
  const s = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function tierFor(coins: number): PlayerTier {
  if (coins >= 5000) return 'Whale';
  if (coins >= 1000) return 'Dolphin';
  if (coins >= 100) return 'Casual';
  return 'New';
}

/** Stable hue from a uid so avatars keep their color between loads. */
function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

/** Live per-player aggregates for one game, ranked by coins spent then
 *  sessions. Always resolves; missing data → empty list. */
export async function fetchTopPlayers(gameId: string, max = 25): Promise<PlayerRow[]> {
  if (!gameId) return [];
  const db = getDb();
  try {
    const snap = await getDocs(collection(db, 'html_games', gameId, 'sessions'));
    const byUser: Record<string, { sessions: number; coins: number; first: Date | null; last: Date | null }> = {};
    snap.docs.forEach((d) => {
      const s = d.data() as Row;
      const uid = (s.user_id as string) || '';
      if (!uid) return;
      const agg = (byUser[uid] ||= { sessions: 0, coins: 0, first: null, last: null });
      agg.sessions += 1;
      agg.coins += (s.coins_spent as number) || 0;
      const opened = toDate(s.opened_at);
      const seen = toDate(s.updated_at) || opened;
      if (opened && (!agg.first || opened < agg.first)) agg.first = opened;
      if (seen && (!agg.last || seen > agg.last)) agg.last = seen;
    });

    const ranked = Object.entries(byUser)
      .sort(([, a], [, b]) => b.coins - a.coins || b.sessions - a.sessions)
      .slice(0, max);

    // Display names / countries from humanUsers, fetched in parallel.
    const profiles = await Promise.all(
      ranked.map(async ([uid]) => {
        try {
          const u = await getDoc(doc(db, 'humanUsers', uid));
          return u.exists() ? (u.data() as Row) : null;
        } catch {
          return null;
        }
      }),
    );

    return ranked.map(([uid, agg], i) => {
      const u = profiles[i];
      const handle =
        (u?.username as string) || (u?.name as string) || `player_${uid.slice(0, 6)}`;
      return {
        id: uid,
        handle,
        country: (u?.country as string) || '—',
        cohort: agg.first
          ? agg.first.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
          : '—',
        tier: tierFor(agg.coins),
        sessions: agg.sessions,
        coinsSpent: agg.coins,
        last: timeAgo(agg.last),
        lastMs: agg.last?.getTime() ?? 0,
        avatarHue: hueFor(uid),
      };
    });
  } catch (e) {
    console.warn('fetchTopPlayers failed:', e);
    return [];
  }
}
