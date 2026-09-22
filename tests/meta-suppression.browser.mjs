/**
 * Does the QA marker actually suppress Meta, or only tag the payload?
 *
 * The unit tests in tests/qa-traffic-dispatch.test.mjs cover the dispatcher:
 * a marked or non-production visit produces zero `trackCustom` calls. That is
 * necessary and not sufficient. Meta's base script sends a `PageView` the
 * moment it initialises, entirely independently of our dispatcher, so a build
 * that gated only the custom events would still teach the dataset that every
 * Preview check is a visitor.
 *
 * So this runs the real component in a real Next app and watches the network.
 * The question is not "did we call fbq" but "was Meta contacted at all".
 *
 * Nothing leaves this machine: every request to Meta is aborted at the browser
 * and only recorded. The positive control reaches the *attempt*, never the
 * script. Hostnames are faked with Chromium's host-resolver rules, so the page
 * genuinely believes it is on inzone.games and `classifyHost` is exercised for
 * real rather than stubbed.
 *
 * node --test tests/meta-suppression.browser.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROMIUM = process.env.CHROMIUM_EXECUTABLE
  || process.env.CHROMIUM
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const port = Number(process.env.TEST_PORT || 3211);

/** Hosts Meta's pixel is served from. Any hit on one of these is a contact. */
const META_HOSTS = /connect\.facebook\.net|facebook\.com\/tr/;

let temp;
let server;
let browser;

test.before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'inzone-meta-suppression-'));
  await mkdir(path.join(temp, 'app'), { recursive: true });
  await cp(path.join(root, 'lib'), path.join(temp, 'lib'), { recursive: true });
  await mkdir(path.join(temp, 'components'));
  await cp(path.join(root, 'components/MetaPixel.tsx'), path.join(temp, 'components/MetaPixel.tsx'));
  await writeFile(path.join(temp, 'app/layout.tsx'), `
import { MetaPixel } from '@/components/MetaPixel';
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}<MetaPixel /></body></html>);
}
`);
  await writeFile(path.join(temp, 'app/page.tsx'), `export default function Page(){ return <main data-testid="ready">pixel host</main>; }`);
  await symlink(path.join(root, 'node_modules'), path.join(temp, 'node_modules'));
  await writeFile(path.join(temp, 'package.json'), JSON.stringify({ private: true }));
  await writeFile(path.join(temp, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2022', lib: ['dom', 'esnext'], module: 'esnext', moduleResolution: 'bundler', jsx: 'preserve',
    esModuleInterop: true, skipLibCheck: true, allowImportingTsExtensions: true, noEmit: true,
    baseUrl: '.', paths: { '@/*': ['./*'] },
  } }));
  await writeFile(path.join(temp, 'next.config.js'), 'module.exports = { experimental: { externalDir: true } };');

  server = spawn(
    process.execPath,
    [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', temp, '-p', String(port), '-H', '127.0.0.1'],
    { cwd: root, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('next dev did not come up')), 120000);
    const onData = (chunk) => {
      if (String(chunk).includes('Ready') || String(chunk).includes('started server')) {
        clearTimeout(timer);
        resolve();
      }
    };
    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
  });

  browser = await chromium.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      // The page must genuinely believe it is on these hosts: classifyHost
      // reads window.location.hostname, and a stub would test the stub.
      `--host-resolver-rules=MAP inzone.games 127.0.0.1, MAP preview-check.vercel.app 127.0.0.1`,
    ],
  });
});

test.after(async () => {
  await browser?.close();
  server?.kill('SIGTERM');
  if (temp) await rm(temp, { recursive: true, force: true });
});

/** Opens the page at a hostname and reports whether Meta was contacted. */
async function visit(hostname, search = '') {
  const page = await browser.newPage();
  const contacts = [];
  // Abort rather than allow: a suppression test must never be the thing that
  // sends a fake conversion.
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (META_HOSTS.test(url)) {
      contacts.push(url);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(`http://${hostname}:${port}${search}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="ready"]');
  // Give the afterInteractive script its chance to run.
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => ({
    hostname: window.location.hostname,
    fbqDefined: typeof window.fbq === 'function',
    scriptTags: [...document.querySelectorAll('script')].filter((s) => s.src.includes('connect.facebook.net')).length,
    noscriptBeacons: [...document.querySelectorAll('noscript')].filter((n) => n.innerHTML.includes('facebook.com/tr')).length,
  }));
  await page.close();
  return { contacts, ...state };
}

test('positive control: an ordinary production visit does reach for the pixel', async () => {
  // Without this, every assertion below would pass on a broken build that
  // simply never loads the pixel anywhere.
  const r = await visit('inzone.games');
  assert.equal(r.hostname, 'inzone.games');
  assert.ok(r.scriptTags > 0, 'production must render the base script tag');
  assert.ok(r.contacts.length > 0, 'production must attempt to load fbevents.js');
});

test('a marked production visit never contacts Meta at all', async () => {
  const r = await visit('inzone.games', '/?inzone_qa=agent');
  assert.deepEqual(r.contacts, [], `marked visit contacted Meta: ${r.contacts.join(', ')}`);
  assert.equal(r.scriptTags, 0, 'no base script may be rendered on a marked visit');
  assert.equal(r.noscriptBeacons, 0, 'no noscript beacon either');
  assert.equal(r.fbqDefined, false, 'fbq must never exist on a marked visit');
});

test('a manual marker suppresses the same way an agent marker does', async () => {
  const r = await visit('inzone.games', '/?inzone_qa=manual');
  assert.deepEqual(r.contacts, []);
  assert.equal(r.scriptTags, 0);
});

test('a Preview deployment never contacts Meta, marked or not', async () => {
  // This is the one that matters for hosted verification: every check run
  // against a *.vercel.app host is silent by virtue of the host alone.
  const plain = await visit('preview-check.vercel.app');
  assert.equal(plain.hostname, 'preview-check.vercel.app');
  assert.deepEqual(plain.contacts, [], `preview contacted Meta: ${plain.contacts.join(', ')}`);
  assert.equal(plain.scriptTags, 0);
  assert.equal(plain.fbqDefined, false);
});

test('an unrecognised host is withheld rather than guessed at', async () => {
  const r = await visit('127.0.0.1');
  assert.deepEqual(r.contacts, []);
  assert.equal(r.scriptTags, 0);
});

test('a marked visit carries its attribution intact — the marker is not a utm', async () => {
  // A test of the acquisition flow has to keep the campaign it arrived on, or
  // it is not a test of the acquisition flow.
  const page = await browser.newPage();
  await page.route('**/*', (route) => (META_HOSTS.test(route.request().url()) ? route.abort() : route.continue()));
  await page.goto(`http://inzone.games:${port}/?inzone_qa=agent&utm_source=meta&utm_campaign=launch`, { waitUntil: 'networkidle' });
  const params = await page.evaluate(() => Object.fromEntries(new URLSearchParams(window.location.search)));
  await page.close();
  assert.equal(params.utm_source, 'meta');
  assert.equal(params.utm_campaign, 'launch');
  assert.equal(params.inzone_qa, 'agent');
});
