import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { applyPublicGameCors, instrumentGameHtml, gameIdFromGcsPath } from '../../lib/game-hosting.ts';
import { GAME_IFRAME_SANDBOX } from '../../lib/game-sdk/protocol.ts';
import { isWebSdkHostEnabled } from '../../lib/game-sdk/opt-in.ts';

if (process.env.NODE_ENV === 'production') throw new Error('Local legacy-games harness disabled in production');

const port = Number(process.env.LEGACY_GAMES_PORT || 4176);
const GCS = 'https://storage.googleapis.com/inzone-html/';
const fixtureDir = fileURLToPath(new URL('../../fixtures/legacy-storage/game/', import.meta.url));

function hostPage({ src, isolated }) {
  const sandbox = isolated ? ` sandbox="${GAME_IFRAME_SANDBOX}" referrerpolicy="no-referrer"` : '';
  return `<!doctype html><title>legacy host</title>
<p id="host-marker">trusted-host</p>
<iframe id="game" title="Game" src="${src}"${sandbox}></iframe>`;
}

function mime(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (url.pathname === '/legacy') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(hostPage({ src: '/fixture/index.html', isolated: false }));
      return;
    }
    if (url.pathname === '/isolated') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(hostPage({ src: '/fixture/index.html?sdk=1', isolated: true }));
      return;
    }
    if (url.pathname === '/gcs-snake') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(hostPage({ src: '/gcs/games/snake/v2/src/index.html', isolated: false }));
      return;
    }
    if (url.pathname === '/gcs-2048') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(hostPage({ src: '/gcs/games/2048-inzone-upload/v1/index.html', isolated: false }));
      return;
    }
    if (url.pathname.startsWith('/fixture/')) {
      const name = url.pathname.slice('/fixture/'.length) || 'index.html';
      if (name.includes('..') || name.includes('\0')) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      const body = await readFile(new URL(name, `file://${fixtureDir}`));
      const headers = new Headers();
      headers.set('content-type', mime(name));
      applyPublicGameCors(headers, { origin: req.headers.origin ?? null, url: url.href });
      for (const [k, v] of headers.entries()) res.setHeader(k, v);
      if (name.endsWith('.html')) {
        const html = instrumentGameHtml(body.toString('utf8'), {
          baseHref: '/fixture/',
          gameId: 'legacy-storage',
          injectSdk: url.searchParams.get('sdk') === '1',
        });
        res.end(html);
        return;
      }
      res.end(body);
      return;
    }
    if (url.pathname.startsWith('/gcs/')) {
      const rel = url.pathname.slice('/gcs/'.length);
      if (!rel.startsWith('games/') || rel.includes('..')) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      const upstream = await fetch(GCS + rel.split('/').map(encodeURIComponent).join('/'));
      if (!upstream.ok) {
        res.statusCode = upstream.status;
        res.end('upstream');
        return;
      }
      const contentType = upstream.headers.get('content-type') || mime(rel);
      const headers = new Headers();
      headers.set('content-type', contentType);
      applyPublicGameCors(headers, { origin: req.headers.origin ?? null, url: url.href });
      for (const [k, v] of headers.entries()) res.setHeader(k, v);
      const segments = rel.split('/');
      if (/text\/html/i.test(contentType) || rel.endsWith('.html')) {
        const html = await upstream.text();
        const gameId = gameIdFromGcsPath(segments);
        const baseHref = `/gcs/${segments.slice(0, -1).join('/')}/`;
        res.end(instrumentGameHtml(html, {
          baseHref,
          gameId,
          injectSdk: isWebSdkHostEnabled(gameId, process.env.NEXT_PUBLIC_INZONE_WEB_SDK_GAMES),
        }));
        return;
      }
      res.end(Buffer.from(await upstream.arrayBuffer()));
      return;
    }
    res.statusCode = 404;
    res.end('Not found');
  } catch (error) {
    res.statusCode = 500;
    res.end('Harness error');
    console.error(error);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Legacy games harness http://127.0.0.1:${port}`);
});
