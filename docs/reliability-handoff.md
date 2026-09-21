# Production reliability handoff

Owner of this file: the production-reliability track (Claude Code). Companion
and visual revamp live in PR #35 (Cursor) and are deliberately out of scope
here. Update this file in the same PR as the change it describes.

_Last updated: 2026-09-21 (hosted verification complete)._

## Branches and SHAs

| Thing | Value |
|---|---|
| Production branch | `main` @ `2ceba36` (merge of PR #32) |
| This track's branch | `claude/busy-cerf-19mfrm` @ `e340687` |
| This track's PR | [#36](https://github.com/inzonesm/inzone-games/pull/36) — draft, based on current `main` |
| Companion track | [#35](https://github.com/inzonesm/inzone-games/pull/35) — draft, head `cc7c61d`, 45 files |

Nothing from this track is merged or deployed. `main` deploys to Production
automatically on merge, so merge is an owner decision.

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
| Retry control | n/a — frame healthy, control not shown |

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
| Escape Road availability decision | Awaiting approval. |
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

Both catalogue entries are **HTML-only uploads**: the shell reached the
bucket, the build assets it references did not. Established by direct fetch,
not through a browser or the agent proxy.

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

**No known working authorized Escape Road build was found in the catalogue.**
Earlier notes recorded actual driving for this title; I could not reproduce it
and could not locate the build that produced it. That record needs its source
and date checked before it is relied on.

**Recommended action — needs approval, not taken.** The smallest reversible
change is availability-level, not asset-level: hide or unpublish the two
Escape Road entries until a build that actually reaches gameplay is uploaded.
That is production catalogue data, so it is not changed here. No GCS asset was
overwritten and no substitute game was proposed. If PR #35's flagship
selection includes Escape Road, it should drop it until this is resolved.

Screenshots for each title: `scripts/.hexclave-out/flagship/` (git-ignored).

## Rules this track works under

Base every production fix on current `main`. No companion work, no visual
redesign, no ads, billing, Firestore rules, auth or third-party monetisation
changes. Do not open documentation-only PRs to restate blockers.
