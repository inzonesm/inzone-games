#!/usr/bin/env node
// Read-only Hexclave session-replay retrieval for the InZone production project.
//
// This script wraps `hexclave exec --cloud-project-id <UUID>` with the four
// server-app methods documented on `hexclaveServerApp`:
//   - listSessionReplays(options?)
//   - getSessionReplay(sessionReplayId)
//   - listSessionReplayChunks(sessionReplayId, options?)
//   - getSessionReplayEvents(sessionReplayId, { offset?, limit? })
//
// The CLI's `exec --cloud-project-id` path requires an interactive OAuth login
// (see node_modules/@hexclave/cli/src/commands/exec.ts): running `hexclave
// login` and completing the browser flow. It is incompatible with
// HEXCLAVE_SECRET_SERVER_KEY / STACK_SECRET_SERVER_KEY; both must be unset. We
// enforce that here rather than let the CLI fail on the seventh call.
//
// Analysis procedure (executed per representative sample):
//   1. list  -> writes list.json (metadata for up to --list-limit replays)
//   2. From list.json pick the sample. Default sample = the first
//      --sample-size replays. Filters for anonymous / mobile / abandoned /
//      completed pass through --filter (see below).
//   3. For each sampled id:
//        a. getSessionReplay              -> <id>/replay.json
//        b. listSessionReplayChunks       -> <id>/chunks.json
//        c. getSessionReplayEvents (page) -> <id>/events-<offset>.json
//   4. summarise.mjs (separate step, added when data is in hand) turns each
//      replay's events into a friction timeline: rage-clicks, dead-clicks,
//      long-idle before first meaningful action, iframe blank periods,
//      route abandonment, mobile-viewport thrash. Findings are written back
//      to <out-dir>/findings.jsonl for human review.
//
// Output layout:
//   <out-dir>/
//     list.json
//     classifications.json     (one row per sampled replay, per lib/qa-traffic.ts)
//     <sessionReplayId>/
//       replay.json
//       chunks.json
//       events-0.json
//       events-1000.json  (if paginated)
//
// The output directory is git-ignored (see .gitignore: scripts/.hexclave-out/).
//
// Nothing this script does mutates the Hexclave project. Every call is a read.
// It does not touch Firebase, Firestore rules, billing, or ad account state.
//
// Classification uses lib/qa-traffic.ts::classifyReportRow — the same policy the
// daily product report enforces. This script must never reimplement the
// production / preview / marked-QA / historical-id decision; it must call the
// policy so a change to the policy propagates here for free. See
// docs/qa-traffic-policy.md for the buckets and their semantics. A row bucketed
// as `customer` means production, unmarked, and not on the historical QA list —
// it does NOT mean a human visitor.
//
// Preconditions:
//   HEXCLAVE_PROJECT_ID   set to the production InZone project UUID.
//   HEXCLAVE_SECRET_SERVER_KEY / STACK_SECRET_SERVER_KEY   unset.
//   `hexclave login` already completed in this shell (the CLI stores the
//      refresh token in ~/.config/hexclave; verify with `hexclave whoami`).
//   Outbound HTTPS to *.hexclave.com allowed by the environment's network
//      policy. Without that, the CLI fails at CONNECT (403) and no login or
//      exec call can complete.
//   HEXCLAVE_QA_USER_IDS  optional; comma-separated user_ids to also treat as
//      diagnostic per the policy's historical-id list. Read the same way
//      scripts/daily-product-report.mjs reads it.
//
// Usage:
//   node scripts/hexclave-inspect.mjs \
//     [--list-limit 100] \
//     [--sample-size 8] \
//     [--events-page-limit 1000] \
//     [--out-dir scripts/.hexclave-out]
//   node scripts/hexclave-inspect.mjs --reclassify [--out-dir scripts/.hexclave-out]
//     Re-runs classification against replays already on disk. No network. Uses
//     each replay's own events-0.json (if present) for the URL; entries without
//     one classify as `unknown` per policy, which the report treats as
//     diagnostic.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { classifyReportRow, trafficKindFromHref } from "../lib/qa-traffic.ts";

const DEFAULTS = {
  listLimit: 100,
  sampleSize: 8,
  eventsPageLimit: 1000,
  outDir: "scripts/.hexclave-out",
  reclassify: false,
};

