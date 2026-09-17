import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  APP_STORE_URL,
  APP_VALUE_COPY,
  PLAY_STORE_URL,
  isAppCtaSurface,
  webAppHandoffLink,
} from '../lib/app-links.ts';

test('store destinations are the verified listings', () => {
  assert.equal(APP_STORE_URL, 'https://apps.apple.com/us/app/inzone/id6478089068');
  assert.match(PLAY_STORE_URL, /play\.google\.com\/store\/apps\/details/);
  assert.match(PLAY_STORE_URL, /id=com\.aadeshkheria\.inzone/);
});

test('web Get-the-app OneLink reuses AppsFlyer and is distinct from social_share', async () => {
  const hub = new URL(webAppHandoffLink());
  assert.equal(hub.origin + hub.pathname, 'https://join-inzone.onelink.me/SACg');
  assert.equal(hub.searchParams.get('pid'), 'web_get_app');
  assert.equal(hub.searchParams.get('deep_link_value'), null);

  const game = new URL(webAppHandoffLink({ gameId: 'flappybird-inzone-2' }));
  assert.equal(game.searchParams.get('pid'), 'web_get_app');
  assert.equal(game.searchParams.get('deep_link_value'), 'community_game');
  assert.equal(game.searchParams.get('deep_link_sub1'), 'flappybird-inzone-2');
  assert.equal(
    game.searchParams.get('af_dp'),
    'inzone://game?gameId=flappybird-inzone-2',
  );
  assert.equal(game.searchParams.get('session'), null);
  assert.equal(game.searchParams.get('invite'), null);

  const leaked = new URL(webAppHandoffLink({ gameId: 'aabbccddeeff00112233445566778899' }));
  assert.equal(leaked.searchParams.get('deep_link_sub1'), null, '32-char hex is a session id, not a game id');

  const gamesSrc = await readFile(new URL('../lib/games.ts', import.meta.url), 'utf8');
  assert.match(gamesSrc, /pid:\s*'social_share'/);
});

test('copy leads with the product direction; progress limits stay on the handoff', () => {
  assert.equal(APP_VALUE_COPY.hubLede, 'Discover games. Play instantly. Bring your friends.');
  assert.match(APP_VALUE_COPY.hubBenefits, /3D avatars/i);
  assert.match(APP_VALUE_COPY.panelBody, /3D avatars/i);
  assert.doesNotMatch(APP_VALUE_COPY.hubLede, /Invite a friend to this tab/i);
  assert.doesNotMatch(APP_VALUE_COPY.hubBenefits, /progress|score/i);
  assert.match(APP_VALUE_COPY.progressLimit, /stay in this tab/i);
  const blob = `${APP_VALUE_COPY.hubLede} ${APP_VALUE_COPY.hubBenefits} ${APP_VALUE_COPY.panelBody} ${APP_VALUE_COPY.socialInvite} ${APP_VALUE_COPY.progressLimit}`;
  assert.doesNotMatch(blob, /transfer(red)? progress|keep your score|same session|synced multiplayer/i);
});

test('cta surfaces are the allowlisted names', () => {
  assert.equal(isAppCtaSurface('hub_nav'), true);
  assert.equal(isAppCtaSurface('install_banner'), false);
});

test('player Home rail goes to the catalog, not the / spinner redirect', async () => {
  const src = await readFile(new URL('../app/games/[id]/page.tsx', import.meta.url), 'utf8');
  assert.match(src, /href="\/games" className="rail-btn" aria-label="Home"/);
  assert.equal(/href="\/" className="rail-btn" aria-label="Home"/.test(src), false);
});
