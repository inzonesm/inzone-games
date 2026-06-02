'use client';

/* Dashboard data layer — ported from the standalone portal's
 * react-app/react-app/src/api.jsx (fetchLiveDashboard / emptyDashboard) to the
 * modular Firebase SDK. Reads the same Firestore collections the Flutter app
 * writes to, so the numbers are live:
 *
 *   html_games/{gameId}                → createdAt (days since launch)
 *   html_games/{gameId}/sessions       → players, sessions, coins, durations
 *   html_games/{gameId}/transactions   → recent coin purchases
 *   revenueSummary/{gameId}            → aggregated revenue (if present)
 *   humanUsers/{uid}                   → usernames for the activity feed
 *   game_coin_transactions             → per-title coin breakdown (expand view)
 *
 * Every query is best-effort: a missing collection or a denied read falls back
 * to zeros rather than throwing, so a brand-new game shows an honest empty
 * dashboard instead of an error.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fbLimit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { getDb } from './firebase';

export interface CoinActivityItem {
  nm?: string;
  amt: number;
  ago: string;
}

export interface RecentTransaction {
  id: string;
  tier: number;
  title: string;
  userId: string;
  sessionId: string;
  ago: string;
}

export interface DashboardData {
  sessionCount: number;
  liveSessionCount: number;
  totalPlayers: number;
  activePlayers7d: number;
  totalCoinsUsed: number;
  sessionsWithCoins: number;
  averageCoinsPerSession: number;
  totalPlaySeconds: number;
  averageSessionSeconds: number;
  grossCoins: number;
  commissionCoins: number;
  developerPayoutCoins: number;
  netPayoutCoins: number;
  commissionRate: number;
  transactionCount: number;
  tierBreakdown: Record<string, number>;
  status: 'empty' | 'pending';
  daysSinceLaunch: number;
  recentCoinActivity: CoinActivityItem[];
  recentTransactions: RecentTransaction[];
  deltas: { sessions?: number; payout?: number };
}

export interface CoinTitleBreakdown {
  title: string;
  coins: number;
  count: number;
  totalCoins: number;
}

/** Firestore Timestamp / date-like → JS Date (or null). */
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

