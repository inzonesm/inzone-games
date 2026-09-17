#!/usr/bin/env node
// Read-only Hexclave analytics queries for the InZone production project.
//
// Wraps `hexclave exec --cloud-project-id <UUID>` around
// `hexclaveServerApp.queryAnalytics({ query })`. Every call is a read; nothing
// mutates the Hexclave project, Firestore, Meta ads, or billing.
//
// The events table is the only one that carries product signals. Its known
// columns (from DESCRIBE TABLE events at time of writing):
//   event_type        LowCardinality(String)  — one of $page-view, $click,
//                                                $token-refresh,
//                                                $sign-up-rule-trigger
//   event_at          DateTime64(3, 'UTC')
//   data              JSON  — payload; MUST wrap in toString() before
//                              JSONExtract* functions
//   project_id        — auto-filtered by row-level security, do NOT filter
//   branch_id         — same
//   user_id           Nullable(String)
//   team_id           Nullable(String)  — reserved, currently always NULL
//   refresh_token_id  Nullable(String)
//   session_replay_id Nullable(String)
//
// Campaign events (game_start, engaged_play, first_game_over, return_play,
// campaign_arrival, invite_*, session_message, etc.) are NOT their own
// event_type. They are wrapped as $page-view rows with path=/session-prototype
// and their real name in data.inzone_event — see
// lib/campaign-analytics-hexclave.ts::campaignBatchBody. Every query in this
// script that reports a campaign event has to lift it out of data.inzone_event.
//
// Usage:
//   export HEXCLAVE_PROJECT_ID=<uuid>
//   node scripts/hexclave-analytics-query.mjs <preset>
//
// Presets (each writes JSON to stdout):
//   schema                DESCRIBE TABLE events
//   event-types 7|30      All event_types with counts over N days
//   inzone-events 7|30    All data.inzone_event names with counts + replays
//   paths 7|30            Top real page paths (excluding the campaign sink)
//   funnel 7|30           campaign_arrival → game_start → engaged_play →
//                          first_game_over → return_play, per-user counts
//   country 7|30          Country distribution from $token-refresh
//   replay-events <id>    All campaign events tied to a session_replay_id
//   top-users 7|30        Top users by inzone_event volume (QA-detection)
//
// The default project ID is the InZone cloud project UUID; override with
// HEXCLAVE_PROJECT_ID. HEXCLAVE_SECRET_SERVER_KEY / STACK_SECRET_SERVER_KEY
// must be UNSET — the --cloud-project-id path requires the OAuth login flow.
//
// The default output is JSON on stdout; pipe through jq or into a file.

import { spawn } from "node:child_process";
import process from "node:process";

const CAMPAIGN_PATH = "/session-prototype";

function ensurePreconditions() {
  const projectId = process.env.HEXCLAVE_PROJECT_ID;
  if (!projectId) {
    console.error(
      "HEXCLAVE_PROJECT_ID is not set. Point it at the InZone production project UUID " +
        "(the same value set as HEXCLAVE_PROJECT_ID in Vercel + GitHub Actions).",
    );
    process.exit(1);
  }
  for (const key of ["HEXCLAVE_SECRET_SERVER_KEY", "STACK_SECRET_SERVER_KEY"]) {
    if (process.env[key]) {
      console.error(
        `${key} is set. The --cloud-project-id exec path rejects when a server key is present. Unset ${key} and retry.`,
      );
      process.exit(1);
    }
  }
  return projectId;
}

function execJs(projectId, js) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      ["--yes", "@hexclave/cli@latest", "exec", "--cloud-project-id", projectId, js],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (b) => { out += b.toString("utf8"); });
    child.stderr.on("data", (b) => { err += b.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`exit ${code}: ${err.trim()}`));
      const trimmed = out.trim();
      if (trimmed === "") return resolve(null);
      try { resolve(JSON.parse(trimmed)); }
      catch (e) { reject(new Error(`non-JSON: ${e.message}\n---\n${out}\n---\n${err}`)); }
    });
  });
}

function runQuery(projectId, sql) {
  const js = `return await hexclaveServerApp.queryAnalytics({ query: ${JSON.stringify(sql)} });`;
  return execJs(projectId, js);
}

