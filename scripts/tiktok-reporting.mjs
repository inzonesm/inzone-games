#!/usr/bin/env node
/**
 * TikTok Ads reporting — Phase 2 runner.
 *
 * Joins TikTok's `/report/integrated/get/` spend rows to Hexclave's
 * observed customer journey (utm_campaign / utm_content match) and
 * surfaces the creative-by-creative table the Phase 2 spec asked for:
 *
 *   TikTok side:   spend, impressions, clicks, ctr, conversion
 *   Hexclave side: arrivals, iframe_engaged, foreground_dwell_60s,
 *                  game_start, engaged_play, first_game_over
 *
 * Never combines these into a single number. The two sides are labelled
 * "as reported by TikTok" vs "as observed on inzone.games" — per the
 * CLAUDE.md contract, click → play attribution stays honest: rows without
 * a UTM match land in an explicit `unattributed` bucket, not silently
 * merged.
 *
 * Missing auth is a blocked result, not a report with null counts:
 *
 *   TIKTOK_ACCESS_TOKEN, TIKTOK_ADVERTISER_ID unset → blocked
 *   HEXCLAVE_PROJECT_ID unset                       → blocked
 *   hexclave CLI unauthed                           → blocked
 *
 * Usage:
 *   TIKTOK_ACCESS_TOKEN=... TIKTOK_ADVERTISER_ID=... \
 *   HEXCLAVE_PROJECT_ID=463bba54-7ccd-4570-acb7-0dc8f5123e7e \
 *     node --experimental-strip-types scripts/tiktok-reporting.mjs \
 *       [--start=YYYY-MM-DD] [--end=YYYY-MM-DD] \
 *       [--level=campaign|adgroup|ad] \
 *       [--json]
 *
 * `--json` prints the joined result to stdout as JSON (single object with
 * `tiktok`, `hexclave`, `joined`, `unattributed_hexclave`, `blocked` keys).
 * Without it, prints a human-readable table plus the flags section.
 *
 * Read-only. Nothing this script does mutates TikTok, Hexclave, Firestore,
 * or Vercel state.
 */

import process from 'node:process';
import { spawn } from 'node:child_process';
import { fetchTikTokReport, TikTokReportingError } from '../lib/tiktok/reporting.ts';
import { tiktokReportingConfig } from '../lib/tiktok/config.ts';

/* ─── CLI parsing ─────────────────────────────────────────────────────── */

function arg(name, dflt = undefined) {
  const prefix = `--${name}=`;
  const match = process.argv.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : dflt;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

const HEXCLAVE_PROJECT_ID =
  process.env.HEXCLAVE_PROJECT_ID || '463bba54-7ccd-4570-acb7-0dc8f5123e7e';

const LEVEL_ALIAS = {
  campaign: 'AUCTION_CAMPAIGN',
  adgroup: 'AUCTION_ADGROUP',
  ad: 'AUCTION_AD',
};

function defaultRange() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  const s = d.toISOString().slice(0, 10);
  return { startDate: s, endDate: s };
}

/* ─── Hexclave (mirrors scripts/hexclave-analytics-query.mjs) ─────────── */

