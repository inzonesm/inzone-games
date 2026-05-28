# InZone Studio — React Build

Standalone React frontend for `app.inzone.gg`. Wired to your existing `/api/game-sdk/...` endpoints (Firebase Firestore behind them). Auth uses Firebase Authentication.

## Pages

| Route | Component | Endpoint |
|---|---|---|
| `/signin` | `pages/Signin.jsx` | Firebase Auth (email + Google + GitHub) |
| `/upload` | `pages/Upload.jsx` | `POST /api/game-sdk/games/register` |
| `/dashboard` | `pages/Dashboard.jsx` | `GET /api/game-sdk/dashboard?gameId={id}` |
| `/payouts` | `pages/Payouts.jsx` | TODO — endpoint not yet in SDK |

## Run this preview

This build is hosted as `index.html` + JSX-via-Babel for design review. Open `index.html` in a browser. **It is not production-shaped** — you ship to production via the Vite migration below.

The runtime is hash-routed (`#/dashboard`, `#/upload`, etc.) so it works from any static host without server rewrites.

## Migrate to Vite

Drop these files into a real Vite + React + TypeScript project. Keep the file structure; rename `.jsx` → `.tsx`. Three swap-outs:

### 1. `src/config.jsx` → `src/config.ts`

```ts
export const apiConfig = {
  apiUrl: import.meta.env.VITE_API_URL,
};
```

`.env.production`:
```
VITE_API_URL=https://api.inzone.gg
```

### 2. `src/auth.jsx` → wire real Firebase

```ts
import { initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged,
  signInWithEmailLink, signInWithPopup,
  GoogleAuthProvider, GithubAuthProvider, signOut,
} from 'firebase/auth';

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
});
const auth = getAuth(app);
```

The `AuthProvider` already exposes `{ user, signIn, signOut, loading }` with the same shape `onAuthStateChanged` returns — swap the implementation, keep the contract.

### 3. `src/router.jsx` → react-router-dom v6

```ts
import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
```

The hand-rolled `Router`, `useNavigate`, and `RouterLink` mirror react-router-dom's API names — call sites barely change.

## Auth + API contract

**Game-scoped calls** must send the developer's `gameKey` in the `X-Game-Key` header. The shell stores this in `localStorage` after the user picks a game. Your `/api/game-sdk/dashboard` and `/api/game-sdk/coins/*` enforce it server-side; the React app just forwards it.

**Firebase ID token** should accompany every request once you wire real auth:

```ts
const token = await user.getIdToken();
fetch(url, { headers: { Authorization: `Bearer ${token}` } });
```

Add this in `src/api.jsx`'s `buildHeaders` helper.

## Upload storage placeholder

The drop-zone simulates progress with a timer because **the storage endpoint doesn't exist yet**. When it lands:

1. Replace the `setInterval` in `pages/Upload.jsx#startUpload` with a real `fetch(uploadUrl, { method: 'PUT', body: file })`, using the `XMLHttpRequest` `progress` event or `fetch` with a `ReadableStream` for percent.
2. Pass the resulting storage URL into `registerGame()` as the `bundleUrl`.

Suggested initiate endpoint shape (matches your TS reference's pattern):

```
POST /api/game-sdk/builds/initiate
  → { uploadUrl: string, buildId: string, fields?: Record<string,string> }
```

## Backend endpoints status

| Endpoint | Status | Used by |
|---|---|---|
| `POST /api/game-sdk/games/register` | Live | Upload |
| `GET /api/game-sdk/dashboard` | Live | Dashboard |
| `POST /api/game-sdk/coins/tier-{N}` | Live | SDK only (not UI) |
| `GET /api/game-sdk/game-state` | Live | Dashboard tx feed (currently mocked) |
| `POST /api/game-sdk/group-chats/create` | Live | Upload (your TS reference uses it) |
| `GET /api/studio/games` | **TODO** | Game switcher |
| `GET /api/studio/payouts` | **TODO** | Payouts page |
| `POST /api/studio/builds/initiate` | **TODO** | Upload storage step |

Every API client function returns `{ source: 'backend' \| 'local' }` so you can see in the UI (look for the dashed note at the bottom of each page) whether you're hitting a real endpoint or the local fallback. Remove the local fallbacks before shipping.

## Deploy

```
# Vercel
npm i -g vercel
vercel
# Then set in Vercel dashboard:
#   VITE_API_URL=https://api.inzone.gg
#   VITE_FIREBASE_API_KEY=...
#   VITE_FIREBASE_AUTH_DOMAIN=inzone-studio.firebaseapp.com
#   VITE_FIREBASE_PROJECT_ID=inzone-studio
# Add custom domain: app.inzone.gg
```

CNAME `app.inzone.gg` → `cname.vercel-dns.com`.

## File map

```
react-app/
├── index.html                 # entry — loads Babel + JSX modules
├── styles.css                 # global theme tokens + chrome
├── README.md                  # this file
└── src/
    ├── config.jsx             # apiConfig (window.__API_URL__)
    ├── api.jsx                # API client — your TS pattern
    ├── auth.jsx               # Firebase Auth wrapper (stub)
    ├── router.jsx             # hash router → swap for react-router-dom
    ├── components.jsx         # TopBar, GameSwitcher, ApiNote, Pill
    ├── App.jsx                # shell + route table
    └── pages/
        ├── Signin.jsx
        ├── Upload.jsx         # 6 states: idle/hover/uploading/parsing/success/error/waitlist
        ├── Dashboard.jsx      # KPIs, retention, coin tiers, payout waterfall, tx feed
        └── Payouts.jsx        # pending balance, Stripe + W-9 setup, history
```

## Notes for the verifier

The runnable build at `index.html` loads JSX via Babel-standalone. This is fine for review but adds ~1s of compile time on first paint. The Vite migration moves compilation to build time.

All four pages share `TopBar` chrome (with the game switcher) so navigation feels instant.
