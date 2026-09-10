'use client';

/* Endpoints — the full SDK reference a developer wires into their game:
 * how the config + InZoneSDK bridge are injected, all eight endpoint
 * families, authentication, error codes, coin tiers, the typical
 * integration flow, troubleshooting, plus live integration-health
 * metrics. Mirrors the downloadable guide at /docs/inzone-game-sdk-guide.md
 * (served from public/docs). The reference cards are static copy; the
 * "Integration health" panel reads live game_sdk_metrics via
 * lib/endpoints.ts and refreshes every 60s — currently hidden behind
 * SHOW_INTEGRATION_HEALTH, flip it back to true to re-activate. */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Shell } from '@/components/Shell';
import { fetchDeveloperGames } from '@/lib/games';
import { fetchIntegrationHealth, type IntegrationHealth } from '@/lib/endpoints';
import type { DeveloperGame } from '@/lib/types';

const GUIDE_PATH = '/docs/inzone-game-sdk-guide.md';

/* Integration-health panel (requests / error rate / p95 latency). Off for
 * now — the fetch + rendering below stay intact, so flipping this to true
 * brings the panel back with no other changes. While false, no metrics
 * polling happens either. */
const SHOW_INTEGRATION_HEALTH: boolean = false;

interface EndpointDef {
  method: string;
  path: string;
  title: string;
  desc: string;
  tags: string[];
  accent: string;
  auth: boolean;          // requires the X-Game-Key header
  bridge: string | null;  // InZoneSDK method, or null → direct fetch only
  sample: string;
}

const CONNECT_SAMPLE = `// InZone injects the config + SDK AFTER your page
// (and every script/font/image) finishes loading.
// Never wait with a timeout — listen for the event:
function waitForConfig() {
  return new Promise((resolve) => {
    if (window.__INZONE_SOCIAL_LOOP_CONFIG__) {
      return resolve(window.__INZONE_SOCIAL_LOOP_CONFIG__);
    }
    window.addEventListener('inzone:sdk-ready',
      (e) => resolve(e.detail), { once: true });
  });
}

const config = await waitForConfig();
// …or simply:
const config = await window.InZoneSDK.getConfig();`;

const CONFIG_FIELDS: Array<[string, string]> = [
  ['gameId', 'your registered game identifier'],
  ['gameName', 'human-readable game name'],
  ['gameKey', 'API key for protected endpoints (coins, game-state)'],
  ['sessionId', 'current play session ID'],
  ['userId', "the player's InZone user ID (Firebase UID)"],
  ['backendBaseUrl', 'the backend URL — never hardcode one'],
  ['fixtureMode', 'true when running locally without a real backend'],
];

const BRIDGE_METHODS: Array<[string, string]> = [
  ['InZoneSDK.getConfig()', 'resolves with the config object'],
  ['InZoneSDK.postScore(payload)', 'POST /post-score'],
  ['InZoneSDK.sendChallenge(payload)', 'POST /send-challenge + native share sheet'],
  ['InZoneSDK.openChat(payload)', 'POST /open-chat'],
  ['InZoneSDK.gameState(payload)', 'GET /game-state'],
  ['InZoneSDK.purchaseCoinTier(coins, payload)', 'POST /coins/tier-{coins}'],
  ['InZoneSDK.close()', 'exits the game, returns to InZone'],
];

