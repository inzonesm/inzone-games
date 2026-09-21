import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  attachNightclubFocusHold,
  companionShouldHoldPlay,
  formatPauseSample,
  NIGHTCLUB_COMPANION_FOCUS_MARKER,
  nightclubCompanionFocusScript,
} from '../lib/nightclub-companion-focus.ts';
import { instrumentGameHtml } from '../lib/game-hosting.ts';

test('companion hold ignores focus-loss only for a live visible voice session', () => {
  assert.equal(
    companionShouldHoldPlay({ voiceHold: true, hostSheetOpen: false, visibilityState: 'visible' }),
    true,
  );
  assert.equal(
    companionShouldHoldPlay({ voiceHold: false, hostSheetOpen: false, visibilityState: 'visible' }),
    false,
  );
  assert.equal(
    companionShouldHoldPlay({ voiceHold: true, hostSheetOpen: true, visibilityState: 'visible' }),
    false,
    'Invite / Chat must still be allowed to pause',
  );
  assert.equal(
    companionShouldHoldPlay({ voiceHold: true, hostSheetOpen: false, visibilityState: 'hidden' }),
    false,
    'background tab must still pause',
  );
});

test('Nightclub HTML gets the GameFocusHelper hold; other titles do not', () => {
  const nightclub = instrumentGameHtml('<html><head></head><body></body></html>', {
    baseHref: '/gcs/games/nightclub-showdown-inzone-production/v2/',
    gameId: 'nightclub-showdown-inzone-production',
  });
  assert.match(nightclub, new RegExp(NIGHTCLUB_COMPANION_FOCUS_MARKER));
  assert.match(nightclub, /get_isFocused/);
  assert.doesNotMatch(nightclubCompanionFocusScript(), /paused\s*=\s*false/);
  assert.doesNotMatch(nightclubCompanionFocusScript(), /\.click\(/);

  const flappy = instrumentGameHtml('<html><head></head><body></body></html>', {
    baseHref: '/gcs/games/flappybird-inzone-2/v9/',
    gameId: 'flappybird-inzone-2',
  });
  assert.doesNotMatch(flappy, new RegExp(NIGHTCLUB_COMPANION_FOCUS_MARKER));
});

test('focus-hold script is valid JS and never force-unpauses or clicks', () => {
  const source = nightclubCompanionFocusScript();
  assert.match(source, /^\(function \(\) \{/);
  assert.doesNotMatch(source, /\)\(\);\)\(\);/);
  assert.doesNotMatch(source, /paused\s*=\s*false/);
  assert.doesNotMatch(source, /\.click\(/);
  const win = {
    __inzoneCompanionFocus: false,
    $hxClasses: {
      'hxd.Window': {
        prototype: {
          get_isFocused() {
            return false;
          },
        },
      },
    },
  };
  const parent = {
    __inzoneCompanionHoldPlay: true,
    __inzoneHostSheetOpen: false,
  };
  const sandbox = {
    window: win,
    document: { visibilityState: 'visible' },
    setInterval() { return 0; },
    clearInterval() {},
  };
  sandbox.window.parent = parent;
  vm.runInNewContext(source, sandbox);
  assert.equal(win.__inzoneCompanionFocus, true);
  assert.equal(win.$hxClasses['hxd.Window'].prototype.get_isFocused(), true);
  parent.__inzoneCompanionHoldPlay = false;
  assert.equal(win.$hxClasses['hxd.Window'].prototype.get_isFocused(), false);
  parent.__inzoneCompanionHoldPlay = true;
  parent.__inzoneHostSheetOpen = true;
  assert.equal(win.$hxClasses['hxd.Window'].prototype.get_isFocused(), false);
});

test('focus-hold also patches Boot.ME.s2d.window when $hxClasses is not global', () => {
  const source = nightclubCompanionFocusScript();
  const inst = {
    focused: false,
    get_isFocused() {
      return this.focused === true;
    },
  };
  const win = {
    __inzoneCompanionFocus: false,
    __NightclubRuntime: { Boot: { ME: { s2d: { window: inst } } } },
  };
  const parent = { __inzoneCompanionHoldPlay: true, __inzoneHostSheetOpen: false };
  const sandbox = {
    window: win,
    document: { visibilityState: 'visible' },
    setInterval() { return 0; },
    clearInterval() {},
  };
  sandbox.window.parent = parent;
  vm.runInNewContext(source, sandbox);
  assert.equal(inst.get_isFocused(), true);
  parent.__inzoneHostSheetOpen = true;
  assert.equal(inst.get_isFocused(), false);
  parent.__inzoneHostSheetOpen = false;
  parent.__inzoneCompanionHoldPlay = false;
  inst.focused = false;
  assert.equal(inst.get_isFocused(), false);
});

test('parent attach wraps Boot.ME.s2d.window without clicking or clearing pause', () => {
  const inst = {
    focused: false,
    get_isFocused() {
      return this.focused === true;
    },
  };
  const frame = {
    contentWindow: {
      __NightclubRuntime: { Boot: { ME: { s2d: { window: inst } } } },
    },
  };
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  globalThis.window = {
    __inzoneCompanionHoldPlay: true,
    __inzoneHostSheetOpen: false,
  };
  globalThis.document = { visibilityState: 'visible' };
  try {
    assert.equal(attachNightclubFocusHold(frame), true);
    assert.equal(inst.__inzoneHoldPlay, true);
    assert.equal(inst.get_isFocused(), true);
    globalThis.window.__inzoneHostSheetOpen = true;
    assert.equal(inst.get_isFocused(), false);
  } finally {
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
  }
});

test('pause samples never include conversation text', () => {
  const row = formatPauseSample({
    mainPaused: false,
    iframeFocused: false,
    overlay: true,
    hold: true,
    visibility: 'visible',
  });
  assert.equal(row, 'overlay,iframe_blur,hold,visible');
  assert.doesNotMatch(row, /ask|transcript|caption|said/i);
});

test('companion shelf stays a reserved one-row control, not a wrapping stack', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const dock = css.slice(css.indexOf('.companion-dock {'), css.indexOf('.companion-presence'));
  assert.match(dock, /flex-wrap:\s*nowrap/);
  assert.match(dock, /max-height:\s*88px/);
  assert.match(dock, /min-height:\s*76px/);
  assert.doesNotMatch(dock, /overflow:\s*hidden/);
  const source = readFileSync(new URL('../components/GameCompanion.tsx', import.meta.url), 'utf8');
  assert.match(source, /data-companion-layout="shelf"/);
  assert.match(source, /data-testid="companion-menu"/);
  assert.match(source, /state === 'speaking'/);
  assert.match(source, /id="companion-more"/);
  assert.match(source, /data-testid="companion-ptt"/);
  const pttIndex = source.indexOf('data-testid="companion-ptt"');
  const moreIndex = source.indexOf('id="companion-more"');
  assert.ok(pttIndex > moreIndex, 'Hold to talk belongs in the More menu');
});
