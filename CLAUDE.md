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
- `companion_intro` / `companion_turn` / `companion_listen` / `companion_audio_fail` — the spoken companion. A player talking to Rook is not a player playing. These never reach Meta and never carry transcript text: every companion property is a closed enumeration (`companion_state`, `companion_provider`, `companion_model`, `companion_reply_source`) plus `latency_ms`, so none of them can carry a sentence.

**Rules that never bend:**

- `game_start` is never emitted from an iframe `load`, a timer, a click outside the game, or "the SDK did something."
- A game with no adapter and no `postMessage` bridge produces **no** verified events. We report a smaller honest number rather than fabricate one.
- Chat text, invite links, session IDs, raw URLs, and any secret-shaped string never reach any analytics destination. `sanitizeData` is the only gate.
- Test traffic never teaches the ad platform. Outside production, and on any visit marked `?inzone_qa=agent|manual`, the Meta Pixel is not initialised at all — base script included. Gating only the custom events would still send a `PageView` per route change from every Preview check. Closed sets live in `lib/qa-traffic.ts`; the two gates are `trackCampaignEvent` and `components/MetaPixel.tsx`.
- An invite creates an InZone **conversation** — shared chat and membership. It is not a shared match. Copy says conversation everywhere for that reason, including the in-game `sendChallenge` / `openChat` bridge. A game whose only synchronised state is chat is never sold as multiplayer.
- `visitor_id` is a random browser-scoped ID. It is never called a person. "Unique engaged visitors" is labelled as browsers, and reported separately from rounds.

Verified adapters currently cover Nightclub Showdown and Flappy Bird (`flappybird-inzone-2`, inspected v9 build only). Nightclub start and activity come from the inspected v2 engine's `heroHistory` of non-None `executeAction` calls after the intro cinematic; a 5 s inactivity grace follows each such action and autonomous board/enemy changes do not renew it. Credit is only the overlap with an already-open window — a new action after expired grace does not backfill idle. Hidden, paused, menu, and ended intervals stay excluded. Nightclub `game_start` counts rounds (`run-1`, `run-2`, … on each restart), not unique acquired players. Flappy Bird uses the engine's first-flap and final game-over transitions, excluding a pending paid-continue prompt. Other titles, including the montage games, still need their own verified bridge or adapter; do not count them as verified players.

Verified event architecture and definitions are documented at the top of `lib/gameplay-signals.ts`. Read that file before changing anything about measurement.

---

## The player layout contract (load-bearing — do not deviate)

One screen, one rule. Every piece of chrome on `/games/[id]` is one of two things and never both:

| Kind | Rule | Today |
|---|---|---|
| **Persistent** | Insets the stage. The game never loses a pixel it does not know about. | The action bar, and only the action bar. |
| **Transient** | Floats over the game's own dead letterbox and removes itself. | Rook's caption, the controls hint, recovery, toasts, the session sheet. |

`.game-stage` is the iframe's containing block and the **only** box that decides how big the game is. The iframe's default box is plain `100%` of it — no `calc()`, no transform, no `--game-fit` on that path. An invalid `--game-fit` used to make the whole `calc()` invalid, which dropped the frame to the browser default 300×150 in the top-left corner while the bar and actions kept painting full-bleed. Zoom is now opt-in via `.game-stage.is-zoomed`.

`--rail-x` / `--rail-y` are **measured at runtime** from the bar's real box (`lib/rail-inset.ts`), not hardcoded. The constant they replaced was already 1px short of the rendered bar before anything was added to it, and a bar that outgrows its constant sits on the game silently.

No control may cancel its own click on a touch screen. `preventDefault()` in an `onPointerDown` handler also cancels the compatibility mouse events a touch screen synthesises, `click` included — so a control carrying it works on every desktop and is inert on every phone. Focus retention belongs on `mousedown`. A hosted run on a touch viewport is what found this; `pointerdown` and `touchstart` fired on the mute chip and no click ever did.

What the bar carries is a budget decision, not a styling one — `lib/player-actions.ts` holds the single definition and the bar and the More sheet are two presentations of it. A phone shows Rook, Chat (carrying real conversation state), Invite, Change game and Home; everything else is one tap behind **More**, never removed. A wide viewport shows the whole set and has no More.

There are **no swipe gutters**. They were two always-on invisible strips over the iframe's edges, and an always-on strip takes whatever gesture the build wanted there. Changing game is an explicit cell. Re-adding swipe needs device evidence that it takes no gesture the build uses, not an assumption that the edges are free.

Rook's **caption only overlays where there is measured room** (`lib/letterbox.ts`). A build that fills the stage leaves no band, and a frame we cannot read yields the same answer, so the caption stays in Rook's sheet rather than landing on live controls. A sheet and a caption never stack: the caption steps aside.

Rook is a **cell of that one bar**, not a second surface. It had been a 420×88 slab absolutely positioned inside the stage with no inset accounting — one surface respecting the game, the surface beside it sitting on top of it. That contradiction is what read as incoherent on a phone. Rook's sheet is the only place it may take space, and it gives that space back on Escape and on a tap read from the frame's own document. Not on focus: the first version polled `document.activeElement` and closed when that was the iframe, but the iframe already holds focus after any play, so every sheet shut itself within 400ms and its controls were unreachable.

