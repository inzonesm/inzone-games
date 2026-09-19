# InZone Games — Single Source of Truth

**Read this first.** Every agent — Claude Code, Cursor, Codex, or the human — starts sessions here. If a decision is not covered below, ask.

---

## What this is

InZone Games is a Next.js web hub that plays community games in-page via iframe. It signs in with the same Firebase project as the Flutter app (`inzone-f93e4`) and reads its catalog from the `html_games` Firestore collection. Production lives at **`https://inzone.games`**. The audience is Panafrican-first; measurement, ad spend, and copy all default to honesty over hype.

---

## Repo at a glance

| Path | What lives there |
|---|---|
| `app/` | Next.js App Router routes. Game player is `app/games/[id]/page.tsx`. |
| `components/` | Client React components. `MetaPixel.tsx`, `SocialPanel.tsx`, `GameSdkHost.tsx`, etc. |
| `lib/` | Non-UI logic. Measurement contract lives in `lib/gameplay-signals.ts`; analytics dispatch in `lib/campaign-analytics.ts`. |
| `tests/` | Node `--test` suites (`*.test.mjs`) and Playwright browser scripts (`*.browser.mjs`). |
| `scripts/` | Acceptance runners (`nightclub-acceptance.mjs`) and SDK harnesses. |
| `firestore.rules` / `storage.rules` | Deployed Firebase rules. Do not touch without a rules test. |
| `.env.local.example` | Every public env var is documented here. Copy to `.env.local` to develop. |

---

## Deployment

| Environment | Branch | URL |
|---|---|---|
| Production | `main` | `https://inzone.games` |
| Preview | any other pushed branch | `*.vercel.app` (per Vercel project `in-zone-s-projects/inzone-games`) |

`main` is the only branch that can change what a Meta-targeted browser sees. A merge to `main` triggers a Vercel Production build automatically. Preview URLs are useful for smoke tests but Meta will not credit events from them because domain verification is scoped to `inzone.games`.

---

## The event contract (load-bearing — do not deviate)

Four events, and only four, are **verified gameplay**. Everything else is either a proxy or unrelated. The distinction is enforced by `VERIFIED_GAMEPLAY_EVENTS` in `lib/campaign-analytics.ts` and is the single gate that decides what reaches Meta.

| Event | When | Counting scope |
|---|---|---|
| `game_start` | First meaningful gameplay action a build reports for a run. | Once per run (dedup on `run_id`). Rounds, not people. |
| `engaged_play` | 60 s cumulative **active foreground** gameplay in one visit for one game. | Once per visit per game. |
| `first_game_over` | Build's own end-of-run signal. | Once per visit per game. |
| `return_play` | Verified `game_start` on the immediately following local calendar day. | Once per browser per day. |

Named **proxies** (also emitted, but not verified — never sent to Meta, never counted as players):

- `game_frame_loaded` — the iframe's `load` fired. A download, not a player.
- `game_frame_focused` — the frame got focus.
- `game_sdk_activity` — the build called `saveState` / `loadState` / `requestPurchase`.

**Rules that never bend:**

- `game_start` is never emitted from an iframe `load`, a timer, a click outside the game, or "the SDK did something."
- A game with no adapter and no `postMessage` bridge produces **no** verified events. We report a smaller honest number rather than fabricate one.
- Chat text, invite links, session IDs, raw URLs, and any secret-shaped string never reach any analytics destination. `sanitizeData` is the only gate.
- `visitor_id` is a random browser-scoped ID. It is never called a person. "Unique engaged visitors" is labelled as browsers, and reported separately from rounds.

## Approved flagship roster

The web hub's launch set is fixed until Jayme changes it. Do not substitute a different product direction or a broader catalogue as "the" experience.

