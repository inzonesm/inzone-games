/**
 * Where the wait actually goes, stage by stage.
 *
 * "Voice feels slow" is one number hiding five. This reports each leg so the
 * fix has an address:
 *
 *   speech end -> final transcript    the recogniser settling
 *   -> model first output             the first token back from the model
 *   -> text available                 the reply finished, caption paintable
 *   -> first playable audio           audio bytes we could start on
 *   -> audible playback               something actually came out of the speaker
 *
 * Cold and warm turns are reported separately because they are different
 * questions: the first turn pays for a connection, a quota reservation and an
 * unwarmed cache, and averaging it with the rest hides both.
 *
 * It also reports which provider spoke and whether playback was incremental or
 * buffered. That distinction is the whole ballgame for onset: incremental PCM
 * starts on the first chunk, a buffered blob waits for the last one.
 *
 * Transcripts are delivered through a SpeechRecognition stand-in that marks
 * itself simulated, so the "speech end" leg here is a floor, not a
 * measurement of a real recogniser. Labelled as such in the output.
 *
 * Usage: PREVIEW=https://… BYPASS=… [TURNS=4] node scripts/companion-latency.mjs
 */
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';

const PREVIEW = (process.env.PREVIEW || '').replace(/\/$/, '');
const BYPASS = process.env.BYPASS || process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
const TURNS = Number(process.env.TURNS || 4);
const OUT = process.env.OUT || '.latency';
const CHROMIUM = process.env.CHROMIUM_EXECUTABLE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const GAME = process.env.GAME || 'nightclub-showdown-inzone-production';
if (!PREVIEW) throw new Error('PREVIEW is required');

const ASKS = [
  'How do I shoot in this club?',
  'What should I do when the ammo runs out?',
  'Is there any cover I can use?',
  'What happens when a wave ends?',
  'Remind me how to move.',
  'Say that again more briefly.',
];

const FAKE_STT = `
  window.__INZONE_SIMULATED_RECOGNITION = true;
  function F(){ const s=this; this.onresult=null; this.onerror=null; this.onend=null;
    this.start=function(){ window.__inzoneSay=function(t){ if(!s.onresult) return false; window.__sayAt = performance.now(); s.onresult({results:[[{transcript:t}]]}); return true; }; };
    this.stop=function(){ if(s.onend) s.onend(); }; this.abort=function(){}; }
  F.__inzoneSimulated = true; window.SpeechRecognition = F; window.webkitSpeechRecognition = F;
`;

const READ = `(() => {
  const c = document.querySelector('.rook-cell');
  if (!c) return null;
  const n = (a) => { const v = c.getAttribute(a); return v === null || v === '' ? null : Number(v); };
  return {
    state: c.getAttribute('data-companion-state'),
    replySource: c.getAttribute('data-companion-reply-source'),
    speechProvider: c.getAttribute('data-companion-provider'),
    modelProvider: c.getAttribute('data-companion-model'),
    playbackMode: c.getAttribute('data-playback-mode'),
    speechFallback: c.getAttribute('data-companion-speech-fallback'),
    cached: c.getAttribute('data-companion-cached'),
    transcriptSource: c.getAttribute('data-transcript-source'),
    modelFirstMs: n('data-latency-model-first-ms'),
    textMs: n('data-latency-text-ms'),
    audioMs: n('data-latency-audio-ms'),
    onsetMs: n('data-playback-onset-ms'),
    speakingStateMs: n('data-speaking-state-ms'),
  };
})()`;

