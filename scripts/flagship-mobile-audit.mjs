/**
 * Mobile fitness, per flagship, in minutes instead of days.
 *
 * The loop this replaces was "push → wait for Hexclave → interpret", and it
 * took days to say what one phone says in a minute. This drives each flagship
 * through the real player at a phone held upright (390x844, where a TikTok
 * arrival lands) and sideways (844x390), with touch and a mobile Android UA,
 * and records the things that decide whether that arrival ever plays:
 *
 *   firstFrameMs      the game document loaded
 *   firstCanvasMs     a canvas covers at least a quarter of the stage
 *   canvasFillPct     how much of the stage the biggest canvas covers
 *   blocker           a DOM screen over the game: rotate wall, loading div,
 *                     ad preroll (with how long it stayed)
 *   adHosts           requests to ad networks from the game frame
 *   thirdPartyHosts   every other off-origin host the game frame contacted;
 *                     jsdelivr must be zero now that builds come from /mirror
 *   touchTargets      DOM controls inside the game: how many are ≥ 44px and
 *                     how many smaller. Controls a build draws INTO its canvas
 *                     cannot be seen here and are reported as such.
 *   safeArea          whether in-game DOM controls respect safe-area insets
 *   landscapePrompt   what the host offered for a landscape build in portrait
 *   hostLayoutOk      the bar never overlaps the stage; no horizontal scroll
 *   firstResponse     the title's first ordinary action (its own recipe, a tap
 *                     where a thumb would go) changed what is drawn, and how
 *                     long after arrival. A response is not a round: this
 *                     proves the build took the input, nothing more.
 *
 * WHAT IT CANNOT SAY
 *   - Chromium with touch emulation is not a phone. It does not throttle a
 *     GPU, has no notch, and its WebGL is software. Frame rate on a $150
 *     Android and a real WebView (TikTok, Facebook, Opera) need a device.
 *   - A canvas-drawn screen ("please rotate", a menu) is pixels, not DOM. The
 *     audit reports fill and response, and the screenshot it saves is the
 *     evidence; it does not pretend to read the game's text.
 *   - This sandbox's egress proxy refuses some hosts. Anything that failed with
 *     a tunnel error is reported as not-evaluable-here with the host named,
 *     never as a broken game (see CLAUDE.md "Do not").
 *
 * Every URL carries inzone_qa=agent and every Meta request is aborted and
 * counted, so a run against production teaches the ad platform nothing.
 *
 * Usage:
 *   PREVIEW=https://… [BYPASS=…] [ONLY=kart-bros,clescaperoad] node scripts/flagship-mobile-audit.mjs
 * Writes .mobile-audit/audit.json, audit.md and one screenshot per cell.
 */
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';

const PREVIEW = (process.env.PREVIEW || '').replace(/\/$/, '');
const BYPASS = process.env.BYPASS || process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
const OUT = process.env.OUT || '.mobile-audit';
const CHROMIUM = process.env.CHROMIUM_EXECUTABLE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SETTLE_MS = Number(process.env.SETTLE_MS || 45000);
if (!PREVIEW) throw new Error('PREVIEW is required (a Preview URL or https://inzone.games)');

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; SM-A146B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

/**
 * The first ordinary action for each title, as a thumb would do it. `box169`
 * coordinates are fractions of the centred 16:9 box inside the game frame —
 * where these builds draw their menus at any aspect. `pad` presses one of the
 * host-added touch keys (lib/touch-controls.ts). Checked against the builds'
 * own screens on 2026-09-30; if a build is re-uploaded, re-check them.
 */
const TITLES = [
  { id: 'kart-bros', name: 'Kart Bros', first: { box169: [0.5, 0.52], what: 'QUICK PLAY' } },
  { id: 'clelytraflight', name: 'Elytra Flight', first: { box169: [0.5, 0.68], what: '1 PLAYER' } },
  { id: 'karate-bros', name: 'Karate Bros', first: { box169: [0.5, 0.49], what: 'PLAY NOW' } },
  { id: 'clescaperoad', name: 'Escape Road', first: { pad: 'right', what: '▶ pad (starts a run)' } },
  { id: 'nightclub-showdown-inzone-production', name: 'Nightclub Showdown', first: { box169: [0.5, 0.5], what: 'tap to start' } },
];

