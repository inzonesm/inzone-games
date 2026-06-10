# InZone Game SDK — Integration Guide

This guide is for game developers integrating InZone's social loop into HTML or Unity games.

**Backend URL:** `https://inzoneapi-912424781531.us-central1.run.app`

All endpoints live under `/api/game-sdk` on that URL.

---

## How Your Game Connects to InZone

Your HTML game is loaded inside the InZone app in a WebView. You write a normal HTML/JS game. InZone handles everything else: it knows who the player is, what game this is, and where the backend lives.

When InZone loads your page, it adds two things to your JavaScript environment:

1. **`window.__INZONE_SOCIAL_LOOP_CONFIG__`** — a config object with the player's identity, your game's API key, and the backend URL.
2. **`window.InZoneSDK`** — an object with methods that call the backend for you. When you call something like `InZoneSDK.postScore({ score: 100 })`, InZone takes that call, adds the player's ID, your game key, and the backend URL, makes the HTTP request to the backend, and returns the response to your game. Your game never needs to construct URLs or set auth headers.

Here is what the config object looks like:

```javascript
window.__INZONE_SOCIAL_LOOP_CONFIG__ = {
  gameId: "your-game-id",
  gameName: "Your Game Name",
  gameKey: "your-game-key",
  sessionId: "sess_123",
  userId: "firebase-uid",
  backendBaseUrl: "https://inzoneapi-912424781531.us-central1.run.app",
  fixtureMode: false
};
```

| Field | What it is |
|-|-|
| `gameId` | Your registered game identifier |
| `gameName` | Human-readable game name |
| `gameKey` | API key for protected endpoints (coin purchases, game-state) |
| `sessionId` | Current play session ID |
| `userId` | The logged-in player's InZone user ID (Firebase UID) |
| `backendBaseUrl` | The backend URL. Always use this — never hardcode a URL |
| `fixtureMode` | `true` when running locally without a real backend |

**Important: The config and SDK are injected AFTER your page finishes loading** (after all resources — scripts, fonts, images — are fully loaded). Your inline JavaScript will run before the config exists. **Do not** use a short timeout to wait for it. Instead, listen for the `inzone:sdk-ready` event, which InZone dispatches once the config and bridge are ready:

```javascript
function waitForConfig() {
  return new Promise((resolve) => {
    // Already available (e.g. page was slow, injection already happened)
    if (window.__INZONE_SOCIAL_LOOP_CONFIG__) {
      return resolve(window.__INZONE_SOCIAL_LOOP_CONFIG__);
    }
    // Not yet — wait for InZone to inject it
    window.addEventListener('inzone:sdk-ready', (event) => {
      resolve(event.detail);
    }, { once: true });
  });
}

const config = await waitForConfig();
// Now safe to read config.userId, config.backendBaseUrl, etc.
```

Do **not** add a timeout fallback that resolves with empty/default values. If the config never arrives, your game is not running inside InZone and the endpoints will not work. If you load external resources (web fonts, third-party scripts), those delay the injection further — the event will still fire, but a hardcoded timeout may expire before it does.

Or call `await window.InZoneSDK.getConfig()` which waits for the config to be ready.

---

## Calling Endpoints

You have two choices. Both work. Use whichever fits your game.

### Choice 1: InZoneSDK bridge methods (simpler)

Call a method on `window.InZoneSDK`. InZone fills in `gameId`, `userId`, `gameKey`, `sessionId`, and the backend URL for you. You only pass the fields specific to that action. Every method returns a Promise that resolves to the endpoint's JSON response.

```javascript
// Post a score — you pass the score, InZone handles everything else
const response = await window.InZoneSDK.postScore({ score: 4820 });

// Buy a retry — first argument is the coin tier (10, 50, 150, or 400)
const response = await window.InZoneSDK.purchaseCoinTier(10, {
  title: 'Extra attempt'
});

// Send a challenge
const response = await window.InZoneSDK.sendChallenge({
  recipientId: 'friend_99',
  score: 4820,
  message: 'Beat this'
});
```

Available methods:

