/* Unity hub publish contract — shared by the client inspector and the server route.
 *
 * Publishing a Unity game = uploading an Addressables build (bundles + remote
 * catalog) into gs://inzone-unity-bundles and writing a doc to the Firestore
 * `unityGames` collection that the Flutter app's GameHubService reads. This is a
 * DIFFERENT pipeline from the HTML5 games (inzone-html / html_games).
 *
 * ── What this pipeline can and cannot deliver ──────────────────────────────
 * The app embeds ONE Unity runtime (Unity-as-a-Library, IL2CPP). Addressables
 * stream SCENES, PREFABS, ART, and ScriptableObject *data* — NOT new C# code
 * (IL2CPP is ahead-of-time compiled and Apple 2.5.2 forbids downloading
 * executable code). So a published game may only use MonoBehaviour/types ALREADY
 * compiled into the shipped UnityFramework. A game with its own custom scripts
 * must first be compiled into the inzone Unity project and shipped in an app
 * update; only then can its content stream through this path.
 *
 * ── Storage layout (app-compatible / flat) ────────────────────────────────
 * GameHubService downloads `${bucketBase}/${bundleFile}` and loads the catalog
 * at `${bucketBase}/${catalogFile}`, where bucketBase ends in `/iOS` or
 * `/Android`. So bundles + catalog live FLAT directly under the platform folder.
 * Addressables bakes absolute bundle URLs into the catalog from the build-time
 * Remote.LoadPath, so devs MUST build with
 *   Remote.LoadPath = https://storage.googleapis.com/inzone-unity-bundles/iOS
 * (and the Android equivalent). Bundle filenames are content-hashed and thus
 * collision-safe in the flat layout; only the catalog is renamed per-game on
 * publish so multiple games can coexist.
 */

export type UnityPlatform = 'iOS' | 'Android';

export const UNITY_BUNDLES_BUCKET = 'inzone-unity-bundles';
export const UNITY_GAMES_COLLECTION = 'unityGames';

/** Public read base — must match Flutter GameHubService.bucketBase exactly. */
export function unityBucketBase(platform: UnityPlatform): string {
  return `https://storage.googleapis.com/${UNITY_BUNDLES_BUCKET}/${platform}`;
}

/** Flat object name in the bucket: `<platform>/<fileName>`. */
export function unityObjectName(platform: UnityPlatform, fileName: string): string {
  return `${platform}/${fileName}`;
}

/** Per-game-unique remote-catalog stem, so flat catalogs never collide.
 *  Both the `.json` and its `.hash` companion are renamed to this stem. */
export function catalogStem(slug: string, version: number): string {
  return `catalog_${slug}_v${version}`;
}

export type UnityFileKind = 'bundle' | 'catalog' | 'hash' | 'settings' | 'other';

export interface UnityBuildFile {
  /** Path inside the uploaded build zip (after common-root strip). */
  buildPath: string;
  /** Flat filename it will take in the bucket (catalog/hash get renamed later). */
  fileName: string;
  size: number;
  contentType: string;
  kind: UnityFileKind;
  /** Extracted file content, held for the signed-URL upload step. */
  blob: Blob;
}

/** Result of inspecting a dev's zipped Addressables build, client-side. */
export interface UnityBuildInspection {
  platform: UnityPlatform;
  files: UnityBuildFile[];
  bundleFiles: string[];
  catalogFile: string | null;
  hashFile: string | null;
  totalBytes: number;
  warnings: string[];
}

/** The Firestore `unityGames` doc — mirrors the Flutter UnityGame model. */
export interface UnityGameDoc {
  title: string;
  description: string;
  category: string;
  thumbnailUrl: string;
  bannerUrl: string;
  /** Addressable scene ADDRESS to launch, e.g. "Assets/Scenes/Foo/FooScene.unity". */
  sceneName: string;
  /** Entry bundle filename (flat under the platform folder). */
  bundleFile: string;
  bundleSizeBytes: number;
  /** Per-game remote-catalog filename, e.g. "catalog_my-game_v1.json". */
  catalogFile: string;
  sizeMb: number;
  version: string;
  isActive: boolean;
}

export const CONTENT_TYPES = {
  bundle: 'application/octet-stream',
  json: 'application/json',
  hash: 'text/plain',
} as const;

// ── API contract: POST /api/unity-publish ───────────────────────────────────

export interface SignRequest {
  action: 'sign';
  platform: UnityPlatform;
  slug: string;
  version: number;
  /** Build files to upload; `name` is the flat filename (pre-catalog-rename). */
  files: Array<{ name: string; contentType: string; kind: UnityFileKind }>;
}

export interface SignedTarget {
  /** Flat filename as inspected from the build. */
  name: string;
  /** Final object name in the bucket (catalog/hash renamed to the per-game stem). */
  objectName: string;
  /** Public URL the app reads after upload. */
  publicUrl: string;
  /** Short-lived V4 signed PUT URL the client uploads to. */
  uploadUrl: string;
  contentType: string;
}

export interface SignResponse {
  targets: SignedTarget[];
  /** Final catalog `.json` filename to store as `catalogFile` (null if no catalog). */
  catalogFile: string | null;
}

export interface CommitRequest {
  action: 'commit';
  platform: UnityPlatform;
  slug: string;
  version: number;
  /** The unityGames doc to write (bundleFile/catalogFile must be FINAL names). */
  doc: UnityGameDoc;
  /** Object names that must exist before the doc is published (server verifies). */
  expectObjects: string[];
}

export interface CommitResponse {
  ok: true;
  gameId: string;
}