function bypassed(url) {
  if (!BYPASS) return url;
  const u = new URL(url);
  u.searchParams.set('x-vercel-protection-bypass', BYPASS);
  u.searchParams.set('x-vercel-set-bypass-cookie', 'true');
  return u.toString();
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: CHROMIUM,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});
const turns = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(FAKE_STT);
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__audioPlays = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...a) { window.__audioPlays += 1; window.__lastPlayAt = performance.now(); return play.apply(this, a); };
  });
  await page.goto(bypassed(`${PREVIEW}/games/${GAME}`), { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.game-frame-body iframe', { timeout: 60000 });
  await page.waitForTimeout(12000);
  const stage = await page.locator('.game-stage').boundingBox();
  await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.waitForTimeout(1200);

  const settle = async (ms = 60000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const st = await page.evaluate(() => document.querySelector('.rook-cell')?.getAttribute('data-companion-state') ?? 'idle');
      if (st !== 'speaking' && st !== 'thinking') return st;
      await page.waitForTimeout(500);
    }
    return 'timeout';
  };

  await page.locator('[data-testid="companion-enable-voice"]').click({ timeout: 20000 }).catch(() => {});
  // The intro is itself a turn; let it finish before the first measured ask.
  await page.waitForFunction(
    () => ['thinking', 'speaking'].includes(document.querySelector('.rook-cell')?.getAttribute('data-companion-state') ?? ''),
    null, { timeout: 30000 },
  ).catch(() => {});
  await settle();

  for (let i = 0; i < TURNS; i += 1) {
    const phrase = ASKS[i % ASKS.length];
    const beforePlays = await page.evaluate(() => window.__audioPlays || 0);
    const said = await page.evaluate((t) => (window.__inzoneSay ? window.__inzoneSay(t) : false), phrase);
    if (!said) { turns.push({ turn: i + 1, phrase, delivered: false }); continue; }
    await page.waitForFunction(
      () => ['thinking', 'speaking'].includes(document.querySelector('.rook-cell')?.getAttribute('data-companion-state') ?? ''),
      null, { timeout: 30000 },
    ).catch(() => {});
    await settle();
    const m = await page.evaluate(READ);
    const plays = await page.evaluate(() => window.__audioPlays || 0);
    const audibleMs = await page.evaluate(() => (window.__lastPlayAt && window.__sayAt ? Math.round(window.__lastPlayAt - window.__sayAt) : null));
    turns.push({ turn: i + 1, phrase, delivered: true, audioPlayed: plays > beforePlays, audibleMs, ...m });
    await page.waitForTimeout(1500);
  }
  await ctx.close();
} finally {
  await browser.close();
}

const done = turns.filter((t) => t.delivered);
const cold = done[0];
const warm = done.slice(1);
const avg = (list, key) => {
  const vals = list.map((t) => t[key]).filter((v) => typeof v === 'number');
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
};
const line = (label, t) => `${label.padEnd(10)} model ${String(t.modelFirstMs ?? '-').padStart(5)}ms | text ${String(t.textMs ?? '-').padStart(5)}ms | audio ${String(t.audioMs ?? '-').padStart(5)}ms | audible ${String(t.audibleMs ?? t.onsetMs ?? '-').padStart(5)}ms`;

console.log('\nTranscript delivery: simulated_recognition — the speech-end leg is a floor, not a recogniser measurement.\n');
if (cold) console.log(line('cold', cold));
for (const [i, t] of warm.entries()) console.log(line(`warm ${i + 1}`, t));
if (warm.length) {
  console.log(line('warm avg', {
    modelFirstMs: avg(warm, 'modelFirstMs'), textMs: avg(warm, 'textMs'),
    audioMs: avg(warm, 'audioMs'), audibleMs: avg(warm, 'audibleMs'),
  }));
}
const any = done[done.length - 1];
if (any) {
  console.log(`\nproviders: model=${any.modelProvider} speech=${any.speechProvider} playback=${any.playbackMode} fallback=${any.speechFallback || 'none'} cached=${any.cached}`);
  console.log(`reply source: ${any.replySource} | transcript: ${any.transcriptSource}`);
}
await writeFile(`${OUT}/latency.json`, JSON.stringify({ preview: PREVIEW, game: GAME, turns }, null, 2));