| Method | Endpoint it calls |
|-|-|
| `InZoneSDK.getConfig()` | Returns the config object |
| `InZoneSDK.postScore(payload)` | `POST /post-score` |
| `InZoneSDK.sendChallenge(payload)` | `POST /send-challenge` — also opens the native share sheet |
| `InZoneSDK.openChat(payload)` | `POST /open-chat` |
| `InZoneSDK.gameState(payload)` | `GET /game-state` |
| `InZoneSDK.purchaseCoinTier(coins, payload)` | `POST /coins/tier-{coins}` |
| `InZoneSDK.close()` | Exits the game, returns to the InZone app |

Not every endpoint has a bridge method yet. For `GET /state`, `POST /state`, `POST /progress/share`, and `GET /leaderboard`, use direct HTTP calls (Choice 2).

### Choice 2: Direct HTTP calls

Read the config from `window.__INZONE_SOCIAL_LOOP_CONFIG__`, then make `fetch` calls yourself. You are responsible for building URLs, setting the `X-Game-Key` header, and passing `gameId`/`userId` in every request.

```javascript
const config = window.__INZONE_SOCIAL_LOOP_CONFIG__;

const response = await fetch(
  `${config.backendBaseUrl}/api/game-sdk/post-score`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Game-Key': config.gameKey
    },
    body: JSON.stringify({
      gameId: config.gameId,
      playerId: config.userId,
      score: 4820,
      sessionId: config.sessionId
    })
  }
);
const data = await response.json();
```

Use this approach for any endpoint. The URL pattern is always:

```
https://inzoneapi-912424781531.us-central1.run.app/api/game-sdk/{endpoint}
```

**Where do `userId`, `gameId`, `gameKey`, etc. come from?** You do not generate these yourself. Every value you need is in `window.__INZONE_SOCIAL_LOOP_CONFIG__`, placed there by the InZone app when it loads your game. In Choice 1, these are added to every request automatically. In Choice 2, you read them from `config.userId`, `config.gameId`, `config.gameKey`, etc. and pass them in your request body or query string.

Throughout this document, when a field like `userId` or `gameId` is marked "required," it means the backend requires it — not that you need to invent it. The value always comes from the config.

---

## Authentication

Some endpoints require a `gameKey`. You receive this when you register your game.

Pass it as the `X-Game-Key` header **and** as `gameKey` in the JSON body or query string. The backend checks both.

```
X-Game-Key: your-game-key-here
```

**Which endpoints require it:**

| Requires `gameKey` | Does not require `gameKey` |
|-|-|
| `GET /game-state` | `POST /post-score` |
| `POST /coins/*` (all tiers) | `POST /send-challenge` |
| | `POST /progress/share` |
| | `POST /open-chat` |
| | `GET,POST /state` |
| | `GET /leaderboard` |

---

## Response Format

Every response is JSON. Success responses always include `"success": true`. Error responses follow this shape:

```json
{
  "success": false,
  "error": {
    "code": "MISSING_GAME_ID",
    "message": "gameId is required",
    "status": 400
  }
}
```

---

## Error Codes

| Code | Meaning |
|-|-|
| `MISSING_GAME_ID` | `gameId` was not provided |
| `MISSING_USER_ID` | `userId` (or `playerId`) was not provided |
| `MISSING_TITLE` | `title` was not provided (coin purchases) |
| `MISSING_SENDER_ID` | `senderId` was not provided (challenges) |
| `MISSING_GAME_OR_THREAD` | Neither `gameId` nor `threadId` was provided (open-chat) |
| `MISSING_GAME_KEY` | `gameKey` was not provided on a protected endpoint |
| `INVALID_GAME_KEY` | The `gameKey` does not match the registered key |
| `GAME_NOT_FOUND` | No game exists with this `gameId` |
| `USER_NOT_FOUND` | No user exists with this `userId` |
| `INSUFFICIENT_BALANCE` | User does not have enough coins. Response includes `currentBalance` and `required` in `error.details` |
| `INVALID_COIN_TIER` | The coin amount does not match a valid tier (10, 50, 150, 400) |
| `INVALID_STATE` | The `state` field is not a JSON object or is not serializable |
| `STATE_TOO_LARGE` | The `state` blob exceeds 256 KB |
| `INVALID_REQUEST` | Catch-all for malformed requests |
| `INTERNAL_ERROR` | Server-side failure |

---

## Endpoints

### 1. Post Score

`POST /api/game-sdk/post-score`

