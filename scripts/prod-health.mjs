#!/usr/bin/env node
// Production health check for suspected "can't play / can't navigate" reports.
// Fresh contexts only. Labels device emulation accurately. Never claims
// iframe-shell presence as verified play. Writes gitignored screenshots.

import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.INZONE_BASE_URL ?? "https://www.inzone.games";
const OUT = process.env.OUT_DIR ?? "scripts/.hexclave-out/prod-health";
const CHROMIUM = process.env.CHROMIUM_EXECUTABLE ?? "/usr/bin/google-chrome-stable";

const IPHONE = {
  label: "emulated-iphone-390x844 (Playwright iPhone UA + touch; not a physical device)",
  width: 390,
  height: 844,
  dpr: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};
const DESKTOP = {
  label: "desktop-chromium-1280x800 (headless Chrome 148; not a visitor GPU)",
  width: 1280,
  height: 800,
  dpr: 1,
  isMobile: false,
  hasTouch: false,
};

function attachLog(page, log) {
  page.on("requestfailed", (r) => {
    try {
      log.push({
        kind: "requestfailed",
        host: new URL(r.url()).host,
        url: r.url().slice(0, 180),
        type: r.resourceType(),
        err: r.failure()?.errorText,
      });
    } catch {
      /* ignore */
    }
  });
  page.on("pageerror", (e) => log.push({ kind: "pageerror", message: String(e.message).slice(0, 400) }));
  page.on("console", (m) => {
    if (m.type() === "error") log.push({ kind: "console.error", text: m.text().slice(0, 400) });
  });
  page.on("response", (r) => {
    const status = r.status();
    if (status >= 400) {
      try {
        log.push({ kind: "http", status, host: new URL(r.url()).host, url: r.url().slice(0, 180) });
      } catch {
        /* ignore */
      }
    }
  });
}

