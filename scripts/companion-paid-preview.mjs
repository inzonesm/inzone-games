#!/usr/bin/env node
/**
 * Hosted Preview proof for paid companion turns.
 * Injected transcripts are labeled INJECTED — not microphone evidence.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PREVIEW = process.env.PREVIEW_URL;
const SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const SHA = process.env.PREVIEW_SHA || '';
if (!PREVIEW || !SECRET) throw new Error('PREVIEW_URL and VERCEL_AUTOMATION_BYPASS_SECRET required');

const HOST = new URL(PREVIEW).host;
const CHROMIUM = process.env.CHROMIUM || '/usr/bin/google-chrome';
const OUT = process.env.VERIFY_OUT || '/opt/cursor/artifacts/walkthrough';
mkdirSync(OUT, { recursive: true });

const notes = [];
const rec = (name, status, detail) => {
  notes.push({ name, status, detail });
  console.log(`${status.padEnd(12)} ${name} — ${detail}`);
};

function peakWav(path) {
  try {
    const buf = readFileSync(path);
    if (buf.length < 44) return { peak: 0, rms: 0, bytes: buf.length, firstAudibleSample: -1 };
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
    return { peak, rms: n ? Math.sqrt(sum / n) : 0, bytes: buf.length, firstAudibleSample: first };
  } catch (err) {
    return { peak: 0, rms: 0, bytes: 0, firstAudibleSample: -1, error: String(err) };
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

function mpegKind(bytes) {
  if (!bytes || bytes.length < 4) return 'too_small';
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'id3_mp3';
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'mpeg_frame';
  return `unknown_${bytes[0].toString(16)}_${bytes[1].toString(16)}`;
}

async function openCtx(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    permissions: ['microphone'],
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
      injectStt: false,
      nextTranscript: '',
    };
    const origSpeak = window.speechSynthesis?.speak?.bind(window.speechSynthesis);
    if (origSpeak) {
      window.speechSynthesis.speak = (utt) => {
        const prev = utt.onstart;
        utt.onstart = (ev) => {
          w.__companionProbe.utteranceStartedAt = Date.now();
          if (typeof prev === 'function') prev.call(utt, ev);
        };
        w.__companionProbe.speakCalls.push({ text: utt?.text || '', at: Date.now() });
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
        const text = w.__companionProbe.nextTranscript || 'how do I play this';
        setTimeout(() => {
          if (this.aborted) return;
          w.__companionProbe.recResults.push(text);
          this.onresult?.({ results: [[{ transcript: text }]] });
          this.onend?.();
        }, 400);
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

async function waitSpeaking(page, companion, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await companion.getAttribute('data-companion-state');
    const onset = await companion.getAttribute('data-playback-onset-ms');
    const probe = await page.evaluate(() => window.__companionProbe);
    if (state === 'speaking' || probe.audioPlays > 0 || probe.speakCalls.length > 0 || onset) {
      return { state, onset, probe, waitedMs: Date.now() - started };
    }
    await page.waitForTimeout(200);
  }
  return {
    state: await companion.getAttribute('data-companion-state'),
    onset: await companion.getAttribute('data-playback-onset-ms'),
    probe: await page.evaluate(() => window.__companionProbe),
    waitedMs: timeoutMs,
  };
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

const desktop = await openCtx(browser);
const page = await desktop.newPage();
const captured = [];
page.on('response', async (response) => {
  const url = response.url();
  if (!url.includes('/api/companion')) return;
  try {
    const headers = response.headers();
    const ctype = headers['content-type'] || '';
    if (response.request().method() === 'GET' && !url.includes('/audio')) {
      captured.push({ kind: 'health', status: response.status(), body: await response.text() });
    } else if (ctype.includes('ndjson') || ctype.includes('json')) {
      captured.push({
        kind: 'turn',
        status: response.status(),
        body: (await response.text()).slice(0, 4000),
      });
    } else if (url.includes('/audio')) {
      const buf = Buffer.from(await response.body());
      captured.push({
        kind: 'audio',
        status: response.status(),
        bytes: buf.length,
        mpeg: mpegKind(buf),
        contentType: ctype,
      });
    }
  } catch {
    /* ignore */
  }
});