const ORIENTATIONS = [
  ['portrait', { width: 390, height: 844 }],
  ['landscape', { width: 844, height: 390 }],
];

const AD_HOSTS = /adinplay\.com|googlesyndication|doubleclick|imasdk|adnxs|crazygames.*ads|aniview|gamemonetize/i;
const META_HOSTS = /facebook\.(com|net)|fbcdn\.net/i;
const EGRESS_BLOCKED = /ERR_TUNNEL_CONNECTION_FAILED|ERR_BLOCKED_BY_ORB|ERR_PROXY|ERR_NAME_NOT_RESOLVED/;
const only = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);

function entryUrl(id) {
  const u = new URL(`${PREVIEW}/games/${id}`);
  u.searchParams.set('inzone_qa', 'agent');
  if (BYPASS) {
    u.searchParams.set('x-vercel-protection-bypass', BYPASS);
    u.searchParams.set('x-vercel-set-bypass-cookie', 'true');
  }
  return u.toString();
}

/** Everything read from inside the page in one pass. */
const INSPECT = `(() => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const stage = document.querySelector('.game-stage');
  const rail = document.querySelector('.game-rail');
  const iframe = document.querySelector('.game-stage iframe');
  const prompt = document.querySelector('[data-testid="player-landscape-prompt"]');
  const hint = document.querySelector('[data-testid="player-orientation-hint"]');
  const out = {
    stage: box(stage), rail: box(rail), frame: box(iframe),
    hostScrollX: document.scrollingElement ? document.scrollingElement.scrollWidth > window.innerWidth + 1 : false,
    landscapePrompt: prompt ? prompt.getAttribute('data-kind') : (hint ? 'hint' : null),
  };
  try {
    const doc = iframe && iframe.contentDocument;
    const win = iframe && iframe.contentWindow;
    if (!doc || !win) { out.readable = false; return out; }
    out.readable = true;
    const visible = (el) => { const r = el.getBoundingClientRect(); const cs = win.getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05; };
    const canvases = [...doc.querySelectorAll('canvas')].filter(visible).map((c) => { const r = c.getBoundingClientRect(); return r.width * r.height; });
    out.canvasArea = canvases.length ? Math.max(...canvases) : 0;
    out.frameArea = win.innerWidth * win.innerHeight;
    const controls = [...doc.querySelectorAll('button, [role="button"], a[href], input, select')].filter(visible);
    out.touchBig = controls.filter((c) => { const r = c.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }).length;
    out.touchSmall = controls.length - out.touchBig;
    let css = '';
    for (const s of [...doc.styleSheets]) { try { for (const r of [...s.cssRules]) css += r.cssText; } catch (e) {} }
    out.safeArea = controls.length === 0 ? 'no-dom-controls' : (/safe-area-inset-bottom/.test(css) ? 'yes' : 'no');
    const blockers = [
      ['rotate-wall', '#pleaserotate-backdrop'],
      ['loading', '#loading'],
      ['preroll', '#preroll'],
      ['preroll', '#videoad'],
      ['unity-error', '#unity-warning'],
    ];
    out.blocker = null;
    for (const [name, sel] of blockers) {
      const el = doc.querySelector(sel);
      if (el && visible(el) && el.getBoundingClientRect().width * el.getBoundingClientRect().height > out.frameArea * 0.2) { out.blocker = name; break; }
    }
    const meta = doc.querySelector('meta[name="viewport"]');
    out.viewportMeta = meta ? meta.getAttribute('content') : null;
    const ov = (el) => el ? win.getComputedStyle(el).overflow : '';
    out.overflowHidden = /hidden/.test(ov(doc.documentElement)) && /hidden/.test(ov(doc.body));
  } catch (e) { out.readable = false; out.readError = String(e && e.message); }
  return out;
})()`;

async function fingerprint(page, clip) {
  try {
    const shot = await page.screenshot({ clip });
    let hash = 0;
    for (let i = 0; i < shot.length; i += 97) hash = (hash * 31 + shot[i]) % 4294967296;
    return `${shot.length}:${hash}`;
  } catch { return null; }
}