const ENDPOINTS: EndpointDef[] = [
  {
    method: 'POST',
    path: '/api/game-sdk/post-score',
    title: 'Post Score',
    desc: 'Call on game-over, round-end or level-complete. Records the score, writes a leaderboard entry, and returns the player rank, a top-10 snippet and ready-made share data.',
    tags: ['runs', 'ranked', 'share-data'],
    accent: 'var(--blue-2)',
    auth: false,
    bridge: 'InZoneSDK.postScore(payload)',
    sample: `// Request fields:
//   gameId: string (required)
//   score: number (required)
//   playerId: string — omit for anonymous
//   gameName: string — falls back to gameId
//   durationMs: number — round duration in ms
//   sessionId: string
//   platform: string — e.g. "flutter-webview"
//   playerName: string — falls back to "Player"
//   metadata: object — arbitrary key-value pairs

const data = await InZoneSDK.postScore({
  score: 14820,
  durationMs: 92447,
  playerName: 'ProGamer42',
  metadata: { lap: 3 },
});

// Response types:
//   data.player.rank: number | null
//   data.score.value: number
//   data.score.best: number
//   data.leaderboard.entries: Array<{
//     rank: number, playerId: string,
//     displayName: string, score: number }>
//   data.share.title: string
//   data.share.url: string`,
  },
  {
    method: 'POST',
    path: '/api/game-sdk/send-challenge',
    title: 'Challenge',
    desc: 'Creates a 24-hour duel and generates a share card in one call — the old standalone share-card endpoint no longer exists. Includes a deep link (inzone://game?gameId=…, delivered via an AppsFlyer OneLink with deep_link_value=community_game) that opens the community game on the Game Hub inside InZone.',
    tags: ['social', 'duel', '24h', 'deep-link'],
    accent: 'var(--pink)',
    auth: false,
    bridge: 'InZoneSDK.sendChallenge(payload)',
    sample: `// Request fields:
//   gameId: string (required)
//   senderId: string (required) — challenger's userId
//   recipientId: string — omit for open challenge
//   score: number
//   message: string — default "Can you beat this score?"
//   sessionId: string
//   challengeType: string — default "duel"
//   expiresHours: number — default 24
//   title: string — auto-generated from score if omitted
//   template: string — default "default"
//   shareUrl: string — default AppsFlyer OneLink (deep_link_value=community_game, af_dp=inzone://game?gameId={gameId})
//   imageUrl: string | null

const data = await InZoneSDK.sendChallenge({
  senderId: config.userId,
  recipientId: 'friend_abc',
  score: 14820,
  message: 'Can you beat this score?',
});

// Response types:
//   data.challenge.challengeId: string
//   data.challenge.gameDeepLink: string
//   data.challenge.expiresAt: string (ISO 8601)
//   data.challenge.status: "pending"
//   data.share.url: string
//   data.share.gameDeepLink: string
//   data.share.text: string`,
  },
  {
    method: 'POST',
    path: '/api/game-sdk/progress/share',
    title: 'Progress',
    desc: 'Shareable snapshot of an achievement, high score or milestone — without creating a challenge. Use for "Share Progress" / "Brag" buttons. No bridge method — use direct fetch.',
    tags: ['feed', 'visual', 'share'],
    accent: 'var(--pos)',
    auth: false,
    bridge: null,
    sample: `// Request fields:
//   gameId: string (required)
//   userId: string (required)
//   score: number
//   title: string — auto-generated from score
//   message: string — default "Check out what I just did"
//   sessionId: string
//   visual: string — default "auto"
//   metrics: object — arbitrary stats for share card
//   achievements: string[] — achievement IDs/names
//   template: string — default "progress"
//   imageUrl: string | null
//   shareUrl: string — default AppsFlyer OneLink (deep_link_value=community_game, af_dp=inzone://game?gameId={gameId})

const config = window.__INZONE_SOCIAL_LOOP_CONFIG__;
const res = await fetch(config.backendBaseUrl
  + '/api/game-sdk/progress/share', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    gameId: config.gameId,
    userId: config.userId,
    score: 14820,
    title: 'New high score — 14820!',
    metrics: { kills: 15, accuracy: 0.82 },
    achievements: ['sharpshooter'],
  }),
});
const data = await res.json();
// data.shareCard.shareCardId: string
// data.share.title: string
// data.share.url: string
// data.shareTargets: string[]`,
  },
  {
    method: 'POST',
    path: '/api/game-sdk/open-chat',
    title: 'Chat',
    desc: "Opens or joins the per-game group chat thread and sends a message. If no message is provided, one is built from context (score, wave, result). InZone renders the chat UI — your game just ensures the thread exists and the player is in it.",
    tags: ['groupchat', 'live', 'social'],
    accent: 'var(--blue-1)',
    auth: false,
    bridge: 'InZoneSDK.openChat(payload)',
    sample: `// Request fields:
//   gameId: string (required, unless threadId given)
//   threadId: string — reuse a specific thread
//   userId: string
//   sessionId: string
//   characters: string[] — AI character names
//   context: object — { score, result, wave, gameName }
//   message: string — auto-built from context if omitted

const data = await InZoneSDK.openChat({
  context: { score: 14820, result: 'win', wave: 5 },
  characters: ['nova', 'orin'],
});

// Response types:
//   data.conversation.conversationId: string
//   data.conversation.participants: string[]
//   data.conversation.characters: string[]
//   data.conversation.context: object`,
  },
  {
    method: 'GET',
    path: '/api/game-sdk/game-state',
    title: 'Game State',
    desc: "Account overview: coin balance, last 50 transactions and last 50 scores, newest first. Call on game load before offering purchases. Requires X-Game-Key header.",
    tags: ['wallet', 'history', 'protected'],
    accent: 'var(--warm)',
    auth: true,
    bridge: 'InZoneSDK.gameState(payload)',
    sample: `// Request fields (query params):
//   gameId: string (required)
//   userId: string (required)
// Header: X-Game-Key (required)

const data = await InZoneSDK.gameState({});

// Response types:
//   data.data.balance: number — coin count
//   data.data.currency: "Coin"
//   data.data.transactions: Array<{
//     transactionId: string, title: string,
//     coins: number, commissionCoins: number,
//     developerCoins: number, status: string,
//     createdAt: string }>
//   data.data.scores: Array<{
//     scoreId: string, score: number,
//     durationMs: number, displayName: string,
//     createdAt: string }>`,
  },
  {
    method: 'GET / POST',
    path: '/api/game-sdk/state',
    title: 'Save / Load',
    desc: 'Per-player save blob — progress, inventory, checkpoints. One slot per player per game; each POST overwrites it, max 256 KB, state must be a JSON object. version auto-increments; version 0 means a new player (never a 404). NOT for coin balances.',
    tags: ['save-slot', '256kb', 'versioned'],
    accent: 'var(--blue-3)',
    auth: false,
    bridge: null,
    sample: `// Load — GET query params:
//   gameId: string (required)
//   userId: string (required)
// Save — POST body:
//   gameId: string (required)
//   userId: string (required)
//   state: object (required) — max 256 KB
//   metadata: object — { saveLabel, platform, … }

const config = window.__INZONE_SOCIAL_LOOP_CONFIG__;
const base = config.backendBaseUrl + '/api/game-sdk';

// Load response types:
//   data.data.state: object
//   data.data.version: number — 0 = new player
//   data.data.metadata: object
//   data.data.updatedAt: string | null
const res = await fetch(base + '/state'
  + '?gameId=' + config.gameId
  + '&userId=' + config.userId);
const save = (await res.json()).data;

// Save response types:
//   data.data.version: number (auto-incremented)
//   data.data.bytes: number
//   data.data.savedAt: string
await fetch(base + '/state', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    gameId: config.gameId,
    userId: config.userId,
    state: { level: 12, inventory: ['shield'] },
    metadata: { saveLabel: 'Checkpoint Level 12' },
  }),
});`,
  },
  {
    method: 'GET',
    path: '/api/game-sdk/leaderboard',
    title: 'Leaderboard',
    desc: 'Full standings for a game, ordered by score descending. post-score already returns a top-10 snippet — use this for a standalone leaderboard screen or more entries. No bridge method — use direct fetch.',
    tags: ['global', 'ranked', 'read-only'],
    accent: 'var(--blue-2)',
    auth: false,
    bridge: null,
    sample: `// Request fields (query params):
//   gameId: string (required)
//   limit: number — default 50, max 200
//   scope: string — default "global"

const config = window.__INZONE_SOCIAL_LOOP_CONFIG__;
const res = await fetch(config.backendBaseUrl
  + '/api/game-sdk/leaderboard'
  + '?gameId=' + config.gameId + '&limit=20');
const data = await res.json();

// Response types:
//   data.totalEntries: number
//   data.scope: string
//   data.entries: Array<{
//     rank: number, entryId: string,
//     playerId: string, playerName: string,
//     score: number, metadata: object,
//     createdAt: string }>`,
  },
  {
    method: 'POST',
    path: '/api/game-sdk/coins/tier-{10,50,150,400}',
    title: 'Coins',
    desc: "Purchase at one of four fixed tiers, debited from the player's InZone balance. Purchases are atomic: on success the coins are already deducted; after a network failure, reconcile via game-state. Requires X-Game-Key header.",
    tags: ['microtx', '4-tier', '90% rev share', 'protected'],
    accent: 'var(--warm)',
    auth: true,
    bridge: 'InZoneSDK.purchaseCoinTier(coins, payload)',
    sample: `// Request fields:
//   userId: string (required)
//   gameId: string (required)
//   title: string (required) — shown in history
//   description: string — defaults to title
//   sessionId: string
// Header: X-Game-Key (required)

try {
  const data = await InZoneSDK.purchaseCoinTier(10, {
    title: 'Extra attempt',
    description: 'One more run',
  });

  // Response types:
  //   data.data.transactionId: string
  //   data.data.coins: number
  //   data.data.newBalance: number
  //   data.data.commissionCoins: number
  //   data.data.developerCoins: number
  //   data.data.commissionRate: number (0.1)
  //   data.tier.name: string
  updateCoinDisplay(data.data.newBalance);
  startNewRound();
} catch (err) {
  // INSUFFICIENT_BALANCE → err.details has
  //   currentBalance: number, required: number
  showMessage(err.message);
}`,
  },
];

