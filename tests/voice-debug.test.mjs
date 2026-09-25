/**
 * Unit coverage for lib/companion/voice-debug.ts.
 *
 * The voice debug log is the on-device diagnostic for the hands-free
 * loop: when a phone test fails ("Rook didn't respond"), the Rook panel's
 * "Copy debug log" button pastes this ring buffer, and the event trail
 * tells us whether the recognizer never delivered, the fetch failed, or
 * TTS never ended. These tests pin the buffer's contract: bounded size,
 * chronological order, relative timestamps, and explicit clear.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../lib/companion/voice-debug.ts');
const { voiceDebug, clearVoiceDebugLog, getVoiceDebugLog, voiceDebugCount } = mod;

test('empty log reports itself as empty', () => {
  clearVoiceDebugLog();
  assert.equal(getVoiceDebugLog(), '(voice log empty)');
  assert.equal(voiceDebugCount(), 0);
});

test('events render chronologically with relative timestamps', async () => {
  clearVoiceDebugLog();
  voiceDebug('rec_start');
  await new Promise((r) => setTimeout(r, 15));
  voiceDebug('onText', 'hello rook');
  const log = getVoiceDebugLog();
  const lines = log.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\+0\.0s rec_start$/);
  assert.match(lines[1], /^\+\d+\.\ds onText hello rook$/);
  // Second event is after the first.
  const t0 = parseFloat(lines[0].slice(1).split('s')[0]);
  const t1 = parseFloat(lines[1].slice(1).split('s')[0]);
  assert.ok(t1 >= t0, 'timestamps are non-decreasing');
});

test('ring buffer is bounded: oldest events drop first', () => {
  clearVoiceDebugLog();
  for (let i = 0; i < 100; i++) voiceDebug(`event_${i}`);
  assert.equal(voiceDebugCount(), 80);
  const log = getVoiceDebugLog();
  assert.ok(!log.includes('event_0'), 'oldest events evicted');
  assert.ok(log.includes('event_99'), 'newest events retained');
  assert.ok(log.includes('event_20'), 'eviction is from the front only');
});

test('clear empties the buffer', () => {
  voiceDebug('something');
  clearVoiceDebugLog();
  assert.equal(voiceDebugCount(), 0);
  assert.equal(getVoiceDebugLog(), '(voice log empty)');
});
