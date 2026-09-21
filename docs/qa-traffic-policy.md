# QA traffic: marking, suppression, and reporting

Three behaviours, kept apart on purpose. Conflating them is how a test session
ends up teaching an ad platform what a customer looks like.

_Implemented on `cursor/flagship-companion-report-eb52`, 2026-09-21._

## The marker

```
?inzone_qa=agent      automated browser check
?inzone_qa=manual     a person testing by hand
```

**Why a dedicated parameter, not a UTM.** Every key in `UTM_KEYS` carries
acquisition meaning. Marking with `utm_source=qa` would overwrite the very
attribution a test of the acquisition flow needs to keep. A separate parameter
marks the visit while leaving its campaign attribution untouched, so a marked
session can drive a real ad URL end to end and still be excluded everywhere.

## What each behaviour does

| Behaviour | Where | Rule |
|---|---|---|
| **Suppress Meta** | `components/MetaPixel.tsx`, `lib/campaign-analytics.ts` | Pixel is not initialised and no verified event is dispatched unless the visit is on a production hostname **and** unmarked. The base script is withheld too, not just the custom events — an initialised pixel sends `PageView` on every route change, so gating only conversions would still teach the dataset that Preview checks are visitors. |
| **Preserve diagnostics** | `lib/campaign-analytics.ts` | Every event still reaches Hexclave, tagged with `app_env` and `traffic_kind`. Both are closed sets validated in `sanitizeData`, so neither can carry a session id, chat text or a transcript. |
| **Exclude from reports** | `scripts/daily-product-report.mjs` | Customer figures are production hostnames, unmarked, and not a documented historical id. Everything else is reported separately as diagnostics. |

### Classification

`lib/qa-traffic.ts` is the single source. `app_env` is one of:

- `production` — **exact** match on `inzone.games` or `www.inzone.games`. A
  suffix test would admit `inzone.games.evil.example`, so it is not used.
- `preview` — `*.vercel.app`
- `local` — `localhost`, `127.0.0.1`, `*.local`
- `unknown` — anything else, **including a row with no usable URL**

`unknown` is a real answer, not a fallback to production. An unrecognised host
might be a staging alias, a rename or a proxy; counting it as customer traffic
because we failed to classify it is the exact mistake this field prevents.

### Persistence

The traffic kind is held in **`sessionStorage`**, keyed `inzone.qa-traffic.v1`.

The marker usually appears only on the entry URL, but a `game_start` can happen
several navigations later, so the classification must survive same-tab
navigation. `sessionStorage` dies with the tab, so marking one test visit never
turns that browser into a permanently excluded visitor — which `localStorage`
would do, silently deleting a real person from the numbers for good. Covered by
`tests/qa-traffic-dispatch.test.mjs`.

## Compatibility with earlier conventions

**`iz_qa` — does not exist.** Searched `main`, this branch, and every commit in
the repository (`git log --all -S"iz_qa"`): there are no matches. No code, no
script and no report has ever read it. Nothing is being migrated from it, and
no handling is implemented for it, because implementing handling for a
convention that was never used would be inventing a second marker rather than
avoiding one.

**UTM conventions — recognised for historical rows only.** `utm_medium=qa`,
`utm_medium=verification` and `utm_content=exclude_from_acquisition` were
conventions used in this track's own analysis scripts. They were recognised by
neither the product nor the report, and **they suppressed nothing** — every
session run under them emitted to Meta normally.

They are now honoured by the report's exclusion so historical rows do not count
as customers. They are **not** a supported way to mark new traffic and they do
not suppress emission. `?inzone_qa=` is the only marker. Keeping the old
conventions read-only for history, rather than wiring them into suppression,
is what stops this becoming two competing markers.

**Historical ids.** Rows recorded before the marker existed are excluded by
`HEXCLAVE_QA_USER_IDS`, now passed into the workflow. Evidence for each id is
below.

## Historical QA identifiers

Each id is tied to a named script by target game and run time — not by time
window alone. Scripts are in `scripts/.hexclave-out/repro/` (git-ignored).

**Marker- or UTM-confirmed (4):** `b0bb5a59-0583-498b-9258-eea000cb9bcf`,
`55af7edf-93b9-4545-a0a0-c096918ef46b`, `47f8f9a1-60f0-42f0-a6f7-925198172f5a`,
`2022c1d5-7ecb-4076-bc30-abf555bd37c6`.

**Script-matched (27):**

