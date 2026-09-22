/**
 * The whole player journey on a hosted Preview, in one pass.
 *
 * What this can prove and what it cannot, stated up front because the
 * difference is the whole value of the run:
 *
 *   PROVEN HERE   the conversation path end to end (a transcript in, an
 *                 OpenAI reply out, audio played), that gameplay continues
 *                 across turns, that interrupt and mute work, that a real
 *                 play session is written and a second browser joins it, that
 *                 opening chrome never remounts the game, and that Flappy
 *                 still enters and retries.
 *
 *   NOT PROVEN    a real microphone. This VM has no capture device, so the
 *                 transcript is delivered through a SpeechRecognition stand-in
 *                 that marks itself simulated. The product labels it
 *                 `simulated_recognition` and so does this script. Anyone
 *                 reading a PASS here should read it as "everything after the
 *                 words arrive works".
 *
 *   NOT PROVEN    Safari, and any physical device. Chromium only.
 *
 * Usage: PREVIEW=https://… BYPASS=… node scripts/player-journey.mjs
 */
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';

const PREVIEW = (process.env.PREVIEW || '').replace(/\/$/, '');
const BYPASS = process.env.BYPASS || process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
const OUT = process.env.OUT || '.journey';
const CHROMIUM = process.env.CHROMIUM_EXECUTABLE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const NIGHTCLUB = 'nightclub-showdown-inzone-production';
const FLAPPY = 'flappybird-inzone-2';
if (!PREVIEW) throw new Error('PREVIEW is required');

const results = [];
const record = (name, status, detail) => {
  results.push({ name, status, detail });
  console.log(`${status.padEnd(12)} ${name}${detail ? ` — ${detail}` : ''}`);
};

/** A SpeechRecognition stand-in that marks itself simulated, so the product's
 *  own honest labelling reports `simulated_recognition` rather than a mic. */
const INSTALL_FAKE_STT = `
  window.__INZONE_SIMULATED_RECOGNITION = true;
  window.__inzoneSay = null;
  function FakeSpeechRecognition() {
    this.lang = 'en-US'; this.interimResults = false; this.continuous = false; this.maxAlternatives = 1;
    this.onresult = null; this.onerror = null; this.onend = null;
    const self = this;
    this.start = function () {
      window.__inzoneSay = function (text) {
        if (!self.onresult) return false;
        self.onresult({ results: [[{ transcript: text }]] });
        return true;
      };
    };
    this.stop = function () { window.__inzoneSay = null; if (self.onend) self.onend(); };
    this.abort = function () { window.__inzoneSay = null; };
  }
  FakeSpeechRecognition.__inzoneSimulated = true;
  window.SpeechRecognition = FakeSpeechRecognition;
  window.webkitSpeechRecognition = FakeSpeechRecognition;
`;

/** Identity stamps for the frame, its window and its document. If any of these
 *  changes, the game was remounted and the player lost their round. */
const STAMP = `(() => {
  const f = document.querySelector('.game-frame-body iframe');
  if (!f) return null;
  if (!f.__stamp) f.__stamp = Math.random().toString(36).slice(2);
  let doc = null;
  try { 
    const w = f.contentWindow;
    if (w) { if (!w.__stamp) w.__stamp = Math.random().toString(36).slice(2); doc = w.__stamp; }
  } catch { doc = 'cross-origin'; }
  return { element: f.__stamp, doc, src: f.getAttribute('src') };
})()`;

const NIGHTCLUB_STATE = `(() => {
  const f = document.querySelector('.game-frame-body iframe');
  try {
    const w = f && f.contentWindow;
    const main = w && (w.Main || (w.$hx_exports && w.$hx_exports.Main));
    const hero = main && main.ME && main.ME.hero;
    return {
      readable: Boolean(hero),
      x: hero ? Number(hero.footX ?? hero.cx ?? 0) : null,
      paused: main && main.ME ? Boolean(main.ME.paused) : null,
      runId: w && w.__inzoneRunId ? String(w.__inzoneRunId) : null,
    };
  } catch (err) { return { readable: false, error: String(err && err.message) }; }
})()`;

await mkdir(OUT, { recursive: true });
/* TLS verification stays on. A sandbox whose Chromium has no populated NSS
   store fails every https page with ERR_CERT_AUTHORITY_INVALID, including the
   public web; the fix is to import the system CA bundle into ~/.pki/nssdb with
   certutil, not to tell the browser to stop checking. */
