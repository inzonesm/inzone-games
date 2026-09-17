// Tests for lib/game-display.ts. Uses node --experimental-strip-types so the
// TS module loads directly. Run with:
//   node --experimental-strip-types --test tests/game-display.test.mjs

import { strict as assert } from "node:assert";
import test from "node:test";
import {
  displayNameFromId,
  fallbackGameName,
  normalizeGameIdFromRoute,
} from "../lib/game-display.ts";

test("displayNameFromId drops noise tokens and title-cases the rest", () => {
  assert.equal(displayNameFromId("flappybird-inzone-2"), "Flappybird 2");
  assert.equal(displayNameFromId("neon-blaster-inzone-production"), "Neon Blaster");
  assert.equal(
    displayNameFromId("nightclub-showdown-inzone-production"),
    "Nightclub Showdown",
  );
  assert.equal(displayNameFromId("2048-inzone-upload"), "2048");
  assert.equal(displayNameFromId("tosios-inzone-client"), "Tosios");
  assert.equal(displayNameFromId("flappy-bird"), "Flappy Bird");
  assert.equal(displayNameFromId("kart-bros"), "Kart Bros");
});

test("displayNameFromId returns the id verbatim when every token is noise", () => {
  assert.equal(displayNameFromId("inzone"), "inzone");
  assert.equal(displayNameFromId("inzone-production"), "inzone-production");
  assert.equal(displayNameFromId(""), "");
});

test("fallbackGameName returns the stored name verbatim when present", () => {
  // Respects the existing "Approved catalog title as stored. Do not strip or
  // rewrite." policy from lib/session-prototype.ts::displayGameName.
  assert.equal(fallbackGameName("flappybird-inzone-2", "Flappybird Inzone 2"), "Flappybird Inzone 2");
  assert.equal(fallbackGameName("neon-blaster-inzone-production", "Neon Blaster"), "Neon Blaster");
  assert.equal(fallbackGameName("kart-bros", "Kart Bros"), "Kart Bros");
});

test("fallbackGameName derives from the id only when the stored name is missing", () => {
  assert.equal(fallbackGameName("flappybird-inzone-2", ""), "Flappybird 2");
  assert.equal(fallbackGameName("neon-blaster-inzone-production", null), "Neon Blaster");
  assert.equal(fallbackGameName("kart-bros", undefined), "Kart Bros");
  assert.equal(fallbackGameName("2048-inzone-upload", ""), "2048");
});

test("fallbackGameName trims whitespace-only stored values before falling back", () => {
  assert.equal(fallbackGameName("kart-bros", "   "), "Kart Bros");
});

test("normalizeGameIdFromRoute strips trailing markdown/URL-encoded punctuation", () => {
  // The concrete production shape observed on 2026-09-16 in analytics:
  assert.equal(
    normalizeGameIdFromRoute("nightclub-showdown-inzone-production%60**"),
    "nightclub-showdown-inzone-production",
  );
  assert.equal(
    normalizeGameIdFromRoute("nightclub-showdown-inzone-production*"),
    "nightclub-showdown-inzone-production",
  );
  assert.equal(
    normalizeGameIdFromRoute("nightclub-showdown-inzone-production`"),
    "nightclub-showdown-inzone-production",
  );
  // Bare ids pass through.
  assert.equal(normalizeGameIdFromRoute("neon-blaster-inzone-production"), "neon-blaster-inzone-production");
  // Middle punctuation is preserved — hyphens are meaningful.
  assert.equal(normalizeGameIdFromRoute("neon-blaster-inzone-production"), "neon-blaster-inzone-production");
});