const AUTH_SAMPLE = `// Pass the key as the header AND in the
// body / query string — the backend checks both.
await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Game-Key': config.gameKey,
  },
  body: JSON.stringify({
    gameKey: config.gameKey,
    ...payload,
  }),
});`;

const COIN_TIERS: Array<[string, string, string, string]> = [
  ['tier-10', 'Impulse', '10', 'retries, small boosts, one-session cosmetics'],
  ['tier-50', 'Investment', '50', 'power-ups, hard modes, leaderboard entry fees'],
  ['tier-150', 'Identity', '150', 'skins, permanent abilities, exclusive modes'],
  ['tier-400', 'Momentum', '400', 'season passes, full game unlocks, bundles'],
];

const ERROR_SAMPLE = `// Success responses always include
{ "success": true, … }

// Errors follow one shape:
{
  "success": false,
  "error": {
    "code": "MISSING_GAME_ID",
    "message": "gameId is required",
    "status": 400
  }
}

// INSUFFICIENT_BALANCE also carries
// error.details.currentBalance + .required`;

const ERROR_CODES: Array<[string, string]> = [
  ['MISSING_GAME_ID', 'gameId was not provided'],
  ['MISSING_USER_ID', 'userId (or playerId) was not provided'],
  ['MISSING_TITLE', 'title was not provided (coin purchases)'],
  ['MISSING_SENDER_ID', 'senderId was not provided (challenges)'],
  ['MISSING_GAME_OR_THREAD', 'neither gameId nor threadId (open-chat)'],
  ['MISSING_GAME_KEY', 'gameKey missing on a protected endpoint'],
  ['INVALID_GAME_KEY', 'gameKey does not match the registered key'],
  ['GAME_NOT_FOUND', 'no game exists with this gameId'],
  ['USER_NOT_FOUND', 'no user exists with this userId'],
  ['INSUFFICIENT_BALANCE', 'not enough coins — details has balance + required'],
  ['INVALID_COIN_TIER', 'coin amount is not 10 / 50 / 150 / 400'],
  ['INVALID_STATE', 'state is not a JSON object / not serializable'],
  ['STATE_TOO_LARGE', 'state blob exceeds 256 KB'],
  ['INVALID_REQUEST', 'catch-all for malformed requests'],
  ['INTERNAL_ERROR', 'server-side failure'],
];

