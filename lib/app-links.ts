/**
 * Store destinations and the AppsFlyer OneLink used to hand a phone the
 * InZone app. Reuses the existing OneLink (`join-inzone.onelink.me/SACg`) —
 * no new attribution vendor.
 *
 * Destination checks (re-run `node scripts/onelink-probe.mjs`):
 *   - App Store id 6478089068 returns HTTP 200 (`InZone. App - App Store`).
 *   - Play package `com.aadeshkheria.inzone` returns HTTP 200. og:description
 *     is "A Social gaming superapp built around AI ,3D Avatars, and mindful use."
 *   - Chrome desktop GET of the OneLink 301s to apps.apple.com and the listing
 *     title above. Safari desktop UA can stay on join-inzone.onelink.me (200).
 *     Neither desktop result verifies iOS or Android.
 *   - iPhone Safari UA: OneLink 301 → apps.apple.com → `itms-appss:` store
 *     scheme. That is the iOS destination hop, not proof the App Store app
 *     opened on a device.
 *   - Android Chrome UA: OneLink 301 toward `market:` (Play Store scheme).
 *     curl cannot follow that; it is evidence of a Play destination, not that
 *     an installed app opened.
 *
 * Not verified and must not be promised in UI copy: transferred web scores,
 * session continuity onto the app, shared scoring, or synchronized multiplayer.
 */

export const APP_STORE_URL = 'https://apps.apple.com/us/app/inzone/id6478089068';
export const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.aadeshkheria.inzone&hl=en_US';
export const ONELINK_BASE = 'https://join-inzone.onelink.me/SACg';

/** Surfaces allowed on `cta_surface` for app CTA events. Keep short. */
export const APP_CTA_SURFACES = ['hub_nav', 'social_invite', 'player_rail', 'footer'] as const;
export type AppCtaSurface = (typeof APP_CTA_SURFACES)[number];

export const APP_VALUE_COPY = {
  hubLede: 'Discover games. Play instantly. Bring your friends.',
  hubBenefits: 'The optional InZone app adds 3D avatars and the native social hub.',
  panelTitle: 'Get the InZone app',
  panelBody:
    'A social gaming superapp with 3D avatars, friends, and the native hub on your phone.',
  progressLimit: 'Browser scores and progress stay in this tab.',
  socialInvite: 'The app adds 3D avatars and the native social hub.',
  phoneLinkCopied: 'Phone link copied. Open it on your phone to get the app.',
} as const;

export function isAppCtaSurface(value: string): value is AppCtaSurface {
  return (APP_CTA_SURFACES as readonly string[]).includes(value);
}

/** OneLink for a web-to-app handoff. Distinct `pid` from social_share so
 *  AppsFlyer can separate "Get the app" from in-game share. Never attach a
 *  play-session or invite secret — this is a store/app handoff, not a room. */
export function webAppHandoffLink(opts?: { gameId?: string; pid?: string }): string {
  const params = new URLSearchParams({
    af_xp: 'custom',
    pid: opts?.pid || 'web_get_app',
  });
  const gameId = opts?.gameId?.trim();
  if (gameId && !/^[a-f0-9]{32}$/i.test(gameId)) {
    params.set('deep_link_value', 'community_game');
    params.set('deep_link_sub1', gameId);
    params.set('af_dp', `inzone://game?gameId=${encodeURIComponent(gameId)}`);
  }
  return `${ONELINK_BASE}?${params.toString()}`;
}
