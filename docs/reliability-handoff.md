# Production reliability handoff

Owner of this file: the production-reliability track (Claude Code). Companion
and visual revamp live in PR #35 (Cursor) and are deliberately out of scope
here. Update this file in the same PR as the change it describes.

_Last updated: 2026-09-21 (PR #36 merged and deployed to production)._

## Branches and SHAs

| Thing | Value |
|---|---|
| Production branch | `main` @ **`177dc903ed6699d766a22737f8516fbb6027e8fa`** (merge of PR #36) |
| Previous production `main` | `2ceba36` (merge of PR #32) |
| This track's PR | [#36](https://github.com/inzonesm/inzone-games/pull/36) — **MERGED** 2026-09-21T19:27:37Z |
| Runtime SHA that was tested | `e340687` — identical runtime to the merge; the two commits after it touched only this file |
| Companion track | [#35](https://github.com/inzonesm/inzone-games/pull/35) — draft, head `cc7c61d`, 45 files |

PR #36 is merged and live on production after a physical-phone check by the
account holder. Escape Road remains untouched and separate.

## Production verification — after the merge

`https://www.inzone.games/games/flappybird-inzone-2`, iPhone 13 profile
(emulation). **7 passed, 0 failed.**

| Check | Result |
|---|---|
| Arrival reaches `getready` without pressing START | PASS — 7,994 ms, `enabled=true state=getready` |
| Verified `game_start` still requires the first flap | PASS — `game:play=0` at entry |
| First ordinary tap starts play, exactly one `game:play` | PASS — `state=play game:play=1` |
| Further taps do not duplicate the round's start | PASS — `game:play=1` |
| Death reaches game-over, exactly one `game:gameover` | PASS — `overScreen=true over=1` |
| Chat open/close preserves the iframe, no entry restart | PASS — marker unchanged, `game:play=1` |
| Restart via refresh reaches `getready`, clean count | PASS — `game:play=0` |

### Analytics delivery, by layer

| Layer | Status |
|---|---|
| **1. Engine events** (in-frame `game:play` / `game:gameover`) | **Verified.** One of each for one round. |
| **2. Emitted payloads on the wire** | **Unavailable from this environment.** Zero requests carrying `inzone_event` were captured, because `connect.facebook.net` and `r.hexclave.com` are blocked by the agent proxy. This is a sandbox limitation; it is **not** evidence the app failed to emit. |
| **3. Dashboard ingestion — Hexclave** | **Verified.** The smoke session appears in Hexclave: `game_ready` 19:30:43, `game_start` **×1** 19:30:46, `first_game_over` **×1** 19:30:47, `game_open` ×2, `game_frame_loaded` ×2 — matching the engine counters exactly. Ingestion proves emission happened even though layer 2 could not be captured here. |
| **3. Dashboard ingestion — Meta pixel** | **Not yet visible.** Meta's dataset stats lag; the newest bucket at query time was 11:00 PDT, before the 12:30 PDT test. `game_start`, `first_game_over` and `return_play` are all confirmed ingesting historically on dataset `2983764635290155`, so the path works — this specific event simply has not surfaced yet. |

**Disclosure:** the smoke session above is agent traffic on production and is
now in Hexclave and (shortly) Meta. One `game_start` and one
`first_game_over` on 2026-09-21 at 19:30 UTC are mine, not a visitor's.

## Bringing `main` into PR #35

Cursor should merge `main` (`177dc90`) into `cursor/flagship-companion-report-eb52`
rather than rebasing, so the branch's own checkouts stay valid.

The only conflict surface is **`app/games/[id]/page.tsx`**. `main` now contains,
immediately after `useGameplayMeasurement({ … })`:

1. `import { ENTRY_FIX_WINDOW_MS, entryFixFor } from '@/lib/game-entry';`
2. One `useEffect` with deps `[gameId, frameLoaded, reloadKey]`.

**Both must survive the merge.** Two properties are load-bearing and easy to
lose by accident:

- `socialOpen` is **deliberately absent** from those deps. Adding it would
  re-run entry initialization on every chat toggle.
- `setReloadKey` is called **only** by `retryFrame`. Anything else that bumps
  it remounts the game frame mid-play.

`lib/game-entry.ts` and `tests/game-entry.test.mjs` are new files with no
counterpart in #35, so they merge cleanly.

Checks to rerun after the merge (all were green on production at `177dc90`):

1. Arrival on `/games/flappybird-inzone-2` reaches `getready` with no START press; a tap then flaps.
2. Entry initialization produces no `game:play`; the first tap produces exactly one; further taps produce none.
3. Chat open/close preserves the iframe element and does not re-run the entry effect.
4. Companion mount/unmount does not re-run the entry effect or remount the game iframe.
5. Refresh, Retry and leave/reopen each reach `getready` on the new document.
6. If the companion or the shrinking-layout work changes iframe keying or remount behaviour, rerun 1–5 — the guard is keyed on Document identity and assumes a new document per genuine arrival. Retry currently **replaces** the element, which satisfies that; if it ever becomes a navigation of the same element, the Document key is what keeps it correct.

## Shipped in PR #36

**Flappy Bird could not be started by the method everyone tries first.**

The inspected v9 build boots to a title screen holding `Game > Bird` disabled
until its START button is hit. `lib/game-entry.ts` fires the engine's own
`game:getready` once, only in that initial title state, so arrival lands on
the "get ready" screen where a tap anywhere flaps.

Constraints it holds to:

- Engine mutation stays **out** of `lib/game-adapters.ts` and
  `lib/flappy-gameplay-adapter.ts`, whose header states it never changes
  engine state. Entry repair is a separate module and must stay separate.
- It never stands in for the player. Verified `game_start` still comes from
  the build's first-flap transition.
- Fails closed on any path other than
  `/gcs/games/flappybird-inzone-2/v9/index.html`.
- At most one fire per `Window` (WeakSet); an enabled `Game Over Screen`
  blocks it; an already-enabled bird blocks it.
- Polling stops at `ENTRY_FIX_WINDOW_MS`.

### Evidence

Production replays, paid arrivals on `flappybird-inzone-2`, 19–21 Sep. These
are rrweb observations — repeated input with no round recorded. They do not
establish what the visitor intended.

| Replay | Viewport | Canvas in DOM | Taps on canvas | Window | Span |
|---|---|---:|---:|---|---:|
| `7bd4728a` | 359×640 | 5.9 s | 113 | 8.9→84.9 s | 91 s |
| `388a88df` | 393×749 | 6.0 s | 74 | 9.5→54.7 s | 89 s |
| `1b6cf8ed` | 432×822 | 5.3 s | 53 | 8.2→48.3 s | 50 s |
| `341755f6` | 359×652 | 6.8 s | 35 | 14.2→36.9 s | 37 s |
| `4aca6009` | 810×994 | 1.9 s | 19 | 4.2→60.3 s | 62 s |

Controlled reproduction, deployed v9, iPhone-sized viewport: 12 tap positions
across the frame were inert; the 13th, on START at ≈29 % across / ≈74 % down,
started the game.

Signal correctness, iPhone 13 profile, deployed v9:

```
after clear()      play=0  -> no verified game_start
after 1st flap     play=1  -> exactly one start for the round
after 5 more flaps play=1  -> not one per tap
after death        over=1  -> one first_game_over
```

Round behaviour, four profiles (phone portrait/landscape, tablet portrait,
desktop): bird stays `enabled` through play, pause, death and game-over, so
`clear()` is a no-op after the first round on this build.

## Hosted verification — PR #36

Verified against the **deployed build**, not an injected helper. No helper was
called from the test; the page was loaded and observed.

| | |
|---|---|
| Source SHA | `e34068783a6968c00ed29e76b5966d98e3a939f3` |
| Vercel state | Ready, "Deployment has completed", 2026-09-21T18:37:11Z |
| Deployment inspector | `https://vercel.com/in-zone-s-projects/inzone-games/5PdMseuRhHdvHd4f6W52T7EWc4ZT` |
| Branch alias | `https://inzone-games-git-claude-busy-cerf-19mfrm-in-zone-s-projects.vercel.app` |

iPhone 13 profile (emulation, not hardware). **10 passed, 0 failed, 1 n/a.**

| Check | Result |
|---|---|
| Fresh arrival reaches `getready` with no START press | PASS — 4,733 ms, `enabled=true state=getready` |
| Entry initialization produces no `game:play` | PASS — `game:play=0` |
| First ordinary tap flaps and produces exactly one `game:play` | PASS — `state=play game:play=1` |
| Further taps do not duplicate the round's start | PASS — `game:play=1` after five more taps |
| Death reaches game-over with exactly one `game:gameover` | PASS — `state=dead overScreen=true over=1` |
| Entry helper does not re-open behind the game-over screen | PASS — no further `getready` fired |
| Chat open/close preserves the iframe instance | PASS — element marker unchanged across toggle |
| Chat open/close does not restart entry initialization | PASS — `game:play` unchanged |
| Refresh reaches `getready` again | PASS — `play=0` on the new document |
| Leaving to `/games` and reopening reaches `getready` again | PASS — `play=0` on the new document |
| Retry control | covered separately below |

### Retry, under an induced recoverable failure

Run on the hosted Preview only. Browser interception was scoped to a single
path on a single host — `…vercel.app/gcs/games/flappybird-inzone-2/v9/index.html`
— aborted once, then cleared before the real Retry control was pressed. No
failure was injected into production.

| Check | Result |
|---|---|
| Induced failure surfaces the real Retry control | PASS — shell aborted 1×, control visible |
| After Retry the new document reaches `getready` | PASS — `enabled=true state=getready` |
| Entry initialization on the recovered document emits zero `game:play` | PASS — `game:play=0` |
| First ordinary tap emits exactly one `game:play` | PASS — `game:play=1` |
| The game accepts input after recovery | PASS — `state=play` |

**Retry replaces the iframe element; it does not navigate the existing one.**
An element marker set before pressing Retry was gone afterwards
(`MARK-v7r02i` → `null`), which matches `key={reloadKey}` forcing a React
remount. So recovery yields a new element, a new Window **and** a new
Document. The Document-keyed guard is correct here either way; it is keyed on
the Document so that it stays correct if that remount behaviour ever changes.

### Why the counter is `game:play`, not the emitted event

This sandbox cannot observe the outbound campaign events on Preview:
`connect.facebook.net` and `api.hexclave.com` are unreachable through the
agent proxy, so no `game_start` payload is ever put on the wire to intercept.
`game:play` is the **sole** input to a verified `game_start` — the adapter
fires `start` only on that engine event, inside `flap()`, once per run. The
one-to-one mapping is covered by `tests/flappy-gameplay.test.mjs` and was
separately confirmed on production. This is a proxy for the emitted event and
is labelled as one; it is not an observation of the pixel call.

## Correction: the WeakSet guard was wrong

The once-only guard keyed on the `Window`. `lib/use-gameplay-measurement.ts`
states that a same-origin iframe keeps its WindowProxy across navigation and
relies on that fact. A `WeakSet<Window>` would therefore have kept matching
after a retry or a `src` change that reuses the element, and the helper would
have refused to open the game again — landing the visitor back on the inert
title screen with no way past it. Fixed in `e340687`: the set is keyed on
`win.document`, which is what actually changes when a new page loads. Covered
by a test that reuses one window object across two documents, and by the
hosted refresh and reopen checks above.

## Corrections to earlier reporting

- **"The catalogue stalls for 78 seconds" was wrong.** Replay `63be4575`
  renders `59 games` at **0.28 s**; the remaining 52 s is an idle visitor who
  then taps a sidebar item. I misread a `Loading…` string in the 0.01 s
  full snapshot as a duration. Production re-measured: 101 cards in
  2.1–2.6 s with Firestore `200`s.
- **A `502` / `text/plain` chunk failure was the sandbox proxy, not
  production.** Ten direct fetches of the same chunk returned `200
  application/javascript`. Preserved here so it is not re-reported. The same
  proxy intermittently prevents page loads entirely in this environment;
  runs that fail that way are labelled, not counted as production defects.
- **The overlay handoff came from PR #32**
  (`cursor/nightclub-start-and-active-timing-ec9b`, merged into `main` as
  `2ceba36`), which added `probeFramePlayable` in
  `lib/game-frame-recovery.ts`. It hands the screen over once the engine
  reaches its title screen — correct in itself, but on Flappy v9 that screen
  is the inert one, so it uncovers the problem sooner rather than fixing it.
- **One accepted flap does not mean the whole game is healthy.** What is
  established is entry and single-round signal correctness. Difficulty,
  first-pipe fairness by viewport, and long-session behaviour are not.

## Coordination with PR #35

Files PR #36 touches that #35 also touches:

| File | Note |
|---|---|
| `app/games/[id]/page.tsx` | Only overlap. #36 adds one `useEffect` and one import. |

`lib/game-entry.ts` and `tests/game-entry.test.mjs` are new and unique to #36.

Behavioural checks Cursor must rerun after either side merges:

1. Arrival on `/games/flappybird-inzone-2` reaches `getready` with no START
   tap, and a tap then flaps.
2. Companion mount/unmount does not re-run the entry effect or remount the
   game iframe.
3. Chat open/close, retry, refresh and game switching produce no duplicate
   initialisation and no unwanted remount. On `main`, `setReloadKey` is
   called only by `retryFrame`, and the entry effect's deps are
   `[gameId, frameLoaded, reloadKey]` — `socialOpen` is deliberately absent.

PR #35 already contains `scripts/daily-product-report.mjs`,
`.github/workflows/daily-product-report.yml`, `lib/flagship-roster.ts` and
`scripts/flagship-play-probe.mjs`. This track must not build a competing
daily report or flagship roster; extend those once #35 lands.

## Open, not resolved

| Item | State |
|---|---|
| Physical-phone acceptance of the Flappy fix | Not done. Emulation only. |
| Hosted Preview for #36 | Done — `e340687`, 10/10 (see above). |
| Emitted `game_start` observed on the wire | Not possible in this sandbox; `game:play` used as the labelled proxy. |
| Escape Road availability decision | Change prepared and documented above; awaiting approval, not applied. |
| Immutable per-deployment Preview hostname | Not resolvable from GitHub status or HTTP response headers; needs the Vercel dashboard or API. Branch alias used instead. |
| First-pipe fairness by viewport | Not established. A crude autopilot died at score 0 on all four profiles, which is evidence about the autopilot, not the layout. |
| `game:getready` fires twice on the inspected build | Observed, harmless (no `game:play` results). Cause not traced. |
| Flagship entry audit | First pass done — see below. |
| Entry gates on other titles | Unknown. `lib/game-entry.ts` takes one entry per game, each naming its exact gate; none added beyond Flappy. |

## Flagship entry audit — capability levels

iPhone 13 profile, production, 2026-09-21. The four levels are kept separate
because they are different claims. Animation or a screenshot difference is
evidence of **response**, never of gameplay.

| Title | Shell/menu visible | Ordinary input accepted | Actual gameplay reached | Verified analytics available |
|---|---|---|---|---|
| `kart-bros` | yes | yes | **not established** | no adapter |
| `clelytraflight` | yes | yes | **not established** | no adapter |
| `karate-bros` | yes | yes | **not established** | no adapter |
| `nightclub-showdown-inzone-production` | yes | yes | **not established by this probe** | **yes — adapter exists** |
| `clescaperoad` | shell only | no | no | no adapter |

**Correction:** an earlier version of this table said "none of these has an
adapter". That was wrong. `lib/game-adapters.ts` carries an adapter for
`nightclub-showdown-inzone-production`, reading the v2 engine's `heroHistory`
of non-`None` `executeAction` calls; PR #32 refined its start and activity
semantics. Verified analytics **are** available for Nightclub. What this
probe did not do is drive Nightclub to a confirmed round, so "actual gameplay
reached" stays unestablished *by this probe* — which is a limit of the probe,
not a finding about the game.

`karate-bros`: a first run showed `upstream request failed`; six direct
fetches of the shell returned `200 text/html` (one sandbox timeout). Treated
as transient sandbox behaviour, **not** a production defect.

### Escape Road — reconciled

**Narrow, proven finding:** the two shells that were tested reference loader
dependencies that return 404, and neither reached gameplay. No bucket
inventory was performed, so nothing here says what else is or is not present
in the bucket, nor that these are "HTML-only uploads" — an earlier draft of
this file said that and overstated the evidence.

Established by direct fetch, not through a browser or the agent proxy.

| Path | Result |
|---|---|
| `/gcs/games/clescaperoad/v1/index.html` | `200 text/html`, 16,367 B, sha256 `32793a67…` |
| `/gcs/games/clescaperoad/v1/rocket-loader.min.js` | **404** (3/3) |
| `/gcs/games/clescaperoadcity2/v1/index.html` | `200`, 10,569 B |
| `/gcs/games/clescaperoadcity2/v1/Build/escape-road-city-2-v25022604.loader.js` | **404** (3/3) |
| `/gcs/games/clescaperoadcity2/v1/gmsoftsdk_v5.js` | **404** (3/3) |

**I was wrong to call `clescaperoad` "bootstrap commented out".** The page was
captured from a Cloudflare origin with **Rocket Loader** enabled: every script
is rewritten to `type="57480f3f31f76c75506c83a0-text/javascript"` and a
relative `<script src="rocket-loader.min.js">` is injected. That file is served
by Cloudflare's edge, never from the site path, so it was not captured in the
upload and now 404s — leaving all five scripts inert. That is dynamic
bootstrapping I did not check before concluding. It is also not the only
fault: the shell has no `createUnityInstance`, `.loader.js` or `buildUrl`
reference anywhere outside an HTML comment, so restoring Rocket Loader alone
would not start it.

`clescaperoadcity2` **does** carry a real Unity bootstrap (6 references,
scripts not Rocket-rewritten, `Build/escape-road-city-2-v25022604.loader.js`
present in the DOM) — but that loader and its SDK both 404, so it makes zero
`.unityweb` / `.wasm` requests and never starts either.

I did not find a working authorized Escape Road build. Earlier notes recorded
actual driving for this title; I could not reproduce it and could not locate
the build that produced it. That record needs its source and date checked
before it is relied on. This is an absence of evidence from two tested
shells, not proof that no working build exists anywhere.

### Prepared availability change — NOT APPLIED

Needs approval. No production catalogue data has been changed, no GCS asset
overwritten, and no substitute game proposed.

**Current state, read from production on 2026-09-21:** both ids appear in the
`/games` listing (101 cards). That listing is
`where('status', '==', 'approved')` (`lib/games.ts:80`), so both documents
currently have `status: "approved"`.

**Smallest reversible change** — one field on each of two `html_games`
documents:

| Document | Field | From | To |
|---|---|---|---|
| `html_games/clescaperoad` | `status` | `"approved"` | `"hidden"` |
| `html_games/clescaperoadcity2` | `status` | `"approved"` | `"hidden"` |

**Why this is the smallest change that works.** `fetchApprovedGames` filters
on `status == 'approved'`, so the titles leave the catalogue and any
flagship row built from it. `fetchGameById` (`lib/games.ts:131-139`) reads the
document directly and **does not filter on status**, so an existing direct
link still resolves and still gets the host's recovery UI rather than a dead
end. The records are retained in full; only one field moves.

**Rollback:** set `status` back to `"approved"` on both documents. No other
field is touched, so there is nothing else to restore.

**Coordination:** this evidence is here so Cursor can drop these two titles
from PR #35's flagship recommendations. Cursor's branch is not edited by this
track.

Screenshots for each title: `scripts/.hexclave-out/flagship/` (git-ignored).

## Rules this track works under

Base every production fix on current `main`. No companion work, no visual
redesign, no ads, billing, Firestore rules, auth or third-party monetisation
changes. Do not open documentation-only PRs to restate blockers.
