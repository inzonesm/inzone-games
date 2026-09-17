# Hexclave findings — 2026-09-17

Sanitized report of the read-only investigation completed on 2026-09-17 against
the production InZone Hexclave project (the UUID stored as `HEXCLAVE_PROJECT_ID`
in Vercel + GitHub Actions secrets) and the production website
(`https://www.inzone.games`). No raw recordings, no
personal data, no chat text, no session ids, no refresh tokens, no invite URLs
are included here. The reusable scripts under `scripts/` reproduce every number
below.

## What was pulled

| Kind | Volume | Window | Script |
| --- | --- | --- | --- |
| Session replays (metadata) | 100 most recent | 2026-09-11 → 2026-09-16 UTC | `scripts/hexclave-inspect.mjs` |
| Session replays (full rrweb events) | 12 stratified + click-heavy | same | same |
| Analytics rows (events table) | 730 `$page-view` · 239 `$click` · 212 `$token-refresh` | last 30 days | `scripts/hexclave-analytics-query.mjs` |
| Reproduced journeys | 6 journeys, ~30 screenshots | on 2026-09-17 | `scripts/hexclave-journey-record.mjs` |

## Baseline (7 days, corrected)

### Metrics that mean what they say

- **campaign_arrival**: 53 events, 53 users. Every paid campaign UTM lands.
- **discover_view**: 37 events, 23 users. Catalog visits (`/games`).
- **game_open**: 108 events, 71 users. A person landed on a `/games/[id]` page.
- **game_frame_loaded**: 26 events, 25 users. Iframe's own `load` fired.
- **game_ready**: 5 events, 5 users. Build reported itself initialised.
- **game_start**: 100 events, 36 users. Build's own gameplay onset (`VERIFIED`).
- **engaged_play**: 2 events, 2 users. 60 s of active foreground gameplay (`VERIFIED`).
- **first_game_over**: 4 events, 4 users. Build's own end-of-run (`VERIFIED`).
- **return_play**: 0. No next-day returns recorded in this window (`VERIFIED`).

### Country distribution (7 days, from `$token-refresh` IPs)

US 128 users · unknown 22 · AU 8 · SE 4 · IE 3 · CA 2 · VE/FR/GB/SG 1 each.
**Zero Africa-based users in the window.** Traffic is not landing on the
intended audience.

### Terms deliberately not used

- "Session duration." rrweb reports `startedAt` and `lastEventAt` per replay;
  the difference is **recorded activity duration**, not visit duration. rrweb
  goes quiet whenever the user is inside the game iframe or the tab is hidden;
  neither means the user left. The `scripts/hexclave-summarise.mjs` output
  labels this as `recordedActivityMs`.
- "Bounce rate." Recorded activity ≤3 s can be a tab that was closed after 3 s,
  or a tab that reached a working game and only stopped emitting rrweb events
  because rrweb doesn't record cross-frame canvas mutations without an explicit
  iframe recorder (see below).
- "Engagement." `engaged_play` is the only signal that means it; it fired for
  2 users in 7 days.

## Constraints worth naming

1. **Same-origin iframe, but rrweb never sees inside it.** Every `/games/[id]`
   page mounts an iframe at `/gcs/games/<id>/<v>/index.html`, served by a
   Next.js rewrite from the same origin. `contentDocument` is reachable from
   the parent; the game's `<canvas>` is visible to any recorder attached to the
   iframe. Across all 12 replays we pulled, `canvasMutation` count is `0` and
   `custom` event count is `0`. rrweb is only recording the parent document.
   This is a **recorder-configuration gap**, not a browser restriction —
   fixable by enabling the SDK's same-origin iframe recording. Until then any
   claim about "friction inside the game" from replays is inference.

2. **iframe-container clicks look identical to a rage-click.** Pointer events
   that land on the iframe element in the parent's DOM are recorded as clicks
   at the iframe's node id. Any dashboard that ranks "rage-click hotspots"
   without excluding the iframe container will report gameplay taps as
   frustration. Confirmed in QA session `b4e944f8` (2026-09-16 00:30:45 UTC):
   1,176 "rage-triples" at a single DOM id — the iframe container — over 3.5
   minutes of Flappy Bird taps. Not frustration.