function daysArg(argv, fallback = 7) {
  const n = Number(argv[0]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const PRESETS = {
  async schema(projectId) {
    return runQuery(projectId, "DESCRIBE TABLE events");
  },

  async "event-types"(projectId, argv) {
    const d = daysArg(argv);
    return runQuery(projectId, `
      SELECT event_type, count() AS n, min(event_at) AS first_seen, max(event_at) AS last_seen
      FROM events
      WHERE event_at > now() - INTERVAL ${d} DAY
      GROUP BY event_type
      ORDER BY n DESC
    `);
  },

  async "inzone-events"(projectId, argv) {
    const d = daysArg(argv);
    return runQuery(projectId, `
      SELECT JSONExtractString(toString(data), 'inzone_event') AS ev,
             count() AS n,
             uniqExact(user_id) AS users,
             uniqExact(session_replay_id) AS replays
      FROM events
      WHERE event_type = '$page-view'
        AND JSONExtractString(toString(data), 'path') = '${CAMPAIGN_PATH}'
        AND event_at > now() - INTERVAL ${d} DAY
      GROUP BY ev
      ORDER BY n DESC
    `);
  },

  async paths(projectId, argv) {
    const d = daysArg(argv);
    return runQuery(projectId, `
      SELECT JSONExtractString(toString(data), 'path') AS path,
             count() AS views,
             uniqExact(user_id) AS users,
             uniqExact(session_replay_id) AS replays
      FROM events
      WHERE event_type = '$page-view'
        AND JSONExtractString(toString(data), 'path') != '${CAMPAIGN_PATH}'
        AND event_at > now() - INTERVAL ${d} DAY
      GROUP BY path
      ORDER BY views DESC
      LIMIT 40
    `);
  },

  async funnel(projectId, argv) {
    const d = daysArg(argv);
    return runQuery(projectId, `
      SELECT
        countIf(ev = 'campaign_arrival') AS arrivals_events,
        uniqExactIf(user_id, ev = 'campaign_arrival') AS arrivals_users,
        countIf(ev = 'game_open') AS opens_events,
        uniqExactIf(user_id, ev = 'game_open') AS opens_users,
        countIf(ev = 'game_start') AS starts_events,
        uniqExactIf(user_id, ev = 'game_start') AS starts_users,
        countIf(ev = 'engaged_play') AS engaged_events,
        uniqExactIf(user_id, ev = 'engaged_play') AS engaged_users,
        countIf(ev = 'first_game_over') AS first_over_events,
        uniqExactIf(user_id, ev = 'first_game_over') AS first_over_users,
        countIf(ev = 'return_play') AS return_events,
        uniqExactIf(user_id, ev = 'return_play') AS return_users
      FROM (
        SELECT user_id, JSONExtractString(toString(data), 'inzone_event') AS ev
        FROM events
        WHERE event_type = '$page-view'
          AND JSONExtractString(toString(data), 'path') = '${CAMPAIGN_PATH}'
          AND event_at > now() - INTERVAL ${d} DAY
      )
    `);
  },

  async country(projectId, argv) {
    const d = daysArg(argv);
    return runQuery(projectId, `
      SELECT JSONExtractString(toString(data), 'ip_info', 'country_code') AS country,
             uniqExact(user_id) AS users,
             count() AS events
      FROM events
      WHERE event_type = '$token-refresh'
        AND event_at > now() - INTERVAL ${d} DAY
      GROUP BY country
      ORDER BY users DESC
    `);
  },

  async "replay-events"(projectId, argv) {
    const id = argv[0];
    if (!id) throw new Error("replay-events requires a session_replay_id argument");
    return runQuery(projectId, `
      SELECT event_at,
             JSONExtractString(toString(data), 'inzone_event') AS ev,
             JSONExtractString(toString(data), 'path') AS path,
             user_id
      FROM events
      WHERE event_type = '$page-view'
        AND session_replay_id = '${id}'
      ORDER BY event_at
    `);
  },

  async "top-users"(projectId, argv) {
    const d = daysArg(argv);
    return runQuery(projectId, `
      SELECT user_id,
             count() AS events,
             countIf(JSONExtractString(toString(data), 'inzone_event') = 'game_start') AS game_starts,
             countIf(JSONExtractString(toString(data), 'inzone_event') = 'engaged_play') AS engaged,
             countIf(JSONExtractString(toString(data), 'inzone_event') = 'campaign_arrival') AS arrivals,
             uniqExact(session_replay_id) AS replays
      FROM events
      WHERE event_type = '$page-view'
        AND JSONExtractString(toString(data), 'path') = '${CAMPAIGN_PATH}'
        AND event_at > now() - INTERVAL ${d} DAY
      GROUP BY user_id
      ORDER BY events DESC
      LIMIT 20
    `);
  },
};

async function main() {
  const [preset, ...rest] = process.argv.slice(2);
  if (!preset || preset === "--help" || preset === "-h") {
    const names = Object.keys(PRESETS).join(" | ");
    console.error(
      `Usage: node scripts/hexclave-analytics-query.mjs <${names}> [args...]`,
    );
    process.exit(preset ? 0 : 2);
  }
  if (!(preset in PRESETS)) {
    console.error(`Unknown preset: ${preset}`);
    process.exit(2);
  }
  const projectId = ensurePreconditions();
  const result = await PRESETS[preset](projectId, rest);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
