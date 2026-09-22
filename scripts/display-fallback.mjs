/**
 * The stage through the transitions that actually happen on a phone.
 *
 * Removing the CSS rotation is only half an answer. The half that matters is
 * whether the ordinary layout survives the things a browser does to it without
 * asking: the device turning, Safari's toolbars growing and collapsing, a
 * keyboard arriving under a chat field, and the player going back to the game
 * afterwards. Each of those changes the viewport out from under a layout whose
 * insets are measured at runtime, and a measured inset that is not re-measured
 * is just a stale constant.
 *
 * After every transition this asserts the same three things: the stage has a
 * usable box, the bar is not sitting on it, and every cell still clears a 44px
 * touch target. Plus the frame's identity, because none of this is worth
 * anything if the round was lost on the way.
 *
 * Usage: PREVIEW=https://… BYPASS=… node scripts/display-fallback.mjs
 */
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';

const PREVIEW = (process.env.PREVIEW || '').replace(/\/$/, '');
const BYPASS = process.env.BYPASS || process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
const OUT = process.env.OUT || '.display';
const CHROMIUM = process.env.CHROMIUM_EXECUTABLE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const GAME = process.env.GAME || 'nightclub-showdown-inzone-production';
if (!PREVIEW) throw new Error('PREVIEW is required');

function bypassed(url) {
  if (!BYPASS) return url;
  const u = new URL(url);
  u.searchParams.set('x-vercel-protection-bypass', BYPASS);
  u.searchParams.set('x-vercel-set-bypass-cookie', 'true');
  return u.toString();
}

const MEASURE = `(() => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const stage = box(document.querySelector('.game-stage'));
  const rail = box(document.querySelector('.game-rail'));
  const cells = [...document.querySelectorAll('.game-rail > .rail-btn')].map((c) => {
    const r = c.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  const f = document.querySelector('.game-frame-body iframe');
  if (f && !f.__stamp) f.__stamp = Math.random().toString(36).slice(2);
  return {
    stage, rail, cells,
    frame: f ? f.__stamp : null,
    src: f ? f.getAttribute('src') : null,
    fullscreenOffered: Boolean(document.querySelector('[data-testid="player-fill-screen"]')),
    moreOpen: Boolean(document.querySelector('[data-testid="player-more-sheet"]')),
    orientationHint: Boolean(document.querySelector('[data-testid="player-orientation-hint"]')),
    transform: getComputedStyle(document.querySelector('.game-frame-body')).transform,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    visual: window.visualViewport ? { w: Math.round(window.visualViewport.width), h: Math.round(window.visualViewport.height) } : null,
  };
})()`;