async function performFirstAction(page, first, frameBox) {
  if (first.pad) {
    const frame = page.frames().find((f) => f.url().includes('/gcs/'));
    const pad = frame && frame.locator(`#__inzone-touch-keys .__inzone-pad.${first.pad}`);
    if (!pad || (await pad.count()) === 0) return 'no-pad';
    await pad.first().tap();
    return 'tapped';
  }
  const [fx, fy] = first.box169;
  const boxW = Math.min(frameBox.w, frameBox.h * 16 / 9);
  const boxH = boxW * 9 / 16;
  const x = frameBox.x + (frameBox.w - boxW) / 2 + fx * boxW;
  const y = frameBox.y + (frameBox.h - boxH) / 2 + fy * boxH;
  await page.touchscreen.tap(x, y);
  return 'tapped';
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: CHROMIUM,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=user-gesture-required'],
});

const rows = [];
try {
  for (const title of TITLES) {
    if (only.length && !only.includes(title.id)) continue;
    for (const [orientation, viewport] of ORIENTATIONS) {
      const ctx = await browser.newContext({ viewport, hasTouch: true, isMobile: true, userAgent: ANDROID_UA });
      const page = await ctx.newPage();
      const origin = new URL(PREVIEW).host;
      const hosts = new Map();
      const blocked = new Set();
      let metaRequests = 0;
      let jsdelivr = 0;
      const adSeen = new Set();
      await page.route(META_HOSTS, (route) => { metaRequests += 1; return route.abort(); });
      page.on('request', (r) => {
        let host = '';
        try { host = new URL(r.url()).host; } catch { return; }
        if (!host || host === origin || r.url().startsWith('data:') || r.url().startsWith('blob:')) return;
        if (/jsdelivr\.net/.test(host)) jsdelivr += 1;
        if (AD_HOSTS.test(host)) adSeen.add(host);
        const fromFrame = r.frame() && r.frame() !== page.mainFrame();
        if (fromFrame) hosts.set(host, (hosts.get(host) || 0) + 1);
      });
      page.on('requestfailed', (r) => { if (EGRESS_BLOCKED.test(r.failure()?.errorText || '')) { try { blocked.add(new URL(r.url()).host); } catch {} } });

      const row = { id: title.id, name: title.name, orientation, viewport: `${viewport.width}x${viewport.height}` };
      const t0 = Date.now();
      try {
        await page.goto(entryUrl(title.id), { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.waitForSelector('.game-stage iframe', { timeout: 45000 });
        let firstFrameMs = null;
        let firstCanvasMs = null;
        let blockerSince = null;
        let blockerMs = 0;
        let last = null;
        while (Date.now() - t0 < SETTLE_MS) {
          last = await page.evaluate(INSPECT);
          if (firstFrameMs === null && last.readable) firstFrameMs = Date.now() - t0;
          if (firstCanvasMs === null && last.canvasArea && last.stage && last.canvasArea >= 0.25 * last.stage.w * last.stage.h) firstCanvasMs = Date.now() - t0;
          if (last.blocker && blockerSince === null) blockerSince = Date.now();
          if (!last.blocker && blockerSince !== null) { blockerMs += Date.now() - blockerSince; blockerSince = null; }
          if (firstCanvasMs !== null && Date.now() - t0 > Math.min(SETTLE_MS, firstCanvasMs + 12000)) break;
          await page.waitForTimeout(1000);
        }
        if (blockerSince !== null) blockerMs += Date.now() - blockerSince;
        Object.assign(row, {
          firstFrameMs,
          firstCanvasMs,
          canvasFillPct: last?.stage && last?.canvasArea ? Math.round(last.canvasArea / (last.stage.w * last.stage.h) * 100) : 0,
          blocker: last?.blocker ?? null,
          blockerMs: blockerMs || 0,
          touchTargets: last?.readable ? { big: last.touchBig, small: last.touchSmall } : 'unreadable',
          safeArea: last?.safeArea ?? 'unreadable',
          viewportMeta: last?.viewportMeta ?? null,
          overflowHidden: last?.overflowHidden ?? null,
          landscapePrompt: last?.landscapePrompt ?? null,
        });
        const s = last?.stage;
        const r = last?.rail;
        const overlap = s && r ? s.x < r.x + r.w && r.x < s.x + s.w && s.y < r.y + r.h && r.y < s.y + s.h : false;
        row.hostLayoutOk = Boolean(s && s.w > 0 && s.h > 0 && !overlap && !last.hostScrollX);

        // First ordinary action: dismiss the landscape prompt first — a thumb
        // would — then act and compare the stage before and after.
        const dismiss = page.locator('[data-testid="player-landscape-prompt"] button[aria-label^="Dismiss"]');
        if (await dismiss.count()) await dismiss.first().tap().catch(() => {});
        const clip = s ? { x: s.x, y: s.y, width: s.w, height: s.h } : undefined;
        const idleA = await fingerprint(page, clip);
        await page.waitForTimeout(2000);
        const idleB = await fingerprint(page, clip);
        const acted = last?.frame ? await performFirstAction(page, title.first, last.frame) : 'no-frame';
        const actedAt = Date.now() - t0;
        await page.waitForTimeout(3000);
        const after = await fingerprint(page, clip);
        row.firstAction = `${title.first.what}: ${acted}`;
        row.animatesIdle = Boolean(idleA && idleB && idleA !== idleB);
        row.firstResponse = acted !== 'tapped' ? acted : (after && idleB && after !== idleB ? 'changed' : 'no-change');
        row.firstResponseMs = row.firstResponse === 'changed' ? actedAt : null;
        await page.screenshot({ path: `${OUT}/${title.id}-${orientation}.png` });
      } catch (err) {
        row.error = String(err && err.message).split('\n')[0].slice(0, 160);
      }
      row.thirdPartyHosts = Object.fromEntries([...hosts].sort((a, b) => b[1] - a[1]).slice(0, 12));
      row.jsdelivrRequests = jsdelivr;
      row.adHosts = [...adSeen];
      row.metaRequestsAborted = metaRequests;
      row.blockedByThisRunner = [...blocked];
      row.verdict = row.error ? 'error'
        : blocked.size && !row.firstCanvasMs ? 'not-evaluable-here'
          : !row.firstCanvasMs ? 'no-canvas'
            : row.blocker ? `blocked-by-${row.blocker}`
              : row.firstResponse === 'changed' ? 'responds'
                : 'no-response';
      rows.push(row);
      console.log(
        `${title.name.padEnd(19)} ${orientation.padEnd(9)} canvas@${row.firstCanvasMs ?? '-'}ms fill=${row.canvasFillPct ?? '-'}% ` +
        `blocker=${row.blocker ?? 'none'} touch≥44=${row.touchTargets?.big ?? '-'} small=${row.touchTargets?.small ?? '-'} ` +
        `prompt=${row.landscapePrompt ?? '-'} first=${row.firstResponse ?? '-'} jsdelivr=${row.jsdelivrRequests} ads=${row.adHosts.length} ` +
        `→ ${row.verdict}${row.blockedByThisRunner.length ? ' (runner refused: ' + row.blockedByThisRunner.join(',') + ')' : ''}`,
      );
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}

const md = [
  `# Flagship mobile audit — ${PREVIEW}`,
  '',
  'Chromium touch emulation, Android UA. A response is not a round; a device pass is still owed for every title.',
  '',
  '| Title | Orientation | Canvas at | Fill | Blocker | DOM touch ≥44 / <44 | Landscape prompt | First action | jsDelivr | Ad hosts | Verdict |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.name} | ${r.orientation} | ${r.firstCanvasMs ?? '—'} ms | ${r.canvasFillPct ?? '—'}% | ${r.blocker ?? 'none'} | ${typeof r.touchTargets === 'object' ? `${r.touchTargets.big} / ${r.touchTargets.small}` : '—'} | ${r.landscapePrompt ?? '—'} | ${r.firstAction ?? '—'} → ${r.firstResponse ?? '—'} | ${r.jsdelivrRequests} | ${r.adHosts.join(', ') || '—'} | ${r.verdict} |`),
  '',
].join('\n');
await writeFile(`${OUT}/audit.json`, JSON.stringify({ preview: PREVIEW, at: new Date().toISOString(), rows }, null, 2));
await writeFile(`${OUT}/audit.md`, md);
console.log(`\n${rows.length} cells → ${OUT}/audit.json, ${OUT}/audit.md`);