const FLOW_SAMPLE = `Game loads
  └─ await config / InZoneSDK        (inzone:sdk-ready)
  └─ InZoneSDK.gameState({})         → coin balance
  └─ GET /state                      → restore progress

Gameplay
  └─ POST /state                     → save at checkpoints

Round ends
  └─ InZoneSDK.postScore({ score })  → score + leaderboard

Game-over screen (tie each to a button)
  └─ InZoneSDK.purchaseCoinTier(10, { title })  → retry
  └─ InZoneSDK.sendChallenge({ score })         → duel a friend
  └─ POST /progress/share                       → share progress
  └─ InZoneSDK.openChat({ context })            → group chat

Leaderboard screen
  └─ GET /leaderboard                → full standings

No required sequence — call anything once the config exists.`;

const TROUBLESHOOTING: Array<[string, string]> = [
  [
    'Endpoints "work" but no data reaches the backend',
    'Your game is running on fallback/mock values. The config is injected after all resources load, so a setTimeout wait can expire first. Never wait with a timeout — use the inzone:sdk-ready event or InZoneSDK.getConfig().',
  ],
  [
    'Balance never loads, start button never appears',
    'gameState requires userId and gameKey. If either is missing from window.__INZONE_SOCIAL_LOOP_CONFIG__, the call fails. Log the config object on page load to verify every field is populated.',
  ],
  [
    'window.InZoneSDK is undefined',
    'Your code ran before InZone finished injecting the SDK. Wrap startup in a check for window.InZoneSDK and otherwise wait for the inzone:sdk-ready event.',
  ],
  [
    'Works locally, fails in production',
    'A hardcoded localhost or test URL is hiding somewhere. Search your code for hardcoded backend URLs and replace them with config.backendBaseUrl.',
  ],
  [
    'Nothing works outside the InZone app',
    'Expected — the config and SDK come from the InZone WebView. In a plain browser there is no injection and no event. To test locally, mock window.__INZONE_SOCIAL_LOOP_CONFIG__ with test values before your game code runs.',
  ],
];

