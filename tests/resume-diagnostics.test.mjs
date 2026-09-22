import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTap, describeTarget, resumeOutcome, summarise } from '../lib/resume-diagnostics.ts';

const el = (tag, className = '', parent = null, extra = {}) => ({
  tagName: tag.toUpperCase(),
  className,
  id: extra.id ?? '',
  parentElement: parent,
  getAttribute: (a) => (a === 'data-testid' ? extra.testId ?? null : null),
});
const rect = (x, y, width, height) => ({ x, y, width, height });
const state = (o = {}) => ({ mainPaused: null, overlay: null, iframeFocused: null, hold: false, visibility: 'visible', ...o });

test('a target is described by shape and never by what it says', () => {
  const node = el('button', 'rook-chip is-hot', el('div', 'rook-sheet'), { testId: 'companion-mute' });
  const path = describeTarget(node);
  assert.equal(path[0].tag, 'button');
  assert.equal(path[0].testId, 'companion-mute');
  assert.deepEqual(path[0].classes, ['rook-chip', 'is-hot']);
  // Nothing anywhere in the record may carry text.
  assert.ok(!JSON.stringify(path).includes('textContent'));
  for (const n of path) assert.equal(n.text, undefined);
});

test('host chrome taps are separated from the game', () => {
  const p = (cls) => describeTarget(el('button', cls, el('div', cls === 'rail-btn' ? 'game-rail' : cls)));
  assert.equal(classifyTap({ inFrame: false, path: p('rail-btn'), point: { x: 5, y: 5 }, canvasRect: null }), 'host-bar');
  assert.equal(classifyTap({ inFrame: false, path: describeTarget(el('button', 'rook-chip', el('div', 'rook-sheet'))), point: { x: 0, y: 0 }, canvasRect: null }), 'host-sheet');
  assert.equal(classifyTap({ inFrame: false, path: describeTarget(el('div', 'rook-bubble', el('div', 'player-overlay'))), point: { x: 0, y: 0 }, canvasRect: null }), 'host-overlay');
  assert.equal(classifyTap({ inFrame: false, path: describeTarget(el('div', 'something')), point: { x: 0, y: 0 }, canvasRect: null }), 'host-other');
});

test('a canvas tap inside the canvas is the one that counts', () => {
  const path = describeTarget(el('canvas', 'webgl'));
  const zone = classifyTap({ inFrame: true, path, point: { x: 200, y: 120 }, canvasRect: rect(0, 40, 390, 200) });
  assert.equal(zone, 'canvas');
});

test('the in-canvas resume prompt is a canvas tap, because that is what it is', () => {
  // "click anywhere to resume" is drawn inside the canvas in this build. If
  // those taps are classified canvas and still ignored, the resume path is at
  // fault and nothing else is.
  const path = describeTarget(el('canvas', 'webgl'));
  assert.equal(classifyTap({ inFrame: true, path, point: { x: 195, y: 140 }, canvasRect: rect(0, 40, 390, 200) }), 'canvas');
});

test("the build's own HUD is not a resume tap", () => {
  const restart = describeTarget(el('button', 'restart', el('div', 'hud')));
  assert.equal(classifyTap({ inFrame: true, path: restart, point: { x: 350, y: 10 }, canvasRect: rect(0, 40, 390, 200) }), 'in-frame-hud');
  // Inside the canvas box but not the canvas element: an overlaid HTML control.
  const overlaid = describeTarget(el('div', 'pause-prompt'));
  assert.equal(classifyTap({ inFrame: true, path: overlaid, point: { x: 200, y: 120 }, canvasRect: rect(0, 40, 390, 200) }), 'in-frame-hud');
});

test('a canvas tap outside the canvas box is not a canvas tap', () => {
  const path = describeTarget(el('canvas', 'webgl'));
  assert.equal(classifyTap({ inFrame: true, path, point: { x: 5, y: 5 }, canvasRect: rect(0, 40, 390, 200) }), 'in-frame-other');
});

test('the outcome distinguishes ignored from already running from unreadable', () => {
  assert.equal(resumeOutcome(state({ overlay: true }), state({ overlay: false })), 'resumed');
  assert.equal(resumeOutcome(state({ overlay: true }), state({ overlay: true })), 'ignored');
  assert.equal(resumeOutcome(state({ overlay: false, mainPaused: false }), state({ overlay: false })), 'already-running');
  assert.equal(resumeOutcome(state(), state({ overlay: false })), 'unknown');
  assert.equal(resumeOutcome(state({ mainPaused: true }), state({ mainPaused: false })), 'resumed');
});

test('the summary answers the only question that decides where the fix goes', () => {
  const rec = (zone, outcome) => ({ at: 0, zone, point: { x: 0, y: 0 }, canvasRect: null, path: [], before: state(), after: state(), outcome, hostFocused: true });
  assert.match(summarise([rec('host-bar', 'unknown')]).verdict, /No tap reached the playable canvas/);
  assert.match(summarise([rec('canvas', 'resumed')]).verdict, /not at fault/);
  assert.match(summarise([rec('canvas', 'ignored'), rec('canvas', 'ignored')]).verdict, /resume path is at fault/);
  const mixed = summarise([rec('canvas', 'ignored'), rec('canvas', 'resumed')]);
  assert.match(mixed.verdict, /intermittent/);
  assert.equal(mixed.canvasTaps, 2);
  assert.equal(mixed.canvasTapsIgnored, 1);
});

test('zone counts are reported so a log can be read at a glance', () => {
  const rec = (zone) => ({ at: 0, zone, point: { x: 0, y: 0 }, canvasRect: null, path: [], before: state(), after: state(), outcome: 'unknown', hostFocused: true });
  const s = summarise([rec('canvas'), rec('canvas'), rec('host-bar')]);
  assert.deepEqual(s.byZone, { canvas: 2, 'host-bar': 1 });
  assert.equal(s.taps, 3);
});

test('production can never run the diagnostic, whatever the query string says', async () => {
  const { diagnosticsEnabled } = await import('../components/ResumeDiagnostics.tsx').catch(() => ({}));
  // The component is a client module; assert the rule from source instead so
  // this stays a pure Node test.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../components/ResumeDiagnostics.tsx', import.meta.url), 'utf8');
  assert.match(src, /classifyHost\(hostname\) === 'production'\) return false/);
  assert.match(src, /inzoneDiag'\) === '1'/);
  void diagnosticsEnabled;
});

test('the diagnostic records, and does not touch what it measures', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../components/ResumeDiagnostics.tsx', import.meta.url), 'utf8');
  // No synthesised input into the game, no forced resume, no hold changes.
  // The one click() is the download anchor, which is how a browser saves a
  // file and has nothing to do with the thing being measured.
  const clicks = src.match(/\w+\.click\(\)/g) ?? [];
  assert.deepEqual(clicks, ['a.click()'], `unexpected synthetic clicks: ${clicks.join(', ')}`);
  assert.doesNotMatch(src, /dispatchEvent/);
  assert.doesNotMatch(src, /setCompanionHoldPlay/);
  // And no transport: it exports to the clipboard or a file only.
  assert.doesNotMatch(src, /fetch\(/);
  assert.doesNotMatch(src, /trackCampaignEvent/);
  assert.doesNotMatch(src, /sendBeacon/);
});
