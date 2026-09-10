import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { instrumentGameHtml } from '../../lib/game-hosting.ts';

if (process.env.NODE_ENV === 'production') throw new Error('Local SDK host harness disabled in production');

const port = Number(process.env.SDK_HOST_PORT || 4175);
const hostPage = fileURLToPath(new URL('./host.html', import.meta.url));
const gameDir = fileURLToPath(new URL('../../fixtures/sdk-example/game/', import.meta.url));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(await readFile(hostPage));
      return;
    }
    if (url.pathname === '/game/index.html' || url.pathname === '/game/') {
      const html = await readFile(new URL('../../fixtures/sdk-example/game/index.html', import.meta.url), 'utf8');
      const instrumented = instrumentGameHtml(html, { baseHref: '/game/', gameId: 'sdk-example', injectSdk: true });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      if (req.headers.origin === 'null') res.setHeader('Access-Control-Allow-Origin', 'null');
      res.end(instrumented);
      return;
    }
    if (url.pathname === '/game/asset.svg') {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.end(await readFile(new URL('../../fixtures/sdk-example/game/asset.svg', import.meta.url)));
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
  console.log(`SDK host harness http://127.0.0.1:${port}`);
});

void gameDir;
