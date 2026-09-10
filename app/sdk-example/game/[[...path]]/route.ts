import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import { applyPublicGameCors, instrumentGameHtml } from '@/lib/game-hosting';

export const dynamic = 'force-dynamic';

const ROOT = path.join(process.cwd(), 'public/sdk-example/game');

function mime(file: string): string {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}

export async function GET(
  req: NextRequest,
  { params }: { params: { path?: string[] } },
): Promise<Response> {
  const segments = params.path && params.path.length > 0 ? params.path : ['index.html'];
  if (segments.some((part) => part === '..' || part.includes('\0'))) {
    return new Response('Not found', { status: 404 });
  }
  const filePath = path.join(ROOT, ...segments);
  if (!filePath.startsWith(ROOT)) {
    return new Response('Not found', { status: 404 });
  }
  let body: Buffer;
  try {
    body = await readFile(filePath);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const headers = new Headers();
  headers.set('content-type', mime(filePath));
  headers.set('cache-control', 'no-store');
  applyPublicGameCors(headers, { origin: req.headers.get('origin'), url: req.url });
  if (mime(filePath).includes('text/html')) {
    const html = instrumentGameHtml(body.toString('utf8'), {
      baseHref: '/sdk-example/game/',
      gameId: 'sdk-example',
    });
    return new Response(html, { status: 200, headers });
  }
    return new Response(new Uint8Array(body), { status: 200, headers });
}
