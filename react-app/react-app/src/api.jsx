/* InZone Studio — API client
 *
 * Follows the pattern from your TypeScript reference (createGroupChatFromBundle):
 *   1. Build endpoint from apiConfig.apiUrl + path
 *   2. POST FormData (for file uploads) or JSON
 *   3. Send X-Game-Key header on game-scoped calls
 *   4. On any failure, fall back to a deterministic local result so the
 *      portal still works end-to-end (matches buildLocalResult pattern)
 *   5. Tag the result with source: 'backend' | 'local' | 'firestore' | 'empty'
 *
 * Dashboard data is fetched LIVE from Firestore using the same collections
 * the Flutter app writes to:
 *   html_games/{gameId}/sessions   — session documents
 *   html_games/{gameId}/transactions — coin purchase documents
 *   revenueSummary/{gameId}        — aggregated revenue
 */

const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'game';

const REGISTER_GAME_ENDPOINT = '/api/game-sdk/games/register';
const DASHBOARD_ENDPOINT = '/api/game-sdk/dashboard';
const GAME_STATE_ENDPOINT = '/api/game-sdk/game-state';
const GROUP_CHAT_ENDPOINT = '/api/game-sdk/group-chats/create';

// ──────────────────────────────────────────────────────────────────
// MOCK DATA — completely commented out.
// All dashboard values now come from live Firestore queries.
// ──────────────────────────────────────────────────────────────────

