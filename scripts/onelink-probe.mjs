#!/usr/bin/env node
/**
 * Probe AppsFlyer OneLink + store destinations from this environment.
 * Does not claim an installed app opened. Writes shape-only JSON (status,
 * location host/scheme, final store host). No tokens.
 *
 *   node scripts/onelink-probe.mjs
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ONELINK = "https://join-inzone.onelink.me/SACg?af_xp=custom&pid=web_get_app";
const APP_STORE = "https://apps.apple.com/us/app/inzone/id6478089068";
const PLAY_STORE =
  "https://play.google.com/store/apps/details?id=com.aadeshkheria.inzone&hl=en_US";

const UA = {
  desktopSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  desktopChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  ios: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
};

function locationShape(url) {
  try {
    const u = new URL(url);
    return { scheme: u.protocol.replace(":", ""), host: u.host, path: u.pathname };
  } catch {
    const scheme = String(url).split(":")[0] || "unknown";
    return { scheme, host: null, path: null, rawPrefix: String(url).slice(0, 24) };
  }
}

async function fetchOnce(url, { ua, method = "GET", redirect = "manual" }) {
  const res = await fetch(url, {
    method,
    redirect: "manual",
    headers: { "user-agent": ua, accept: "text/html,application/xhtml+xml" },
  });
  const location = res.headers.get("location");
  let title = null;
  let og = null;
  const locShape = location ? locationShape(location) : null;
  const canReadBody =
    redirect === "follow" &&
    !location &&
    (res.headers.get("content-type") || "").includes("text/html");
  if (canReadBody) {
    const html = await res.text();
    title = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1]?.trim() || null;
    og =
      (html.match(/property="og:description"[^>]*content="([^"]+)"/i) ||
        html.match(/content="([^"]+)"[^>]*property="og:description"/i) ||
        [])[1] || null;
  } else {
    await res.arrayBuffer().catch(() => null);
  }
  return {
    status: res.status,
    redirected: false,
    finalUrl: url,
    location: locShape,
    title,
    ogDescription: og ? og.slice(0, 180) : null,
  };
}

async function readHtml(url, ua) {
  const res = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: { "user-agent": ua, accept: "text/html,application/xhtml+xml" },
  });
  const location = res.headers.get("location");
  if (location) {
    return {
      status: res.status,
      finalUrl: url,
      location: locationShape(location),
      title: null,
      ogDescription: null,
    };
  }
  const html = await res.text();
  return {
    status: res.status,
    finalUrl: url,
    location: null,
    title: (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1]?.trim() || null,
    ogDescription:
      (html.match(/property="og:description"[^>]*content="([^"]+)"/i) ||
        html.match(/content="([^"]+)"[^>]*property="og:description"/i) ||
        [])[1]?.slice(0, 180) || null,
  };
}

async function followHttps(url, ua, hops = 8) {
  const chain = [];
  let current = url;
  for (let i = 0; i < hops; i += 1) {
    const step = await fetchOnce(current, { ua, redirect: "manual" });
    chain.push({ urlHost: locationShape(current).host, ...step });
    if (!step.location) {
        const body = step.status >= 200 && step.status < 400
          ? await readHtml(current, ua).catch(() => null)
          : null;
        return { chain, final: body || step, stopped: "no-location" };
    }
    if (step.location.scheme !== "https" && step.location.scheme !== "http") {
      return { chain, final: step, stopped: "non-https-scheme" };
    }
    current = `${step.location.scheme}://${step.location.host}${step.location.path || "/"}`;
  }
  return { chain, final: chain.at(-1), stopped: "max-hops" };
}

async function main() {
  const outDir = "scripts/.hexclave-out/onelink-probe";
  await mkdir(outDir, { recursive: true });
  await mkdir("/opt/cursor/artifacts", { recursive: true });

  const stores = {
    appStore: await readHtml(APP_STORE, UA.desktopChrome),
    playStore: await readHtml(PLAY_STORE, UA.android),
  };
  const onelink = {
    desktopSafari: await followHttps(ONELINK, UA.desktopSafari),
    desktopChrome: await followHttps(ONELINK, UA.desktopChrome),
    ios: await followHttps(ONELINK, UA.ios),
    android: await followHttps(ONELINK, UA.android),
  };

  const report = {
    at: new Date().toISOString(),
    stores: {
      appStore: {
        status: stores.appStore.status,
        title: stores.appStore.title,
        host: locationShape(stores.appStore.finalUrl).host,
      },
      playStore: {
        status: stores.playStore.status,
        title: stores.playStore.title,
        ogDescription: stores.playStore.ogDescription,
        host: locationShape(stores.playStore.finalUrl).host,
      },
    },
    onelink: {
      desktopSafari: {
        stopped: onelink.desktopSafari.stopped,
        hops: onelink.desktopSafari.chain.map((s) => ({
          status: s.status,
          host: s.urlHost,
          location: s.location,
        })),
        finalHost: locationShape(onelink.desktopSafari.final.finalUrl || "").host,
        note: "Safari desktop UA may stay on the OneLink page. That is not an iOS or Android verification.",
      },
      desktopChrome: {
        stopped: onelink.desktopChrome.stopped,
        hops: onelink.desktopChrome.chain.map((s) => ({
          status: s.status,
          host: s.urlHost,
          location: s.location,
        })),
        finalHost: locationShape(onelink.desktopChrome.final.finalUrl || "").host,
        finalTitle: onelink.desktopChrome.final.title || null,
        note: "Chrome desktop GET follows to the Apple App Store. That does not verify iOS or Android.",
      },
      ios: {
        stopped: onelink.ios.stopped,
        hops: onelink.ios.chain.map((s) => ({
          status: s.status,
          host: s.urlHost,
          location: s.location,
        })),
        finalHost: locationShape(onelink.ios.final.finalUrl || "").host,
        finalTitle: onelink.ios.final.title || null,
      },
      android: {
        stopped: onelink.android.stopped,
        hops: onelink.android.chain.map((s) => ({
          status: s.status,
          host: s.urlHost,
          location: s.location,
        })),
        nonHttpsScheme: onelink.android.final?.location?.scheme || null,
        note: "A non-https Location is evidence of a mobile deep link, not that an installed app opened.",
      },
    },
  };

  const json = JSON.stringify(report, null, 2) + "\n";
  await writeFile(path.join(outDir, "results.json"), json);
  await writeFile("/opt/cursor/artifacts/onelink_probe.json", json);
  console.log(json);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