const epStyles: Record<string, CSSProperties> = {
  hero: { paddingTop: 8, paddingBottom: 18 },
  crumb: { fontFamily: "'Geist Mono', monospace", fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 10 },
  h1: { margin: 0, fontSize: 36, fontWeight: 500, letterSpacing: '-0.028em', lineHeight: 1.05, maxWidth: '24ch' },
  lede: { marginTop: 14, color: 'var(--ink-2)', fontSize: 15, lineHeight: 1.55, maxWidth: '64ch' },
  list: { display: 'grid', gap: 14 },
  row: { display: 'grid', gridTemplateColumns: '1fr 1.05fr', gap: 22, alignItems: 'stretch' },
  meta: { display: 'flex', flexDirection: 'column', gap: 10 },
  pathLine: { display: 'flex', alignItems: 'baseline', gap: 10, fontFamily: "'Geist Mono', monospace", fontSize: 13.5, letterSpacing: '0.01em', flexWrap: 'wrap' },
  methodPill: { display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 6, background: 'oklch(0.78 0.14 155 / 0.15)', border: '1px solid oklch(0.78 0.14 155 / 0.3)', color: 'var(--pos)', fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: '0.08em', fontWeight: 500 },
  authPill: { display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 6, background: 'oklch(0.78 0.14 75 / 0.12)', border: '1px solid oklch(0.78 0.14 75 / 0.3)', color: 'var(--warm)', fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: '0.08em', fontWeight: 500 },
  title: { fontSize: 22, fontWeight: 500, letterSpacing: '-0.018em', margin: 0 },
  desc: { color: 'var(--ink-3)', fontSize: 13.5, lineHeight: 1.55, margin: 0, maxWidth: '44ch' },
  tagRow: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 },
  tag: { padding: '3px 8px', borderRadius: 999, background: 'oklch(0.20 0.02 245 / 0.5)', border: '1px solid var(--line-soft)', fontFamily: "'Geist Mono', monospace", fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.04em' },
  bridgeLine: { fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: '0.05em' },
  status: { marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase' },
  statusDot: { width: 7, height: 7, borderRadius: '50%', boxShadow: '0 0 6px currentColor' },
  codeFrame: { background: 'oklch(0.085 0.015 245 / 0.85)', border: '1px solid var(--line)', borderRadius: 12, padding: 14, overflow: 'auto', position: 'relative' },
  codeChrome: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 },
  chromeDot: { width: 8, height: 8, borderRadius: '50%', background: 'oklch(0.32 0.02 245)' },
  filename: { fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: '0.06em', marginLeft: 8 },
  code: { margin: 0, fontFamily: "'Geist Mono', monospace", fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  kvGrid: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '7px 16px', alignItems: 'baseline' },
  kvKey: { fontFamily: "'Geist Mono', monospace", fontSize: 11.5, color: 'var(--blue-1)', letterSpacing: '0.02em', whiteSpace: 'nowrap' },
  kvVal: { fontFamily: "'Geist Mono', monospace", fontSize: 11, color: 'var(--ink-3)', letterSpacing: '0.02em', lineHeight: 1.5 },
  divider: { borderTop: '1px solid var(--line-soft)', margin: '18px 0 14px' },
  sectionLabel: { fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 12 },
  tierRow: { display: 'grid', gridTemplateColumns: 'auto auto 1fr', gap: '8px 14px', alignItems: 'baseline' },
  intGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 },
  intCard: { padding: 18 },
};

function CodeBlock({ children, file }: { children: React.ReactNode; file: string }) {
  return (
    <div style={epStyles.codeFrame}>
      <div style={epStyles.codeChrome}>
        <span style={epStyles.chromeDot} />
        <span style={epStyles.chromeDot} />
        <span style={epStyles.chromeDot} />
        <span style={epStyles.filename}>{file}</span>
      </div>
      <pre style={epStyles.code}>{children}</pre>
    </div>
  );
}