/*
const MOCK_GAMES = [
  { gameId: 'nova-arena', name: 'Nova Arena', initials: 'NA', studio: 'Volta Games', status: 'live', gradient: 'radial-gradient(120% 100% at 30% 20%, oklch(0.78 0.12 232), oklch(0.50 0.13 250))' },
  { gameId: 'driftwave-karts', name: 'Driftwave Karts', initials: 'DK', studio: 'Volta Games', status: 'live', gradient: 'radial-gradient(120% 100% at 30% 20%, oklch(0.80 0.14 340), oklch(0.55 0.16 320))' },
  { gameId: 'rune-runners', name: 'Rune Runners', initials: 'RR', studio: 'Volta Games', status: 'live', gradient: 'radial-gradient(120% 100% at 30% 20%, oklch(0.82 0.14 75), oklch(0.60 0.16 50))' },
];

const MOCK_DASHBOARD = {
  'nova-arena': {
    day1Retention: 0.78, day3Retention: 0.54, day7Retention: 0.31,
    sessionCount: 1210000, totalPlaySeconds: 1564480000, averageSessionSeconds: 862,
    totalPlayers: 184392, activePlayers7d: 42108,
    totalCoinsUsed: 3420000, averageCoinsPerSession: 31.6, sessionsWithCoins: 271040,
    tierBreakdown: { tier10: 214820, tier50: 38402, tier150: 8917, tier400: 2148 },
    grossCoins: 3156110, commissionCoins: 315611, developerPayoutCoins: 2840499,
    netPayoutCoins: 2840499, commissionRate: 0.10, status: 'pending',
    deltas: { players: 0.084, active7d: 0.031, sessions: 0.127, avgSessionLength: 0.014, sessionsWithCoins: 0.028, avgCoinsPerSession: 0.052, payout: 0.182 },
  },
  'driftwave-karts': {
    day1Retention: 0.66, day3Retention: 0.41, day7Retention: 0.22,
    sessionCount: 480000, totalPlaySeconds: 432000000, averageSessionSeconds: 600,
    totalPlayers: 62100, activePlayers7d: 14200,
    totalCoinsUsed: 1080000, averageCoinsPerSession: 22.5, sessionsWithCoins: 96000,
    tierBreakdown: { tier10: 68000, tier50: 12000, tier150: 2400, tier400: 480 },
    grossCoins: 1010000, commissionCoins: 101000, developerPayoutCoins: 909000,
    netPayoutCoins: 909000, commissionRate: 0.10, status: 'pending',
    deltas: { players: 0.142, active7d: 0.067, sessions: 0.221, avgSessionLength: -0.012, sessionsWithCoins: 0.044, avgCoinsPerSession: 0.071, payout: 0.247 },
  },
  'rune-runners': {
    day1Retention: 0.71, day3Retention: 0.48, day7Retention: 0.26,
    sessionCount: 220000, totalPlaySeconds: 198000000, averageSessionSeconds: 540,
    totalPlayers: 28400, activePlayers7d: 7800,
    totalCoinsUsed: 462000, averageCoinsPerSession: 19.2, sessionsWithCoins: 48400,
    tierBreakdown: { tier10: 32000, tier50: 5400, tier150: 1100, tier400: 220 },
    grossCoins: 442000, commissionCoins: 44200, developerPayoutCoins: 397800,
    netPayoutCoins: 397800, commissionRate: 0.10, status: 'pending',
    deltas: { players: 0.034, active7d: 0.012, sessions: 0.087, avgSessionLength: 0.022, sessionsWithCoins: 0.018, avgCoinsPerSession: 0.041, payout: 0.078 },
  },
};

const MOCK_TX = [
  { id: 'tx_1', tier: 10, title: 'Extra attempt after fail state', userId: 'user_4982', sessionId: 'sess_7321', ago: '3s ago' },
  { id: 'tx_2', tier: 50, title: 'Hardcore mode unlock', userId: 'user_2014', sessionId: 'sess_7320', ago: '42s ago' },
  { id: 'tx_3', tier: 10, title: 'Extra attempt after fail state', userId: 'user_3318', sessionId: 'sess_7319', ago: '1m ago' },
  { id: 'tx_4', tier: 150, title: 'Cosmic Hull skin (permanent)', userId: 'user_8821', sessionId: 'sess_7314', ago: '3m ago' },
  { id: 'tx_5', tier: 10, title: 'Extra attempt after fail state', userId: 'user_1042', sessionId: 'sess_7308', ago: '4m ago' },
  { id: 'tx_6', tier: 400, title: 'Season 03 pass', userId: 'user_6611', sessionId: 'sess_7301', ago: '7m ago' },
  { id: 'tx_7', tier: 50, title: 'Leaderboard entry — weekend', userId: 'user_9930', sessionId: 'sess_7298', ago: '9m ago' },
];

const MOCK_PAYOUTS = [
  { period: 'May 2026', gross: 3156.11, fee: 315.61, net: 2840.50, paid: null, status: 'pending', game: 'all' },
  { period: 'April 2026', gross: 4201.88, fee: 420.19, net: 3781.69, paid: 'May 1, 2026', status: 'paid', game: 'all' },
  { period: 'March 2026', gross: 3712.40, fee: 371.24, net: 3341.16, paid: 'Apr 1, 2026', status: 'paid', game: 'all' },
  { period: 'February 2026', gross: 2984.20, fee: 298.42, net: 2685.78, paid: 'Mar 1, 2026', status: 'paid', game: 'all' },
  { period: 'January 2026', gross: 1820.00, fee: 182.00, net: 1638.00, paid: 'Feb 1, 2026', status: 'paid', game: 'all' },
  { period: 'December 2025', gross: 1204.50, fee: 120.45, net: 1084.05, paid: 'Jan 2, 2026', status: 'paid', game: 'all' },
  { period: 'November 2025', gross: 648.20, fee: 64.82, net: 583.38, paid: 'Dec 1, 2025', status: 'paid', game: 'all' },
];
*/

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

const buildHeaders = (gameKey) => {
  const h = {};
  if (gameKey) h['X-Game-Key'] = gameKey;
  return h;
};

const safeFetch = async (url, options) => {
  try {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    return null;
  }
};