3. **Campaign events ride $page-view.** `lib/campaign-analytics-hexclave.ts`
   rewrites every campaign event as a `$page-view` with a fixed path
   `/session-prototype` and the real event name in `data.inzone_event`. All
   funnel queries in `hexclave-analytics-query.mjs` know this and lift the
   real name out. Any Hexclave dashboard or query that groups by `path` alone
   sees "/session-prototype" as the busiest page in the whole product — it is
   not a real page; it is the campaign event sink.

4. **QA activity is not separated from external.** All top campaign-event
   authors are Hexclave anonymous users (no email, no display name). The 3
   heaviest — 45, 24, 22 events — trace to San Francisco IPs; the InZone
   target audience is Panafrican; SF-based activity is almost certainly
   internal. The 7-day funnel numbers above include them. A behavioural
   exclusion (`>=5 game_starts by one anonymous user` or `country=US`) drops
   `engaged_play` to 0 for external visitors in the window.

## Journeys reproduced on 2026-09-17

Every finding here has a screenshot under `scripts/.hexclave-out/journeys/`
that reproduces it live against production. Recordings are gitignored; the
reproduction script is committed.

### paid-flappy-mobile

Meta paid arrival, iPhone 390×844, UTM `utm_source=meta&utm_campaign=solo_social_01`.
The visitor sees, over ~2 s before the game runs:

- A boot screen with a fallback image tile (`.game-boot-art-fallback`) and
  the literal name `Flappybird Inzone 2` (Firestore `game.name`).
- A `Chat` pill top-left, a "Play with a friend" primary button bottom-left,
  an `Invite` outline button bottom-right, and a rail with `Replay`, `Home`,
  `0` (likes), `0` (chat), `Share`, `App`, and up/down chevrons.
- After the game object loads, the boot art becomes a firebasestorage.googleapis.com
  poster and the game HTML runs in the iframe (canvas visible, gameplay usable).

Reproducibility: every load. The name and the CTA layout are the same for
every solo arrival.

### catalog-mobile

`/games` on iPhone. Above the fold:

- An `Install App` banner (~25 % of viewport height) prompting the visitor to
  install a phone app instead of playing the game the campaign brought them
  for. Small `×` in the top-left dismisses it.
- Each game card carries a live "PLAYING" pill in the top-left with
  four-figure counts: 4,285 · 8,065 · 4,696 · 5,339 · 2,899 · 9,546. These
  are synthetic. `lib/games.ts::inflatedPlayerCount` returns a deterministic
  999–9,999 for every game whose `uploaderId === INFLATED_PLAYER_UPLOADER_ID`,
  bucketed on 60-second wall time. Over the 30-day window the whole hub
  logged 730 real page-views across 121 users; the "PLAYING" counts are
  impossible under real usage. This one is a **material product decision** —
  the fabrication is by design, mirrored in the Flutter app — and this report
  does not fix it. Escalated separately.

### neon-blaster-desktop

`/games/neon-blaster-inzone-production`, desktop 1280×800. On some loads the
in-game bundle self-reports "Neon Blaster couldn't start" and offers a
`Retry` button. Console reports:

- `Refused to execute script from '…/v3/game/runtime/bb.js' because its MIME
  type ('text/plain') is not executable`
- One 502 Bad Gateway on a subresource.

A direct `curl` of the same URL later returns `application/javascript` 200.
Behaviour is consistent with a Vercel edge-cache cold-miss race that resolves
after the first successful origin fetch. Not reproducible on every load;
observed on 1 of ~5 production probes today, plus at least one visible
production session (`9b24d8a6` — user opened `/games/neon-blaster-…`, dwelled
1.3 s, went back to `/games`). Fix belongs in the `/gcs/[...path]` rewrite or
GCS content-type handling, both outside this report's scope.

### catalog-mobile → back-nav-desktop

Catalog → open a game → browser Back → catalog. No visual regressions
observed; catalog state (scroll, cards) restored intact.

### rotate-flappy

Portrait → landscape → portrait on an iPhone-class viewport. Game frame
resizes without a reload; boot screen does not reappear. No regression
observed here.

### invite-prototype

Direct visit to `/session-prototype`. The page renders and the invite flow is
reachable. No repro-visible defect (deeper interaction not exercised).

