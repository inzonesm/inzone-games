/**
 * Shared hub/app + Little Chapters privacy tests for combined Firestore rules.
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
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
const SUPPLIED = readFileSync(
  join(ROOT, 'tests/fixtures/inzone-combined-firestore.rules'),
  'utf8',
);

function normalizeRules(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, '');
}

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

test('firestore.rules matches supplied combined file ignoring comments/whitespace', () => {
  assert.equal(normalizeRules(RULES), normalizeRules(SUPPLIED));
  assert.equal(/match\s+\/\{first\}\s*\/\{document=\*\*\}/.test(RULES), false);
  assert.equal(/match\s+\/\{document=\*\*\}/.test(RULES), false);
  for (const name of [
    'playSessions',
    'parents',
    'readingPets',
    'config',
    'unityGames',
    'ledger_entries',
    'payouts',
    'influencers_referral_stats',
  ]) {
    assert.match(RULES, new RegExp(`match /${name}/\\{`));
  }
});

test('html_games and characters stay world-readable', async () => {
  await seed(['html_games', 'g1'], { name: 'Public game', uploaderId: 'alice' });
  await seed(['characters', 'c1'], { name: 'Ref' });
  const open = guest();
  await assertSucceeds(getDoc(doc(open, 'html_games', 'g1')));
  await assertSucceeds(getDoc(doc(open, 'characters', 'c1')));
});

test('catalog access remains public as supplied', async () => {
  await seed(['unityGames', 'ug1'], { title: 'Unity' });
  await seed(['avatars', 'a1'], { url: 'https://example.com/a.png' });
  await seed(['content', 'c1'], { body: 'public' });
  await seed(['popularCharacters', 'p1'], { name: 'Pop' });
  const open = guest();
  await assertSucceeds(getDoc(doc(open, 'unityGames', 'ug1')));
  await assertSucceeds(getDoc(doc(open, 'avatars', 'a1')));
  await assertSucceeds(getDoc(doc(open, 'content', 'c1')));
  await assertSucceeds(getDoc(doc(open, 'popularCharacters', 'p1')));
  await assertFails(setDoc(doc(open, 'unityGames', 'ug1'), { title: 'Nope' }));
  await assertFails(
    setDoc(doc(authed('alice'), 'unityGames', 'ug1'), { title: 'Nope' }),
  );
});

test('config is signed-in read, write denied', async () => {
  await seed(['config', 'app'], { feature: true });
  await assertFails(getDoc(doc(guest(), 'config', 'app')));
  await assertSucceeds(getDoc(doc(authed('alice'), 'config', 'app')));
  await assertSucceeds(getDoc(doc(authed('bob'), 'config', 'app')));
  await assertFails(
    setDoc(doc(authed('alice'), 'config', 'app'), { feature: false }),
  );
  await assertFails(setDoc(doc(guest(), 'config', 'app'), { feature: false }));
});

test('parents/children/progress/sessions: owner succeeds; others and unsigned fail', async () => {
  const parent = {
    phoneNumber: '+15551234567',
    updatedAt: '2026-09-11T00:00:00Z',
  };
  await seed(['parents', 'alice'], parent);
  await seed(['parents', 'alice', 'children', 'kid1'], { name: 'Kid' });
  await seed(['parents', 'alice', 'children', 'kid1', 'progress', 'p1'], {
    page: 3,
  });
  await seed(['parents', 'alice', 'children', 'kid1', 'sessions', 's1'], {
    minutes: 12,
  });

  const alice = authed('alice');
  const bob = authed('bob');
  const open = guest();

  await assertSucceeds(getDoc(doc(alice, 'parents', 'alice')));
  await assertSucceeds(getDoc(doc(alice, 'parents', 'alice', 'children', 'kid1')));
  await assertSucceeds(
    getDoc(doc(alice, 'parents', 'alice', 'children', 'kid1', 'progress', 'p1')),
  );
  await assertSucceeds(
    getDoc(doc(alice, 'parents', 'alice', 'children', 'kid1', 'sessions', 's1')),
  );

  await assertSucceeds(
    updateDoc(doc(alice, 'parents', 'alice'), {
      phoneNumber: '+447911123456',
      updatedAt: '2026-09-11T01:00:00Z',
    }),
  );
  await assertSucceeds(
    setDoc(doc(alice, 'parents', 'alice', 'children', 'kid1'), { name: 'Kid 2' }),
  );
  await assertSucceeds(
    setDoc(doc(alice, 'parents', 'alice', 'children', 'kid1', 'progress', 'p1'), {
      page: 4,
    }),
  );
  await assertSucceeds(
    setDoc(doc(alice, 'parents', 'alice', 'children', 'kid1', 'sessions', 's1'), {
      minutes: 20,
    }),
  );
  await assertSucceeds(
    setDoc(doc(authed('carol'), 'parents', 'carol'), {
      phoneNumber: '+15559876543',
      updatedAt: '2026-09-11T02:00:00Z',
    }),
  );

  await assertFails(getDoc(doc(bob, 'parents', 'alice')));
  await assertFails(getDoc(doc(bob, 'parents', 'alice', 'children', 'kid1')));
  await assertFails(
    getDoc(doc(bob, 'parents', 'alice', 'children', 'kid1', 'progress', 'p1')),
  );
  await assertFails(
    getDoc(doc(bob, 'parents', 'alice', 'children', 'kid1', 'sessions', 's1')),
  );
  await assertFails(
    setDoc(doc(bob, 'parents', 'alice', 'children', 'kid1'), { name: 'Stolen' }),
  );

  await assertFails(getDoc(doc(open, 'parents', 'alice')));
  await assertFails(getDoc(doc(open, 'parents', 'alice', 'children', 'kid1')));
  await assertFails(
    getDoc(doc(open, 'parents', 'alice', 'children', 'kid1', 'progress', 'p1')),
  );
  await assertFails(
    getDoc(doc(open, 'parents', 'alice', 'children', 'kid1', 'sessions', 's1')),
  );
  await assertFails(
    setDoc(doc(open, 'parents', 'alice'), {
      phoneNumber: '+15551234567',
      updatedAt: 'x',
    }),
  );
});

test('readingPets: owner access succeeds, others fail', async () => {
  await seed(['readingPets', 'alice'], { pet: 'fox', xp: 10 });
  const alice = authed('alice');
  const bob = authed('bob');
  const open = guest();
  await assertSucceeds(getDoc(doc(alice, 'readingPets', 'alice')));
  await assertSucceeds(
    setDoc(doc(alice, 'readingPets', 'alice'), { pet: 'owl', xp: 11 }),
  );
  await assertFails(getDoc(doc(bob, 'readingPets', 'alice')));
  await assertFails(setDoc(doc(bob, 'readingPets', 'alice'), { pet: 'stolen' }));
  await assertFails(getDoc(doc(open, 'readingPets', 'alice')));
  await assertFails(setDoc(doc(open, 'readingPets', 'alice'), { pet: 'guest' }));
});

test('signed-out cannot read humanUsers; signed-in can', async () => {
  await seed(['humanUsers', 'alice'], { displayName: 'Alice' });
  await assertFails(getDoc(doc(guest(), 'humanUsers', 'alice')));
  await assertSucceeds(getDoc(doc(authed('bob'), 'humanUsers', 'alice')));
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
});

test('unknown collections are denied without a catch-all', async () => {
  await seed(['totallyUnknown', 'x'], { leak: true });
  await assertFails(getDoc(doc(guest(), 'totallyUnknown', 'x')));
  await assertFails(getDoc(doc(authed('alice'), 'totallyUnknown', 'x')));
});
