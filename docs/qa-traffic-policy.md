# QA traffic: what is marked, what is suppressed, what is excluded

Three behaviours, deliberately kept apart. Conflating them is how a test
session ends up teaching an ad platform what a customer looks like.

_Verified against `main` @ `177dc90` and PR #35 @ `cc7c61d`, 2026-09-21._

## 1. What exists today

| Behaviour | Mechanism today | Status |
|---|---|---|
| Suppress Meta emission for test traffic | **none** | **Missing.** `trackCampaignEvent` (`lib/campaign-analytics.ts:456`) gates only on `isVerifiedGameplayEvent(name)`. No marker of any kind is consulted. PR #35's diff on that file adds companion event names and sanitizer keys only — no gating. A test session that reaches `game_start` sends a real conversion to pixel `2983764635290155`. |
| Preserve diagnostics in Hexclave | every event goes through `transport` unconditionally | **Works.** All five UTM keys plus `data.url` are carried, and `publicAnalyticsUrl` (`lib/campaign-analytics.ts:284`) strips only session/invite keys — so an added marker survives into the recorded URL. |
| Exclude from acquisition / engagement reports | `HEXCLAVE_QA_USER_IDS` env var → `qaFilterSql()` → `AND (user_id IS NULL OR user_id NOT IN (…))` | **Works, but manual.** Applied at all four `campaignWhere()` call sites. Keyed on Hexclave `user_id`, which is minted per browser context, so the list grows by one per automated run. `user_id IS NULL` is preserved, which correctly keeps ambiguous rows in. |

**Correction to earlier reporting from this track:** `utm_medium=qa` and
`utm_content=exclude_from_acquisition` are conventions from analysis scripts.
They are **not** recognised by the product or by the report, and they suppress
nothing. Every QA session run from this track so far emitted normally.

### Second finding: the report counts Preview traffic

`campaignWhere()` filters on `event_type`, `path`, `event_at` and the QA id
list. It has **no domain or host filter**. In a sample of the last 45 minutes,
**105 of 110** campaign rows came from `*.vercel.app` Preview hosts and 5 from
`www.inzone.games`. As written, every Preview check by any agent counts toward
customer acquisition and engagement figures. This is a larger source of
contamination than the id list is designed to catch.

## 2. Proposed policy

A dedicated query parameter, not a UTM.

```
?inzone_qa=agent      automated browser check
?inzone_qa=manual     a person testing by hand
```

**Why not a UTM.** All five keys in `UTM_KEYS` carry acquisition meaning.
Marking with `utm_source=qa` would overwrite the attribution a test of the
acquisition flow needs to keep. A separate parameter marks the visit while
leaving campaign attribution intact — so a marked session can drive a real ad
URL end to end and still be excluded.

`lib/qa-traffic.ts` (this branch) supplies the marker and the predicates. It
holds no transport, no storage and no React, so the analytics path, the report
and a test harness can all import it. An unrecognised value is treated as
**unmarked**, so a typo fails toward counting a real visitor rather than
silently dropping them.

## 3. Integration for Cursor — three small edits, none made here

These touch files PR #35 owns. They are written out rather than applied.

**(a) Carry the marker.** `lib/campaign-analytics.ts` — add `traffic_kind` to
`MEASUREMENT_STRING_KEYS`, read it from the entry URL with
`trafficKindFromSearch`, and persist it beside attribution in
`CAMPAIGN_STORAGE_KEY`. It must persist: by the time a `game_start` happens the
visitor may be several navigations past the marked entry.

**(b) Suppress emission.** `lib/campaign-analytics.ts:465` — one guard:

```ts
if (metaPixelDispatcher && isVerifiedGameplayEvent(name)
    && mayEmitToAdPlatform(event.data.traffic_kind)) {
```

Hexclave `transport` stays untouched above it, which is what keeps diagnostics.

**(c) Exclude by marker.** `scripts/daily-product-report.mjs` — extend
`qaFilterSql()` to also drop rows whose `traffic_kind` is set, and add the
missing host filter:

```sql
AND JSONExtractString(toString(data), 'traffic_kind') = ''
AND domain(JSONExtractString(toString(data), 'url')) = 'www.inzone.games'
```

The `HEXCLAVE_QA_USER_IDS` list stays for historical rows predating the marker.

## 4. Validation — one marked session

Run on production, 2026-09-21 21:24 UTC, against a real campaign URL with the
marker appended. Deliberately stopped short of a first flap, so **no verified
conversion was created by this check**.

