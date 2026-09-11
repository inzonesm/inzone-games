/**
 * Firestore rules authorization tests for playSessions.
 * Run: npm run test:play-session-rules
 * Requires the Firestore emulator (firebase emulators:exec sets this up).
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
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
const GAME = 'nightclub-showdown-inzone-production';

let testEnv;

function sid(n) {
  return String(n).padStart(32, '0');
}

function ctx(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

function openSession(uid, name, extra = {}) {
  return {
    hostId: uid,
    createdAt: serverTimestamp(),
    gameId: GAME,
    status: 'open',
    memberIds: [uid],
    memberNames: { [uid]: name },
    lastPosted: {},
    messages: {},
    latestMessageId: '',
    ...extra,
  };
}

async function seed(id, data) {
  await testEnv.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'playSessions', id), data);
  });
}

function chatPatch(uid, name, text, mid) {
  return {
    [`messages.${mid}`]: {
      type: 'chat',
      senderId: uid,
      senderName: name,
      text,
      createdAt: serverTimestamp(),
    },
    [`lastPosted.${uid}`]: serverTimestamp(),
    latestMessageId: mid,
  };
}

function suggestPatch(uid, name, mid) {
  return {
    [`messages.${mid}`]: {
      type: 'suggest',
      senderId: uid,
      senderName: name,
      text: 'Neon Blaster',
      createdAt: serverTimestamp(),
      gameId: 'neon-blaster',
      gameName: 'Neon Blaster',
      gameIconUrl: 'https://example.com/neon.png',
    },
    [`lastPosted.${uid}`]: serverTimestamp(),
    latestMessageId: mid,
  };
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

test('valid create, join, chat, and suggest', async () => {
  const alice = ctx('alice');
  const bob = ctx('bob');
  const id = sid(1);
  await assertSucceeds(setDoc(doc(alice, 'playSessions', id), openSession('alice', 'Alice')));
  await assertSucceeds(getDoc(doc(alice, 'playSessions', id)));
  await assertSucceeds(
    updateDoc(doc(bob, 'playSessions', id), {
      memberIds: arrayUnion('bob'),
      'memberNames.bob': 'Bob',
    }),
  );
  await assertSucceeds(updateDoc(doc(alice, 'playSessions', id), chatPatch('alice', 'Alice', 'hello', 'm1')));
  await assertSucceeds(updateDoc(doc(bob, 'playSessions', id), suggestPatch('bob', 'Bob', 'm2')));
  const snap = await getDoc(doc(alice, 'playSessions', id));
  assert.equal(snap.data().memberIds.includes('bob'), true);
  assert.equal(Object.keys(snap.data().messages).length, 2);
});

test('unauthenticated access is denied', async () => {
  const open = testEnv.unauthenticatedContext().firestore();
  const id = sid(2);
  await assertFails(setDoc(doc(open, 'playSessions', id), openSession('guest_abc', 'Guest')));
  await seed(id, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'open',
    memberIds: ['alice'],
    memberNames: { alice: 'Alice' },
    lastPosted: {},
    messages: {},
    latestMessageId: '',
  });
  await assertFails(getDoc(doc(open, 'playSessions', id)));
  await assertFails(
    updateDoc(doc(open, 'playSessions', id), {
      memberIds: arrayUnion('intruder'),
      'memberNames.intruder': 'X',
    }),
  );
});

test('impersonation on create and message senderId is denied', async () => {
  const bob = ctx('bob');
  const id = sid(3);
  await assertFails(
    setDoc(doc(bob, 'playSessions', id), openSession('alice', 'Alice')),
  );
  await assertFails(
    setDoc(doc(bob, 'playSessions', id), {
      ...openSession('bob', 'Bob'),
      memberIds: ['guest_cookie_id'],
      memberNames: { guest_cookie_id: 'Guest' },
    }),
  );
  await seed(id, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'open',
    memberIds: ['alice', 'bob'],
    memberNames: { alice: 'Alice', bob: 'Bob' },
    lastPosted: {},
    messages: {},
    latestMessageId: '',
  });
  await assertFails(
    updateDoc(doc(bob, 'playSessions', id), chatPatch('alice', 'Alice', 'spoof', 'mx')),
  );
});

test('non-member cannot post, list, or read an ended session', async () => {
  const alice = ctx('alice');
  const carol = ctx('carol');
  const openId = sid(4);
  const endedId = sid(5);
  await seed(openId, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'open',
    memberIds: ['alice'],
    memberNames: { alice: 'Alice' },
    lastPosted: {},
    messages: {},
    latestMessageId: '',
  });
  await assertSucceeds(getDoc(doc(carol, 'playSessions', openId)));
  await assertFails(updateDoc(doc(carol, 'playSessions', openId), chatPatch('carol', 'Carol', 'nope', 'm1')));
  await assertFails(getDocs(query(collection(alice, 'playSessions'), limit(10))));
  await seed(endedId, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'ended',
    memberIds: [],
    memberNames: {},
    lastPosted: {},
    messages: {},
    latestMessageId: '',
  });
  await assertFails(getDoc(doc(carol, 'playSessions', endedId)));
});

test('member cannot tamper with host, others, or lastPosted alone', async () => {
  const alice = ctx('alice');
  const bob = ctx('bob');
  const id = sid(6);
  await seed(id, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'open',
    memberIds: ['alice', 'bob'],
    memberNames: { alice: 'Alice', bob: 'Bob' },
    lastPosted: {},
    messages: {},
    latestMessageId: '',
  });
  await assertFails(updateDoc(doc(bob, 'playSessions', id), { hostId: 'bob' }));
  await assertFails(updateDoc(doc(bob, 'playSessions', id), { gameId: 'hijacked' }));
  await assertFails(updateDoc(doc(bob, 'playSessions', id), { 'memberNames.alice': 'Hacked' }));
  await assertFails(updateDoc(doc(bob, 'playSessions', id), { memberIds: ['bob'] }));
  await assertFails(
    updateDoc(doc(bob, 'playSessions', id), { 'lastPosted.bob': serverTimestamp() }),
  );
  await assertFails(
    updateDoc(doc(alice, 'playSessions', id), { 'lastPosted.alice': Timestamp.fromMillis(1) }),
  );
  await assertSucceeds(getDoc(doc(alice, 'playSessions', id)));
});

test('expired and ended sessions reject join and chat', async () => {
  const alice = ctx('alice');
  const bob = ctx('bob');
  const expiredId = sid(7);
  const endedId = sid(8);
  await seed(expiredId, {
    hostId: 'alice',
    createdAt: Timestamp.fromMillis(Date.now() - 25 * 60 * 60 * 1000),
    gameId: GAME,
    status: 'open',
    memberIds: ['alice'],
    memberNames: { alice: 'Alice' },
    lastPosted: {},
    messages: {},
    latestMessageId: '',
  });
  await assertFails(
    updateDoc(doc(bob, 'playSessions', expiredId), {
      memberIds: arrayUnion('bob'),
      'memberNames.bob': 'Bob',
    }),
  );
  await assertFails(updateDoc(doc(alice, 'playSessions', expiredId), chatPatch('alice', 'Alice', 'late', 'm1')));
  await seed(endedId, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'ended',
    memberIds: ['alice'],
    memberNames: { alice: 'Alice' },
    lastPosted: {},
    messages: {},
    latestMessageId: '',
  });
  await assertFails(
    updateDoc(doc(bob, 'playSessions', endedId), {
      memberIds: arrayUnion('bob'),
      'memberNames.bob': 'Bob',
    }),
  );
  await assertFails(updateDoc(doc(alice, 'playSessions', endedId), chatPatch('alice', 'Alice', 'nope', 'm1')));
});

test('posting after leaving is denied', async () => {
  const alice = ctx('alice');
  const bob = ctx('bob');
  const id = sid(9);
  await seed(id, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'open',
    memberIds: ['alice', 'bob'],
    memberNames: { alice: 'Alice', bob: 'Bob' },
    lastPosted: {},
    messages: {},
    latestMessageId: '',
  });
  await assertSucceeds(
    updateDoc(doc(bob, 'playSessions', id), {
      memberIds: ['alice'],
      'memberNames.bob': deleteField(),
    }),
  );
  await assertFails(updateDoc(doc(bob, 'playSessions', id), chatPatch('bob', 'Bob', 'after leave', 'm9')));
  await assertSucceeds(updateDoc(doc(alice, 'playSessions', id), chatPatch('alice', 'Alice', 'still here', 'm1')));
});

test('leave removes only self; last member ends the session', async () => {
  const alice = ctx('alice');
  const bob = ctx('bob');
  const id = sid(10);
  await seed(id, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'open',
    memberIds: ['alice', 'bob'],
    memberNames: { alice: 'Alice', bob: 'Bob' },
    lastPosted: {},
    messages: {},
    latestMessageId: '',
  });
  await assertSucceeds(
    updateDoc(doc(bob, 'playSessions', id), {
      memberIds: ['alice'],
      'memberNames.bob': deleteField(),
    }),
  );
  await assertFails(updateDoc(doc(bob, 'playSessions', id), chatPatch('bob', 'Bob', 'after', 'm9')));
  await assertSucceeds(
    updateDoc(doc(alice, 'playSessions', id), {
      memberIds: [],
      'memberNames.alice': deleteField(),
      status: 'ended',
    }),
  );
});

test('rate-limit bypass (client time / extra messages / stale lastPosted) is denied', async () => {
  const alice = ctx('alice');
  const id = sid(11);
  await seed(id, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'open',
    memberIds: ['alice'],
    memberNames: { alice: 'Alice' },
    lastPosted: {},
    messages: {},
    latestMessageId: '',
  });
  await assertSucceeds(updateDoc(doc(alice, 'playSessions', id), chatPatch('alice', 'Alice', 'first', 'm1')));
  await assertFails(updateDoc(doc(alice, 'playSessions', id), chatPatch('alice', 'Alice', 'second', 'm2')));
  await assertFails(
    updateDoc(doc(alice, 'playSessions', id), {
      'messages.m2': {
        type: 'chat',
        senderId: 'alice',
        senderName: 'Alice',
        text: 'bypass',
        createdAt: Timestamp.fromMillis(Date.now() + 60_000),
      },
      'lastPosted.alice': Timestamp.fromMillis(1),
      latestMessageId: 'm2',
    }),
  );
  const many = {};
  many['messages.m2'] = {
    type: 'chat',
    senderId: 'alice',
    senderName: 'Alice',
    text: 'two',
    createdAt: serverTimestamp(),
  };
  many['messages.m3'] = {
    type: 'chat',
    senderId: 'alice',
    senderName: 'Alice',
    text: 'three',
    createdAt: serverTimestamp(),
  };
  many['lastPosted.alice'] = serverTimestamp();
  many.latestMessageId = 'm3';
  await assertFails(updateDoc(doc(alice, 'playSessions', id), many));
});

test('concurrent joins both succeed via arrayUnion', async () => {
  const alice = ctx('alice');
  const bob = ctx('bob');
  const carol = ctx('carol');
  const id = sid(12);
  await seed(id, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'open',
    memberIds: ['alice'],
    memberNames: { alice: 'Alice' },
    lastPosted: {},
    messages: {},
    latestMessageId: '',
  });
  await Promise.all([
    assertSucceeds(
      updateDoc(doc(bob, 'playSessions', id), {
        memberIds: arrayUnion('bob'),
        'memberNames.bob': 'Bob',
      }),
    ),
    assertSucceeds(
      updateDoc(doc(carol, 'playSessions', id), {
        memberIds: arrayUnion('carol'),
        'memberNames.carol': 'Carol',
      }),
    ),
  ]);
  const snap = await getDoc(doc(alice, 'playSessions', id));
  const ids = snap.data().memberIds;
  assert.equal(ids.includes('bob'), true);
  assert.equal(ids.includes('carol'), true);
});

test('message map is bounded; suggestion payload is validated', async () => {
  const alice = ctx('alice');
  const id = sid(13);
  const messages = {};
  for (let i = 0; i < 80; i++) {
    messages[`n${i}`] = {
      type: 'chat',
      senderId: 'alice',
      senderName: 'Alice',
      text: 'x',
      createdAt: Timestamp.now(),
    };
  }
  await seed(id, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'open',
    memberIds: ['alice'],
    memberNames: { alice: 'Alice' },
    lastPosted: {},
    messages,
    latestMessageId: 'n79',
  });
  await assertFails(updateDoc(doc(alice, 'playSessions', id), chatPatch('alice', 'Alice', 'overflow', 'n80')));
  const id2 = sid(14);
  await seed(id2, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'open',
    memberIds: ['alice'],
    memberNames: { alice: 'Alice' },
    lastPosted: {},
    messages: {},
    latestMessageId: '',
  });
  await assertFails(
    updateDoc(doc(alice, 'playSessions', id2), {
      'messages.s1': {
        type: 'suggest',
        senderId: 'alice',
        senderName: 'Alice',
        text: 'x',
        createdAt: serverTimestamp(),
        gameId: '',
        gameName: 'X',
        gameIconUrl: '',
      },
      'lastPosted.alice': serverTimestamp(),
      latestMessageId: 's1',
    }),
  );
});

test('catch-all does not publicly read playSessions; html_games stay public', async () => {
  const open = testEnv.unauthenticatedContext().firestore();
  const id = sid(15);
  await seed(id, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'open',
    memberIds: ['alice'],
    memberNames: { alice: 'Alice' },
    lastPosted: {},
    messages: {},
    latestMessageId: '',
  });
  await assertFails(getDoc(doc(open, 'playSessions', id)));
  await testEnv.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'html_games', 'g1'), { name: 'Public game' });
    await setDoc(doc(c.firestore(), 'characters', 'c1'), { name: 'Ref' });
  });
  await assertSucceeds(getDoc(doc(open, 'html_games', 'g1')));
  await assertSucceeds(getDoc(doc(open, 'characters', 'c1')));
});
