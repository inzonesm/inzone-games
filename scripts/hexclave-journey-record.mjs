#!/usr/bin/env node
// Drive Chromium through the InZone journeys that Hexclave replays surface as
// friction points, and record screenshots for each stage. Runs against the
// production URL by default (INZONE_BASE_URL to override; anything but a
// vercel.app preview or inzone.games is treated as a mistake).
//
// This is a reproduction tool, not a load test. It uses isolated test guests
// (a fresh browser context per journey — no shared cookies, no persistent
// state), it never signs in, it never uploads, and it never touches Firebase
// Auth, Firestore rules, billing, or ads. Meta pixel and Stripe network calls
// are logged but not asserted against; blocked hosts are recorded so the
// operator can add them to the outbound-network allowlist.
//
// Journeys currently covered:
//   paid-flappy-mobile   Meta paid mobile arrival at /games/flappybird-inzone-2
//   catalog-mobile       /games catalog on iPhone (thumbnails need
//                          firebasestorage.googleapis.com + images.weserv.nl)
//   neon-blaster-desktop Open Neon Blaster at desktop viewport; the game
//                          bundle self-reports "couldn't start" on cold Vercel
//                          edge cache — worth catching
//   back-nav-desktop     /games → open Neon Blaster → back button → /games
//   rotate-flappy        Rotate the phone mid-game (portrait → landscape →
//                          portrait) and record what the host page does
//   invite-prototype     Land on /session-prototype directly
//
// Preconditions:
//   /opt/pw-browsers/chromium-1194/chrome-linux/chrome  Playwright's Chromium.
//   HTTPS_PROXY (optional) will be forwarded to Chromium as its proxy server.
//   --ignore-certificate-errors is passed so a MITM'd proxy CA is accepted.
//   Outbound network policy must reach www.inzone.games / *.vercel.app.
//
// Usage:
//   node scripts/hexclave-journey-record.mjs                     # all journeys
//   node scripts/hexclave-journey-record.mjs paid-flappy-mobile catalog-mobile
//
// Output: screenshots + `journey-log.json` land under OUT_DIR (defaults to
// `scripts/.hexclave-out/journeys`, which is git-ignored).

import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const BASE = process.env.INZONE_BASE_URL ?? "https://www.inzone.games";
const OUT = process.env.OUT_DIR ?? "scripts/.hexclave-out/journeys";
const CHROMIUM =
  process.env.CHROMIUM_EXECUTABLE ??
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const HEADLESS = process.env.HEADFUL !== "1";
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || null;

const IPHONE = { width: 390, height: 844, dpr: 3 };
const IPHONE_LANDSCAPE = { width: 844, height: 390, dpr: 3 };
const DESKTOP = { width: 1280, height: 800, dpr: 1 };

const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const META_UTM =
  "utm_source=meta&utm_medium=paid_social&utm_campaign=solo_social_01&utm_content=a_solo_v1";

async function makeContext(browser, dev) {
  return browser.newContext({
    viewport: { width: dev.width, height: dev.height },
    deviceScaleFactor: dev.dpr,
    userAgent: dev.dpr === 3 ? UA_IPHONE : undefined,
    isMobile: dev.dpr === 3,
    hasTouch: dev.dpr === 3,
    locale: "en-US",
    ignoreHTTPSErrors: true,
  });
}

function attachFailureLog(page, entries) {
  page.on("requestfailed", (r) => {
    try {
      entries.push({
        kind: "requestfailed",
        host: new URL(r.url()).host,
        url: r.url().slice(0, 200),
        resourceType: r.resourceType(),
        err: r.failure()?.errorText,
      });
    } catch { /* ignore */ }
  });
  page.on("pageerror", (e) => entries.push({ kind: "pageerror", message: e.message.slice(0, 300) }));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") {
      entries.push({ kind: `console.${m.type()}`, text: m.text().slice(0, 300) });
    }
  });
}

