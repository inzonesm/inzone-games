'use client';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fbLimit,
  query,
  where,
  type Timestamp,
} from 'firebase/firestore';
import { getDb } from './firebase';
import type { CommunityGameDoc, HubGame } from './types';

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
