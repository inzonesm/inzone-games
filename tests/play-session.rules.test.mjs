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
  arrayRemove,
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

function sessionRef(db, id) {
  return doc(db, 'playSessions', id);
}

function chunkRef(db, id, seq) {
  return doc(db, 'playSessions', id, 'chunks', String(seq));
}

function seatDoc(db, id, uid) {
  return doc(db, 'playSessions', id, 'seats', uid);
}

function openSession(uid, name, extra = {}) {
  return {
    hostId: uid,
    createdAt: serverTimestamp(),
    gameId: GAME,
    status: 'open',
    memberIds: [uid],
    memberNames: { [uid]: name },
    latestSeq: 0,
    ...extra,
  };
}

async function seed(id, data) {
  await testEnv.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'playSessions', id), { latestSeq: 0, ...data });
  });
}

async function seedChunk(id, seq, data) {
  await testEnv.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'playSessions', id, 'chunks', String(seq)), data);
  });
}

function fullMessages(uid, name, seq) {
  const messages = {};
  for (let i = 0; i < 40; i++) {
    messages[`c${seq}_${i}`] = {
      type: 'chat',
      senderId: uid,
      senderName: name,
      text: 'x',
      createdAt: Timestamp.fromMillis(1 + i),
    };
  }
  return messages;
}

function fullChunk(uid, name, seq) {
  const messages = fullMessages(uid, name, seq);
  return {
    seq,
    messages,
    lastPosted: { [uid]: Timestamp.fromMillis(Date.now() - 60_000) },
    latestMessageId: `c${seq}_39`,
    memberIds: [uid],
  };
}

function chatCreate(uid, name, text, mid, seq = 0, lastPosted = null, memberIds = null) {
  return {
    seq,
    messages: {
      [mid]: {
        type: 'chat',
        senderId: uid,
        senderName: name,
        text,
        createdAt: serverTimestamp(),
      },
    },
    lastPosted: lastPosted || { [uid]: serverTimestamp() },
    latestMessageId: mid,
    memberIds: memberIds || [uid],
  };
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
  await assertSucceeds(setDoc(sessionRef(alice, id), openSession('alice', 'Alice')));
  await assertSucceeds(getDoc(sessionRef(alice, id)));
  await assertSucceeds(
    updateDoc(sessionRef(bob, id), {
      memberIds: arrayUnion('bob'),
      'memberNames.bob': 'Bob',
    }),
  );
  await assertSucceeds(setDoc(chunkRef(alice, id, 0), chatCreate('alice', 'Alice', 'hello', 'm1', 0, null, ['alice', 'bob'])));
  await assertSucceeds(updateDoc(chunkRef(bob, id, 0), suggestPatch('bob', 'Bob', 'm2')));
  await assertSucceeds(getDoc(chunkRef(bob, id, 0)));
  await assertFails(
    getDocs(query(collection(bob, 'playSessions', id, 'chunks'), limit(2))),
  );
  const snap = await getDoc(sessionRef(alice, id));
  assert.equal(snap.data().memberIds.includes('bob'), true);
  assert.equal(snap.data().messages, undefined);
  const chunk = await getDoc(chunkRef(alice, id, 0));
  assert.equal(Object.keys(chunk.data().messages).length, 2);
});

test('unauthenticated access is denied', async () => {
  const open = testEnv.unauthenticatedContext().firestore();
  const id = sid(2);
  await assertFails(setDoc(sessionRef(open, id), openSession('guest_abc', 'Guest')));
  await seed(id, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'open',
    memberIds: ['alice'],
    memberNames: { alice: 'Alice' },
  });
  await seedChunk(id, 0, fullChunk('alice', 'Alice', 0));
  await assertFails(getDoc(sessionRef(open, id)));
  await assertFails(getDoc(chunkRef(open, id, 0)));
  await assertFails(
    updateDoc(sessionRef(open, id), {
      memberIds: arrayUnion('intruder'),
      'memberNames.intruder': 'X',
    }),
  );
});

