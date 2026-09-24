# TikTok Ads integration — setup + attribution

Read-only reporting only. This document walks Jayme through the exact
TikTok Business Center + Vercel steps needed to activate the integration
that's already stubbed in-tree. Once these steps are done the code
starts working with **no further deploy** — the pixel and reporting
paths are gated by env vars and stay dormant when they're absent.

Nothing here creates campaigns, changes budgets, edits ads, or
publishes anything. If a future task needs those, they go in a
separate file with a different auth check so the write surface stays
visible on inspection.

---

## 1. What ships in-tree today

| Layer | File | Behaviour when env vars absent |
|---|---|---|
| Public pixel (client) | `components/TikTokPixel.tsx` | Uses hardcoded prod pixel `DAQO8QRC77UFPT804MQG` (same pattern as MetaPixel). Base script only loads on production for unmarked visitors. |
| Reporting client (server) | `lib/tiktok/reporting.ts` | Every call throws `TikTokReportingError('not_configured')`. |
| Config surface | `lib/tiktok/config.ts` | `tiktokReportingConfig()` returns `null` when access token / advertiser id are missing. |
| Wire-in | `app/layout.tsx` | `<TikTokPixel />` renders, exits early on Preview / QA-marked visits. |

Every layer is gated by `mayEmitToAdPlatform` from `lib/qa-traffic.ts` —
the same rule the Meta pixel uses. Preview deploys, `?inzone_qa=agent`
or `?inzone_qa=manual` runs, `localhost`, and any unknown host never
emit to TikTok, exactly like they never emit to Meta.

---

## 2. TikTok Business Center — one-time setup (Jayme)

**Do NOT paste tokens or secrets into chat.** Every credential goes
into Vercel's Environment Variables UI directly.

1. Log into <https://business.tiktok.com>. Confirm the ad account is
   the one running InZone campaigns (record its `advertiser_id` — it's
   the numeric id in the URL when you're inside the ad account).

2. **Install the TikTok Pixel** for `inzone.games`:
   - Business Center → **Assets → Events → Web Events**.
   - Create Pixel → name it `InZone Web` → connection method
     **Developer install** (we ship the code, not GTM).
   - Copy the **Pixel Code** id (TikTok's format is a 20-character
     alphanumeric string, e.g. `DAQO8QRC77UFPT804MQG`).
   - The pixel currently hardcoded in `components/TikTokPixel.tsx` is
     `DAQO8QRC77UFPT804MQG`. If your Business Center step produced a
     different id, either update that constant in the component (same
     pattern as `MetaPixel.tsx`) or set
     `NEXT_PUBLIC_TIKTOK_PIXEL_ID` in Vercel as an override.
   - Verify the domain `inzone.games` matches Meta's verified domain.
   - No standard events need to be selected here — the pixel is fired
     from `components/TikTokPixel.tsx` with `event_id` per event, so
     TikTok's event manager will show them once traffic arrives.

3. **Create a Marketing API developer app** — this is what gives us
   read access to reports:
   - <https://business-api.tiktok.com/portal/apps> → **Create App**.
   - App name: `InZone Reporting (read-only)`.
   - Category: `Analytics`.
   - Redirect URL: the Vercel production URL of an OAuth landing you
     don't need to build unless we ever want to run OAuth in-app. For
     a one-time token exchange, TikTok's Developer Portal supports a
     "Get Access Token for the current account" button — use it and
     skip the redirect step entirely.
   - **Scopes — request exactly these three, no more**:
     - `Ad Account Management (Read Only)` — `ad.read`
     - `Reporting` — `reports.read` (this is the one that unlocks
       `/report/integrated/get/`)
     - Optional: `Pixel/Events Management (Read Only)` if we later want
       server-side conversions readback.
   - **Do NOT** request `Ads Management (Write)`, `Budget Management`,
     `Creative Management (Write)`, `Bidding & Optimization`, or
     `Audience Management (Write)`. If TikTok's UI groups them under
     "All Access" — decline and use the granular list above.

4. **Grant the app to your advertiser**:
   - In the app's page, click **Get Access** → select the advertiser
     account from step 1 → the app moves from "In Development" to
     "Authorised".
   - Copy the **Access Token** and the **App ID** shown there.

---

## 3. Vercel — set the environment variables (Jayme)

Vercel → Project `in-zone-s-projects/inzone-games` → **Settings →
Environment Variables**. Add each of these; **paste each value into
the Vercel input, not into chat**.

| Variable | Type | Environments | Value |
|---|---|---|---|
| `NEXT_PUBLIC_TIKTOK_PIXEL_ID` | Plain Text | Production, Preview | **Optional.** Only set to override the hardcoded default in `components/TikTokPixel.tsx`. Leave unset to use the shipped pixel. |
| `TIKTOK_ACCESS_TOKEN` | **Encrypted** | Production | The access token from step 2.4. Do NOT set on Preview — Preview never emits ads anyway. |
| `TIKTOK_ADVERTISER_ID` | Plain Text | Production | Numeric advertiser id from step 1. |
| `TIKTOK_APP_ID` | Plain Text | Production | Optional — App id from step 2.4. Not used in the reporting call, kept for logs. |

Redeploy production once the vars are added (or wait for the next
merge — env changes apply on the following build).

**Preview / local dev**: the pixel base script won't load on Preview
even with the hardcoded default because Preview hosts fail the
`mayEmitToAdPlatform` gate. If you need to smoke-test the pixel on a
staging pixel id, set `NEXT_PUBLIC_TIKTOK_PIXEL_ID` on Preview with the
staging id.

---

## 4. Attribution to Hexclave — what's linked and what's not

TikTok's ad manager will show its own conversion counts (spend →
clicks → landing-page views → conversions), attributed inside its own
window (usually 7-day click / 1-day view). Hexclave will show
production, unmarked customer traffic via the shared QA policy. **These
two counts are not the same thing** and must never be silently
combined:

- TikTok knows a click became a landing-page view. It doesn't know
  which of those became a real player.
- Hexclave knows a `game_start` happened. It sees the incoming UTM
  attribution when TikTok's ad URL carries one.

**Ad URL convention that unlocks per-creative attribution**:

Every ad in TikTok Ads Manager should point at:

```
https://inzone.games/games/<gameId>?utm_source=tiktok&utm_medium=paid&utm_campaign=<campaign_name>&utm_content=<creative_id>
```

This flows through `captureCampaignArrival` and
`rememberAttribution` in `lib/campaign-analytics.ts` — the exact same
path we already use for Meta arrivals. `scripts/daily-product-report.mjs`
already reports by `utm_campaign` and `utm_content`.

TikTok also appends its click id as `ttclid` on every landing URL from
ads. A future PR can capture that alongside UTMs so we get
click-level attribution for TikTok arrivals whose UTMs are missing;
today the report reads UTMs only, and a TikTok ad without them will
appear as "(no source)" in the report.

---

## 5. What the code will do once step 3 is done

- `components/TikTokPixel.tsx` loads the base script on production for
  unmarked visitors, fires `page()` on every route change, and
  dispatches only the four `VERIFIED_GAMEPLAY_EVENTS`
  (`game_start`, `engaged_play`, `first_game_over`, `return_play`)
  with a shared `event_id`. Same contract as Meta.
- `lib/tiktok/reporting.ts::fetchTikTokReport` becomes callable from
  any server-side script. A follow-up will wire it into a
  `scripts/tiktok-reporting.mjs` that mirrors
  `scripts/daily-product-report.mjs`'s pattern (per-campaign spend +
  landing views + creative breakdown, filtered through the shared QA
  classifier where the ids match).

---

## 6. What Claude will do next (Jayme confirms)

After env vars are set:

1. Verify `tiktokReportingConfig(process.env)` returns non-null on
   production. If not, credentials are missing or malformed —
   surface the specific missing var.
2. Pull a 7-day report at campaign, ad-group, and ad level. Report
   dates, timezone, currency, and attribution window on the record.
3. Cross-reference `utm_campaign` / `utm_content` in Hexclave's
   customer bucket to produce a creative-by-creative table:
   spend → clicks → landing views → verified game_start →
   engaged_play → first_game_over → return.
4. Flag any creative whose TikTok clicks don't produce a proportional
   game_start count — that's a landing-page or product-fit gap, not a
   creative gap.
5. Propose product changes based on the evidence — never automatically
   modify production.

---

## 7. Anti-goals — never do these

- Never request the Access Token via chat. Always via Vercel.
- Never grant write scopes (`ad.manage`, `budget.manage`,
  `campaign.manage`, `creative.manage`).
- Never fabricate a click → play attribution when the UTM chain
  breaks. Flag the gap; do not infer.
- Never send anything other than `VERIFIED_GAMEPLAY_EVENTS` to the
  TikTok pixel. All other campaign events stay in our own analytics.
- Never sanitize a chat message, invite link, session id, or raw URL
  into a TikTok event property. `sanitizeData` already blocks these
  upstream — if a payload looks like it would leak them, that's a
  design mistake to fix at the source.
