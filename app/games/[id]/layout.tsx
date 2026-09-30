/**
 * Server layout for the game player route. Its whole job is per-game SEO —
 * unique <title>, description, canonical URL, Open Graph tags, and a VideoGame
 * JSON-LD block — so Google sees N different pages instead of N copies of
 * "InZone" (which is what the root layout's default metadata was producing
 * on every /games/[id] route before this).
 *
 * The player itself is a client component (see ./page.tsx); this layout wraps
 * it and never touches DOM the player owns.
 *
 * If firebase-admin isn't configured (local dev without a service-account,
 * or a build environment that omits it), we return the hub's default title
 * and skip the JSON-LD block rather than crashing the page. The client page
 * still renders, so the user sees the game either way.
 */

import { cache } from 'react';
import type { Metadata } from 'next';
import { adminCredentialsConfigured, adminDb } from '@/lib/firebase-admin';
import {
  buildGameDescription,
  buildGameJsonLd,
  buildGameTitle,
  gameCanonicalUrl,
  SITE_ORIGIN,
  type SeoGame,
} from '@/lib/seo/game-metadata';

const COLLECTION = 'html_games';

/**
 * Fetch a game's SEO-relevant fields server-side. Deduplicated with React
 * `cache` so `generateMetadata` and the JSON-LD block in the same request
 * share one Firestore read.
 *
 * Returns null when the doc doesn't exist, has no gameUrl (matches
 * `lib/games.ts::fetchGameById`'s "no playable build" bail), or when
 * admin credentials aren't wired.
 */
const loadSeoGame = cache(async (id: string): Promise<SeoGame | null> => {
  if (!adminCredentialsConfigured()) return null;
  try {
    const snap = await adminDb().collection(COLLECTION).doc(id).get();
    if (!snap.exists) return null;
    const raw = snap.data() as Record<string, unknown> | undefined;
    if (!raw) return null;
    const gameUrl = ((raw.gameUrl as string) ?? '').trim();
    if (!gameUrl) return null;
    return {
      name: ((raw.name as string) ?? '').trim(),
      description: ((raw.description as string) ?? '').trim(),
      iconUrl: ((raw.iconUrl as string) ?? '').trim(),
    };
  } catch {
    return null;
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const game = await loadSeoGame(id);
  const title = buildGameTitle(game);
  const description = buildGameDescription(game);
  const canonical = gameCanonicalUrl(id);
  const images = game?.iconUrl ? [{ url: game.iconUrl, alt: game?.name || 'InZone' }] : undefined;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: 'InZone',
      type: 'website',
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: game?.iconUrl ? [game.iconUrl] : undefined,
    },
  };
}

async function GameStructuredData({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const game = await loadSeoGame(id);
  const jsonLd = buildGameJsonLd(id, game, SITE_ORIGIN);
  if (!jsonLd) return null;
  return (
    <script
      type="application/ld+json"
      // Serialising with JSON.stringify keeps the payload free of the HTML
      // fragments Next would otherwise escape when React renders text.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

export default async function GamePageLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  return (
    <>
      <GameStructuredData params={params} />
      {children}
    </>
  );
}
