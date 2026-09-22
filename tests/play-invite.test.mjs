import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INVITE_SCOPE,
  PLAY_INVITE_COPY,
  conversationInviteResult,
  inviteScopeForGame,
  isPlayInviteRequest,
} from '../lib/play-invite.ts';
import { instrumentGameHtml } from '../lib/game-hosting.ts';
import { previewForceRetryRequested, isPreviewForceRetryHost } from '../lib/preview-force-retry.ts';

test('Nightclub invite is conversation membership, never a silent match join', () => {
  assert.equal(inviteScopeForGame('nightclub-showdown-inzone-production'), INVITE_SCOPE.conversation);
  assert.equal(inviteScopeForGame('kart-bros'), INVITE_SCOPE.conversation);
  const result = conversationInviteResult({
    sessionId: 'aabbccddeeff00112233445566778899',
    url: 'https://www.inzone.games/session-prototype?game=nightclub-showdown-inzone-production&session=aabbccddeeff00112233445566778899',
    expiresAt: 1_700_000_000_000,
  });
  assert.equal(result.kind, 'conversation');
  assert.equal(result.matchJoined, false);
  assert.match(result.share.url, /session=aabbccddeeff00112233445566778899/);
  assert.match(result.share.text, /not a shared/i);
  assert.doesNotMatch(PLAY_INVITE_COPY.conversationHint, /InZone SDK/i);
});

test('play-invite request guard rejects junk and accepts sendChallenge', () => {
  assert.equal(isPlayInviteRequest(null), false);
  assert.equal(isPlayInviteRequest({ channel: 'nope' }), false);
  assert.equal(
    isPlayInviteRequest({
      channel: 'inzone-play-invite',
      v: 1,
      id: 'inv1',
      type: 'req',
      method: 'sendChallenge',
    }),
    true,
  );
});

test('same-origin games get the invite bridge and not the isolated SDK', () => {
  const html = '<html><head></head><body><h1>nightclub</h1></body></html>';
  const out = instrumentGameHtml(html, {
    baseHref: '/gcs/games/nightclub-showdown-inzone-production/v2/',
    gameId: 'nightclub-showdown-inzone-production',
  });
  assert.match(out, /__inzonePlayInvite/);
  assert.match(out, /inzone-play-invite/);
  assert.match(out, /sendChallenge/);
  assert.match(out, /fillMissing/);
  assert.match(out, /inviteScope: 'conversation'/);
  assert.doesNotMatch(out, /__inzoneWebSdk/);
  assert.doesNotMatch(out, /Bearer /);
  assert.doesNotMatch(out, /sk_/);
});

test('previewForceRetry is ignored on production hostnames', () => {
  const search = new URLSearchParams('previewForceRetry=1');
  assert.equal(isPreviewForceRetryHost('inzone.games'), false);
  assert.equal(isPreviewForceRetryHost('www.inzone.games'), false);
  assert.equal(isPreviewForceRetryHost('inzone-games-abc.vercel.app'), true);
  assert.equal(previewForceRetryRequested(search, 'inzone.games'), false);
  assert.equal(previewForceRetryRequested(search, 'inzone-games-abc.vercel.app'), true);
  assert.equal(previewForceRetryRequested(new URLSearchParams(''), 'localhost'), false);
});
