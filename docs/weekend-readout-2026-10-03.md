# Weekend readout — 2026-10-03 (Sat, 01:30 UTC)

## Scope: this is the WEB HUB only. The Flutter app is a separate funnel and is not in these numbers.

Verified from both ends, because it changes how every number below should be read:

- **Hexclave holds web data only.** Over 10 days the project contains three event
  types — `$page-view` (74,589), `$token-refresh` (11,781), `$click` (360) — all
  Hexclave web-SDK types, no app-native type. 100 % of page-view and click rows
  carry `www.inzone.games`; the only other hosts are 17 rows from two Vercel
  Preview deployments, which the host filter on every query below excludes.
- **The Flutter app does not report to Hexclave.** `inzonesm/inzone-flutter-app`
  @ `fdf3998` has zero references to `hexclave` in any `.dart`, `.yaml`, `.json`,
  `.gradle` or `.plist` file, and zero references to project `463bba54`.
- **The app is instrumented separately**, via `firebase_analytics: ^11.3.4` and
  `appsflyer_sdk: ^6.17.1`, with its own funnel in `lib/services/analytics_service.dart`:
  `game_viewed → game_opened → game_loaded → game_heartbeat → qualified_play →
  game_ended → score_submitted`, plus `GameSessionAnalytics.recordSessionStart/End`.
  That is a different contract from the four `VERIFIED_GAMEPLAY_EVENTS`;
  `qualified_play` is not `engaged_play`. **No number from either destination
  appears anywhere in this document — this session has no credentials for them.**
- **App gameplay can never reach Hexclave by construction.**
  `lib/screen/common/community_game_screen.dart:703` — the screen "loads the raw
  bucket entry (`gameUrl`)". The WebView goes straight to the storage bucket, not
  to `inzone.games/games/<id>`, so it bypasses the web hub, its iframe host, its
  Meta pixel and its Hexclave transport entirely.

**Why the web funnel is nonetheless the right surface to judge this spend:** the
TikTok ad group ran `promotion_type: WEBSITE` with no `app_id` and
`pixel_id: null`; the two Meta campaigns that spent ran `OUTCOME_TRAFFIC` and
`OUTCOME_SALES`. The only `OUTCOME_APP_PROMOTION` campaigns on the account are
paused and were last touched in June 2025. And web-to-app leakage was 2
`app_cta_click` events from 2 browsers in 10 days. The money bought website
visits, and almost none of them walked to the app.

**What this does limit:** every count below is a count of *web* browsers. "Six
browsers played" means six on the hub. The app's player count is unknown to this
analysis, so nothing here supports a claim about InZone's total audience.

### One unexplained denominator

`$token-refresh` covers 10,487 user ids against `$page-view`'s 9,691, and **797
ids refreshed a token without ever delivering a page-view.** Two candidate
explanations, undecided: the Hexclave SDK authenticates before the page-view
beacon flushes, and in a fast-unloading webview the beacon is lost; or a client
other than the hub shares this Hexclave project. It cannot be the Flutter app
(no Hexclave SDK). If it is lost beacons, arrival counts below are understated by
roughly 8 %. It does not move the engagement finding in §5, which is a ratio
inside the delivered rows.

---

Measured, not inferred. Every number below is either a first-hand HTTP response,
a TikTok/Meta Marketing API read, or a Hexclave `queryAnalytics` result against
project `463bba54-…`. Where a number is a proxy and not verified gameplay, it says so.

---

## 1. Production is down

```
GET https://inzone.games/            → HTTP/2 402  x-vercel-error: DEPLOYMENT_DISABLED
GET https://www.inzone.games/        → HTTP/2 402  x-vercel-error: DEPLOYMENT_DISABLED
GET https://inzone-games.vercel.app/ → HTTP/2 402  x-vercel-error: DEPLOYMENT_DISABLED
```

Body is `Payment required`, 78 bytes, `server: Vercel`. Apex, `www`, and the
`vercel.app` domain all return it, so the whole Vercel project is disabled —
not a route, not a build, not DNS. This is an account-level billing or usage
block and only the account holder can clear it.