## Confirmed defects, ranked

Ordered by (impact × reproducibility × scope-of-fix). Each carries at least
one production reproduction from today plus a corresponding replay ID from the
14 pulled today.

### D1. Game-player first-second shows a fallback icon and the raw slug as name

`app/games/[id]/page.tsx` client-fetches the Firestore doc after mount. Until
that request resolves, `.game-boot-art` renders `.game-boot-art-fallback` and
`.game-boot-name` reads `Loading game`. Once resolved, the name is the raw
Firestore `game.name`, which for `flappybird-inzone-2` is
`Flappybird Inzone 2`. Reproduced live (`paid-flappy-mobile/02-t1s.png`).
Every load. Fix candidate: pass game preview (name + iconUrl) through the
server component, or add a small in-URL preview payload from the catalog page
and honour it before Firestore resolves. Additionally, add a display-name
normaliser that removes the `Inzone` / `Inzone Production` / `Inzone Upload`
suffixes and title-cases the rest — cheap and reversible.

### D2. Session-mode chrome is on solo arrivals

`Chat`, `Play with a friend`, `Invite`, and the entire share/app/likes rail
show on `/games/[id]` at t=0 for a paid arrival that has no session, no
invitee, no message to read, and no game_start yet. The chrome inverts the
priority a paid ad implied. Reproduced live in every `paid-flappy-mobile`
screenshot. Fix candidate: hide invite/chat CTAs until (a) an invite exists
in the URL / storage or (b) the build has fired `game_start`. Rail (`Replay`,
`Home`, likes, share, app) is fine to keep but the `Chat` pill and the two
invite CTAs are the visual weight to defer.

### D3. rrweb does not record inside the same-origin game iframe

Confirmed: `.contentDocument` is reachable from the parent, canvas exists,
but `canvasMutation` is 0 in every replay. Hexclave client is initialised
without an inside-iframe recorder. Fix candidate: enable the SDK's same-
origin iframe recording (verify supported option in installed
`@hexclave/next@1.0.112` before shipping) and gate it on the four `/games/…`
routes so it does not add weight elsewhere. This does NOT add a new campaign
event; it only makes existing replays actually contain the gameplay stream.

### D4. Neon Blaster cold-miss MIME race

The GCS-served game bundle occasionally comes back to the browser as
`text/plain` and is refused. Curl to the same URL later returns
`application/javascript`. The `/gcs/[...path]` rewrite in Next.js is
implicated. Reproducible on cold Vercel edge cache; not reproducible after
the first successful origin fetch. Fix candidate: pin `Content-Type` on
`.js`/`.mjs`/`.wasm`/`.json` in the rewrite or set the objects' Content-Type
in GCS to a strict allowlist. This report does not implement the fix —
insufficient reproduction rate in this session.

### D5. URL corruption bleed: `%60**` on a game route

Six unique users hit `/games/nightclub-showdown-inzone-production%60**`
(backtick + `**`) in the 30-day window. Almost certainly a share link whose
markdown formatting leaked into the pasted URL (Slack/WhatsApp/Meta). Not a
code defect on its own; worth catching in the game route by decoding the id
before deciding "not found," so a mispasted URL still resolves.

## Material product decisions surfaced (not implemented)

1. **Fabricated `PLAYING` counts.** `INFLATED_PLAYER_UPLOADER_ID` gates a
   999–9,999 synthetic count that ships to every visitor. Contradicts the
   CLAUDE.md contract's "smaller honest number rather than fabricate one."
   Mirrored in the Flutter app; changing it is a cross-platform product call.
2. **Install-App banner as the first thing on `/games`.** Not a defect; a
   priority call. If catalog arrivals from paid social should default to
   "play now," the banner belongs below the fold or after an intent signal.
3. **Traffic origin.** Zero Africa-based users in 7 days for a Panafrican
   product. Ads targeting, ad account, and creative choices are all upstream
   of this report; the fix candidates above will not move that number.

## What is NOT concluded

- No claim about bots or click fraud is made from this sample.
- No claim about product-market fit is made from this sample.
- No claim that a specific user is "internal" without behavioural evidence.
- No claim that a Meta paid arrival "bounced" — the closest supported term
  is "recorded activity duration ≤ N seconds."

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