async function shot(page, dir, name) {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function gameState(page) {
  return page.evaluate(() => {
    const iframe = document.querySelector(".game-frame-body iframe, iframe");
    const boot = document.querySelector(".game-boot");
    const err = document.querySelector(".empty h2");
    let inner = null;
    try {
      const doc = iframe?.contentDocument;
      if (doc) {
        const canvas = doc.querySelector("canvas");
        inner = {
          readyState: doc.readyState,
          title: doc.title?.slice(0, 80) || "",
          bodyText: (doc.body?.innerText || "").replace(/\s+/g, " ").slice(0, 180),
          canvas: canvas
            ? { w: canvas.width, h: canvas.height, clientW: canvas.clientWidth, clientH: canvas.clientHeight }
            : null,
          scriptCount: doc.scripts.length,
          hasNonWhitespace: Boolean(doc.body && doc.body.innerText.trim().length > 0),
        };
      }
    } catch (e) {
      inner = { crossOrigin: true, error: String(e).slice(0, 120) };
    }
    const pills = [...document.querySelectorAll(".players")].map((el) => el.textContent?.replace(/\s+/g, " ").trim());
    return {
      href: location.href,
      title: document.title,
      boot: boot
        ? {
            name: document.querySelector(".game-boot-name")?.textContent?.trim() || null,
            status: document.querySelector(".game-boot-status")?.textContent?.trim() || null,
            fallbackArt: Boolean(document.querySelector(".game-boot-art-fallback")),
            actions: Boolean(document.querySelector(".game-boot-actions")),
          }
        : null,
      errorHeading: err?.textContent?.trim() || null,
      iframe: iframe
        ? { src: iframe.getAttribute("src"), title: iframe.getAttribute("title"), w: iframe.clientWidth, h: iframe.clientHeight }
        : null,
      inner,
      invite: document.querySelectorAll("[data-testid='player-invite'], .player-invite-copy").length,
      playWithFriend: document.querySelectorAll("[data-testid='play-with-friend'], [data-testid='play-with-friend-mobile'], .player-invite-btn").length,
      chat: document.querySelectorAll("[data-testid='player-chat']").length,
      installBanner: document.querySelectorAll("[role='dialog'][aria-label='Install InZone']").length,
      homeHref: document.querySelector(".rail-btn[aria-label='Home']")?.getAttribute("href") || null,
      cards: document.querySelectorAll("a.game-card").length,
      playingPills: pills.slice(0, 12),
      firebaseMissing: /Missing Firebase web config/.test(document.body.innerText),
    };
  });
}

async function clickIframeCenter(page) {
  const box = await page.locator(".game-frame-body iframe, iframe").first().boundingBox();
  if (!box) return { clicked: false };
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.click(x, y);
  return { clicked: true, x: Math.round(x), y: Math.round(y), box };
}

async function withContext(browser, device, fn) {
  const ctx = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: device.dpr,
    userAgent: device.userAgent,
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
    locale: "en-US",
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();
  const log = [{ kind: "device", label: device.label }];
  attachLog(page, log);
  try {
    await fn(page, log);
  } finally {
    await ctx.close();
  }
  return log;
}

async function landingToPlay(browser, device, dir) {
  return withContext(browser, device, async (page, log) => {
    const t0 = Date.now();
    const resp = await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    log.push({ kind: "landing", status: resp?.status(), href: page.url(), ms: Date.now() - t0 });
    await page.waitForTimeout(2500);
    log.push({ kind: "after-landing-redirect", href: page.url(), state: await gameState(page) });
    await shot(page, dir, "01-catalog");

    const card = page.locator("a.game-card").first();
    const cardHref = await card.getAttribute("href");
    const cardName = (await card.locator(".name").textContent().catch(() => null))?.trim();
    log.push({ kind: "picked-card", href: cardHref, name: cardName });
    await card.click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1500);
    log.push({ kind: "game-t1.5s", state: await gameState(page) });
    await shot(page, dir, "02-game-early");
    await page.waitForTimeout(6500);
    const mid = await gameState(page);
    log.push({ kind: "game-t8s", state: mid });
    await shot(page, dir, "03-game-loaded");

    const click = await clickIframeCenter(page);
    await page.waitForTimeout(800);
    const afterClick = await gameState(page);
    log.push({ kind: "after-center-click", click, state: afterClick });
    await shot(page, dir, "04-after-click");

    const home = page.locator(".rail-btn[aria-label='Home']");
    if (await home.count()) {
      await home.click();
      await page.waitForTimeout(2500);
      log.push({ kind: "after-home", href: page.url(), state: await gameState(page) });
      await shot(page, dir, "05-after-home");
    }

    if (!page.url().includes("/games/") || page.url().endsWith("/games") || page.url().includes("/games?")) {
      const second = page.locator("a.game-card").nth(1);
      if (await second.count()) {
        const href2 = await second.getAttribute("href");
        await second.click();
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(4000);
        log.push({ kind: "second-game", href: href2, state: await gameState(page) });
        await shot(page, dir, "06-second-game");
        await page.goBack();
        await page.waitForTimeout(2000);
        log.push({ kind: "browser-back", href: page.url(), state: await gameState(page) });
        await shot(page, dir, "07-browser-back");
      }
    }
  });
}

async function flappyPlay(browser, dir) {
  return withContext(browser, DESKTOP, async (page, log) => {
    await page.goto(`${BASE}/games/flappybird-inzone-2`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(8000);
    log.push({ kind: "flappy-loaded", state: await gameState(page) });
    await shot(page, dir, "01-loaded");
    const before = await page.evaluate(() => {
      const c = document.querySelector("iframe")?.contentDocument?.querySelector("canvas");
      if (!c) return null;
      try {
        return c.toDataURL("image/png").slice(0, 80);
      } catch {
        return "tainted-or-blocked";
      }
    });
    await clickIframeCenter(page);
    await page.waitForTimeout(200);
    await clickIframeCenter(page);
    await page.waitForTimeout(200);
    await clickIframeCenter(page);
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => {
      const c = document.querySelector("iframe")?.contentDocument?.querySelector("canvas");
      if (!c) return null;
      try {
        return c.toDataURL("image/png").slice(0, 80);
      } catch {
        return "tainted-or-blocked";
      }
    });
    log.push({
      kind: "flappy-input",
      canvasChanged: Boolean(before && after && before !== after),
      beforeKind: before ? (before === "tainted-or-blocked" ? before : "data-url") : null,
      afterKind: after ? (after === "tainted-or-blocked" ? after : "data-url") : null,
    });
    await shot(page, dir, "02-after-flaps");
  });
}

