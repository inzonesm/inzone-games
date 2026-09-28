/**
 * Pure URL builders for game links.
 *
 * Split out from lib/games.ts (which pulls in Firebase and can't be
 * imported from Node's --experimental-strip-types test runner). Anything
 * here must stay pure: no browser globals, no Firebase, no DOM.
 *
 * Attribution split — invariants defined together in one place:
 *
 *   gameWebLink           — canonical public URL. NO UTMs. Used where a
 *                           link is embedded (share buttons that call
 *                           navigator.share, meta tags, sitemap).
 *   gameOrganicShareLink  — public URL + utm_source=share &
 *                           utm_medium=organic. Used when the URL is
 *                           copied for a user to paste OUTSIDE the app
 *                           (SMS, DM, WhatsApp), so the recipient's
 *                           arrival is attributable in Hexclave.
 *
 * Invite URLs are a separate surface (liveInviteUrl in play-session-core)
 * and are DELIBERATELY UTM-free — a test in gameplay-signals.test.mjs
 * enforces that. Do not add UTMs to invite URLs from here.
 */

/** The canonical public website URL for a game on inzone.games. Plain
 *  link, no attribution — NOT the app deep link (see gameShareLink for that). */
export function gameWebLink(gameId: string): string {
  return `https://inzone.games/games/${encodeURIComponent(gameId)}`;
}

/**
 * Public game URL with organic-share attribution. Used where the URL is
 * copied for a user to send outside the app (SMS, WhatsApp, DM). The
 * recipient's arrival gets `utm_source=share&utm_medium=organic`,
 * distinguishing organic-share traffic from paid campaigns in Hexclave
 * and the daily report.
 *
 * NOT for invite links — liveInviteUrl deliberately carries no campaign
 * attribution (see the negative test in tests/gameplay-signals.test.mjs).
 * Invite URLs are private per-conversation surfaces; tagging them would
 * commingle a session id with the public campaign_arrival record.
 */
export function gameOrganicShareLink(gameId: string): string {
  const base = gameWebLink(gameId);
  const params = new URLSearchParams({
    utm_source: 'share',
    utm_medium: 'organic',
  });
  return `${base}?${params.toString()}`;
}
