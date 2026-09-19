# Companion quota infrastructure

Companion spend is reserved **before** paid chat or TTS. Two backends:

| Backend | When | Atomicity |
|---|---|---|
| Firestore `companion_quota/{docId}` | `FIREBASE_SERVICE_ACCOUNT` or `GOOGLE_APPLICATION_CREDENTIALS` is set | Transaction on per-uid day, global day, and a 45 s inflight lease |
| Process-local maps | Admin credentials absent | Single instance only. Not safe across Vercel lambdas |

Documents (Admin SDK only):

- `uid_<uid>_<YYYY-MM-DD>` — `turns`, `chars`
- `global_<YYYY-MM-DD>` — `chars`
- `lock_<uid>` — `inflight`, `leaseUntil`

Failed paid calls **release** the reservation (turn + reserved characters). Browser speech commits `0` TTS characters. Clients cannot read or write this collection.

## Owner actions before this is shared-atomic in preview/production

1. Deploy `firestore.rules` so `match /companion_quota/{docId}` is deny-all. Run `npm run test:play-session-rules` first.
2. Set `FIREBASE_SERVICE_ACCOUNT` on the Vercel Preview for this branch (same Admin account already used for Unity publish). Without it, the route falls back to process-local counters and the health/meta field `quotaBackend` is `process_local`.
3. Do not put quota documents in the public repo.
