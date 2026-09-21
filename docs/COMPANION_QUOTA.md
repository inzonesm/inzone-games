# Companion quota infrastructure

Paid OpenAI chat and ElevenLabs (or OpenAI) TTS are reserved **before** the provider call. TTS character counts do **not** measure model usage; the two are stored separately.

| Backend | When | What it may authorize |
|---|---|---|
| Firestore `companion_quota/{docId}` | `FIREBASE_SERVICE_ACCOUNT` is set (or `GOOGLE_APPLICATION_CREDENTIALS`) | Paid chat + paid TTS, atomically |
| Process-local maps | Admin credentials absent | **Free path only** (scripted reply + browser speech). Never paid spend |

If hosted keys exist but shared quotas are not ready, the route does **not** call OpenAI or ElevenLabs. It returns the free fallback (`replySource=scripted_fallback`, `speechProvider=browser`) and sets `quotaUnavailable=true` with `requiredSetting=FIREBASE_SERVICE_ACCOUNT`.

## Required setting

The exact Vercel / server setting for shared quotas is **`FIREBASE_SERVICE_ACCOUNT`** (raw or base64 Admin JSON). `GOOGLE_APPLICATION_CREDENTIALS` is accepted only as a local ADC fallback. Missing Admin credentials are reported by name on GET `/api/companion` (`requiredSetting`) and on POST meta.

## Reservation contract

Each paid turn writes a unique `reservationId` with `settled=false` and a 45 s lease.

- **Commit** adjusts reserved `chatChars` / `ttsChars` down to the actual billed amounts, then deletes the reservation.
- **Release** (provider failure before a usable result) returns both reserved amounts and the turn.
- A second commit or release for the same `reservationId` is a **no-op** (`applied=false`).
- An expired lease is reclaimed on the next reserve: reserved chat + TTS come back, the turn is returned, and the lock clears. A late settle after reclaim is also a no-op.

Documents (Admin SDK only):

- `uid_<uid>_<YYYY-MM-DD>` — `turns`, `chatChars`, `ttsChars`, `reservations`
- `global_<YYYY-MM-DD>` — `chatChars`, `ttsChars`
- `lock_<uid>` — `inflight`, `leaseUntil`, `reservationId`

Clients cannot read or write this collection.

## Firestore rules (review separately — do not deploy this file as setup)

Current production `firestore.rules` has **no public-read catch-all**. Unmatched paths, including `companion_quota`, are already denied to clients.

This branch adds an explicit deny-all match for defense-in-depth. The Admin SDK bypasses rules, so **working quotas do not depend on deploying the entire `firestore.rules` file to production**. Do not treat a full rules deploy as an incidental companion setup step. If the deny-all block is ever shipped, review it on its own and run `npm run test:play-session-rules` first.

## Owner actions for Preview paid speech

1. Set `OPENAI_API_KEY` and `ELEVENLABS_API_KEY` on the **Preview** environment for this branch (already requested).
2. Set **`FIREBASE_SERVICE_ACCOUNT`** on that same Preview environment (the Admin JSON already used for Unity publish). Without it, GET/POST report `quotaUnavailable` and stay on the free fallback.
3. Redeploy the Preview after those env changes. Do not put quota documents or provider keys in the repo.
