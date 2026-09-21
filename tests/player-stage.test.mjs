/**
 * Player-stage geometry: the host iframe must not inherit the browser
 * default 300×150 box, and companion chrome must not be the sizing context.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_DEFAULT_IFRAME,
  clearHostileIframeSizing,
  isCollapsedPlayerBox,
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
