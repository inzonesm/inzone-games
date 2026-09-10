/* Same-origin game serving: /gcs/<path> streams the object at
 * storage.googleapis.com/<HTML_BUCKET>/<path>, injecting the viewport-fit
 * script into HTML responses on the way through (see lib/game-hosting.ts).
 *
 * Why this exists: games play inside an iframe, and the browser cannot script
 * a cross-origin iframe — so a game that renders oversized (fixed 1280×720
 * canvas on a 390px phone) could not be fixed from the player page, which is
 * what previously forced a blind manual zoom. Served same-origin with the fit
 * script injected, every game — including builds uploaded before the script
 * was baked in at upload time — measures and scales itself exactly like it
 * does inside the Flutter app's WebView.
 *
 * Relative asset URLs inside a game resolve against the document URL, so they
 * naturally route back through /gcs/... too (the path mirrors the bucket
 * layout). Query strings on the entry URL (e.g. ?serverUrl=…) stay on the
 * same-origin document, so games can still read them from location.search.
 * The upstream host is pinned to the game bucket — this is not an open proxy.
 */

import type { NextRequest } from 'next/server';
import {
  GCS_GAMES_PREFIX,
  applyPublicGameCors,
  gameIdFromGcsPath,
  instrumentGameHtml,
} from '@/lib/game-hosting';

export const dynamic = 'force-dynamic';

/** Response headers copied through from the bucket when present. */
const PASSTHROUGH_HEADERS = [
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
] as const;

export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } },
): Promise<Response> {
  const segments = params.path ?? [];
  if (segments.length === 0) {
    return new Response('Not found', { status: 404 });
  }

  // Next decodes path params; re-encode per segment for the upstream URL.
  // The game's own query string is NOT forwarded — GCS doesn't need it, and
  // params like ?serverUrl=… are meant for the game's client-side code.
  const upstreamUrl = GCS_GAMES_PREFIX + segments.map(encodeURIComponent).join('/');

  // Forward Range so audio/video seeking inside games keeps working.
  const fwd: Record<string, string> = {};
  const range = req.headers.get('range');
  if (range) fwd['range'] = range;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, { headers: fwd, cache: 'no-store' });
  } catch {
    return new Response('Game storage unreachable', { status: 502 });
  }

  if (!upstream.ok && upstream.status !== 206) {
    return new Response('Not found', { status: upstream.status === 403 ? 404 : upstream.status });
  }

  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
  const headers = new Headers();
  headers.set('content-type', contentType);
  applyPublicGameCors(headers, { origin: req.headers.get('origin'), url: req.url });
  for (const h of PASSTHROUGH_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  // Builds live under immutable version prefixes (games/<slug>/vN/…), so an
  // hour of caching is safe — a new build gets a new URL.
  headers.set('cache-control', 'public, max-age=3600');

  if (/text\/html/i.test(contentType)) {
    const html = await upstream.text();
    // Pin the document base to this game's folder so relative asset URLs keep
    // resolving there even after a SPA rewrites its own path; serverUrl-persist
    // keeps `?serverUrl=…` alive across those route changes; viewport-fit
    // normalizes sizing. baseHref is the entry file's directory under /gcs.
    const baseHref = `/gcs/${segments.slice(0, -1).map(encodeURIComponent).join('/')}/`;
    const instrumented = instrumentGameHtml(html, {
      baseHref,
      gameId: gameIdFromGcsPath(segments),
    });
    return new Response(instrumented, { status: upstream.status, headers });
  }

  const len = upstream.headers.get('content-length');
  if (len) headers.set('content-length', len);
  return new Response(upstream.body, { status: upstream.status, headers });
}