| Title | Catalog id | Verified gameplay-state bridge |
|---|---|---|
| Kart Bros | `kart-bros` | No — instructions only |
| Elytra Flight | `clelytraflight` | No — instructions only |
| Karate Bros | `karate-bros` | No — instructions only |
| Escape Road | `clescaperoad` | No — instructions only |
| Nightclub Showdown | `nightclub-showdown-inzone-production` | Yes — inspected v2 `NightclubBridge` / `heroHistory`. Treat fields as untrusted structured data. Access is not coaching. |

Hub presentation of this set lives in `lib/flagship-roster.ts` and is a row on `/games`, not a new homepage.

The spoken companion is a guest feature on the existing player. Speech generation reuses the Little Chapters pattern (`speakPrompt`, server ElevenLabs, provider selection, caches, browser fallback, audio-session). It is not a new analytics destination, not Azure pronunciation assessment, and not a paid-profile/coins gate. Companion events go through `trackCampaignEvent` with no transcript, chat, or microphone audio.

Verified adapters currently cover Nightclub Showdown and Flappy Bird (`flappybird-inzone-2`, inspected v9 build only). Nightclub start and activity come from the inspected v2 engine's `heroHistory` of non-None `executeAction` calls after the intro cinematic; a 5 s inactivity grace follows each such action and autonomous board/enemy changes do not renew it. Credit is only the overlap with an already-open window — a new action after expired grace does not backfill idle. Hidden, paused, menu, and ended intervals stay excluded. Nightclub `game_start` counts rounds (`run-1`, `run-2`, … on each restart), not unique acquired players. Flappy Bird uses the engine's first-flap and final game-over transitions, excluding a pending paid-continue prompt. Other titles, including the montage games, still need their own verified bridge or adapter; do not count them as verified players.

Verified event architecture and definitions are documented at the top of `lib/gameplay-signals.ts`. Read that file before changing anything about measurement.

---

## Analytics destinations

Three destinations, each with a different scope. **Do not add a fourth without a written reason.**

| Destination | What it sees | Wired in |
|---|---|---|
| **Hexclave** (site analytics) | Every campaign event (verified + proxies), sanitized. | `HexclaveCampaignTransportBridge`, `lib/campaign-analytics-hexclave.ts` |
| **Meta Pixel** (`2983764635290155`, Web dataset for ad account `1200604131220857`) | `PageView` on route change + only the four `VERIFIED_GAMEPLAY_EVENTS` as `trackCustom` with `event_id`. | `components/MetaPixel.tsx`, dispatched via `setMetaPixelDispatcher` |
| **Vercel Analytics** | Page views only, unattributed. | `@vercel/analytics/next` in `app/layout.tsx` |

Conversions API (server-side dedup for Meta) is deliberately **not wired** yet. `event_id` is already generated on every verified send so CAPI, when it lands, deduplicates browser and server sends for free.

Ads on ad account `1200604131220857` **stay off** until Meta Test Events confirms real events arriving from `inzone.games` for at least `game_start`, `engaged_play`, and `first_game_over`.

---

## Branch and PR rules

We build across multiple agents (Claude Code, Cursor, Codex, human). Coordination is a discipline, not a hope.

### Naming

Prefix branches with the tool that authored them, then a short slug:

- `claude/<slug>` — Claude Code sessions
- `cursor/<slug>` — Cursor background agents
- `codex/<slug>` — OpenAI Codex / ChatGPT
- `human/<slug>` — hand-crafted

Never reuse a branch name after its PR merged. Start a fresh one from `main`.

### Rules that never bend

1. **Every new session starts from `main`.** If your task depends on unmerged work, that work must merge first. No stacking on someone else's draft.
2. **Cap: two open drafts across the whole repo.** More than that and no one can hold the tree in their head.
3. **Draft is a status with a 48-hour clock.** After 48 hours, the draft is either marked Ready or closed. Silent drafts pile into launch chaos.
4. **A merged PR is finished.** Follow-up work starts on a new branch, not on the merged one.
5. **No force-pushes to `main`, ever.** Force-with-lease is fine on your own agent branch before its PR opens.
6. **A PR body explains why, not just what.** The diff shows what. The body must state the mechanism and the constraint it respects.

