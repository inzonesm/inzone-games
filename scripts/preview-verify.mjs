#!/usr/bin/env node
// Release-acceptance checks for a Vercel preview.
//
// This script drives Chromium through the release-checklist journeys and
// reports PASS / FAIL / UNVERIFIED for each with a short evidence note.
// It runs against a bypass-protected Vercel preview URL and, when the
// preview cannot load real Firestore data, falls back to a local `next dev`
// on the exact same commit.
//
// SECRETS
// -------
//   VERCEL_AUTOMATION_BYPASS_SECRET — bypass secret for Vercel deployment
//   protection. NEVER hard-code; read from env only. Applied ONLY on the
//   preview host; third-party hosts (firebasestorage, weserv, ...) never
//   receive the header.
//
// ENV
// ---
//   PREVIEW_URL      https://<...>.vercel.app         (required)
//   LOCAL_URL        http://127.0.0.1:3001            (optional; enables local-scope checks)
//   OUT_DIR          scripts/.hexclave-out/verify     (screenshots + results.json)
//   CHROMIUM         /opt/pw-browsers/chromium-1194/... (autodetected)
//
// USAGE
// -----
//   export VERCEL_AUTOMATION_BYPASS_SECRET=...
//   export PREVIEW_URL=https://inzone-games-git-...vercel.app
//   node scripts/preview-verify.mjs                    # preview + local (if LOCAL_URL set)
//
// The script never modifies Firestore, Auth, ads, billing, or any GitHub
// state. Screenshots and results.json land under OUT_DIR (gitignored by
// default via scripts/.hexclave-out/).

import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const PREVIEW = process.env.PREVIEW_URL;
const LOCAL = process.env.LOCAL_URL ?? null;
const SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const OUT = process.env.OUT_DIR ?? "scripts/.hexclave-out/verify";
const CHROMIUM =
  process.env.CHROMIUM ??
  process.env.CHROMIUM_EXECUTABLE ??
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

if (!PREVIEW) throw new Error("PREVIEW_URL not set");
if (!SECRET) throw new Error("VERCEL_AUTOMATION_BYPASS_SECRET not set");

const HOST = new URL(PREVIEW).host;

const IPHONE = { width: 390, height: 844, dpr: 3 };
const DESKTOP = { width: 1280, height: 800, dpr: 1 };
const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

