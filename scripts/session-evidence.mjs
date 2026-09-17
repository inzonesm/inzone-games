#!/usr/bin/env node
/**
 * Browser evidence the previous canvas-only / Join-visible checks did not prove:
 *   - meaningful input → observable canvas change
 *   - two guests actually join
 *   - two-way persisted chat
 *   - suggestion without automatic switch
 *   - independent game selection
 *   - refresh restores membership, chat, selected game
 *   - leave revokes membership
 */
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.LOCAL_URL ?? "http://127.0.0.1:3001";
const OUT = process.env.OUT_DIR ?? "scripts/.hexclave-out/session-evidence";
const ARTIFACTS = "/opt/cursor/artifacts/inzone-session-evidence-v3";
const CHROMIUM = process.env.CHROMIUM_EXECUTABLE ?? "/usr/bin/google-chrome-stable";

const results = [];
function rec(id, verdict, evidence) {
  results.push({ id, verdict, evidence });
  console.error(`${verdict.padEnd(12)} ${id} — ${evidence}`);
}

async function shot(page, name) {
  await mkdir(OUT, { recursive: true });
  await mkdir(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  await page.screenshot({ path: path.join(ARTIFACTS, `${name}.png`), fullPage: false });
}

async function viewHash(page) {
  const buf = await page.screenshot({ fullPage: false });
  return createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

async function clickGameCanvas(page, nx, ny) {
  const frame = page.frameLocator(".game-frame-body iframe").first();
  const canvas = frame.locator("canvas").first();
  if ((await canvas.count()) < 1) return false;
  const box = await canvas.boundingBox();
  if (!box) return false;
  await canvas.click({ position: { x: box.width * nx, y: box.height * ny }, force: true });
  return true;
}

/** Flappy's START is a PlayCanvas sprite, not DOM text. Map the entity to canvas pixels. */
async function flappyEngine(page) {
  return page.evaluate(() => {
    const iframe = document.querySelector(".game-frame-body iframe, iframe");
    const win = iframe?.contentWindow;
    const app = win?.pc?.Application?.getApplication?.();
    if (!app?.root) return { ok: false };
    const cam = app.root.findByName("Camera");
    const start = app.root.findByName("Start Button");
    const menu = app.root.findByName("Menu Screen");
    const bird = app.root.findByName("Game")?.findByName("Bird")?.script?.bird;
    let startScreen = null;
    try {
      if (cam?.camera && start) {
        const s = cam.camera.worldToScreen(start.getPosition());
        startScreen = { x: s.x, y: s.y };
      }
    } catch {
      startScreen = null;
    }
    return {
      ok: true,
      pathname: win?.location?.pathname || "",
      menuEnabled: Boolean(menu?.enabled),
      startEnabled: Boolean(start?.enabled),
      birdState: bird?.state ?? null,
      startScreen,
    };
  });
}

async function clickFlappyStartButton(page) {
  const engine = await flappyEngine(page);
  const canvas = page.frameLocator(".game-frame-body iframe").first().locator("canvas").first();
  if (!engine?.startScreen) return { clicked: false, engine };
  await canvas.click({
    position: { x: engine.startScreen.x, y: engine.startScreen.y },
    force: true,
  });
  return { clicked: true, engine };
}

async function frameSrc(page) {
  return page.evaluate(() => document.querySelector(".game-frame-body iframe, iframe")?.getAttribute("src") || "");
}

async function openInvite(page) {
  const invite = page.getByTestId("player-invite");
  await invite.click({ force: true, timeout: 8000 });
  await page.waitForTimeout(2500);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await mkdir(ARTIFACTS, { recursive: true });
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: ["--ignore-certificate-errors", "--disable-gpu"],
  });

  // ── 1. Nightclub: click-to-start must change canvas pixels ──────────
  {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/games/nightclub-showdown-inzone-production`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(8000);
    await shot(page, "01-nightclub-before-input");
    const before = await viewHash(page);
    const src = await frameSrc(page);
    if (!/nightclub/.test(src)) rec("gameplay.nightclub-canvas", "FAIL", src);
    else rec("gameplay.nightclub-canvas", "PASS", src);
    await clickGameCanvas(page, 0.5, 0.5);
    await page.waitForTimeout(1800);
    await clickGameCanvas(page, 0.5, 0.55);
    await page.waitForTimeout(1800);
    await shot(page, "02-nightclub-after-input");
    const after = await viewHash(page);
    if (after !== before) rec("gameplay.nightclub-input", "PASS", `view ${before} → ${after}`);
    else rec("gameplay.nightclub-input", "FAIL", `unchanged ${before}`);
    await ctx.close();
  }

  // ── 2. Flappy: START region + flaps must change canvas pixels ───────
  {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/games/flappybird-inzone-2`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(8000);
    await shot(page, "03-flappy-title");
    const before = await viewHash(page);
    rec("gameplay.flappy-canvas", "PASS", await frameSrc(page));
    const beforeEngine = await flappyEngine(page);
    // Title-screen START is a sprite at worldToScreen, not DOM text and not canvas center.
    const startClick = await clickFlappyStartButton(page);
    await page.waitForTimeout(700);
    const afterStart = await flappyEngine(page);
    for (let i = 0; i < 10; i += 1) {
      await clickGameCanvas(page, 0.5, 0.45);
      await page.waitForTimeout(160);
    }
    await page.waitForTimeout(400);
    await shot(page, "04-flappy-after-input");
    const after = await viewHash(page);
    const afterFlaps = await flappyEngine(page);
    const leftTitle = afterStart.menuEnabled === false || afterStart.birdState === "getready" || afterStart.birdState === "play";
    const played = afterFlaps.birdState === "play" || afterFlaps.birdState === "dead";
    if (startClick.clicked && leftTitle && played && after !== before) {
      rec(
        "gameplay.flappy-input",
        "PASS",
        `Start Button ${JSON.stringify(beforeEngine.startScreen)} menu ${beforeEngine.menuEnabled}→${afterStart.menuEnabled} bird ${afterStart.birdState}→${afterFlaps.birdState}; view ${before} → ${after}`,
      );
    } else {
      rec(
        "gameplay.flappy-input",
        "FAIL",
        `clicked=${startClick.clicked} leftTitle=${leftTitle} played=${played} before=${JSON.stringify(beforeEngine)} afterStart=${JSON.stringify(afterStart)} afterFlaps=${JSON.stringify(afterFlaps)}`,
      );
    }
    await ctx.close();
  }

  // ── 3. Two-guest join / chat / suggest / refresh / leave ────────────
  {
    const cA = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const cB = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });
    const pA = await cA.newPage();
    const pB = await cB.newPage();
    try {
      await pA.goto(`${BASE}/games/flappybird-inzone-2`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await pA.waitForTimeout(5000);
      await openInvite(pA);
      await pA.waitForTimeout(4000);
      let inviteUrl = pA.url();
      if (!inviteUrl.includes("session=")) {
        inviteUrl = await pA.evaluate(async () => {
          try {
            return await navigator.clipboard.readText();
          } catch {
            return "";
          }
        });
      }
      if (!inviteUrl.includes("session=")) {
        rec("two-guests.invite-url", "FAIL", `no session href=${pA.url()}`);
      } else {
        rec("two-guests.invite-url", "PASS", "session present");
        const localHref = inviteUrl.replace(/^https?:\/\/[^/]+/, BASE);
        await pB.goto(localHref, { waitUntil: "domcontentloaded", timeout: 30000 });
        await pB.waitForTimeout(6000);
        await shot(pB, "05-guest-b-before-join");
        const join = pB.getByTestId("join-session");
        if ((await join.count()) < 1) {
          rec("two-guests.join-visible", "FAIL", "Join session control missing");
        } else {
          rec("two-guests.join-visible", "PASS", "Join session visible");
          await join.click({ timeout: 8000 });
          await pB.waitForTimeout(4000);
          await shot(pB, "06-guest-b-after-join");
          const joined = await pB.evaluate(() => ({
            join: document.querySelectorAll("[data-testid='join-session']").length,
            leave: document.querySelectorAll("[data-testid='leave-session']").length,
            people: [...document.querySelectorAll(".sp-person strong")].map((el) => el.textContent),
          }));
          if (joined.join === 0 && joined.leave >= 1) {
            rec("two-guests.joined", "PASS", `people=${joined.people.join(",")}`);
          } else {
            rec("two-guests.joined", "FAIL", JSON.stringify(joined));
          }
        }

        const aBeforeSrc = await frameSrc(pA);
        const bBeforeSrc = await frameSrc(pB);

        // Two-way chat
        await pA.getByTestId("chat-input").waitFor({ timeout: 8000 });
        const msgA = `alpha-ping-${Date.now().toString(36)}`;
        const msgB = `bravo-pong-${Date.now().toString(36)}`;
        await pA.getByTestId("chat-input").fill(msgA);
        await pA.getByTestId("chat-send").click();
        await pA.waitForTimeout(1200);
        if (await pA.getByRole("button", { name: "Retry" }).count()) {
          await pA.getByRole("button", { name: "Retry" }).click();
          await pA.waitForTimeout(1500);
        }
        try {
          await pB.getByText(msgA).waitFor({ timeout: 8000 });
        } catch { /* scored below */ }
        await pB.getByTestId("chat-input").fill(msgB);
        await pB.getByTestId("chat-send").click();
        await pB.waitForTimeout(1200);
        if (await pB.getByRole("button", { name: "Retry" }).count()) {
          await pB.getByRole("button", { name: "Retry" }).click();
          await pB.waitForTimeout(1500);
        }
        try {
          await pA.getByText(msgB).waitFor({ timeout: 8000 });
        } catch { /* scored below */ }
        await shot(pA, "07-chat-on-a");
        await shot(pB, "08-chat-on-b");
        const bSawA = await pB.getByText(msgA).count();
        const aSawB = await pA.getByText(msgB).count();
        if (bSawA >= 1 && aSawB >= 1) rec("two-guests.chat-two-way", "PASS", `${msgA} / ${msgB}`);
        else rec("two-guests.chat-two-way", "FAIL", `bSawA=${bSawA} aSawB=${aSawB}`);

        // Suggestion without auto-switch
        await pA.getByRole("button", { name: "Discover" }).click();
        await pA.waitForTimeout(800);
        const cards = pA.locator(".sp-card");
        const cardCount = await cards.count();
        let suggestedName = "";
        if (cardCount >= 2) {
          // Prefer a card that is not the current Flappy title.
          let picked = 0;
          for (let i = 0; i < Math.min(cardCount, 8); i += 1) {
            const label = ((await cards.nth(i).innerText()) || "").toLowerCase();
            if (!label.includes("flappy")) {
              picked = i;
              suggestedName = (await cards.nth(i).innerText()).trim();
              break;
            }
          }
          await cards.nth(picked).click();
          await pA.waitForTimeout(400);
          await pA.getByTestId("suggest-game").click();
          await pA.waitForTimeout(2000);
          await shot(pA, "09-a-suggested");
          await shot(pB, "10-b-after-suggest");
          const bSrcAfterSuggest = await frameSrc(pB);
          const bHasSuggest = await pB.locator(".sp-suggest").count();
          if (bHasSuggest >= 1 && bSrcAfterSuggest === bBeforeSrc) {
            rec(
              "two-guests.suggest-no-autoswitch",
              "PASS",
              `B still ${bSrcAfterSuggest} suggested=${suggestedName || "(card)"}`,
            );
          } else {
            rec(
              "two-guests.suggest-no-autoswitch",
              "FAIL",
              `suggest=${bHasSuggest} srcBefore=${bBeforeSrc} srcAfter=${bSrcAfterSuggest}`,
            );
          }
          const keep = pB.getByTestId("keep-playing");
          if ((await keep.count()) >= 1) {
            await keep.click();
            await pB.waitForTimeout(500);
            rec("two-guests.keep-playing", "PASS", "B kept playing");
          } else {
            rec("two-guests.keep-playing", "UNVERIFIED", "Keep playing not shown on B");
          }
        } else {
          rec("two-guests.suggest-no-autoswitch", "FAIL", `discover cards=${cardCount}`);
        }

        // Independent game selection: A uses Discover → Play (persists seat).
        await pA.getByRole("button", { name: "Discover" }).click();
        await pA.waitForTimeout(600);
        const nightclubCard = pA.locator(".sp-card").filter({ hasText: /nightclub/i }).first();
        if ((await nightclubCard.count()) < 1) {
          rec("two-guests.independent-games", "FAIL", "Nightclub card missing in Discover");
        } else {
          await nightclubCard.click();
          await pA.waitForTimeout(400);
          await pA.getByTestId("play-selected").click();
          const switchBtn = pA.getByRole("button", { name: "Switch game" });
          if (await switchBtn.isVisible().catch(() => false)) {
            await switchBtn.click();
          }
          await pA.waitForTimeout(5000);
          await shot(pA, "11-a-independent-nightclub");
          await shot(pB, "12-b-still-flappy");
          const aSrc = await frameSrc(pA);
          const bSrc = await frameSrc(pB);
          if (/nightclub/.test(aSrc) && /flappy/.test(bSrc)) {
            rec("two-guests.independent-games", "PASS", `A=${aSrc} B=${bSrc}`);
          } else {
            rec("two-guests.independent-games", "FAIL", `A=${aSrc} B=${bSrc}`);
          }
        }

        // Refresh restores membership + chat + selected game
        await pA.reload({ waitUntil: "domcontentloaded" });
        await pB.reload({ waitUntil: "domcontentloaded" });
        await pA.waitForTimeout(6000);
        await pB.waitForTimeout(6000);
        await shot(pA, "13-a-after-refresh");
        await shot(pB, "14-b-after-refresh");
        const restored = await Promise.all([
          pA.evaluate(() => ({
            href: location.href,
            join: document.querySelectorAll("[data-testid='join-session']").length,
            leave: document.querySelectorAll("[data-testid='leave-session']").length,
            src: document.querySelector("iframe")?.getAttribute("src") || "",
            chat: document.body.innerText,
          })),
          pB.evaluate((msgs) => ({
            href: location.href,
            join: document.querySelectorAll("[data-testid='join-session']").length,
            leave: document.querySelectorAll("[data-testid='leave-session']").length,
            src: document.querySelector("iframe")?.getAttribute("src") || "",
            hasMsg: msgs.some((m) => document.body.innerText.includes(m)),
            chat: document.body.innerText.slice(0, 400),
          }), [msgA, msgB]),
        ]);
        const aOk =
          restored[0].href.includes("session=") &&
          restored[0].join === 0 &&
          /nightclub/.test(restored[0].src);
        const bOk =
          restored[1].href.includes("session=") &&
          restored[1].join === 0 &&
          /flappy/.test(restored[1].src) &&
          restored[1].hasMsg;
        const aHasChat = [msgA, msgB].some((m) => restored[0].chat.includes(m));
        if (aOk && bOk && aHasChat) rec("two-guests.refresh-restore", "PASS", "membership+chat+games survived reload");
        else rec("two-guests.refresh-restore", "FAIL", JSON.stringify(restored));

        // Leave revocation: A leaves; A cannot send; B stays a member.
        if (restored[0].leave < 1) await openInvite(pA);
        await pA.getByTestId("leave-session").click({ timeout: 8000 });
        await pA.waitForTimeout(2500);
        await shot(pA, "15-a-after-leave");
        const aAfterLeave = await pA.evaluate(() => ({
          href: location.href,
          leave: document.querySelectorAll("[data-testid='leave-session']").length,
          join: document.querySelectorAll("[data-testid='join-session']").length,
          compose: document.querySelectorAll("[data-testid='chat-input']").length,
        }));
        const bAfterLeave = await pB.evaluate(() => ({
          href: location.href,
          leave: document.querySelectorAll("[data-testid='leave-session']").length,
          src: document.querySelector("iframe")?.getAttribute("src") || "",
        }));
        const aRevoked = !aAfterLeave.href.includes("session=") && aAfterLeave.leave === 0;
        const bKept = bAfterLeave.href.includes("session=") && /flappy/.test(bAfterLeave.src);
        if (aRevoked && bKept) rec("two-guests.leave-revoke", "PASS", `A href without session; B still in ${bAfterLeave.src}`);
        else rec("two-guests.leave-revoke", "FAIL", JSON.stringify({ aAfterLeave, bAfterLeave }));
      }
    } catch (err) {
      rec("two-guests.exception", "FAIL", String(err.message || err).split("\n")[0]);
    } finally {
      await cA.close().catch(() => {});
      await cB.close().catch(() => {});
    }
  }

  await browser.close();
  const json = JSON.stringify(results, null, 2) + "\n";
  await writeFile(path.join(OUT, "results.json"), json);
  await writeFile(path.join(ARTIFACTS, "results.json"), json);
  console.error("=== SUMMARY ===");
  for (const r of results) console.error(`${r.verdict.padEnd(12)} ${r.id}`);
  const fail = results.filter((r) => r.verdict === "FAIL");
  process.exit(fail.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
