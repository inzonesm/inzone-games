#!/usr/bin/env node
/**
 * Real microphone / SpeechRecognition proof. Does not inject a transcript.
 * A pass requires Chrome to return a non-empty recognition result.
 */
import { chromium } from 'playwright-core';

const PREVIEW = process.env.PREVIEW_URL;
const SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const CAPTURE = process.env.FAKE_MIC_WAV || '';
if (!PREVIEW || !SECRET) throw new Error('PREVIEW_URL and VERCEL_AUTOMATION_BYPASS_SECRET required');

const args = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--use-fake-ui-for-media-stream',
];
if (CAPTURE) {
  args.push('--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${CAPTURE}`);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/google-chrome',
  headless: false,
  args,
});
const context = await browser.newContext({
  viewport: { width: 800, height: 600 },
  permissions: ['microphone'],
});
const host = new URL(PREVIEW).host;
await context.route('**', async (route, request) => {
  const url = new URL(request.url());
  if (url.host === host) {
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
const page = await context.newPage();
await page.goto(`${PREVIEW}/games/kart-bros`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(3000);
const result = await page.evaluate(() => new Promise((resolve) => {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) return resolve({ available: false, error: 'no_speech_recognition', transcript: '' });
  const rec = new Ctor();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  const out = { available: true, error: null, transcript: '', results: [] };
  rec.onresult = (event) => {
    const text = event.results?.[0]?.[0]?.transcript?.trim() || '';
    out.results.push(text);
    if (text) out.transcript = text;
  };
  rec.onerror = (event) => {
    out.error = event.error || 'recognition_error';
    resolve(out);
  };
  rec.onend = () => resolve(out);
  setTimeout(() => resolve(out), 8000);
  try {
    rec.start();
  } catch (err) {
    out.error = String(err);
    resolve(out);
  }
}));
await browser.close();
const pass = Boolean(result.available && result.transcript);
console.log(JSON.stringify({ injected: false, pass, ...result }, null, 2));
process.exit(pass ? 0 : 3);
