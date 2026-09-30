# Flagship mobile audit — baseline, 2026-09-30

The first run of `scripts/flagship-mobile-audit.mjs` against **production** (`https://www.inzone.games`), after
PR #72 (pinned `/mirror`, touch pads, ad SDKs removed) and PR #73 (Escape Road lifecycle adapter). This is the
baseline future runs compare against.

```
PREVIEW=https://www.inzone.games BYPASS= node scripts/flagship-mobile-audit.mjs
```

Every entry URL carried `inzone_qa=agent`, and every Meta request was aborted and counted, so these runs taught
the ad platform nothing.

## What this is, and what it is not

- **Chromium with touch emulation and an Android UA**, at 390×844 (portrait) and 844×390 (landscape). It is not
  a phone: no GPU throttling, no notch, software WebGL, no in-app WebView (TikTok / Pangle `open_news`, Facebook).
  Frame rate on a low-end Android and behaviour inside a real WebView still need a device.
- **"Responds" means the title's first ordinary action changed what is drawn.** That proves the build took the
  input. It does not prove a round was played.
- **Three runs were combined** (05:04 and 05:06 UTC before #73, and 06:39 UTC after it). This sandbox drops its
  tunnel to `www.inzone.games` often enough to time out whole cells (see CLAUDE.md, "Do not"). Each cell below
  is the clean measurement, with the run it came from. A cell that never came back clean in any run is marked
  *not evaluable here*. That is a fact about this runner, not a verdict on the game. The runner also refuses
  `js.stripe.com`, `apis.google.com` and `firebasestorage.googleapis.com` on every page; none of them is a game
  asset.

## Portrait, 390×844 — where a TikTok arrival lands

| Title | Canvas on stage | Stage filled | Touch controls ≥44px / smaller (DOM) | Landscape prompt | Ad preroll | Safe area | Run |
|---|---|---|---|---|---|---|---|
| Kart Bros | 3.6–4.0 s | 100% | 5 / 9 | fullscreen offered | no | no | A, C |
| Elytra Flight | 3.0 s | 100% | 0 / 0 (drawn in canvas) | fullscreen offered | no | n/a (no DOM controls) | A |
| Karate Bros | 3.9–4.8 s | **28%** | 0 / 3 | fullscreen offered | no | no | A, C |
| Escape Road | 3.2–3.3 s | 100% | **2 / 0** (InZone ◀ ▶ pads) | none needed | no | **yes** | A, B |
| Nightclub Showdown | *not evaluable here* | 17%¹ | 0 / 2 | fullscreen offered¹ | no | no¹ | — |

## Landscape, 844×390

| Title | Canvas on stage | Stage filled | Touch controls ≥44px / smaller (DOM) | Ad preroll | Safe area | Run |
|---|---|---|---|---|---|---|
| Kart Bros | 3.0 s | 100% | 1 / 13 | no | no | A |
| Elytra Flight | 2.8 s | 100% | 0 / 0 (drawn in canvas) | no | n/a | A |
| Karate Bros | 3.4 s | 100% | 0 / 3 | no | no | A |
| Escape Road | 2.8–3.3 s | 100% | 2 / 0 | no | yes | B, C |
| Nightclub Showdown | 3.6 s | 71% | 0 / 2 | no | no | B |

¹ Nightclub portrait: run A saw the frame and a 17% fill, but no canvas crossed the "covers a quarter of the
stage" line before the runner refused a host. B and C timed out. The prompt and safe-area readings are from that
partial run only.

## Columns

- **Canvas on stage**: from arrival to a canvas covering at least a quarter of the stage. That is the menu drawn and
  waiting, which is the earliest moment a player can act. It is the honest "first playable moment" this harness
  can give.
- **First action**: in every responding cell, the title's own first action changed the frame: QUICK PLAY,
  1 PLAYER, PLAY NOW, the ▶ pad, or tap to start. The harness only acts after a fixed settle, about 18–22 s after
  arrival, so its `firstResponseMs` is when the script tried, not when the game became ready. That is why it is
  not reported as a load time.
- **Touch controls**: DOM elements inside the game document. Controls a build draws into its own canvas (Elytra's
  sticks, Kart's pedal and steering) cannot be counted from the DOM. A low count there is not an absence.
- **Ad preroll**: a DOM preroll or ad blocker over the game, plus any request to an ad network. It was zero
  everywhere, and so were requests to jsDelivr. Karate showed a transient DOM blocker for 1.0–2.2 s
  during load. It cleared before the first action, and the audit does not identify it further.
- **Safe area**: whether in-game DOM controls use `env(safe-area-inset-*)`. Only InZone's own Escape Road pads
  do. The builds' own DOM buttons do not.
- **Host layout**: in every evaluable cell, the InZone bar never overlapped the stage and there was no horizontal
  scroll.

## What this baseline says

1. **Nothing blocks first play.** There are no prerolls, no ad networks, no jsDelivr, and a canvas on the stage within
   about 3–5 s in every evaluable cell.
2. **Karate Bros in portrait fills 28% of the stage.** The engine draws a 16:9 strip. The host's fullscreen prompt is
   the only path to a usable size, and it only exists where the browser supports element fullscreen, which
   iPhone Safari does not.
3. **Escape Road is the only title whose touch controls are verified reachable and safe-area aware.** That is
   because they are ours.
4. **Kart Bros' small DOM targets** (9 in portrait, 13 in landscape, under 44px) are the build's own menu buttons.
   That is the next thing to check on a device.
5. **Nightclub portrait has no clean reading from this runner.** It needs a device pass.

## Not measured here, and still owed

- **First frame on 3G.** The harness does not throttle. The Unity titles each load roughly 18–25 MB of data
  plus a wasm of 8–31 MB through `/mirror` (Escape Road, Elytra, Kart Bros; Karate Bros is a 3.8 MB bundle). This
  is the largest unmeasured risk for a cellular arrival.
- **Frame rate** on a low-end Android.
- **Real in-app WebViews.** Pangle `open_news` on iOS is where the TikTok traffic actually arrives.
- **A finished round per title.** That is what `lib/flagship-readiness.ts` tracks.

Raw per-run JSON is regenerated by the command above into `.mobile-audit/`. It is not committed, because it
changes every run.