/** Human-friendly "time ago" string from a Date. */
function formatTimeAgo(date) {
  if (!date) return '';
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Safely convert a Firestore Timestamp or date-like value to a JS Date. */
function toDate(val) {
  if (!val) return null;
  if (typeof val.toDate === 'function') return val.toDate();
  if (val instanceof Date) return val;
  if (typeof val === 'string' || typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────
// Live Firestore queries — replaces all mock dashboard data
// ──────────────────────────────────────────────────────────────────

/**
 * Fetch dashboard metrics directly from Firestore.
 *
 * Queries:
 *   html_games/{gameId}               → createdAt (for "day since launch")
 *   html_games/{gameId}/sessions      → session docs (count, players, coins, durations)
 *   html_games/{gameId}/transactions  → coin purchase transactions
 *   revenueSummary/{gameId}           → aggregated revenue (if present)
 */
async function fetchLiveDashboard(gameId) {
  const db = window.inzoneFirebase?.db;
  if (!db) return null;

  try {
    // ── Game document (createdAt for day-count) ──────────────
    const gameDoc = await db.collection('html_games').doc(gameId).get();
    const gameData = gameDoc.exists ? gameDoc.data() : {};
    const createdAt = toDate(gameData.createdAt) || new Date();
    const daysSinceLaunch = Math.max(
      1,
      Math.ceil((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24)),
    );

    // ── Sessions subcollection ───────────────────────────────
    const sessionsSnap = await db
      .collection('html_games')
      .doc(gameId)
      .collection('sessions')
      .get();

    const sessions = sessionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const sessionCount = sessions.length;

    // Unique players (all time)
    const allUserIds = new Set(sessions.map((s) => s.user_id).filter(Boolean));
    const totalPlayers = allUserIds.size;

    // Active in last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const activePlayers7d = new Set(
      sessions
        .filter((s) => {
          const opened = toDate(s.opened_at);
          return opened && opened >= sevenDaysAgo;
        })
        .map((s) => s.user_id)
        .filter(Boolean),
    ).size;

    // Currently live (status === 'open')
    const liveSessionCount = sessions.filter((s) => s.status === 'open').length;

    // Coin metrics from sessions
    const totalCoinsUsed = sessions.reduce(
      (sum, s) => sum + (s.coins_spent || 0),
      0,
    );
    const sessionsWithCoins = sessions.filter(
      (s) => (s.coins_spent || 0) > 0,
    ).length;
    const averageCoinsPerSession =
      sessionCount > 0 ? Math.round(totalCoinsUsed / sessionCount) : 0;

    // Play time
    const totalPlaySeconds = sessions.reduce(
      (sum, s) => sum + (s.duration_seconds || 0),
      0,
    );
    const averageSessionSeconds =
      sessionCount > 0 ? Math.round(totalPlaySeconds / sessionCount) : 0;

    // ── Revenue summary ──────────────────────────────────────
    let grossCoins = 0;
    let commissionCoins = 0;
    let developerPayoutCoins = 0;
    let transactionCount = 0;
    let tierBreakdown = {};

    try {
      const revSnap = await db.collection('revenueSummary').doc(gameId).get();
      if (revSnap.exists) {
        const rev = revSnap.data();
        grossCoins = rev.gross_coins || 0;
        commissionCoins = rev.commission_coins || 0;
        developerPayoutCoins = rev.developer_payout_coins || 0;
        transactionCount = rev.transaction_count || 0;
        tierBreakdown = rev.tier_breakdown || {};
      }
    } catch (e) {
      console.warn('revenueSummary read failed (non-fatal):', e);
    }

    // If no revenueSummary doc, estimate from session coins
    if (!grossCoins && totalCoinsUsed > 0) {
      grossCoins = totalCoinsUsed;
      commissionCoins = Math.round(grossCoins * 0.1);
      developerPayoutCoins = grossCoins - commissionCoins;
    }

    // ── Recent coin activity (from sessions with coins) ──────
    const coinSessions = sessions
      .filter((s) => (s.coins_spent || 0) > 0)
      .sort((a, b) => {
        const aTime = toDate(a.updated_at) || toDate(a.opened_at) || new Date(0);
        const bTime = toDate(b.updated_at) || toDate(b.opened_at) || new Date(0);
        return bTime - aTime;
      })
      .slice(0, 10);

    // Look up usernames from humanUsers collection
    const coinUserIds = [...new Set(coinSessions.map((s) => s.user_id).filter(Boolean))];
    const usernameMap = {};
    if (coinUserIds.length > 0) {
      try {
        const userDocs = await Promise.all(
          coinUserIds.map((uid) => db.collection('humanUsers').doc(uid).get()),
        );
        userDocs.forEach((snap) => {
          if (snap.exists) {
            const u = snap.data();
            usernameMap[snap.id] = u.username || u.name;
          }
        });
      } catch (e) {
        console.warn('humanUsers lookup failed (non-fatal):', e);
      }
    }

    const recentCoinActivity = coinSessions.map((s) => ({
      nm: usernameMap[s.user_id],
      amt: s.coins_spent || 0,
      ago: formatTimeAgo(
        toDate(s.updated_at) || toDate(s.opened_at) || new Date(),
      ),
    }));

    // ── Recent transactions (from transactions subcollection) ─
    let recentTransactions = [];
    try {
      const txSnap = await db
        .collection('html_games')
        .doc(gameId)
        .collection('transactions')
        .orderBy('created_at', 'desc')
        .limit(10)
        .get();

      if (!txSnap.empty) {
        recentTransactions = txSnap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            tier: data.coins || 0,
            title: data.title || data.description || 'Coin purchase',
            userId: data.user_id || '',
            sessionId: data.session_id || '',
            ago: formatTimeAgo(toDate(data.created_at)),
          };
        });

        // If we got transactions, use them for the coin activity stream too
        // (they have richer data than the session-level aggregation)
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
    } catch (e) {
      // transactions subcollection might not exist yet
      console.warn('transactions query failed (non-fatal):', e);
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
      // No historical deltas available from a single snapshot.
      // A future version can compute W/W deltas by storing weekly snapshots.
      deltas: {},
    };
  } catch (err) {
    console.error('fetchLiveDashboard error:', err);
    return null;
  }
}

