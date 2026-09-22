#!/usr/bin/env node
/**
 * Hosted preview verification: provider, captions, audible onset, mute/stop,
 * interruption, background mic abort, game-switch cancel, five-title open.
 * Captions alone are not treated as a pass for speech.
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PREVIEW = process.env.PREVIEW_URL;
const SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const SHA = process.env.PREVIEW_SHA || '';
if (!PREVIEW || !SECRET) throw new Error('PREVIEW_URL and VERCEL_AUTOMATION_BYPASS_SECRET required');

const HOST = new URL(PREVIEW).host;
const CHROMIUM = process.env.CHROMIUM || '/usr/bin/google-chrome';
const OUT = process.env.VERIFY_OUT || '/opt/cursor/artifacts/walkthrough';
mkdirSync(OUT, { recursive: true });

const GAMES = [
  'kart-bros',
  'clelytraflight',
  'karate-bros',
  'clescaperoad',
  'nightclub-showdown-inzone-production',
];

const notes = [];
const rec = (name, status, detail) => {
  notes.push({ name, status, detail });
  console.log(`${status.padEnd(12)} ${name} — ${detail}`);
};

function peakWav(path) {
  try {
    const buf = readFileSync(path);
    if (buf.length < 44) return { peak: 0, rms: 0, bytes: buf.length };
    const data = buf.subarray(44);
    let peak = 0;
    let sum = 0;
    let n = 0;
    let first = -1;
    for (let i = 0; i + 1 < data.length; i += 2) {
      const s = data.readInt16LE(i);
      const a = Math.abs(s);
      if (a > peak) peak = a;
      sum += s * s;
      n += 1;
      if (first < 0 && a > 800) first = i / 2;
    }
    return {
      peak,
      rms: n ? Math.sqrt(sum / n) : 0,
      bytes: buf.length,
      firstAudibleSample: first,
    };
  } catch (err) {
    return { peak: 0, rms: 0, bytes: 0, error: String(err) };
  }
}

function startPulseRec(file) {
  const proc = spawn(
    'ffmpeg',
    ['-y', '-f', 'pulse', '-i', 'auto_null.monitor', '-ac', '1', '-ar', '16000', file],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );
  return {
    stop: () =>
      new Promise((resolve) => {
        const done = () => resolve();
        proc.once('close', done);
        proc.kill('SIGINT');
        setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            /* gone */
          }
        }, 2500);
      }),
  };
}

async function openCtx(browser, viewport, extras = {}) {
  const context = await browser.newContext({
    viewport,
    locale: 'en-US',
    permissions: ['microphone'],
    ...extras,
  });
  await context.route('**', async (route, request) => {
    const url = new URL(request.url());
    if (url.host === HOST) {
      await route.continue({
        headers: {
          ...request.headers(),
          'x-vercel-protection-bypass': SECRET,
          'x-vercel-set-bypass-cookie': 'samesitenone',
        },
      });
      return;
    }
    await route.continue();
  });
  await context.addInitScript(() => {
    const w = window;
    w.__companionProbe = {
      speakCalls: [],
      utteranceStartedAt: null,
      recStarts: 0,
      recAborts: 0,
      recStops: 0,
      recResults: [],
      audioPlays: 0,
      injectStt: true,
    };
    const origSpeak = window.speechSynthesis?.speak?.bind(window.speechSynthesis);
    if (origSpeak) {
      window.speechSynthesis.speak = (utt) => {
        const prev = utt.onstart;
        utt.onstart = (ev) => {
          w.__companionProbe.utteranceStartedAt = Date.now();
          if (typeof prev === 'function') prev.call(utt, ev);
        };
        w.__companionProbe.speakCalls.push({
          text: utt?.text || '',
          rate: utt?.rate,
          pitch: utt?.pitch,
          at: Date.now(),
        });
        return origSpeak(utt);
      };
    }
    const Fake = function FakeRecognition() {
      this.lang = 'en-US';
      this.aborted = false;
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      this.start = () => {
        w.__companionProbe.recStarts += 1;
        this.aborted = false;
        if (!w.__companionProbe.injectStt) return;
        setTimeout(() => {
          if (this.aborted) return;
          w.__companionProbe.recResults.push('how do I play this');
          this.onresult?.({ results: [[{ transcript: 'how do I play this' }]] });
          this.onend?.();
        }, 650);
      };
      this.stop = () => {
        w.__companionProbe.recStops += 1;
      };
      this.abort = () => {
        this.aborted = true;
        w.__companionProbe.recAborts += 1;
      };
    };
    w.SpeechRecognition = Fake;
    w.webkitSpeechRecognition = Fake;
    const desc = Object.getOwnPropertyDescriptor(HTMLAudioElement.prototype, 'play');
    if (desc?.value) {
      HTMLAudioElement.prototype.play = function play() {
        w.__companionProbe.audioPlays += 1;
        return desc.value.apply(this, arguments);
      };
    }
  });
  return context;
}

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  headless: false,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--window-size=1280,800',
  ],
});

