/**
 * Player-stage geometry: the host iframe must not inherit the browser
 * default 300×150 box, and companion chrome must not be the sizing context.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_DEFAULT_IFRAME,
  applyValidatedGameFit,
  clearHostileIframeSizing,
  isCollapsedPlayerBox,
  sanitizeGameFit,
} from '../lib/player-stage.ts';

test('the browser default iframe box is a collapse on a desktop viewport', () => {
  assert.equal(
    isCollapsedPlayerBox(BROWSER_DEFAULT_IFRAME, { width: 1280, height: 800 }),
    true,
  );
});

test('a full stage on desktop is not a collapse', () => {
  assert.equal(
    isCollapsedPlayerBox({ width: 1196, height: 800 }, { width: 1280, height: 800 }),
    false,
  );
});

test('a usable phone stage is not a collapse', () => {
  assert.equal(
    isCollapsedPlayerBox({ width: 390, height: 728 }, { width: 390, height: 844 }),
    false,
  );
});

test('a short-landscape stage that leaves only a sliver is a collapse', () => {
  assert.equal(
    isCollapsedPlayerBox({ width: 791, height: 120 }, { width: 844, height: 390 }),
    true,
  );
});

test('sanitizeGameFit accepts only a finite zoom-out in (0, 1]', () => {
  assert.equal(sanitizeGameFit(1), 1);
  assert.equal(sanitizeGameFit(0.5), 0.5);
  assert.equal(sanitizeGameFit('0.85'), 0.85);
  assert.equal(sanitizeGameFit(undefined), null);
  assert.equal(sanitizeGameFit(null), null);
  assert.equal(sanitizeGameFit(''), null);
  assert.equal(sanitizeGameFit('   '), null);
  assert.equal(sanitizeGameFit(0), null);
  assert.equal(sanitizeGameFit(-1), null);
  assert.equal(sanitizeGameFit(2), null);
  assert.equal(sanitizeGameFit('none'), null);
  assert.equal(sanitizeGameFit('foo'), null);
  assert.equal(sanitizeGameFit(Number.NaN), null);
  assert.equal(sanitizeGameFit(Number.POSITIVE_INFINITY), null);
});

test('applyValidatedGameFit ignores invalid values so the stage stays unzoomed', () => {
  const props = {};
  const classes = new Set();
  const stage = {
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
    },
    style: {
      setProperty(name, value) { props[name] = value; },
      removeProperty(name) { delete props[name]; },
    },
  };
  for (const raw of [undefined, '', 0, 'none', 2]) {
    assert.equal(applyValidatedGameFit(stage, raw), null);
    assert.equal(classes.has('is-zoomed'), false);
    assert.equal(props['--game-fit-safe'], undefined);
  }
  assert.equal(applyValidatedGameFit(stage, 0.5), 0.5);
  assert.equal(classes.has('is-zoomed'), true);
  assert.equal(props['--game-fit-safe'], '0.5');
  assert.equal(applyValidatedGameFit(stage, ''), null);
  assert.equal(classes.has('is-zoomed'), false);
});

test('clearHostileIframeSizing strips attribute and inline sizes', () => {
  const style = { width: '300px', height: '150px', removeProperty(name) { delete this[name]; } };
  const attrs = { width: '300', height: '150' };
  const iframe = {
    hasAttribute(name) { return Object.hasOwn(attrs, name); },
    removeAttribute(name) { delete attrs[name]; },
    style,
  };
  assert.equal(clearHostileIframeSizing(iframe), true);
  assert.equal(iframe.hasAttribute('width'), false);
  assert.equal(iframe.hasAttribute('height'), false);
  assert.equal(style.width, undefined);
  assert.equal(style.height, undefined);
  assert.equal(clearHostileIframeSizing(iframe), false, 'second pass is a no-op');
});
