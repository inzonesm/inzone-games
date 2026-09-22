import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_CAPTION_BAND,
  bottomBandFrom,
  bottomBandOfFrame,
  captionMayOverlay,
} from '../lib/letterbox.ts';

test('a letterboxed build leaves a real band beneath its canvas', () => {
  // Nightclub at 390pt: a 136px canvas centred in a 785px stage.
  assert.equal(bottomBandFrom(785, { top: 324, height: 136 }), 325);
  assert.equal(captionMayOverlay(325), true);
});

test('a build that fills the stage leaves nothing, and the caption stays off it', () => {
  assert.equal(bottomBandFrom(785, { top: 0, height: 785 }), 0);
  assert.equal(captionMayOverlay(0), false);
});

test('a band too small to hold a caption is not used', () => {
  const band = bottomBandFrom(785, { top: 0, height: 785 - (MIN_CAPTION_BAND - 1) });
  assert.ok(band < MIN_CAPTION_BAND);
  assert.equal(captionMayOverlay(band), false);
});

test('an unmeasurable frame reads as no room, never as plenty', () => {
  assert.equal(bottomBandFrom(785, null), 0);
  assert.equal(bottomBandFrom(0, { top: 0, height: 100 }), 0);
  assert.equal(bottomBandFrom(785, { top: 0, height: 0 }), 0);
  assert.equal(bottomBandOfFrame(null, 785), 0);
});

test('a cross-origin frame throws on access and still reads as no room', () => {
  const hostile = {
    get contentDocument() { throw new DOMException('cross-origin'); },
  };
  assert.equal(bottomBandOfFrame(hostile, 785), 0);
});

test('a frame that has not painted reads as no room', () => {
  assert.equal(bottomBandOfFrame({ contentDocument: null }, 785), 0);
  assert.equal(bottomBandOfFrame({ contentDocument: {} }, 785), 0);
});

test('several canvases are measured by their union, not the first one found', () => {
  // An engine canvas plus an overlay canvas lower down: covering the lower one
  // still covers the game, so the band is measured from the lowest edge.
  const canvas = (top, bottom) => ({
    clientWidth: 300,
    clientHeight: bottom - top,
    getBoundingClientRect: () => ({ top, bottom }),
  });
  const doc = {
    body: { getBoundingClientRect: () => ({ top: 0, height: 785 }) },
    querySelectorAll: () => [canvas(100, 300), canvas(310, 500)],
  };
  assert.equal(bottomBandOfFrame({ contentDocument: doc }, 785), 285);
});

test('a zero-sized canvas is ignored in favour of the body box', () => {
  const doc = {
    body: { getBoundingClientRect: () => ({ top: 0, height: 400 }) },
    querySelectorAll: () => [{ clientWidth: 0, clientHeight: 0 }],
  };
  assert.equal(bottomBandOfFrame({ contentDocument: doc }, 785), 385);
});
