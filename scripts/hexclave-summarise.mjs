#!/usr/bin/env node
// Turn raw rrweb events under scripts/.hexclave-out/<sessionReplayId>/ into a
// per-replay friction timeline. Reads events-0.json (as written by
// hexclave-inspect.mjs), reduces to a compact summary — categorised event
// counts, viewport, landing URL + UTM, first-load / first-interaction ms,
// idle gaps ≥3 s — and writes findings.jsonl next to list.json.
//
// This is descriptive only; it does not classify a session as "engaged" or
// "bounced." It reports "recorded activity duration" (lastEventAt − startedAt
// per rrweb) and the categorised counts. It does NOT tag rage-click frustration
// on iframe-container clicks: gameplay taps that fall within the parent's
// pointer stream registered against the iframe DOM node get counted separately
// under `iframeContainerClicks`.
//
// rrweb event types:
//   0 DomContentLoaded, 1 Load, 2 FullSnapshot, 3 IncrementalSnapshot,
//   4 Meta, 5 Custom, 6 Plugin
// IncrementalSnapshot data.source:
//   0 Mutation, 1 MouseMove, 2 MouseInteraction, 3 Scroll, 4 ViewportResize,
//   5 Input, 6 TouchMove, 7 MediaInteraction, 8 StyleSheetRule,
//   9 CanvasMutation, 10 Font, 11 Log, 12 Drag, 13 StyleDeclaration,
//   14 Selection, 15 AdoptedStyleSheet
// MouseInteraction data.type:
//   0 MouseUp, 1 MouseDown, 2 Click, 3 ContextMenu, 4 DblClick, 5 Focus,
//   6 Blur, 7 TouchStart, 8 TouchEnd, 9 TouchCancel, 10 TouchMove
//
// Usage:
//   node scripts/hexclave-summarise.mjs [--out-dir scripts/.hexclave-out]

import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const OUT = process.argv.includes("--out-dir")
  ? process.argv[process.argv.indexOf("--out-dir") + 1]
  : "scripts/.hexclave-out";

function isUuid(name) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name);
}

async function loadEvents(id) {
  const raw = JSON.parse(await readFile(path.join(OUT, id, "events-0.json"), "utf8"));
  const chunks = raw.chunkEvents ?? {};
  const events = [];
  for (const key of Object.keys(chunks)) {
    for (const e of chunks[key].events ?? []) events.push(e);
  }
  events.sort((a, b) => a.timestamp - b.timestamp);
  return events;
}

function extractUtm(url) {
  try {
    const q = new URL(url).searchParams;
    return {
      source: q.get("utm_source"),
      medium: q.get("utm_medium"),
      campaign: q.get("utm_campaign"),
      content: q.get("utm_content"),
      fbclid: q.get("fbclid") ? "yes" : null,
    };
  } catch { return {}; }
}

