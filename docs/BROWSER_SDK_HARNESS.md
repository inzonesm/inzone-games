# Browser SDK bootstrap proof

This is a local-only development fixture, not a released game SDK. No identity,
backend, saves, scores, purchases, or Three.js compatibility are established.
The production `/gcs` route is unchanged. No Next.js harness route is installed.

## Run

Use Node 22.18+ or Node 24 (native TypeScript stripping imports the existing
`lib/game-hosting.ts` without a separate build). No npm installation is needed
for the harness or its focused unit tests.

```sh
npm run sdk:harness
# Open http://127.0.0.1:4173/
npm run test:sdk-harness
```

The local server binds only to loopback and refuses `NODE_ENV=production`.
Fixture mode is explicit in the local server, not inferred from missing services.
The runner imports the real viewport-fit, serverUrl-persist, base-href and early
insertion helpers. It does not exercise GCS retrieval, Next routing, auth or a
production deployment. `insertEarly` is newly exported; its behavior is unchanged.

The page embeds an interactive game with a relative SVG asset. Tap the button,
try an unsupported score call, and follow the failure link. Inspect the iframe's
`window.results` and `InZoneSDK.getStatus()`. The parent has no SDK instance.

## Contract demonstrated

```js
try {
  const config = await window.InZoneSDK.getConfig();
  // config.fixtureMode === true
  // config.capabilities === ['getConfig']
} catch (error) {
  // INZONE_SDK_INITIALIZATION_FAILED
}
```

The bootstrap is inserted before game scripts. An early game script may await
`getConfig()` while initializing; late consumers use the same durable promise.
`ready` exposes that promise directly. `getStatus()` reports initializing, ready
or failed. `inzone:sdk-ready` and `inzone:sdk-error` are supplemental events, not
the only way to find state. DOM completion settles initialization; a two-second
deadline fails it if completion stalls (subject to browser timer scheduling).

Duplicate injection retains the SDK and emits no additional terminal event.
An existing foreign SDK is not overwritten. Config and capabilities are frozen.
Only fixture metadata is exposed: no player ID, session, token, key or backend URL.

The exposed `postScore`, `gameState`, `saveState` and `purchaseCoinTier` methods
reject with `INZONE_UNSUPPORTED_CAPABILITY`. Other methods are not implemented;
this minimal surface is not a complete compatibility adapter. No operation grants
or persists anything. The fixture performs local asset requests only.

## Browser checks

`tests/sdk-harness.browser.mjs` launches its own runner on loopback port 4174 and
closes it afterward. Supply an installed Playwright module and browser:

```sh
# With Playwright and its Chromium installed in your test environment:
node tests/sdk-harness.browser.mjs
# Or specify external tooling without adding app dependencies:
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
CHROMIUM_EXECUTABLE=/absolute/path/to/chromium \
node tests/sdk-harness.browser.mjs
```

## Executed verification — 10 September 2026

- Node v24.19.0; `npm ci --ignore-scripts --no-audit --no-fund` succeeded.
  Existing dependency peer/deprecation warnings were reported; lockfile unchanged.
- `npm run typecheck`: passed. Generated build-info changes were discarded.
- `npm run test:sdk-harness`: seven tests passed, including explicit fixture opt-in,
  production refusal, stalled-DOM deadline, and backend-method rejection.
- Real headless Chromium 152 using Playwright: passed iframe-local installation,
  initializing early consumer, late consumer, exactly one ready event, duplicate
  identity retention, relative asset loading, button interaction, unsupported
  score rejection, explicit failure and existing SPA URL/base-path behavior.
- Browser run: zero page errors and zero external requests.
- Browser tooling was installed outside the repository; no app dependencies added.
- The production `/gcs` source is unchanged; no production build/deployment or
  live partner integration was tested.

## Next gate

Review this proof, then run a real partner's compiled browser game and establish
the production activation/isolation and first required backend capability.
A working fixture does not verify payment, authorization or backend contracts.

Web host checkout integration lives in `docs/WEB_SDK_INTEGRATION.md` and is
exercised with `npm run test:game-sdk` / `node tests/game-sdk-host.browser.mjs`.
That work is an integration preview; checkout flags stay off.
