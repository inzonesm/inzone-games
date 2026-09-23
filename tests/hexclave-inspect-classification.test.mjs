/**
 * Regression check: scripts/hexclave-inspect.mjs must classify replays through
 * lib/qa-traffic.ts::classifyReportRow, not with rules of its own. If someone
 * later inlines a shortcut ("preview means diagnostic, done"), this test
 * catches the drift because a fixture that only the policy handles — a legacy
 * utm_medium=qa row, a historical id, or an unknown-host row — would fall
 * through the shortcut and land in the wrong bucket.
 *
 * The URL parsing helper (`extractFirstMetaHref`) and the env-var parsing
 * helper (`readHistoricalQaUserIds`) are covered here too, because they are
 * the boundary between the on-disk replay data / process env and the shared
 * policy call. If they distort what reaches classifyReportRow, the policy's
 * own tests never notice.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyReplayEntry,
  extractFirstMetaHref,
  readHistoricalQaUserIds,
} from '../scripts/hexclave-inspect.mjs';

const HISTORICAL = ['82798aa3-538f-490e-b6c0-f9115c0427f4'];

function entry(userId, id = 'r-x') {
  return { id, projectUser: { id: userId } };
}

test('classifyReplayEntry delegates every decision to classifyReportRow', () => {
  const cases = [
    {
      label: 'production, unmarked',
      entry: entry('real-1'),
      url: 'https://www.inzone.games/games/flappy',
      expect: { bucket: 'customer', appEnv: 'production' },
    },
    {
      label: 'production apex',
      entry: entry('real-2'),
      url: 'https://inzone.games/games/x',
      expect: { bucket: 'customer', appEnv: 'production' },
    },
    {
      label: 'preview host',
      entry: entry('p-1'),
      url: 'https://inzone-games-git-x-project.vercel.app/games/x',
      expect: { bucket: 'diagnostic', appEnv: 'preview' },
    },
    {
      label: 'marked QA agent',
      entry: entry('q-1'),
      url: 'https://www.inzone.games/games/x?inzone_qa=agent',
      expect: { bucket: 'diagnostic', appEnv: 'production' },
    },
    {
      label: 'legacy utm_medium=qa on production',
      entry: entry('l-1'),
      url: 'https://www.inzone.games/games/x?utm_medium=qa',
      expect: { bucket: 'diagnostic', appEnv: 'production' },
    },
    {
      label: 'legacy utm_content=exclude_from_acquisition',
      entry: entry('l-2'),
      url: 'https://www.inzone.games/games/x?utm_content=exclude_from_acquisition',
      expect: { bucket: 'diagnostic', appEnv: 'production' },
    },
    {
      label: 'documented historical QA id',
      entry: entry(HISTORICAL[0]),
      url: 'https://www.inzone.games/games/x',
      expect: { bucket: 'diagnostic', appEnv: 'production' },
    },
    {
      label: 'unknown host',
      entry: entry('u-1'),
      url: 'https://staging.example.com/games/x',
      expect: { bucket: 'diagnostic', appEnv: 'unknown' },
    },
    {
      label: 'lookalike host is not production',
      entry: entry('u-2'),
      url: 'https://inzone.games.evil.example/games/x',
      expect: { bucket: 'diagnostic', appEnv: 'unknown' },
    },
    {
      label: 'no URL is unknown, never production',
      entry: entry('u-3'),
      url: null,
      expect: { bucket: 'diagnostic', appEnv: 'unknown' },
    },
    {
      label: 'localhost',
      entry: entry('d-1'),
      url: 'http://localhost:3000/games/x',
      expect: { bucket: 'diagnostic', appEnv: 'local' },
    },
  ];

  for (const c of cases) {
    const got = classifyReplayEntry({
      entry: c.entry,
      url: c.url,
      historicalQaUserIds: HISTORICAL,
    });
    assert.equal(got.bucket, c.expect.bucket, `${c.label}: bucket`);
    assert.equal(got.appEnv, c.expect.appEnv, `${c.label}: appEnv`);
    assert.equal(got.id, c.entry.id, `${c.label}: id passthrough`);
    assert.equal(got.userId, c.entry.projectUser.id, `${c.label}: userId passthrough`);
    assert.equal(got.url, c.url, `${c.label}: url passthrough`);
    assert.equal(typeof got.reason, 'string', `${c.label}: reason present`);
  }
});

test('historicalQaUserIds is honoured when provided (empty list keeps prod-unmarked as customer)', () => {
  const bare = classifyReplayEntry({
    entry: entry(HISTORICAL[0]),
    url: 'https://www.inzone.games/games/x',
    historicalQaUserIds: [],
  });
  assert.equal(bare.bucket, 'customer');
  const withList = classifyReplayEntry({
    entry: entry(HISTORICAL[0]),
    url: 'https://www.inzone.games/games/x',
    historicalQaUserIds: HISTORICAL,
  });
  assert.equal(withList.bucket, 'diagnostic');
  assert.match(withList.reason, /historical/i);
});

test('readHistoricalQaUserIds parses HEXCLAVE_QA_USER_IDS the same way daily-product-report does', () => {
  assert.deepEqual(readHistoricalQaUserIds({}), []);
  assert.deepEqual(readHistoricalQaUserIds({ HEXCLAVE_QA_USER_IDS: '' }), []);
  assert.deepEqual(
    readHistoricalQaUserIds({ HEXCLAVE_QA_USER_IDS: 'a,b,c' }),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    readHistoricalQaUserIds({ HEXCLAVE_QA_USER_IDS: ' a , b ,  ,, c ' }),
    ['a', 'b', 'c'],
  );
});

test('extractFirstMetaHref returns the earliest Meta event across chunks', () => {
  const chunked = {
    chunkEvents: {
      chunk1: {
        events: [
          { type: 4, timestamp: 1000, data: { href: 'https://www.inzone.games/games/x' } },
          { type: 3, timestamp: 1100, data: { source: 2 } },
        ],
      },
      chunk2: {
        events: [
          { type: 4, timestamp: 500, data: { href: 'https://earlier.example/' } },
        ],
      },
    },
  };
  assert.equal(extractFirstMetaHref(chunked), 'https://earlier.example/');

  const flat = { events: [{ type: 4, timestamp: 1, data: { href: 'https://flat.example/x' } }] };
  assert.equal(extractFirstMetaHref(flat), 'https://flat.example/x');

  assert.equal(extractFirstMetaHref({ chunkEvents: {} }), null);
  assert.equal(extractFirstMetaHref({ events: [] }), null);
  assert.equal(extractFirstMetaHref(null), null);
  assert.equal(extractFirstMetaHref(undefined), null);

  const noMeta = { events: [{ type: 3, timestamp: 1, data: { source: 2 } }] };
  assert.equal(extractFirstMetaHref(noMeta), null);
});
