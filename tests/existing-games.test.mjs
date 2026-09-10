import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instrumentGameHtml } from '../lib/game-hosting.ts';
import { isWebSdkHostEnabled } from '../lib/game-sdk/opt-in.ts';

const GCS = 'https://storage.googleapis.com/inzone-html/';

async function get(path) {
  const res = await fetch(GCS + path.split('/').map(encodeURIComponent).join('/'));
  assert.equal(res.ok, true, `${path} ${res.status}`);
  return res;
}

test('representative hub games keep hosting helpers without SDK injection', async () => {
  assert.equal(isWebSdkHostEnabled('snake'), false);
  assert.equal(isWebSdkHostEnabled('2048-inzone-upload'), false);
  assert.equal(isWebSdkHostEnabled('clcookieclicker'), false);

  const snakeHtml = await (await get('games/snake/v2/src/index.html')).text();
  const snake = instrumentGameHtml(snakeHtml, {
    baseHref: '/gcs/games/snake/v2/src/',
    gameId: 'snake',
  });
  assert.match(snake, /__inzoneViewportFit/);
  assert.match(snake, /<base href="\/gcs\/games\/snake\/v2\/src\/">/);
  assert.doesNotMatch(snake, /__inzoneWebSdk/);
  assert.match(snake, /href="index\.css"/);
  assert.match(snake, /src="index\.js"/);
  const snakeCss = await get('games/snake/v2/src/index.css');
  assert.match(snakeCss.headers.get('content-type') || '', /css|text/);
  const snakeJs = await (await get('games/snake/v2/src/index.js')).text();
  assert.match(snakeJs, /localStorage\.getItem\("highscore"\)/);
  assert.match(snakeJs, /localStorage\.setItem\("highscore"/);

  const html2048 = await (await get('games/2048-inzone-upload/v1/index.html')).text();
  const g2048 = instrumentGameHtml(html2048, {
    baseHref: '/gcs/games/2048-inzone-upload/v1/',
    gameId: '2048-inzone-upload',
  });
  assert.match(g2048, /__inzoneViewportFit/);
  assert.doesNotMatch(g2048, /__inzoneWebSdk/);
  const png = await get('games/2048-inzone-upload/v1/2048.png');
  assert.match(png.headers.get('content-type') || '', /image/);
  const gm = await get('games/2048-inzone-upload/v1/js/game_manager.js');
  assert.equal(gm.ok, true);

  const cookie = await (await get('games/clcookieclicker/v1/index.html')).text();
  const cookieOut = instrumentGameHtml(cookie, {
    baseHref: '/gcs/games/clcookieclicker/v1/',
    gameId: 'clcookieclicker',
  });
  assert.match(cookieOut, /<base href="https:\/\/cdn\.jsdelivr\.net\/gh\/bubbls\/UGS-Assets@main\/cookieclicker\/">/);
  assert.equal((cookieOut.match(/<base\b/gi) || []).length, 1);
  assert.doesNotMatch(cookieOut, /__inzoneWebSdk/);
  assert.match(cookieOut, /__inzoneViewportFit/);
});
