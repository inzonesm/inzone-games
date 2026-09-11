/**
 * Shared hub/app privacy tests for combined Firestore rules
 * (explicit collections + playSessions, no public-read catch-all).
 * Run: npm run test:play-session-rules
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');

let testEnv;

function authed(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

function guest() {
  return testEnv.unauthenticatedContext().firestore();
}

async function seed(pathSegments, data) {
  await testEnv.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), ...pathSegments), data);
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-inzone',
    firestore: { rules: RULES },
  });
});

after(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

test('rules file has no public-read catch-all', () => {
  assert.equal(/match\s+\/\{first\}\s*\/\{document=\*\*\}/.test(RULES), false);
  assert.equal(/match\s+\/\{document=\*\*\}/.test(RULES), false);
  assert.match(RULES, /match \/playSessions\/\{sessionId\}/);
  assert.match(RULES, /game_player_state \(Little Chapters saves\)/);
});

test('html_games and characters stay world-readable', async () => {
  await seed(['html_games', 'g1'], { name: 'Public game', uploaderId: 'alice' });
  await seed(['characters', 'c1'], { name: 'Ref' });
  const open = guest();
  await assertSucceeds(getDoc(doc(open, 'html_games', 'g1')));
  await assertSucceeds(getDoc(doc(open, 'characters', 'c1')));
});

test('signed-out cannot read humanUsers; signed-in can', async () => {
  await seed(['humanUsers', 'alice'], { displayName: 'Alice' });
  await assertFails(getDoc(doc(guest(), 'humanUsers', 'alice')));
  await assertSucceeds(getDoc(doc(authed('bob'), 'humanUsers', 'alice')));
});

test('humanUsers writes are own-doc only', async () => {
  await seed(['humanUsers', 'alice'], { displayName: 'Alice' });
  await assertSucceeds(
    updateDoc(doc(authed('alice'), 'humanUsers', 'alice'), { displayName: 'A2' }),
  );
  await assertFails(
    updateDoc(doc(authed('bob'), 'humanUsers', 'alice'), { displayName: 'Nope' }),
  );
  await assertFails(
    setDoc(doc(guest(), 'humanUsers', 'alice'), { displayName: 'Guest' }),
  );
});

test('influencer private docs are owner-only (not world-readable)', async () => {
  await seed(['influencers', 'alice'], { uid: 'alice', handle: 'a' });
  await seed(['influencers', 'alice', 'private', 'payout'], {
    account: 'secret-iban',
  });
  const open = guest();
  await assertSucceeds(getDoc(doc(open, 'influencers', 'alice')));
  await assertFails(getDoc(doc(open, 'influencers', 'alice', 'private', 'payout')));
  await assertFails(
    getDoc(doc(authed('bob'), 'influencers', 'alice', 'private', 'payout')),
  );
  await assertSucceeds(
    getDoc(doc(authed('alice'), 'influencers', 'alice', 'private', 'payout')),
  );
  await assertSucceeds(
    setDoc(doc(authed('alice'), 'influencers', 'alice', 'private', 'payout'), {
      account: 'updated',
    }),
  );
  await assertFails(
    setDoc(doc(authed('bob'), 'influencers', 'alice', 'private', 'payout'), {
      account: 'stolen',
    }),
  );
});

test('Little Chapters game_player_state is denied to clients', async () => {
  await seed(['game_player_state', 'alice_nightclub'], {
    uid: 'alice',
    gameId: 'nightclub',
    save: { chapter: 3, inventory: ['key'] },
  });
  const open = guest();
  const alice = authed('alice');
  const bob = authed('bob');
  await assertFails(getDoc(doc(open, 'game_player_state', 'alice_nightclub')));
  await assertFails(getDoc(doc(alice, 'game_player_state', 'alice_nightclub')));
  await assertFails(getDoc(doc(bob, 'game_player_state', 'alice_nightclub')));
  await assertFails(getDocs(collection(open, 'game_player_state')));
  await assertFails(getDocs(collection(alice, 'game_player_state')));
  await assertFails(
    setDoc(doc(alice, 'game_player_state', 'alice_nightclub'), { save: {} }),
  );
});

test('other backend-only collections stay client-denied', async () => {
  const paths = [
    ['Revenue', 'r1'],
    ['game_activity', 'a1'],
    ['game_player_activity', 'p1'],
    ['waitlist', 'w1'],
    ['aiInteractions', 'i1'],
  ];
  for (const segs of paths) {
    await seed(segs, { secret: true });
  }
  const open = guest();
  const alice = authed('alice');
  for (const segs of paths) {
    await assertFails(getDoc(doc(open, ...segs)));
    await assertFails(getDoc(doc(alice, ...segs)));
    await assertFails(setDoc(doc(alice, ...segs), { secret: false }));
  }
});

test('DM conversations are participant-only', async () => {
  await seed(['conversations', 'c1'], { participants: ['alice', 'bob'] });
  await seed(['conversations', 'c1', 'messages', 'm1'], {
    senderId: 'alice',
    text: 'hi',
  });
  await assertFails(getDoc(doc(guest(), 'conversations', 'c1')));
  await assertFails(getDoc(doc(authed('carol'), 'conversations', 'c1')));
  await assertSucceeds(getDoc(doc(authed('alice'), 'conversations', 'c1')));
  await assertFails(
    getDoc(doc(authed('carol'), 'conversations', 'c1', 'messages', 'm1')),
  );
  await assertSucceeds(
    getDoc(doc(authed('bob'), 'conversations', 'c1', 'messages', 'm1')),
  );
});

test('unknown collections are denied without a catch-all', async () => {
  await seed(['totallyUnknown', 'x'], { leak: true });
  await assertFails(getDoc(doc(guest(), 'totallyUnknown', 'x')));
  await assertFails(getDoc(doc(authed('alice'), 'totallyUnknown', 'x')));
});