const results = [];
function judge(label, m) {
  const overlap = m.stage && m.rail
    && m.stage.x < m.rail.x + m.rail.w && m.rail.x < m.stage.x + m.stage.w
    && m.stage.y < m.rail.y + m.rail.h && m.rail.y < m.stage.y + m.stage.h;
  const smallest = m.cells.length ? Math.min(...m.cells.map((c) => Math.min(c.w, c.h))) : 0;
  const usable = Boolean(m.stage && m.stage.w >= 200 && m.stage.h >= 120);
  const ok = usable && !overlap && smallest >= 44;
  results.push({ label, ok, stage: m.stage, rail: m.rail, smallestTouchTarget: smallest, overlap, frame: m.frame, viewport: m.viewport, visual: m.visual, transform: m.transform });
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(34)} stage ${m.stage ? `${m.stage.w}x${m.stage.h}` : '-'} `
    + `bar ${m.rail ? `${m.rail.w}x${m.rail.h}` : '-'} smallest-target ${smallest}px overlap=${overlap} transform=${m.transform === 'none' ? 'none' : 'SET'}`,
  );
  return m;
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: CHROMIUM, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(bypassed(`${PREVIEW}/games/${GAME}`), { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.game-frame-body iframe', { state: 'attached', timeout: 90000 });
  await page.waitForTimeout(14000);

  const first = judge('phone portrait', await page.evaluate(MEASURE));
  /* The fullscreen control is a secondary action, so it lives behind More.
     Looking for it in the bar reported it missing on a browser that plainly
     has the API. */
  await page.locator('[data-testid="player-more"]').click().catch(() => {});
  await page.waitForTimeout(900);
  const withMore = await page.evaluate(MEASURE);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(600);
  console.log(
    `      capability gate: fullscreen control in More = ${withMore.fullscreenOffered} `
    + `| orientation hint shown = ${first.orientationHint} `
    + `(exactly one of these should be true for a given browser)`,
  );
  results.push({
    label: 'exactly one of fullscreen control / orientation hint is offered',
    ok: withMore.fullscreenOffered !== first.orientationHint,
    detail: `control=${withMore.fullscreenOffered} hint=${first.orientationHint}`,
  });

  // The device turns.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(2500);
  judge('after physical rotation', await page.evaluate(MEASURE));

  // Safari's toolbars collapse on scroll and grow back. The layout viewport
  // does not change; the visual one does, and the bar is measured from layout
  // boxes, so this is the case that proves it does not chase the wrong number.
  await page.setViewportSize({ width: 844, height: 330 });
  await page.waitForTimeout(2000);
  judge('toolbar grown (shorter viewport)', await page.evaluate(MEASURE));
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(2000);
  judge('toolbar collapsed again', await page.evaluate(MEASURE));

  // Back to portrait, then Chat with its keyboard.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(2500);
  judge('rotated back to portrait', await page.evaluate(MEASURE));

  await page.locator('[data-testid="player-chat"]').click().catch(() => {});
  await page.waitForTimeout(3500);
  const composer = page.locator('.sp-compose textarea, .sp-compose input').first();
  const hasComposer = await composer.count();
  if (hasComposer) {
    await composer.click().catch(() => {});
    // A software keyboard shrinks the visual viewport; emulate the layout
    // consequence a page actually sees.
    await page.setViewportSize({ width: 390, height: 500 });
    await page.waitForTimeout(2000);
    judge('chat open with keyboard', await page.evaluate(MEASURE));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1500);
  } else {
    console.log('SKIP  chat composer not found — keyboard case not exercised');
  }

  await page.keyboard.press('Escape').catch(() => {});
  await page.locator('.social-panel-scrim').click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const back = judge('back to gameplay', await page.evaluate(MEASURE));

  console.log(`\nframe identity across every transition: ${back.frame === first.frame ? 'UNCHANGED' : 'CHANGED — a round was lost'}`);
  console.log(`src: ${back.src}`);
  results.push({ label: 'frame identity preserved', ok: back.frame === first.frame });

  // A refused fullscreen request must not leave the control stuck on.
  const refused = await page.evaluate(async () => {
    const shell = document.querySelector('.game-frame-shell');
    if (!shell || typeof shell.requestFullscreen !== 'function') return 'no-api';
    try { await shell.requestFullscreen(); return 'granted'; } catch (e) { return `refused: ${String(e.name)}`; }
  });
  const afterRefusal = await page.evaluate(MEASURE);
  const stillFine = afterRefusal.stage && afterRefusal.stage.w > 0 && afterRefusal.transform === 'none';
  console.log(`\nfullscreen request outside a user gesture: ${refused} — layout after: ${stillFine ? 'intact' : 'BROKEN'}`);
  results.push({ label: 'refused fullscreen leaves the layout intact', ok: Boolean(stillFine), detail: refused });

  await page.screenshot({ path: `${OUT}/after-transitions.png` });
  await ctx.close();
} finally {
  await browser.close();
}
await writeFile(`${OUT}/display.json`, JSON.stringify({ preview: PREVIEW, results }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length} checks — ${results.length - failed.length} PASS, ${failed.length} FAIL`);
process.exit(failed.length ? 1 : 0);
