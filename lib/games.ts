'use client';

import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit as fbLimit,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Timestamp,
} from 'firebase/firestore';
import {
  deleteObject,
  getDownloadURL,
  listAll,
  ref as storageRef,
  uploadBytesResumable,
  type StorageReference,
} from 'firebase/storage';
import { getDb, getHtmlStorage } from './firebase';
import { destroyGameServer } from './server-deploy';
import type { BuildType, CommunityGameDoc, DeveloperGame, GameVersion, HubGame } from './types';

const COLLECTION = 'html_games';

function isTimestamp(v: unknown): v is Timestamp {
  return !!v && typeof v === 'object' && 'toMillis' in (v as Record<string, unknown>);
}

function asBuildType(raw: unknown, engine: 'html5' | 'unity'): BuildType {
  if (raw === 'single' || raw === 'bundle' || raw === 'unity') return raw;
  // Pre-versioning docs have no buildType — infer a sensible default.
  return engine === 'unity' ? 'unity' : 'bundle';
}

function toDoc(id: string, raw: Record<string, unknown>): CommunityGameDoc {
  const created = raw.createdAt;
  return {
    id,
    name: ((raw.name as string) ?? '').trim(),
    description: ((raw.description as string) ?? '').trim(),
    iconUrl: ((raw.iconUrl as string) ?? '').trim(),
    gameUrl: ((raw.gameUrl as string) ?? '').trim(),
    serverUrl: ((raw.serverUrl as string) ?? '').trim(),
    uploaderId: ((raw.uploaderId as string) ?? '').trim(),
    createdAt: isTimestamp(created) ? created.toMillis() : null,
  };
}

function toHubGame(d: CommunityGameDoc): HubGame {
  return {
    id: d.id,
    source: 'community',
    name: d.name,
    description: d.description,
    iconUrl: d.iconUrl,
    gameUrl: d.gameUrl,
    serverUrl: d.serverUrl,
  };
}

export async function fetchApprovedGames(maxItems = 50): Promise<HubGame[]> {
  const db = getDb();
  const q = query(
    collection(db, COLLECTION),
    where('status', '==', 'approved'),
    fbLimit(maxItems),
  );
  const snap = await getDocs(q);
  const docs = snap.docs
    .map((d) => toDoc(d.id, d.data()))
    .filter((d) => d.gameUrl.length > 0 && d.name.length > 0);

  docs.sort((a, b) => {
    if (a.createdAt == null && b.createdAt == null) return 0;
    if (a.createdAt == null) return 1;
    if (b.createdAt == null) return -1;
    return b.createdAt - a.createdAt;
  });

  return docs.map(toHubGame);
}

/** Games uploaded by this account display an inflated "playing" count instead
 *  of their real open-session total. */
const INFLATED_PLAYER_UPLOADER_ID = 'stleyc71xUZJTmcx88A6Mv9dyYs2';

/** A random "playing" count in the inclusive range 999–9999. */
function randomInflatedPlayerCount(): number {
  return 999 + Math.floor(Math.random() * 9999);
}

/** How many people are playing a game right now — the count of its open
 *  sessions (`html_games/<id>/sessions` where status == 'open'), the same live
 *  signal the dashboard uses. Uses a server-side count (no doc payloads) and is
 *  best-effort: a missing subcollection or denied read resolves to 0.
 *
 *  Exception: games owned by INFLATED_PLAYER_UPLOADER_ID return a random count
 *  in 999–11,998 instead of their real open-session total. */
export async function fetchLivePlayerCount(gameId: string): Promise<number> {
  if (!gameId) return 0;
  try {
    const db = getDb();
    const gameSnap = await getDoc(doc(db, COLLECTION, gameId));
    const uploaderId = (((gameSnap.data()?.uploaderId as string) ?? '') || '').trim();
    if (uploaderId === INFLATED_PLAYER_UPLOADER_ID) {
      return randomInflatedPlayerCount();
    }
    const snap = await getCountFromServer(
      query(collection(db, COLLECTION, gameId, 'sessions'), where('status', '==', 'open')),
    );
    return snap.data().count;
  } catch {
    return 0;
  }
}

