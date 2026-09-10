# InZone web SDK and experience handoff

Verified on 2026-09-10. This file is the cross-account handoff, not a claim that the
web SDK is production-ready. Recheck branch tips once at task start.

## Product objective and non-negotiables

Jayme is evolving InZone into a web gaming platform where developers distribute
and monetize games, with Hexclave supplying games and GTM tooling. Distribution,
player acquisition and retention matter more than generating more games. Individual
games are marketed separately and are entry points into the platform. Avoid generic
marketplace redesigns or assumed social handoffs that require players to wait for
someone else. Discovery remains important; player choice and actual gameplay must
remain central. Test growth hypotheses rather than describing them as established.

Immediate deliverable: a versioned web SDK developers can integrate, with a working
host integration and honest capability documentation. Afterwards improve the
advertised-game arrival -> play -> discover another game -> return journey.
Do not turn this into more prerequisite audits or unrelated backend cleanup.

- Web first. Do not optimize Flutter/native WebView now.
- Keep Firebase authentication. Hexclave is analytics-only; do not replace auth.
- Reuse working save/restore, hosting, uploads, game routes and wallet/backend code.
- Three.js is JavaScript/WebGL; compiled browser builds do not require a new engine
  or special language host. Validate real assets/modules/WebGL before claiming support.
- Use already integrated working games for acceptance. Do not request a new game
  from Jayme or repair the previously corrupted OVO ZIP.
- Keep SDK and experience plans separate for developer handoffs.
- Publish reviewable branches/PRs; do not merge, deploy, activate payment flags,
  change live rules or charge users without explicit authorization.

## Verified repository state

| Repository / target | Verified tip | Relevant merged work |
| --- | --- | --- |
| inzonesm/inzone-games / main | 0e422811533c2c645397dcc39c88312edd6705d5 | PR #6 browser bootstrap harness; #4 Hexclave analytics; #5 config sync |
| inzonesm/inzone-backend / game-analytics | 30b0ee6f88d2915962c0815abb3d9ed820493faf | #8 draft offers; #9 checkout; #10 shared-wallet transactions |

Backend work targets **game-analytics**, not main. PR #10 reviewed head:
1a8fcab24a8e4033f98ccdeb351efe3e2dcf2eff. It is merged; do not rebuild it.
Both Codex and Claude ran 30 Firestore emulator tests plus six catalog tests.
Thirty are emulator tests; do not call all 36 emulator tests. Live rules, providers,
full WSGI startup and deployment were not validated by those tests.

## Existing source to inspect first

Frontend:
- app/games/[id]/page.tsx: real game iframe and player controls.
- app/gcs/[...path]/route.ts and lib/game-hosting.ts: real HTML/asset transformations.
- lib/upload-pipeline.ts: upload pipeline; preserve relative asset/multiplayer behavior.
- components/AuthProvider.tsx, lib/firebase.ts, lib/firebase-admin.ts: existing auth.
- scripts/sdk-harness/, tests/sdk-harness*: merged bootstrap proof.
- docs/BROWSER_SDK_HARNESS.md, docs/BROWSER_SDK_DELIVERY.md: proof boundaries.
- public/docs/inzone-game-sdk-guide.md and app/endpoints/page.tsx: older bridge docs;
  documentation alone is not proof that the web host implements those methods.

Backend:
- inzoneapi/routes/api/offer_checkout.py: HTTP, auth, request validation, feature guards.
- inzoneapi/services/minigames/offer_checkout.py: catalog, receipt, fulfillment.
- inzoneapi/routes/api/game_offers.py: owner draft authoring/schema.
- inzoneapi/routes/api/social_loop.py and services/minigames/social_loop_service.py:
  existing SDK features; inspect and reuse rather than replace.
- inzoneapi/docs/OFFER_CHECKOUT.md, SHARED_WALLET_TRANSACTIONS.md.

The harness is not the shipped game SDK. Existing working capabilities should keep
working; do not globally replace window.InZoneSDK with a new incomplete object.

## Monetization contract already implemented

Prefix: /api/game-sdk/v2/games/{gameId}

| Operation | Method/path | Body |
| --- | --- | --- |
| Read published catalog | GET /catalog | none; public |
| Publish inspected draft | POST /catalog/publish | {offers:[...]} ; authenticated game owner |
| Purchase | POST /purchases | {offerId,catalogVersion,requestId} |
| Recover receipt | GET /purchases/{requestId} | none |
| Read inventory | GET /inventory/{offerId} | none |

Authenticated calls use Authorization: Bearer <Firebase ID token>. Backend derives
UID; no game-supplied userId/price/quantity is accepted. IDs are 1-100 characters
matching [A-Za-z0-9_-]. Responses: {success:true,data:...} or
{success:false,code:...}. All new endpoints return 404 CHECKOUT_DISABLED while off.

Catalog: gameId, version, offers. Kinds are durable and consumable, with stored coin
prices and quantities. This is not arbitrary subscriptions, cash billing or payout
settlement. Receipt includes transactionId, gameId, offerId, catalogVersion, coins,
currency, newBalance and entitlement. Inventory returns owned/quantity and, when
present, kind/transactionId. Receipt balances/inventory are historical snapshots;
read inventory for current ownership/quantity.