function parseArgs(argv) {
  const out = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--list-limit") out.listLimit = Number(next());
    else if (a === "--sample-size") out.sampleSize = Number(next());
    else if (a === "--events-page-limit") out.eventsPageLimit = Number(next());
    else if (a === "--out-dir") out.outDir = next();
    else if (a === "--reclassify") out.reclassify = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: node scripts/hexclave-inspect.mjs [--list-limit N] [--sample-size N] [--events-page-limit N] [--out-dir PATH]\n" +
          "       node scripts/hexclave-inspect.mjs --reclassify [--out-dir PATH]",
      );
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function assertPreconditions() {
  const projectId = process.env.HEXCLAVE_PROJECT_ID;
  if (!projectId) {
    console.error(
      "HEXCLAVE_PROJECT_ID is not set. Point it at the production InZone project UUID (same value the Vercel production env holds) and retry.",
    );
    process.exit(1);
  }
  for (const key of ["HEXCLAVE_SECRET_SERVER_KEY", "STACK_SECRET_SERVER_KEY"]) {
    if (process.env[key]) {
      console.error(
        `${key} is set. The --cloud-project-id exec path requires the OAuth refresh-token flow (hexclave login) and rejects when a server key is present. Unset ${key} in this shell and retry.`,
      );
      process.exit(1);
    }
  }
  return { projectId };
}

// Runs `hexclave exec --cloud-project-id <id> "<js>"` and returns the parsed
// JSON printed on stdout. `js` runs as an async function body with
// `hexclaveServerApp` in scope; whatever it returns is JSON.stringify'd by the
// CLI. Empty stdout is returned as null so callers can distinguish "no result".
function execHexclave({ projectId, js }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      ["--no-install", "hexclave", "exec", "--cloud-project-id", projectId, js],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `hexclave exec exited with code ${code}. stderr:\n${stderr.trim() || "(empty)"}`,
          ),
        );
        return;
      }
      const trimmed = stdout.trim();
      if (trimmed === "") {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(trimmed));
      } catch (err) {
        reject(
          new Error(
            `hexclave exec produced non-JSON stdout: ${err.message}\n---stdout---\n${stdout}\n---stderr---\n${stderr}`,
          ),
        );
      }
    });
  });
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function listReplays({ projectId, listLimit }) {
  return execHexclave({
    projectId,
    js: `return await hexclaveServerApp.listSessionReplays({ limit: ${listLimit} });`,
  });
}

async function getReplay({ projectId, id }) {
  return execHexclave({
    projectId,
    js: `return await hexclaveServerApp.getSessionReplay(${JSON.stringify(id)});`,
  });
}

async function listChunks({ projectId, id }) {
  return execHexclave({
    projectId,
    js: `return await hexclaveServerApp.listSessionReplayChunks(${JSON.stringify(id)});`,
  });
}

async function getEvents({ projectId, id, offset, limit }) {
  return execHexclave({
    projectId,
    js: `return await hexclaveServerApp.getSessionReplayEvents(${JSON.stringify(id)}, { offset: ${offset}, limit: ${limit} });`,
  });
}

function extractReplayList(listResult) {
  if (Array.isArray(listResult)) return listResult;
  if (listResult && Array.isArray(listResult.items)) return listResult.items;
  if (listResult && Array.isArray(listResult.replays)) return listResult.replays;
  throw new Error(
    `Unexpected listSessionReplays shape. Expected an array or an object with items/replays; got ${JSON.stringify(
      Object.keys(listResult ?? {}),
    )}. Update extractReplayList once the real shape is confirmed against production.`,
  );
}

function pickId(entry) {
  return entry?.id ?? entry?.session_replay_id ?? entry?.sessionReplayId ?? null;
}

