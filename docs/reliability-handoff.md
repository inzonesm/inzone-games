# Production reliability handoff

Owner of this file: the production-reliability track (Claude Code). Companion
and visual revamp live in PR #35 (Cursor) and are deliberately out of scope
here. Update this file in the same PR as the change it describes.

_Last updated: 2026-09-21._

## Branches and SHAs

| Thing | Value |
|---|---|
| Production branch | `main` @ `2ceba36` (merge of PR #32) |
| This track's branch | `claude/busy-cerf-19mfrm` @ `ac93ee8` |
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
| Hosted Preview for #36 | Not confirmed in this session. |
| First-pipe fairness by viewport | Not established. A crude autopilot died at score 0 on all four profiles, which is evidence about the autopilot, not the layout. |
| `game:getready` fires twice on the inspected build | Observed, harmless (no `game:play` results). Cause not traced. |
| Flagship entry audit | First pass done — see below. |
| Entry gates on other titles | Unknown. `lib/game-entry.ts` takes one entry per game, each naming its exact gate; none added beyond Flappy. |

## Flagship entry audit — first pass

iPhone 13 profile, production, 2026-09-21. "Screen changed after ordinary
input" is a host-level screenshot comparison (tap centre, then Space / Arrow
keys). It is evidence of response, **not** verified gameplay — none of these
titles has an adapter, so no verified `game_start` exists for any of them.
Absence of instrumentation is not absence of play.

| Title | Frame | Ready | Engine | Idle animating | Responds to ordinary input | Verdict |
|---|---:|---:|---|---|---|---|
| `kart-bros` | 2.9 s | 3.8 s | canvas | yes | yes | Entry OK |
| `clelytraflight` | 2.9 s | 3.1 s | canvas | yes | yes | Entry OK |
| `nightclub-showdown-inzone-production` | 2.6 s | 2.7 s | canvas | yes | yes | Entry OK; shows `Mute` / `Restart` |
| `karate-bros` | 2.9 s | 7.7 s | — | yes | yes | Entry OK. A first run showed `upstream request failed`; six direct fetches of the shell returned `200 text/html` (one sandbox timeout). Transient, **not** confirmed production. |
| `clescaperoad` | 2.5 s | — | Unity WebGL | no | no | **Broken build.** |

### `clescaperoad` — confirmed defect, outside this repo

The shell at `/gcs/games/clescaperoad/v1/index.html` serves `200 text/html`
consistently (6/6 direct fetches, 16,367 bytes). But:

- `createUnityInstance` is `undefined` after 62 s; `unityInstance` never
  appears.
- `#unity-canvas` stays at the browser default `300x150` — Unity never
  sizes it.
- **Zero** requests for `*.unityweb`, `*.wasm` or `*.data` are ever made.
- The shell contains no `.loader.js` script tag and no `buildUrl`
  definition. The only Unity bootstrap present is **inside an HTML
  comment**: `<!-- /0a502697….data.unityweb", frameworkUrl: … -->`.
- `#loading-cover` is `display:none`, so nothing indicates loading.

The uploaded build is broken at source — its bootstrap was commented out or
mangled. No web-app change can start it; it needs re-uploading to GCS. The
host's recovery control (`[data-testid=game-retry]`) does appear, so the
player is not stranded without an exit.

Screenshots for each title: `scripts/.hexclave-out/flagship/` (git-ignored).

## Rules this track works under

Base every production fix on current `main`. No companion work, no visual
redesign, no ads, billing, Firestore rules, auth or third-party monetisation
changes. Do not open documentation-only PRs to restate blockers.