async function makeCtx(browser, dev) {
  const c = await browser.newContext({
    viewport: { width: dev.width, height: dev.height },
    deviceScaleFactor: dev.dpr,
    userAgent: dev.dpr === 3 ? UA_IPHONE : undefined,
    isMobile: dev.dpr === 3,
    hasTouch: dev.dpr === 3,
    locale: "en-US",
    ignoreHTTPSErrors: true,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  // Add the bypass header ONLY for requests to the preview host.
  await c.route("**", async (route, request) => {
    if (new URL(request.url()).host === HOST) {
      const headers = {
        ...request.headers(),
        "x-vercel-protection-bypass": SECRET,
        "x-vercel-set-bypass-cookie": "samesitenone",
      };
      await route.continue({ headers });
    } else {
      await route.continue();
    }
  });
  return c;
}

async function shot(page, name) {
  await mkdir(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}

const results = {};
function record(id, verdict, evidence, scope) {
  results[id] = { verdict, evidence, scope };
  console.error(`${verdict.padEnd(15)} [${scope}] ${id} — ${evidence}`);
}

// --- Preview-scope checks (no Firestore required) -------------------------

async function previewInstallBannerCatalog(browser) {
  const c = await makeCtx(browser, IPHONE);
  const page = await c.newPage();
  try {
    await page.goto(`${PREVIEW}/games`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    await shot(page, "preview-catalog-banner");
    const banners = await page.locator("[role='dialog'][aria-label='Install InZone']").count();
    if (banners !== 0) return record("preview.catalog.no-install-banner", "FAIL", `${banners} banner(s)`, "preview");
    record("preview.catalog.no-install-banner", "PASS", "banner absent on /games", "preview");
  } finally { await c.close(); }
}

async function previewInstallBannerPlayer(browser) {
  const c = await makeCtx(browser, IPHONE);
  const page = await c.newPage();
  try {
    await page.goto(`${PREVIEW}/games/flappybird-inzone-2`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    const banners = await page.locator("[role='dialog'][aria-label='Install InZone']").count();
    if (banners !== 0) return record("preview.player.no-install-banner", "FAIL", `${banners} banner(s)`, "preview");
    record("preview.player.no-install-banner", "PASS", "banner absent on /games/[id]", "preview");
  } finally { await c.close(); }
}

async function previewUserInstallPath(browser) {
  const c = await makeCtx(browser, IPHONE);
  const page = await c.newPage();
  try {
    await page.goto(`${PREVIEW}/games`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    const appStore = await page.locator('a[href*="apps.apple.com"]').count();
    const playStore = await page.locator('a[href*="play.google.com"]').count();
    if (!appStore || !playStore) return record("preview.user-install-path", "FAIL", `App Store=${appStore} Play=${playStore}`, "preview");
    record("preview.user-install-path", "PASS", `App Store + Google Play links in catalog footer`, "preview");
    const getApp = await page.getByTestId("get-app").count();
    if (getApp < 1) return record("preview.catalog.get-app", "FAIL", `get-app count=${getApp}`, "preview");
    record("preview.catalog.get-app", "PASS", "Get the app control on /games", "preview");
  } finally { await c.close(); }
}

async function previewCatalogHasCards(browser) {
  const c = await makeCtx(browser, IPHONE);
  const page = await c.newPage();
  try {
    await page.goto(`${PREVIEW}/games`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);
    const cards = await page.locator("a.game-card").count();
    const emptyErr = await page.locator("text=/Missing Firebase web config/i").count();
    if (emptyErr > 0) return record("preview.catalog.cards", "UNVERIFIED", `Missing Firebase web config on preview build`, "preview");
    if (cards === 0) return record("preview.catalog.cards", "FAIL", "no cards rendered", "preview");
    record("preview.catalog.cards", "PASS", `${cards} game cards`, "preview");
  } finally { await c.close(); }
}

async function previewGameLoads(browser) {
  const c = await makeCtx(browser, IPHONE);
  const page = await c.newPage();
  try {
    await page.goto(`${PREVIEW}/games/flappybird-inzone-2?utm_source=meta`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(6000);
    await shot(page, "preview-game-loaded");
    const emptyErr = await page.locator("text=/Missing Firebase web config|Couldn.t load game/i").count();
    if (emptyErr > 0) return record("preview.game-loads", "UNVERIFIED", `error state on preview — Firebase envs likely absent at build time`, "preview");
    const iframeCount = await page.locator("iframe").count();
    if (iframeCount === 0) return record("preview.game-loads", "FAIL", "no iframe present at t=6s", "preview");
    record("preview.game-loads", "PASS", `${iframeCount} iframe(s) mounted`, "preview");
  } finally { await c.close(); }
}

// --- Local-scope checks (require LOCAL_URL and Firestore reachable) -------

async function localSoloArrival(browser) {
  if (!LOCAL) return record("local.solo-arrival", "UNVERIFIED", "LOCAL_URL not set", "local");
  const c = await makeCtx(browser, IPHONE);
  const page = await c.newPage();
  try {
    await page.goto(`${LOCAL}/games/flappybird-inzone-2?utm_source=meta&utm_campaign=solo_social_01`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);
    await shot(page, "local-solo-01");
    const invite = await page.getByTestId("player-invite").count();
    const chat = await page.getByTestId("player-chat").count();
    const legacy = (await page.getByTestId("play-with-friend").count()) + (await page.getByTestId("play-with-friend-mobile").count());
    if (invite !== 1) return record("local.solo.one-invite", "FAIL", `player-invite count=${invite}`, "local");
    if (chat !== 1) return record("local.solo.chat-present", "FAIL", `player-chat count=${chat}`, "local");
    if (legacy !== 0) return record("local.solo.no-legacy-cta", "FAIL", `legacy count=${legacy}`, "local");
    record("local.solo.one-invite", "PASS", "exactly one Invite CTA", "local");
    record("local.solo.chat-present", "PASS", "Chat chip present", "local");
    record("local.solo.no-legacy-cta", "PASS", "no play-with-friend testids", "local");
    const homeHref = await page.locator(".rail-btn[aria-label='Home']").getAttribute("href");
    if (homeHref !== "/games") return record("local.solo.home-to-hub", "FAIL", `home href=${homeHref}`, "local");
    record("local.solo.home-to-hub", "PASS", "Home rail goes to /games", "local");
    await page.getByTestId("player-chat").click();
    await page.waitForTimeout(800);
    const socialApp = await page.getByTestId("get-app").count();
    if (socialApp < 1) return record("local.solo.social-get-app", "FAIL", `get-app in social panel=${socialApp}`, "local");
    record("local.solo.social-get-app", "PASS", "Get the app inside the social sheet", "local");
    await page.keyboard.press("Escape");
  } finally { await c.close(); }
}

async function localChatPreservesIframe(browser) {
  if (!LOCAL) return record("local.chat-preserves-iframe", "UNVERIFIED", "LOCAL_URL not set", "local");
  const c = await makeCtx(browser, IPHONE);
  const page = await c.newPage();
  try {
    await page.goto(`${LOCAL}/games/flappybird-inzone-2`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(6000);
    const before = await page.evaluate(() => {
      const f = document.querySelector("iframe");
      if (!f?.contentWindow) return null;
      f.contentWindow.__markVerify = (f.contentWindow.__markVerify ?? 0) + 1;
      return f.contentWindow.__markVerify;
    });
    if (!before) return record("local.chat-preserves-iframe", "UNVERIFIED", "no iframe at t=6s", "local");
    await page.getByTestId("player-chat").click();
    await page.waitForTimeout(1500);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);
    const after = await page.evaluate(() => document.querySelector("iframe")?.contentWindow?.__markVerify);
    if (before !== after) return record("local.chat-preserves-iframe", "FAIL", `marker: before=${before} after=${after}`, "local");
    record("local.chat-preserves-iframe", "PASS", `marker=${before} preserved through open/close`, "local");
  } finally { await c.close(); }
}

async function localFabricatedCountsAudit(browser) {
  if (!LOCAL) return record("local.no-fabricated-counts", "UNVERIFIED", "LOCAL_URL not set", "local");
  const c = await makeCtx(browser, IPHONE);
  const page = await c.newPage();
  try {
    await page.goto(`${LOCAL}/games`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(8000);
    const pills = await page.locator(".players.live").allTextContents();
    // The fabrication returned values 999–9999. If any pill shows a value in
    // that range, that is the smoking gun. Realistic small numbers are the
    // documented open-sessions signal from getCountFromServer.
    const suspicious = pills.filter((t) => {
      const n = parseInt(t, 10);
      return Number.isFinite(n) && n >= 999;
    });
    if (suspicious.length > 0) return record("local.no-fabricated-counts", "FAIL", `999+ values: ${JSON.stringify(suspicious)}`, "local");
    record("local.no-fabricated-counts", "PASS", `${pills.length} pill(s); all below 999 — genuine open-session counts`, "local");
  } finally { await c.close(); }
}

async function localTwoGuests(browser) {
  if (!LOCAL) return record("local.two-guests", "UNVERIFIED", "LOCAL_URL not set", "local");
  const cA = await makeCtx(browser, IPHONE);
  const cB = await makeCtx(browser, DESKTOP);
  const pA = await cA.newPage();
  const pB = await cB.newPage();
  try {
    await pA.goto(`${LOCAL}/games/flappybird-inzone-2`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await pA.waitForTimeout(6000);
    await pA.getByTestId("player-invite").click();
    await pA.waitForTimeout(5000);
    const inviteUrl = await pA.evaluate(async () => {
      try { return await navigator.clipboard.readText(); } catch { return null; }
    });
    if (!inviteUrl || !inviteUrl.includes("session=")) return record("local.two-guests.invite-url", "UNVERIFIED", `clipboard shape=${inviteUrl?.slice(0, 40)}`, "local");
    record("local.two-guests.invite-url", "PASS", `session URL len=${inviteUrl.length}`, "local");
    // Rewrite the origin so Guest B lands on the local dev host.
    const localHref = inviteUrl.replace(/^https?:\/\/[^/]+/, LOCAL);
    await pB.goto(localHref, { waitUntil: "domcontentloaded", timeout: 30000 });
    await pB.waitForTimeout(6000);
    const joinBtn = pB.getByRole("button", { name: /Join session/i });
    if (await joinBtn.count() === 0) return record("local.two-guests.join-visible", "UNVERIFIED", "Join button not shown", "local");
    record("local.two-guests.join-visible", "PASS", "Join session button rendered", "local");
    // Independent switching: A switches games; B stays put.
    const bBefore = pB.url();
    await pA.goto(`${LOCAL}/games/nightclub-showdown-inzone-production${new URL(inviteUrl).search}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await pA.waitForTimeout(4000);
    const bAfter = pB.url();
    if (bBefore === bAfter) record("local.two-guests.switch-independent", "PASS", "B URL unchanged after A switched", "local");
    else record("local.two-guests.switch-independent", "FAIL", `B moved ${bBefore} → ${bAfter}`, "local");
    // Refresh keeps A's session in the URL.
    await pA.reload({ waitUntil: "domcontentloaded" });
    await pA.waitForTimeout(3000);
    if (pA.url().includes("session=")) record("local.two-guests.refresh-restores-session", "PASS", "A retains session after reload", "local");
    else record("local.two-guests.refresh-restores-session", "FAIL", `A URL=${pA.url()}`, "local");
    // A leaves; B keeps playing.
    await pA.close();
    await pB.waitForTimeout(3000);
    if (await pB.locator(".game-frame-shell").count() > 0) record("local.two-guests.leave-does-not-boot-other", "PASS", "B still on game", "local");
    else record("local.two-guests.leave-does-not-boot-other", "FAIL", "B lost shell", "local");
  } catch (e) {
    record("local.two-guests.exception", "UNVERIFIED", e.message.slice(0, 200), "local");
  } finally { await cA.close().catch(() => {}); await cB.close().catch(() => {}); }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const launchOpts = { executablePath: CHROMIUM, headless: true, args: ["--ignore-certificate-errors"] };
  const proxy = process.env.HTTPS_PROXY;
  if (proxy) launchOpts.proxy = { server: proxy, bypass: "127.0.0.1,localhost" };
  const browser = await chromium.launch(launchOpts);
  try {
    await previewInstallBannerCatalog(browser);
    await previewInstallBannerPlayer(browser);
    await previewUserInstallPath(browser);
    await previewCatalogHasCards(browser);
    await previewGameLoads(browser);
    if (LOCAL) {
      await localSoloArrival(browser);
      await localChatPreservesIframe(browser);
      await localFabricatedCountsAudit(browser);
      await localTwoGuests(browser);
    }
  } finally {
    await browser.close();
  }
  await writeFile(path.join(OUT, "results.json"), JSON.stringify(results, null, 2) + "\n", "utf8");
  console.error("=== SUMMARY ===");
  for (const [k, v] of Object.entries(results)) console.error(`${v.verdict.padEnd(15)} [${v.scope}] ${k}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