test('impersonation on create and message senderId is denied', async () => {
  const bob = ctx('bob');
  const id = sid(3);
  await assertFails(setDoc(sessionRef(bob, id), openSession('alice', 'Alice')));
  await assertFails(
    setDoc(sessionRef(bob, id), {
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
  });
  await seedChunk(id, 0, {
    seq: 0,
    messages: {},
    lastPosted: {},
    latestMessageId: '',
    memberIds: ['alice'],
  });
  await assertFails(updateDoc(chunkRef(bob, id, 0), chatPatch('alice', 'Alice', 'spoof', 'mx')));
});

test('non-member can peek preview but cannot read chunks, list, or ended sessions', async () => {
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
  });
  await seedChunk(openId, 0, fullChunk('alice', 'Alice', 0));
  const preview = await getDoc(sessionRef(carol, openId));
  assert.equal(preview.exists(), true);
  assert.equal(preview.data().messages, undefined);
  await assertFails(getDoc(chunkRef(carol, openId, 0)));
  await assertFails(getDocs(collection(carol, 'playSessions', openId, 'chunks')));
  await assertFails(updateDoc(chunkRef(carol, openId, 0), chatPatch('carol', 'Carol', 'nope', 'm1')));
  await assertFails(getDocs(query(collection(alice, 'playSessions'), limit(10))));
  await seed(endedId, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'ended',
    memberIds: [],
    memberNames: {},
  });
  await assertFails(getDoc(sessionRef(carol, endedId)));
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
  });
  await seedChunk(id, 0, {
    seq: 0,
    messages: {},
    lastPosted: {},
    latestMessageId: '',
    memberIds: ['alice'],
  });
  await assertFails(updateDoc(sessionRef(bob, id), { hostId: 'bob' }));
  await assertFails(updateDoc(sessionRef(bob, id), { gameId: 'hijacked' }));
  await assertFails(updateDoc(sessionRef(bob, id), { 'memberNames.alice': 'Hacked' }));
  await assertFails(updateDoc(sessionRef(bob, id), { memberIds: ['bob'] }));
  await assertFails(updateDoc(chunkRef(bob, id, 0), { 'lastPosted.bob': serverTimestamp() }));
  await assertFails(updateDoc(chunkRef(alice, id, 0), { 'lastPosted.alice': Timestamp.fromMillis(1) }));
  await assertSucceeds(getDoc(sessionRef(alice, id)));
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
  });
  await seedChunk(expiredId, 0, {
    seq: 0,
    messages: {},
    lastPosted: {},
    latestMessageId: '',
    memberIds: ['alice'],
  });
  await assertFails(
    updateDoc(sessionRef(bob, expiredId), {
      memberIds: arrayUnion('bob'),
      'memberNames.bob': 'Bob',
    }),
  );
  await assertFails(updateDoc(chunkRef(alice, expiredId, 0), chatPatch('alice', 'Alice', 'late', 'm1')));
  await seed(endedId, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'ended',
    memberIds: ['alice'],
    memberNames: { alice: 'Alice' },
  });
  await seedChunk(endedId, 0, {
    seq: 0,
    messages: {},
    lastPosted: {},
    latestMessageId: '',
    memberIds: ['alice'],
  });
  await assertFails(
    updateDoc(sessionRef(bob, endedId), {
      memberIds: arrayUnion('bob'),
      'memberNames.bob': 'Bob',
    }),
  );
  await assertFails(updateDoc(chunkRef(alice, endedId, 0), chatPatch('alice', 'Alice', 'nope', 'm1')));
});

