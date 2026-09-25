/* Entry resolution endpoint — the game's URL, ahead of the catalogue read.
 *
 * The player cannot request a game until it has read one Firestore document in
 * the browser. That read costs ~2.2 s from navigation on production, and the
 * frame only mounts afterwards. This serves the same answer from the edge so
 * the frame can start loading while the browser is still booting Firebase.
 *
 * It does NOT replace the catalogue read. The player still fetches the full
 * document for everything else; this only gets the frame moving sooner, and
 * the player falls back to the client read whenever this is unavailable.
 *
 * Semantics deliberately mirror `fetchGameById` (lib/games.ts): no `status`
 * filter, because a direct link to a withdrawn game must keep resolving into
 * the host's recovery UI rather than a dead end. `status` is returned so the
 * caller can decide. Only the fields in `shapeGameEntry`'s allowlist are sent.
 *
 * Cached briefly at the edge so a catalogue withdrawal or a version bump is
 * picked up within a minute, while repeat arrivals cost no Firestore read.
 */

import { NextResponse } from 'next/server';
import { adminCredentialsConfigured, adminDb } from '@/lib/firebase-admin';
import { shapeGameEntry } from '@/lib/game-entry-data';

export const runtime = 'nodejs';
/** Short enough that a withdrawal or a new build version lands quickly. */
const EDGE_TTL_SECONDS = 60;
const STALE_WHILE_REVALIDATE_SECONDS = 300;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw ?? '').trim();
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  // No admin credentials in this environment: say so plainly and let the
  // player fall back to its own read rather than failing the arrival.
  if (!adminCredentialsConfigured()) {
    return NextResponse.json({ error: 'entry resolution unavailable' }, { status: 503 });
  }

  try {
    const snap = await adminDb().collection('html_games').doc(id).get();
    const entry = shapeGameEntry(id, snap.exists ? (snap.data() as Record<string, unknown>) : null);
    if (!entry) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(entry, {
      headers: {
        'Cache-Control': `public, s-maxage=${EDGE_TTL_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_SECONDS}`,
      },
    });
  } catch {
    // A read failure here is never fatal to the arrival — the player reads the
    // catalogue itself regardless.
    return NextResponse.json({ error: 'entry resolution failed' }, { status: 503 });
  }
}
