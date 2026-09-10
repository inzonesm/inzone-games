import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { injectViewportFit, injectServerUrlPersist, injectBaseHref, insertEarly } from '../../lib/game-hosting.ts';
import { bootstrapScript } from './bootstrap.mjs';

if (process.env.NODE_ENV === 'production') throw new Error('Local SDK harness disabled in production');
const port = Number(process.env.SDK_HARNESS_PORT || 4173);
const fixture = fileURLToPath(new URL('./fixture.html', import.meta.url));
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  try {
    if (url.pathname === '/') {
      res.end('<!doctype html><title>InZone SDK harness</title><h1>Development fixture — no identity or backend</h1><p><a href="/?fail=1">Failure fixture</a> · <a href="/">Normal fixture</a></p><iframe title="Game" src="/game/index.html'+(url.searchParams.has('fail')?'?fail=1':'')+'" width="800" height="500"></iframe>');
    } else if (url.pathname === '/game/index.html') {
      let html = await readFile(fixture, 'utf8');
      html = injectBaseHref(injectServerUrlPersist(injectViewportFit(html)), '/game/');
      html = insertEarly(html, '<script id="sdk-bootstrap">'+bootstrapScript({ fixtureMode: true, fail: url.searchParams.has('fail') })+'</script>');
      res.end(html);
    } else if (url.pathname === '/game/asset.svg') {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18" fill="limegreen"/></svg>');
    } else { res.statusCode = 404; res.end('Not found'); }
  } catch (error) { res.statusCode = 500; res.end('Harness error'); console.error(error); }
});
server.listen(port, '127.0.0.1', () => console.log(`SDK harness http://127.0.0.1:${port}`));
