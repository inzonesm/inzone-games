/**
 * The player screen's layout contract.
 *
 * One rule, and the whole screen obeys it:
 *
 *   persistent chrome  ->  insets the stage
 *   transient chrome   ->  floats over the dead letterbox and removes itself
 *
 * The version this replaced broke that rule in one file: the bar inset the
 * iframe through --rail-x/--rail-y while the companion slab was absolutely
 * positioned inside the stage with no inset accounting. One surface respected
 * the game, the surface beside it sat on top of it, and on a sideways phone
 * that cost real play area. These assertions exist so the next change has to
 * argue with the rule rather than drift past it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOUCH_PRIMARY, barCellCount, splitPlayerActions } from '../lib/player-actions.ts';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const player = readFileSync(new URL('../app/games/[id]/page.tsx', import.meta.url), 'utf8');
const companion = readFileSync(new URL('../components/GameCompanion.tsx', import.meta.url), 'utf8');

/** The rule whose selector list *starts* a line, so a compound selector that
 *  merely ends with the same class is not mistaken for it. */
function rule(selector) {
  const start = css.indexOf(`\n${selector} {`);
  assert.notEqual(start, -1, `missing rule for ${selector}`);
  return css.slice(start, css.indexOf('}', start));
}

test('the stage is the only box that sizes the game, and it is inset by the bar', () => {
  const stage = rule('.game-stage');
  assert.match(stage, /position:\s*absolute/);
  assert.match(stage, /right:\s*var\(--rail-x\)/);
  assert.match(stage, /bottom:\s*var\(--rail-y\)/);
});