/** Empty dashboard shape — used when there's no data at all. */
function emptyDashboard() {
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

// ──────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────

/* List the developer's games (used by the game switcher).
 * Reads from the html_games collection filtered by uploaderId. */
async function listGames() {
  const db = window.inzoneFirebase?.db;
  const auth = window.inzoneFirebase?.auth;
  if (db && auth?.currentUser) {
    try {
      const snap = await db
        .collection('html_games')
        .where('uploaderId', '==', auth.currentUser.uid)
        .get();
      const games = snap.docs.map((d) => {
        const data = d.data();
        return {
          gameId: d.id,
          name: data.name || d.id,
          initials: (data.name || d.id)
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0]?.toUpperCase())
            .join(''),
          studio: auth.currentUser.displayName || data.uploaderId,
          status: data.status || 'live',
          gradient:
            'radial-gradient(120% 100% at 30% 20%, oklch(0.78 0.12 232), oklch(0.50 0.13 250))',
        };
      });
      return { source: 'firestore', games };
    } catch (e) {
      console.warn('listGames Firestore query failed:', e);
    }
  }
  return { source: 'empty', games: [] };
}

/* Register a new game build (your /games/register endpoint).
 * FormData payload matches your TS reference. */
async function registerGame(values) {
  const endpoint = `${window.apiConfig.apiUrl}${REGISTER_GAME_ENDPOINT}`;
  const formData = new FormData();
  formData.append('gameTitle', values.gameTitle);
  formData.append('description', values.summary || '');
  formData.append('developerName', values.developerName || '');
  formData.append('iconPreviewUrl', values.iconPreviewUrl || '');
  if (values.gameIconFile)
    formData.append('gameIcon', values.gameIconFile, values.gameIconFile.name);
  if (values.bundleFile)
    formData.append('bundleFile', values.bundleFile, values.bundleFile.name);

  const data = await safeFetch(endpoint, { method: 'POST', body: formData });

  const slug = slugify(values.gameTitle);
  const gameId = data?.gameId || slug;
  const gameKey =
    data?.gameKey ||
    `gk_live_${slug.slice(0, 4)}_demo_${Math.random().toString(36).slice(2, 6)}`;
  const liveUrl = data?.liveUrl || `inzone.gg/play/${slug}`;

  return {
    source: data ? 'backend' : 'local',
    success: true,
    gameId,
    gameKey,
    liveUrl,
    message:
      data?.message ||
      `Registered ${values.gameTitle}. Backend will return real credentials when wired.`,
  };
}

/* Fetch the dashboard payload.
 * Priority: live Firestore → backend endpoint → empty state. */
