'use client';

import {
  collection,
  deleteDoc,
  doc,
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
import type { CommunityGameDoc, DeveloperGame, HubGame } from './types';

const COLLECTION = 'html_games';

function isTimestamp(v: unknown): v is Timestamp {
  return !!v && typeof v === 'object' && 'toMillis' in (v as Record<string, unknown>);
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
  const engine = raw.engine === 'unity' ? 'unity' : 'html5';
  return {
    id,
    name: ((raw.name as string) ?? '').trim(),
    description: ((raw.description as string) ?? '').trim(),
    iconUrl: ((raw.iconUrl as string) ?? '').trim(),
    gameUrl: ((raw.gameUrl as string) ?? '').trim(),
    serverUrl: ((raw.serverUrl as string) ?? '').trim(),
    engine,
    status: ((raw.status as string) ?? '').trim(),
    createdAt: isTimestamp(created) ? created.toMillis() : null,
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

export interface GameMetadataPatch {
  name: string;
  description: string;
  serverUrl: string;
}

/** Update the editable metadata on a game the developer owns. The doc id (slug)
 *  and the stored build are left untouched — only display fields change, so the
 *  live URL stays stable. */
export async function updateGameMetadata(id: string, patch: GameMetadataPatch): Promise<void> {
  const db = getDb();
  await updateDoc(doc(db, COLLECTION, id), {
    name: patch.name.trim(),
    description: patch.description.trim(),
    serverUrl: patch.serverUrl.trim(),
    updatedAt: serverTimestamp(),
  });
}

/** Replace a game's icon: upload the new image to `<slug>-icon.<ext>` and
 *  point the game doc's iconUrl at it. Returns the new download URL. The doc id
 *  and stored build are untouched, so only the displayed icon changes. */
export async function updateGameIcon(slug: string, file: File): Promise<string> {
  const storage = getHtmlStorage();
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const ref = storageRef(storage, `${slug}-icon.${ext}`);

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

/** Permanently delete a game the developer owns: its Firestore doc, all of its
 *  storage artifacts (single file, bundle prefix, Unity binary, icon), and its
 *  community group chat. Storage/chat cleanup is best-effort so a partial
 *  failure there still removes the game from the hub. */
export async function deleteGame(game: Pick<DeveloperGame, 'id'>): Promise<void> {
  const db = getDb();
  const slug = game.id;
  // Remove from the hub first — that's the user-visible effect.
  await deleteDoc(doc(db, COLLECTION, slug));
  // Then clean up the artifacts that are keyed off the slug.
  await Promise.all([
    clearStoragePrefix(storageRef(getHtmlStorage(), slug)),
    clearSlugArtifacts(slug),
    deleteGameGroupChats(slug),
  ]);
}