test('the default iframe box cannot collapse to the browser default', () => {
  const frame = rule('.game-frame-body iframe');
  assert.match(frame, /width:\s*100%/);
  assert.match(frame, /height:\s*100%/);
  // An invalid --game-fit made the old calc() invalid, which dropped the frame
  // to 300x150 in the top-left corner while the chrome kept painting
  // full-bleed. Neither calc() nor a transform may sit on the default path.
  assert.doesNotMatch(frame, /calc\(/);
  assert.doesNotMatch(frame, /transform:/);
  assert.doesNotMatch(frame, /--game-fit/);
});

test('zoom stays an opt-in escape hatch with a defined fallback', () => {
  const zoomed = rule('.game-stage.is-zoomed iframe');
  assert.match(zoomed, /var\(--game-fit,\s*1\)/);
});

test('the companion is a cell of the bar, never a second persistent surface', () => {
  assert.match(companion, /data-companion-layout="cell"/);
  assert.match(companion, /className=\{`rail-btn rook-cell/);
  // The floating dock is gone from both the markup and the stylesheet.
  assert.doesNotMatch(companion, /companion-dock/);
  assert.doesNotMatch(css, /\.companion-dock\s*\{/);
  assert.doesNotMatch(css, /\.player-letterbox\s*\{/);
  const cell = rule('.rook-cell');
  assert.doesNotMatch(cell, /position:\s*absolute/);
});

test('the companion is a cell of the one bar, rendered from the shared order', () => {
  // The bar renders from the action split, so Rook cannot drift into a second
  // surface without changing lib/player-actions.ts and failing its own tests.
  assert.match(player, /\{actionSplit\.primary\.map\(\(id\) => renderAction\(id, 'cell'\)\)\}/);
  assert.match(player, /case 'rook':[\s\S]{0,400}<GameCompanion/);
  assert.ok(splitPlayerActions('touch').primary[0] === 'rook', 'Rook leads the bar');
  // One definition, two presentations — the More sheet reads the same list.
  assert.match(player, /\{actionSplit\.secondary\.map\(\(id\) => renderAction\(id, 'chip'\)\)\}/);
});

test('transient chrome floats without stealing taps meant for the game', () => {
  const bubble = rule('.rook-bubble');
  assert.match(bubble, /position:\s*absolute/);
  assert.match(bubble, /pointer-events:\s*none/);
  // Only the interrupt chip inside it takes a tap.
  assert.match(rule('.rook-bubble-stop'), /pointer-events:\s*auto/);
});

test('a sheet closes on a tap in the game, not on the frame merely holding focus', () => {
  // A hosted run caught the first version: it polled document.activeElement and
  // closed when that was the iframe, but after any play the iframe already
  // holds focus — so every sheet shut itself within 400ms and its controls
  // were unreachable. The signal has to be a tap, read from the frame's own
  // document, with blur and Escape alongside it.
  for (const [name, src] of [['companion', companion], ['player', player]]) {
    assert.match(src, /window\.addEventListener\('blur', close\)/, name);
    assert.match(src, /e\.key === 'Escape'/, name);
    assert.match(src, /frameDoc\?\.addEventListener\('pointerdown', close, true\)/, name);
    assert.doesNotMatch(src, /document\.activeElement === iframeRef\.current/, `${name} must not poll focus`);
  }
  // Cross-origin frames throw on contentDocument; blur and Escape remain.
  assert.match(companion, /catch \{[\s\S]{0,200}frameDoc = null/);
});

test('long replies wrap inside the bubble instead of resizing anything', () => {
  const caption = css.slice(css.indexOf('.rook-bubble .companion-caption {'));
  assert.match(caption.slice(0, caption.indexOf('}')), /line-clamp/);
});

test('nothing of ours lies over the game waiting for a gesture', () => {
  // The swipe gutters were two always-on strips over the iframe's edges. An
  // always-on strip takes whatever gesture the build wanted there, so they are
  // gone from the markup and the stylesheet keeps a hard never-paint rule.
  assert.doesNotMatch(player, /className="swipe-gutter/);
  assert.doesNotMatch(player, /onTouchStart=/);
  assert.match(css, /\.swipe-gutter\s*\{\s*display:\s*none\s*!important/);
});

test('changing game is an explicit control, not an invisible gesture', () => {
  // And the unnamed chevron pair is gone from the bar entirely, not merely
  // hidden: 82px of a 390pt row for two actions nobody could name.
  assert.doesNotMatch(player, /className="rail-nav"/);
  assert.doesNotMatch(css, /\.rail-nav\s*\{/);
  assert.match(player, /data-testid="player-change-game"/);
  assert.match(player, /data-testid="player-prev-game"/);
  assert.match(player, /data-testid="player-next-game"/);
  // And leaving stays one tap on a phone.
  assert.ok(TOUCH_PRIMARY.includes('home'), 'Home must stay a primary cell');
});

test('the phone bar leads with Rook, the conversation and navigation', () => {
  const split = splitPlayerActions('touch');
  assert.deepEqual(split.primary, ['rook', 'chat', 'invite', 'games', 'home']);
  assert.equal(barCellCount(split), 6);
  // Secondary actions are one tap away, never gone.
  assert.ok(split.secondary.includes('share'));
  assert.ok(split.secondary.includes('fill'));
  assert.match(player, /data-testid="player-more-sheet"/);
});

test('the Chat cell carries real conversation state', () => {
  assert.match(player, /data-live-members=\{String\(liveMembers\)\}/);
  assert.match(player, /subscribePlayPreview\(activeSession/);
  // Active members only: someone who left is not in the room.
  assert.match(player, /members\.filter\(\(m\) => m\.status === 'active'\)/);
});

test('floating chrome is painted in the overlay, not inside the scrolling bar', () => {
  // `.game-rail` is positioned and scrolls its overflow, so an absolutely
  // positioned child is clipped to the bar on a desktop rail.
  assert.match(companion, /createPortal\(bubble, overlay\)/);
  assert.match(companion, /createPortal\(sheet, overlay\)/);
  assert.match(player, /className="player-overlay" ref=\{overlayRef\}/);
  assert.match(rule('.player-overlay'), /pointer-events:\s*none/);
});

test('a caption never lands on a game that fills the stage', () => {
  // Measured, not assumed: an unreadable or full-bleed frame yields no band,
  // and the caption stays in the sheet instead.
  assert.match(companion, /captionMayOverlay\(captionBand\)/);
  assert.match(companion, /showBubble = Boolean\(bubbleText\) && !menuOpen && overlayAllowed/);
  assert.match(companion, /data-testid="companion-sheet-caption"/);
});

test('fill screen turns the whole player, and is never on by default', () => {
  // The rotation belongs to the player, not the frame. Rotating the frame
  // alone left a sideways game under upright chrome, which is the same
  // incoherence this contract exists to remove.
  const filled = rule('.game-frame-body[data-fill="on"]');
  assert.match(filled, /rotate\(90deg\)/);
  assert.match(filled, /translateY\(-100%\)/);
  assert.match(filled, /100cqh/);
  assert.match(filled, /100cqw/);
  assert.doesNotMatch(css, /\[data-fill="on"\][^{]*iframe\s*\{/, 'the iframe must not rotate on its own');
  assert.match(rule('.game-frame-shell'), /container-type:\s*size/);
  assert.match(player, /data-fill=\{fillScreen \? 'on' : 'off'\}/);
  assert.match(player, /const \[fillScreen, setFillScreen\] = useState\(false\)/);
});

test('the bar is measured from layout boxes, so a rotated player still reserves the right axis', () => {
  assert.match(player, /railInsetFrom\(layoutBoxOf\(rail\), layoutBoxOf\(body\)\)/);
  const inset = readFileSync(new URL('../lib/rail-inset.ts', import.meta.url), 'utf8');
  // The prose explains why; what matters is that nothing calls it.
  assert.doesNotMatch(inset, /getBoundingClientRect\(\)/);
  assert.match(inset, /offsetWidth/);
});

test('the approved ribbon stays a live renderer, not a glyph', () => {
  // Moving Rook into the bar must not quietly demote its mark to an icon.
  const ribbon = readFileSync(new URL('../components/CompanionRibbon.tsx', import.meta.url), 'utf8');
  assert.match(ribbon, /<canvas/, 'the ribbon must still be the canvas renderer');
  assert.match(ribbon, /requestAnimationFrame/, 'the ribbon must still animate');
  assert.match(companion, /<CompanionRibbon/);
  assert.match(companion, /levelRef=\{speechLevelRef\}/, 'speaking must follow real output, not a timer');
  // And it stays bigger than the glyphs beside it on every layout.
  const mark = (block) => {
    const i = block.indexOf('.rook-mark {');
    return i === -1 ? null : block.slice(i, block.indexOf('}', i));
  };
  const portrait = css.slice(css.indexOf('@media (max-width: 768px)'), css.indexOf('@media (orientation: landscape) and (max-height: 600px)'));
  assert.match(portrait, /\.rook-mark \{ width: 28px/);
  assert.ok(mark(css), 'a base size must exist');
});