test('posting and chunk reads after leaving are denied', async () => {
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
  });
  await seedChunk(id, 0, {
    seq: 0,
    messages: fullMessages('alice', 'Alice', 0),
    lastPosted: { alice: Timestamp.fromMillis(Date.now() - 60_000) },
    latestMessageId: 'c0_39',
    memberIds: ['alice', 'bob'],
  });
  await assertSucceeds(getDoc(chunkRef(bob, id, 0)));
  await assertSucceeds(
    updateDoc(sessionRef(bob, id), {
      memberIds: ['alice'],
      'memberNames.bob': deleteField(),
    }),
  );
  await assertFails(getDoc(chunkRef(bob, id, 0)));
  await assertSucceeds(updateDoc(chunkRef(bob, id, 0), { memberIds: arrayRemove('bob') }));
  await assertFails(getDoc(chunkRef(bob, id, 0)));
  await assertFails(getDocs(collection(bob, 'playSessions', id, 'chunks')));
  await assertFails(updateDoc(chunkRef(bob, id, 0), chatPatch('bob', 'Bob', 'after leave', 'm9')));
  await assertSucceeds(getDoc(sessionRef(bob, id)));
  await assertSucceeds(getDoc(chunkRef(alice, id, 0)));
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
  });
  await assertSucceeds(
    updateDoc(sessionRef(bob, id), {
      memberIds: ['alice'],
      'memberNames.bob': deleteField(),
    }),
  );
  await assertFails(updateDoc(chunkRef(bob, id, 0), chatPatch('bob', 'Bob', 'after', 'm9')));
  await assertSucceeds(
    updateDoc(sessionRef(alice, id), {
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
  });
  await assertSucceeds(setDoc(chunkRef(alice, id, 0), chatCreate('alice', 'Alice', 'first', 'm1')));
  await assertFails(updateDoc(chunkRef(alice, id, 0), chatPatch('alice', 'Alice', 'second', 'm2')));
  await assertFails(
    updateDoc(chunkRef(alice, id, 0), {
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
  await assertFails(updateDoc(chunkRef(alice, id, 0), many));
  await assertFails(
    updateDoc(chunkRef(alice, id, 0), {
      'messages.m1.text': 'rewritten',
    }),
  );
});

test('append cannot rewrite an existing message in the same write', async () => {
  const alice = ctx('alice');
  const id = sid(20);
  await seed(id, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'open',
    memberIds: ['alice'],
    memberNames: { alice: 'Alice' },
  });
  await seedChunk(id, 0, {
    seq: 0,
    messages: {
      m1: {
        type: 'chat',
        senderId: 'alice',
        senderName: 'Alice',
        text: 'first',
        createdAt: Timestamp.fromMillis(1),
      },
    },
    lastPosted: { alice: Timestamp.fromMillis(Date.now() - 60_000) },
    latestMessageId: 'm1',
    memberIds: ['alice'],
  });
  await assertFails(
    updateDoc(chunkRef(alice, id, 0), {
      'messages.m2': {
        type: 'chat',
        senderId: 'alice',
        senderName: 'Alice',
        text: 'second',
        createdAt: serverTimestamp(),
      },
      'messages.m1.text': 'rewritten',
      'lastPosted.alice': serverTimestamp(),
      latestMessageId: 'm2',
    }),
  );
  await assertSucceeds(updateDoc(chunkRef(alice, id, 0), chatPatch('alice', 'Alice', 'second', 'm2')));
  const snap = await getDoc(chunkRef(alice, id, 0));
  assert.equal(snap.data().messages.m1.text, 'first');
  assert.equal(snap.data().messages.m2.text, 'second');
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
  });
  await Promise.all([
    assertSucceeds(
      updateDoc(sessionRef(bob, id), {
        memberIds: arrayUnion('bob'),
        'memberNames.bob': 'Bob',
      }),
    ),
    assertSucceeds(
      updateDoc(sessionRef(carol, id), {
        memberIds: arrayUnion('carol'),
        'memberNames.carol': 'Carol',
      }),
    ),
  ]);
  const snap = await getDoc(sessionRef(alice, id));
  const ids = snap.data().memberIds;
  assert.equal(ids.includes('bob'), true);
  assert.equal(ids.includes('carol'), true);
});

