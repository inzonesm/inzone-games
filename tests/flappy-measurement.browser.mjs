/**
 * Real v9 game + production hook + real Next Script lifecycle, in a disposable
 * local Next app. Ordinary canvas clicks only; reads engine state for aiming.
 * Meta calls are captured locally, NOT sent as fake production conversions.
 * Requires network for the public game assets and CHROMIUM_EXECUTABLE.
 * node tests/flappy-measurement.browser.mjs
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(path.join(tmpdir(), 'inzone-flappy-test-'));
const port = Number(process.env.TEST_PORT || 3197);
const base = `http://127.0.0.1:${port}`;
let server, browser;
let serverLog = '';
try {
  await mkdir(path.join(temp, 'app/second'), { recursive: true });
  await cp(path.join(root, 'fixtures/flappy-measurement/layout.tsx'), path.join(temp, 'app/layout.tsx'));
  await cp(path.join(root, 'fixtures/flappy-measurement/page.tsx'), path.join(temp, 'app/page.tsx'));
  await cp(path.join(root, 'lib'), path.join(temp, 'lib'), { recursive: true });
  await mkdir(path.join(temp, 'components'));
  await cp(path.join(root, 'components/MetaPixel.tsx'), path.join(temp, 'components/MetaPixel.tsx'));
  await writeFile(path.join(temp, 'app/second/page.tsx'), 'export default function Page(){ return <p>Second route</p>; }');
  await symlink(path.join(root, 'node_modules'), path.join(temp, 'node_modules'));
  await writeFile(path.join(temp, 'package.json'), JSON.stringify({ private: true }));
  await writeFile(path.join(temp, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2022', lib: ['dom', 'esnext'], module: 'esnext', moduleResolution: 'bundler', jsx: 'preserve',
    esModuleInterop: true, skipLibCheck: true, allowImportingTsExtensions: true, noEmit: true,
    baseUrl: '.', paths: { '@/*': ['./*'] },
  } }));
  await writeFile(path.join(temp, 'next.config.js'), `module.exports={experimental:{externalDir:true},async rewrites(){return [{source:'/gcs/:path*',destination:'https://www.inzone.games/gcs/:path*'}]}};`);
  server = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', temp, '-p', String(port), '-H', '127.0.0.1'], { cwd: root, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', chunk => { serverLog += chunk; });
  server.stderr.on('data', chunk => { serverLog += chunk; });
  const deadline = Date.now() + 90000;
  while (true) {
    try { if ((await fetch(base, { signal: AbortSignal.timeout(5000) })).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(`Next fixture did not start:\n${serverLog}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || '/usr/local/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__measurement = [];
    window.addEventListener('measurement-test', event => window.__measurement.push(event.detail));
  });
  await page.route('https://connect.facebook.net/**', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.__metaCalls=[];
    var f=window.fbq; f.callMethod=function(){window.__metaCalls.push(Array.from(arguments));};
    f.queue.splice(0).forEach(function(args){f.callMethod.apply(f,args)});
  ` }));
  await page.route('https://www.facebook.com/**', route => route.abort());
  await page.goto(`${base}/?utm_source=meta&utm_campaign=flappy_acceptance`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__metaCalls?.some(call => call[0] === 'track' && call[1] === 'PageView'));
  assert.equal(await page.evaluate(() => window.__metaCalls.filter(call => call[1] === 'PageView').length), 1);
  console.log('PASS: one JavaScript PageView on first hydration');

  const frame = page.frameLocator('iframe');
  await frame.locator('canvas').waitFor();
  const game = page.frames().find(f => f.url().includes('/gcs/'));
  await game.waitForFunction(() => !!window.pc?.Application?.getApplication()?.root.findByName('Game')?.findByName('Bird')?.script?.bird);
  await page.waitForTimeout(2500); // Includes two production polling cycles on an idle menu.
  const seen = name => page.evaluate(name => window.__measurement.filter(e => e.name === name), name);
  assert.equal((await seen('game_start')).length, 0);

  // Button centers from the real game's camera; this reads state, never mutates it.
  const clickEntity = async name => {
    const point = await game.evaluate(name => {
      const app = pc.Application.getApplication();
      const entity = app.root.findByName(name);
      const camera = app.root.findComponents('camera')[0];
      const p = camera.worldToScreen(entity.getPosition());
      const canvas = app.graphicsDevice.canvas;
      const rect = canvas.getBoundingClientRect();
      return { x: rect.x + p.x * rect.width / canvas.width, y: rect.y + p.y * rect.height / canvas.height };
    }, name);
    const box = await page.locator('iframe').boundingBox();
    await page.mouse.click(box.x + point.x, box.y + point.y);
  };
  await clickEntity('Start Button');
  await page.waitForTimeout(1200);
  assert.equal((await seen('game_start')).length, 0, 'get-ready is not gameplay');
  console.log('PASS: title screen and get-ready emit no game_start');
  await page.mouse.click(640, 300);
  await page.waitForFunction(() => window.__measurement.some(e => e.name === 'game_start'));
  await page.waitForFunction(() => window.__measurement.some(e => e.name === 'first_game_over'));
  assert.equal((await seen('game_start')).length, 1);
  assert.equal((await seen('first_game_over')).length, 1);
  const first = (await seen('game_start'))[0];
  assert.equal(first.data.game_id, 'flappybird-inzone-2');
  assert.equal(first.data.utm_campaign, 'flappy_acceptance');
  assert.equal(first.data.acquisition, 'direct');
  assert.equal(first.data.run_id, (await seen('first_game_over'))[0].data.run_id);
  console.log('PASS: real first flap and game over share a run ID and acquisition');

  await clickEntity('OK Button');
  await page.waitForTimeout(800);
  await clickEntity('Start Button');
  await page.waitForTimeout(800);
  await page.mouse.click(640, 300);
  const until = Date.now() + 180000;
  let nextReport = Date.now() + 15000;
  while (Date.now() < until && !(await seen('engaged_play')).length) {
    const state = await game.evaluate(() => {
      const app = pc.Application.getApplication();
      const e = app.root.findByName('Game').findByName('Bird');
      const b = e.script.bird, p = e.getPosition();
      const pipes = b.pipes.map(pipe => {
        const aabb = pipe.sprite._meshInstance.aabb;
        return { name: pipe.name, min: { x: aabb.getMin().x, y: aabb.getMin().y }, max: { x: aabb.getMax().x, y: aabb.getMax().y } };
      }).filter(pipe => pipe.max.x > p.x - b.radius).sort((a, b) => a.min.x - b.min.x);
      const bottom = pipes.find(pipe => pipe.name === 'Pipe Bottom');
      const top = pipes.find(pipe => pipe.name === 'Pipe Top');
      const target = bottom && top ? (bottom.max.y + top.min.y) / 2 : 0;
      return { state: b.state, y: p.y, target };
    });
    if (state.state === 'dead') {
      await clickEntity('OK Button'); await page.waitForTimeout(400);
      await clickEntity('Start Button'); await page.waitForTimeout(400);
      await page.mouse.click(640, 300);
    } else if (state.y < state.target) {
      await page.mouse.click(640, 300);
    }
    await page.waitForTimeout(70);
    if (Date.now() >= nextReport) {
      console.log('Active-play progress:', await page.evaluate(() => Object.keys(sessionStorage)
        .filter(key => key.startsWith('inzone.engagement.v1:')).map(key => {
          const value = JSON.parse(sessionStorage.getItem(key));
          return { activeSeconds: value.activeMs / 1000, rounds: value.startedRuns.length };
        })));
      nextReport = Date.now() + 15000;
    }
  }
  assert.equal((await seen('engaged_play')).length, 1, '60 seconds of real foreground play must produce engagement');
  assert.ok((await seen('engaged_play'))[0].data.active_seconds >= 60);
  assert.equal((await seen('first_game_over')).length, 1, 'once per visit, despite replay');
  assert.ok((await seen('game_start')).length >= 2);
  console.log('PASS: real replay and cumulative 60-second engagement');
  const meta = await page.evaluate(() => window.__metaCalls.filter(call => call[0] === 'trackCustom'));
  for (const name of ['game_start', 'first_game_over', 'engaged_play']) assert.ok(meta.some(call => call[1] === name), name);
  assert.ok(meta.every(call => ['game_start', 'first_game_over', 'engaged_play', 'return_play'].includes(call[1])));
  assert.ok(meta.every(call => call[2].event_id === call[3].eventID));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.frameLocator('iframe').locator('canvas').waitFor();
  const refreshedGame = page.frames().find(f => f.url().includes('/gcs/'));
  await refreshedGame.waitForFunction(() => !!window.pc?.Application?.getApplication()?.root.findByName('Game')?.findByName('Bird')?.script?.bird);
  // game_ready is correctly deduplicated across a refresh within the visit.
  // Wait for the real engine, not a second analytics event that must not exist.
  await page.waitForTimeout(1500);
  assert.equal((await seen('game_start')).length, 0);
  assert.equal((await seen('engaged_play')).length, 0);
  console.log('PASS: idle refresh does not create a start or repeat engagement');
  await page.getByRole('link', { name: 'Second route' }).click();
  await page.waitForFunction(() => window.__metaCalls.filter(call => call[1] === 'PageView').length === 2);
  console.log('PASS: verified events reach pixel with stable event IDs; route navigation adds one PageView');
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
  await rm(temp, { recursive: true, force: true });
}
