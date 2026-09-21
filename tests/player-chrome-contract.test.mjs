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

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const player = readFileSync(new URL('../app/games/[id]/page.tsx', import.meta.url), 'utf8');
const companion = readFileSync(new URL('../components/GameCompanion.tsx', import.meta.url), 'utf8');

function rule(selector) {
  const start = css.indexOf(`${selector} {`);
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

test('the companion sits inside the bar in the player markup', () => {
  const rail = player.indexOf('className="game-rail"');
  const rookCell = player.indexOf('<GameCompanion');
  const railEnd = player.indexOf('className="rail-nav"');
  assert.ok(rail !== -1 && rookCell !== -1 && railEnd !== -1);
  assert.ok(rookCell > rail && rookCell < railEnd, 'Rook must be a cell of the one bar');
});

test('transient chrome floats without stealing taps meant for the game', () => {
  const bubble = rule('.rook-bubble');
  assert.match(bubble, /position:\s*absolute/);
  assert.match(bubble, /pointer-events:\s*none/);
  // Only the interrupt chip inside it takes a tap.
  assert.match(rule('.rook-bubble-stop'), /pointer-events:\s*auto/);
});

test('the sheet gives its space back rather than living over the game', () => {
  assert.match(companion, /window\.addEventListener\('blur', close\)/);
  assert.match(companion, /e\.key === 'Escape'/);
  assert.match(companion, /document\.activeElement === iframeRef\.current/);
});

test('long replies wrap inside the bubble instead of resizing anything', () => {
  const caption = css.slice(css.indexOf('.rook-bubble .companion-caption {'));
  assert.match(caption.slice(0, caption.indexOf('}')), /line-clamp/);
});

test('touch layouts trade the chevrons, not a control, to seat Rook', () => {
  // Both touch layouts hide .rail-nav, and both have live swipe gutters so
  // prev/next is still reachable. Hiding one without the other would remove a
  // capability rather than move it.
  const portrait = css.slice(css.indexOf('@media (max-width: 768px)'), css.indexOf('@media (orientation: landscape) and (max-height: 600px)'));
  const landscape = css.slice(css.indexOf('@media (orientation: landscape) and (max-height: 600px)'));
  for (const [name, block] of [['portrait', portrait], ['short landscape', landscape]]) {
    assert.match(block, /\.rail-nav\s*\{\s*display:\s*none/, `${name} must drop the chevrons`);
    assert.match(block, /\.swipe-gutter\s*\{[\s\S]*?display:\s*block/, `${name} must keep swipe nav`);
  }
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
