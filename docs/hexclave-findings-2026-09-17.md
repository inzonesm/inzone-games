# Hexclave findings — 2026-09-17 (rev. 2)

Sanitized report of the read-only investigation completed on 2026-09-17
against the production InZone Hexclave project (the UUID stored as
`HEXCLAVE_PROJECT_ID` in Vercel + GitHub Actions secrets) and the production
website (`https://www.inzone.games`). No raw recordings, no personal data,
no chat text, no session ids, no refresh tokens, no invite URLs are included
here. The reusable scripts under `scripts/` reproduce every number below.

**Revision note (rev. 2).** The first cut of this document (a) inferred
internal traffic from IP geolocation and campaign-event volume, (b) reported
country distribution as if it explained something, (c) called a Vercel edge
outcome a "cold-miss race" without proving it, and (d) claimed zero
external engagement based on those inferences. All four are corrected below.

## What was pulled

| Kind | Volume | Window | Script |
| --- | --- | --- | --- |
| Session replays (metadata) | 100 most recent | 2026-09-11 → 2026-09-16 UTC | `scripts/hexclave-inspect.mjs` |
| Session replays (full rrweb events) | 12 stratified + click-heavy | same | same |
| Analytics rows (events table) | 730 `$page-view` · 239 `$click` · 212 `$token-refresh` in 30 days | 2026-08-18 → 2026-09-17 UTC | `scripts/hexclave-analytics-query.mjs` |
| Reproduced journeys | 6 journeys, ~30 screenshots | 2026-09-17 | `scripts/hexclave-journey-record.mjs` |

## Internal-user separation, revised

Only one hard tester marker exists in the 30-day event stream:
`utm_source=qa` **and** `utm_medium=verification` **and**
`utm_campaign=post_deploy_check`. It appears on 60 events across three
distinct `user_id`s:

- `26f301c1-7c87-4c8f-96bf-7e0db6cb0790`
- `390c4c19-0b07-4076-bf4f-1087e8e834cb`
- `97e02cfd-dff9-4ce1-b93e-a34f4a6bb842`

These three are the only users excluded from every "external" number below.
Everyone else is treated as an external visitor even when the earlier
report flagged them by heavy activity or SF-based IP — those are
correlations, not confirmation.

Geography is reported descriptively (`hexclave-analytics-query.mjs country`).
It is not evidence about who Meta targeted or who arrived by intent; the
campaign's targeting parameters are outside this project's access. Any
argument that the audience is or isn't the intended cohort belongs against
the Meta Ads Manager configuration, not against these numbers.

## Ordered, deduplicated funnel — external cohort, 30 days

Each user is counted at most once at each step. Steps are named for the
event that reached them, not for a marketing model:

| Step | Users | Signal source |
| --- | --- | --- |
| campaign_arrival | 61 | UTM captured by `captureCampaignArrival` |
| game_open | 86 | Page mount of `/games/[id]` (host-page proxy) |
| game_frame_loaded | 38 | Iframe's `load` fired (host-page proxy) |
| game_ready | 5 | Build reported itself initialised (proxy) |
| **game_start** | **36** | Build's own first-play signal (VERIFIED) |
| **engaged_play** | **1** | 60 s of active foreground gameplay (VERIFIED) |
| **first_game_over** | **4** | Build's own end-of-run signal (VERIFIED) |
| **return_play** | **0** | Verified `game_start` on the immediately following calendar day (VERIFIED) |
| invite_copied | 10 | Clipboard write resolved |
| invite_joined | 10 | Invite URL visited |

`game_opens` exceeds `arrivals` because some visitors reach `/games/[id]`
without a captured UTM (direct link, share, invite, reload). `game_open`
users are the cohort eligible for the verified events; the earlier report's
`arrivals → game_start` ratio was a category error.

`engaged_play = 1` is not zero. The previous cut of this doc claimed it was
zero after excluding heavy anonymous users; that exclusion was not
principled and is dropped.

## Per-game breakdown — external cohort, 30 days

For each game_id observed as a `game_open` target, with the verified-signal
counts for the same cohort:

| game_id | opens_u | starts_u | engaged_u | first_over_u | Instrumentation |
| --- | ---:| ---:| ---:| ---:| --- |
| flappybird-inzone-2 | 42 | 11 | 0 | 3 | Adapter (`lib/flappy-gameplay-adapter.ts`) — start is first-flap |
| nightclub-showdown-inzone-production | 24 | 24 | 1 | 1 | Adapter (`lib/game-adapters.ts::nightclub`) — start on run id change |
| neon-blaster-inzone-production | 6 | 2 | 0 | 0 | postMessage bridge from game bundle |
| flappy-bird | 4 | 0 | 0 | 0 | No adapter observed; game_start never fires |
| 2048-inzone-upload | 4 | 2 | 0 | 0 | postMessage bridge from game bundle (present) |
| clgetontop | 1 | 1 | 0 | 0 | postMessage bridge (present) |
| clescaperoadcity2 | 1 | 1 | 0 | 0 | postMessage bridge (present) |
| nightclub-showdown-inzone-production`** | 6 | 0 | 0 | 0 | **URL-corruption bug — see §D5** |

Signal-source column names *what code path* produced the `game_start`
counter for that game. `Adapter` is the same-origin state-read described in
`lib/game-adapters.ts`. `postMessage bridge` is the alternative path in
`lib/use-gameplay-measurement.ts:249-263` which accepts a build's own
`game:start` / `game:over` message. `No adapter observed` means neither
fires — the number in `starts_u` for such a game is a measurement gap,
never evidence that visitors did or did not play.

**Reading these numbers:**

- Flappy Bird: 42 opens → 11 starts (26 % of opens). Because
  `game_start` on Flappy is the engine's first-flap, 74 % of Flappy
  visitors never flapped once. That is where the funnel narrows.
- Nightclub Showdown: 24 opens → 24 starts (100 % of opens). The
  adapter's `game_start` fires on the first run-id change, which happens
  during boot. Every visitor who opened the page produced a `game_start`;
  the interesting number for this game is `engaged_play` (1 of 24 = 4.2 %).
- The `flappy-bird` id (the flat variant) has 4 opens and 0 starts. No
  adapter is registered for that id and the bundle does not emit a
  postMessage bridge. Those 4 visitors may have played; we cannot tell.
- The `` ...production`** `` id row is the same URL corruption documented
  in §D5 — it is one Firestore document ID that Slack/WhatsApp/Meta
  formatting mangled on paste. Six visitors hit it and 0 game_starts fired
  because the id did not resolve.

## Device breakdown (from `$click`), external cohort, 30 days

`$click` events carry `viewport_width` in their payload; no other event
does. So device class is only observable for users who did a host-page
click.

| Device | Users | Clicks | Notes |
| --- | ---:| ---:| --- |
| Desktop (vw ≥ 1024) | 48 | 197 | |
| Tablet (768 ≤ vw < 1024) | 8 | 41 | |
| Mobile (vw < 768) | 1 | 1 | |

The mobile "1 user" is a real measurement gap, not an audience fact. On a
paid Meta mobile arrival, most of the visit's activity is inside the game
iframe (which is same-origin but not covered by rrweb — see §D3) — so no
host-page click ever fires. Mobile-cohort behaviour for this window is
under-observed and any claim about it based on this table is wrong.

## Daily cadence — external cohort, past 7 days

| Day | opens_u | starts_u | engaged_u | first_over_u |
| --- | ---:| ---:| ---:| ---:|
| 2026-09-11 | 20 | 20 | 0 | 0 |
| 2026-09-12 | 12 | 2 | 0 | 0 |
| 2026-09-13 | 1 | 0 | 0 | 0 |
| 2026-09-14 | 8 | 8 | 0 | 0 |
| 2026-09-15 | 7 | 3 | 1 | 1 |
| 2026-09-16 | 22 | 1 | 0 | 1 |
| 2026-09-17 | 17 | 2 | 0 | 2 |

Days with a 100 % open→start ratio (09-11 and 09-14) coincide with
Nightclub-Showdown-dominant traffic, since that adapter fires
`game_start` during boot. Days with a low ratio (09-12, 09-16) coincide
with Flappy-dominant traffic, where `game_start` requires a first-flap.
PR #24 (`85d1c0b`, "Fix Flappy Bird gameplay measurement and pixel
initialization") merged on 09-16; the ratio drop on and after that date
reflects the corrected measurement, not a real behaviour change.

## Terms deliberately not used

