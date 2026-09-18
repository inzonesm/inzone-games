# Release handoff — Cursor continuation (2026-09-17)

**Author:** Cursor Cloud Agent on `inzonesm/inzone-games` (not Little-Chapters).
**Branch:** `claude/combined-verification` (fast-forward from `416ec8c`; recovered commit plus verification follow-up).
**Does not merge or deploy production.**

Claude’s original handoff is preserved below this update. `main` is still `29ae3b7`.

---

## Publication — recovered onto PR #30

Recovery applied at exact base `416ec8c8fa771d851014d42320707d0e262c296d` and pushed to `claude/combined-verification`. No force-push.

| Item | Value |
| --- | --- |
| Recovered commit (full SHA) | `a81d9d640933799ae480bea61d51f9c009aacf65` |
| Original unpublished HEAD | `252560de0e960c1c9f42a7aea8a646da916f654f` — **different SHA**; all 24 recovered Git blobs still match the patch-header hashes |
| PR | Draft **#30** — https://github.com/inzonesm/inzone-games/pull/30 |
| Remote branch | `origin/claude/combined-verification` fast-forward `416ec8c` → recovered commit, then this follow-up |

Later commits on this branch may change verification scripts / this handoff. Product files recovered at `a81d9d6` remain the 24-file range.

---

## Preview — latest for recovered SHA

| Item | Value |
| --- | --- |
| GitHub Preview deployment | `6513719194` created 2026-09-17T22:53:42Z (supersedes `6513474770` / `a81d9d6`) |
| Vercel inspector | `https://vercel.com/in-zone-s-projects/inzone-games/66S9KUUztdS6eCAAZSqXeLgG25wi` (status SUCCESS) |
| Immutable URL | `https://inzone-games-c2ggxt6nu-in-zone-s-projects.vercel.app` |
| Git alias | `https://inzone-games-git-claude-combined-veri-e5c41d-in-zone-s-projects.vercel.app` |
| Source SHA | `72dc08db2a2aa15e471f2a8e49373c6e9bca4d37` |
| Hosted catalogue/game load | **UNVERIFIED** — immutable host SSO 302. `VERCEL_AUTOMATION_BYPASS_SECRET` is unset here. Do **not** assume the old Preview Firebase gap persists; inlined config was not inspected on this deployment. |

---


## Hexclave replays since Claude’s report — unresolved

Device-code `hexclave login` was started in this VM more than once. Each code expired before `whoami`. `npx hexclave whoami` remains logged out. No `listSessionReplays`. **Do not treat iframe contents as categorically absent from replay** — capture coverage was not re-measured. Fresh production-replay comparison since Claude’s report is **blocked on login**, not on a disabled replay product.

Live production (below) is independent of that pull: games load on `29ae3b7`. The strongest visitor-facing defects remain the iPhone-UA install banner covering the hamburger, fabricated PLAYING pills, duplicate CTAs, and markdown `%60**` 404s. Those are still on `main`. PR #30 is not Production.

---

## Production-health verdict

**Not a widespread production regression.** Games load and are playable in Chromium against `https://www.inzone.games` on production SHA **`29ae3b7`** (GitHub Production deployment `6471188268`, created 2026-09-16T00:28:29Z). PR **#30 is not deployed.**

### What production actually is

| Fact | Evidence |
| --- | --- |
| Production SHA | `29ae3b7` / GitHub environment `Production` 2026-09-16 00:28 UTC. Preview deploys exist for #25–#30; none of those SHAs are Production. |
| Catalog | 101 game cards. Firebase web config is inlined in `265-b503a79371871e43.js`. |
| Games load | Ovo 2 (`/gcs/games/ovo-inzone-production-2/v1/index.html`) canvas 1196×800. Nightclub Showdown v2 canvas + “Click anywhere to start”. Flappy Bird v9 title screen with START/SCORE. Same-origin iframe `contentDocument` reachable. |
| Back / change game | Desktop and iPhone-emulation: Home and browser Back return to `/games` with 101 cards; second game (Nightclub) loaded. |
| Device label | Desktop = headless Chrome 148 at 1280×800. Mobile = Playwright iPhone 390×844 UA + touch. **Not a physical device.** |

