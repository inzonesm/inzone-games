// Tests for the InstallPrompt suppression policy. The predicate decides
// whether the auto-banner renders on the current route, so it directly
// controls whether a paid-social visitor sees "install the app" as their
// first surface.
//
// Run with:
//   node --experimental-strip-types --test tests/install-prompt-suppression.test.mjs

import { strict as assert } from "node:assert";
import test from "node:test";
import { isOnPlayingJourney } from "../lib/install-prompt-policy.ts";

test("suppresses on the entire initial playing journey", () => {
  // Homepage (redirects to /games via HomeRedirect — banner is suppressed for
  // the brief window it renders).
  assert.equal(isOnPlayingJourney("/"), true);
  // Catalog.
  assert.equal(isOnPlayingJourney("/games"), true);
  // Every game player route.
  assert.equal(isOnPlayingJourney("/games/flappybird-inzone-2"), true);
  assert.equal(isOnPlayingJourney("/games/nightclub-showdown-inzone-production"), true);
  assert.equal(isOnPlayingJourney("/games/neon-blaster-inzone-production"), true);
  // With a trailing slash (Next.js sometimes normalises with one).
  assert.equal(isOnPlayingJourney("/games/flappy-bird/"), true);
});

test("keeps the banner available on non-journey routes", () => {
  // Studio / creator surfaces.
  assert.equal(isOnPlayingJourney("/manage"), false);
  assert.equal(isOnPlayingJourney("/upload"), false);
  assert.equal(isOnPlayingJourney("/creators"), false);
  assert.equal(isOnPlayingJourney("/dashboard"), false);
  // Auth / settings.
  assert.equal(isOnPlayingJourney("/login"), false);
  assert.equal(isOnPlayingJourney("/settings"), false);
  // Session prototype (not a public arrival target).
  assert.equal(isOnPlayingJourney("/session-prototype"), false);
});

test("null / undefined pathname does not throw and does not suppress", () => {
  // usePathname returns null before first render on some Next.js versions.
  // The banner is gated by other checks (beforeinstallprompt fired, not
  // dismissed, not standalone) so returning false here is safe.
  assert.equal(isOnPlayingJourney(null), false);
});

test("does not suppress when a similar-looking prefix is not actually /games", () => {
  // Guard against accidental prefix collision: /gamesroom or /games2 must
  // NOT be treated as the playing journey.
  assert.equal(isOnPlayingJourney("/gamesroom"), false);
  assert.equal(isOnPlayingJourney("/games2"), false);
  // But /games followed by a slash IS the player route.
  assert.equal(isOnPlayingJourney("/games/"), true);
});