Call this when a game round ends. It records the score, writes a leaderboard entry, and returns leaderboard context + share data you can use immediately.

**When to call:** On game-over, round-end, level-complete — any moment where the player has a final score.

#### Request

```json
{
  "gameId": "nova-arena",
  "gameName": "Nova Arena",
  "playerId": "user_42",
  "score": 4820,
  "durationMs": 92447,
  "sessionId": "sess_123",
  "platform": "flutter-webview",
  "playerName": "SpaceCadet",
  "metadata": { "level": 12, "difficulty": "hard" }
}
```

| Field | Type | Required | Notes |
|-|-|-|-|
| `gameId` | string | yes | Your registered game identifier |
| `score` | number | yes | The player's score for this round |
| `playerId` | string | no | The player's InZone user ID. If omitted, score is recorded anonymously |
| `gameName` | string | no | Human-readable game name. Falls back to `gameId` formatted as title case |
| `durationMs` | number | no | Round duration in milliseconds |
| `sessionId` | string | no | Current play session ID |
| `platform` | string | no | e.g. `"flutter-webview"`, `"unity"` |
| `playerName` | string | no | Display name for leaderboard. Falls back to `"Player"` |
| `metadata` | object | no | Arbitrary key-value pairs stored with the leaderboard entry |

#### Response

```json
{
  "success": true,
  "game": { "id": "nova-arena", "name": "Nova Arena" },
  "player": { "id": "user_42", "displayName": "SpaceCadet", "rank": 3 },
  "score": { "value": 4820, "best": 4820 },
  "leaderboard": {
    "scope": "global",
    "entries": [
      { "rank": 1, "playerId": "user_7", "displayName": "Ace", "score": 9100 },
      { "rank": 2, "playerId": "user_15", "displayName": "Nova", "score": 6200 },
      { "rank": 3, "playerId": "user_42", "displayName": "SpaceCadet", "score": 4820 }
    ]
  },
  "share": {
    "title": "I scored 4820 in Nova Arena!",
    "message": "Can you beat me?",
    "url": "https://inzone.app/game/nova-arena",
    "inviteCode": "ss_123"
  },
  "economy": [ ... ],
  "endpoint": "post-score"
}
```

**Integration example:**

```javascript
async function onGameOver(finalScore) {
  const data = await window.InZoneSDK.postScore({
    score: finalScore,
    durationMs: roundDurationMs,
    platform: 'flutter-webview'
  });
  // data.leaderboard.entries → render leaderboard UI
  // data.share → use for share modal
}
```

---

### 2. Send Challenge

`POST /api/game-sdk/send-challenge`

Creates a 24-hour duel challenge and generates a share card in one call. The response includes everything needed to open a native share sheet or display a share modal.

**When to call:** When the player taps "Challenge a Friend" after a round.

#### Request

```json
{
  "gameId": "nova-arena",
  "senderId": "user_42",
  "recipientId": "friend_99",
  "score": 4820,
  "message": "Beat this if you can",
  "sessionId": "sess_123",
  "challengeType": "duel",
  "expiresHours": 24,
  "title": "I just scored 4820 — beat me!",
  "template": "default",
  "shareUrl": "https://inzone.app/game/nova-arena",
  "imageUrl": null
}
```

| Field | Type | Required | Notes |
|-|-|-|-|
| `gameId` | string | yes | |
| `senderId` | string | yes | The challenging player's user ID |
| `recipientId` | string | no | Target player's ID. Can be omitted for open challenges |
| `score` | number | no | The score being challenged |
| `message` | string | no | Defaults to `"Can you beat this score?"` |
| `sessionId` | string | no | |
| `challengeType` | string | no | Defaults to `"duel"` |
| `expiresHours` | number | no | Defaults to `24` |
| `title` | string | no | Share card headline. Auto-generated from score if omitted |
| `template` | string | no | Share card template. Defaults to `"default"` |
| `shareUrl` | string | no | Defaults to `https://inzone.app/game/{gameId}` |
| `imageUrl` | string | no | Optional image for the share card |

#### Response