async function getDashboard(gameId, gameKey) {
  // 1. Try live Firestore query first (reads the same collections the Flutter app writes to)
  const live = await fetchLiveDashboard(gameId);
  if (live) return { source: 'firestore', dashboard: live };

  // 2. Try backend endpoint
  const endpoint = `${window.apiConfig.apiUrl}${DASHBOARD_ENDPOINT}?gameId=${encodeURIComponent(gameId)}`;
  const data = await safeFetch(endpoint, { headers: buildHeaders(gameKey) });
  if (data) return { source: 'backend', dashboard: data };

  // 3. Return empty dashboard (no mock data)
  return { source: 'empty', dashboard: emptyDashboard() };
}

/* Fetch recent coin transactions for the activity feed.
 * Reads from html_games/{gameId}/transactions subcollection. */
async function getRecentTransactions(gameId, gameKey, limit = 7) {
  const db = window.inzoneFirebase?.db;
  if (db) {
    try {
      const txSnap = await db
        .collection('html_games')
        .doc(gameId)
        .collection('transactions')
        .orderBy('created_at', 'desc')
        .limit(limit)
        .get();

      if (!txSnap.empty) {
        const transactions = txSnap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            tier: data.coins || 0,
            title: data.title || data.description || 'Coin purchase',
            userId: data.user_id || '',
            sessionId: data.session_id || '',
            ago: formatTimeAgo(toDate(data.created_at)),
          };
        });
        return { source: 'firestore', transactions };
      }
    } catch (err) {
      console.warn('Firestore transactions query failed:', err);
    }
  }

  return { source: 'empty', transactions: [] };
}

/* Payout history — reads from Firestore when collection exists. */
async function getPayoutHistory() {
  // TODO: implement payout history from a payouts Firestore collection
  // when that collection is created by the backend.
  return { source: 'empty', payouts: [] };
}

/* Top players — LIVE per-player aggregates from the game's session docs
 * (replaces the Players page's sample rows). Same tier labels the sample
 * table used: Whale ≥ 5 000 coins · Dolphin ≥ 1 000 · Casual ≥ 100 · New. */
async function getTopPlayers(gameId, max = 25) {
  const db = window.inzoneFirebase?.db;
  if (!db || !gameId) return { source: 'empty', players: [] };
  try {
    const snap = await db.collection('html_games').doc(gameId).collection('sessions').get();
    const byUser = {};
    snap.docs.forEach((d) => {
      const s = d.data();
      const uid = s.user_id || '';
      if (!uid) return;
      const agg = (byUser[uid] ||= { sessions: 0, coins: 0, first: null, last: null });
      agg.sessions += 1;
      agg.coins += s.coins_spent || 0;
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
          const u = await db.collection('humanUsers').doc(uid).get();
          return u.exists ? u.data() : null;
        } catch {
          return null;
        }
      }),
    );

    const tierFor = (coins) =>
      coins >= 5000 ? 'Whale' : coins >= 1000 ? 'Dolphin' : coins >= 100 ? 'Casual' : 'New';
    const hueFor = (id) => {
      let h = 0;
      for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
      return h;
    };

    const players = ranked.map(([uid, agg], i) => {
      const u = profiles[i];
      return {
        id: uid,
        handle: (u && (u.username || u.name)) || `player_${uid.slice(0, 6)}`,
        country: (u && u.country) || '—',
        cohort: agg.first
          ? agg.first.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
          : '—',
        tier: tierFor(agg.coins),
        sessions: agg.sessions,
        coinsSpent: agg.coins,
        last: formatTimeAgo(agg.last) || '—',
        avatarHue: hueFor(uid),
      };
    });
    return { source: 'firestore', players };
  } catch (e) {
    console.warn('getTopPlayers failed:', e);
    return { source: 'empty', players: [] };
  }
}

window.inzoneAPI = {
  listGames,
  registerGame,
  getDashboard,
  getRecentTransactions,
  getPayoutHistory,
  getTopPlayers,
  fetchLiveDashboard,
  slugify,
  formatTimeAgo,
  // MOCK_GAMES_SEED removed — mock data is commented out.
  // The seedGames debug helper in App.jsx will receive [] and is a no-op.
  MOCK_GAMES_SEED: [],
  REGISTER_GAME_ENDPOINT,
  DASHBOARD_ENDPOINT,
  GAME_STATE_ENDPOINT,
  GROUP_CHAT_ENDPOINT,
};