### Confirmed production defects (still on `main`)

1. **Install banner intercepts catalog navigation on iPhone UA.** `[role=dialog][aria-label='Install InZone']` covers the hamburger. Playwright click on `.mobile-menu-btn` timed out: “element intercepts pointer events”. Footer store links remain visible underneath. Screenshot: `scripts/.hexclave-out/prod-health/catalog-iphone-emulation/01-catalog-iphone-emulation.png` (gitignored).
2. **Fabricated PLAYING pills** still on production (8600, 7884, 8473, … on 2026-09-17 iPhone-emulation). #26 + freshness filter are in this branch; not shipped.
3. **Duplicate session CTAs** on every solo player: “Play with a friend” + “Invite”. #28 removes the duplicate; not shipped.
4. **Markdown URL 404.** `/games/nightclub-showdown-inzone-production%60**` shows “Couldn't load game”. #25 fixes this; not shipped.
5. **Home rail is `/`.** That route is a spinner that `router.replace`s to `/games`. This branch points Home at `/games` directly.

### What is *not* proven

- A blank iframe in a Hexclave replay is **not**, by itself, proof the visitor saw a blank game. Replay capture of same-origin iframe canvas was **not re-measured** (login expired before `listSessionReplays`).
- Missing `game_start` is **not** proof the visitor did not play. Flappy `game_start` is first flap on **v9 only** (`lib/flappy-gameplay-adapter.ts` fails closed on other paths). Nightclub `progress`/`start` still comes from the bridge + fingerprint change after a hero exists — treat boot-triggered Nightclub starts separately from Flappy flaps; do not mix versions in one cohort.
- Center-clicking Flappy’s sky does not press START. START is a PlayCanvas sprite (`Start Button` at worldToScreen ≈ 474,633 on a 1196×800 canvas). Mapping that entity leaves the menu (`getready` then play/dead). DOM `getByText("START")` is the earlier automation miss, not a player-facing blank game.
- Firestore `Listen/channel` `ERR_ABORTED` appeared during navigation. Catalog still populated; treat as channel replace, not an outage.
- **Hexclave replay pull for sessions after Claude’s report is blocked** until a device-code login completes **in this environment**.
- Firestore `Listen/channel` `ERR_ABORTED` appeared during navigation. Catalog still populated; treat as channel replace, not an outage.
- **Hexclave replay pull for sessions after Claude’s report is blocked** until a device-code login completes **in this environment**.

### Recovery

No production rollback is indicated. The smallest recovery for the navigation complaint is shipping #27 (banner off the playing journey) **plus** a non-overlay Get-the-app path (this branch), not reverting `29ae3b7`.

---

## This branch (on top of #25–#28)

Continues the combined release instead of duplicating it.

| Change | Why |
| --- | --- |
| Player Home rail → `/games` | Avoids the `/` spinner hop. |
| Hub lede + **Get the app** in the Game Hub header | Banner suppression must not erase the path to the app. |
| Optional Get-the-app block inside the social sheet | After Invite/Chat, not over the canvas. |
| Rail App toast + AppsFlyer `pid=web_get_app` handoff | Desktop-to-phone copy; reuses existing OneLink. |
| `app_cta_view` / `app_cta_click` | Interest only. **Clicks are not installs.** Not sent to Meta. |
| Hexclave inspect/query/journey/summarise scripts copied from `claude/sleepy-mayer-6o92o9` | So the next session can pull replays without that branch. |
| `scripts/prod-health.mjs` | Production reproduction against `www.inzone.games`. |

### Exact copy

- Hub lede: “Discover games. Play instantly. Bring your friends.”
- Hub benefits: “The optional InZone app adds 3D avatars and the native social hub.”
- Panel: “A social gaming superapp with 3D avatars, friends, and the native hub on your phone.”
- Handoff limit (in the Get-the-app panel, not the hub lede): “Browser scores and progress stay in this tab.”

### PLAYING pill

Open `html_games/{id}/sessions` rows are **not** current-player counts. Hub pills now count only `status == 'open'` rows with `updated_at`/`opened_at` inside 15 minutes (`LIVE_SESSION_FRESHNESS_MS`). Missing timestamps, stale opens, and far-future stamps hide the label (count 0).

