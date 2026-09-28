/**
 * Coverage for lib/session-openers.ts — the pure logic behind the joiner /
 * inviter onboarding chips.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_OPENERS,
  SESSION_OPENER_COACH,
  shouldShowSessionOpeners,
} from '../lib/session-openers.ts';

test('three openers, short and safe for a mobile thumb', () => {
  assert.equal(SESSION_OPENERS.length, 3);
  for (const opener of SESSION_OPENERS) {
    assert.ok(opener.length > 0);
    assert.ok(opener.length <= 20, `"${opener}" is too long for a mobile chip`);
  }
});

test('openers contain no session ids, invite tokens, or urls — the sanitize pipeline stays trusted', () => {
  const suspicious = /https?:|inzone\.games\/|session[/_-]|token|inv[_-]/i;
  for (const opener of SESSION_OPENERS) {
    assert.ok(!suspicious.test(opener), `"${opener}" looks like it carries a link/token`);
  }
});

test('openers use conversation-neutral copy — CLAUDE.md rule: invite creates a conversation, not a match', () => {
  // "match" or "co-op" would overpromise. Chat / hi / play-together phrasing is fine.
  const overpromise = /\bmatch\b|\bco-?op\b|\bmultiplayer\b|\bversus\b/i;
  for (const opener of SESSION_OPENERS) {
    assert.ok(!overpromise.test(opener), `"${opener}" promises synchronised play we don't have`);
  }
});

test('coach line describes the affordance, not gameplay', () => {
  assert.equal(SESSION_OPENER_COACH, 'Say hi to start the conversation');
});

test('shouldShowSessionOpeners: only visible when joined AND thread empty', () => {
  assert.equal(shouldShowSessionOpeners({ liveJoined: false, threadLength: 0 }), false);
  assert.equal(shouldShowSessionOpeners({ liveJoined: true, threadLength: 0 }), true);
  assert.equal(shouldShowSessionOpeners({ liveJoined: true, threadLength: 1 }), false);
  assert.equal(shouldShowSessionOpeners({ liveJoined: true, threadLength: 5 }), false);
  assert.equal(shouldShowSessionOpeners({ liveJoined: false, threadLength: 3 }), false);
});

test('shouldShowSessionOpeners: retires the moment the first real message lands', () => {
  // Even a single real message steps the coach out of the way — the
  // conversation is now the affordance.
  assert.equal(shouldShowSessionOpeners({ liveJoined: true, threadLength: 1 }), false);
});
