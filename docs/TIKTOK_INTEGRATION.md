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
| OAuth admin page (client) | `app/admin/tiktok-oauth/page.tsx` | Requires Firebase Auth sign-in with an email on `ADMIN_EMAILS`. |
| OAuth start (server) | `app/api/tiktok/oauth/start/route.ts` | POST only. Verifies Firebase ID token + admin allow-list. Sets state cookie, returns `{ authorizeUrl }`. |
| OAuth callback (server) | `app/api/tiktok/oauth/callback/route.ts` | Verifies state cookie, exchanges auth_code for token, renders one-time HTML for admin browser session. |
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
   - **Advertiser Redirect URL** (TikTok's required field): paste this
     exact string, character for character —
     ```
     https://inzone.games/api/tiktok/oauth/callback
     ```
     This is served by `app/api/tiktok/oauth/callback/route.ts` in this
     repo. It stays on-domain, the token exchange happens server-side
     with `TIKTOK_APP_SECRET`, and the token never enters chat, a log,
     or a third-party service. A mismatched host / path / scheme fails
     the exchange, so retype rather than paste with edits.
   - **Scopes — this is by capability, not by TikTok's UI label.**
     TikTok has renamed its scope groups multiple times; the labels
     visible in the portal drift. The canonical capability list lives in
     [`lib/tiktok/oauth.ts` → `MINIMUM_SCOPE_CAPABILITIES`](../lib/tiktok/oauth.ts).
     Match those capabilities to whatever labels your current portal
     shows:
     - **Reporting.** Whichever group unlocks the `/report/integrated/get/`
       endpoint. In current portals this is almost always labelled
       "Reporting" — pick it. This is the one that grants the metrics
       listed in [`TIKTOK_METRICS`](../lib/tiktok/reporting.ts).
     - **Ad account metadata (read).** Whichever group provides
       read-only access to advertiser info (currency, timezone). If your
       portal shows an "Ad Account" / "Ad Info" / "Advertiser
       Information" group with a Read-only variant, pick that. If no
       separate group is visible, skip it — modern portals fold this
       into Reporting. Verify at step 4 against the callback page's
       readout.
   - **Do NOT request** any of the write / management capabilities —
     the canonical refusal list is
     [`lib/tiktok/oauth.ts` → `REFUSED_CAPABILITIES`](../lib/tiktok/oauth.ts).
     A grep proves on inspection that we never ask for write.
     Specifically: no "Manage" / "Write" / "Create" / "Delete" /
     "Upload" / "Edit" variant of anything, no Budget group, no
     Bidding & Optimization group, no Creative Management (write), no
     Audience Management (write), no Comment Management, no DPA /
     Product Feed. If TikTok groups these under "All Access" or "Full
     Management", decline — pick only the granular Reporting group.
   - **Verification, not assumption**: the callback page in step 4
     shows the scope ids TikTok's server actually issued. If any
     write scope appears, revoke and redo. Trust the callback's
     readout over any UI label claim in this document — TikTok owns
     the label taxonomy.
   - After creating the app, copy the **App ID** and the **App Secret**
     — you'll paste both into Vercel in step 3.

4. **Do NOT click "Get Access Token for the current account"** in the
   Developer Portal. That's a one-shot token with no rotation path.
   Instead we run the OAuth flow through this repo — see step 4 —
   which re-auths on demand via a signed-in admin browser session.

---

## 3. Vercel — set the environment variables (Jayme)

Vercel → Project `in-zone-s-projects/inzone-games` → **Settings →
Environment Variables**. Add each of these; **paste each value into
the Vercel input, not into chat**.

**A. Vars needed to run the OAuth flow:**

| Variable | Type | Environments | Value |
|---|---|---|---|
| `TIKTOK_APP_ID` | Plain Text | Production | App ID from step 2.3. |
| `TIKTOK_APP_SECRET` | **Encrypted** | Production | App Secret from step 2.3. Server-only; token exchange only. |
| `FIREBASE_SERVICE_ACCOUNT` | **Encrypted** | Production | Already set for the existing admin API — nothing new to do. The OAuth start route reuses it to verify the admin's Firebase ID token. |

Redeploy production so these apply. Then run the flow (step 4). Once
you have the access token pasted into Vercel, **remove
`TIKTOK_APP_SECRET`** — it's only needed to obtain the token, not to
call the report API. `TIKTOK_APP_ID` stays (used for logging).
`FIREBASE_SERVICE_ACCOUNT` obviously stays — the rest of the app
needs it.

Note: there is no `TIKTOK_OAUTH_ADMIN_KEY`. Admin identity is Firebase
Auth ID token verified against `ADMIN_EMAILS`; no secret ever appears
in a URL.

**B. Vars the reporting client reads (set these once you have the token from step 4):**

| Variable | Type | Environments | Value |
|---|---|---|---|
| `NEXT_PUBLIC_TIKTOK_PIXEL_ID` | Plain Text | Production, Preview | **Optional.** Only set to override the hardcoded default in `components/TikTokPixel.tsx`. Leave unset to use the shipped pixel. |
| `TIKTOK_ACCESS_TOKEN` | **Encrypted** | Production | The access token you'll copy off the callback page in step 4. Do NOT set on Preview — Preview never emits ads anyway. |
| `TIKTOK_ADVERTISER_ID` | Plain Text | Production | Numeric advertiser id you'll pick from the callback page in step 4. |

**Preview / local dev**: the pixel base script won't load on Preview
even with the hardcoded default because Preview hosts fail the
`mayEmitToAdPlatform` gate. If you need to smoke-test the pixel on a
staging pixel id, set `NEXT_PUBLIC_TIKTOK_PIXEL_ID` on Preview with the
staging id.

---

## 4. Run the OAuth flow to get the access token (Jayme)

With the step 3.A vars set and production redeployed:

1. Sign in to `https://inzone.games` with your admin Google account
   (one of the emails on `ADMIN_EMAILS` in `lib/admin-shared.ts`).
2. In the same browser, in a separate tab, sign in to TikTok Business
   Center too — you'll approve the flow there.
3. Visit:
   ```
   https://inzone.games/admin/tiktok-oauth
   ```
   The page reads your Firebase Auth session. If you're not signed in
   or your email isn't on the allow-list it says so and refuses.
4. Click **Start TikTok authorization**. The page fetches a Firebase ID
   token, POSTs it to `/api/tiktok/oauth/start`, and — on success —
   navigates the same tab to TikTok's authorize page.
5. TikTok's page shows the requested scopes. Approve.
6. TikTok bounces back to `/api/tiktok/oauth/callback`. You see a
   one-time page showing the access token, the advertiser ids the app
   was authorized against, and the scope ids TikTok issued.
7. Click **Copy token** and paste it into the Vercel env var
   `TIKTOK_ACCESS_TOKEN` (Encrypted, Production).
8. Pick the advertiser id from the list on the page and paste it into
   `TIKTOK_ADVERTISER_ID` (Plain Text, Production).
9. Cross-check the "Granted scopes" section on the callback page
   against the capability list in `MINIMUM_SCOPE_CAPABILITIES`. If any
   write / management scope appears, revoke the app in TikTok's portal
   and redo — this integration is read-only by contract.
10. Remove `TIKTOK_APP_SECRET` from Vercel.
11. Redeploy production.

### About the token transfer — precisely

The access token is delivered as a **protected one-time transfer**
through your admin browser session. It is not server-only storage; a
human has to see it to paste it into Vercel, and I don't dress that up.
Here's exactly what happens:

- **Transport**: HTTPS response, `Cache-Control: no-store, no-cache,
  must-revalidate, private`, `X-Robots-Tag: noindex, nofollow`,
  `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`.
- **Delivery**: rendered in HTML inline in the response body. The
  response reaches your Firebase-authenticated admin browser session
  only — nothing else on the network path holds it.
- **What the server holds**: nothing. The token is a local variable in
  the callback handler; it is not persisted to any store, cache,
  cookie, or log line. Server log line for the exchange is exactly
  `[tiktok-oauth] success advertisers=<n> scopes=<m>` — no token
  bytes, no prefix, no length, no fingerprint.
- **What the DOM holds**: the token as visible text on the one-time
  page, until you copy it and close the tab. The page never posts it
  anywhere — no `fetch`, no analytics, no third-party script.
- **After the copy**: it lives in your clipboard, then in Vercel's
  encrypted env store. Clear your clipboard once pasted if you're
  concerned about clipboard managers.

This is the same pattern Vercel, Netlify, and AWS use for admin OAuth
token acquisition. What's not honest is claiming "server-only" — the
token is server-side up to the point where it must be delivered to a
human, and no OAuth reporting integration on any platform can avoid
that last step.

---

## 5. Attribution to Hexclave — what's linked and what's not

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

## 6. What the code will do once steps 3 and 4 are done

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

## 7. What Claude will do next (Jayme confirms)

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

## 8. Anti-goals — never do these

- Never request the Access Token via chat. Always via the callback
  page in step 4, then into Vercel.
- Never log any part of the access token. Not the full string, not a
  prefix, not a length, not a fingerprint. Even 4 characters is
  entropy an attacker can combine with side-channel data. The server
  log line for a successful exchange contains only two counts:
  `advertisers=<n> scopes=<m>`.
- Never put an admin secret (or the admin key that used to exist) in
  a URL. Admin identity is Firebase Auth ID token verified server-side
  against `ADMIN_EMAILS`. The `/start` route rejects any request
  without a valid Bearer token.
- Never grant write scopes. The canonical refusal list is
  `REFUSED_CAPABILITIES` in `lib/tiktok/oauth.ts` — a grep proves on
  inspection that write is off by construction.
- Never leave `TIKTOK_APP_SECRET` set on the deploy after step 4
  completes. It's only needed for the auth-code → token exchange.
- Never register a Redirect URL other than
  `https://inzone.games/api/tiktok/oauth/callback` in the TikTok
  Developer Portal. A staging URL widens the attack surface for the
  auth code; if a staging test is needed, do it against the production
  route with a fresh state.
- Never claim the access token "stays server-side" as if it were a
  server-only secret. It's delivered as a protected one-time transfer
  through the admin browser session (see step 4).
- Never fabricate a click → play attribution when the UTM chain
  breaks. Flag the gap; do not infer.
- Never send anything other than `VERIFIED_GAMEPLAY_EVENTS` to the
  TikTok pixel. All other campaign events stay in our own analytics.
- Never sanitize a chat message, invite link, session id, or raw URL
  into a TikTok event property. `sanitizeData` already blocks these
  upstream — if a payload looks like it would leak them, that's a
  design mistake to fix at the source.
