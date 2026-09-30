/**
 * Sitemap for inzone.games. Next builds this into `/sitemap.xml` at
 * generateSitemaps time. If firebase-admin isn't configured we still return
 * the static routes (`/` and `/games`) so a build without a service-account
 * key produces a valid, if smaller, sitemap rather than failing.
 */

import type { MetadataRoute } from 'next';
import { adminCredentialsConfigured, adminDb } from '@/lib/firebase-admin';
import { buildSitemap } from '@/lib/seo/game-metadata';

const COLLECTION = 'html_games';

async function fetchApprovedGameIds(): Promise<string[]> {
  if (!adminCredentialsConfigured()) return [];
  try {
    const snap = await adminDb()
      .collection(COLLECTION)
      .where('status', '==', 'approved')
      .get();
    const ids: string[] = [];
    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown> | undefined;
      const gameUrl = ((data?.gameUrl as string) ?? '').trim();
      // Skip entries with no playable build — matches the same gate the hub's
      // client-side listing uses in lib/games.ts::fetchApprovedGames.
      if (!gameUrl) continue;
      ids.push(doc.id);
    }
    return ids;
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const ids = await fetchApprovedGameIds();
  return buildSitemap(ids);
}
