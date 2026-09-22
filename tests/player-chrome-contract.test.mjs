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
  // And it recovers after a denied read. A guest on an invite link is not a
  // member until they press Join, so the first subscribe is refused; without a
  // retry their own Chat cell stays at zero for the whole visit while the
  // host's correctly shows two.
  assert.match(player, /attempts \+= 1;/);
  assert.match(player, /setTimeout\(attach, 2000 \* attempts\)/);
  assert.match(player, /attempts >= 6/, 'the retry must be bounded');
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

test('nothing rotates the player in CSS any more', () => {
  // A device recording settled this: the geometry and the hit-testing were
  // right and it was still wrong, because Safari's status bar, address bar and
  // toolbar do not rotate with a transformed element. The result was a
  // sideways player inside an upright browser — the same incoherence this
  // contract exists to remove, moved into the frame around it. CSS rotation is
  // not fullscreen and cannot be made into it.
  assert.doesNotMatch(css, /rotate\(90deg\)/);
  assert.doesNotMatch(css, /data-fill/);
  assert.doesNotMatch(css, /100cq[wh]/);
  assert.doesNotMatch(player, /data-fill/);
});

test('fullscreen is offered only where the browser reports it, never by user agent', () => {
  const mode = readFileSync(new URL('../lib/display-mode.ts', import.meta.url), 'utf8');
  assert.match(mode, /requestFullscreen/);
  assert.match(mode, /fullscreenEnabled/, 'the method existing is not permission to use it');
  assert.doesNotMatch(mode, /userAgent/, 'a UA test is a guess about a browser, not a fact about this one');
  assert.match(player, /detectDisplayCapabilities\(\)/);
  // The browser owns the state; a system gesture or Escape leaves fullscreen
  // without passing through our control.
  assert.match(player, /addEventListener\('fullscreenchange', sync\)/);
  assert.match(player, /addEventListener\('webkitfullscreenchange', sync\)/);
});

test('an orientation lock is asked for, never required', () => {
  assert.match(player, /displayCaps\.orientationLock/);
  assert.match(player, /catch \{ \/\* refused; fullscreen stands alone \*\/ \}/);
});

test('where fullscreen is unavailable, the measured hint stands in for it', () => {
  assert.match(player, /data-testid="player-orientation-hint"/);
  assert.match(player, /orientationHintShown\(/);
  // And it is the build's own measured hint, never invented.
  assert.match(player, /hasOrientationHint: Boolean\(controls\?\.orientationHint\)/);
});

test('the bar prints a steady label while the ribbon carries the state', () => {
  // "Thinking" appearing and vanishing under the mark every turn was a second
  // thing moving for no information the animation does not already carry.
  assert.match(companion, /const cellLabel = muted/);
  assert.match(companion, /\{cellLabel\}/);
  // The full state is still announced.
  assert.match(companion, /aria-live="polite">\{statusLabel\}/);
});

test('reduced motion still conveys state', () => {
  const ribbon = readFileSync(new URL('../components/CompanionRibbon.tsx', import.meta.url), 'utf8');
  assert.match(ribbon, /prefers-reduced-motion/);
  assert.match(ribbon, /repaintRef\.current\?\.\(\)/, 'a still frame per state, not a still frame forever');
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

test('no control cancels its own click on a touch screen', () => {
  // preventDefault() on pointerdown suppresses the compatibility mouse events
  // a touch screen synthesises, click included. Controls carrying it looked
  // and felt fine on a desktop and were inert on a phone; a hosted run on a
  // touch viewport recorded pointerdown and touchstart on the mute chip and no
  // click at all. Focus retention belongs on mousedown, which does not touch
  // the touch sequence.
  for (const [name, src] of [['companion', companion], ['player', player]]) {
    assert.doesNotMatch(
      src,
      /onPointerDown=\{\(e\) => e\.preventDefault\(\)\}/,
      `${name} cancels a click on touch`,
    );
  }
  // Hold-to-talk is the one legitimate pointerdown handler: it starts a
  // gesture rather than waiting for a click.
  assert.match(companion, /onPointerDown=\{onHoldStart\}/);
});

test('a pointer that starts in our own chrome never reads as returning to the game', () => {
  assert.match(companion, /closest\?\.\('\.rook-sheet, \.player-sheet, \.game-rail'\)/);
});
