# Release handoff — Cursor continuation (2026-09-17)

**Author:** Cursor agent taking over from Claude.
**Branch:** `cursor/continue-release-d672` (cut from `claude/combined-verification` @ `416ec8c`).
**HEAD:** includes `469d7de`, `f8ee6ab`, and later local commits. **Not on GitHub.**
**Does not merge or deploy production.**

Claude’s original handoff is preserved below this update. `main` is still `29ae3b7`.

---

## Publication — blocked (do not treat as shipped)

Git push of this branch returns **403** from `cursor[bot]` to `inzonesm/inzone-games`. This Cloud Agent environment is bound only to `github.com/JaymeKame/Little-Chapters`. The GitHub App token accepted permission for inzone-games is **metadata=read**; Contents/PR write are all false.

**Owner change required:** install/grant the **Cursor GitHub App** on **inzonesm/inzone-games** with **Contents: Read and write** and **Pull requests: Read and write**, then re-run the agent **from that repo** (or add it to the Cloud Agent environment). Do not retry a denied push from this environment.

While access is unresolved, a verified git bundle is the saved copy of the branch:
`cursor_continue_release_d672_30e93a0.bundle` (and later HEAD bundles). Restore with `git clone <bundle>`.

**PR #30:** still draft on `claude/combined-verification` @ `416ec8c`. This branch is the same lineage plus follow-up commits — it should **update #30**, not open a second competing PR. That retarget cannot happen until push works.

---

## Preview Firebase — UNVERIFIED

Latest GitHub Preview deployment remains **`6509799993` / SHA `416ec8c` / 2026-09-17T18:47:04Z** (Vercel `75M8fAMQ4hDNi3TDUvT2vsNY2MJE`). Preview host still SSO 302. This environment has no Vercel dashboard token and no `VERCEL_AUTOMATION_BYPASS_SECRET`, so inlined `NEXT_PUBLIC_FIREBASE_*` in that deployment was not inspected. The owner’s claimed env update is **neither confirmed nor denied**.

---

## Hexclave replays since Claude’s report — unresolved

`hexclave login` device-code was started in this environment; the code expires in minutes if not authorized in the same browser session that belongs to this VM. No `whoami`. No new `listSessionReplays`. **Do not treat iframe contents as categorically absent from replay** — that capture behavior was not re-established here.

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
2. **Fabricated PLAYING pills** still on production (2580, 6495, 8884, …). #26 removes this; not shipped.
3. **Duplicate session CTAs** on every solo player: “Play with a friend” + “Invite”. #28 removes the duplicate; not shipped.
4. **Markdown URL 404.** `/games/nightclub-showdown-inzone-production%60**` shows “Couldn't load game”. #25 fixes this; not shipped.
5. **Home rail is `/`.** That route is a spinner that `router.replace`s to `/games`. This session points Home at `/games` directly.

### What is *not* proven

- A blank iframe in a Hexclave replay is **not**, by itself, proof the visitor saw a blank game. Replay capture of same-origin iframe canvas was **not re-measured** in this session (login expired before `listSessionReplays`).
- Missing `game_start` is **not** proof the visitor did not play. Flappy `game_start` is first flap; Nightclub `game_start` fires during boot. Automated Flappy START clicks in this environment stayed on the title screen; Nightclub “click anywhere” **did** enter the in-game stage.
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

Open `html_games/{id}/sessions` rows are **not** current-player counts. Hub pills now count only `status == 'open'` rows with `updated_at`/`opened_at` inside 15 minutes. Missing timestamps and stale opens hide the label. Local hub sample after the change: **no pills** (all open rows were stale or undated).

### App CTA privacy

`app_cta_view` / `app_cta_click` go through `trackCampaignEvent` → `sanitizeData` → Hexclave batch sanitizer. `cta_surface` is allowlisted. Session/invite keys and 32-char hex ids are dropped. Meta still only receives verified gameplay events. OneLink handoff omits `session` / `invite`.

### OneLink (this session)

- App Store listing HTTP 200, title `InZone. App - App Store`.
- Play listing HTTP 200, og:description names 3D avatars / social superapp.
- Chrome desktop OneLink 301 → apps.apple.com. Safari desktop UA can stay on `join-inzone.onelink.me`. **Not** iOS/Android verification.
- iPhone UA: OneLink 301 → apps.apple.com → `itms-appss:`.
- Android UA: OneLink 301 → `market:`. curl cannot complete that hop; not proof an installed app opened.

### Local browser evidence (this session)

Nightclub click-to-start changed the stage from “Click anywhere to start” to in-game art. Two guests joined (`FrostGecko93` / `HyperWalrus67`), exchanged persisted chat, suggested Ovo 2 without switching B, selected Nightclub vs Flappy independently, survived refresh, and A leave removed `session=` while B stayed. Flappy canvas-drawn START was **not** activated by the automation (title screen remained).

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
| GitHub `inzonesm/inzone-games` | Clone/fetch works (public). **Push 403** — `cursor[bot]` Contents write is false. Environment bound to Little-Chapters. |
| Production `www.inzone.games` | Reachable. |
| Playwright-core | **1.63.0** (from `npm ci`). Browser: system `google-chrome` 148, not Playwright’s bundled Chromium. |
| Vercel preview | SSO 302. Latest GitHub Preview still `416ec8c` @ 18:47 UTC. Firebase env **UNVERIFIED**. |
| Hexclave project `463bba54-7ccd-4570-acb7-0dc8f5123e7e` | CLI 1.0.112. Device-code login in this VM expired before `whoami`. |
| Network | Egress unrestricted in this cloud environment. Failures above are auth, not proxy denial. |

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

- Hub iPhone-emulation: no install banner, 101 cards, Get the app + store popover, progress limit on the panel, lede “Discover games. Play instantly. Bring your friends.” PLAYING sample none (freshness filter).
- Nightclub: click-to-start entered the in-game stage (screenshot hash changed).
- Two guests (v3): actual Join, two-way chat, suggest without autoswitch, independent games, refresh restored membership/chat/selected game, leave revoked A’s session query.

---

## Remaining release blockers

1. GitHub: grant Cursor App write on `inzonesm/inzone-games` and bind the Cloud Agent to that repo, then push this branch and **update PR #30** (do not open a second RC).
2. Vercel Preview Firebase/SSO: **UNVERIFIED** from this environment (SSO 302, no bypass secret).
3. Hexclave device-code login **in this VM** for replays after Claude’s report.
4. Flappy canvas START still not driven by the automation; Nightclub click-to-start is the verified input evidence.
5. Flutter still fabricates PLAYING counts.
6. Broken-bundle recovery (`iframe.onload` on empty shell) still deferred.

**Next development priority after this release:** wire a verified adapter or postMessage bridge for montage games that currently have `game_open` without `game_start`, or land the docs-only analytics correction (`claude/sleepy-mayer-6o92o9`) so Nightclub boot vs Flappy flap are not mixed in reports. Do not turn Meta ads on.

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
- **Individual PRs (draft, superseded by #30 — do NOT merge alongside):** `#25`, `#26`, `#27`, `#28`. Docs-only `#29`.

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