- "Session duration." rrweb reports `startedAt` and `lastEventAt`; the
  difference is **recorded activity duration**, not visit duration. rrweb
  goes quiet whenever the user is inside the game iframe or the tab is
  hidden; neither means the user left. `scripts/hexclave-summarise.mjs`
  reports this as `recordedActivityMs`.
- "Bounce rate."
- "Engagement" outside the `engaged_play` definition (60 s active
  foreground gameplay from a verified adapter or postMessage bridge).
- "Bot" or "click fraud." Nothing here supports either.
- "Product-market fit." One month of data is not that argument.

## Constraints worth naming

1. **Same-origin iframe, but rrweb never sees inside it.** Every
   `/games/[id]` page mounts an iframe at
   `/gcs/games/<id>/<v>/index.html`, served by a Next.js rewrite from the
   same origin. `contentDocument` is reachable; the game's `<canvas>` is
   visible to any recorder attached to the iframe. Across all 12 replays
   pulled, `canvasMutation` = 0 and `custom` = 0. rrweb is only recording
   the parent document. `AnalyticsReplayOptions` in `@hexclave/js@1.0.112`
   exposes `enabled`, `maskAllInputs`, `blockClass`, `blockSelector` and
   nothing else (verified against
   `node_modules/@hexclave/js/src/lib/hexclave-app/apps/implementations/session-replay.ts`).
   Any claim about "friction inside the game" from replays is inference
   until Hexclave adds an iframe-recording knob.

2. **iframe-container clicks look identical to a rage-click on the
   parent.** Pointer events that land on the iframe element in the
   parent's DOM are recorded as clicks at the iframe's node id.
   Confirmed in QA session `b4e944f8` (2026-09-16 00:30:45 UTC): 1,176
   "rage-triples" at a single DOM id — the iframe container — over
   3.5 minutes of Flappy Bird taps. Not frustration. Any dashboard that
   ranks rage-click hotspots without excluding the iframe container on
   `/games/[id]` routes will report gameplay taps as friction.

3. **Campaign events ride `$page-view`.**
   `lib/campaign-analytics-hexclave.ts::campaignBatchBody` rewrites every
   campaign event as a `$page-view` with a fixed path
   `/session-prototype` and the real name in `data.inzone_event`. All
   funnel queries in this report lift the real name out. Any dashboard
   that groups by `path` alone sees "/session-prototype" as the busiest
   page — it is a sink, not a route.

## Journeys reproduced on 2026-09-17

Every finding here has a screenshot under
`scripts/.hexclave-out/journeys/` (gitignored) that reproduces the state
live against production. The reproduction script is committed.

### paid-flappy-mobile

Meta paid arrival, iPhone 390×844,
`utm_source=meta&utm_campaign=solo_social_01`. In the ~1 s before the
Firestore doc returns, the visitor sees:

- Boot screen with a fallback image tile (`.game-boot-art-fallback`) and
  the literal name `Loading game`.
- `Chat` pill top-left, a "Play with a friend" primary button
  bottom-left, an `Invite` outline button bottom-right, and a rail with
  `Replay`, `Home`, `0` likes, `0` chat, `Share`, `App`, and up/down
  chevrons.

After Firestore returns, the boot art becomes the poster from
firebasestorage.googleapis.com and the title becomes the stored
`game.name`. For `flappybird-inzone-2` that stored value is
`Flappybird Inzone 2`.

### catalog-mobile

`/games` on iPhone. Above the fold, an `Install App` banner takes about
25 % of viewport height. Each game card carries a live "PLAYING" pill in
the top-left showing four-figure counts: 4,285 · 8,065 · 4,696 · 5,339 ·
2,899 · 9,546. These are synthetic — `lib/games.ts::inflatedPlayerCount`
returns a deterministic 999–9,999 for any game whose `uploaderId ===
INFLATED_PLAYER_UPLOADER_ID` (see §D-Product-1). The whole hub logged
730 real `$page-view` events across 121 users in 30 days; four-figure
concurrent-play counts are not observable.

### neon-blaster-desktop

`/games/neon-blaster-inzone-production`, 1280×800. Sometimes the game
bundle self-reports "Neon Blaster couldn't start" and offers a `Retry`
button. On this attempt, the console reports:

- `Refused to execute script from '…/v3/game/runtime/bb.js' because its
  MIME type ('text/plain') is not executable`
- One 502 Bad Gateway on a subresource.