const healthRes = await page.goto(`${PREVIEW}/api/companion`, {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
});
const health = await healthRes.json();
const secretShaped = Object.entries(health).filter(
  ([, value]) => typeof value === 'string' && /sk-|xi-|BEGIN |AIza|eyJ/.test(value),
);
rec(
  'companion-health',
  health?.ok && secretShaped.length === 0 ? 'PASS' : 'FAIL',
  `speech=${health.speechProvider} model=${health.modelProvider} paidChat=${health.paidChatConfigured} paidSpeech=${health.paidSpeechConfigured} paidQuotaReady=${health.paidQuotaReady} quotaUnavailable=${health.quotaUnavailable} requiredSetting=${health.requiredSetting} backend=${health.quotaBackend}`,
);

await page.goto(`${PREVIEW}/games/kart-bros`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(8000);
const iframe = page.locator('.game-frame-body iframe');
const companion = page.locator('[data-testid=game-companion]');
const iframeSrcBefore = (await iframe.count()) ? await iframe.getAttribute('src') : null;
rec(
  'kart-mount',
  (await iframe.count()) && (await companion.count()) ? 'PASS' : 'FAIL',
  `iframe=${iframeSrcBefore} companion=${await companion.count()}`,
);

const q1 = 'What is the Kart Bros room code problem?';
const q2 = 'What should I do about that then?';

async function askInjected(text, wavName) {
  await page.evaluate((next) => {
    window.__companionProbe.injectStt = true;
    window.__companionProbe.nextTranscript = next;
    window.__companionProbe.audioPlays = 0;
    window.__companionProbe.speakCalls = [];
    window.__companionProbe.utteranceStartedAt = null;
  }, text);
  const clickAt = Date.now();
  const pulse = startPulseRec(`${OUT}/${wavName}`);
  await page.locator('[data-testid=companion-ptt]').dispatchEvent('pointerdown');
  await page.waitForTimeout(500);
  await page.locator('[data-testid=companion-ptt]').dispatchEvent('pointerup');
  const speaking = await waitSpeaking(page, companion);
  await page.waitForTimeout(2800);
  await pulse.stop();
  const wav = peakWav(`${OUT}/${wavName}`);
  const caption = ((await page.locator('.companion-caption').textContent().catch(() => '')) || '').trim();
  const attrs = {
    state: await companion.getAttribute('data-companion-state'),
    provider: await companion.getAttribute('data-companion-provider'),
    model: await companion.getAttribute('data-companion-model'),
    replySource: await companion.getAttribute('data-companion-reply-source'),
    quota: await companion.getAttribute('data-companion-quota'),
    fallback: await companion.getAttribute('data-companion-fallback'),
    speechFallback: await companion.getAttribute('data-companion-speech-fallback'),
    speechErrorCode: await companion.getAttribute('data-companion-speech-error-code'),
    speechErrorHttp: await companion.getAttribute('data-companion-speech-error-http'),
    ttsCharge: await companion.getAttribute('data-companion-tts-charge'),
    onset: await companion.getAttribute('data-playback-onset-ms'),
    speakingState: await companion.getAttribute('data-speaking-state-ms'),
  };
  return { clickAt, speaking, wav, caption, attrs, probe: speaking.probe };
}

const turn1 = await askInjected(q1, 'companion_paid_q1.wav');
rec(
  'turn1-injected',
  turn1.caption ? 'INJECTED' : 'FAIL',
  `transcript=${JSON.stringify(q1)} caption=${JSON.stringify(turn1.caption.slice(0, 180))} source=${turn1.attrs.replySource} speech=${turn1.attrs.provider} model=${turn1.attrs.model} fallback=${turn1.attrs.fallback} speechFallback=${turn1.attrs.speechFallback} speechError=${turn1.attrs.speechErrorCode}/${turn1.attrs.speechErrorHttp} ttsCharge=${turn1.attrs.ttsCharge} quota=${turn1.attrs.quota} onset=${turn1.attrs.onset} audioPlays=${turn1.probe.audioPlays} speakCalls=${turn1.probe.speakCalls.length} peak=${turn1.wav.peak}`,
);

const turn2 = await askInjected(q2, 'companion_paid_q2.wav');
const contextual =
  /code|lobby|invalid|that|same|join/i.test(turn2.caption) && turn2.caption !== turn1.caption;
rec(
  'turn2-context-injected',
  contextual ? 'INJECTED' : turn2.caption ? 'UNVERIFIED' : 'FAIL',
  `transcript=${JSON.stringify(q2)} caption=${JSON.stringify(turn2.caption.slice(0, 180))} source=${turn2.attrs.replySource} speech=${turn2.attrs.provider} fallback=${turn2.attrs.fallback} onset=${turn2.attrs.onset} peak=${turn2.wav.peak}`,
);

const paidModel = turn1.attrs.replySource === 'model' || turn2.attrs.replySource === 'model';
const paidSpeech = turn1.attrs.provider === 'elevenlabs' || turn2.attrs.provider === 'elevenlabs';
const audioCapture = captured.filter((row) => row.kind === 'audio');
const mpegOk = audioCapture.some((row) => row.mpeg === 'id3_mp3' || row.mpeg === 'mpeg_frame');
rec(
  'openai-then-elevenlabs',
  paidModel && paidSpeech && mpegOk ? 'PASS' : 'FALLBACK_OR_FAIL',
  `modelTurns=${paidModel} elevenlabs=${paidSpeech} mpeg=${JSON.stringify(audioCapture)} quotaUnavailable=${health.quotaUnavailable} requiredSetting=${health.requiredSetting}`,
);

const firstMs =
  turn1.wav.firstAudibleSample >= 0 ? Math.round((turn1.wav.firstAudibleSample / 16000) * 1000) : null;
rec(
  'audible-pulse',
  turn1.wav.peak > 800 || turn2.wav.peak > 800 ? 'PASS' : 'FAIL',
  `q1Peak=${turn1.wav.peak} q2Peak=${turn2.wav.peak} firstMs=${firstMs} onsetAttr=${turn1.attrs.onset}`,
);

await page.screenshot({ path: `${OUT}/companion_paid_speaking.png` });

const iframeStill = (await iframe.count()) ? await iframe.getAttribute('src') : null;
rec(
  'iframe-continuity',
  iframeStill && iframeStill === iframeSrcBefore ? 'PASS' : 'FAIL',
  `src=${iframeStill}`,
);

await page.locator('[data-testid=companion-mute]').click();
const muted = await page.locator('[data-testid=companion-mute]').getAttribute('aria-pressed');
rec('mute', muted === 'true' ? 'PASS' : 'FAIL', `aria-pressed=${muted}`);
await page.locator('[data-testid=companion-mute]').click();

await page.locator('[data-testid=companion-ptt]').click();
await page.waitForTimeout(800);
await page.locator('[data-testid=companion-stop]').click();
const afterStop = await companion.getAttribute('data-companion-state');
rec('interrupt-stop', afterStop === 'idle' ? 'PASS' : 'FAIL', `state=${afterStop}`);

await page.evaluate(() => {
  window.__companionProbe.injectStt = false;
});
await page.locator('[data-testid=companion-ptt]').dispatchEvent('pointerdown');
await page.waitForTimeout(250);
const listening = await companion.getAttribute('data-companion-state');
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'hidden',
  });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(400);
const afterHide = await page.evaluate(() => window.__companionProbe);
const hideState = await companion.getAttribute('data-companion-state');
rec(
  'background-mic-abort',
  afterHide.recAborts > 0 && hideState === 'idle' ? 'PASS' : 'FAIL',
  `state=${hideState} aborts=${afterHide.recAborts} listeningWas=${listening}`,
);

writeFileSync(
  `${OUT}/companion_paid_preview.json`,
  JSON.stringify(
    {
      sha: SHA,
      preview: PREVIEW,
      health,
      turn1,
      turn2,
      audioCapture,
      notes,
      evidence: {
        transcripts: 'INJECTED — not a physical microphone',
        paidModel,
        paidSpeech,
        mpegOk,
      },
    },
    null,
    2,
  ),
);

await browser.close();
const fatal = notes.some((n) => n.status === 'FAIL');
console.log(JSON.stringify({ sha: SHA, host: HOST, health, paidModel, paidSpeech, mpegOk, notes }, null, 2));
process.exit(fatal ? 1 : 0);
