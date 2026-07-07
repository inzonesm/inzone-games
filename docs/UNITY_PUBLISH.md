# Unity Hub Publish — portal → app

How a Unity game gets from the dev portal into the app's Unity game hub. This is a
**separate pipeline** from HTML5 games (which live in `inzone-html` / `html_games`).

## What it does

```
Dev's Addressables build (ServerData/iOS/*.bundle + catalog_*.json/.hash)
  └─ client: inspectAddressablesBuild()  (lib/unity-build.ts) — list bundles, find catalog, sizes
        └─ POST /api/unity-publish {action:'sign'}  → V4 signed PUT URLs (Admin SDK private key)
              └─ client PUTs each file DIRECTLY to gs://inzone-unity-bundles/iOS/…  (no body limit)
                    └─ POST /api/unity-publish {action:'commit'} → verifies objects, writes unityGames doc
                          └─ Flutter GameHubService reads unityGames → game appears in the hub
```

The app reads bundles/catalog **flat** under the platform folder
(`GameHubService.bucketBase = …/inzone-unity-bundles/iOS`), so:

- **Bundles** keep their content-hashed names (collision-safe) → `iOS/<bundle>.bundle`.
- **Catalog** `.json`/`.hash` are **renamed per-game** to `catalog_<slug>_v<n>.json/.hash`
  so multiple games coexist in the flat layout. `catalogFile` on the doc points at it.

## The hard constraint (read this first)

Addressables stream **scenes + assets + ScriptableObject data — never new C# code**
(IL2CPP is AOT; Apple 2.5.2 forbids downloaded executables). A published game may only
use MonoBehaviour/types **already compiled into the shipped `UnityFramework`**. So this
portal path serves **content against a pre-compiled SDK/runtime**. A game with its own
custom scripts (e.g. AnyRPG) must first be compiled into the inzone Unity project and
shipped in an app update — only then can its content stream through here.

## Dev build contract (what an indie must produce)

1. Build the game **on Unity 6000.3.x** using only runtime types compiled into the
   inzone app (or coordinate a framework update for new code).
2. Mark the entry scene **Addressable**; put it + every scene/asset the game loads at
   runtime into the Addressable group(s). (A plain `SceneManager.LoadScene` to a
   non-Addressable scene will fail in UaaL.)
3. Addressables profile → **Remote** profile:
   `Remote.LoadPath = https://storage.googleapis.com/inzone-unity-bundles/iOS`
   (and the Android equivalent). This bakes the correct absolute bundle URLs.
4. **Enable "Build Remote Catalog."** Multi-scene games need it.
5. Addressables → Build → New Build → Default Build Script.
6. Zip the contents of `ServerData/iOS/` and upload it via the portal, supplying the
   **entry scene address** (e.g. `Assets/Scenes/Foo/FooScene.unity`), title, etc.

## Server setup

- `npm install` (adds `firebase-admin`).
- Set `FIREBASE_SERVICE_ACCOUNT` (raw or base64 service-account JSON) in the server env
  — same Admin account as the Flutter repo's `scripts/service-account-key.json`
  (project `inzone-f93e4`), needs **Storage Object Admin** on `inzone-unity-bundles` +
  Firestore write. On Vercel: Project → Settings → Environment Variables (Encrypted).
- The signed URLs are minted with the SA **private key** locally, so no extra IAM
  (`signBlob`) role is needed.

## Auth

`/api/unity-publish` requires a Firebase **ID token** (`Authorization: Bearer <token>`)
and enforces per-slug ownership (`uploaderId`). For local testing without the UI, set
`UNITY_PUBLISH_ALLOW_UNAUTH=1` (never in prod).

## Status / TODO

- [x] Contract + types (`lib/unity-hub.ts`)
- [x] Client Addressables-build inspector (`lib/unity-build.ts`)
- [x] Server route: signed uploads + `unityGames` commit (`app/api/unity-publish/route.ts`)
- [x] **Upload UI wired**: the Unity tab runs inspect → sign → direct PUT → commit
      (`lib/unity-publish-client.ts`), with an entry-scene-address field. `.zip` of
      `ServerData/<platform>` only; `.unitypackage` is rejected.
- [x] ID token passed from the client (route verifies; `UNITY_PUBLISH_ALLOW_UNAUTH=1` for local dev).
- [x] CORS set on `gs://inzone-unity-bundles` (localhost:3000 + prod origins — update the
      policy when the portal's production domain is final).
- [ ] Device validation: load a portal-published game's catalog + scene in the app on a
      physical iPhone (framework rebuild with the local-bundle redirect recommended first).
- [ ] Android: same flow with `platform: 'Android'` once an Android export exists.
- [ ] Update-mode versioning for Unity docs (currently v1 merge-overwrite per slug).

## The dev template

The **inzone Unity Game Kit** (`/Users/yxydw/Documents/inzone/inzone-unity-game-kit`,
Unity 6000.3.11f1) is the supported way for devs to produce a compatible zip: preconfigured
Remote profile + remote catalog, a no-code sample scene, and an `inzone` menu with
**Validate Scenes** (rejects any MonoBehaviour outside the engine/SDK allowlist — custom C#
cannot stream) and **Build For inzone** (validate → Addressables build → `inzone-build-iOS.zip`).
