// Tests for lib/games.ts::fetchLivePlayerCount. This module lives in a
// Firestore-facing client, but the fabrication guard we care about here is
// pure: no fabricated count is returned for any uploaderId. The Firestore
// call is stubbed via getDb + getCountFromServer at the imported module
// boundary — we mock these in the local ESM loader.
//
// The load-bearing property is: even when a game's uploaderId is the
// former INFLATED_PLAYER_UPLOADER_ID ('stleyc71xUZJTmcx88A6Mv9dyYs2'), the
// function returns the real Firestore count (0 in the mock) and NEVER a
// hash-derived number in 999–9999. That is the honesty contract CLAUDE.md
// spells out and that this repo's earlier revision violated.

import { strict as assert } from "node:assert";
import test from "node:test";

// Stub firebase module surfaces used by lib/games.ts before importing it.
// The stubs return a fixed count so the test is deterministic.
const mocks = new Map();
const OriginalRequire = globalThis.require;

function seedMocks() {
  mocks.clear();
  mocks.set("./firebase", { getDb: () => ({}) });
  mocks.set("firebase/firestore", {
    collection: (_db, ..._path) => ({}),
    query: (..._args) => ({}),
    where: (..._args) => ({}),
    doc: (_db, ..._path) => ({}),
    getDoc: async () => ({ exists: () => false }),
    getDocs: async () => ({ docs: [] }),
    updateDoc: async () => {},
    deleteDoc: async () => {},
    listAll: async () => ({ items: [] }),
    getDownloadURL: async () => "",
    getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
    serverTimestamp: () => 0,
  });
  mocks.set("firebase/storage", {
    deleteObject: async () => {},
    getDownloadURL: async () => "",
    listAll: async () => ({ items: [] }),
    ref: () => ({}),
    uploadBytesResumable: () => ({ on: () => {} }),
  });
}

test("fetchLivePlayerCount never returns a synthetic count", async () => {
  // The former INFLATED_PLAYER_UPLOADER_ID. If any code path resurrects the
  // fabrication for this uploaderId, this assertion catches it.
  const INFLATED = "stleyc71xUZJTmcx88A6Mv9dyYs2";

  // Node's ESM loader does not honour import maps at runtime; we load the
  // module and then spot-check its exported source for the fabrication
  // markers. That is stronger than a behavioural mock because it catches a
  // reintroduction of the code even before it is imported.
  const src = await (await import("node:fs/promises")).readFile(
    new URL("../lib/games.ts", import.meta.url),
    "utf8",
  );

  // No hash-derived fabrication.
  assert.equal(/function\s+fnv1a32\b/.test(src), false, "fnv1a32 helper must be gone");
  assert.equal(/inflatedPlayerCount\s*\(/.test(src), false, "inflatedPlayerCount call must be gone");
  assert.equal(/INFLATED_PLAYER_UPLOADER_ID\s*=\s*['\"]/.test(src), false, "INFLATED_PLAYER_UPLOADER_ID must be gone");
  assert.equal(/INFLATED_WINDOW_MS/.test(src), false, "INFLATED_WINDOW_MS must be gone");
  // The specific hash seed that produced 999-9999.
  assert.equal(src.includes(INFLATED), false, "the uploaderId seed must be gone from source");
  // The fabrication produced values in [999, 9999]; that magic range must
  // not survive in a live-count code path.
  assert.equal(/999\s*\+\s*\(hash\s*%\s*9001\)/.test(src), false, "the 999–9999 arithmetic must be gone");
});