**Writer:** Flutter writes `opened_at` / `updated_at` on those docs (`lib/players.ts`). This website does **not** heartbeat into `html_games/{id}/sessions`. Web play-sessions live in a different collection (`lib/play-session.ts`) and do not increment the hub pill. No web writer was added (would mix guest web seats into Flutter session docs; Firestore rules unchanged). Hiding unsupported “playing” claims is the honest web behavior.

Local hub sample after the filter: **no pills**. Production `main` still shows fabricated four-digit pills.

### App CTA privacy

`app_cta_view` / `app_cta_click` go through `trackCampaignEvent` → `sanitizeData` → Hexclave batch sanitizer (`wrapHexclaveAnalyticsTransport` + outbound fetch sanitizer). `cta_surface` is allowlisted (`hub_nav`, `social_invite`, `player_rail`, `footer`). Session/invite keys and 32-char hex ids are dropped. Invite URLs are rejected as `cta_surface`. Meta still only receives verified gameplay events — app CTA is interest, not gameplay. OneLink handoff omits `session` / `invite`. This repo has **no GDPR consent gate**; privacy here is sanitizer + Meta allowlist, not a consent banner.

### OneLink (re-probed 2026-09-17)

- App Store listing HTTP 200, title `InZone. App - App Store`.
- Play listing HTTP 200, og:description names 3D avatars / social superapp.
- Chrome desktop OneLink 301 → apps.apple.com (200). Safari desktop UA stays on `join-inzone.onelink.me` (200). **Not** iOS/Android verification.
- iPhone UA: OneLink 301 → apps.apple.com → `itms-appss:` (store scheme; not proof the App Store app opened).
- Android UA: OneLink 301 → `market:` (Play scheme; curl cannot follow; not proof an installed app opened).

### Local browser evidence (Chrome 148, `http://127.0.0.1:3001`, **not** hosted preview)

Nightclub click-to-start changed the stage (view hash + in-game art). Flappy START is a PlayCanvas sprite; clicking `Start Button` via `camera.worldToScreen` left the menu (`getready`) and flaps produced `play`/`dead` with a Game Over score of 1. Two guests (`ShadowPhoenix64` / `HyperWizard47`) joined, exchanged persisted chat (`alpha-ping-…` / `bravo-pong-…`), suggested Ovo 2 without switching B, selected Nightclub vs Flappy independently, survived refresh (membership+chat+games), and A leave dropped `session=` while B stayed on Flappy. After leave, A’s sheet is the solo invite UI (old messages gone; compose is a new empty invite, not the prior room).

Portrait → landscape on Flappy: iframe 390×786 → 791×390 (emulated; not a physical device). Malformed `%60**` loads Nightclub locally.

### Verified app benefits (and gaps)


Verified 2026-09-17:

- App Store `id6478089068` HTTP 200, title `InZone.` by INZONE, INC.
- Play `com.aadeshkheria.inzone` HTTP 200. og:description: “A Social gaming superapp built around AI ,3D Avatars, and mindful use.”
- OneLink `https://join-inzone.onelink.me/SACg` exists. Desktop GET followed to the App Store. Android UA 301 toward a non-https scheme (`inzone://` / intent) — curl cannot follow; that is **not** proof an installed app opened.
- Deep link shape `inzone://game?gameId=…` + `deep_link_value=community_game` is in this repo (`lib/games.ts::gameShareLink`). **Not verified** that a live install actually opened that game.

**Do not claim:** transferred web progress, session continuity, shared scoring, synchronized multiplayer.

### Placement

- Desktop hub: header right, next to Refresh / Upload (`data-testid=get-app`). Popover, not a top banner.
- Mobile hub (emulated): same header wraps; popover opens below the button. Footer App Store / Play / Discord stay.
- Player: rail App (existing). Home → `/games`. After Chat/Invite opens, a Get-the-app line at the bottom of the social sheet.

---

## Measurement

