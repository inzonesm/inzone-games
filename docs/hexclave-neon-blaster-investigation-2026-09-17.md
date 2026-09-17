# Neon Blaster load failure — investigation, 2026-09-17

Follow-up to `docs/hexclave-findings-2026-09-17.md` §D4. On 2026-09-17 a single
Playwright load of `/games/neon-blaster-inzone-production` through this
environment's outbound proxy produced two console errors:

- `Refused to execute script from '.../v3/game/runtime/bb.js' because its MIME
  type ('text/plain') is not executable, and strict MIME type checking is
  enabled.`
- One `502 Bad Gateway` on an unnamed subresource.

The bundle self-reported `"Neon Blaster couldn't start"` and offered a
Retry button. The earlier finding called this a Vercel edge cold-miss race
without proof. Rev. 2 of the findings doc withdrew that claim; this note is
the actual investigation.

## Method

Two independent probes, both against `https://www.inzone.games`, both from
this container:

1. **Direct curl to the failing resource.** Fifteen sequential
   `curl -sSI` requests to
   `https://www.inzone.games/gcs/games/neon-blaster-inzone-production/v3/game/runtime/bb.js`,
   with a 12-second timeout each, spaced by the shell loop's tick.

2. **Fresh browser contexts.** Five separate `chromium.launch` + new context
   loads of `https://www.inzone.games/games/neon-blaster-inzone-production`
   through Playwright with the same outbound HTTPS proxy Chromium uses today.
   Each context is isolated: no shared cookies, no shared cache. All JS
   responses under `/gcs/games/neon-blaster-inzone-production/` were logged
   (status, `content-type`, `x-vercel-cache`).

The reproducible script for both is at
`scripts/hexclave-journey-record.mjs neon-blaster-desktop` for the browser
walk, plus the curl loop this note documents (kept inline; see below).

## Results

### Curl

15 / 15 requests: `HTTP/2 200`, `content-type: application/javascript`.
Response time min 228 ms, max 1562 ms (first request only), median ~330 ms.
Sample of the response headers on three consecutive requests:

```
HTTP/2 200
content-type: application/javascript
x-vercel-cache: MISS
x-vercel-id: iad1::iad1::pbkhm-…

HTTP/2 200
content-type: application/javascript
x-vercel-cache: HIT
x-vercel-id: iad1::iad1::jfn49-…

HTTP/2 200
content-type: application/javascript
x-vercel-cache: HIT
x-vercel-id: iad1::iad1::mrpxz-…
```

Every subsequent request served from Vercel edge cache with the same
correct `content-type`.

### Playwright

5 / 5 attempts:

- `bb.js` and every other `/gcs/games/neon-blaster-.../*.js` returned 200
  with `content-type: application/javascript`.
- No `text/plain` observations.
- No 502 observations.
- 4 attempts booted past the boot screen within 6 seconds.
- 1 attempt was still on `"Loading…"` at 6 seconds but not in an error
  state (no `frameFailed`, no `frameStalled`).

Console errors present on every attempt are the outbound-proxy blocks
for `www.facebook.com` (Meta pixel) and `js.stripe.com` — proxy failures,
not production defects, and unrelated to Neon Blaster's script execution.

## Conclusion

The earlier "cold-miss race" hypothesis is **not supported by this
evidence.** In 20 controlled attempts today (15 curl + 5 browser), the
`bb.js` file was served with the correct MIME type every time — including
the first `MISS` response, which is exactly what the "race" hypothesis
predicted would fail.

The single Playwright observation on 2026-09-17 that produced the
`text/plain` error is now marked as **unreproducible within this session**.
Candidates it could have been:

1. A transient origin misconfiguration that has since been corrected.
   (No commit or Vercel deployment record accessible from this session
   confirms this.)
2. The agent proxy on this container rewriting the `content-type` on that
   one response. (Not confirmed.)
3. A Vercel edge quirk that has since propagated.

None of these are provable from the outside without more instances of the
failure.

## What is NOT done

- **No production defect fix.** Without a reproducible cause the safe
  action is to leave the runtime alone. A speculative "fix" (pinning
  Content-Type in the `/gcs/[...path]` rewrite, adding a `?ver=` cache
  buster) would be a code change without evidence.
- **No retry/back UX change.** `app/games/[id]/page.tsx` already handles
  the two documented failure modes:
  - `iframe.onError` → `frameFailed=true` → boot screen shows
    `"This game didn't load."` plus `Try again` and `Back to games`.
  - Iframe `onLoad` fires but game never reports ready → after 20 s
    (`STALL_AFTER_MS`) `frameStalled=true` → same escape hatch.
  Both were exercised in the 5-attempt walk. The rail's Home link
  (`game-rail`) is a persistent third escape and was visible on every
  attempt.

## What is still worth doing (separate work)

1. **Watch replays for this specific bundle.** If a paid-Meta visitor
   hits the `text/plain` shape again, the replay will show either the
   bundle's own "couldn't start" text or the host boot's "This game
   didn't load." That will tell us the failure mode and the frequency.
   Query is included as a preset:
   ```
   node scripts/hexclave-analytics-query.mjs replay-events \
     <session_replay_id_from_a_neon_blaster_first_game_over_absence>
   ```
2. **Tune `STALL_AFTER_MS` down** (currently 20 s). On mobile
   connections, 20 s of "Loading…" before offering an escape is a long
   time to lose a visitor. But this is a behaviour change without direct
   evidence today; the friction claim needs a bigger sample first. Not
   done in this PR.
3. **Do not remove Neon Blaster from the catalog** to make the metric
   look better. Playability and measurement coverage are separate
   properties, per the correction on 2026-09-17.
