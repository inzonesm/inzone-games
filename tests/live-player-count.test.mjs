import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  LIVE_SESSION_FRESHNESS_MS,
  countFreshOpenSessions,
  isFreshOpenSession,
  sessionLastSeenMs,
} from '../lib/live-player-count.ts';

const NOW = Date.UTC(2026, 8, 17, 21, 0, 0);

test('open sessions without a timestamp are not counted as playing now', () => {
  assert.equal(isFreshOpenSession({ status: 'open' }, NOW), false);
  assert.equal(sessionLastSeenMs({ status: 'open' }), null);
  assert.equal(countFreshOpenSessions([{ status: 'open' }, { status: 'open' }], NOW), 0);
});

test('stale open sessions are excluded even when status is still open', () => {
  const stale = {
    status: 'open',
    opened_at: NOW - LIVE_SESSION_FRESHNESS_MS - 1,
    updated_at: NOW - LIVE_SESSION_FRESHNESS_MS - 1,
  };
  assert.equal(isFreshOpenSession(stale, NOW), false);
  assert.equal(countFreshOpenSessions([stale], NOW), 0);
});

test('a recent heartbeat counts; closed and future-untrusted rows do not', () => {
  const fresh = { status: 'open', updated_at: NOW - 60_000 };
  const closed = { status: 'closed', updated_at: NOW - 1_000 };
  const farFuture = { status: 'open', updated_at: NOW + 10 * 60_000 };
  assert.equal(isFreshOpenSession(fresh, NOW), true);
  assert.equal(isFreshOpenSession(closed, NOW), false);
  assert.equal(isFreshOpenSession(farFuture, NOW), false);
  assert.equal(countFreshOpenSessions([fresh, closed, farFuture, { status: 'open' }], NOW), 1);
});

test('opened_at is enough when updated_at is missing, including Firestore seconds', () => {
  const opened = { status: 'open', opened_at: { seconds: NOW / 1000 - 30 } };
  assert.equal(isFreshOpenSession(opened, NOW), true);
  assert.ok(sessionLastSeenMs(opened) > NOW - 60_000);
});

test('fetchLivePlayerCount source no longer uses an unfiltered server count', async () => {
  const src = await (await import('node:fs/promises')).readFile(
    new URL('../lib/games.ts', import.meta.url),
    'utf8',
  );
  assert.match(src, /countFreshOpenSessions/);
  assert.equal(/getCountFromServer\(/.test(src), false, 'live pill must not count every open row');
});