| Signal | Status |
| --- | --- |
| Verified gameplay (`game_start`, `engaged_play`, `first_game_over`, `return_play`) | Unchanged. Meta still only these. Nightclub `game_start` remains a boot proxy in meaning (adapter fires on run-id change) — see Claude rev. 2; do not relabel it a verified start of play. Flappy `game_start` is first flap (PR #24 / `85d1c0b`). |
| Social interest | Existing `invite_*`, `session_message`. |
| App CTA impressions | `app_cta_view` (`cta_surface`). |
| App CTA clicks | `app_cta_click` (`cta_surface`, `outcome` apple/play/phone_link/share). **Not an install.** |
| Actual installs / app activation | AppsFlyer OneLink (`pid=web_get_app` vs existing `social_share`). **Not readable from this web repo.** Blocked without AppsFlyer dashboard access. |
| Hexclave 30-day funnel | Last durable numbers are Claude rev. 2 on `claude/sleepy-mayer-6o92o9`. Re-query blocked until `hexclave login`. |

---

## Access this session

| Dependency | Result |
| --- | --- |
| GitHub `inzonesm/inzone-games` | This Cloud Agent is bound to that repo. Recovered commit **pushed**. PR **#30** updated on `claude/combined-verification`. |
| Production `www.inzone.games` | Reachable. SHA `29ae3b7`. |
| Playwright-core | **1.63.0**. Browser: system `google-chrome` 148, not Playwright’s bundled Chromium. |
| Vercel preview | SSO 302 on alias + immutable URL for `72dc08d`. Firebase inlining **UNVERIFIED** (no bypass secret). |
| Hexclave project `463bba54-7ccd-4570-acb7-0dc8f5123e7e` | CLI 1.0.112. Device-code login in this VM expired before `whoami`. |
| Network | Egress unrestricted. Failures above are auth, not proxy denial. |

**Owner action for Hexclave:** in a terminal on this repo run `npx hexclave login`, complete the printed `https://app.hexclave.com/handler/cli-auth-confirm?login_code=…` URL, then `npx hexclave whoami`. Do not paste tokens into chat.

---

## Tests

```
node --experimental-strip-types --test \
  tests/gameplay-signals.test.mjs \
  tests/gameplay-boundaries.test.mjs \
  tests/campaign-analytics.test.mjs \
  tests/flappy-gameplay.test.mjs \
  tests/game-display.test.mjs \
  tests/games-live-count.test.mjs \
  tests/live-player-count.test.mjs \
  tests/install-prompt-suppression.test.mjs \
  tests/app-links.test.mjs
```

70/70 pass became **76/76** after freshness + CTA tests. `npm run typecheck` clean.

Local browser verification (`scripts/session-evidence.mjs` + `scripts/local-verify.mjs`, Chrome 148, `PORT=3001 npm run dev:inner`, public production Firebase web config in gitignored `.env.local`):

- Hub iPhone-emulation: no install banner, 101 cards (DOM count after load), Get the app + store popover, progress limit on the panel, lede “Discover games. Play instantly. Bring your friends.” PLAYING sample none (freshness filter).
- Nightclub: click-to-start entered the in-game stage (screenshot hash changed).
- Flappy: PlayCanvas `Start Button` worldToScreen click → `getready`; flaps → Game Over. Earlier `getByText("START")` / misaligned clip is automation, not a blank game.
- Two guests: actual Join (`ShadowPhoenix64` / `HyperWizard47`), two-way persisted chat, suggest Ovo 2 without autoswitch, independent Nightclub vs Flappy, refresh restored membership+chat+games, leave revoked A’s `session=` while B stayed.
- Orientation (emulated): Flappy iframe 390×786 → 791×390.
- Malformed `%60**` loads Nightclub.

Hosted preview journeys: **UNVERIFIED** (SSO). Physical devices: **UNVERIFIED**.

---

## Remaining release blockers

1. Hosted preview: provide `VERCEL_AUTOMATION_BYPASS_SECRET` (or disable SSO for this preview) so catalogue/game load can be checked on `inzone-games-c2ggxt6nu-in-zone-s-projects.vercel.app` at SHA `72dc08d`. Do not assume the old Firebase gap.
2. Hexclave device-code login **in this VM** for replays after Claude’s report.
3. Flutter still fabricates PLAYING counts.
4. Broken-bundle recovery (`iframe.onload` on empty shell) still deferred.
5. No GDPR consent banner in this repo; app CTA privacy is sanitizer + Meta allowlist only.

**Release recommendation:** keep PR **#30** draft. Do **not** merge or deploy production until hosted preview catalogue→game is verified on the immutable URL above. Local evidence says the combined branch is playable and the Get-the-app path is intact. No production rollback — `29ae3b7` still loads games; ship #30 after hosted acceptance.

**Next development priority after this release:** docs-only analytics correction (`claude/sleepy-mayer-6o92o9`) so Nightclub boot vs Flappy v9 flap are not mixed, or verified adapters for games with only `game_open`. Do not turn Meta ads on.

**Nothing merged. Nothing deployed to production.**

---

# Previous handoff — Claude → Codex (2026-09-17)

The following is Claude’s original text, kept so later agents can see what was already verified on `47f310f` / `416ec8c`. Dates and preview IDs in that section are as of that session.

## Repository state

- **Repository:** `inzonesm/inzone-games` (default branch `main`).
- **Combined-verification branch:** `claude/combined-verification`.
- **Combined branch head at Claude handoff:** `47f310fec35e111c4a005e20973f017bc33db29c`, then docs commit `416ec8c`.
- **`main` head:** `29ae3b7` (`Merge pull request #24 from inzonesm/codex/flappy-gameplay-tracking`).
- **Release PR (draft):** `#30` — https://github.com/inzonesm/inzone-games/pull/30 — base `main`, head `claude/combined-verification`.
- **Individual PRs (draft, superseded by #30 — do NOT merge alongside):** `#25`, `#26`, `#27`, `#28` were closed without merging after `#30` landed on `main` as `d5a1bd5`. Docs-only `#29` closed without merging; findings below.

### Neon Blaster (#29) — unreproducible MIME failure

Investigation (PR #29, `dd32ecf`): 15/15 curl requests to `/gcs/games/neon-blaster-inzone-production/v3/game/runtime/bb.js` returned HTTP 200 `application/javascript`, including the first `x-vercel-cache: MISS`. Five fresh Playwright contexts did not reproduce `Content-Type: text/plain`. The 2026-09-17 observation remains unreproducible. No speculative `/gcs` Content-Type pin. Do not remove Neon Blaster from the catalog to dress metrics. Follow-up is Hexclave replay watch if the failure returns.

## Vercel deployment (Claude)

- **Preview URL (branch alias):** `https://inzone-games-git-claude-combined-veri-e5c41d-in-zone-s-projects.vercel.app`.
- Later GitHub Preview deployment for `416ec8c`: `6509799993` / Vercel check `75M8fAMQ4hDNi3TDUvT2vsNY2MJE`.
- **Deployment protection:** `VERCEL_AUTOMATION_BYPASS_SECRET` as `x-vercel-protection-bypass` only for the preview host.

## Implemented changes in the combined release

Four runtime code changes merged into `claude/combined-verification`:

| PR | Head | Summary | Load-bearing constraint |
| --- | --- | --- | --- |
| #25 | `claude/fix-game-display-name` | `fallbackGameName` + `normalizeGameIdFromRoute`. | Never rewrites a stored name once Firestore returns. |
| #26 | `claude/remove-inflated-player-count` | Delete fabricated PLAYING counts. | Flutter mirror still fabricates. |
| #27 | `claude/no-install-banner-initial-journey` | Suppress auto banner on `/`, `/games`, `/games/[id]`. | Never requires installation. |
| #28 | `claude/play-first-solo-arrival` | One Invite, keep Chat. | SocialPanel open/close does not remount the iframe. |

## Claude’s preview / local results

See the original checklist: preview Firebase env gap blocked hosted game load; local `next dev` on `47f310f` passed catalog→game→back, one Invite + Chat, no fabricated counts, chat toggle preserves iframe, partial two-guest checks. Broken-bundle recovery and session-count freshness remain follow-ups.

## Proposed release plan (unchanged)

Squash-merge the combined branch into `main` only after hosted preview acceptance. Close #25–#28 as superseded. Do not merge both. Rollback via revert or Vercel Instant Rollback — never force-push `main`.