Persist the request ID AND original offer/version before submitting, scoped to the
signed-in account and game. Retry uncertain purchases with the same binding; recover
receipts first. Never create a new request automatically after a network error.
OFFER_CHANGED requires refreshed catalog and renewed player confirmation. A repeated
receipt must not grant consumables twice. Backend grants consumable balances but does
not yet expose a consuming-units operation; do not promise one.

Durable restoration and consumable fulfillment are already backend-implemented.
Legacy historical receipt reconciliation-required 409 does NOT prove a prior charge
fully committed: old writes were non-atomic. Do not infer ownership from newBalance
or tell clients to retry with a fresh ID. The old Claude review overstated that point.

## Remaining work and ownership

Current account delivered **backend PR #11**, `feat/checkout-host-client`, head
`c0a76889b1786b583197cd96d1afba648b2dbc68`:
https://github.com/inzonesm/inzone-backend/pull/11
Package: `packages/checkout-host-client`, version `0.1.0-preview.1`. ESM source,
TypeScript declarations, README and 12 passing Node transport tests. Not merged or
npm-published at handoff. Reuse this package after review instead of duplicating the
HTTP adapter. Inspect its tests and limitations: no confirmation/persistence/iframe
security is implemented by this client. It is intentionally trusted-host-only.

New account: own frontend integration in inzonesm/inzone-games. First inspect that
package/PR if available and reuse it. Do not independently implement the same client.

1. Trace current iframe origin/sandbox and Firebase host auth. Decide and implement
   a verifiable boundary before privileged game messages. Same-origin game code may
   access parent/auth; event.origin alone or Referer is not authorization. Use source
   binding, navigation invalidation and a genuinely isolated game context. Preserve
   working game storage/modules/assets; validate compatibility rather than blindly
   applying sandbox flags that break games.
2. Wire the trusted host to existing Firebase auth and the backend client. No token,
   credentials or private backend configuration in game windows/messages. Bind game
   identity to the host's loaded game; ignore caller-supplied identity.
3. Ship the iframe-facing versioned SDK with capability discovery and typed errors.
   Catalog, request purchase, inventory and receipt recovery should use the host.
   Purchase requires real host-owned confirmation showing server catalog title,
   price, quantity and currency; a game message is not player authorization.
   Cancellation charges nothing. Serialize confirmation requests and bound calls.
4. Persist uncertain requests in the trusted host scoped to account/game. On reload
   or retry recover the same receipt; handle logout/account changes without leaking
   old account results. Do not silently resubmit after cancellation or changed price.
5. Preserve existing methods and publish accurate supported/pending capabilities.
   Provide ESM/plain-script usage if supported by the chosen package, TypeScript
   types and a minimal runnable game example. No npm publishing without permission.
6. Execute browser tests for genuine iframe interaction, confirm/cancel, spoofed
   messages, changed game/account, failure/recovery and continued gameplay/relative
   assets. Use an existing working game through the real hosting transformation.
   Use fixtures/emulator for charges, never live player balances. Mark live checks
   separately. Return actual screenshots, test results and a hosted PR.

Do not call the SDK complete until the real host/package path is exercised. If live
activation prerequisites remain, label it an integration preview and say which
capabilities can actually be given to developers.

## Activation is a separate release action

INZONE_OFFER_CHECKOUT_ENABLED and INZONE_OFFER_CHECKOUT_WALLET_READY stay unset/off.
Merge does not deploy; merged source does not prove deployed cooperating wallet
writers. Verify deployed versions, external/client balance writers and Firestore
write protections for wallets/accounting/catalogs/requests/inventory/limits. Protect
sensitive fields/collections without indiscriminately blocking legitimate profile
edits. Verify live Firebase identity and trusted browser confirmation before enabling.
Legacy top-up receipt verification/idempotency remain outside this completed work.

## Efficient execution and recovery rules

GitHub connector access previously worked while gh auth status said logged out.
Use the available authenticated connector for branches/tree/commit/ref/PR tools;
CLI auth is not a gate for connector publication. Recheck a failed path once only
if something changed. Do not retry known 403s, reconstruct lost commits or ask Jayme
to download/reupload code already reachable on GitHub. Publish tested source early
and return real URLs, never PR metadata presented as a hosted PR.

Start from actual reachable branch tips in an isolated checkout; leave existing
local changes alone. Review deltas if tips advanced. Test only the meaningful changed
behavior and required regressions; avoid repeated full audits. At each checkpoint
state completed capability, actual evidence, remaining blocker and exact next step.
For Watchtower feedback, record concrete blocked calls and duplicate work avoided,
not a new analytics or agent-monitoring implementation.

Backend test reproduction (Python Flask/google-cloud-firestore, Java, emulator JAR):
python inzoneapi/scripts/test_offer_checkout_emulator.py /path/to/emulator.jar test_wallet_compatibility.py
PYTHONPATH=inzoneapi python -m unittest discover -s inzoneapi/tests -p test_game_offers.py -v
Frontend baseline: npm run test:sdk-harness; npm run typecheck when dependencies exist.
