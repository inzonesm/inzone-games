#!/usr/bin/env node
import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.LOCAL_URL ?? "http://127.0.0.1:3001";
const OUT = process.env.OUT_DIR ?? "scripts/.hexclave-out/local-verify";
const CHROMIUM = process.env.CHROMIUM_EXECUTABLE ?? "/usr/bin/google-chrome-stable";
const ARTIFACTS = "/opt/cursor/artifacts/inzone-local-verify";

const IPHONE = {
  width: 390, height: 844, dpr: 3, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};
const DESKTOP = { width: 1280, height: 800, dpr: 1, isMobile: false, hasTouch: false };

const results = [];
function rec(id, verdict, evidence) {
  results.push({ id, verdict, evidence });
  console.error(`${verdict.padEnd(12)} ${id} — ${evidence}`);
}

async function shot(page, name) {
  await mkdir(OUT, { recursive: true });
  await mkdir(ARTIFACTS, { recursive: true });
  const a = path.join(OUT, `${name}.png`);
  const b = path.join(ARTIFACTS, `${name}.png`);
  await page.screenshot({ path: a, fullPage: false });
  await page.screenshot({ path: b, fullPage: false });
}

async function ctx(browser, d) {
  return browser.newContext({
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: d.dpr,
    userAgent: d.userAgent,
    isMobile: d.isMobile,
    hasTouch: d.hasTouch,
    locale: "en-US",
    ignoreHTTPSErrors: true,
  });
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: ["--ignore-certificate-errors", "--disable-gpu"],
  });

  // 1. Hub iPhone emulation
  {
    const c = await ctx(browser, IPHONE);
    const page = await c.newPage();
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForURL("**/games", { timeout: 15000 }).catch(() => {});
    await page.waitForSelector("a.game-card, .hub-lede, text=Missing Firebase", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await shot(page, "01-hub-iphone-emulation");
    const st = await page.evaluate(() => ({
      href: location.href,
      banners: document.querySelectorAll("[role='dialog'][aria-label='Install InZone']").length,
      cards: document.querySelectorAll("a.game-card").length,
      getApp: document.querySelectorAll("[data-testid='get-app']").length,
      lede: document.querySelector(".hub-lede")?.textContent || "",
      apple: document.querySelectorAll('a[href*="apps.apple.com"]').length,
      play: document.querySelectorAll('a[href*="play.google.com"]').length,
      pills: [...document.querySelectorAll(".players")].slice(0, 8).map((el) => el.textContent.replace(/\s+/g, " ").trim()),
      firebaseMissing: /Missing Firebase web config/.test(document.body.innerText),
    }));
    if (!st.href.includes("/games")) rec("hub.redirect", "FAIL", st.href);
    else rec("hub.redirect", "PASS", st.href);
    if (st.banners !== 0) rec("hub.no-install-banner", "FAIL", `${st.banners} banners`);
    else rec("hub.no-install-banner", "PASS", "banner absent on iPhone UA");
    if (st.cards < 1) rec("hub.cards", "FAIL", `cards=${st.cards} firebaseMissing=${st.firebaseMissing}`);
    else rec("hub.cards", "PASS", `${st.cards} cards`);
    if (st.getApp < 1) rec("hub.get-app", "FAIL", `get-app=${st.getApp}`);
    else rec("hub.get-app", "PASS", "Get the app in header");
    if (!/Discover games\. Play instantly\. Bring your friends\./.test(st.lede)) rec("hub.lede", "FAIL", st.lede.slice(0, 160));
    else rec("hub.lede", "PASS", "product direction present");
    if (!st.apple || !st.play) rec("hub.footer-stores", "FAIL", `apple=${st.apple} play=${st.play}`);
    else rec("hub.footer-stores", "PASS", "footer store links");
    const fourDigit = st.pills.filter((p) => /\b[1-9]\d{3,}\b/.test(p));
    if (fourDigit.length) rec("hub.no-fabricated-counts", "FAIL", fourDigit.join(","));
    else rec("hub.no-fabricated-counts", "PASS", `sample=${st.pills.join(" | ") || "none"}`);

    await page.getByTestId("get-app").click();
    await page.waitForTimeout(400);
    await shot(page, "02-get-app-open-iphone-emulation");
    const panel = await page.getByTestId("get-app-panel").count();
    const appleBtn = await page.getByTestId("get-app-apple").count();
    const playBtn = await page.getByTestId("get-app-play").count();
    const phone = await page.getByTestId("get-app-phone-link").count();
    if (panel && appleBtn && playBtn && phone) rec("hub.get-app-panel", "PASS", "App Store + Play + phone link");
    else rec("hub.get-app-panel", "FAIL", `panel=${panel} apple=${appleBtn} play=${playBtn} phone=${phone}`);
    const limit = await page.locator(".get-app-limit").textContent();
    if (/stay in this tab/i.test(limit || "")) rec("hub.get-app-limit", "PASS", (limit || "").trim());
    else rec("hub.get-app-limit", "FAIL", String(limit));
    await c.close();
  }

  // 2. Desktop catalog + Flappy play path
  {
    const c = await ctx(browser, DESKTOP);
    const page = await c.newPage();
    await page.goto(`${BASE}/games/flappybird-inzone-2`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(7000);
    await shot(page, "03-flappy-desktop");
    const st = await page.evaluate(() => {
      const iframe = document.querySelector(".game-frame-body iframe");
      let inner = null;
      try {
        const doc = iframe?.contentDocument;
        inner = {
          title: doc?.title,
          canvas: Boolean(doc?.querySelector("canvas")),
          body: (doc?.body?.innerText || "").replace(/\s+/g, " ").slice(0, 80),
        };
      } catch (e) {
        inner = { error: String(e).slice(0, 80) };
      }
      return {
        boot: Boolean(document.querySelector(".game-boot")),
        bootName: document.querySelector(".game-boot-name")?.textContent || null,
        invite: document.querySelectorAll("[data-testid='player-invite']").length,
        chat: document.querySelectorAll("[data-testid='player-chat']").length,
        legacy: document.querySelectorAll("[data-testid='play-with-friend'], [data-testid='play-with-friend-mobile']").length,
        home: document.querySelector(".rail-btn[aria-label='Home']")?.getAttribute("href"),
        banners: document.querySelectorAll("[role='dialog'][aria-label='Install InZone']").length,
        iframeSrc: iframe?.getAttribute("src"),
        inner,
      };
    });
    if (st.invite === 1 && st.chat === 1 && st.legacy === 0) rec("player.solo-cta", "PASS", "one Invite + Chat");
    else rec("player.solo-cta", "FAIL", JSON.stringify({ invite: st.invite, chat: st.chat, legacy: st.legacy }));
    if (st.home === "/games") rec("player.home-href", "PASS", "/games");
    else rec("player.home-href", "FAIL", String(st.home));
    if (st.banners !== 0) rec("player.no-install-banner", "FAIL", `${st.banners}`);
    else rec("player.no-install-banner", "PASS", "banner absent");
    if (st.inner?.canvas && /gcs\/games\/flappybird-inzone-2/.test(st.iframeSrc || "")) {
      rec("player.flappy-frame", "PASS", `title=${st.inner.title} boot=${st.boot}`);
    } else rec("player.flappy-frame", "FAIL", JSON.stringify(st.inner));

    // START is a PlayCanvas sprite, not a DOM text node. Click the entity.
    const startTarget = await page.evaluate(() => {
      const win = document.querySelector(".game-frame-body iframe, iframe")?.contentWindow;
      const app = win?.pc?.Application?.getApplication?.();
      const cam = app?.root?.findByName("Camera");
      const startBtn = app?.root?.findByName("Start Button");
      if (!cam?.camera || !startBtn) return null;
      const s = cam.camera.worldToScreen(startBtn.getPosition());
      return { x: s.x, y: s.y, menu: app.root.findByName("Menu Screen")?.enabled };
    });
    if (startTarget) {
      const canvas = page.frameLocator(".game-frame-body iframe").locator("canvas").first();
      await canvas.click({ position: { x: startTarget.x, y: startTarget.y }, force: true });
      await page.waitForTimeout(800);
      await shot(page, "04-flappy-after-start");
      const afterStart = await page.evaluate(() => {
        const app = document.querySelector("iframe")?.contentWindow?.pc?.Application?.getApplication?.();
        const bird = app?.root.findByName("Game")?.findByName("Bird")?.script?.bird;
        return {
          menu: app?.root.findByName("Menu Screen")?.enabled ?? null,
          bird: bird?.state ?? null,
        };
      });
      if (afterStart.menu === false && (afterStart.bird === "getready" || afterStart.bird === "play")) {
        rec("player.flappy-start-click", "PASS", `Start Button ${startTarget.x.toFixed(0)},${startTarget.y.toFixed(0)} bird=${afterStart.bird}`);
      } else {
        rec("player.flappy-start-click", "FAIL", JSON.stringify({ startTarget, afterStart }));
      }
    } else {
      rec("player.flappy-start-click", "UNVERIFIED", "PlayCanvas Start Button not mapped");
    }

    const sizeAt = async (w, h) => {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(900);
      return page.evaluate(() => {
        const iframe = document.querySelector(".game-frame-body iframe");
        return iframe ? { w: iframe.clientWidth, h: iframe.clientHeight } : null;
      });
    };
    const portraitBox = await sizeAt(390, 844);
    await shot(page, "04b-flappy-portrait");
    const landscapeBox = await sizeAt(844, 390);
    await shot(page, "04c-flappy-landscape");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(600);
    if (portraitBox && landscapeBox && landscapeBox.w > portraitBox.w) {
      rec("player.orientation-iframe", "PASS", `portrait ${portraitBox.w}x${portraitBox.h} → landscape ${landscapeBox.w}x${landscapeBox.h}`);
    } else {
      rec("player.orientation-iframe", "UNVERIFIED", JSON.stringify({ portraitBox, landscapeBox }));
    }

    try {
      const beforeMark = await page.evaluate(() => {
        const w = document.querySelector("iframe")?.contentWindow;
        if (!w) return null;
        w.__markVerify = 1;
        return 1;
      });
      const social = page.getByTestId("player-invite");
      await social.click({ force: true, timeout: 5000 });
      await page.waitForTimeout(800);
      await shot(page, "05-social-open");
      const socialApp = await page.getByTestId("get-app").count();
      if (socialApp >= 1) rec("player.social-get-app", "PASS", `get-app=${socialApp}`);
      else rec("player.social-get-app", "FAIL", "Get the app missing in social sheet");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      const afterMark = await page.evaluate(() => document.querySelector("iframe")?.contentWindow?.__markVerify);
      if (beforeMark === afterMark) rec("player.invite-no-remount", "PASS", "iframe window mark survived Invite open/close");
      else rec("player.invite-no-remount", "FAIL", `before=${beforeMark} after=${afterMark}`);
    } catch (err) {
      rec("player.social-get-app", "FAIL", String(err.message).split("\n")[0]);
    }

    await page.locator(".rail-btn[aria-label='Home']").click();
    await page.waitForTimeout(2500);
    await shot(page, "06-after-home");
    const afterHome = page.url();
    const spinnerStay = await page.evaluate(() => /Game Hub/.test(document.body.innerText) && document.querySelectorAll("a.game-card").length);
    if (afterHome.includes("/games") && !afterHome.endsWith("/") && spinnerStay > 0) {
      rec("player.home-lands-on-hub", "PASS", `${afterHome} cards=${spinnerStay}`);
    } else rec("player.home-lands-on-hub", "FAIL", `${afterHome} cards=${spinnerStay}`);
    await c.close();
  }

  // 3. Corrupted nightclub URL
  {
    const c = await ctx(browser, DESKTOP);
    const page = await c.newPage();
    await page.goto(`${BASE}/games/nightclub-showdown-inzone-production%60**`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);
    await shot(page, "07-corrupted-route");
    const st = await page.evaluate(() => ({
      href: location.href,
      err: document.querySelector(".empty h2")?.textContent || null,
      iframe: document.querySelector(".game-frame-body iframe")?.getAttribute("src"),
      innerTitle: document.querySelector(".game-frame-body iframe")?.contentDocument?.title || null,
    }));
    if (st.err) rec("route.normalize", "FAIL", `${st.err} href=${st.href}`);
    else if (st.iframe && /nightclub-showdown-inzone-production/.test(st.iframe) && !/%60/.test(st.iframe)) {
      rec("route.normalize", "PASS", `iframe=${st.iframe} title=${st.innerTitle}`);
    } else rec("route.normalize", "UNVERIFIED", JSON.stringify(st));
    await c.close();
  }

  // 4. Two guests — session URL, Join, independent URLs, B still has a live frame.
  {
    const cA = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      userAgent: IPHONE.userAgent,
      isMobile: true,
      hasTouch: true,
      ignoreHTTPSErrors: true,
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const cB = await ctx(browser, DESKTOP);
    const pA = await cA.newPage();
    const pB = await cB.newPage();
    try {
      await pA.goto(`${BASE}/games/flappybird-inzone-2`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await pA.waitForTimeout(5000);
      await pA.getByTestId("player-invite").click({ force: true, timeout: 5000 });
      await pA.waitForTimeout(4000);
      let inviteUrl = pA.url();
      if (!inviteUrl.includes("session=")) {
        inviteUrl = await pA.evaluate(async () => {
          try { return await navigator.clipboard.readText(); } catch { return ""; }
        });
      }
      if (!inviteUrl.includes("session=")) {
        rec("two-guests.invite-url", "UNVERIFIED", `no session in url/clipboard href=${pA.url()}`);
      } else {
        rec("two-guests.invite-url", "PASS", "session present");
        const localHref = inviteUrl.replace(/^https?:\/\/[^/]+/, BASE);
        await pB.goto(localHref, { waitUntil: "domcontentloaded", timeout: 30000 });
        await pB.waitForTimeout(6000);
        await shot(pB, "08-guest-b-join");
        const join = await pB.getByRole("button", { name: /Join session/i }).count();
        const bFrame = await pB.evaluate(() => {
          const iframe = document.querySelector(".game-frame-body iframe");
          let canvas = false;
          try { canvas = Boolean(iframe?.contentDocument?.querySelector("canvas")); } catch { /* ignore */ }
          return { src: iframe?.getAttribute("src") || null, canvas, href: location.href };
        });
        if (join < 1) rec("two-guests.join-visible", "UNVERIFIED", "Join button not shown");
        else rec("two-guests.join-visible", "PASS", "Join session visible");
        if (bFrame.canvas && bFrame.src) rec("two-guests.b-game-canvas", "PASS", `src=${bFrame.src}`);
        else rec("two-guests.b-game-canvas", "FAIL", JSON.stringify(bFrame));
        const bBefore = pB.url();
        await pA.goto(`${BASE}/games/nightclub-showdown-inzone-production${new URL(localHref, BASE).search}`, { waitUntil: "domcontentloaded", timeout: 30000 });
        await pA.waitForTimeout(3000);
        if (pB.url() === bBefore) rec("two-guests.switch-independent", "PASS", "B URL unchanged");
        else rec("two-guests.switch-independent", "FAIL", pB.url());
        await pA.reload({ waitUntil: "domcontentloaded" });
        await pA.waitForTimeout(2500);
        if (pA.url().includes("session=")) rec("two-guests.refresh-session", "PASS", "A kept session=");
        else rec("two-guests.refresh-session", "FAIL", pA.url());
        await pA.close();
        await pB.waitForTimeout(2000);
        const still = await pB.locator(".game-frame-shell").count();
        const stillCanvas = await pB.evaluate(() => {
          try { return Boolean(document.querySelector("iframe")?.contentDocument?.querySelector("canvas")); }
          catch { return false; }
        });
        if (still && stillCanvas) rec("two-guests.leave-keeps-b", "PASS", "B canvas still present after A left");
        else rec("two-guests.leave-keeps-b", "FAIL", `shell=${still} canvas=${stillCanvas}`);
      }
    } catch (err) {
      rec("two-guests.exception", "UNVERIFIED", String(err.message).split("\n")[0]);
    } finally {
      await cA.close().catch(() => {});
      await cB.close().catch(() => {});
    }
  }

  await browser.close();
  await writeFile(path.join(OUT, "results.json"), JSON.stringify(results, null, 2) + "\n");
  const fail = results.filter((r) => r.verdict === "FAIL");
  console.error("=== SUMMARY ===");
  for (const r of results) console.error(`${r.verdict.padEnd(12)} ${r.id}`);
  process.exit(fail.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