export default function EndpointsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [games, setGames] = useState<DeveloperGame[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string>('');

  const [health, setHealth] = useState<IntegrationHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // Anonymous → /login.
  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  const loadGames = useCallback(async () => {
    if (!user?.uid) return;
    setGamesLoading(true);
    setError(null);
    try {
      const list = await fetchDeveloperGames(user.uid);
      setGames(list);
      setCurrentId((prev) => (prev && list.some((g) => g.id === prev) ? prev : list[0]?.id ?? ''));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load your games.');
    } finally {
      setGamesLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => { void loadGames(); }, [loadGames]);

  // Live integration health for the selected game, refreshed every 60s.
  useEffect(() => {
    if (!SHOW_INTEGRATION_HEALTH || !currentId) { setHealth(null); return; }
    let cancelled = false;
    setHealthLoading(true);
    const run = async () => {
      const data = await fetchIntegrationHealth(currentId);
      if (!cancelled) { setHealth(data); setHealthLoading(false); }
    };
    void run();
    const interval = setInterval(() => { void run(); }, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [currentId]);

  const currentGame = games.find((g) => g.id === currentId) ?? null;
  const hasData = !!health && health.totalRequests > 0;

  const statCards = hasData
    ? [
        {
          k: 'Requests',
          v: health!.requestsFormatted,
          meta: health!.totalRequests >= 1000 ? `${health!.totalRequests.toLocaleString()} total` : 'last 24h',
          color: 'var(--ink)',
        },
        {
          k: 'Error rate',
          v: health!.errorRateFormatted,
          meta: health!.totalErrors === 0 ? 'within SLO' : `${health!.totalErrors} error${health!.totalErrors !== 1 ? 's' : ''}`,
          color: health!.errorRate < 1 ? 'var(--pos)' : health!.errorRate < 5 ? 'var(--warm)' : 'var(--neg)',
        },
        {
          k: 'p95 latency',
          v: health!.p95LatencyFormatted || '—',
          meta: health!.p95LatencyMs > 0 ? `${health!.p95LatencyMs}ms` : 'no samples',
          color: health!.p95LatencyMs < 200 ? 'var(--blue-1)' : health!.p95LatencyMs < 500 ? 'var(--warm)' : 'var(--neg)',
        },
      ]
    : [
        { k: 'Requests', v: '—', meta: 'awaiting traffic', color: 'var(--ink-3)' },
        { k: 'Error rate', v: '—', meta: 'no errors yet', color: 'var(--ink-3)' },
        { k: 'p95 latency', v: '—', meta: 'awaiting data', color: 'var(--ink-3)' },
      ];

  return (
    <Shell>
      <main className="stage">
        <header style={epStyles.hero}>
          <div style={{ ...epStyles.crumb, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ color: 'var(--blue-1)' }}>02 — Integrate</span>
            {currentGame && <span style={{ color: 'var(--ink-4)' }}>· {currentGame.name}</span>}
            {!gamesLoading && games.length > 1 && (
              <select
                className="select"
                value={currentId}
                onChange={(e) => setCurrentId(e.target.value)}
                style={{ width: 'auto', maxWidth: 240, marginLeft: 'auto', height: 34 }}
                aria-label="Select game"
              >
                {games.map((g) => (
                  <option key={g.id} value={g.id}>{g.name || g.id}</option>
                ))}
              </select>
            )}
          </div>
          <h1 style={epStyles.h1}>Eight endpoints. <span style={{ color: 'var(--ink-3)' }}>Under thirty minutes.</span></h1>
          <p style={epStyles.lede}>
            Score, leaderboard, challenge, progress, chat, save state and coins — each line of code lights a
            feature in the live game. The reference key for <b style={{ color: 'var(--ink)' }}>{currentGame?.name || 'your game'}</b> is
            on the Upload screen. Everything on this page is also in the downloadable guide.
          </p>
          <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <a
              href={GUIDE_PATH}
              download="inzone-game-sdk-guide.md"
              className="btn-ghost"
              style={{ height: 38, fontSize: 13, padding: '0 16px' }}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12" /><path d="m7 11 5 5 5-5" /><path d="M5 20h14" />
              </svg>
              Download the full guide (.md)
            </a>
            <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: '0.06em' }}>
              same content, one offline file for your team
            </span>
          </div>
          <p style={{ ...epStyles.lede, marginTop: 16 }}>
            An isolated iframe SDK preview is available for explicitly opted-in
            games and the{' '}
            <Link href="/sdk-example">runnable example</Link>
            {' · '}
            <a href="/docs/inzone-web-sdk.md">web host instructions</a>
            . Existing hub games keep the current same-origin player frame.
            Privileged checkout uses host confirmation and Firebase auth; tokens are not injected into games.
            The cards below remain the Flutter/social-loop reference and are not proof that every method is live in the web host.
          </p>
        </header>

        {error && (
          <div className="empty" style={{ padding: '24px' }}>
            <p>{error}</p>
            <button onClick={loadGames} className="btn-primary">Retry</button>
          </div>
        )}

        {!error && !gamesLoading && games.length === 0 && (
          <div className="empty">
            <div style={{ fontSize: 36, marginBottom: 8 }}>🔌</div>
            <h2>No games to integrate yet</h2>
            <p>Upload a game first — then wire these endpoints into it.</p>
            <Link href="/upload" className="btn-primary">Upload a game</Link>
          </div>
        )}

        {/* ── How your game connects ─────────────────────────────── */}
        <section className="card tall" style={{ padding: '22px 26px' }}>
          <div style={epStyles.row}>
            <div style={epStyles.meta}>
              <div style={epStyles.pathLine}>
                <span style={epStyles.methodPill}>RUNTIME</span>
                <span style={{ color: 'var(--blue-1)' }}>window.__INZONE_SOCIAL_LOOP_CONFIG__</span>
              </div>
              <h2 style={{ ...epStyles.title, color: 'var(--blue-1)' }}>How your game connects</h2>
              <p style={epStyles.desc}>
                Your HTML game loads inside the InZone app in a WebView. InZone injects two things into your
                JavaScript environment: a config object with the player&apos;s identity, your API key and the backend
                URL — and <b style={{ color: 'var(--ink-2)' }}>window.InZoneSDK</b>, a bridge whose methods call the
                backend for you, so your game never constructs URLs or sets auth headers.
              </p>
              <p style={epStyles.desc}>
                Both arrive <b style={{ color: 'var(--ink-2)' }}>after</b> your page finishes loading, via the{' '}
                <b style={{ color: 'var(--ink-2)' }}>inzone:sdk-ready</b> event. Never wait with a timeout, and never
                fall back to default values — if the config never arrives, your game is not running inside InZone.
              </p>
              <div style={epStyles.kvGrid}>
                {CONFIG_FIELDS.map(([k, v]) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <span style={epStyles.kvKey}>{k}</span>
                    <span style={epStyles.kvVal}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <CodeBlock file="game-sdk/connect.js">{CONNECT_SAMPLE}</CodeBlock>
          </div>
          <div style={epStyles.divider} />
          <div style={epStyles.sectionLabel}>InZoneSDK bridge methods — every call returns a Promise with the endpoint&apos;s JSON</div>
          <div style={{ ...epStyles.kvGrid, gridTemplateColumns: 'auto 1fr auto 1fr', columnGap: 18 }}>
            {BRIDGE_METHODS.map(([m, ep]) => (
              <div key={m} style={{ display: 'contents' }}>
                <span style={epStyles.kvKey}>{m}</span>
                <span style={epStyles.kvVal}>{ep}</span>
              </div>
            ))}
          </div>
          <p style={{ ...epStyles.desc, maxWidth: 'none', marginTop: 14 }}>
            Endpoints without a bridge method yet — <b style={{ color: 'var(--ink-2)' }}>GET/POST /state</b>,{' '}
            <b style={{ color: 'var(--ink-2)' }}>POST /progress/share</b> and{' '}
            <b style={{ color: 'var(--ink-2)' }}>GET /leaderboard</b> — use direct fetch calls with{' '}
            <b style={{ color: 'var(--ink-2)' }}>config.backendBaseUrl</b>, as shown on their cards below.
          </p>
        </section>

        {/* ── Endpoint reference cards ───────────────────────────── */}
        <section style={epStyles.list}>
          {ENDPOINTS.map((ep) => (
            <article key={ep.path} className="card tall" style={{ padding: '22px 26px' }}>
              <div style={epStyles.row}>
                <div style={epStyles.meta}>
                  <div style={epStyles.pathLine}>
                    <span style={epStyles.methodPill}>{ep.method}</span>
                    <span style={{ color: 'var(--blue-1)' }}>{ep.path}</span>
                    {ep.auth && <span style={epStyles.authPill}>X-GAME-KEY</span>}
                  </div>
                  <h2 style={{ ...epStyles.title, color: ep.accent }}>{ep.title}</h2>
                  <p style={epStyles.desc}>{ep.desc}</p>
                  <div style={epStyles.tagRow}>
                    {ep.tags.map((t) => <span key={t} style={epStyles.tag}>{t}</span>)}
                  </div>
                  <div style={epStyles.bridgeLine}>
                    {ep.bridge
                      ? <>SDK bridge · <span style={{ color: 'var(--blue-1)' }}>{ep.bridge}</span></>
                      : 'direct fetch · no bridge method yet'}
                  </div>
                  <div style={epStyles.status}>
                    <span style={{ ...epStyles.statusDot, background: 'var(--pos)', color: 'var(--pos)' }} />
                    Live · responding 200 OK
                  </div>
                </div>
                <CodeBlock file={`game-sdk/${ep.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.js`}>{ep.sample}</CodeBlock>
              </div>
            </article>
          ))}
        </section>

        {/* ── Authentication + coin tiers ────────────────────────── */}
        <div className="grid-2">
          <section className="card tall">
            <div className="card-head">
              <span className="card-label">Authentication</span>
              <span className="card-meta">X-Game-Key</span>
            </div>
            <p style={{ ...epStyles.desc, maxWidth: 'none', marginBottom: 12 }}>
              Protected endpoints — <b style={{ color: 'var(--ink-2)' }}>GET /game-state</b> and all{' '}
              <b style={{ color: 'var(--ink-2)' }}>POST /coins/*</b> tiers — require your game key. Find it on the{' '}
              <Link href="/settings" style={{ color: 'var(--blue-1)', textDecoration: 'underline' }}>Settings page</Link> under{' '}
              <b style={{ color: 'var(--ink-2)' }}>Server key · Social Loops</b>; it also arrives in{' '}
              <b style={{ color: 'var(--ink-2)' }}>config.gameKey</b> at runtime. If your game doesn&apos;t have a key yet,
              one is generated automatically the first time you open Settings or the first time the game loads inside InZone. The SDK
              bridge attaches it automatically. Everything else — post-score, send-challenge, progress/share,
              open-chat, state, leaderboard — needs no key.
            </p>
            <CodeBlock file="game-sdk/auth.js">{AUTH_SAMPLE}</CodeBlock>
          </section>

          <section className="card tall">
            <div className="card-head">
              <span className="card-label">Coin tiers</span>
              <span className="card-meta">90% to you · 10% commission</span>
            </div>
            <div style={epStyles.tierRow}>
              {COIN_TIERS.map(([tier, name, coins, use]) => (
                <div key={tier} style={{ display: 'contents' }}>
                  <span style={epStyles.kvKey}>{tier}</span>
                  <span style={{ ...epStyles.kvVal, color: 'var(--warm)' }}>{name} · {coins} coins</span>
                  <span style={epStyles.kvVal}>{use}</span>
                </div>
              ))}
            </div>
            <p style={{ ...epStyles.desc, maxWidth: 'none', marginTop: 14 }}>
              Players earn coins in the InZone app — your game spends them. Purchases are atomic: if the response
              says <b style={{ color: 'var(--ink-2)' }}>success: true</b>, the coins are already deducted, and{' '}
              <b style={{ color: 'var(--ink-2)' }}>data.newBalance</b> is the number to put on screen. If the network
              drops before the response arrives, reconcile with game-state.
            </p>
          </section>
        </div>

        {/* ── Response format + error codes ──────────────────────── */}
        <section className="card tall">
          <div className="card-head">
            <span className="card-label">Response format · error codes</span>
            <span className="card-meta">every response is JSON</span>
          </div>
          <div style={epStyles.row}>
            <CodeBlock file="game-sdk/error-shape.json">{ERROR_SAMPLE}</CodeBlock>
            <div style={{ ...epStyles.kvGrid, alignContent: 'start' }}>
              {ERROR_CODES.map(([code, meaning]) => (
                <div key={code} style={{ display: 'contents' }}>
                  <span style={{ ...epStyles.kvKey, color: 'var(--warm)' }}>{code}</span>
                  <span style={epStyles.kvVal}>{meaning}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Integration flow + troubleshooting ─────────────────── */}
        <div className="grid-2">
          <section className="card tall">
            <div className="card-head">
              <span className="card-label">Typical integration flow</span>
              <span className="card-meta">no required sequence</span>
            </div>
            <CodeBlock file="game-sdk/flow.txt">{FLOW_SAMPLE}</CodeBlock>
          </section>

          <section className="card tall">
            <div className="card-head">
              <span className="card-label">Troubleshooting</span>
              <span className="card-meta">most-seen issues</span>
            </div>
            <div style={{ display: 'grid', gap: 14 }}>
              {TROUBLESHOOTING.map(([symptom, fix]) => (
                <div key={symptom}>
                  <div style={{ fontSize: 13.5, color: 'var(--ink)', fontWeight: 500, marginBottom: 3 }}>{symptom}</div>
                  <div style={{ ...epStyles.desc, maxWidth: 'none', fontSize: 12.5 }}>{fix}</div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="api-note">
          <b>Field names:</b> all endpoints accept camelCase and PascalCase; <code>playerId</code> is an alias
          for <code>userId</code>. Responses always use camelCase. Base URL:{' '}
          <code>https://inzoneapi-912424781531.us-central1.run.app/api/game-sdk/*</code> — always read it
          from <code>config.backendBaseUrl</code>, never hardcode it.
          <span className="src backend">backend</span>
        </div>

        {/* ── Integration health (hidden until re-activated) ──────── */}
        {SHOW_INTEGRATION_HEALTH && (
        <section className="card tall" style={{ marginTop: 6 }}>
          <div className="card-head">
            <span className="card-label">Integration health</span>
            <span className="card-meta">{healthLoading ? 'loading…' : hasData ? 'live · last 24h' : 'last 24h'}</span>
          </div>
          <div style={epStyles.intGrid}>
            {statCards.map((s) => (
              <div key={s.k} style={epStyles.intCard}>
                <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--ink-3)', textTransform: 'uppercase' }}>{s.k}</div>
                <div style={{ marginTop: 8, fontSize: 28, fontWeight: 500, letterSpacing: '-0.022em', color: s.color, fontFeatureSettings: "'tnum'" }}>{s.v}</div>
                <div style={{ marginTop: 6, fontFamily: "'Geist Mono', monospace", fontSize: 11, color: 'var(--ink-3)' }}>{s.meta}</div>
              </div>
            ))}
          </div>
          {hasData && health!.hourly.length > 1 && (
            <div style={{ marginTop: 14, padding: '0 18px 14px' }}>
              <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10, letterSpacing: '0.1em', color: 'var(--ink-4)', textTransform: 'uppercase', marginBottom: 8 }}>
                Hourly requests (24h)
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 40 }}>
                {(() => {
                  const maxReqs = Math.max(...health!.hourly.map((h) => h.requests), 1);
                  return health!.hourly.map((h) => (
                    <div
                      key={h.hour}
                      title={`${h.hour}: ${h.requests} req${h.errors > 0 ? `, ${h.errors} err` : ''}`}
                      style={{ flex: 1, minWidth: 3, height: `${Math.max(2, (h.requests / maxReqs) * 100)}%`, background: h.errors > 0 ? 'var(--warm)' : 'var(--blue-1)', borderRadius: 2, opacity: 0.7 }}
                    />
                  ));
                })()}
              </div>
            </div>
          )}
        </section>
        )}
      </main>
    </Shell>
  );
}