**Fill screen** (`lib/fill-screen.ts`) is the opt-in landscape stage. A landscape-canvas game on a portrait phone is bound by width, not by our chrome: Nightclub Showdown gets a 390×136 canvas at 390pt and centres it in *its own page*, so the black band is inside the iframe. Deleting every pixel of host chrome returns ~59px to a screen whose game is already width-bound. Rotating turns the **whole player** — bar, bands and game together — so a 390×844 viewport becomes an 844×390 one and the phone is turned once with everything reading in the same direction. Rotating only the frame left a sideways game under upright chrome, which is the same incoherence relocated. It is worth roughly 4x on the drawn canvas, and it works where an OS rotation lock would defeat an orientation hint. It is offered only where `lib/game-controls.ts` records a measured `orientationHint`, never inferred from genre, and never applied on its own.

Fill screen gives the screen back on physical rotation (otherwise the turn compounds into a second 90°) and whenever a sheet that is typed into opens (a rotated field under an upright system keyboard is not usable). Both are `shouldExitFillScreen`. The rotated bar pads by the largest safe-area inset on every edge, because the insets do not rotate with the player.

Everything that floats is painted into `.player-overlay`, never inside the bar: `.game-rail` is positioned and scrolls its overflow, so an absolutely positioned child is clipped to the bar on a desktop rail. The geometry fixture mirrors the real nesting for exactly this reason — the first version made the caption a sibling of the bar and hid the bug.

Companion state must never remount the game. `reloadKey` is retry-only, and toggling fill screen is a class change verified not to remount the frame.

Verified by computed geometry in a real browser, not by reading the stylesheet: `tests/player-geometry.browser.mjs`. The rule itself is pinned by `tests/player-chrome-contract.test.mjs`.

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
node --experimental-strip-types --test tests/gameplay-signals.test.mjs tests/gameplay-boundaries.test.mjs tests/campaign-analytics.test.mjs tests/flappy-gameplay.test.mjs tests/companion.test.mjs tests/companion-grounding.test.mjs tests/companion-stream.test.mjs tests/flagship-roster.test.mjs tests/play-invite.test.mjs tests/nightclub-companion-focus.test.mjs tests/player-stage.test.mjs tests/qa-traffic-dispatch.test.mjs tests/game-entry.test.mjs tests/fill-screen.test.mjs tests/rail-inset.test.mjs tests/player-chrome-contract.test.mjs tests/player-actions.test.mjs tests/letterbox.test.mjs tests/discovery.test.mjs
```

That is the load-bearing suite for measurement, campaign analytics, the companion and the player layout contract. All 199 tests must pass (6 discovery tests stand down while `/games` does not route to `DiscoveryPage`).

Other suites and their triggers:

- `npm run test:sdk-harness` — Web SDK host protocol.
- `npm run test:game-sdk` — SDK host + existing-game contracts.
- `npm run test:session-prototype` — session-prototype landing + campaign attribution.
- `npm run test:play-session-rules` — Firestore rules (needs Firebase emulator).
- `node tests/flappy-measurement.browser.mjs` — disposable local Next app with the real public Flappy v9 build; requires `CHROMIUM_EXECUTABLE` and network. Captures Meta calls locally, tests first-load and route PageViews plus real start/over/replay/60-second engagement; does not certify production ingestion.
- `node --test tests/player-geometry.browser.mjs` — computed player geometry at desktop, phone portrait, phone portrait with fill screen, and short landscape, plus rotated hit-testing and a no-remount check across the fill-screen toggle. Needs `playwright-core` and a Chromium binary (`CHROMIUM_EXECUTABLE`). This is the one that catches a bar sitting on the game; source assertions cannot.
- `node --test tests/meta-suppression.browser.mjs` — runs the real `MetaPixel` in a disposable Next app under faked hostnames and watches the network. A marker that only tags the payload is not suppression: the base script sends its own `PageView`. Includes a positive control, so a build that simply never loads the pixel cannot pass. Every Meta request is aborted at the browser and only recorded.
- `PREVIEW=… BYPASS=… node scripts/player-journey.mjs` — the whole player journey against a hosted Preview: companion turns, gameplay continuity, interrupt, mute, the sheets, a real invite with a second browser joining, and Flappy entry and Retry. It proves everything after the words arrive; it cannot prove a microphone, and it says so. Deployment protection is lifted with the query-param form — the header form is stripped before it reaches Vercel and the run lands on the Vercel login page instead of the app.
- Browser tests (`*.browser.mjs`) require `playwright-core`; they are the source of truth for real gameplay measurement and are gated by CI, not local sandboxes.

TypeScript: `npm run typecheck`. Do not merge with new type errors on files you touched.

---

## Do not

- Put a listener, a gutter or any invisible strip over the game to catch a gesture.
- Call `preventDefault()` in an `onPointerDown` handler on anything that needs a click.
- Assume the game left you a letterbox. Measure it, and fail toward not covering anything.
- Add a second persistent surface to the player. If it is always on screen, it insets the stage through the bar's measured inset or it does not ship. If it is occasional, it floats over the letterbox and removes itself.
- Hardcode the bar's strip again. Measure it.
- Rotate a game's stage without the player asking, or offer the control for a game whose `orientationHint` nobody has measured.
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
| Player layout, the stage, fill screen | `app/globals.css` (the stage block), then `lib/rail-inset.ts` and `lib/fill-screen.ts`, then `tests/player-chrome-contract.test.mjs` and `tests/player-geometry.browser.mjs`. |
| The spoken companion | `components/GameCompanion.tsx` for the cell and sheet, `lib/companion/*` for providers, quotas and grounding, `docs/COMPANION_QUOTA.md` for spend. |
| Play session / invites | `lib/play-session.ts`, `lib/play-session-core.ts`, `components/SocialPanel.tsx`. |
| Firestore rules | `firestore.rules` + `tests/play-session.rules.test.mjs`. Rules changes without a passing test do not merge. |

---

*This file is the contract. If it lies or drifts, fix it in the same PR as the change it disagrees with.*