```json
{
  "success": true,
  "endpoint": "send-challenge",
  "challenge": {
    "challengeId": "a1b2c3d4",
    "gameId": "nova-arena",
    "senderId": "user_42",
    "recipientId": "friend_99",
    "type": "duel",
    "score": 4820,
    "message": "Beat this if you can",
    "expiresAt": "2026-06-09T12:00:00Z",
    "status": "pending"
  },
  "shareCard": {
    "shareCardId": "e5f6g7h8",
    "title": "I just scored 4820 — beat me!",
    "message": "Beat this if you can",
    "url": "https://inzone.app/game/nova-arena",
    "template": "default",
    "imageUrl": null
  },
  "share": {
    "title": "I just scored 4820 — beat me!",
    "message": "Beat this if you can",
    "url": "https://inzone.app/game/nova-arena",
    "text": "I just scored 4820 — beat me!\nBeat this if you can\nhttps://inzone.app/game/nova-arena",
    "subject": "I just scored 4820 — beat me!"
  },
  "shareTargets": ["iMessage", "WhatsApp", "Discord", "TikTok", "Instagram", "X"],
  "economy": [ ... ]
}
```

**Integration example:**

```javascript
document.getElementById('challengeBtn').addEventListener('click', async () => {
  const data = await window.InZoneSDK.sendChallenge({
    senderId: config.userId,          // from window.__INZONE_SOCIAL_LOOP_CONFIG__
    recipientId: friendIdInput.value,
    score: lastScore,
    message: messageInput.value
  });
  // The host app automatically opens the native share sheet after sendChallenge.
  // If you need a fallback (e.g. copy-to-clipboard), use data.share:
  //   data.share.title, data.share.text, data.share.url
});
```

> **Note:** The old standalone `share-card` endpoint no longer exists as a separate route. Share card generation is now built into `send-challenge`. For sharing progress without a challenge, use `progress/share` below.

---

### 3. Share Progress

`POST /api/game-sdk/progress/share`

Generates a shareable snapshot of an achievement, high score, or milestone — without creating a challenge. Use this for "Share Progress" or "Brag" buttons.

**When to call:** When the player wants to share an achievement or milestone that is not a head-to-head challenge.

#### Request

```json
{
  "gameId": "nova-arena",
  "userId": "user_42",
  "score": 4820,
  "title": "New high score — 4820!",
  "message": "Check out what I just did",
  "sessionId": "sess_123",
  "visual": "auto",
  "metrics": { "kills": 15, "accuracy": 0.82 },
  "achievements": ["first-blood", "sharpshooter"],
  "template": "progress",
  "imageUrl": null,
  "shareUrl": "https://inzone.app/game/nova-arena"
}
```

| Field | Type | Required | Notes |
|-|-|-|-|
| `gameId` | string | yes | |
| `userId` | string | yes | |
| `score` | number | no | |
| `title` | string | no | Auto-generated from score if omitted |
| `message` | string | no | Defaults to `"Check out what I just did"` |
| `sessionId` | string | no | |
| `visual` | string | no | Defaults to `"auto"` |
| `metrics` | object | no | Arbitrary stats to display on the share card |
| `achievements` | array | no | List of achievement IDs or names |
| `template` | string | no | Defaults to `"progress"` |
| `imageUrl` | string | no | |
| `shareUrl` | string | no | Defaults to `https://inzone.app/game/{gameId}` |

#### Response

```json
{
  "success": true,
  "endpoint": "progress/share",
  "shareCard": {
    "shareCardId": "abc123",
    "gameId": "nova-arena",
    "userId": "user_42",
    "score": 4820,
    "title": "New high score — 4820!",
    "message": "Check out what I just did",
    "url": "https://inzone.app/game/nova-arena",
    "visual": "auto",
    "metrics": { "kills": 15, "accuracy": 0.82 },
    "achievements": ["first-blood", "sharpshooter"],
    "template": "progress",
    "imageUrl": null
  },
  "share": {
    "title": "New high score — 4820!",
    "message": "Check out what I just did",
    "url": "https://inzone.app/game/nova-arena"
  },
  "shareTargets": ["iMessage", "WhatsApp", "Discord", "TikTok", "Instagram", "X"],
  "economy": [ ... ]
}
```

**Integration example (direct HTTP — no bridge method for this endpoint):**

