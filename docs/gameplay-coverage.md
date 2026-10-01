# Gameplay coverage — Phase 0 (Escape Road, Elytra Flight)

Date: 2026-09-26. Scope: web product only, two campaign games first.

## Feasibility verdict

**No legitimate, reliable signal for actual play exists for either build.**
Both stay on proxy events, explicitly labelled. This is a documented
limitation, not a gap to fill with a weaker signal.

## What was inspected

| Game | Entry HTML (inzone-html bucket) | Engine | Payload origin |
|---|---|---|---|
| Escape Road (`clescaperoad`) | `games/clescaperoad/v1/index.html` | Unity WebGL | `cdn.jsdelivr.net/gh/abisdbest/…` ("Ultimate Game Stash" file) |
| Elytra Flight (`clelytraflight`) | `games/clelytraflight/v1/index.html` | Unity WebGL | `cdn.jsdelivr.net/gh/familiapablo/lopx@main/Build` |

Both pages call `createUnityInstance(canvas, config)` and keep the instance in
a closure-local `let myGameInstance` — never on `window`.

## Why no verified signal is obtainable

1. **Unity's host API is one-directional.** `unityInstance.SendMessage()` goes
   host → game. There is no supported API to read engine state, run ids, or
   player actions from the host.
2. **The builds cannot be modified to add a bridge.** The Unity payload is
   third-party content mirrored on a CDN, not our source. Re-uploading a
   patched copy would fork us from the upstream mirror with no update path.
3. **Same-origin DOM observation was considered and rejected.** Both builds
   are served through our same-origin `/gcs` proxy, so the host *can* read the
   frame's document — but the only host-visible signals would be input events
   (taps/keys), focus, elapsed time, or canvas pixels. None is a verified
   gameplay action: an input event cannot distinguish a menu tap from a move,
   and canvas motion cannot distinguish an attract loop from a player. Policy
   forbids labelling any of them as play.

## What we report instead (explicitly weaker, never gameplay)

- `game_open` — our page rendered for the game.
- `game_frame_loaded` — the bundle's `load` fired (a PROXY; counts downloads).
- Every gameplay event now carries `measurement_coverage: proxy-only` for
  these games, and `signal_source` names how the row was produced.

Zero `game_start` rows for these games means **"unmeasurable"**, never
"no play". Any report, dashboard, or ad-platform audience that treats it as
measured zero play is misreading the data.

## What would change the classification

- The build reports through the InZone postMessage bridge (verified events
  carry `signal_source: postmessage-bridge`), or
- a same-origin build whose engine exposes readable state the way Flappy v9
  and Nightclub Showdown do (then it gets an adapter in
  `lib/game-adapters.ts` and coverage flips to `verified`).

## Definitions used by this phase

- **Meaningful play** — a `game_start`: the first gameplay action of a run
  that the build itself reports as player-caused. Never an iframe load, focus,
  elapsed time, tap, or pixel change.
- **Return** — a verified `game_start` on the immediately following local
  calendar day after verified gameplay was recorded for the browser
  (`return_play`, at most one per day). Requires meaningful play; a later page
  load alone is not a return.
- **Cost per verified meaningful player** — acquisition diagnostic: spend
  divided by browsers with ≥1 verified `game_start`. Only computable for
  `verified`-coverage games. Not a scale signal on its own.

## QA-filtering status of every percentage in this phase

New code emits no new events — it adds one property (`measurement_coverage`)
to existing emissions. All guarantees ride the existing paths:

- **Duplicates:** verified events dedupe on `run_id` scoped per mount; a
  repeated callback or re-read of the same run cannot re-emit.
- **Reloads:** engagement persists per visit in `sessionStorage`; a refresh
  resumes the count. `mountId` scopes run ids so a late signal from a
  previous mount is ignored.
- **Retries:** the frame-load proxy dedupes per `(gameId, reloadKey)`.
- **QA traffic:** every event carries `app_env` + `traffic_kind`
  (`?inzone_qa=` marker, sessionStorage-persisted). Verified events reach ad
  platforms only on production hostnames with unmarked traffic. Reports
  exclude non-customer rows (production host, unmarked, not a documented
  historical QA id).

## Remaining evidence gaps

1. Per-creative verified start rate is still Flappy/Nightclub-only; the two
   campaign games cannot contribute until their builds change.
2. `visitor_id` is a browser-profile id (localStorage), not a person; it does
   not survive cleared site data or cross devices.
3. `return_play` fires only on the *immediately following* local day — a
   player returning after 3 days is not counted as a return under the current
   definition.