async function nightclubPlay(browser, dir) {
  return withContext(browser, DESKTOP, async (page, log) => {
    await page.goto(`${BASE}/games/nightclub-showdown-inzone-production`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(8000);
    log.push({ kind: "nightclub-loaded", state: await gameState(page) });
    await shot(page, dir, "01-loaded");
    await clickIframeCenter(page);
    await page.waitForTimeout(1000);
    log.push({ kind: "nightclub-after-click", state: await gameState(page) });
    await shot(page, dir, "02-after-click");
  });
}

async function corruptedRoute(browser, dir) {
  return withContext(browser, DESKTOP, async (page, log) => {
    await page.goto(`${BASE}/games/nightclub-showdown-inzone-production%60**`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);
    log.push({ kind: "corrupted-route", state: await gameState(page) });
    await shot(page, dir, "01-corrupted");
  });
}

async function catalogInventory(browser, dir) {
  return withContext(browser, IPHONE, async (page, log) => {
    await page.goto(`${BASE}/games`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3500);
    const inv = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("a.game-card")].slice(0, 16).map((el) => ({
        href: el.getAttribute("href"),
        name: el.querySelector(".name")?.textContent?.trim() || null,
        playing: el.querySelector(".players")?.textContent?.replace(/\s+/g, " ").trim() || null,
      }));
      return {
        href: location.href,
        cards: cards.length,
        installBanner: document.querySelectorAll("[role='dialog'][aria-label='Install InZone']").length,
        storeLinks: {
          apple: [...document.querySelectorAll('a[href*="apps.apple.com"]')].map((a) => a.href),
          play: [...document.querySelectorAll('a[href*="play.google.com"]')].map((a) => a.href),
        },
        sample: cards,
        firebaseMissing: /Missing Firebase web config/.test(document.body.innerText),
        hamburger: Boolean(document.querySelector(".mobile-menu-btn")),
      };
    });
    log.push({ kind: "catalog-inventory", ...inv });
    await shot(page, dir, "01-catalog-iphone-emulation");
    const menu = page.locator(".mobile-menu-btn");
    const banner = page.locator("[role='dialog'][aria-label='Install InZone']");
    log.push({
      kind: "nav-obstruction",
      hamburgerCount: await menu.count(),
      installBannerCount: await banner.count(),
      bannerInterceptsMenu: (await banner.count()) > 0,
    });
    if (await menu.count()) {
      try {
        await menu.click({ timeout: 2500 });
        log.push({ kind: "menu-click", result: "ok" });
      } catch (err) {
        log.push({
          kind: "menu-click",
          result: "blocked",
          message: String(err.message).split("\n")[0],
        });
        await menu.click({ force: true, timeout: 2500 }).catch(() => {});
        log.push({ kind: "menu-click-forced", expanded: await menu.getAttribute("aria-expanded") });
      }
      await page.waitForTimeout(400);
      await shot(page, dir, "02-menu-after-click");
    }
  });
}

async function main() {
  const out = path.resolve(OUT);
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: ["--ignore-certificate-errors", "--disable-gpu"],
  });
  const summary = {
    base: BASE,
    chrome: CHROMIUM,
    startedAt: new Date().toISOString(),
  };
  try {
    const jobs = [
      ["catalogIphoneEmulation", () => catalogInventory(browser, path.join(out, "catalog-iphone-emulation"))],
      ["desktopLandingToPlay", () => landingToPlay(browser, DESKTOP, path.join(out, "desktop-landing-to-play"))],
      ["iphoneEmulationLandingToPlay", () => landingToPlay(browser, IPHONE, path.join(out, "iphone-emulation-landing-to-play"))],
      ["flappyDesktop", () => flappyPlay(browser, path.join(out, "flappy-desktop"))],
      ["nightclubDesktop", () => nightclubPlay(browser, path.join(out, "nightclub-desktop"))],
      ["corruptedRoute", () => corruptedRoute(browser, path.join(out, "corrupted-route"))],
    ];
    for (const [name, fn] of jobs) {
      try {
        summary[name] = await fn();
      } catch (err) {
        summary[name] = {
          error: err instanceof Error ? err.stack : String(err),
        };
      }
    }
  } finally {
    await browser.close();
  }
  summary.finishedAt = new Date().toISOString();
  await writeFile(path.join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ out, journeys: Object.keys(summary).filter((k) => k !== "base" && k !== "chrome") }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