Hexclave user: `2022c1d5-7ecb-4076-bc30-abf555bd37c6`

| Criterion | Result |
|---|---|
| Marker identifiable in Hexclave | **Pass** — all 5 rows carry `inzone_qa=agent` in `data.url` |
| Acquisition attribution preserved | **Pass** — `utm_source=meta`, `utm_campaign=solo_social_01` intact |
| No verified conversion emitted | **Not demonstrated.** None was emitted, but only because the session never reached a first flap. Suppression does not exist yet, so this cannot be shown until (b) lands. |
| Report excludes it | **Code-level only.** Adding the id to `HEXCLAVE_QA_USER_IDS` would exclude it via the existing filter. Not executed — the report has not been run. |
| Unmarked session stays eligible | **Pass** — unmarked production sessions earlier the same day appear normally with no marker on their rows. |

Reported separately, as they are different claims:

- **Code checks** — 7 unit tests in `tests/qa-traffic.test.mjs`, typecheck clean.
- **Observed emission** — my in-page `fbq` recorder captured zero calls, but
  `connect.facebook.net` is blocked in this sandbox, so that is **not** evidence
  of suppression and is not offered as such.
- **Actual ingestion** — confirmed in Hexclave, with a flush delay of roughly
  2–5 minutes. An earlier query at 25 minutes returned zero rows purely because
  it ran inside that window.

**Named gap:** emission to Meta cannot be observed from this sandbox at all —
the pixel host is unreachable here. Whether suppression works end to end must
be checked from a network that can reach `connect.facebook.net`, or in Meta
Events Manager's live Test Events view.

## 5. Historical exclusions, reconciled

Each id below is tied to a named script run by target game and run time, not to
a time window. The scripts are in `scripts/.hexclave-out/repro/` (git-ignored).

**Marker-confirmed (4)** — carry `utm_source=qa` or `inzone_qa=agent`:

```
b0bb5a59-0583-498b-9258-eea000cb9bcf  20:03  timing2.mjs
55af7edf-93b9-4545-a0a0-c096918ef46b  20:15  timing2.mjs
47f8f9a1-60f0-42f0-a6f7-925198172f5a  20:15  timing2.mjs
2022c1d5-7ecb-4076-bc30-abf555bd37c6  21:24  qasession2.mjs
```

**Script-matched (27)** — target game and time match a run executed from this
session:

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

**Preserved — do NOT exclude:**

```
bca88603-2626-4b85-b7dc-a8e897ee7300  19:39  ambiguous: no game_id, macOS user agent,
                                             matches no run from this session
09e8af21-dec7-4c48-af8e-dbbf21cc33b4  14:38  real visitor, utm_source=meta
8c044736-dcd3-4f8a-9ccb-ad5a5435791c  14:38  same visit as above
```

The script-matched set is inference from target and time, not proof. It is
stronger than a time window — each row names the specific check that produced
it — but it is not the marker-level certainty the policy above gives future
runs. That is the reason for the policy.

## 6. Daily report — deployment readiness

Reading `.github/workflows/daily-product-report.yml` on PR #35. **Not
scheduled, not running, no recurrence exists.** The `schedule:` block is
commented out by its authors, with the condition written into the file:
"Do not uncomment until Hexclave CLI auth succeeds in this runner and
REPORT_DIR points at a private reporting repository."

Outstanding, in the order they block each other:

1. **Authentication.** `scripts/daily-product-report.mjs` shells out to
   `npx @hexclave/cli exec --cloud-project-id`, which requires an interactive
   browser OAuth login. There is no non-interactive credential path in the
   script, and `HEXCLAVE_SECRET_SERVER_KEY` is explicitly rejected by that exec
   path. **This is the hard blocker** — a GitHub runner cannot complete a
   device-code flow unattended. It needs either a service credential the CLI
   accepts or a different query transport.
2. **Secrets.** `HEXCLAVE_PROJECT_ID`, `REPORT_DIR`, and
   `HEXCLAVE_QA_USER_IDS` (absent from the workflow env entirely — without it
   `qaFilterSql()` returns an empty string and nothing is excluded).
3. **Delivery destination.** `REPORT_DIR` is a secret with no default. **No
   destination has been chosen and I have not chosen one.** The file's own note
   says a private reporting repository; that needs confirming.
4. **Schedule.** Proposed `0 16 * * *` (09:00 America/Los_Angeles, PST). The
   comment flags DST, which that fixed cron does not handle.

No second reporter was created and no schedule was activated.