function execJs(projectId, js) {
  return new Promise((resolve) => {
    const child = spawn(
      'npx',
      ['--yes', '@hexclave/cli@latest', 'exec', '--cloud-project-id', projectId, js],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

async function hexclaveQuery(sql) {
  const js = `const r = await hexclaveServerApp.queryAnalytics({ query: ${JSON.stringify(sql)} }); console.log(JSON.stringify(r.result));`;
  const { code, out, err } = await execJs(HEXCLAVE_PROJECT_ID, js);
  if (code !== 0) {
    throw new Error(`hexclave query failed (code ${code}): ${err || 'no stderr'}`);
  }
  try {
    return JSON.parse(out);
  } catch (e) {
    throw new Error(`hexclave query returned non-JSON: ${out.slice(0, 200)}`);
  }
}

/**
 * Pull customer-traffic engagement counts, grouped by utm_campaign +
 * utm_content, for the given date range. Customer = production +
 * unmarked, per docs/qa-traffic-policy.md. This is intentionally a
 * different filter set than daily-product-report.mjs's — that report
 * scopes by host and QA marker separately. Here we only need
 * traffic_kind = '' and app_env = 'production'.
 */
function hexclaveEngagementSql(startDate, endDate) {
  return `
    SELECT
      JSONExtractString(toString(data), 'utm_campaign') AS utm_campaign,
      JSONExtractString(toString(data), 'utm_content')  AS utm_content,
      JSONExtractString(toString(data), 'utm_source')   AS utm_source,
      sumIf(1, JSONExtractString(toString(data), 'inzone_event') = 'campaign_arrival')      AS arrivals,
      sumIf(1, JSONExtractString(toString(data), 'inzone_event') = 'iframe_engaged')         AS iframe_engaged,
      sumIf(1, JSONExtractString(toString(data), 'inzone_event') = 'foreground_dwell_60s')   AS dwell_60s,
      sumIf(1, JSONExtractString(toString(data), 'inzone_event') = 'game_start')             AS game_start,
      sumIf(1, JSONExtractString(toString(data), 'inzone_event') = 'engaged_play')           AS engaged_play,
      sumIf(1, JSONExtractString(toString(data), 'inzone_event') = 'first_game_over')        AS first_game_over,
      sumIf(1, JSONExtractString(toString(data), 'inzone_event') = 'session_bounce')         AS bounce
    FROM events
    WHERE event_type = '$page-view'
      AND event_at >= toDateTime('${startDate} 00:00:00')
      AND event_at <  toDateTime('${endDate} 00:00:00') + INTERVAL 1 DAY
      AND JSONExtractString(toString(data), 'app_env') = 'production'
      AND JSONExtractString(toString(data), 'traffic_kind') = ''
      AND JSONExtractString(toString(data), 'utm_source') = 'tiktok'
    GROUP BY utm_campaign, utm_content, utm_source
    HAVING arrivals > 0 OR iframe_engaged > 0 OR game_start > 0
    ORDER BY arrivals DESC
  `;
}

/* ─── The join ────────────────────────────────────────────────────────── */

/**
 * A TikTok row has an id (campaign_id / adgroup_id / ad_id) but we join on
 * utm_campaign / utm_content. TikTok's `utm_campaign` sent from an ad URL
 * is set by the advertiser (Jayme) — the convention we asked for in
 * docs/TIKTOK_INTEGRATION.md is:
 *
 *   utm_campaign = <campaign_name>
 *   utm_content  = <creative_id> (i.e. ad_id at the AD level)
 *
 * If Jayme's ad URLs don't follow the convention, TikTok rows will not
 * join to Hexclave rows. That's fine — we report both sides side-by-side
 * so the mismatch is visible, and Hexclave rows without a matching TikTok
 * row land in `unattributed_hexclave`.
 */
function joinRows(tiktok, hexclave, level) {
  // Build lookup keys for both sides.
  const hxByCampaign = new Map();
  const hxByContent = new Map();
  for (const row of hexclave) {
    if (row.utm_campaign) {
      const k = row.utm_campaign.toLowerCase();
      hxByCampaign.set(k, (hxByCampaign.get(k) ?? []).concat(row));
    }
    if (row.utm_content) {
      const k = row.utm_content.toLowerCase();
      hxByContent.set(k, (hxByContent.get(k) ?? []).concat(row));
    }
  }
  const joined = [];
  const usedHxKeys = new Set();
  for (const t of tiktok) {
    // At AD level, TikTok's id maps to utm_content (creative id).
    // At ADGROUP / CAMPAIGN levels, no direct id → utm mapping is
    // guaranteed; we surface the row unjoined and let the reader match by
    // name from ads manager if needed.
    let matches = [];
    if (level === 'AUCTION_AD') {
      matches = hxByContent.get(t.id?.toLowerCase()) ?? [];
    }
    if (matches.length === 0 && t.name) {
      matches = hxByCampaign.get(t.name.toLowerCase()) ?? [];
    }
    const sumMatches = matches.reduce(
      (acc, row) => ({
        arrivals: acc.arrivals + Number(row.arrivals || 0),
        iframe_engaged: acc.iframe_engaged + Number(row.iframe_engaged || 0),
        dwell_60s: acc.dwell_60s + Number(row.dwell_60s || 0),
        game_start: acc.game_start + Number(row.game_start || 0),
        engaged_play: acc.engaged_play + Number(row.engaged_play || 0),
        first_game_over: acc.first_game_over + Number(row.first_game_over || 0),
        bounce: acc.bounce + Number(row.bounce || 0),
      }),
      {
        arrivals: 0,
        iframe_engaged: 0,
        dwell_60s: 0,
        game_start: 0,
        engaged_play: 0,
        first_game_over: 0,
        bounce: 0,
      },
    );
    for (const match of matches) {
      usedHxKeys.add(`${match.utm_campaign}|${match.utm_content}`);
    }
    // The flag: TikTok reports clicks but Hexclave saw no iframe touch.
    const clicks = Number(t.metrics.clicks || 0);
    const clickButNoTouch =
      clicks > 5 && sumMatches.iframe_engaged === 0 && matches.length > 0;
    joined.push({
      id: t.id,
      name: t.name || null,
      tiktok: {
        spend: t.metrics.spend,
        impressions: Number(t.metrics.impressions || 0),
        clicks,
        ctr: t.metrics.ctr,
        cpc: t.metrics.cpc,
        conversion: Number(t.metrics.conversion || 0),
      },
      hexclave: sumMatches,
      matched: matches.length > 0,
      flags: clickButNoTouch ? ['click_but_no_touch'] : [],
    });
  }
  const unattributed = hexclave.filter(
    (row) => !usedHxKeys.has(`${row.utm_campaign}|${row.utm_content}`),
  );
  return { joined, unattributed };
}

/* ─── Render ──────────────────────────────────────────────────────────── */

function fmt(n, dp = 0) {
  if (n === '' || n == null) return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  if (dp > 0) return num.toFixed(dp);
  return num.toLocaleString('en-US');
}

function renderTable(joined, level) {
  if (joined.length === 0) return '(no TikTok rows for this window)';
  const lines = [];
  lines.push(
    '| id | name | spend | impr | clicks | ctr | conv | arrivals | iframe_eng | dwell_60s | game_start | engaged_play | flags |',
  );
  lines.push(
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|',
  );
  for (const row of joined) {
    lines.push(
      `| \`${row.id}\` | ${row.name ?? '—'} | ${fmt(row.tiktok.spend, 2)} | ${fmt(row.tiktok.impressions)} | ${fmt(row.tiktok.clicks)} | ${fmt(row.tiktok.ctr, 4)} | ${fmt(row.tiktok.conversion)} | ${fmt(row.hexclave.arrivals)} | ${fmt(row.hexclave.iframe_engaged)} | ${fmt(row.hexclave.dwell_60s)} | ${fmt(row.hexclave.game_start)} | ${fmt(row.hexclave.engaged_play)} | ${row.flags.join(', ') || (row.matched ? '' : '(unmatched)')} |`,
    );
  }
  return lines.join('\n');
}

function renderFlags(joined) {
  const flagged = joined.filter((r) => r.flags.length > 0);
  if (flagged.length === 0) return '(no click-but-no-touch creatives)';
  const lines = ['**Click but no iframe touch** — TikTok reports clicks, Hexclave sees no user tap:', ''];
  for (const row of flagged) {
    lines.push(
      `- \`${row.id}\` "${row.name ?? row.id}": ${row.tiktok.clicks} clicks → 0 iframe_engaged. Either the ad URL's UTM isn't reaching us, or the CrazyGames iframe fails to boot on the target audience's device.`,
    );
  }
  return lines.join('\n');
}

/* ─── Main ────────────────────────────────────────────────────────────── */

async function main() {
  const level = LEVEL_ALIAS[(arg('level') || 'campaign').toLowerCase()] || 'AUCTION_CAMPAIGN';
  const range = defaultRange();
  const startDate = arg('start') || range.startDate;
  const endDate = arg('end') || range.endDate;
  const asJson = flag('json');

  const blocked = [];

  // Preconditions.
  if (!tiktokReportingConfig(process.env)) {
    blocked.push(
      'TIKTOK_ACCESS_TOKEN and TIKTOK_ADVERTISER_ID must both be set (Encrypted / Plain Text in Vercel; see docs/TIKTOK_INTEGRATION.md).',
    );
  }
  if (!HEXCLAVE_PROJECT_ID) {
    blocked.push('HEXCLAVE_PROJECT_ID must be set to the InZone production project UUID.');
  }

  if (blocked.length > 0) {
    const report = {
      blocked,
      request: { startDate, endDate, level },
      tiktok: null,
      hexclave: null,
      joined: null,
      unattributed_hexclave: null,
    };
    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log('# TikTok reporting — BLOCKED');
      console.log('');
      for (const b of blocked) console.log(`- ${b}`);
    }
    process.exit(2);
  }

  // TikTok fetch.
  let tiktokResp;
  try {
    tiktokResp = await fetchTikTokReport({ startDate, endDate, level });
  } catch (err) {
    const message =
      err instanceof TikTokReportingError ? `${err.code}: ${err.message}` : err.message;
    blocked.push(`TikTok API call failed: ${message}`);
    if (asJson) {
      console.log(JSON.stringify({ blocked, request: { startDate, endDate, level } }, null, 2));
    } else {
      console.error(`# TikTok reporting — BLOCKED\n\n- ${blocked.join('\n- ')}`);
    }
    process.exit(2);
  }

  // Hexclave fetch — customer traffic only, utm_source = tiktok.
  let hexclaveRows;
  try {
    hexclaveRows = await hexclaveQuery(hexclaveEngagementSql(startDate, endDate));
  } catch (err) {
    blocked.push(`Hexclave query failed: ${err.message}`);
    if (asJson) {
      console.log(
        JSON.stringify(
          { blocked, request: { startDate, endDate, level }, tiktok: tiktokResp },
          null,
          2,
        ),
      );
    } else {
      console.error(`# Hexclave query — BLOCKED\n\n- ${blocked.join('\n- ')}`);
    }
    process.exit(2);
  }

  const { joined, unattributed } = joinRows(tiktokResp.rows, hexclaveRows, level);

  const report = {
    blocked: [],
    request: { startDate, endDate, level },
    tiktok: {
      timezone: tiktokResp.timezone,
      currency: tiktokResp.currency,
      attributionWindow: tiktokResp.attributionWindow,
      rowCount: tiktokResp.rows.length,
    },
    hexclave: {
      customer_utm_tiktok_rows: hexclaveRows.length,
    },
    joined,
    unattributed_hexclave: unattributed,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`# TikTok × InZone report — ${startDate} → ${endDate}`);
  console.log('');
  console.log(
    `- Level: \`${level}\`  · TikTok timezone: \`${tiktokResp.timezone ?? 'unknown'}\`  · Currency: \`${tiktokResp.currency ?? 'unknown'}\`  · Attribution window: \`${tiktokResp.attributionWindow ?? 'unknown'}\``,
  );
  console.log(`- TikTok rows: ${tiktokResp.rows.length}. Hexclave customer utm=tiktok rows: ${hexclaveRows.length}.`);
  console.log('');
  console.log('## Joined view — spend vs observed engagement');
  console.log('');
  console.log(renderTable(joined, level));
  console.log('');
  console.log('## Flags');
  console.log('');
  console.log(renderFlags(joined));
  console.log('');
  if (unattributed.length > 0) {
    console.log('## Hexclave rows with no matching TikTok row');
    console.log('');
    console.log(
      '_These arrivals carried `utm_source=tiktok` but no TikTok row for this level matched their utm_campaign / utm_content. Either the UTMs in Jayme\'s ad URLs don\'t match ad-manager campaign / creative names, or the level filter is too narrow (try `--level=ad`)._',
    );
    console.log('');
    console.log('| utm_campaign | utm_content | arrivals | iframe_engaged | dwell_60s | game_start |');
    console.log('|---|---|---:|---:|---:|---:|');
    for (const row of unattributed.slice(0, 20)) {
      console.log(
        `| ${row.utm_campaign || '—'} | ${row.utm_content || '—'} | ${fmt(row.arrivals)} | ${fmt(row.iframe_engaged)} | ${fmt(row.dwell_60s)} | ${fmt(row.game_start)} |`,
      );
    }
    if (unattributed.length > 20) {
      console.log(`| _…${unattributed.length - 20} more rows_ |`);
    }
  }
  console.log('');
  console.log(
    '_Never combines TikTok and Hexclave counts into a single number. TikTok\'s attribution window and Hexclave\'s customer-scope view are distinct measurements of distinct populations._',
  );
}

main().catch((err) => {
  console.error(`tiktok-reporting.mjs failed: ${err.message}`);
  process.exit(1);
});