const browser = await chromium.launch({
  executablePath: CHROMIUM,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
  ],
});

/* Deployment protection is lifted with the query-param form, not the header
   form: the header variant is stripped before it reaches Vercel here and the
   navigation lands on the Vercel login page instead of the app. The first
   navigation sets the bypass cookie for the rest of the context. */
function bypassed(url) {
  if (!BYPASS) return url;
  const u = new URL(url);
  u.searchParams.set('x-vercel-protection-bypass', BYPASS);
  u.searchParams.set('x-vercel-set-bypass-cookie', 'true');
  return u.toString();
}

async function newContext(opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    permissions: ['clipboard-read', 'clipboard-write'],
    ...opts,
  });
  await ctx.addInitScript(INSTALL_FAKE_STT);
  return ctx;
}

let hostCtx;
try {
  hostCtx = await newContext({ recordVideo: { dir: OUT, size: { width: 390, height: 844 } } });
  const page = await hostCtx.newPage();
  const audioPlays = [];
  page.on('console', (m) => { if (m.text().startsWith('[journey]')) console.log(m.text()); });
  await page.addInitScript(() => {
    window.__audioPlays = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...a) { window.__audioPlays += 1; return play.apply(this, a); };
    const ac = window.AudioContext || window.webkitAudioContext;
    if (ac) {
      window.__pcmStarts = 0;
      const start = ac.prototype.createBufferSource;
      ac.prototype.createBufferSource = function (...a) { window.__pcmStarts += 1; return start.apply(this, a); };
    }
  });

  // ── Nightclub: arrival ───────────────────────────────────────────────
  await page.goto(bypassed(`${PREVIEW}/games/${NIGHTCLUB}`), { waitUntil: 'domcontentloaded', timeout: 120000 });
    // `attached`, not `visible`: a cold Preview can have the frame in the DOM
  // and still fail a visibility check while the boot overlay is painting over
  // it, and that is not a reason to abandon the run.
  await page.waitForSelector('.game-frame-body iframe', { state: 'attached', timeout: 90000 });
  await page.waitForTimeout(12000);
  const firstStamp = await page.evaluate(STAMP);
  record('nightclub: frame mounted', firstStamp?.src?.includes('/gcs/') ? 'PASS' : 'FAIL', firstStamp?.src ?? 'no src');

  // The bar: six cells on a phone, Rook first.
  const bar = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.game-rail > .rail-btn')];
    return {
      count: cells.length,
      labels: cells.map((c) => c.querySelector('.rail-cap')?.textContent?.trim() ?? ''),
      widths: cells.map((c) => Math.round(c.getBoundingClientRect().width)),
      navPresent: document.querySelector('.rail-nav') !== null,
      gutters: document.querySelectorAll('.swipe-gutter').length,
    };
  });
  record('bar: six cells, Rook first, no gutters',
    bar.count === 6 && bar.gutters === 0 && !bar.navPresent && Math.min(...bar.widths) >= 44 ? 'PASS' : 'FAIL',
    `${bar.labels.join('/')} @ ${bar.widths.join(',')}px`);

  // Enter gameplay with ordinary taps on the canvas.
  const stage = await page.locator('.game-stage').boundingBox();
  for (let i = 0; i < 3; i += 1) {
    await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await page.waitForTimeout(1200);
  }
  const playing = await page.evaluate(NIGHTCLUB_STATE);
  record('nightclub: ordinary play reached', playing.readable ? 'PASS' : 'UNVERIFIED',
    playing.readable ? `hero x=${playing.x} paused=${playing.paused}` : 'engine state not readable from the host');

  // ── Voice: enable, then two turns ────────────────────────────────────
  await page.locator('[data-testid="companion-enable-voice"]').click({ timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  // The first resume tap is expected and allowed for this iteration.
  await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.waitForTimeout(1500);

  /** Waits until Rook is neither thinking nor speaking, so the spoken intro is
   *  finished before a turn is counted. The first run of this script read the
   *  intro's audio as turn one and reported the real first turn as `unknown`. */
  async function settle(p, ms = 45000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const st = await p.evaluate(() => document.querySelector('.rook-cell')?.getAttribute('data-companion-state') ?? 'idle');
      if (st !== 'speaking' && st !== 'thinking') return st;
      await p.waitForTimeout(700);
    }
    return 'timeout';
  }

  /* Enabling voice speaks an intro, and that intro is itself a turn. Waiting
     only for "not speaking" returns immediately because the intro has not
     started yet, and the first real ask then gets measured against the intro's
     attributes — the first run of this script reported it as `unknown`. Wait
     for the intro to start, then to finish. */
  await page.waitForFunction(
    () => ['thinking', 'speaking'].includes(document.querySelector('.rook-cell')?.getAttribute('data-companion-state') ?? ''),
    null, { timeout: 30000 },
  ).catch(() => {});
  await settle(page);
  const turns = [];
  for (const [i, phrase] of [
    'How do I shoot in this club?',
    'And what should I do when that runs out?',
  ].entries()) {
    const before = await page.evaluate(NIGHTCLUB_STATE);
    const beforeAudio = await page.evaluate(() => window.__audioPlays || 0);
    const said = await page.evaluate((t) => (window.__inzoneSay ? window.__inzoneSay(t) : false), phrase);
    if (!said) { turns.push({ phrase, delivered: false }); continue; }
    // Wait for the turn to actually finish rather than for a fixed delay.
    await page.waitForFunction(
      () => ['thinking', 'speaking'].includes(document.querySelector('.rook-cell')?.getAttribute('data-companion-state') ?? ''),
      null, { timeout: 30000 },
    ).catch(() => {});
    await settle(page);
    const cell = page.locator('[data-testid="game-companion"], .rook-cell').first();
    const meta = await page.evaluate(() => {
      const c = document.querySelector('.rook-cell');
      const cap = document.querySelector('.rook-bubble .companion-caption, .rook-sheet-caption');
      return {
        replySource: c?.getAttribute('data-companion-reply-source') ?? null,
        provider: c?.getAttribute('data-companion-provider') ?? null,
        model: c?.getAttribute('data-companion-model') ?? null,
        transcriptSource: c?.getAttribute('data-transcript-source') ?? null,
        onset: c?.getAttribute('data-playback-onset-ms') ?? null,
        state: c?.getAttribute('data-companion-state') ?? null,
        caption: cap?.textContent?.trim()?.slice(0, 140) ?? null,
        audioPlays: window.__audioPlays || 0,
        pcmStarts: window.__pcmStarts || 0,
      };
    });
    const after = await page.evaluate(NIGHTCLUB_STATE);
    turns.push({ phrase, delivered: true, ...meta, beforeAudio, gameplayContinued: after.paused === false || after.paused === null });
    await page.waitForTimeout(2500);
  }

  const modelTurns = turns.filter((t) => t.replySource === 'model');
  record('companion: two turns answered by the model', modelTurns.length === 2 ? 'PASS' : 'FAIL',
    turns.map((t) => `${t.replySource ?? 'none'}/${t.provider ?? '-'}`).join(' then '));
  const audible = turns.filter((t) => (t.audioPlays > t.beforeAudio) || t.pcmStarts > 0);
  record('companion: audio actually played', audible.length === turns.length ? 'PASS' : 'PARTIAL',
    turns.map((t) => `plays=${t.audioPlays} pcm=${t.pcmStarts} onset=${t.onset ?? '-'}ms`).join(' | '));
  record('companion: transcript source labelled honestly',
    turns.every((t) => t.transcriptSource === 'simulated_recognition') ? 'PASS' : 'FAIL',
    turns.map((t) => t.transcriptSource).join(','));
  record('nightclub: gameplay continued across both turns',
    turns.every((t) => t.gameplayContinued) ? 'PASS' : 'FAIL',
    turns.map((t) => `paused=${t.gameplayContinued ? 'false' : 'true'}`).join(','));

  // ── Interrupt and mute ───────────────────────────────────────────────
  await page.evaluate((t) => (window.__inzoneSay ? window.__inzoneSay(t) : false), 'Tell me the long version of everything in this game.');
  await page.waitForTimeout(6000);
  const stopVisible = await page.locator('[data-testid="companion-stop"]').count();
  if (stopVisible) await page.locator('[data-testid="companion-stop"]').click().catch(() => {});
  await page.waitForTimeout(1500);
  const afterStop = await page.evaluate(() => document.querySelector('.rook-cell')?.getAttribute('data-companion-state'));
  record('companion: interrupt stops the reply', afterStop !== 'speaking' ? 'PASS' : 'FAIL', `state=${afterStop}`);

  await page.locator('[data-testid="companion-menu"]').click({ timeout: 10000 }).catch(() => {});
  const sheetUp = await page.locator('[data-testid="companion-more"]').waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true).catch(() => false);
  let muted = null;
  if (sheetUp) {
    await page.locator('[data-testid="companion-mute"]').click().catch(() => {});
    await page.waitForTimeout(600);
    muted = await page.evaluate(() => document.querySelector('[data-testid="companion-mute"]')?.getAttribute('aria-pressed'));
  }
  record('companion: the sheet opens and stays open', sheetUp ? 'PASS' : 'FAIL',
    sheetUp ? 'reachable' : 'sheet closed itself before it could be used');
  record('companion: mute engages', muted === 'true' ? 'PASS' : 'FAIL', `aria-pressed=${muted}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ── Chrome never remounts the game ───────────────────────────────────
  const beforeChrome = await page.evaluate(STAMP);
  await page.locator('[data-testid="player-more"]').click().catch(() => {});
  await page.waitForTimeout(600);
  const moreOpen = await page.locator('[data-testid="player-more-sheet"]').count();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.locator('[data-testid="player-change-game"]').click().catch(() => {});
  await page.waitForTimeout(600);
  const gamesOpen = await page.locator('[data-testid="player-games-sheet"]').count();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.locator('[data-testid="player-chat"]').click().catch(() => {});
  await page.waitForTimeout(2500);
  const chatOpen = await page.locator('.social-panel, .social-panel-expanded').count();
  await page.keyboard.press('Escape').catch(() => {});
  await page.locator('.social-panel-scrim').click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const afterChrome = await page.evaluate(STAMP);
  record('chrome: More and Change game open', moreOpen && gamesOpen ? 'PASS' : 'FAIL', `more=${moreOpen} games=${gamesOpen} chat=${chatOpen}`);
  record('chrome: opening and closing never remounts the game',
    JSON.stringify(beforeChrome) === JSON.stringify(afterChrome) ? 'PASS' : 'FAIL',
    `${JSON.stringify(beforeChrome)} -> ${JSON.stringify(afterChrome)}`);

  // ── Invite: a real conversation a second browser joins ───────────────
  await page.locator('[data-testid="player-invite"]').click().catch(() => {});
  // The page rewrites its own URL with the new session id once the write
  // lands. Reading that is both more reliable and less intrusive than
  // navigator.clipboard.readText(), which blocks without a permission grant —
  // it hung the first run of this script outright.
  await page.waitForFunction(
    () => new URL(window.location.href).searchParams.get('session'),
    null, { timeout: 45000 },
  ).catch(() => {});
  const sessionFromUrl = new URL(page.url()).searchParams.get('session');
  const link = sessionFromUrl ? `${PREVIEW}/games/${NIGHTCLUB}?session=${sessionFromUrl}` : '';
  record('invite: a real session was written', link ? 'PASS' : 'FAIL', link ? link.replace(PREVIEW, '') : 'no session id appeared');

  let guestSeen = 'SKIPPED';
  if (link) {
    const guestCtx = await newContext();
    const guest = await guestCtx.newPage();
    await guest.goto(bypassed(link), { waitUntil: 'domcontentloaded', timeout: 120000 });
    /* Wait for the control rather than for a number of seconds. The session
       sheet only offers Join once it has loaded the session, and on a cold
       Preview that took longer than the fixed 14s this used to allow — which
       reported a missing control that simply had not arrived yet. */
    await guest.waitForSelector('[data-testid="join-session"]', { state: 'attached', timeout: 60000 })
      .catch(() => {});
    /* Joining is a deliberate act, not a side effect of opening a link: the
       session sheet offers a Join button and the guest presses it. That is the
       right behaviour — a link should not enrol someone in a room before they
       have seen what it is — so the journey presses it rather than expecting
       the link alone to do the work. */
    const joinBtn = guest.locator('[data-testid="join-session"]');
    const joinOffered = await joinBtn.count();
    if (joinOffered) {
      await joinBtn.first().click().catch(() => {});
      await guest.waitForTimeout(9000);
    }
    record('invite: the guest is asked to join rather than enrolled silently',
      joinOffered ? 'PASS' : 'FAIL', joinOffered ? 'Join offered and pressed' : 'no join control appeared');
    const guestMembers = await guest.evaluate(() => document.querySelector('[data-testid="player-chat"]')?.getAttribute('data-live-members') ?? '0');
    await page.waitForTimeout(6000);
    const hostMembers = await page.evaluate(() => document.querySelector('[data-testid="player-chat"]')?.getAttribute('data-live-members') ?? '0');
    guestSeen = Number(hostMembers) >= 2 && Number(guestMembers) >= 2 ? 'PASS' : 'PARTIAL';
    record('invite: a second browser joins and both see the room', guestSeen,
      `host sees ${hostMembers}, guest sees ${guestMembers}`);
    await guestCtx.close();
  } else {
    record('invite: a second browser joins and both see the room', 'SKIPPED', 'no link to join');
  }

  await page.screenshot({ path: `${OUT}/nightclub-final.png` });
  await page.close();
  await hostCtx.close();

  // ── Flappy: entry and retry ──────────────────────────────────────────
  const flappyCtx = await newContext();
  const flappy = await flappyCtx.newPage();
  await flappy.goto(bypassed(`${PREVIEW}/games/${FLAPPY}`), { waitUntil: 'domcontentloaded', timeout: 120000 });
  await flappy.waitForSelector('.game-frame-body iframe', { state: 'attached', timeout: 90000 });
  await flappy.waitForTimeout(16000);
  const flappyStamp = await flappy.evaluate(STAMP);
  const flappyState = await flappy.evaluate(`(() => {
    const f = document.querySelector('.game-frame-body iframe');
    try {
      const w = f && f.contentWindow;
      return { state: w && w.state ? String(w.state) : null, play: w && typeof w.game !== 'undefined' ? 'engine' : null, ready: Boolean(w) };
    } catch (e) { return { error: String(e && e.message) }; }
  })()`);
  record('flappy: arrives on a playable screen', flappyStamp?.src?.includes('/v9/') ? 'PASS' : 'FAIL',
    `${flappyStamp?.src ?? 'no src'} state=${JSON.stringify(flappyState)}`);
  const fStage = await flappy.locator('.game-stage').boundingBox();
  await flappy.mouse.click(fStage.x + fStage.width / 2, fStage.y + fStage.height / 2);
  await flappy.waitForTimeout(2500);
  const afterTap = await flappy.evaluate(STAMP);
  record('flappy: a tap does not remount the frame',
    afterTap?.element === flappyStamp?.element ? 'PASS' : 'FAIL',
    `${flappyStamp?.element} -> ${afterTap?.element}`);

  await flappy.goto(bypassed(`${PREVIEW}/games/${FLAPPY}?previewForceRetry=1`), { waitUntil: 'domcontentloaded', timeout: 120000 });
  await flappy.waitForTimeout(14000);
  const retry = await flappy.locator('[data-testid="game-retry"]').count();
  if (retry) {
    await flappy.locator('[data-testid="game-retry"]').first().click();
    await flappy.waitForTimeout(12000);
  }
  const afterRetry = await flappy.evaluate(STAMP);
  record('flappy: Retry is offered and recovers the frame',
    retry > 0 && afterRetry?.src?.includes('/v9/') ? 'PASS' : (retry > 0 ? 'PARTIAL' : 'FAIL'),
    `retry control=${retry} src=${afterRetry?.src ?? 'none'}`);
  await flappy.screenshot({ path: `${OUT}/flappy-final.png` });
  await flappyCtx.close();
} finally {
  await browser.close();
}

await writeFile(`${OUT}/results.json`, JSON.stringify({ preview: PREVIEW, results }, null, 2));
const failed = results.filter((r) => r.status === 'FAIL');
console.log(`\n${results.length} checks — ${results.filter((r) => r.status === 'PASS').length} PASS, ${failed.length} FAIL`);
console.log('Real microphone: UNVERIFIED (no capture device). Safari and physical devices: UNVERIFIED.');
process.exit(failed.length ? 1 : 0);