export async function fetchGameById(id: string): Promise<HubGame | null> {
  const db = getDb();
  const ref = doc(db, COLLECTION, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = toDoc(snap.id, snap.data() as Record<string, unknown>);
  if (!data.gameUrl) return null;
  return toHubGame(data);
}

// ──────────────────────────────────────────────────────────────────
// Developer-owned games (manage page): list / edit / delete
// ──────────────────────────────────────────────────────────────────

function toDeveloperGame(id: string, raw: Record<string, unknown>): DeveloperGame {
  const created = raw.createdAt;
  const updated = raw.updatedAt;
  const engine = raw.engine === 'unity' ? 'unity' : 'html5';
  const version = Number(raw.version);
  return {
    id,
    name: ((raw.name as string) ?? '').trim(),
    description: ((raw.description as string) ?? '').trim(),
    iconUrl: ((raw.iconUrl as string) ?? '').trim(),
    gameUrl: ((raw.gameUrl as string) ?? '').trim(),
    serverUrl: ((raw.serverUrl as string) ?? '').trim(),
    engine,
    status: ((raw.status as string) ?? '').trim(),
    version: Number.isFinite(version) && version > 0 ? version : 1,
    buildType: asBuildType(raw.buildType, engine),
    createdAt: isTimestamp(created) ? created.toMillis() : null,
    updatedAt: isTimestamp(updated) ? updated.toMillis() : null,
  };
}

/** Every game owned by this developer, newest first — including Unity builds
 *  still pending a runtime (which never appear on the public hub). */
export async function fetchDeveloperGames(uploaderId: string): Promise<DeveloperGame[]> {
  if (!uploaderId) return [];
  const db = getDb();
  const snap = await getDocs(
    query(collection(db, COLLECTION), where('uploaderId', '==', uploaderId)),
  );
  const games = snap.docs.map((d) => toDeveloperGame(d.id, d.data() as Record<string, unknown>));
  games.sort((a, b) => {
    if (a.createdAt == null && b.createdAt == null) return 0;
    if (a.createdAt == null) return 1;
    if (b.createdAt == null) return -1;
    return b.createdAt - a.createdAt;
  });
  return games;
}

/**
 * Returns the gameKey for a game, creating one if it doesn't exist yet.
 * Format: gk_live_{gameId}_{uploaderId}
 * Only writes to Firestore when the field is absent — never overwrites.
 */
export async function ensureGameKey(gameId: string, uploaderId: string): Promise<string> {
  if (!gameId) return '';
  const db = getDb();
  const ref = doc(db, COLLECTION, gameId);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data() as Record<string, unknown>;
    const existing = ((data.gameKey as string) ?? (data.game_key as string) ?? '').trim();
    if (existing) return existing;
  }
  const generated = `gk_live_${gameId}_${uploaderId}`;
  await updateDoc(ref, { gameKey: generated });
  return generated;
}

/** The shareable link that opens a community (html) game on the InZone Game
 *  Hub. Built as an AppsFlyer OneLink so it deep-links straight into the app
 *  when installed and falls through to the store otherwise. Param order and
 *  encoding match the backend's `_build_game_onelink`. */
export function gameShareLink(gameId: string): string {
  const params = new URLSearchParams({
    af_xp: 'custom',
    pid: 'social_share',
    deep_link_value: 'community_game',
    deep_link_sub1: gameId,
    af_dp: `inzone://game?gameId=${encodeURIComponent(gameId)}`,
  });
  return `https://join-inzone.onelink.me/SACg?${params.toString()}`;
}

export interface GameMetadataPatch {
  name?: string;
  description?: string;
  serverUrl?: string;
}