async function shot(page, dir, name) {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const JOURNEYS = {
  async "paid-flappy-mobile"(browser, journeyDir) {
    const ctx = await makeContext(browser, IPHONE);
    const page = await ctx.newPage();
    const log = [];
    attachFailureLog(page, log);
    const t0 = Date.now();
    const resp = await page.goto(
      `${BASE}/games/flappybird-inzone-2?${META_UTM}`,
      { waitUntil: "domcontentloaded", timeout: 30000 },
    );
    log.push({ kind: "goto", dclMs: Date.now() - t0, status: resp?.status() });
    await shot(page, journeyDir, "01-dcl");
    for (const [name, wait] of [["02-t1s", 1000], ["03-t3s", 2000], ["04-t6s", 3000], ["05-t10s", 4000]]) {
      await page.waitForTimeout(wait);
      const state = await page.evaluate(() => {
        const boot = document.querySelector(".game-boot");
        const iframe = document.querySelector("iframe");
        return {
          bootPresent: !!boot && getComputedStyle(boot).display !== "none",
          bootName: document.querySelector(".game-boot-name")?.textContent,
          bootStatus: document.querySelector(".game-boot-status")?.textContent,
          bootArtFallback: document.querySelector(".game-boot-art")?.classList.contains("game-boot-art-fallback"),
          iframeSrc: iframe?.getAttribute("src"),
        };
      });
      log.push({ kind: "state", name, ...state });
      await shot(page, journeyDir, name);
    }
    await ctx.close();
    return log;
  },

  async "catalog-mobile"(browser, journeyDir) {
    const ctx = await makeContext(browser, IPHONE);
    const page = await ctx.newPage();
    const log = [];
    attachFailureLog(page, log);
    await page.goto(`${BASE}/games`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);
    await shot(page, journeyDir, "01-top");
    await page.evaluate(() => window.scrollTo({ top: 400 }));
    await page.waitForTimeout(400);
    await shot(page, journeyDir, "02-scroll400");
    await page.evaluate(() => window.scrollTo({ top: 1200 }));
    await page.waitForTimeout(400);
    await shot(page, journeyDir, "03-scroll1200");
    const cards = await page.locator("a.game-card").all();
    const info = [];
    for (let i = 0; i < Math.min(cards.length, 24); i++) {
      info.push({
        href: await cards[i].getAttribute("href"),
        name: (await cards[i].locator(".name").textContent().catch(() => null))?.trim() ?? null,
      });
    }
    log.push({ kind: "catalog-cards", cards: info });
    await ctx.close();
    return log;
  },

  async "neon-blaster-desktop"(browser, journeyDir) {
    const ctx = await makeContext(browser, DESKTOP);
    const page = await ctx.newPage();
    const log = [];
    attachFailureLog(page, log);
    const t0 = Date.now();
    const resp = await page.goto(
      `${BASE}/games/neon-blaster-inzone-production`,
      { waitUntil: "domcontentloaded", timeout: 30000 },
    );
    log.push({ kind: "goto", dclMs: Date.now() - t0, status: resp?.status() });
    for (const [name, wait] of [["01-t0", 200], ["02-t2s", 2000], ["03-t5s", 3000], ["04-t10s", 5000]]) {
      await page.waitForTimeout(wait);
      await shot(page, journeyDir, name);
    }
    await ctx.close();
    return log;
  },

  async "back-nav-desktop"(browser, journeyDir) {
    const ctx = await makeContext(browser, DESKTOP);
    const page = await ctx.newPage();
    const log = [];
    attachFailureLog(page, log);
    await page.goto(`${BASE}/games`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    await shot(page, journeyDir, "01-catalog");
    const link = page.locator('a.game-card[href*="neon-blaster"]').first();
    if (await link.count()) {
      await link.click();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(2500);
      await shot(page, journeyDir, "02-neon");
      await page.goBack();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(1500);
      await shot(page, journeyDir, "03-back-catalog");
    } else {
      log.push({ kind: "note", text: "neon-blaster card not visible in catalog" });
    }
    await ctx.close();
    return log;
  },

  async "rotate-flappy"(browser, journeyDir) {
    const ctx = await browser.newContext({
      viewport: { width: IPHONE.width, height: IPHONE.height },
      deviceScaleFactor: 3,
      userAgent: UA_IPHONE,
      isMobile: true,
      hasTouch: true,
      ignoreHTTPSErrors: true,
    });
    const page = await ctx.newPage();
    const log = [];
    attachFailureLog(page, log);
    await page.goto(`${BASE}/games/flappybird-inzone-2`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);
    await shot(page, journeyDir, "01-portrait");
    await page.setViewportSize({ width: IPHONE_LANDSCAPE.width, height: IPHONE_LANDSCAPE.height });
    await page.waitForTimeout(1500);
    await shot(page, journeyDir, "02-landscape");
    await page.setViewportSize({ width: IPHONE.width, height: IPHONE.height });
    await page.waitForTimeout(1500);
    await shot(page, journeyDir, "03-back-portrait");
    await ctx.close();
    return log;
  },

  async "invite-prototype"(browser, journeyDir) {
    const ctx = await makeContext(browser, IPHONE);
    const page = await ctx.newPage();
    const log = [];
    attachFailureLog(page, log);
    await page.goto(`${BASE}/session-prototype`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    await shot(page, journeyDir, "01-open");
    await page.waitForTimeout(3000);
    await shot(page, journeyDir, "02-t6s");
    await ctx.close();
    return log;
  },
};

async function main() {
  const requested = process.argv.slice(2);
  const names = requested.length ? requested : Object.keys(JOURNEYS);
  const unknown = names.filter((n) => !(n in JOURNEYS));
  if (unknown.length) {
    console.error(`Unknown journey(s): ${unknown.join(", ")}`);
    console.error(`Available: ${Object.keys(JOURNEYS).join(", ")}`);
    process.exit(2);
  }
  const out = path.resolve(OUT);
  await mkdir(out, { recursive: true });
  const launchOpts = { executablePath: CHROMIUM, headless: HEADLESS, args: ["--ignore-certificate-errors"] };
  if (PROXY) launchOpts.proxy = { server: PROXY };
  const browser = await chromium.launch(launchOpts);
  const summary = {};
  try {
    for (const name of names) {
      const dir = path.join(out, name);
      console.error(`[journey] ${name} → ${dir}`);
      summary[name] = await JOURNEYS[name](browser, dir);
      await writeFile(path.join(dir, "journey-log.json"), `${JSON.stringify(summary[name], null, 2)}\n`, "utf8");
    }
  } finally {
    await browser.close();
  }
  await writeFile(path.join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.error(`[journey] wrote summary → ${path.join(out, "summary.json")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
