# InZone web SDK — trusted host integration preview

Status: **integration preview**. This is not a production-ready payments SDK.
Checkout remains disabled on the backend (`INZONE_OFFER_CHECKOUT_ENABLED` and
`INZONE_OFFER_CHECKOUT_WALLET_READY` unset). This package does not enable those
flags, deploy, or charge live balances.

Reuse: `@inzone/checkout-host-client` `0.1.0-preview.1` vendored from
inzonesm/inzone-backend PR #11 (`c0a76889b1786b583197cd96d1afba648b2dbc68`),
now merged into `game-analytics`. Do not duplicate that HTTP adapter.

## What games can use today on the web host

Inside an InZone-hosted iframe, `window.InZoneSDK` is injected before game
scripts. The game talks only to the parent host via `postMessage`. Firebase ID
tokens, `userId`, `gameKey` and backend URLs are **not** placed in the game.

| Capability | Status on this web host |
| --- | --- |
| `getConfig` / `getStatus` / `getCapabilities` / `ready` | Supported |
| `getCatalog` | Supported (host → checkout client; 404 `CHECKOUT_DISABLED` until flags) |
| `requestPurchase({ offerId })` | Supported: host-owned confirmation using **server catalog** title, coins, quantity, currency. Game-supplied price/title is ignored. Cancel charges nothing. |
| `getInventory({ offerId })` | Supported |
| `getReceipt({ requestId })` | Supported; use after an uncertain purchase |
| `saveState` / `loadState` | Supported via the trusted host (existing `/api/game-sdk/state`; host binds identity) |
| `postScore`, `sendChallenge`, `openChat`, `gameState`, `purchaseCoinTier`, `close` | Present on the object, reject with `INZONE_UNSUPPORTED_CAPABILITY` on web. Flutter/social-loop docs still describe those methods. |

Hexclave remains analytics-only. Firebase Auth is unchanged.

## Isolation

Approved games still load through `/gcs` (viewport-fit, `serverUrl` persist, `<base href>`).
The player iframe is sandboxed **without** `allow-same-origin`, so game script
cannot read parent Firebase state. The host accepts RPCs only from
`event.source === iframe.contentWindow`. `event.origin` is `"null"` for that
frame and is not treated as authorization. Reloading the frame cancels an open
confirmation.

Relative assets keep resolving against the document URL / `<base href>`. Classic
scripts keep working. Module scripts rely on `/gcs` CORS (`Origin: null`).
Games that require a same-origin iframe (some Unity/IndexedDB setups) may need a
follow-up compatibility hatch; do not add `allow-same-origin` without a new
isolation design.

## Purchase rules the host enforces

1. Catalog is fetched by the host. Confirmation UI renders server `title`, `coins`, `quantity`, `currency`.
2. Player must confirm. Cancel → `PURCHASE_CANCELLED`, no POST.
3. `{ offerId, catalogVersion, requestId }` is persisted under the signed-in
   account + loaded game **before** POST.
4. Network / timeout / 5xx after POST → `outcomeUnknown: true` and the same
   `requestId`. Retry recovers the receipt first. The host never mints a new ID
   automatically.
5. `OFFER_CHANGED` requires a fresh catalog and a new confirmation.
6. Account or game changes cannot read another account's pending request.
7. One confirmation at a time.

Production player pages (`/games/[id]`) use the live checkout client and the
signed-in Firebase user. While backend flags are off, catalog/purchase return
`CHECKOUT_DISABLED`.

## Runnable example

```sh
npm install
npm run dev
# open http://localhost:3000/sdk-example
```

`/sdk-example` hosts `fixtures/sdk-example/game` through the **same**
`instrumentGameHtml` helper as `/gcs`. It uses an in-memory fixture catalog so
you can confirm, cancel, fail, and retry without live coins or enabling flags.

Local hosting-path tests (no Next):

```sh
npm run sdk:host          # http://127.0.0.1:4175/
npm run test:game-sdk
npm run test:checkout-client
npm run test:sdk-harness  # existing bootstrap proof, unchanged
```

With Playwright/Chromium available:

```sh
node tests/game-sdk-host.browser.mjs
```

## Game integration (ESM / classic)

Classic script, after `inzone:sdk-ready` or `await InZoneSDK.getConfig()`:

```js
const catalog = await InZoneSDK.getCatalog();
try {
  const receipt = await InZoneSDK.requestPurchase({ offerId: catalog.offers[0].id });
  const inventory = await InZoneSDK.getInventory({ offerId: receipt.offerId });
} catch (error) {
  if (error.code === 'PURCHASE_CANCELLED') return;
  if (error.outcomeUnknown && error.requestId) {
    const receipt = await InZoneSDK.getReceipt({ requestId: error.requestId });
  }
}
await InZoneSDK.saveState({ state: { level: 2 } });
const save = await InZoneSDK.loadState();
```

TypeScript types: `/sdk/inzone-game-sdk.d.ts`. There is no npm publish of a game
package in this PR.

Do not read `userId`, tokens, or `backendBaseUrl` from the web config. The web
host will not provide them. Do not POST prices.

## Remaining production release blockers

These are **not** done by this PR:

- Set `INZONE_OFFER_CHECKOUT_ENABLED` and `INZONE_OFFER_CHECKOUT_WALLET_READY` only after a separate release review.
- Deploy cooperating wallet writers (including external/agent services) and verify live Firestore rules for catalogs, requests, inventory, limits, and wallets.
- Verify live Firebase identity + this confirmation UI in a deployed environment.
- Confirm CORS/module/Unity compatibility on real partner builds.
- Legacy coin-tier `purchaseCoinTier` / social-loop methods are not reimplemented on the web host.
- Consuming granted consumable units is not an API yet; do not promise it.
- This preview does not replace the Flutter WebView SDK.