/** Same env-var shape scripts/daily-product-report.mjs uses. */
export function readHistoricalQaUserIds(env = process.env) {
  return (env.HEXCLAVE_QA_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** First Meta event's href from a getSessionReplayEvents page, or null. */
export function extractFirstMetaHref(eventsPage) {
  const events = eventsPage?.chunkEvents
    ? Object.values(eventsPage.chunkEvents).flatMap((c) => c?.events ?? [])
    : Array.isArray(eventsPage?.events)
      ? eventsPage.events
      : Array.isArray(eventsPage)
        ? eventsPage
        : [];
  if (events.length === 0) return null;
  const sorted = [...events].sort(
    (a, b) => (a?.timestamp ?? 0) - (b?.timestamp ?? 0),
  );
  const meta = sorted.find((e) => e?.type === 4);
  return meta?.data?.href ?? null;
}

function extractLegacyUtms(url) {
  if (!url) return { utm_medium: null, utm_content: null };
  try {
    const params = new URL(url).searchParams;
    return {
      utm_medium: params.get("utm_medium"),
      utm_content: params.get("utm_content"),
    };
  } catch {
    return { utm_medium: null, utm_content: null };
  }
}

/**
 * Classify one replay entry + first URL under the shared policy. Returns the
 * verdict from lib/qa-traffic.ts::classifyReportRow plus the replay id and
 * user_id so a caller can group by them. This wrapper adds no rules of its
 * own — every classification decision is delegated. A `customer` bucket means
 * "production, unmarked, and not on the historical QA list" and does not
 * establish that the row is a human visitor.
 */
export function classifyReplayEntry({ entry, url, historicalQaUserIds }) {
  const userId = entry?.projectUser?.id ?? null;
  const legacy = extractLegacyUtms(url);
  const verdict = classifyReportRow(
    {
      url: url ?? null,
      traffic_kind: trafficKindFromHref(url),
      utm_medium: legacy.utm_medium,
      utm_content: legacy.utm_content,
      user_id: userId,
    },
    historicalQaUserIds || [],
  );
  return {
    id: entry?.id ?? null,
    userId,
    url: url ?? null,
    ...verdict,
  };
}

function summariseClassifications(rows) {
  const byBucket = {};
  const byAppEnv = {};
  const byReason = {};
  for (const r of rows) {
    byBucket[r.bucket] = (byBucket[r.bucket] ?? 0) + 1;
    byAppEnv[r.appEnv] = (byAppEnv[r.appEnv] ?? 0) + 1;
    byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
  }
  return { total: rows.length, byBucket, byAppEnv, byReason };
}

function printClassificationSummary(rows) {
  const s = summariseClassifications(rows);
  console.log(
    `[hexclave-inspect] classified ${s.total} replay(s) via lib/qa-traffic.ts::classifyReportRow`,
  );
  console.log("  bucket:", JSON.stringify(s.byBucket));
  console.log("  appEnv:", JSON.stringify(s.byAppEnv));
  console.log("  reason:", JSON.stringify(s.byReason));
  console.log(
    "  NOTE: 'customer' is the policy bucket (production, unmarked, not on the historical QA list). It does NOT establish that the row is a human visitor.",
  );
}

async function readOnDisk(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function loadFirstUrlFromDisk(replayDir) {
  const eventsPath = path.join(replayDir, "events-0.json");
  if (!existsSync(eventsPath)) return null;
  try {
    return extractFirstMetaHref(await readOnDisk(eventsPath));
  } catch {
    return null;
  }
}

async function reclassifyFromDisk(outDir, historicalQaUserIds) {
  const listPath = path.join(outDir, "list.json");
  if (!existsSync(listPath)) {
    throw new Error(
      `--reclassify: ${listPath} not found. Run a pull first, or point --out-dir at an existing sample.`,
    );
  }
  const replayList = extractReplayList(await readOnDisk(listPath));
  const rows = [];
  for (const entry of replayList) {
    const id = pickId(entry);
    if (!id) continue;
    const url = await loadFirstUrlFromDisk(path.join(outDir, id));
    rows.push(classifyReplayEntry({ entry, url, historicalQaUserIds }));
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(args.outDir);
  const historicalQaUserIds = readHistoricalQaUserIds();

  if (args.reclassify) {
    console.log(`[hexclave-inspect] --reclassify: reading sample under ${outDir}`);
    const rows = await reclassifyFromDisk(outDir, historicalQaUserIds);
    await writeJson(path.join(outDir, "classifications.json"), rows);
    printClassificationSummary(rows);
    return;
  }

  const { projectId } = assertPreconditions();
  await mkdir(outDir, { recursive: true });

  console.log(`[hexclave-inspect] listing up to ${args.listLimit} replays ...`);
  const listResult = await listReplays({ projectId, listLimit: args.listLimit });
  await writeJson(path.join(outDir, "list.json"), listResult);

  const replayList = extractReplayList(listResult);
  console.log(`[hexclave-inspect] received ${replayList.length} replay entries`);

  const sample = replayList.slice(0, args.sampleSize);
  const classifications = [];
  for (const entry of sample) {
    const id = pickId(entry);
    if (!id) {
      console.warn(
        "[hexclave-inspect] skipping entry with no recognisable id:",
        JSON.stringify(entry),
      );
      continue;
    }
    console.log(`[hexclave-inspect] pulling replay ${id} ...`);
    const replayDir = path.join(outDir, id);
    await mkdir(replayDir, { recursive: true });

    const [metadata, chunks] = await Promise.all([
      getReplay({ projectId, id }),
      listChunks({ projectId, id }),
    ]);
    await writeJson(path.join(replayDir, "replay.json"), metadata);
    await writeJson(path.join(replayDir, "chunks.json"), chunks);

    let offset = 0;
    let firstUrl = null;
    for (;;) {
      const page = await getEvents({
        projectId,
        id,
        offset,
        limit: args.eventsPageLimit,
      });
      await writeJson(path.join(replayDir, `events-${offset}.json`), page);
      if (offset === 0) firstUrl = extractFirstMetaHref(page);
      const events = Array.isArray(page?.events)
        ? page.events
        : Array.isArray(page)
          ? page
          : null;
      if (!events || events.length < args.eventsPageLimit) break;
      offset += args.eventsPageLimit;
    }
    classifications.push(
      classifyReplayEntry({ entry, url: firstUrl, historicalQaUserIds }),
    );
  }

  await writeJson(path.join(outDir, "classifications.json"), classifications);
  printClassificationSummary(classifications);
  console.log(`[hexclave-inspect] done. Output under ${outDir}`);
}

// Guard so the module can be imported by tests without triggering the pull.
const invokedDirectly =
  process.argv[1] != null &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  });
}