```javascript
const config = window.__INZONE_SOCIAL_LOOP_CONFIG__;

const response = await fetch(`${config.backendBaseUrl}/api/game-sdk/progress/share`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    gameId: config.gameId,
    userId: config.userId,
    score: lastScore,
    title: `New high score — ${lastScore}!`,
    sessionId: config.sessionId
  })
});
const data = await response.json();
// Use data.share with navigator.share() or a copy-to-clipboard fallback
```

---

### 4. Open Chat

`POST /api/game-sdk/open-chat`

Opens or joins a per-game group chat thread. If the thread already exists, the player is merged into the participant list.

**When to call:** When the player taps "Chat" or "Group Chat" after a round.

#### Request

```json
{
  "gameId": "nova-arena",
  "userId": "user_42",
  "sessionId": "sess_123",
  "characters": ["nova", "orin"],
  "context": { "score": 4820, "result": "win" },
  "message": "Just crushed it!"
}
```

| Field | Type | Required | Notes |
|-|-|-|-|
| `gameId` | string | yes* | Required unless `threadId` is provided |
| `threadId` | string | no | Reuse a specific conversation. If omitted, defaults to `post-session-{gameId}` |
| `userId` | string | no | Player joining the thread |
| `sessionId` | string | no | |
| `characters` | array | no | AI character names to include in the thread |
| `context` | object | no | Arbitrary context (score, result, etc.) attached to the conversation |
| `message` | string | no | Initial message. Defaults to `"A new player joined the game thread"` |

#### Response

```json
{
  "success": true,
  "endpoint": "open-chat",
  "conversation": {
    "conversationId": "post-session-nova-arena",
    "gameId": "nova-arena",
    "sessionId": "sess_123",
    "participants": ["user_42", "nova", "orin"],
    "characters": ["nova", "orin"],
    "context": { "score": 4820, "result": "win" }
  },
  "economy": [ ... ]
}
```

**Integration example:**

```javascript
document.getElementById('chatBtn').addEventListener('click', async () => {
  const data = await window.InZoneSDK.openChat({
    context: { score: lastScore, result: 'win' }
  });
  // The host app handles rendering the chat UI.
  // data.conversation.conversationId → the Firestore thread ID
});
```

The InZone host app renders the chat UI — your game just needs to make this call to ensure the thread exists and the player is in it.

---

### 5. Game State

`GET /api/game-sdk/game-state`

Returns a player's coin balance, transaction history, and score history for a specific game. This is the "account overview" endpoint.

**When to call:** On game load to check balance before offering purchases, or to display transaction/score history.

**Requires:** `X-Game-Key` header.

#### Request

```
GET /api/game-sdk/game-state?gameId=nova-arena&userId=user_42
```

| Parameter | Type | Required | Notes |
|-|-|-|-|
| `gameId` | string (query) | yes | |
| `userId` | string (query) | yes | |

#### Response

```json
{
  "success": true,
  "data": {
    "gameId": "nova-arena",
    "userId": "user_42",
    "balance": 340,
    "currency": "Coin",
    "transactions": [
      {
        "transactionId": "tx_abc",
        "title": "Extra attempt after fail state",
        "description": "Grants one more run",
        "coins": 10,
        "commissionCoins": 1,
        "developerCoins": 9,
        "status": "confirmed",
        "createdAt": "2026-06-08T10:30:00Z"
      }
    ],
    "scores": [
      {
        "scoreId": "sc_xyz",
        "score": 4820,
        "durationMs": 92447,
        "displayName": "SpaceCadet",
        "createdAt": "2026-06-08T10:28:00Z"
      }
    ]
  }
}
```

Returns the last 50 transactions and 50 scores, ordered newest first.

**Integration example:**

```javascript
async function loadGameState() {
  const data = await window.InZoneSDK.gameState({});
  // data.data.balance → show coin count in HUD
  // data.data.transactions → display purchase history
  // data.data.scores → display score history
}
```

The bridge handles `X-Game-Key`, `gameId`, and `userId` automatically.

---

### 6. Player State (Save/Load)

`GET` or `POST /api/game-sdk/state`

Persists and retrieves a per-player save blob — progress, inventory, checkpoints, unlocked levels, or any game-specific data. The blob is opaque to InZone (it stores whatever JSON object you send). **This is NOT for coin balances** — those are managed server-side through the coin tier endpoints.

**Does NOT require `gameKey`.** The player's identity is scoped by the host app.