function analyseReplay(id, events) {
  if (events.length === 0) return { id, empty: true };
  const t0 = events[0].timestamp;
  const durationMs = events[events.length - 1].timestamp - t0;

  const metas = events.filter((e) => e.type === 4);
  const routes = metas.map((m) => ({ tMs: m.timestamp - t0, href: m.data?.href }));
  const firstMeta = metas[0];
  const landing = firstMeta?.data?.href ?? null;

  const cats = { load: 0, dom: 0, full: 0, meta: 0, custom: 0, mutation: 0,
    mouseMove: 0, mouseDown: 0, click: 0, touchStart: 0, touchEnd: 0,
    scroll: 0, resize: 0, input: 0, canvasMut: 0, other: 0 };
  const interactions = [];
  const iframeIds = new Set();
  let firstFullSnapMs = null;
  let firstLoadMs = null;
  for (const e of events) {
    if (e.type === 1) { cats.load++; firstLoadMs ??= e.timestamp - t0; }
    else if (e.type === 0) cats.dom++;
    else if (e.type === 2) { cats.full++; firstFullSnapMs ??= e.timestamp - t0; }
    else if (e.type === 4) cats.meta++;
    else if (e.type === 5) cats.custom++;
    else if (e.type === 3) {
      const src = e.data?.source;
      const sub = e.data?.type;
      if (src === 0) cats.mutation++;
      else if (src === 1) cats.mouseMove++;
      else if (src === 2) {
        if (sub === 1) { cats.mouseDown++; interactions.push({ t: e.timestamp - t0, kind: "mousedown", x: e.data.x, y: e.data.y, id: e.data.id }); }
        else if (sub === 2) { cats.click++; interactions.push({ t: e.timestamp - t0, kind: "click", x: e.data.x, y: e.data.y, id: e.data.id }); }
        else if (sub === 7) { cats.touchStart++; interactions.push({ t: e.timestamp - t0, kind: "touchstart", x: e.data.x, y: e.data.y, id: e.data.id }); }
        else if (sub === 8) { cats.touchEnd++; interactions.push({ t: e.timestamp - t0, kind: "touchend", x: e.data.x, y: e.data.y, id: e.data.id }); }
        else cats.other++;
      }
      else if (src === 3) cats.scroll++;
      else if (src === 4) cats.resize++;
      else if (src === 5) cats.input++;
      else if (src === 9) cats.canvasMut++;
      else cats.other++;
    }
  }

  const firstInteractionMs = interactions[0]?.t ?? null;

  // Idle gaps ≥3 s where no user input occurred in between
  const gaps = [];
  for (let i = 1; i < events.length; i++) {
    const dt = events[i].timestamp - events[i - 1].timestamp;
    if (dt >= 3000) gaps.push({ startMs: events[i - 1].timestamp - t0, dtMs: dt });
  }

  // Cluster interactions by target DOM id: a target with many mousedown/click
  // pairs at nearly the same coord is almost certainly an iframe container
  // absorbing gameplay taps, not a rage-clicked button.
  const perId = new Map();
  for (const i of interactions) {
    const arr = perId.get(i.id) ?? [];
    arr.push(i);
    perId.set(i.id, arr);
  }
  const topTargets = [...perId.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5)
    .map(([id, arr]) => ({
      id,
      count: arr.length,
      sampleCoord: [arr[0].x, arr[0].y],
      spanMs: arr[arr.length - 1].t - arr[0].t,
    }));
  const dominantId = topTargets[0]?.id;
  const iframeContainerClicks = dominantId != null && topTargets[0].count >= 30 ? topTargets[0].count : 0;

  return {
    id,
    recordedActivityMs: durationMs,
    eventCount: events.length,
    landing: landing?.slice(0, 200),
    utm: landing ? extractUtm(landing) : {},
    routeChanges: routes.length,
    firstLoadMs,
    firstFullSnapMs,
    firstInteractionMs,
    counts: cats,
    interactions: interactions.length,
    idleGapsGe3s: gaps.length,
    idleGapsSample: gaps.slice(0, 5),
    topTargets,
    iframeContainerClicks,
  };
}

async function main() {
  const entries = await readdir(OUT).catch(() => []);
  const findings = [];
  for (const name of entries) {
    if (!isUuid(name)) continue;
    try {
      const st = await stat(path.join(OUT, name, "events-0.json"));
      if (!st.isFile()) continue;
    } catch { continue; }
    try {
      const events = await loadEvents(name);
      findings.push(analyseReplay(name, events));
    } catch (e) {
      findings.push({ id: name, error: String(e).slice(0, 200) });
    }
  }
  findings.sort((a, b) => (b.recordedActivityMs ?? 0) - (a.recordedActivityMs ?? 0));
  const out = path.join(OUT, "findings.jsonl");
  await writeFile(out, findings.map((f) => JSON.stringify(f)).join("\n") + "\n", "utf8");
  console.error(`[summarise] ${findings.length} replays → ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
