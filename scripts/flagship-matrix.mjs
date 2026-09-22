/**
 * What each flagship actually does, per device class, with the failure
 * attributed to a layer.
 *
 * "It does not work on my phone" is not actionable. Four different things wear
 * that sentence and they are fixed in four different places, so this separates
 * them:
 *
 *   host-layout     our stage or bar is the wrong size, or covers the game
 *   game-canvas     the build's own canvas or camera is wrong in the space given
 *   touch-controls  the build responds to keys we cannot send from a phone
 *   assets          something the build needs 404s
 *   menu-only       everything works and ordinary input never reaches a round
 *
 * Only the first is ours to fix in CSS. Recording a game-level problem as a
 * host problem, or papering over it with a generic workaround, is how a title
 * stays broken for months while looking attended to.
 *
 * This is Chromium automation. It establishes that a build comes up, sizes
 * correctly and responds; it does not establish that a person can play it on a
 * real device, and nothing here should be read as that.
 *
 * IT ALSO HAS TO KNOW WHEN IT CANNOT SEE
 * --------------------------------------
 * The first run of this script reported four of five flagships as broken
 * assets. They were not. Every one of those failures was
 * `ERR_TUNNEL_CONNECTION_FAILED` — this sandbox's egress proxy refusing a
 * CONNECT to a third-party host — so the builds' own script bundles never
 * downloaded and of course nothing drew or responded.
 *
 * That is a fact about where the test runs, not about the game, and reporting
 * it as a game defect would have sent someone to fix a file that is fine.
 * Titles served entirely from our own /gcs path are unaffected, which is
 * exactly why those are the two that have ever been "verified" here — a
 * pattern worth being suspicious of rather than proud of. Blocked-egress
 * failures are now classified `not-evaluable-here` and the hosts are named.
 *
 * Usage: PREVIEW=https://… BYPASS=… node scripts/flagship-matrix.mjs
 */
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';

const PREVIEW = (process.env.PREVIEW || '').replace(/\/$/, '');
const BYPASS = process.env.BYPASS || process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
const OUT = process.env.OUT || '.matrix';
const CHROMIUM = process.env.CHROMIUM_EXECUTABLE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
if (!PREVIEW) throw new Error('PREVIEW is required');

const TITLES = [
  ['kart-bros', 'Kart Bros'],
  ['clelytraflight', 'Elytra Flight'],
  ['karate-bros', 'Karate Bros'],
  ['clescaperoad', 'Escape Road'],
  ['nightclub-showdown-inzone-production', 'Nightclub Showdown'],
];

const DEVICES = [
  ['phone', { width: 390, height: 844 }, true],
  ['tablet', { width: 834, height: 1112 }, true],
  ['desktop', { width: 1440, height: 900 }, false],
];

function bypassed(url) {
  if (!BYPASS) return url;
  const u = new URL(url);
  u.searchParams.set('x-vercel-protection-bypass', BYPASS);
  u.searchParams.set('x-vercel-set-bypass-cookie', 'true');
  return u.toString();
}

/** Reads the drawn surface and the host boxes from inside the page. */
const INSPECT = `(() => {
  const stage = document.querySelector('.game-stage');
  const rail = document.querySelector('.game-rail');
  const iframe = document.querySelector('.game-frame-body iframe');
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }; };
  const out = { stage: box(stage), rail: box(rail), frame: box(iframe), src: iframe ? iframe.getAttribute('src') : null };
  try {
    const doc = iframe && iframe.contentDocument;
    if (doc) {
      const canvases = [...doc.querySelectorAll('canvas')].map((c) => ({ w: c.clientWidth, h: c.clientHeight, cw: c.width, ch: c.height }));
      out.canvases = canvases;
      out.bodyText = (doc.body ? doc.body.innerText || '' : '').slice(0, 300).replace(/\\s+/g, ' ').trim();
      out.readable = true;
    } else { out.readable = false; }
  } catch (e) { out.readable = false; out.readError = String(e && e.message); }
  return out;
})()`;

/**
 * Motion is read from a compositor screenshot of the stage, not from the
 * canvas. Reading a WebGL canvas back needs `preserveDrawingBuffer`, which no
 * game sets, so the first version of this returned null for every title and
 * duly reported that Nightclub Showdown does not respond to taps. A screenshot
 * sees whatever the player sees, whatever the renderer.
 */
async function stageFingerprint(page) {
  try {
    const box = await page.locator('.game-stage').boundingBox();
    if (!box || box.width < 2 || box.height < 2) return null;
    const shot = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
    let hash = 0;
    for (let i = 0; i < shot.length; i += 97) hash = (hash * 31 + shot[i]) % 4294967296;
    return `${shot.length}:${hash}`;
  } catch { return null; }
}

/** Failures that mean "this sandbox could not fetch it", not "the build is broken". */
const EGRESS_BLOCKED = /ERR_TUNNEL_CONNECTION_FAILED|ERR_BLOCKED_BY_ORB|ERR_PROXY|ERR_NAME_NOT_RESOLVED/;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: CHROMIUM,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});