#### Save State — `POST`

**When to call:** After a checkpoint, level completion, inventory change, or any moment you want to persist progress.

```json
{
  "gameId": "nova-arena",
  "userId": "user_42",
  "state": {
    "level": 12,
    "inventory": ["shield", "laser-mk2"],
    "checkpointX": 450,
    "checkpointY": 220,
    "unlockedModes": ["hard", "survival"]
  },
  "metadata": {
    "saveLabel": "Checkpoint Level 12",
    "platform": "flutter-webview"
  }
}
```

| Field | Type | Required | Notes |
|-|-|-|-|
| `gameId` | string | yes | |
| `userId` | string | yes | |
| `state` | object | yes | Must be a JSON object (not a string, array, or primitive). Max 256 KB when serialized |
| `metadata` | object | no | Optional metadata about the save (labels, timestamps, platform info) |

**Response:**

```json
{
  "success": true,
  "data": {
    "gameId": "nova-arena",
    "playerId": "user_42",
    "version": 5,
    "bytes": 187,
    "savedAt": "2026-06-08T12:00:00+00:00"
  }
}
```

The `version` field auto-increments with each save. Use it for conflict detection if needed.

#### Load State — `GET`

**When to call:** On game start, to restore player progress.

```
GET /api/game-sdk/state?gameId=nova-arena&userId=user_42
```

| Parameter | Type | Required | Notes |
|-|-|-|-|
| `gameId` | string (query) | yes | |
| `userId` | string (query) | yes | |

**Response (existing save):**

```json
{
  "success": true,
  "data": {
    "gameId": "nova-arena",
    "playerId": "user_42",
    "state": {
      "level": 12,
      "inventory": ["shield", "laser-mk2"],
      "checkpointX": 450,
      "checkpointY": 220,
      "unlockedModes": ["hard", "survival"]
    },
    "version": 5,
    "metadata": {
      "saveLabel": "Checkpoint Level 12",
      "platform": "flutter-webview"
    },
    "updatedAt": "2026-06-08T12:00:00+00:00"
  }
}
```

**Response (new player, no save yet):**

```json
{
  "success": true,
  "data": {
    "gameId": "nova-arena",
    "playerId": "user_42",
    "state": {},
    "version": 0,
    "metadata": {},
    "updatedAt": null
  }
}
```

A new player returns `version: 0` and an empty `state` — **not** a 404. Check `version === 0` to detect first-time players.

**Integration example (direct HTTP — no bridge method for this endpoint):**

```javascript
const config = window.__INZONE_SOCIAL_LOOP_CONFIG__;

// On game start — load saved progress
async function loadSave() {
  const url = `${config.backendBaseUrl}/api/game-sdk/state`
    + `?gameId=${config.gameId}&userId=${config.userId}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.data.version === 0) {
    return getDefaultGameState(); // New player
  }
  return data.data.state;
}