/** Update the editable metadata on a game the developer owns. The doc id (slug)
 *  and the stored build are left untouched — only display fields change, so the
 *  live URL stays stable. Only fields present on `patch` are written, so an
 *  editor can omit `serverUrl` to avoid clobbering a value that a server deploy
 *  stamped onto the doc out-of-band. */
export async function updateGameMetadata(id: string, patch: GameMetadataPatch): Promise<void> {
  const db = getDb();
  const update: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.description !== undefined) update.description = patch.description.trim();
  if (patch.serverUrl !== undefined) update.serverUrl = patch.serverUrl.trim();
  await updateDoc(doc(db, COLLECTION, id), update);
}

/** Replace a game's icon: upload the new image to `<slug>-icon.<ext>` and
 *  point the game doc's iconUrl at it. Returns the new download URL. The doc id
 *  and stored build are untouched, so only the displayed icon changes. */
export async function updateGameIcon(slug: string, file: File): Promise<string> {
  const storage = getHtmlStorage();
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  // Canonical, non-versioned icon path — matches the upload pipeline so the icon
  // survives version pruning and rollback.
  const ref = storageRef(storage, `games/${slug}/icon.${ext}`);

  // Overwrite any prior icon at this exact path (different ext is left as cruft).
  try { await deleteObject(ref); } catch { /* 404 is fine */ }

  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(ref, file, { contentType: file.type || 'image/jpeg' });
    task.on('state_changed', undefined, reject, () => resolve());
  });

  const iconUrl = await getDownloadURL(ref);
  await updateDoc(doc(getDb(), COLLECTION, slug), { iconUrl, updatedAt: serverTimestamp() });
  return iconUrl;
}

// ──────────────────────────────────────────────────────────────────
// Version history & rollback
// ──────────────────────────────────────────────────────────────────

function toGameVersion(raw: Record<string, unknown>): GameVersion {
  const created = raw.createdAt;
  const engine = raw.engine === 'unity' ? 'unity' : 'html5';
  return {
    version: Number(raw.version) || 0,
    gameUrl: ((raw.gameUrl as string) ?? '').trim(),
    iconUrl: ((raw.iconUrl as string) ?? '').trim(),
    buildType: asBuildType(raw.buildType, engine),
    engine,
    entryPath: ((raw.entryPath as string) ?? '').trim(),
    fileCount: Number(raw.fileCount) || 0,
    sizeBytes: Number(raw.sizeBytes) || 0,
    note: ((raw.note as string) ?? '').trim(),
    uploaderId: ((raw.uploaderId as string) ?? '').trim(),
    createdAt: isTimestamp(created) ? created.toMillis() : null,
    pruned: raw.pruned === true,
  };
}

/** The build history for a game, newest version first. */
export async function fetchGameVersions(gameId: string): Promise<GameVersion[]> {
  if (!gameId) return [];
  const snap = await getDocs(collection(getDb(), COLLECTION, gameId, 'versions'));
  return snap.docs
    .map((d) => toGameVersion(d.data() as Record<string, unknown>))
    .filter((v) => v.version > 0)
    .sort((a, b) => b.version - a.version);
}

/** Roll the live game back to an earlier version: repoint the parent doc at that
 *  version's stored build. No re-upload — the files are still on disk (unless the
 *  version was pruned, in which case this throws). `latestVersion` is left
 *  untouched so the next upload still gets a fresh, monotonic build number. */
export async function rollbackToVersion(gameId: string, version: number): Promise<void> {
  const db = getDb();
  const vSnap = await getDoc(doc(db, COLLECTION, gameId, 'versions', `v${version}`));
  if (!vSnap.exists()) throw new Error('That version no longer exists.');
  const v = toGameVersion(vSnap.data() as Record<string, unknown>);
  if (v.pruned) throw new Error('That version’s build was pruned and can’t be restored.');
  if (!v.gameUrl) throw new Error('That version has no playable build.');

  await updateDoc(doc(db, COLLECTION, gameId), {
    gameUrl: v.gameUrl,
    buildType: v.buildType,
    entryPath: v.entryPath,
    version: v.version,
    updatedAt: serverTimestamp(),
  });
}

