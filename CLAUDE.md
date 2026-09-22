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

**More room for a landscape game** is `lib/display-mode.ts`, and it is a capability question before it is a design one.

The previous answer rotated the whole player 90° in CSS. The geometry was right, the hit-testing was right, and on a physical iPhone it was still wrong: Safari's status bar, address bar and toolbar do not rotate with a transformed element, so the result was a sideways player inside an upright browser — the same incoherence relocated to the frame around it. **CSS rotation is not fullscreen.** It cannot remove browser chrome and it cannot lock an orientation.

So: feature-test, then offer only what the browser reports. `detectDisplayCapabilities` probes the Fullscreen API on an element *and* `fullscreenEnabled` (the method existing is not permission to use it), plus `screen.orientation.lock`. Capability probes, never a user-agent string. Where element fullscreen exists, the control is real fullscreen, and an orientation lock is asked for inside the same gesture and ignored if refused. Where it does not — iPhone Safari today — no control is offered, the layout stays stable, and the build's own measured `orientationHint` is surfaced instead: turning the phone genuinely works there, because the browser re-lays out and its chrome turns with it.

The browser owns fullscreen state. It can be left with a system gesture, Escape or a back swipe, none of which pass through our control, so the player mirrors `fullscreenchange` rather than tracking its own flag.

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
node --experimental-strip-types --test tests/gameplay-signals.test.mjs tests/gameplay-boundaries.test.mjs tests/campaign-analytics.test.mjs tests/flappy-gameplay.test.mjs tests/companion.test.mjs tests/companion-grounding.test.mjs tests/companion-stream.test.mjs tests/flagship-roster.test.mjs tests/play-invite.test.mjs tests/nightclub-companion-focus.test.mjs tests/player-stage.test.mjs tests/qa-traffic-dispatch.test.mjs tests/game-entry.test.mjs tests/rail-inset.test.mjs tests/player-chrome-contract.test.mjs tests/player-actions.test.mjs tests/letterbox.test.mjs tests/discovery.test.mjs tests/display-mode.test.mjs tests/flagship-readiness.test.mjs tests/resume-diagnostics.test.mjs
```

That is the load-bearing suite for measurement, campaign analytics, the companion and the player layout contract. All 231 tests must pass (6 discovery tests stand down while `/games` does not route to `DiscoveryPage`).

Other suites and their triggers:

- `npm run test:sdk-harness` — Web SDK host protocol.
- `npm run test:game-sdk` — SDK host + existing-game contracts.
- `npm run test:session-prototype` — session-prototype landing + campaign attribution.
- `npm run test:play-session-rules` — Firestore rules (needs Firebase emulator).
- `node tests/flappy-measurement.browser.mjs` — disposable local Next app with the real public Flappy v9 build; requires `CHROMIUM_EXECUTABLE` and network. Captures Meta calls locally, tests first-load and route PageViews plus real start/over/replay/60-second engagement; does not certify production ingestion.
- `node --test tests/player-geometry.browser.mjs` — computed player geometry at desktop, phone portrait and short landscape, plus a check that the player is never transformed. Needs `playwright-core` and a Chromium binary (`CHROMIUM_EXECUTABLE`). This is the one that catches a bar sitting on the game; source assertions cannot.
- `node --test tests/meta-suppression.browser.mjs` — runs the real `MetaPixel` in a disposable Next app under faked hostnames and watches the network. A marker that only tags the payload is not suppression: the base script sends its own `PageView`. Includes a positive control, so a build that simply never loads the pixel cannot pass. Every Meta request is aborted at the browser and only recorded.
- `PREVIEW=… BYPASS=… node scripts/flagship-matrix.mjs` — every flagship at phone, tablet and desktop, with the failure attributed to a layer. Reads motion from a compositor screenshot, not the canvas: a WebGL canvas cannot be read back without `preserveDrawingBuffer`, and the first version of this duly reported that Nightclub Showdown does not respond to taps.
- `PREVIEW=… BYPASS=… node scripts/companion-latency.mjs` — the conversation pipeline leg by leg, cold turn separated from warm, with provider and playback mode. One number was hiding five.
- `ELEVENLABS_API_KEY=sk_… node scripts/voice-samples.mjs` — three candidate voices speaking one line, same model and settings, so the choice is about the voice. Refuses to run without a real secret rather than quietly producing something else.
- `PREVIEW=… BYPASS=… node scripts/display-fallback.mjs` — the stage through the transitions a browser performs without asking: rotation, toolbar growth and collapse, a keyboard under the chat field, and the way back to the game. After each one it asserts a usable stage, no bar over it, every cell above 44px, and the frame's identity — a measured inset that is not re-measured is just a stale constant. Also checks that exactly one of the fullscreen control or the orientation hint is offered, and that a refused fullscreen request leaves the layout intact.
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
- Rotate the player in CSS and call it fullscreen. The browser's own chrome does not turn with it.
- Promote a title in a row before someone has finished a round on it. A row padded to length is an advertisement, and the player finds out about fifteen seconds after tapping.
- Read a repainting canvas as gameplay. It shows the build is alive and receiving input; a race, a bout and a finished round are three further questions.
- Record an agent sandbox's blocked egress as a broken game. Four of five flagships fetch part of their own build from hosts these sandboxes refuse; that is why the only "verified" titles are the two served entirely from `/gcs`, and that pattern is a fact about the rig at least as much as about the games.
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
| Player layout, the stage, fullscreen | `app/globals.css` (the stage block), then `lib/rail-inset.ts` and `lib/display-mode.ts`, then `tests/player-chrome-contract.test.mjs` and `tests/player-geometry.browser.mjs`. |
| Whether a title may be promoted | `lib/flagship-readiness.ts`. Five steps answered separately — assets, menu, gameplay entered, ordinary controls, round and restart — because they fail separately. A canvas that repaints under a tap proves the build is alive and receiving input, and nothing more. Only a complete journey is promotable, the approved five stay labelled as the roster, and a verified title outside it is shown as an extra rather than quietly promoted into the five. |
| Why a tap did or did not resume a game | `lib/resume-diagnostics.ts` and `components/ResumeDiagnostics.tsx`. Preview-only, opt-in with `?inzoneDiag=1`, refused on production. It records where a tap landed and what the engine did; it never clicks the canvas, calls resume or changes the hold, and it has no transport — a log leaves the device only if someone exports it. Structure only, never `textContent`, because the same walk passes through chat bubbles and captions. |
| Per-title device behaviour | `scripts/flagship-matrix.mjs`. It attributes a failure to a layer — host, canvas, touch, assets — and refuses to attribute one at all when this sandbox could not fetch the build. |
| The spoken companion | `components/GameCompanion.tsx` for the cell and sheet, `lib/companion/*` for providers, quotas and grounding, `docs/COMPANION_QUOTA.md` for spend. |
| Play session / invites | `lib/play-session.ts`, `lib/play-session-core.ts`, `components/SocialPanel.tsx`. |
| Firestore rules | `firestore.rules` + `tests/play-session.rules.test.mjs`. Rules changes without a passing test do not merge. |

---

*This file is the contract. If it lies or drifts, fix it in the same PR as the change it disagrees with.*