// After checkpoint — save progress
async function saveProgress(gameState) {
  const res = await fetch(`${config.backendBaseUrl}/api/game-sdk/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gameId: config.gameId,
      userId: config.userId,
      state: gameState,
      metadata: { saveLabel: `Level ${gameState.level}` }
    })
  });
  const data = await res.json();
  console.log(`Saved version ${data.data.version}`);
}
```

**Constraints:**
- `state` must be a JSON object. Arrays, strings, and primitives at the top level are rejected.
- Maximum size: 256 KB (after JSON serialization). If exceeded, you get `STATE_TOO_LARGE`.
- One save slot per player per game. Each POST overwrites the previous save.
- Do NOT store coin balances here — they will be out of sync with the server. Use `game-state` to read balance.

---

### 7. Leaderboard

`GET /api/game-sdk/leaderboard`

Retrieves the leaderboard for a game, ordered by score descending.

**Does NOT require `gameKey`.** The game key is attached if present but not validated.

**When to call:** To display a leaderboard screen or widget.

#### Request

```
GET /api/game-sdk/leaderboard?gameId=nova-arena&limit=20
```

| Parameter | Type | Required | Notes |
|-|-|-|-|
| `gameId` | string (query) | yes | |
| `limit` | number (query) | no | Number of entries. Defaults to 50, max 200 |
| `scope` | string (query) | no | Defaults to `"global"`. Passed through in response |

#### Response

```json
{
  "success": true,
  "endpoint": "leaderboard",
  "gameId": "nova-arena",
  "scope": "global",
  "totalEntries": 3,
  "entries": [
    { "rank": 1, "entryId": "user_7_a1b2c3d4", "playerId": "user_7", "playerName": "Ace", "score": 9100, "metadata": {}, "createdAt": "2026-06-08T09:00:00Z" },
    { "rank": 2, "entryId": "user_15_e5f6g7h8", "playerId": "user_15", "playerName": "Nova", "score": 6200, "metadata": {}, "createdAt": "2026-06-08T09:15:00Z" },
    { "rank": 3, "entryId": "user_42_i9j0k1l2", "playerId": "user_42", "playerName": "SpaceCadet", "score": 4820, "metadata": {}, "createdAt": "2026-06-08T10:28:00Z" }
  ]
}
```

**Integration example (direct HTTP — no bridge method for this endpoint):**

```javascript
const config = window.__INZONE_SOCIAL_LOOP_CONFIG__;

async function loadLeaderboard() {
  const url = `${config.backendBaseUrl}/api/game-sdk/leaderboard`
    + `?gameId=${config.gameId}&limit=20`;
  const res = await fetch(url);
  const data = await res.json();
  // data.entries → array of { rank, playerId, playerName, score, createdAt }
}
```

`post-score` already returns a top-10 leaderboard snippet in its response. Use this dedicated endpoint when you need more entries or a standalone leaderboard screen.

---

## Coin Commerce

These are the in-game purchase endpoints. Each tier is a fixed coin amount deducted from the player's InZone balance. The player earns coins through the InZone app — your game spends them.

**Requires:** `X-Game-Key` header on all coin endpoints.

**Developer revenue share:** You receive 90% of every coin spent. The 10% commission is handled automatically.

### Tiers

| Tier | Endpoint | Coins | Use For |
|-|-|-|-|
| 1 — Impulse | `POST /api/game-sdk/coins/tier-10` | 10 | Retries, small boosts, one-session cosmetics |
| 2 — Investment | `POST /api/game-sdk/coins/tier-50` | 50 | Power-ups, hard modes, leaderboard entry fees |
| 3 — Identity | `POST /api/game-sdk/coins/tier-150` | 150 | Skins, permanent abilities, exclusive modes |
| 4 — Momentum | `POST /api/game-sdk/coins/tier-400` | 400 | Season passes, full game unlocks, bundles |

### Request (same for all tiers)

```json
{
  "userId": "user_42",
  "gameId": "nova-arena",
  "title": "Extra attempt after fail state",
  "description": "Grants one more run without breaking game flow",
  "sessionId": "sess_123"
}
```

| Field | Type | Required | Notes |
|-|-|-|-|
| `userId` | string | yes | The buyer's InZone user ID |
| `gameId` | string | yes | |
| `title` | string | yes | Human-readable label for the transaction (shown in history) |
| `description` | string | no | Defaults to `title` if omitted |
| `sessionId` | string | no | |

### Response

```json
{
  "success": true,
  "data": {
    "transactionId": "tx_abc123",
    "userId": "user_42",
    "gameId": "nova-arena",
    "title": "Extra attempt after fail state",
    "description": "Grants one more run without breaking game flow",
    "coins": 10,
    "commissionCoins": 1,
    "developerCoins": 9,
    "commissionRate": 0.1,
    "newBalance": 330,
    "currency": "Coin",
    "confirmation": "Coin transaction confirmed"
  },
  "tier": {
    "tier": "tier-10",
    "title": "Tier 1",
    "name": "Impulse",
    "summary": "The smallest meaningful action."
  },
  "payment": {
    "title": "Extra attempt after fail state",
    "description": "Grants one more run without breaking game flow",
    "commissionRate": 0.1
  }
}
```

**Key fields to use:**
- `data.newBalance` — update the player's coin display immediately.
- `data.transactionId` — log this for your records.
- If `success` is `false` and `error.code` is `INSUFFICIENT_BALANCE`, show the player they need more coins.

**Integration example:**

```javascript
async function purchaseRetry() {
  try {
    const data = await window.InZoneSDK.purchaseCoinTier(10, {
      title: '10 coin retry',
      description: 'Retry purchase for another run'
    });
    // data.data.newBalance → update coin display
    updateCoinDisplay(data.data.newBalance);
    startNewRound();
  } catch (err) {
    // The bridge throws on failure. Check the error for INSUFFICIENT_BALANCE.
    showMessage(err.message);
  }
}
```

**Important:** The purchase is atomic. If the response says `success: true`, coins have already been deducted. If the network fails before you receive the response, the coins are still deducted — use `game-state` to check the player's current balance and transaction history to reconcile.

---

## Field Name Flexibility

All endpoints accept both camelCase and PascalCase for field names (e.g., `gameId` or `GameId`, `userId` or `UserId`). The `playerId` field is accepted as an alias for `userId` wherever a user identifier is needed. Responses always use camelCase.

---

## Typical Integration Flow

Here is the order most games follow:

```
Game loads
  └─ wait for window.InZoneSDK or window.__INZONE_SOCIAL_LOOP_CONFIG__
  └─ InZoneSDK.gameState({})          → get coin balance
  └─ fetch GET /state                  → restore saved progress

Gameplay
  └─ fetch POST /state                 → save progress at checkpoints

Round ends
  └─ InZoneSDK.postScore({ score })    → record score, get leaderboard

Game-over screen (tie each to a button)
  └─ InZoneSDK.purchaseCoinTier(10, { title })  → retry
  └─ InZoneSDK.sendChallenge({ score })          → challenge a friend
  └─ fetch POST /progress/share                   → share progress
  └─ InZoneSDK.openChat({ context })              → group chat

Leaderboard screen
  └─ fetch GET /leaderboard            → full leaderboard
```

There is no required sequence. You can call any endpoint at any time as long as the config is present.

---

## Troubleshooting

**Endpoints seem to work but no data reaches the backend.**
This almost always means your game is using fallback/mock values instead of the real config. The config and SDK are injected **after** your page finishes loading all resources (scripts, fonts, images, etc.). If you used a timeout to wait for the config (e.g. `setTimeout(resolve, 1500)`), external resources like web fonts can push the injection past your timeout. When that happens, your game runs with whatever defaults you hardcoded — empty `backendBaseUrl`, null `userId` — and every `fetch` call either hits the wrong server or silently fails. **Never use a timeout to wait for the config.** Use the `inzone:sdk-ready` event or `InZoneSDK.getConfig()` as shown in the "How Your Game Connects to InZone" section above. Those resolve when the config is actually ready, regardless of how long external resources take.

**Balance never loads, start button doesn't appear.**
The `gameState` call requires `userId` and `gameKey`. If either is missing or empty in `window.__INZONE_SOCIAL_LOOP_CONFIG__`, the call fails and your UI never gets the balance. Log the config object on page load to verify all fields are populated.

**Coin purchases, challenges, and share cards do nothing.**
Same root cause. If `backendBaseUrl` is empty, every `fetch` call goes nowhere. If you're using the `InZoneSDK` bridge, the InZone app makes the call for you — but it still reads from the same config. Check `config.backendBaseUrl` is `https://inzoneapi-912424781531.us-central1.run.app`.

**`window.InZoneSDK` is undefined.**
Your code ran before InZone finished adding the SDK to the page. Either listen for the `inzone:sdk-ready` event, or wrap your startup code in a check:

```javascript
function waitForSDK() {
  return new Promise((resolve) => {
    if (window.InZoneSDK) return resolve(window.InZoneSDK);
    window.addEventListener('inzone:sdk-ready', () => resolve(window.InZoneSDK), { once: true });
  });
}

const sdk = await waitForSDK();
// Now safe to call sdk.postScore(), sdk.gameState(), etc.
```

**Everything works locally but fails in production.**
You hardcoded `localhost` or a test URL somewhere. Search your code for any hardcoded backend URLs and replace them with `config.backendBaseUrl`.

**Your game does not work outside the InZone app.**
The config and SDK are provided by InZone's WebView. If you open your HTML file in a regular browser, there is no config injection, no bridge, and no `inzone:sdk-ready` event. The endpoints cannot be called. To test locally without InZone, you need to mock `window.__INZONE_SOCIAL_LOOP_CONFIG__` yourself with test values before your game code runs.