A direct `curl` of the same URL later returns `application/javascript`
200 with `x-vercel-cache: MISS` on the first hit. **Not** proven to be
an edge-race — see §D4 for the investigation.

### rotate-flappy, back-nav-desktop, invite-prototype

No visible regression observed on rotation, back-nav, or direct
`/session-prototype`. Deeper interactions in those flows were not
exercised in this session.

## Confirmed defects, ranked (with reproduction evidence)

### D1. Game-player first-second shows a fallback icon and no title

`app/games/[id]/page.tsx` client-fetches the Firestore doc after mount.
Until it resolves, `.game-boot-art` renders `.game-boot-art-fallback`
and `.game-boot-name` reads `Loading game`. Reproduced live in
`paid-flappy-mobile/02-t1s.png`. Every load.

**Fix in flight:** `claude/fix-game-display-name` @ `390fc6e` — a
synchronous `fallbackGameName(id, storedName)` helper that keeps the
stored value verbatim once Firestore returns (respecting
`lib/session-prototype.ts::displayGameName`) and falls back to an
id-derived title before then. Preview verified.

### D2. Session-mode chrome is on solo arrivals

`Chat`, `Play with a friend`, `Invite`, and the entire share/app/likes
rail show on `/games/[id]` at t=0 for a paid arrival that has no
session, no invitee, no message to read, and no game_start yet. See §17.

### D3. rrweb does not record inside the same-origin game iframe

Not fixable from this repo. Escalate to Hexclave (team@hexclave.com or
Discord) — the SDK does not currently expose an iframe or canvas
recording option.

### D4. Neon Blaster script served as `text/plain` on the first request

Observed in a Playwright load through the outbound proxy: `bb.js` was
refused with a `text/plain` MIME error, plus a 502 on a subresource.
A subsequent `curl` returned `application/javascript`. Under
investigation on `claude/investigate-neon-blaster` — see §19. **Not**
called a cold-miss race here; that was speculation.

### D5. URL corruption bleed: `` `** `` on a game route

Six unique users in 30 days hit `.../nightclub-showdown-inzone-production%60**`.
Markdown formatting on paste (Slack/WhatsApp/Meta) bleeds a backtick +
asterisks into the URL. Route decoded verbatim and 404'd.

**Fix in flight:** `claude/fix-game-display-name` @ `390fc6e` —
`normalizeGameIdFromRoute` trims trailing markdown/URL-encoded
punctuation.

## Material product decisions (all authorized on 2026-09-17)

### D-Product-1. Fabricated `PLAYING` counts

`lib/games.ts::inflatedPlayerCount` returns 999–9,999 for any game
whose uploaderId matches `INFLATED_PLAYER_UPLOADER_ID`. Contradicts the
CLAUDE.md contract's "smaller honest number rather than fabricate one."
Being removed from the website on `claude/remove-inflated-player-count`.
Flutter has the mirrored code; a separate issue tracks that.

### D-Product-2. Install-App banner on the catalog

`/games` shows a "Get the InZone App" banner across the top. Being
removed from the initial playing journey on
`claude/no-install-banner-initial-journey`; a user-initiated install
path stays in the rail/footer.

### D-Product-3. Session-mode chrome on solo arrivals

Being addressed on `claude/play-first-solo-arrival`: one Invite CTA,
accessible chat, no duplicate invite prompt. Existing join, chat,
independent switching, refresh restoration, and leave behavior
preserved. Host-panel toggles do not remount the game.

## Reproducing this report

```bash
# 1. Auth once (device-code, opens a browser URL you click):
npx --yes @hexclave/cli@latest login

# 2. Sanity check:
npx --yes @hexclave/cli@latest whoami
npx --yes @hexclave/cli@latest project list

# 3. Pull replays into scripts/.hexclave-out/ (gitignored):
export HEXCLAVE_PROJECT_ID=<inzone-cloud-project-uuid>
node scripts/hexclave-inspect.mjs --list-limit 100 --sample-size 8

# 4. Analytics queries (each returns JSON on stdout):
node scripts/hexclave-analytics-query.mjs funnel 7

# 5. Reproduce production journeys:
node scripts/hexclave-journey-record.mjs paid-flappy-mobile catalog-mobile

# 6. Summarise the pulled replays:
node scripts/hexclave-summarise.mjs
```
