#!/usr/bin/env node
// Diagnose a Vercel preview whose runtime error is unclear.
//
// What it checks:
//   1. Reproduce the page state (console errors, page errors, failed
//      requests, Firestore requests observed).
//   2. Which `NEXT_PUBLIC_*` references appear as UNRESOLVED
//      (`process.env.NEXT_PUBLIC_FOO`) in the deployed JS chunks — i.e.
//      env vars that were absent at build time.
//   3. Compare with production (read-only) so the environment gap is
//      obvious.
//
// The script never prints secret material to disk in cleartext. It only
// reports SHAPE ("apiKey chunks: 1", "authDomain present in chunk N") and
// the LIST of unresolved env-var NAMES. No API key or App ID is ever
// echoed in stdout, stderr, or results.json.
//
// SECRETS
// -------
//   VERCEL_AUTOMATION_BYPASS_SECRET — Vercel deployment-protection bypass.
//   Applied only on the preview host; never sent to prod, firebasestorage,
//   or third-party origins.
//
// ENV
// ---
//   PREVIEW_URL      https://<...>.vercel.app         (required)
//   PROD_URL         https://www.inzone.games          (optional; enables comparison)
//   OUT_DIR          scripts/.hexclave-out/diag        (results.json + screenshots)
//   CHROMIUM         /opt/pw-browsers/chromium-1194/... (autodetected)

import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const PREVIEW = process.env.PREVIEW_URL;
const PROD = process.env.PROD_URL ?? "https://www.inzone.games";
const SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const OUT = process.env.OUT_DIR ?? "scripts/.hexclave-out/diag";
const CHROMIUM =
  process.env.CHROMIUM ??
  process.env.CHROMIUM_EXECUTABLE ??
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

if (!PREVIEW) throw new Error("PREVIEW_URL not set");
if (!SECRET) throw new Error("VERCEL_AUTOMATION_BYPASS_SECRET not set");

const HOST_PREVIEW = new URL(PREVIEW).host;

async function ctx(browser) {
  const c = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    isMobile: true,
    hasTouch: true,
    ignoreHTTPSErrors: true,
  });
  await c.route("**", async (route, req) => {
    if (new URL(req.url()).host === HOST_PREVIEW) {
      const h = {
        ...req.headers(),
        "x-vercel-protection-bypass": SECRET,
        "x-vercel-set-bypass-cookie": "samesitenone",
      };
      await route.continue({ headers: h });
    } else {
      await route.continue();
    }
  });
  return c;
}

async function probe(browser, label, base) {
  const c = await ctx(browser);
  const page = await c.newPage();
  const evt = {
    label,
    base,
    console: [],
    pageErrors: [],
    failedRequests: [],
    firestoreRequests: [],
    uiEmpty: 0,
    uiCards: 0,
    uiError: null,
    unresolvedNextPublicRefs: [],
    chunksWithApiKey: 0,
    chunksWithAppId: 0,
    chunksWithAuthDomain: 0,
    scannedChunkCount: 0,
  };
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type())) evt.console.push(`[${m.type()}] ${m.text().slice(0, 400)}`);
  });
  page.on("pageerror", (e) => evt.pageErrors.push(e.message.slice(0, 400)));
  page.on("requestfailed", (r) => {
    try {
      evt.failedRequests.push({ host: new URL(r.url()).host, resource: r.resourceType(), err: r.failure()?.errorText });
    } catch { /* ignore */ }
  });
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("firestore.googleapis.com") || u.includes("firebaseinstallations")) {
      evt.firestoreRequests.push({ status: r.status(), host: new URL(u).host });
    }
  });

  await page.goto(`${base}/games`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(6000);
  evt.uiEmpty = await page.locator("h2").filter({ hasText: /No games yet|Couldn.t load games/i }).count();
  evt.uiCards = await page.locator("a.game-card").count();
  evt.uiError = await page.locator("[class*=empty] p, .error, .empty p").first().textContent().catch(() => null);

  // Scan every loaded script chunk. Never echo the actual API-key or App-ID
  // string — record only the number of chunks that contain the SHAPE.
  const scriptSrcs = await page.$$eval("script[src]", (els) => els.map((e) => e.src));
  const unresolved = new Set();
  for (const src of scriptSrcs) {
    try {
      const r = await page.request.get(src);
      const body = await r.text();
      if (/AIza[0-9A-Za-z_-]{35}/.test(body)) evt.chunksWithApiKey++;
      if (/1:[0-9]+:web:[0-9a-f]+/.test(body)) evt.chunksWithAppId++;
      if (body.includes("firebaseapp.com")) evt.chunksWithAuthDomain++;
      for (const m of body.match(/[a-zA-Z_$][a-zA-Z0-9_$]*\.env\.NEXT_PUBLIC_[A-Z_]+/g) ?? []) {
        // A raw `.env.NEXT_PUBLIC_FOO` reference at runtime means Next.js
        // did not inline the value — env was absent at build time.
        const name = m.match(/NEXT_PUBLIC_[A-Z_]+/)[0];
        unresolved.add(name);
      }
      evt.scannedChunkCount++;
    } catch { /* skip */ }
  }
  evt.unresolvedNextPublicRefs = [...unresolved].sort();

  await mkdir(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${label}.png`), fullPage: false });
  await c.close();
  return evt;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const launchOpts = { executablePath: CHROMIUM, headless: true, args: ["--ignore-certificate-errors"] };
  const proxy = process.env.HTTPS_PROXY;
  if (proxy) launchOpts.proxy = { server: proxy, bypass: "127.0.0.1,localhost" };
  const browser = await chromium.launch(launchOpts);
  const results = {};
  try {
    results.preview = await probe(browser, "preview", PREVIEW);
    if (PROD) results.prod = await probe(browser, "prod", PROD);
  } finally {
    await browser.close();
  }
  await writeFile(path.join(OUT, "results.json"), JSON.stringify(results, null, 2) + "\n", "utf8");
  console.error("=== PREVIEW ===");
  console.error(JSON.stringify(results.preview, null, 2));
  if (results.prod) {
    console.error("=== PROD ===");
    console.error(JSON.stringify(results.prod, null, 2));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