/** Human-friendly "time ago" string. */
function formatTimeAgo(date: Date | null): string {
  if (!date) return '';
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function emptyDashboard(): DashboardData {
  return {
    sessionCount: 0,
    liveSessionCount: 0,
    totalPlayers: 0,
    activePlayers7d: 0,
    totalCoinsUsed: 0,
    sessionsWithCoins: 0,
    averageCoinsPerSession: 0,
    totalPlaySeconds: 0,
    averageSessionSeconds: 0,
    grossCoins: 0,
    commissionCoins: 0,
    developerPayoutCoins: 0,
    netPayoutCoins: 0,
    commissionRate: 0.1,
    transactionCount: 0,
    tierBreakdown: {},
    status: 'empty',
    daysSinceLaunch: 1,
    recentCoinActivity: [],
    recentTransactions: [],
    deltas: {},
  };
}

type Row = Record<string, unknown>;

/** Live dashboard metrics for one game. Always resolves (empty on failure). */
export async function fetchDashboard(gameId: string): Promise<DashboardData> {
  if (!gameId) return emptyDashboard();
  const db = getDb();

  try {
    // ── Game document (createdAt → days since launch) ──────────
    const gameSnap = await getDoc(doc(db, 'html_games', gameId));
    const gameData = (gameSnap.exists() ? gameSnap.data() : {}) as Row;
    const createdAt = toDate(gameData.createdAt) || new Date();
    const daysSinceLaunch = Math.max(
      1,
      Math.ceil((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24)),
    );

    // ── Sessions subcollection ─────────────────────────────────
    const sessionsSnap = await getDocs(collection(db, 'html_games', gameId, 'sessions'));
    const sessions: Row[] = sessionsSnap.docs.map((d): Row => ({ id: d.id, ...(d.data() as Row) }));
    const sessionCount = sessions.length;

    const totalPlayers = new Set(
      sessions.map((s) => s.user_id).filter(Boolean) as string[],
    ).size;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const activePlayers7d = new Set(
      sessions
        .filter((s) => {
          const opened = toDate(s.opened_at);
          return opened && opened >= sevenDaysAgo;
        })
        .map((s) => s.user_id)
        .filter(Boolean) as string[],
    ).size;

    const liveSessionCount = sessions.filter((s) => s.status === 'open').length;

    const totalCoinsUsed = sessions.reduce((sum, s) => sum + ((s.coins_spent as number) || 0), 0);
    const sessionsWithCoins = sessions.filter((s) => ((s.coins_spent as number) || 0) > 0).length;
    const averageCoinsPerSession = sessionCount > 0 ? Math.round(totalCoinsUsed / sessionCount) : 0;

    const totalPlaySeconds = sessions.reduce((sum, s) => sum + ((s.duration_seconds as number) || 0), 0);
    const averageSessionSeconds = sessionCount > 0 ? Math.round(totalPlaySeconds / sessionCount) : 0;

    // ── Revenue summary (optional) ─────────────────────────────
    let grossCoins = 0;
    let commissionCoins = 0;
    let developerPayoutCoins = 0;
    let transactionCount = 0;
    let tierBreakdown: Record<string, number> = {};

    try {
      const revSnap = await getDoc(doc(db, 'revenueSummary', gameId));
      if (revSnap.exists()) {
        const rev = revSnap.data() as Row;
        grossCoins = (rev.gross_coins as number) || 0;
        commissionCoins = (rev.commission_coins as number) || 0;
        developerPayoutCoins = (rev.developer_payout_coins as number) || 0;
        transactionCount = (rev.transaction_count as number) || 0;
        tierBreakdown = (rev.tier_breakdown as Record<string, number>) || {};
      }
    } catch {
      /* revenueSummary read is non-fatal */
    }

    // No revenueSummary doc → estimate from session coins (10% fee).
    if (!grossCoins && totalCoinsUsed > 0) {
      grossCoins = totalCoinsUsed;
      commissionCoins = Math.round(grossCoins * 0.1);
      developerPayoutCoins = grossCoins - commissionCoins;
    }

    // ── Recent coin activity (from sessions with coins) ────────
    const coinSessions = sessions
      .filter((s) => ((s.coins_spent as number) || 0) > 0)
      .sort((a, b) => {
        const aTime = toDate(a.updated_at) || toDate(a.opened_at) || new Date(0);
        const bTime = toDate(b.updated_at) || toDate(b.opened_at) || new Date(0);
        return bTime.getTime() - aTime.getTime();
      })
      .slice(0, 10);

    const coinUserIds = [...new Set(coinSessions.map((s) => s.user_id).filter(Boolean) as string[])];
    const usernameMap: Record<string, string> = {};
    if (coinUserIds.length > 0) {
      try {
        const userDocs = await Promise.all(
          coinUserIds.map((uid) => getDoc(doc(db, 'humanUsers', uid))),
        );
        userDocs.forEach((snap) => {
          if (snap.exists()) {
            const u = snap.data() as Row;
            usernameMap[snap.id] = ((u.username as string) || (u.name as string)) ?? '';
          }
        });
      } catch {
        /* humanUsers lookup is non-fatal */
      }
    }

    const recentCoinActivity: CoinActivityItem[] = coinSessions.map((s) => ({
      nm: usernameMap[s.user_id as string],
      amt: (s.coins_spent as number) || 0,
      ago: formatTimeAgo(toDate(s.updated_at) || toDate(s.opened_at) || new Date()),
    }));

    // ── Recent transactions subcollection (optional) ───────────
    let recentTransactions: RecentTransaction[] = [];
    try {
      const txSnap = await getDocs(
        query(
          collection(db, 'html_games', gameId, 'transactions'),
          orderBy('created_at', 'desc'),
          fbLimit(10),
        ),
      );
      if (!txSnap.empty) {
        recentTransactions = txSnap.docs.map((d) => {
          const data = d.data() as Row;
          return {
            id: d.id,
            tier: (data.coins as number) || 0,
            title: ((data.title as string) || (data.description as string) || 'Coin purchase'),
            userId: (data.user_id as string) || '',
            sessionId: (data.session_id as string) || '',
            ago: formatTimeAgo(toDate(data.created_at)),
          };
        });
        // Richer source for the activity stream when sessions had none.
        if (recentTransactions.length > 0 && recentCoinActivity.length === 0) {
          recentCoinActivity.push(
            ...recentTransactions.slice(0, 10).map((tx) => ({
              nm: (tx.userId || 'anon').slice(0, 8),
              amt: tx.tier,
              ago: tx.ago,
            })),
          );
        }
      }
    } catch {
      /* transactions subcollection might not exist yet */
    }

    return {
      sessionCount,
      liveSessionCount,
      totalPlayers,
      activePlayers7d,
      totalCoinsUsed,
      sessionsWithCoins,
      averageCoinsPerSession,
      totalPlaySeconds,
      averageSessionSeconds,
      grossCoins,
      commissionCoins,
      developerPayoutCoins,
      netPayoutCoins: developerPayoutCoins,
      commissionRate: 0.1,
      transactionCount,
      tierBreakdown,
      status: grossCoins > 0 ? 'pending' : 'empty',
      daysSinceLaunch,
      recentCoinActivity,
      recentTransactions,
      deltas: {},
    };
  } catch (err) {
    console.error('fetchDashboard error:', err);
    return emptyDashboard();
  }
}

/** Per-title coin breakdown for the expanded Coin Activity view. */
export async function fetchCoinBreakdown(gameId: string): Promise<CoinTitleBreakdown[]> {
  if (!gameId) return [];
  const db = getDb();
  try {
    const snap = await getDocs(
      query(collection(db, 'game_coin_transactions'), where('game_id', '==', gameId)),
    );
    const byTitle: Record<string, CoinTitleBreakdown> = {};
    snap.docs.forEach((d) => {
      const tx = d.data() as Row;
      const title = (tx.title as string) || 'Unknown';
      const coins = (tx.coins as number) || 0;
      if (!byTitle[title]) byTitle[title] = { title, coins, count: 0, totalCoins: 0 };
      byTitle[title].count += 1;
      byTitle[title].totalCoins += coins;
    });
    return Object.values(byTitle).sort((a, b) => b.count - a.count);
  } catch (e) {
    console.warn('game_coin_transactions fetch failed:', e);
    return [];
  }
}
