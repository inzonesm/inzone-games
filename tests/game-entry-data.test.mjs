/**
 * Entry resolution must send the browser only what it needs to open a game,
 * must mirror the client read's semantics, and must not cause a remount when
 * the full catalogue document replaces it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { shapeGameEntry, sameMountedGame, provisionalHubGame } from '../lib/game-entry-data.ts';

const RAW = {
  name: '  Flappybird Inzone 2  ',
  gameUrl: 'https://storage.googleapis.com/inzone-html/games/flappybird-inzone-2/v9/index.html',
  serverUrl: '',
  status: 'approved',
  version: 9,
  // Fields a catalogue document may carry that are not entry data:
  uploaderId: 'stleyc71xUZJTmcx88A6Mv9dyYs2',
  moderationNote: 'internal only',
  payoutAccount: 'acct_secret',
  iconUrl: 'https://example/icon.png',
};

test('sends only the allowlisted entry fields', () => {
  const e = shapeGameEntry('flappybird-inzone-2', RAW);
  assert.deepEqual(Object.keys(e).sort(), ['gameUrl', 'id', 'name', 'serverUrl', 'status', 'version']);
  const wire = JSON.stringify(e);
  for (const secret of ['stleyc71xUZJTmcx88A6Mv9dyYs2', 'internal only', 'acct_secret']) {
    assert.ok(!wire.includes(secret), `leaked: ${secret}`);
  }
});

test('trims, and defaults a missing version rather than inventing one', () => {
  const e = shapeGameEntry('g', { ...RAW, version: undefined });
  assert.equal(e.name, 'Flappybird Inzone 2');
  assert.equal(e.version, 1);
});

test('nothing playable to point at resolves to null, like the client read', () => {
  assert.equal(shapeGameEntry('g', { name: 'x' }), null);
  assert.equal(shapeGameEntry('g', { gameUrl: '   ' }), null);
  assert.equal(shapeGameEntry('', RAW), null);
  assert.equal(shapeGameEntry('g', null), null);
});

test('does not filter on status — a withdrawn game still resolves', () => {
  // fetchGameById deliberately ignores status so a direct link keeps working
  // and lands in the host's recovery UI. This must match.
  const e = shapeGameEntry('g', { ...RAW, status: 'withdrawn' });
  assert.equal(e.status, 'withdrawn');
  assert.equal(e.gameUrl, RAW.gameUrl);
});

test('a version bump changes the resolved entry', () => {
  const a = shapeGameEntry('g', RAW);
  const b = shapeGameEntry('g', { ...RAW, version: 10 });
  assert.notEqual(a.version, b.version);
});

test('metadata-only changes keep the same mounted game', () => {
  const fast = shapeGameEntry('g', RAW);
  const full = shapeGameEntry('g', { ...RAW, name: 'Renamed', iconUrl: 'https://other/i.png', status: 'approved' });
  assert.ok(sameMountedGame(fast, full), 'a rename or new icon must not remount the frame');
});

test('a changed build URL is a different mounted game', () => {
  const a = shapeGameEntry('g', RAW);
  const b = shapeGameEntry('g', { ...RAW, gameUrl: RAW.gameUrl.replace('/v9/', '/v10/') });
  assert.ok(!sameMountedGame(a, b));
});

test('a changed serverUrl is a different mounted game', () => {
  const a = shapeGameEntry('g', RAW);
  const b = shapeGameEntry('g', { ...RAW, serverUrl: 'wss://server' });
  assert.ok(!sameMountedGame(a, b));
});

test('the provisional game carries real entry values and invents nothing', () => {
  const e = shapeGameEntry('flappybird-inzone-2', RAW);
  const g = provisionalHubGame(e);
  assert.equal(g.gameUrl, e.gameUrl);
  assert.equal(g.serverUrl, e.serverUrl);
  assert.equal(g.name, 'Flappybird Inzone 2');
  assert.equal(g.description, '', 'no invented description');
  assert.equal(g.iconUrl, '', 'no invented icon');
  assert.equal(g.uploaderId, '', 'owner id is not entry data');
  assert.equal(g.preview, null);
});