```
82798aa3-538f-490e-b6c0-f9115c0427f4  17:15  repro.mjs      flappybird
28b69522-4a31-4dbd-90b7-15015a87cc69  17:16  scene.mjs      flappybird
abdc14d8-b718-4dc3-81eb-6fddbd2db7ff  17:21  scene.mjs      flappybird
95c1064f-4c1d-4302-b351-0391636b03cd  17:23  tap.mjs        flappybird
066c0326-dec0-4f31-a5a2-500a674dd954  17:24  geom.mjs       flappybird
d48bcf7b-2206-4731-921b-55b4770068b6  17:24  small.mjs      flappybird
cdcd8803-7383-4595-802d-fca79942bf79  17:27  grid2.mjs      flappybird
f74337c0-b5a5-4b12-8d28-7c5d26af7d3e  17:28  grid2.mjs      flappybird
6f544831-bf29-486e-b0aa-bb05ff65310b  17:28  grid2.mjs      flappybird
2ed8dd56-c655-46bf-965a-c63a3b51a0f5  17:48  btn.mjs        flappybird
e297bb92-c5da-413f-8508-33260e323d0c  17:49  api.mjs        flappybird
85dd471e-05dc-4331-b4cc-536fb170d205  17:49  api.mjs        flappybird
545d344a-449d-43e1-8fb6-d4b004f76173  17:49  api2.mjs       flappybird
2968d648-1183-447e-b221-be00a46be093  17:52  api2.mjs       flappybird
12e9e450-6515-43d3-9e61-eac9cd664c49  17:56  flagship.mjs   kart-bros
cc3fbe5b-4e76-4c18-92d3-fc6243840b69  17:57  flagship.mjs   clelytraflight
2dd9e9b3-332d-406b-bf39-7114bec518e3  17:57  flagship.mjs   karate-bros
c30fe3e3-5ea5-4f97-baa1-9852fedc5aef  17:58  flagship.mjs   clescaperoad
c66437ae-f831-4390-8768-221230fbc3bc  17:58  flagship.mjs   nightclub-showdown
3f0427cc-5a2c-45c3-ae98-fa8feddf5ee8  17:59  flagship.mjs   karate-bros
dce94f4f-3a96-470d-9d79-96809442aec9  17:59  flagship.mjs   clescaperoad
c4d955cf-3ded-4615-b2b2-5eac4e8393c0  18:00  flagship.mjs   clescaperoad
2e3dfcc4-7596-47ba-be21-07285756abf0  18:36  winid.mjs      flappybird
351b696e-e917-411d-8355-7c340fe2ee87  18:44  escape.mjs     clescaperoad
56c99d9a-a07f-469e-9a06-56f153e9b47b  18:45  escape.mjs     clescaperoadcity2
792708a1-6fcb-4207-a5b3-5cd92be77a21  18:46  city2.mjs      clescaperoadcity2
fea1b5f4-8d1d-4c41-94ab-eda35f12af0d  19:30  prodsmoke.mjs  flappybird
23715a58-7a36-4b8c-bb79-7458fb0ac015  19:53  winid2.mjs     flappybird
```

**Preserved — do NOT exclude.** `bca88603-2626-4b85-b7dc-a8e897ee7300`
(ambiguous: no `game_id`, macOS user agent, matches no run);
`09e8af21-dec7-4c48-af8e-dbbf21cc33b4` and `8c044736-dcd3-4f8a-9ccb-ad5a5435791c`
(a real `utm_source=meta` visitor).

The script-matched set is inference, not proof. It is stronger than a time
window — each row names the specific check that produced it — but it is not the
marker-level certainty the policy gives future runs. That is the reason for the
marker.

## Verification

`tests/qa-traffic-dispatch.test.mjs` exercises a real verified-start dispatch
through `trackCampaignEvent` with a mocked Meta transport. Meta's network being
unreachable from a sandbox is irrelevant to these: the question is whether our
code calls the dispatcher at all.

`tests/qa-traffic-report.test.mjs` checks the report decision against
production, Preview, marked-QA, historical-id and unknown-host fixtures, and
asserts the generated SQL still carries each clause the decision depends on.
The report filters inside ClickHouse and cannot call the shared classifier, so
the two are tested against the same fixtures to stop them drifting apart.

**Provider ingestion is a separate claim and is not covered by these tests.**
Whether Meta actually received or withheld anything can only be confirmed from
a network that can reach `connect.facebook.net`, or in Events Manager's live
Test Events view.