test('chunk is capped at 40; conversation continues on the next chunk past 80', async () => {
  const alice = ctx('alice');
  const id = sid(13);
  await seed(id, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'open',
    memberIds: ['alice'],
    memberNames: { alice: 'Alice' },
  });
  await seedChunk(id, 0, fullChunk('alice', 'Alice', 0));
  await assertFails(updateDoc(chunkRef(alice, id, 0), chatPatch('alice', 'Alice', 'overflow', 'n40')));
  await assertSucceeds(
    setDoc(
      chunkRef(alice, id, 1),
      chatCreate('alice', 'Alice', 'forty-one', 'n40', 1, { alice: serverTimestamp() }),
    ),
  );

  const id2 = sid(14);
  await seed(id2, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'open',
    memberIds: ['alice'],
    memberNames: { alice: 'Alice' },
  });
  await seedChunk(id2, 0, fullChunk('alice', 'Alice', 0));
  await seedChunk(id2, 1, fullChunk('alice', 'Alice', 1));
  await assertSucceeds(
    setDoc(
      chunkRef(alice, id2, 2),
      chatCreate('alice', 'Alice', 'eighty-one', 'm81', 2, { alice: serverTimestamp() }),
    ),
  );
  const eightyFirst = await getDoc(chunkRef(alice, id2, 2));
  assert.equal(eightyFirst.data().messages.m81.text, 'eighty-one');
  await assertSucceeds(getDoc(chunkRef(alice, id2, 1)));
  await assertSucceeds(getDoc(chunkRef(alice, id2, 2)));
  await assertFails(
    getDocs(query(collection(alice, 'playSessions', id2, 'chunks'), limit(3))),
  );
  await assertFails(getDocs(collection(alice, 'playSessions', id2, 'chunks')));

  const id3 = sid(16);
  await seed(id3, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'open',
    memberIds: ['alice'],
    memberNames: { alice: 'Alice' },
  });
  await seedChunk(id3, 0, {
    seq: 0,
    messages: {},
    lastPosted: {},
    latestMessageId: '',
    memberIds: ['alice'],
  });
  await assertFails(
    updateDoc(chunkRef(alice, id3, 0), {
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

test('seats are self-only and require membership', async () => {
  const alice = ctx('alice');
  const bob = ctx('bob');
  const id = sid(17);
  await seed(id, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'open',
    memberIds: ['alice', 'bob'],
    memberNames: { alice: 'Alice', bob: 'Bob' },
  });
  await assertSucceeds(getDoc(seatDoc(alice, id, 'alice')));
  await assertSucceeds(
    setDoc(seatDoc(alice, id, 'alice'), { gameId: 'neon-blaster', updatedAt: serverTimestamp() }),
  );
  await assertSucceeds(getDoc(seatDoc(alice, id, 'alice')));
  await assertFails(getDoc(seatDoc(bob, id, 'alice')));
  await assertFails(
    setDoc(seatDoc(bob, id, 'alice'), { gameId: 'hijack', updatedAt: serverTimestamp() }),
  );
  await assertSucceeds(
    setDoc(seatDoc(bob, id, 'bob'), { gameId: GAME, updatedAt: serverTimestamp() }),
  );
  await assertFails(getDocs(collection(alice, 'playSessions', id, 'seats')));
});

test('chunk reads follow parent membership, not copied memberIds', async () => {
  const alice = ctx('alice');
  const bob = ctx('bob');
  const carol = ctx('carol');
  const id = sid(18);
  await seed(id, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'open',
    memberIds: ['alice', 'bob'],
    memberNames: { alice: 'Alice', bob: 'Bob' },
  });
  await seedChunk(id, 0, {
    ...fullChunk('alice', 'Alice', 0),
    memberIds: ['alice', 'carol'],
  });
  await assertSucceeds(getDoc(chunkRef(bob, id, 0)));
  await assertFails(getDoc(chunkRef(carol, id, 0)));
  const missing = await getDoc(chunkRef(alice, id, 9));
  assert.equal(missing.exists(), false);
});

test('parent-only leave and leave after three chunks deny all conversation reads', async () => {
  const alice = ctx('alice');
  const bob = ctx('bob');
  const id = sid(21);
  await seed(id, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'open',
    memberIds: ['alice', 'bob'],
    memberNames: { alice: 'Alice', bob: 'Bob' },
    latestSeq: 2,
  });
  await seedChunk(id, 0, { ...fullChunk('alice', 'Alice', 0), memberIds: ['alice', 'bob'] });
  await seedChunk(id, 1, { ...fullChunk('alice', 'Alice', 1), memberIds: ['alice', 'bob'] });
  await seedChunk(id, 2, { ...fullChunk('alice', 'Alice', 2), memberIds: ['alice', 'bob'] });

  await assertSucceeds(getDoc(chunkRef(bob, id, 0)));
  await assertSucceeds(
    updateDoc(sessionRef(bob, id), {
      memberIds: ['alice'],
      'memberNames.bob': deleteField(),
    }),
  );
  await assertFails(getDoc(chunkRef(bob, id, 0)));
  await assertFails(getDoc(chunkRef(bob, id, 1)));
  await assertFails(getDoc(chunkRef(bob, id, 2)));
  await assertSucceeds(getDoc(chunkRef(alice, id, 0)));
  await assertSucceeds(getDoc(chunkRef(alice, id, 1)));
  await assertSucceeds(getDoc(chunkRef(alice, id, 2)));

  await assertSucceeds(
    updateDoc(sessionRef(bob, id), {
      memberIds: arrayUnion('bob'),
      'memberNames.bob': 'Bob',
    }),
  );
  await assertSucceeds(getDoc(chunkRef(bob, id, 0)));
  await assertSucceeds(getDoc(chunkRef(bob, id, 1)));
  await assertSucceeds(getDoc(chunkRef(bob, id, 2)));
});

test('latestSeq may only advance by one onto an existing chunk', async () => {
  const alice = ctx('alice');
  const id = sid(19);
  await seed(id, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'open',
    memberIds: ['alice'],
    memberNames: { alice: 'Alice' },
    latestSeq: 0,
  });
  await assertFails(updateDoc(sessionRef(alice, id), { latestSeq: 1 }));
  await seedChunk(id, 1, fullChunk('alice', 'Alice', 1));
  await assertSucceeds(updateDoc(sessionRef(alice, id), { latestSeq: 1 }));
  await assertFails(updateDoc(sessionRef(alice, id), { latestSeq: 3 }));
});

test('unsigned clients cannot read playSessions; html_games stay public', async () => {
  const open = testEnv.unauthenticatedContext().firestore();
  const id = sid(15);
  await seed(id, {
    hostId: 'alice',
    createdAt: Timestamp.now(),
    gameId: GAME,
    status: 'open',
    memberIds: ['alice'],
    memberNames: { alice: 'Alice' },
  });
  await seedChunk(id, 0, fullChunk('alice', 'Alice', 0));
  await assertFails(getDoc(sessionRef(open, id)));
  await assertFails(getDoc(chunkRef(open, id, 0)));
  await testEnv.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'html_games', 'g1'), { name: 'Public game' });
    await setDoc(doc(c.firestore(), 'characters', 'c1'), { name: 'Ref' });
  });
  await assertSucceeds(getDoc(doc(open, 'html_games', 'g1')));
  await assertSucceeds(getDoc(doc(open, 'characters', 'c1')));
});
