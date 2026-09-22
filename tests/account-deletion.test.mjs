import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeletionClient, DeletionApiError, parseDeletionState } from '../lib/account-deletion.ts';

const ORIGIN = 'https://api.example.test';

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  };
  return { impl, calls };
}

test('request sends the ID token, the matching uid and source=web', async () => {
  const { impl, calls } = fakeFetch([{ body: { success: true, status: 'pending_window', purgeAfter: '2026-10-22T00:00:00+00:00' } }]);
  const client = createDeletionClient({ origin: `${ORIGIN}/`, fetchImpl: impl });
  const state = await client.request('tok', 'uid1');
  assert.equal(state.status, 'pending_window');
  assert.equal(state.purgeAfter, '2026-10-22T00:00:00+00:00');
  assert.equal(calls[0].url, `${ORIGIN}/user/request-account-deletion`);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(calls[0].init.body), { UID: 'uid1', source: 'web' });
});

test('stale sign-in surfaces requires_recent_login', async () => {
  const { impl } = fakeFetch([{ status: 401, body: { success: false, code: 'requires_recent_login', error: 'sign in again' } }]);
  const client = createDeletionClient({ origin: ORIGIN, fetchImpl: impl });
  await assert.rejects(client.request('tok', 'uid1'), (e) => e instanceof DeletionApiError && e.code === 'requires_recent_login');
});

test('network failure is distinguishable from a server refusal', async () => {
  const { impl } = fakeFetch([new TypeError('Failed to fetch')]);
  const client = createDeletionClient({ origin: ORIGIN, fetchImpl: impl });
  await assert.rejects(client.status('tok', 'uid1'), (e) => e.code === 'network');
});

test('non-JSON 500 becomes a server error', async () => {
  const impl = async () => new Response('<html>oops</html>', { status: 500 });
  const client = createDeletionClient({ origin: ORIGIN, fetchImpl: impl });
  await assert.rejects(client.request('tok', 'uid1'), (e) => e.code === 'server' && e.status === 500);
});

test('cancel during processing reports deletion_in_progress', async () => {
  const { impl } = fakeFetch([{ status: 409, body: { success: false, code: 'deletion_in_progress', error: 'started' } }]);
  const client = createDeletionClient({ origin: ORIGIN, fetchImpl: impl });
  await assert.rejects(client.cancel('tok', 'uid1'), (e) => e.code === 'deletion_in_progress');
});

test('status parsing tolerates unknown and missing fields', () => {
  assert.equal(parseDeletionState({}).status, 'none');
  assert.equal(parseDeletionState({ status: 'weird' }).status, 'processing');
  assert.equal(parseDeletionState({ status: 'completed', completedAt: '' }).completedAt, null);
});