const desktop = await openCtx(browser, { width: 1280, height: 800 });
const page = await desktop.newPage();

const healthRes = await page.goto(`${PREVIEW}/api/companion`, { waitUntil: 'domcontentloaded', timeout: 30000 });
const health = await healthRes.json();
rec(
  'companion-health',
  health?.ok ? 'PASS' : 'FAIL',
  `provider=${health.provider} voice=${health.voiceId} model=${health.modelId} override=${health.voiceProviderOverride}`,
);

await page.goto(`${PREVIEW}/games/kart-bros`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(8000);
const iframe = page.locator('.game-frame-body iframe');
const companion = page.locator('[data-testid=game-companion]');
const iframeSrcBefore = (await iframe.count()) ? await iframe.getAttribute('src') : null;
rec(
  'kart-mount',
  (await iframe.count()) && (await companion.count()) ? 'PASS' : 'FAIL',
  `iframe=${iframeSrcBefore} companion=${await companion.count()} provider=${await companion.getAttribute('data-companion-provider')}`,
);

const baselineRec = startPulseRec(`${OUT}/companion_game_baseline.wav`);
await page.waitForTimeout(2000);
await baselineRec.stop();
const baseline = peakWav(`${OUT}/companion_game_baseline.wav`);

await page.evaluate(() => {
  window.__companionProbe.injectStt = true;
});
const clickAt = Date.now();
const pulseIntro = startPulseRec(`${OUT}/companion_intro_pulse.wav`);
await page.locator('[data-testid=companion-ptt]').click();
await page.waitForTimeout(200);
await page.locator('[data-testid=companion-ptt]').dispatchEvent('pointerdown');
await page.waitForTimeout(800);
await page.locator('[data-testid=companion-ptt]').dispatchEvent('pointerup');

let speakingAt = null;
for (let i = 0; i < 50; i += 1) {
  const state = await companion.getAttribute('data-companion-state');
  const started = await page.evaluate(() => window.__companionProbe.utteranceStartedAt);
  if (started && !speakingAt) speakingAt = started;
  if (state === 'speaking' && !speakingAt) speakingAt = Date.now();
  if (state === 'speaking' || started) break;
  await page.waitForTimeout(200);
}
await page.waitForTimeout(2500);
await pulseIntro.stop();
const pulse = peakWav(`${OUT}/companion_intro_pulse.wav`);

const caption = ((await page.locator('.companion-caption').textContent().catch(() => '')) || '').trim();
const state = await companion.getAttribute('data-companion-state');
const provider = await companion.getAttribute('data-companion-provider');
const cached = await companion.getAttribute('data-companion-cached');
const attrLatency = await companion.getAttribute('data-speech-latency-ms');
const probe = await page.evaluate(() => window.__companionProbe);
const voices = await page.evaluate(() => (window.speechSynthesis ? window.speechSynthesis.getVoices().map((v) => v.name) : []));
const latencyMs = speakingAt ? speakingAt - clickAt : Number(attrLatency || 0) || null;

rec(
  'intro-or-ask-speech',
  speakingAt || probe.speakCalls.length || probe.audioPlays ? 'PASS' : caption ? 'CAPTION_ONLY' : 'FAIL',
  `state=${state} provider=${provider} cached=${cached} caption=${JSON.stringify(caption.slice(0, 140))} speakCalls=${probe.speakCalls.length} audioPlays=${probe.audioPlays} latencyMs=${latencyMs} attrLatency=${attrLatency} voices=${voices.length}`,
);

if (caption && /cannot see|hold|kart|lobby|steer/i.test(caption)) {
  rec('contextual-reply', 'PASS', caption.slice(0, 180));
} else if (caption) {
  rec('contextual-reply', 'UNVERIFIED', caption.slice(0, 180));
} else {
  rec('contextual-reply', 'FAIL', 'no caption');
}

rec(
  'stt-path',
  probe.recStarts > 0 && probe.recResults.length > 0 ? 'INJECTED' : probe.recStarts > 0 ? 'STARTED' : 'FAIL',
  `starts=${probe.recStarts} results=${JSON.stringify(probe.recResults)} (injected transcript after recognizer start; not a physical mic)`,
);

await page.screenshot({ path: `${OUT}/companion_kart_speaking.png` });

const iframeStill = (await iframe.count()) ? await iframe.getAttribute('src') : null;
rec(
  'game-still-mounted-after-speech',
  iframeStill && iframeStill === iframeSrcBefore ? 'PASS' : 'FAIL',
  `src=${iframeStill}`,
);

await page.locator('[data-testid=companion-mute]').click();
const muted = await page.locator('[data-testid=companion-mute]').getAttribute('aria-pressed');
rec('mute', muted === 'true' ? 'PASS' : 'FAIL', `aria-pressed=${muted}`);
await page.locator('[data-testid=companion-mute]').click();

await page.locator('[data-testid=companion-ptt]').click();
await page.waitForTimeout(1200);
await page.locator('[data-testid=companion-stop]').click();
const afterStop = await companion.getAttribute('data-companion-state');
const captionAfterStop = await page.locator('.companion-caption').count();
rec(
  'stop-clears',
  afterStop === 'idle' && captionAfterStop === 0 ? 'PASS' : 'FAIL',
  `state=${afterStop} captions=${captionAfterStop}`,
);

await page.evaluate(() => {
  window.__companionProbe.injectStt = false;
});
await page.locator('[data-testid=companion-ptt]').dispatchEvent('pointerdown');
await page.waitForTimeout(250);
const listening = await companion.getAttribute('data-companion-state');
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(400);
const afterHide = await page.evaluate(() => window.__companionProbe);
const hideState = await companion.getAttribute('data-companion-state');
rec(
  'background-mic-abort',
  afterHide.recAborts > 0 && hideState === 'idle' ? 'PASS' : 'FAIL',
  `state=${hideState} aborts=${afterHide.recAborts} starts=${afterHide.recStarts} listeningWas=${listening}`,
);
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

await page.goto(`${PREVIEW}/games/clelytraflight`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(7000);
const switched = page.locator('[data-testid=game-companion]');
const switchState = await switched.getAttribute('data-companion-state');
const switchGame = await switched.getAttribute('data-game');
const switchIframe = await page.locator('.game-frame-body iframe').count();
rec(
  'game-switch-cancel',
  switchState === 'idle' && switchGame === 'clelytraflight' && switchIframe ? 'PASS' : 'FAIL',
  `state=${switchState} game=${switchGame} iframe=${switchIframe}`,
);

for (const id of GAMES) {
  await page.goto(`${PREVIEW}/games/${id}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(6500);
  const src = (await page.locator('.game-frame-body iframe').count())
    ? await page.locator('.game-frame-body iframe').getAttribute('src')
    : null;
  const dock = await page.locator('[data-testid=game-companion]').count();
  rec(`open:${id}`, src && dock ? 'PASS' : 'FAIL', `src=${src} companion=${dock}`);
}

const firstMs = pulse.firstAudibleSample >= 0 ? Math.round((pulse.firstAudibleSample / 16000) * 1000) : null;
const louderThanGame = pulse.peak > Math.max(800, baseline.peak * 1.15);
const audible = pulse.peak > 800 && (speakingAt || probe.speakCalls.length > 0);
rec(
  'audible-pulse',
  audible ? 'PASS' : 'FAIL',
  `peak=${pulse.peak} rms=${Number(pulse.rms).toFixed(1)} bytes=${pulse.bytes} firstMs=${firstMs} baselinePeak=${baseline.peak} louderThanGame=${louderThanGame}`,
);

writeFileSync(
  `${OUT}/companion_audible_verify.json`,
  JSON.stringify(
    {
      sha: SHA,
      preview: PREVIEW,
      health,
      latencyMs,
      caption,
      provider,
      cached,
      voices,
      probe,
      pulse,
      notes,
    },
    null,
    2,
  ),
);

await browser.close();
console.log(JSON.stringify({ sha: SHA, host: HOST, provider: health.provider, latencyMs, audible, notes }, null, 2));
process.exit(notes.some((n) => n.status === 'FAIL') ? 1 : 0);
