/* Pinned same-origin mirror for third-party hosted builds.
 *
 * /mirror/<gameId>/<path> streams <repo>@<sha>/<dir>/<path> for the builds
 * profiled in lib/hosted-builds.ts. The player's phone only ever talks to
 * inzone.games: no jsDelivr connection for a filter, WebView or carrier to
 * refuse, no camouflaged `classroom.google.com` path in a URL bar, and one
 * less TLS handshake on a slow network.
 *
 * Not an open proxy: the game id must have a profile, the upstream is fixed
 * to that profile's repo, full commit SHA and folder, and path segments cannot
 * climb out of it. Because a SHA cannot change, responses are immutable and
 * the CDN keeps them — after the first player, a build is served from our edge.
 *
 * Documents are refused (see mirrorContentType): nothing from somebody else's
 * repo becomes a page on our origin. Every response also carries a sandboxing
 * CSP, which a script or image load ignores and a direct navigation obeys.
 */

import type { NextRequest } from 'next/server';
import { hostedBuild, mirrorContentType, mirrorUpstreamUrls } from '@/lib/hosted-builds';

export const dynamic = 'force-dynamic';

const PASSTHROUGH_HEADERS = ['content-range', 'accept-ranges', 'etag', 'last-modified'] as const;
const IMMUTABLE = 'public, max-age=31536000, immutable';

function refuse(status: number): Response {
  // Refusals are as stable as the pin, so let the edge absorb repeats (the
  // builds' own analytics beacons ask for recordsession.php on every event).
  return new Response(null, {
    status,
    headers: { 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { gameId: string; path: string[] } },
): Promise<Response> {
  const profile = hostedBuild(params.gameId);
  if (!profile) return refuse(404);
  const segments = params.path ?? [];
  const type = mirrorContentType(segments[segments.length - 1] ?? '');
  if (!type) return refuse(404);
  const urls = mirrorUpstreamUrls(profile, segments);
  if (urls.length === 0) return refuse(404);

  const fwd: Record<string, string> = {};
  const range = req.headers.get('range');
  if (range) fwd.range = range;

  let upstream: Response | null = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: fwd, cache: 'no-store' });
      if (res.ok || res.status === 206) {
        upstream = res;
        break;
      }
      if (res.status === 404 && url === urls[urls.length - 1]) return refuse(404);
    } catch {
      /* try the next upstream */
    }
  }
  if (!upstream) return new Response('Build storage unreachable', { status: 502 });

  const headers = new Headers();
  headers.set('content-type', type);
  headers.set('cache-control', IMMUTABLE);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('content-security-policy', 'sandbox');
  headers.set('cross-origin-resource-policy', 'same-origin');
  for (const h of PASSTHROUGH_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  const len = upstream.headers.get('content-length');
  // Only forward a length the body will actually have: a fetch that decoded a
  // Content-Encoding hands us more bytes than the upstream length says.
  if (len && !upstream.headers.get('content-encoding')) headers.set('content-length', len);
  return new Response(upstream.body, { status: upstream.status, headers });
}
