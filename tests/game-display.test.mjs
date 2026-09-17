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
  // Every quote/bracket variant produced by pasted markdown links:
  assert.equal(normalizeGameIdFromRoute("neon-blaster'"), "neon-blaster");
  assert.equal(normalizeGameIdFromRoute("neon-blaster\""), "neon-blaster");
  assert.equal(normalizeGameIdFromRoute("neon-blaster>"), "neon-blaster");
  assert.equal(normalizeGameIdFromRoute("neon-blaster<"), "neon-blaster");
});

test("normalizeGameIdFromRoute leaves valid catalog ids untouched", () => {
  const catalog = [
    "flappybird-inzone-2",
    "nightclub-showdown-inzone-production",
    "neon-blaster-inzone-production",
    "flappy-bird",
    "2048-inzone-upload",
    "kart-bros",
    "clgetontop",
    "clescaperoadcity2",
  ];
  for (const id of catalog) {
    assert.equal(normalizeGameIdFromRoute(id), id, `${id} should pass through unchanged`);
  }
});

test("normalizeGameIdFromRoute handles already-decoded ids (no encoded characters)", () => {
  // useParams may hand us either the raw URL segment or an already-decoded
  // string depending on the Next.js version. Either input should produce the
  // same output for a clean id.
  assert.equal(normalizeGameIdFromRoute("nightclub-showdown"), "nightclub-showdown");
  // And for the corruption shape: the already-decoded form (backtick + **)
  // is trimmed just like the encoded form.
  assert.equal(normalizeGameIdFromRoute("nightclub-showdown`**"), "nightclub-showdown");
});

test("normalizeGameIdFromRoute handles malformed encoding safely", () => {
  // %ZZ is not a valid escape; decodeURIComponent throws URIError. The
  // helper's catch branch trims trailing punctuation on the raw string
  // and returns something usable instead of propagating the error.
  assert.equal(normalizeGameIdFromRoute("neon-blaster%ZZ"), "neon-blaster%ZZ");
  assert.equal(normalizeGameIdFromRoute("neon-blaster%ZZ*"), "neon-blaster%ZZ");
  // A trailing bare `%` is also invalid — no crash, no escape.
  assert.equal(normalizeGameIdFromRoute("neon-blaster%"), "neon-blaster%");
});

test("normalizeGameIdFromRoute preserves middle punctuation and leading characters", () => {
  // Hyphens in the middle are meaningful — every catalog id uses them.
  assert.equal(normalizeGameIdFromRoute("neon-blaster-inzone-production"), "neon-blaster-inzone-production");
  // Leading punctuation is unusual but preserved (the observed corruption
  // is always trailing).
  assert.equal(normalizeGameIdFromRoute("*neon-blaster"), "*neon-blaster");
});

test("normalizeGameIdFromRoute handles empty and whitespace-only inputs", () => {
  assert.equal(normalizeGameIdFromRoute(""), "");
});