// Delete every doc in a game's `versions` subcollection (best-effort).
async function deleteVersionDocs(slug: string): Promise<void> {
  try {
    const snap = await getDocs(collection(getDb(), COLLECTION, slug, 'versions'));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => undefined)));
  } catch {
    /* version cleanup is best-effort */
  }
}

// Recursively delete everything under a storage prefix (the bundle path
// `<slug>/...`). Best-effort: a missing object/prefix is not an error.
async function clearStoragePrefix(ref: StorageReference): Promise<void> {
  let listing;
  try {
    listing = await listAll(ref);
  } catch {
    return;
  }
  await Promise.all([
    ...listing.items.map((r) => deleteObject(r).catch(() => undefined)),
    ...listing.prefixes.map((sub) => clearStoragePrefix(sub)),
  ]);
}

// Remove the top-level artifacts for a slug: `<slug>.html`, `<slug>.zip`,
// `<slug>.unitypackage`, `<slug>-icon.<ext>`. The dot/`-icon.` boundary keeps
// `snake` from matching `snake-2`'s files.
async function clearSlugArtifacts(slug: string): Promise<void> {
  const storage = getHtmlStorage();
  let root;
  try {
    root = await listAll(storageRef(storage, ''));
  } catch {
    return;
  }
  const matches = root.items.filter(
    (r) => r.name.startsWith(`${slug}.`) || r.name.startsWith(`${slug}-icon.`),
  );
  await Promise.all(matches.map((r) => deleteObject(r).catch(() => undefined)));
}

// Best-effort cleanup of the auto-created community group chat(s) for a game.
async function deleteGameGroupChats(slug: string): Promise<void> {
  const db = getDb();
  try {
    const snap = await getDocs(
      query(collection(db, 'groupChats'), where('gameId', '==', slug)),
    );
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => undefined)));
  } catch {
    /* group chat cleanup is best-effort */
  }
}

/** Permanently delete a game the developer owns: its multiplayer server (if
 *  any), its Firestore doc, all of its storage artifacts (single file, bundle
 *  prefix, Unity binary, icon), and its community group chat. Storage/chat
 *  cleanup is best-effort so a partial failure there still removes the game
 *  from the hub — but a failed server teardown ABORTS the deletion, because
 *  once the doc is gone nothing on the site points at the Fly app and it
 *  would keep running (and billing) invisibly. */
export async function deleteGame(game: Pick<DeveloperGame, 'id'>): Promise<void> {
  const db = getDb();
  const slug = game.id;
  // Tear down the Fly server first, while the doc (and its ownership record)
  // still exists. Games without a server skip the network call entirely.
  const snap = await getDoc(doc(db, COLLECTION, slug));
  const data = snap.exists() ? (snap.data() as Record<string, unknown>) : undefined;
  if (data && (data.flyApp || data.serverUrl)) {
    await destroyGameServer(slug);
  }
  // Then remove from the hub — that's the user-visible effect.
  await deleteVersionDocs(slug);
  await deleteDoc(doc(db, COLLECTION, slug));
  // Then clean up the artifacts that are keyed off the slug. We wipe both the
  // current versioned layout (games/<slug>/…) and the legacy flat layout
  // (<slug>/…, <slug>.html, <slug>-icon.<ext>) so games uploaded under either
  // scheme are fully removed.
  await Promise.all([
    clearStoragePrefix(storageRef(getHtmlStorage(), `games/${slug}`)),
    clearStoragePrefix(storageRef(getHtmlStorage(), slug)),
    clearSlugArtifacts(slug),
    deleteGameGroupChats(slug),
  ]);
}
