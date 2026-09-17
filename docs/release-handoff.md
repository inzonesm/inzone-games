# Release handoff — combined-verification → Codex

**Author:** Claude (session ending, credit budget low).
**Date:** 2026-09-17.
**Target audience:** the Codex agent taking over verification and release.

## Repository state

- **Repository:** `inzonesm/inzone-games` (default branch `main`).
- **Combined-verification branch:** `claude/combined-verification`.
- **Combined branch head:** `47f310fec35e111c4a005e20973f017bc33db29c`.
- **`main` head:** `29ae3b7` (`Merge pull request #24 from inzonesm/codex/flappy-gameplay-tracking`).
- **Release PR (draft):** `#30` — https://github.com/inzonesm/inzone-games/pull/30 — base `main`, head `claude/combined-verification`.
- **Individual PRs (draft, superseded by #30 — do NOT merge alongside):** `#25`, `#26`, `#27`, `#28`. Docs-only `#29`. See "Individual PRs" table below.

## Vercel deployment

- **Vercel project:** `in-zone-s-projects/inzone-games`.
- **Preview URL (branch alias):** `https://inzone-games-git-claude-combined-veri-e5c41d-in-zone-s-projects.vercel.app`.
  - This is the git-alias URL that will rotate to a newer deployment whenever the branch receives a push. As of 2026-09-17 no push has been made since PR #30 was opened, so this alias resolves to deployment `BLxhD6JyqYirBP7J6fLS6JiJqCnf`.
- **Deployment ID:** `BLxhD6JyqYirBP7J6fLS6JiJqCnf` (Vercel dashboard inspector: `https://vercel.com/in-zone-s-projects/inzone-games/BLxhD6JyqYirBP7J6fLS6JiJqCnf`).
- **Verified source commit for that deployment:** `47f310fec35e111c4a005e20973f017bc33db29c`. Confirmed by diffing preview vs production JS chunks — only `138-*.js` and `265-*.js` hashes differ (build-time env substitution), all other chunk hashes match. The code content is identical to the branch head.
- **Deployment protection:** enabled with an automation bypass secret. Codex must have `VERCEL_AUTOMATION_BYPASS_SECRET` in its environment to access the preview. Send it only as `x-vercel-protection-bypass` on requests whose host equals the preview host — never to `www.inzone.games`, `firebasestorage.googleapis.com`, or any third party.

## Implemented changes in this release

Four runtime code changes merged into `claude/combined-verification`:

| PR | Head | Summary | Load-bearing constraint |
| --- | --- | --- | --- |
| #25 | `claude/fix-game-display-name` @ `6c093069...` | `fallbackGameName(id, storedName)` + `normalizeGameIdFromRoute(raw)`. Boot title reads a real name in the pre-Firestore window; `%60**` and other trailing-punctuation URL corruption resolves instead of 404-ing. | Respects `lib/session-prototype.ts::displayGameName` — never rewrites a stored name once Firestore returns. |
| #26 | `claude/remove-inflated-player-count` @ `ecaba3ad...` | Delete `INFLATED_PLAYER_UPLOADER_ID`, `INFLATED_WINDOW_MS`, `fnv1a32`, `inflatedPlayerCount`. Live-count query is the sole source. Regression test locks the honesty contract by asserting the fabrication markers are absent from source. | Flutter mirror still fabricates; tracked as a separate follow-up. The two platforms diverging in the interim is preferable to lying. |
| #27 | `claude/no-install-banner-initial-journey` @ `7d8df6d5...` | `isOnPlayingJourney(pathname)` suppresses the auto banner on `/`, `/games`, `/games/[id]`. Banner remains available on non-journey routes. User-initiated App Store / Google Play path preserved in catalog footer. | Never adds a replacement automatic overlay. Never requires installation. |
| #28 | `claude/play-first-solo-arrival` @ `2c7b0cd7...` | One `player-invite` action, one `player-chat` chip. Both `Play with a friend` buttons removed. `data-testid=player-invite` replaces the old ids; the existing browser test drives the new selector. | `socialOpen` is separate from `reloadKey`; opening/closing the SocialPanel does NOT bump the iframe key. Verified live. |

Docs-only, not in this release commit:

- `#29` — `claude/investigate-neon-blaster` @ `dd32ecf...` — investigation, no runtime change.
- `claude/sleepy-mayer-6o92o9` @ `e9354a15...` — analytics correction (rev. 2) + reusable Hexclave scripts + `docs/hexclave-findings-2026-09-17.md`.

## Reusable browser verification scripts

Committed under `scripts/`. Every one respects the "no secrets in git" contract — bypass secrets and Firebase config come from env vars only.

| Script | Purpose |
| --- | --- |
| `scripts/preview-verify.mjs` | Release-acceptance checks against a bypass-protected preview URL, plus optional local-scope checks against `next dev` on the same commit. Writes screenshots and `results.json` under `OUT_DIR` (defaults to `scripts/.hexclave-out/verify`, gitignored). |
| `scripts/preview-diag.mjs` | Diagnoses an empty-catalog preview: reproduces the UI state, captures console + network errors, and scans every deployed JS chunk for `.env.NEXT_PUBLIC_*` references that were left UNRESOLVED at build time. Never echoes secret values — only shape counts and env-var names. |
| `scripts/hexclave-inspect.mjs` | Read-only Hexclave session-replay retrieval. On branch `claude/sleepy-mayer-6o92o9`. |
| `scripts/hexclave-analytics-query.mjs` | Preset analytics queries. Same branch. |
| `scripts/hexclave-journey-record.mjs` | Playwright driver for six production journeys. Same branch. |
| `scripts/hexclave-summarise.mjs` | Reduces raw rrweb events to `findings.jsonl`. Same branch. |

### Exact commands

```bash
# Prereqs (do NOT commit any of these values):
export VERCEL_AUTOMATION_BYPASS_SECRET=<from Vercel dashboard, or ask the operator>
export PREVIEW_URL=https://inzone-games-git-claude-combined-veri-e5c41d-in-zone-s-projects.vercel.app

# Bounded smoke check (this is the one the operator authorizes after fixing envs):
node scripts/preview-verify.mjs

# Diagnose an empty catalog on the preview:
node scripts/preview-diag.mjs

# Optional: run local-scope checks in parallel by starting `next dev` from
# the SAME checkout (VERCEL commit sha 47f310f) with real Firebase envs
# scoped locally (never commit the .env.local file):
cp .env.local.example .env.local
# ...fill in NEXT_PUBLIC_FIREBASE_API_KEY and NEXT_PUBLIC_FIREBASE_APP_ID from
# a private source (Vercel dashboard, Firebase console, or 1Password)...
PORT=3001 npm run dev:inner &
export LOCAL_URL=http://127.0.0.1:3001
node scripts/preview-verify.mjs

# Existing load-bearing measurement tests still gate the release:
node --experimental-strip-types --test \
  tests/gameplay-signals.test.mjs \
  tests/gameplay-boundaries.test.mjs \
  tests/campaign-analytics.test.mjs \
  tests/flappy-gameplay.test.mjs
# Expected: 49/49 pass

# New tests added by this release:
node --experimental-strip-types --test \
  tests/game-display.test.mjs \
  tests/games-live-count.test.mjs \
  tests/install-prompt-suppression.test.mjs
# Expected: 16/16 pass
```

## Verification results as of 2026-09-17

Recorded verdicts for the release-checklist journeys. Every result is on the code at commit `47f310f`; scope is `[preview]` for direct hosted checks, `[local]` for `next dev` on the same commit with a hand-scoped Firebase config.

### Preview scope (deployment `BLxhD6JyqYirBP7J6fLS6JiJqCnf`, SHA `47f310f`)

| Check | Verdict | Note |
| --- | --- | --- |
| Install banner absent on `/games` | PASS | Selector `[role='dialog'][aria-label='Install InZone']` count = 0 |
| Install banner absent on `/games/[id]` | PASS | Same selector |
| Install banner available on non-journey `/manage` | PASS | iOS branch renders it |
| User-initiated install path in catalog footer | PASS | 1× `apps.apple.com` + 1× `play.google.com` visible even on empty catalog |
| Catalog renders game cards | **BLOCKED — preview Firebase env gap** | See "Firebase preview blocker" below |
| A card opens a game whose iframe visibly renders | **BLOCKED — same** | |
| Route normalizer strips `%60**` | UNVERIFIED on preview | 11 unit-test assertions on the same code pass on `main` and the branch. Cannot be exercised on preview until Firebase envs land. |

### Local scope (`next dev` on `47f310f`, hand-scoped envs)

| Check | Verdict | Note |
| --- | --- | --- |
| Catalog → game → back preserves navigation | PASS | Entered `/games/ovo-inzone-production-2`; back returned to `/games` with all cards |
| Solo arrival has one Invite action + accessible Chat | PASS | `player-invite` count = 1; `player-chat` count = 1; zero `play-with-friend*` |
| Boot title is a real name pre-Firestore-resolve | PASS | Fallback to id-derived form works when `game` is null |
| Chat toggle preserves iframe instance | PASS | `iframe.contentWindow.__markVerify` unchanged across open→close cycle |
| Two guests: invite URL emitted, Join button on Guest B | PASS | 105-char session URL in Guest A clipboard; `Join session` on B |
| Two guests: A switches games, B stays | PASS | B URL unchanged after A's navigation |
| Two guests: A reloads, session persisted | PASS | `?session=` retained after `page.reload()` |
| Two guests: A leaves, B continues | PASS | B's `.game-frame-shell` still rendered after A closed |
| No fabricated `PLAYING` counts | PASS | 23 pills observed; every value < 999 (source: `getCountFromServer(status='open')`) |
| Portrait → landscape → portrait rotation | PASS (emulated only) | iframe dimensions 390×786 → 791×390 → 390×786; `__rotateMark` stayed 1 |
| Loading recovery — Firestore fetch fails | PASS | `Couldn't load game` header + `Retry` button on Firestore-abort |

Screenshots for the passing checks are under `scripts/.hexclave-out/verify/` on the container that ran them (gitignored). Rerunning the script above regenerates them.

## Incomplete or blocked checks

### Firebase preview blocker (must be resolved before hosted acceptance)

The Vercel Preview scope does **not** carry any of the six `NEXT_PUBLIC_FIREBASE_*` variables. All checks that need a game to actually load on the preview URL return the same error state: `"Missing Firebase web config. Copy .env.local.example to .env.local and fill in NEXT_PUBLIC_FIREBASE_API_KEY and NEXT_PUBLIC_FIREBASE_APP_ID."` This is the exact string thrown by `lib/firebase.ts::ensureApp` (line 46) — the runtime never called Firestore because the SDK init threw first.

Evidence: `scripts/preview-diag.mjs` inspected every JS chunk on the preview and found unresolved `process.env.NEXT_PUBLIC_FIREBASE_*` references. The production build's `265-*.js` chunk contains the values inlined; the preview's differs only by env-substitution shape.

**Required Vercel action (no code change).** In Vercel dashboard → Settings → Environment Variables, extend each of these six variables to the **Preview** scope (Production only today):

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`

Values are identical to Production. These are Firebase Web SDK **public** values that ship to every browser and are not secrets under Firebase's security model. Firestore rules and Auth are unchanged.

Then force a fresh build for the `claude/combined-verification` branch (Vercel → Deployments → Redeploy, **uncheck** "Use existing Build Cache" so `NEXT_PUBLIC_*` values get inlined at build time). The new deployment will get a new ID; the git-alias URL remains the same.

### Remaining two-guest acceptance checks (not yet PASS)

Attempted locally; UNVERIFIED because the `player-chat` click on Guest B (desktop context, mocked touch off) timed out despite the button being present in the DOM. Requires either a real second phone or a headed browser to complete:

1. Guests exchange one message each. Verifier condition: message text appears in the other guest's DOM within a small timeout.
2. Guest A opens the "Suggest a game" step. Verifier condition: Guest B's URL does not change on its own.
3. On real phones, Guest B does not observe a game iframe remount when Guest A opens or closes the SocialPanel (already PASS on solo; two-guest confirmation still pending).

### Analytics report corrections deferred

The corrected report at `docs/hexclave-findings-2026-09-17.md` (rev. 2, on branch `claude/sleepy-mayer-6o92o9`) is the durable baseline. Not yet on `main`. Merge order and deploy behaviour for that branch:

- Docs-only. Zero runtime effect. Safe to merge at any time.
- Recommend merging **before** the release commit so the "why" of the release is checked in alongside it. If merged first, it triggers one Vercel deploy of a docs change (no runtime effect).
- After Codex confirms Preview envs are configured, this branch can be rebased or merged as-is.

## Outstanding open questions

### Broken-bundle recovery

When the game iframe's HTML/JS bundle is corrupted or blocked (Neon Blaster's transient `text/plain` MIME error was one instance), Chromium still fires `iframe.onLoad` on the broken-file shell. The host page's `noteFrameLoaded()` then runs, dismisses the boot overlay, and the `STALL_AFTER_MS=20000` timer is never armed. Result: the `Try again` / `Back to games` affordances inside the boot overlay do not appear. The `game-rail` **Home** button remains visible throughout and is the visitor's escape.

- **Not caused by this release.** Present on `main` today.
- **Reproduction:** `route.abort()` the game bundle in Playwright. Boot dismisses immediately; recovery UI stays hidden.
- **Follow-up options for a subsequent PR (do NOT bundle into this release):**
  1. Detect the iframe's document body being effectively empty (e.g., no canvas, no scripts, no non-whitespace) within N seconds of `onLoad` and transition to `frameFailed`.
  2. Poll the iframe's contentDocument for a heartbeat from the game bundle and treat its absence past a threshold as failure.
  3. Widen the rail Home button's visibility on the boot overlay itself so the escape hatch is always obvious.

Deferred to Codex or a subsequent human owner; document decisions in a fresh PR.

### Player-count freshness question

`fetchLivePlayerCount` returns whatever `getCountFromServer(html_games/<id>/sessions where status='open')` reports. On the local dev walk, this returned realistic small numbers (1, 2, 3, 5, 11, 15, 16 playing). Two of those (15, 16) are higher than the 30-day unique-user total for those games, which suggests **stale `open` session documents** — sessions not being closed when users leave without a clean navigation.

- The fabrication is confirmed removed (regression test in place); the source is now genuine.
- Session hygiene is a separate concern: the Firestore document at `html_games/<id>/sessions/<sessionId>` needs a reliable path to `status='closed'` when a user leaves, times out, or crashes. Current code paths I did not trace fully: browser `beforeunload`, tab crash, network drop, Cloud Function TTL.
- **Question for Codex or the operator:** should the release ship as-is (honest but possibly-stale counts) or should session hygiene land alongside (potentially delaying the release)? Recommendation: ship as-is, file the hygiene question as a follow-up.

## Proposed release plan (unchanged since 2026-09-17)

**Constraint:** every push to `main` auto-deploys to production. One release = one push.

**Recommended path:** squash-merge `#30` into `main` after Codex confirms the preview passes hosted acceptance. Close `#25`, `#26`, `#27`, `#28` as superseded (they are contained in `#30`). `#29` and `claude/sleepy-mayer-6o92o9` are docs-only and may be merged separately at any time.

### Merge order

1. (Optional but recommended) merge docs branches first: `#29`, then `claude/sleepy-mayer-6o92o9`. These are documentation-only and each triggers one no-runtime-effect deploy. Or bundle them into `#30` to keep the deploy count at one.
2. Once Codex confirms the smoke check passes (see below): squash-merge `#30` into `main`.
3. Close `#25`, `#26`, `#27`, `#28` as **superseded by #30**. Do **not** merge both.
4. Vercel auto-deploys the release commit. Monitor the dashboard until Ready.

### Rollback procedure

1. Open the release commit on `main` in GitHub → click **Revert**. Or via CLI: `git revert -m 1 <release_sha>` then push.
2. The revert push triggers a new Production deploy. Rollback lands within ~2 minutes.
3. If Vercel supports Instant Rollback on this project, that is faster: promote the previous production deployment from the Vercel dashboard.
4. **Do not** force-push `main` or `reset --hard` on the shared branch.

### Post-deploy smoke checks (against `https://www.inzone.games`)

After the release commit's Production deploy shows Ready:

1. `curl -sSI https://www.inzone.games/games | grep -iE "^HTTP"` — expect `HTTP/2 200`.
2. iPhone-sized Playwright viewport on `/games`: no "Get the InZone App" banner across the top, no card carries a four-digit PLAYING pill.
3. `/games/flappybird-inzone-2?utm_source=meta`: `player-invite` count = 1, `play-with-friend*` count = 0, boot title is a real name (not "Loading game").
4. `/games/nightclub-showdown-inzone-production%60**` resolves to Nightclub Showdown.
5. 15 minutes post-deploy: `node scripts/hexclave-analytics-query.mjs event-types 1` returns non-zero for `$page-view`, `$click`, `$token-refresh`.
6. If any of 1–5 fail: revert immediately.

**Nothing has been merged. Nothing has been deployed. All work remains queued.**

## Codex pickup instruction

Codex: pick up on branch **`claude/combined-verification`** (head `47f310fec35e111c4a005e20973f017bc33db29c`), read **`docs/release-handoff.md`** in full, then wait for the operator's go-signal that Vercel Preview envs have been fixed. When the operator says the fix is in, run the bounded smoke check exactly as described under "After I finish Preview configuration…" in the operator's original instruction: verify the catalog renders, a game opens, and input works on the newly rebuilt preview. Record the result and the exact deployed SHA in a new comment on PR #30. Do NOT re-run the full release suite; do NOT start any unrelated improvements. Do NOT merge or deploy without the operator's explicit approval.