const rows = [];
try {
  for (const [id, name] of TITLES) {
    for (const [device, viewport, touch] of DEVICES) {
      const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
      const page = await ctx.newPage();
      const failed = [];
      const errors = [];
      page.on('requestfailed', (r) => failed.push({ url: r.url(), error: r.failure()?.errorText ?? '' }));
      page.on('response', (r) => { if (r.status() >= 400) failed.push({ url: r.url(), error: `HTTP ${r.status()}` }); });
      page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 120)));

      const row = { id, name, device, viewport: `${viewport.width}x${viewport.height}` };
      try {
        await page.goto(bypassed(`${PREVIEW}/games/${id}`), { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.waitForSelector('.game-frame-body iframe', { timeout: 45000 });
        await page.waitForTimeout(16000);
        const before = await page.evaluate(INSPECT);
        row.src = before.src;
        row.stage = before.stage;
        row.mounted = Boolean(before.src);

        // Host layer: does our stage fill the viewport minus the bar, and does
        // the bar stay off the game?
        const overlap = before.stage && before.rail
          ? before.stage.x < before.rail.x + before.rail.w && before.rail.x < before.stage.x + before.stage.w
            && before.stage.y < before.rail.y + before.rail.h && before.rail.y < before.stage.y + before.stage.h
          : false;
        row.hostLayoutOk = Boolean(before.stage && before.stage.w > 0 && before.stage.h > 0 && !overlap);

        // Game layer: is it drawing anything, and how much of the stage does it use?
        const biggest = (before.canvases || []).sort((a, b) => (b.w * b.h) - (a.w * a.h))[0] || null;
        row.canvas = biggest ? `${biggest.w}x${biggest.h}` : null;
        row.canvasFill = biggest && before.stage
          ? Math.round((biggest.w * biggest.h) / (before.stage.w * before.stage.h) * 100)
          : null;
        row.readable = before.readable;
        row.screenText = (before.bodyText || '').slice(0, 120);

        // Does ordinary input change what is drawn? Three taps in the middle,
        // then compare fingerprints. Motion without input is animation; motion
        // only after input is a response.
        const fpIdle1 = await stageFingerprint(page);
        await page.waitForTimeout(2500);
        const fpIdle2 = await stageFingerprint(page);
        const stage = await page.locator('.game-stage').boundingBox();
        if (stage) {
          for (let i = 0; i < 3; i += 1) {
            await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
            await page.waitForTimeout(900);
          }
        }
        await page.waitForTimeout(2000);
        const fpAfter = await stageFingerprint(page);
        row.animatesIdle = Boolean(fpIdle1 && fpIdle2 && fpIdle1 !== fpIdle2);
        row.respondsToTap = Boolean(fpAfter && fpIdle2 && fpAfter !== fpIdle2);
        const blockedHosts = [...new Set(
          failed.filter((f) => EGRESS_BLOCKED.test(f.error)).map((f) => { try { return new URL(f.url).host; } catch { return f.url; } }),
        )];
        const realFailures = failed.filter((f) => !EGRESS_BLOCKED.test(f.error));
        row.blockedHosts = blockedHosts.slice(0, 5);
        row.failedRequests = [...new Set(realFailures.map((f) => `${f.error} ${f.url.split('/').slice(-1)[0]}`))].slice(0, 5);
        row.pageErrors = [...new Set(errors)].slice(0, 3);

        /* Attribute the failure to a layer — and refuse to attribute one at all
           when this sandbox could not fetch the build's own files. */
        if (blockedHosts.length > 0 && (!biggest || !row.respondsToTap)) row.layer = 'not-evaluable-here';
        else if (!row.mounted) row.layer = 'assets';
        else if (!row.hostLayoutOk) row.layer = 'host-layout';
        else if (!biggest || biggest.w === 0) row.layer = 'game-canvas';
        else if (row.failedRequests.length > 0) row.layer = 'assets';
        else if (!row.respondsToTap && !row.animatesIdle) row.layer = 'touch-controls';
        else row.layer = 'responds';
        await page.screenshot({ path: `${OUT}/${id}-${device}.png` });
      } catch (err) {
        row.error = String(err && err.message).split('\n')[0].slice(0, 120);
        row.layer = 'blocked';
      }
      rows.push(row);
      console.log(
        `${name.padEnd(20)} ${device.padEnd(8)} mounted=${row.mounted ? 'y' : 'n'} host=${row.hostLayoutOk ? 'ok' : 'BAD'} ` +
        `canvas=${(row.canvas ?? '-').padEnd(9)} fill=${String(row.canvasFill ?? '-').padStart(3)}% idle=${row.animatesIdle ? 'y' : 'n'} ` +
        `tap=${row.respondsToTap ? 'y' : 'n'} layer=${row.layer}` +
        `${row.blockedHosts?.length ? ' blocked:' + row.blockedHosts.join(',') : ''}` +
        `${row.failedRequests?.length ? ' failed:' + row.failedRequests.length : ''}`,
      );
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
await writeFile(`${OUT}/matrix.json`, JSON.stringify({ preview: PREVIEW, rows }, null, 2));
console.log(`\n${rows.length} cells written to ${OUT}/matrix.json`);