Everything else in this document is history until that is fixed.

## 2. Nothing is delivering on either ad platform

| | TikTok | Meta |
|---|---|---|
| Entity | ad group `Canada \| English \| 35+ \| Final1 + Final2 \| $140 \| 7d` | campaign `AU 35+ \| game_start \| $50` |
| Status | `ADGROUP_STATUS_TIME_DONE` | `stop_time` 2026-09-30 |
| Schedule end | 2026-10-02 01:30 UTC | 2026-09-30 22:10 -0400 |
| Spend | $136.18 of $140 (lifetime) | $49.99 of $50 |
| Impressions | 56,392 | 3,306 |
| Clicks | 14,203 | 121 |
| CTR | 25.19 % | 3.66 % |
| CPC | $0.0096 | $0.41 |

Hexclave confirms it from the other side: 1 arrival on 2026-10-02, 0 on 10-03.

## 3. What the week's traffic actually was

Production hostnames only (`inzone.games`, `www.inzone.games`), `traffic_kind`
empty — i.e. customer traffic with agent and manual QA excluded.

| day | arrivals | game page opened | iframe loaded | browsers that played | rounds | finished |
|---|---|---|---|---|---|---|
| 2026-10-01 | 1041 | 1063 | 2211 | 1 | 1 | 0 |
| 2026-09-30 | 1497 | 1600 | 3115 | 5 | 14 | 4 |
| 2026-09-29 | 1341 | 1420 | 2978 | 0 | 0 | 0 |
| 2026-09-28 | 1179 | 1231 | 2368 | 0 | 0 | 0 |
| 2026-09-27 | 1423 | 1474 | 1901 | 0 | 0 | 0 |
| 2026-09-26 | 1304 | 1348 | 1798 | 0 | 0 | 0 |
| 2026-09-25 | 876 | 1079 | 1418 | 0 | 0 | 0 |

## 4. The traffic was ByteDance audience-network inventory, not TikTok users

The ad group ran `PLACEMENT_TYPE_AUTOMATIC` with
`placements: ["PLACEMENT_TIKTOK", "PLACEMENT_GLOBAL_APP_BUNDLE", "PLACEMENT_PANGLE"]`.
Pangle and the Global App Bundle were on.

User agents of the 8,035 identified browsers over 8 days:

| platform | shell | browsers | share |
|---|---|---|---|
| iPad | browser | 2879 | 35.8 % |
| Mac | browser | 1704 | 21.2 % |
| Android | browser | 1623 | 20.2 % |
| iPhone | browser | 1559 | 19.4 % |
| Android | TikTok webview | 69 | 0.9 % |
| iPhone | TikTok webview | 52 | 0.6 % |
| iPhone | Facebook webview | 23 | 0.3 % |

Only **1.5 %** carry a TikTok in-app webview UA. The top distinct agents are:

```
Mozilla/5.0 (iPad; CPU OS 18_7 …) Mobile/15E148 open_news/7.8.5.8 JsSdk/2.0 NetType/WIFI (open_news)
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7 …) Version/26.6.1 Safari/605.1.15   screen_width=810
```

`open_news` is a ByteDance news-reader webview — Pangle inventory. And the
"Macintosh Safari" rows report `screen_width` 810 or 820, which no Mac has;
`screen_width` equals `viewport_width` exactly, at 768/810/820 and nothing else,
across thousands of distinct browsers. That is one app's embedded webview, not a
device population. A 25 % CTR at $0.0096 a click with 9 profile visits out of
14,203 clicks is the same story from the billing side.

## 5. Why "we can't measure Elytra" is no longer the explanation

Objection to answer: Elytra Flight has no verified gameplay bridge (CLAUDE.md
roster: "No — instructions only"), so its zero plays could be an instrumentation
gap rather than absent play. That was the right caution a week ago. It no longer
holds, because `lib/cross-origin-engagement.ts` ships parent-side proxies that
need no bridge and work on cross-origin builds:

- `iframe_engaged` — first `pointerdown`/`touchstart` whose target is the iframe node
- `foreground_dwell_15s` / `_60s` — cumulative visible + on-screen + active-input time
- `session_bounce` — unload with `iframe_engaged` never fired

The probe's WebView defect was fixed by PR #71 (`touchstart` as well as
`pointerdown`), merged 2026-09-28 16:48 UTC. Measuring strictly **after** that,
2026-09-29 00:00 → 2026-10-02 00:00 UTC, customer traffic only:

| step | browsers |
|---|---|
| campaign arrival | 3723 |
| game page opened | 3922 |
| iframe actually loaded | 3647 |
| **ever touched the game frame** (`iframe_engaged`) | **10** |
| stayed 15 s on screen and active | 9 |
| stayed 60 s on screen and active | 2 |
| verified `game_start` | 6 |
| explicit `session_bounce` / `no_engagement` | 604 (572 of them Elytra) |

The transport demonstrably works: 3,647 `game_frame_loaded` events arrived from
those same browsers on the same path. So **the absence of `iframe_engaged` is a
real absence, not a measurement failure.** 10 touches in 3,647 frame loads is
0.27 %. That is not friction. These were not people trying to play.

## 6. The six browsers that did play

All six are real phones. All six played Escape Road (the one flagship with a
verified bridge, PR #73). Five arrived with **no `utm_source` at all** and four
of those are Facebook in-app webviews (`FBAN/FBIOS`, `[FB…]` on Android), inside
a two-hour window on 2026-09-30 between 07:41 and 09:39 UTC — the signature of a
link being passed between contacts, not cold acquisition. One carried
`utm_source=tiktok` and spent 1 h 47 m across 28 events on 10-01.

**$186.17 of paid media bought at most one verified player. The other five came in free, through a Facebook share.**

## 7. Neither platform has a conversion signal

- TikTok: `pixel_list_get` → `pixels: []`. Ad group `pixel_id: null`,
  `optimization_goal: TRAFFIC_LANDING_PAGE_VIEW`. There has never been a TikTok pixel.
- Meta: `ads_get_customconversions` → `total_count: 0`. The campaign **named**
  `game_start` ran `OUTCOME_SALES` with no custom conversion defined, so it had
  nothing to optimize toward.

Both platforms were therefore optimizing on clicks. Pangle is where the cheapest
clicks live. The media bought exactly what it was told to buy.

## 8. Product-side items that are genuinely open

1. **`game_frame_focused` is dead.** Zero events across 15,628 frame loads in 8
   days. A named proxy in CLAUDE.md that never fires in production.
2. **Escape Road: 83.9 % of openers reach `game_frame_loaded`** (2,719 of 3,240)
   against Elytra's 93.1 %. One in six Escape Road openers never gets a frame
   load. With this traffic I cannot separate "the frame failed" from "the browser
   closed before load fired" — it needs a real-device test, not more SQL.
3. **No reload churn.** An earlier read of frames ÷ opens (2.05 for Elytra)
   suggested the iframe was remounting. It does not: per-visit the distribution
   is 3,643 visits with exactly 1 frame load, 94 with 2, 23 with 3. The ratio was
   an artifact of one bucket of events with an empty `visit_id` collapsing
   thousands of visits into one row. Withdrawn.
4. **Ten open PRs** against a CLAUDE.md cap of two open drafts, four of them
   older than the 48-hour draft clock (#34, #46, #48, #51, #53, #62, #63).

## 9. Queries and reads behind this

Hexclave: `queryAnalytics` against project `463bba54-…`, 1000 ms ClickHouse
timeout, campaign events read as `$page-view` rows with the real name in
`data.inzone_event`. TikTok: `auth_advertiser_get`, `report_integrated_get`
(BASIC, campaign + ad group level), `adgroup_get`, `pixel_list_get` on advertiser
`7660957559345004545`. Meta: `ads_get_ad_entities`, `ads_get_customconversions`
on ad account `1200604131220857`. HTTP checks by `curl -D -` against the three
hostnames. No credentials, replays, or raw user agents beyond the aggregate rows
above are recorded here.