### Merge stewardship

One steward owns merging. Today that is the human account holder. If a steward agent is appointed, it lives here in this document. Every other agent produces; the steward sequences and merges.

---

## Testing

Run before pushing:

```
node --experimental-strip-types --test tests/gameplay-signals.test.mjs tests/gameplay-boundaries.test.mjs tests/campaign-analytics.test.mjs tests/flappy-gameplay.test.mjs
```

That is the load-bearing suite for measurement and campaign analytics. All 49 tests must pass.

Other suites and their triggers:

- `npm run test:sdk-harness` — Web SDK host protocol.
- `npm run test:game-sdk` — SDK host + existing-game contracts.
- `npm run test:session-prototype` — session-prototype landing + campaign attribution.
- `npm run test:play-session-rules` — Firestore rules (needs Firebase emulator).
- `node tests/flappy-measurement.browser.mjs` — disposable local Next app with the real public Flappy v9 build; requires `CHROMIUM_EXECUTABLE` and network. Captures Meta calls locally, tests first-load and route PageViews plus real start/over/replay/60-second engagement; does not certify production ingestion.
- Browser tests (`*.browser.mjs`) require `playwright-core`; they are the source of truth for real gameplay measurement and are gated by CI, not local sandboxes.

TypeScript: `npm run typecheck`. Do not merge with new type errors on files you touched.

---

## Do not

- Fabricate a verified gameplay signal from an iframe load, a focus event, a click outside the game, or a timer.
- Add a new analytics destination without wiring it through `trackCampaignEvent`. There must be exactly one path from event → transport, and it lives in `lib/campaign-analytics.ts`.
- Emit a chat message, invite URL, session ID, or raw URL as an event property. `sanitizeData` will strip it, but code that hands it in reveals a design mistake.
- Turn Meta ads on before `game_start`, `engaged_play`, and `first_game_over` all show up in Meta Test Events from the verified domain `inzone.games`.
- Re-use dataset IDs that Meta labels as **App ID**. The website dataset is `2983764635290155` (Web). App-family IDs `1054095300149906`, `3421498634819032`, `1658329978404229` are **never** the website pixel.
- Publish an ad creative that claims multiplayer for a game whose only shared state is chat. The invite/session flow exists; shared game state does not exist for every advertised title. Sell only what actually synchronizes.

---

## Contact points across the stack

- **Firebase project**: `inzone-f93e4`. Web app must be added under Project settings → Your apps.
- **Vercel project**: `in-zone-s-projects/inzone-games`. Production branch is `main`.
- **Meta ad account**: `1200604131220857`. Verified web dataset (Pixel): `2983764635290155`. Domain verification for `inzone.games` lives in Business Settings → Brand safety → Domains.
- **Aggregated Event Measurement priority order** (once real events flow): 1 `first_game_over`, 2 `engaged_play`, 3 `game_start`, 4 `return_play`, 5 `PageView`.

---

## Where to look before you change

| Changing… | Read first |
|---|---|
| Measurement (`game_start`, engagement, retention) | `lib/gameplay-signals.ts`, then `lib/use-gameplay-measurement.ts`, then `tests/gameplay-signals.test.mjs`. |
| Campaign analytics / sanitization | `lib/campaign-analytics.ts`, then `tests/campaign-analytics.test.mjs`. |
| Adding a verified game | `lib/game-adapters.ts` — an adapter must name the exact field it reads state from. |
| Meta pixel | `components/MetaPixel.tsx`. Never call `fbq` from anywhere else. |
| Play session / invites | `lib/play-session.ts`, `lib/play-session-core.ts`, `components/SocialPanel.tsx`. |
| Firestore rules | `firestore.rules` + `tests/play-session.rules.test.mjs`. Rules changes without a passing test do not merge. |

---

*This file is the contract. If it lies or drifts, fix it in the same PR as the change it disagrees with.*
