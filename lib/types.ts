export type HubGameSource = 'community' | 'simula';

/** A short looping clip a developer uploads to represent their game in place of
 *  a static icon. Stored under `games/<slug>/preview/` in the gs://inzone-html
 *  bucket and mirrored onto the game's Firestore doc as flat `preview*` fields,
 *  so BOTH clients (this site and the Flutter app) can read it with no extra
 *  query — see lib/game-preview.ts for the reader/writer.
 *
 *  Every consumer must treat this as OPTIONAL and fall back to `iconUrl`: most
 *  games have no preview, and a client that can't decode the clip should show
 *  the poster (or the icon) instead. */
export interface GamePreview {
  /** Public download URL of the clip. */
  videoUrl: string;
  /** Public download URL of the still frame captured from the clip. May be
   *  empty when the browser couldn't decode a frame at upload time. */
  posterUrl: string;
  /** Storage object paths, kept so a replacement/removal can clean up the old
   *  objects without re-deriving the extension. */
  videoPath: string;
  posterPath: string;
  /** e.g. `video/mp4`. Clients can use this to skip formats they can't play. */
  mimeType: string;
  /** Clip length in milliseconds. 0 when unknown. */
  durationMs: number;
  /** Intrinsic pixel dimensions of the clip. 0 when unknown. A client can use
   *  width/height to pick the right card aspect before the video loads. */
  width: number;
  height: number;
  sizeBytes: number;
  updatedAt: number | null;
}

export interface CommunityGameDoc {
  id: string;
  name: string;
  description: string;
  iconUrl: string;
  gameUrl: string;
  /** WebSocket endpoint for multiplayer games (wss://…). Empty for single-player. */
  serverUrl: string;
  uploaderId: string;
  /** Null when the developer hasn't uploaded a preview clip. */
  preview: GamePreview | null;
  createdAt: number | null;
  updatedAt: number | null;
}

/** How a game's build is laid out in storage. Stored on the doc so an update
 *  knows the prior layout to clean up, and rollback knows how to serve it. */
export type BuildType = 'single' | 'bundle' | 'unity';

/** A game as seen by its owner on the "My Games" management page — includes
 *  moderation status and engine so the developer can see Unity builds that are
 *  still pending a runtime, not just the publicly-approved ones. */
export interface DeveloperGame {
  /** Firestore doc id (the slug). Stable — editing the display name, or pushing
   *  a new build, leaves it (and the live URL) unchanged. */
  id: string;
  name: string;
  description: string;
  iconUrl: string;
  gameUrl: string;
  serverUrl: string;
  engine: 'html5' | 'unity';
  status: string;
  /** The version currently live (the active build). 1 for a freshly-uploaded
   *  game; bumped each time a new build is shipped; can move *backwards* after a
   *  rollback. Absent on pre-versioning docs → treated as 1. */
  version: number;
  buildType: BuildType;
  /** The game's preview clip, or null if none has been uploaded. Managed from
   *  the "Preview video" portal (/preview?game=<id>), independently of builds —
   *  uploading or removing one never touches the live URL or the version. */
  preview: GamePreview | null;
  createdAt: number | null;
  updatedAt: number | null;
}

/** One immutable entry in a game's build history (`html_games/<id>/versions/<vN>`).
 *  Each shipped build writes one of these; rollback just repoints the parent doc
 *  at an earlier entry without re-uploading. */
export interface GameVersion {
  /** Monotonic build number — never reused, even after a rollback. */
  version: number;
  gameUrl: string;
  iconUrl: string;
  buildType: BuildType;
  engine: 'html5' | 'unity';
  /** Bundle entry point (e.g. `index.html`); empty for single-file/unity. */
  entryPath: string;
  fileCount: number;
  sizeBytes: number;
  /** Optional release note the developer attached to this build. */
  note: string;
  uploaderId: string;
  createdAt: number | null;
  /** True once this version's build files have been pruned by retention — its
   *  metadata survives for the changelog, but it can no longer be rolled back to. */
  pruned: boolean;
}

export interface HubGame {
  id: string;
  source: HubGameSource;
  name: string;
  description: string;
  iconUrl: string;
  gameUrl: string;
  /** Passed through to the iframe as `?serverUrl=…` so multiplayer clients know where to dial. */
  serverUrl: string;
  /** Owner uid. Carried through so the card can request the live-player count
   *  without an extra read (some uploaders get a synthetic count). */
  uploaderId: string;
  /** The developer-uploaded preview clip, or null. Cards should prefer this
   *  over `iconUrl` when present and fall back to the icon otherwise. */
  preview: GamePreview | null;
  /** Millis of the doc's creation — used by the hub's Trending row to pull
   *  in recently-added games beyond the newest-14. */
  createdAt: number;
  /** Millis of the doc's last update. Null when absent. */
  updatedAt: number | null;
  iconFallback?: string;
}
