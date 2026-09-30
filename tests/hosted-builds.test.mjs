import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  HOSTED_BUILDS,
  INERT_FIREBASE_SHIM,
  DROP_ENTRY_FILENAME_SHIM,
  PLAYGAMA_DEFAULTS_SHIM,
  applyHostedBuild,
  hostedBuild,
  mirrorBase,
  mirrorContentType,
  mirrorUpstreamUrls,
  safeMirrorSegments,
} from '../lib/hosted-builds.ts';
import { instrumentGameHtml } from '../lib/game-hosting.ts';
import { TOUCH_PAD_SIZE_PX, touchControlsScript, touchControlsTag } from '../lib/touch-controls.ts';
import { FLAGSHIP_IDS } from '../lib/flagship-roster.ts';
import { gameControls } from '../lib/game-controls.ts';
import { flagshipKnowledge } from '../lib/companion/knowledge.ts';
import {
  NIGHTCLUB_TOUCH_FOCUS_MARKER,
  nightclubCompanionFocusTag,
  nightclubTouchFocusScript,
  nightclubTouchFocusTag,
} from '../lib/nightclub-companion-focus.ts';
import { gameAudioDuckTag } from '../lib/game-audio-duck.ts';

const STUBS = ['kart-bros', 'clelytraflight', 'karate-bros', 'clescaperoad'];

function fixture(id) {
  return readFileSync(new URL(`../fixtures/hosted-builds/${id}.v1.html`, import.meta.url), 'utf8');
}

function served(id) {
  return instrumentGameHtml(fixture(id), { baseHref: `/gcs/games/${id}/v1/`, gameId: id });
}

test('every third-party flagship has a profile, pinned to a full commit SHA', () => {
  for (const id of STUBS) {
    const p = hostedBuild(id);
    assert.ok(p, `${id} has no hosted-build profile`);
    assert.match(p.upstream.sha, /^[0-9a-f]{40}$/, `${id} is pinned to something that can move`);
    assert.ok(FLAGSHIP_IDS.includes(id));
  }
  // The first-party build is served from our own bucket and needs no mirror.
  assert.equal(hostedBuild('nightclub-showdown-inzone-production'), null);
});

test('the fixtures really are the moving, third-party pages the profiles fix', () => {
  // If these ever stop matching, the fixture was replaced and the profile
  // needs re-checking against the new page.
  assert.match(fixture('kart-bros'), /UGS-Assets@main\//);
  assert.match(fixture('clelytraflight'), /lopx@main\//);
  assert.match(fixture('karate-bros'), /api\.adinplay\.com/);
  assert.match(fixture('clescaperoad'), /classroom\.google\.com@[0-9a-f]{40}\/drive\.google\.com/);
  assert.match(fixture('clescaperoad'), /eruda\.init\(\)/);
});

test('served pages never send a phone to jsDelivr, a tracker or an ad network', () => {
  for (const id of STUBS) {
    const html = served(id);
    assert.doesNotMatch(html, /cdn\.jsdelivr\.net/, `${id} still references jsDelivr`);
    assert.doesNotMatch(html, /<script[^>]*src="[^"]*adinplay/i, `${id} still loads an ad SDK`);
    assert.doesNotMatch(html, /<script[^>]*src="[^"]*googletagmanager/i, `${id} still loads gtag.js`);
    assert.doesNotMatch(html, /<script[^>]*src="[^"]*gstatic\.com\/firebasejs/i, `${id} still loads a foreign Firebase`);
    assert.doesNotMatch(html, /classroom\.google\.com/, `${id} still carries the filter-evasion path`);
    assert.ok(html.includes(mirrorBase(id)), `${id} does not point at its mirror`);
  }
});

test('the synchronous adinplay tag that froze Karate Bros is gone, and the page still completes its own ad flow', () => {
  const html = served('karate-bros');
  assert.doesNotMatch(html, /adinplay\.com\/libs/);
  // Without the tag `adplayer` stays undefined and the page's own ShowVideo()
  // calls Main.DoneVideoAd(true) at once — that path must still be there.
  assert.match(html, /typeof adplayer === 'undefined'/);
  assert.match(html, /Main\.DoneVideoAd\(true\)/);
  assert.match(html, /<base href="\/mirror\/karate-bros\/">/);
});

test('Escape Road: eruda, Rocket Loader and the foreign Firebase are gone; scripts run natively; Firebase is inert', () => {
  const html = served('clescaperoad');
  assert.doesNotMatch(html, /eruda/);
  assert.doesNotMatch(html, /rocket-loader/);
  assert.doesNotMatch(html, /escape-road-gm1/, 'another project\'s Firebase config reached the page');
  assert.doesNotMatch(html, /type="[0-9a-f]{16,}-text\/javascript"/);
  assert.match(html, /createUnityInstance\(canvas, config/);
  assert.ok(html.includes(INERT_FIREBASE_SHIM));
  assert.match(html, /__inzoneTouchKeys/);
});

test('Kart Bros: no third-party service worker, no rotate wall, no room code read from index.html', () => {
  const html = served('kart-bros');
  assert.doesNotMatch(html, /serviceWorker\.register/);
  assert.match(html, /PleaseRotateOptions = \{ startOnPageLoad: false \}/);
  assert.ok(html.includes(DROP_ENTRY_FILENAME_SHIM));
  assert.match(html, /devicePixelRatio: Math\.min\(window\.devicePixelRatio \|\| 1, 1\.5\)/);
  // Shims must run before the build's own scripts.
  assert.ok(html.indexOf('startOnPageLoad: false') < html.indexOf('pleaserotate.min.js'));
});

test('the entry-URL shim strips only the file name', () => {
  const run = (pathname) => {
    let replaced = null;
    const ctx = {
      window: { location: { pathname, search: '?serverUrl=x', hash: '' } },
      history: { state: null, replaceState: (_s, _t, url) => { replaced = url; } },
    };
    vm.runInNewContext(DROP_ENTRY_FILENAME_SHIM, ctx);
    return replaced;
  };
  assert.equal(run('/gcs/games/kart-bros/v1/index.html'), '/gcs/games/kart-bros/v1/?serverUrl=x');
  assert.equal(run('/gcs/games/kart-bros/v1/'), null);
});

test('inert Firebase answers every call Escape Road makes and never resolves', () => {
  const ctx = { window: {} };
  vm.runInNewContext(INERT_FIREBASE_SHIM, ctx);
  const fb = ctx.window.firebase;
  assert.doesNotThrow(() => fb.analytics().logEvent('game_start', { a: 1 }));
  assert.doesNotThrow(() => fb.firestore().collection('x').doc('y').get().then(() => { throw new Error('resolved'); }));
  assert.doesNotThrow(() => fb.auth().onAuthStateChanged(() => {}));
  // An existing Firebase is left alone.
  const own = { mine: true };
  const ctx2 = { window: { firebase: own } };
  vm.runInNewContext(INERT_FIREBASE_SHIM, ctx2);
  assert.equal(ctx2.window.firebase, own);
});

test('Playgama defaults give every jslib global a harmless string answer and keep existing ones', () => {
  const mine = () => 'mine';
  const ctx = { window: { showRewarded: mine }, navigator: { language: 'fr-FR' }, document: { visibilityState: 'visible' } };
  vm.runInNewContext(PLAYGAMA_DEFAULTS_SHIM, ctx);
  const w = ctx.window;
  assert.equal(w.showRewarded, mine);
  assert.equal(typeof w.showNextAd, 'function', 'Elytra calls showNextAd from its jslib');
  assert.equal(w.getIsRewardedSupported(), 'false');
  assert.equal(w.getPlatformLanguage(), 'fr');
  assert.equal(w.getVisibilityState(), 'visible');
  assert.equal(typeof w.getStorageDefaultType(), 'string');
});

test('mirror mapping is pinned and cannot leave the build folder', () => {
  const p = HOSTED_BUILDS['kart-bros'];
  const urls = mirrorUpstreamUrls(p, ['Build', 'a.data.unityweb.part1']);
  assert.deepEqual(urls, [
    'https://cdn.jsdelivr.net/gh/bubbls/UGS-Assets@9cf433220236bb0471ab3a68ec8fe3e0a2799e36/kart%20bros/Build/a.data.unityweb.part1',
    'https://raw.githubusercontent.com/bubbls/UGS-Assets/9cf433220236bb0471ab3a68ec8fe3e0a2799e36/kart%20bros/Build/a.data.unityweb.part1',
  ]);
  const root = mirrorUpstreamUrls(HOSTED_BUILDS.clelytraflight, ['Build.jpg']);
  assert.equal(root[0], 'https://cdn.jsdelivr.net/gh/familiapablo/lopx@dfa64e22167e668c4d2fd0f745bbf4508ded3b94/Build.jpg');
  for (const bad of [['..', 'x.js'], ['a', '..', 'b.js'], [], ['a\\b.js'], ['.', 'x.js'], ['']]) {
    assert.equal(safeMirrorSegments(bad), false, JSON.stringify(bad));
    assert.deepEqual(mirrorUpstreamUrls(p, bad), []);
  }
  // A moving ref is refused even if someone edits a profile to use one.
  assert.deepEqual(mirrorUpstreamUrls({ ...p, upstream: { ...p.upstream, sha: 'main' } }, ['x.js']), []);
});

test('mirror refuses documents and server scripts, and never labels Unity blobs as encoded', () => {
  assert.equal(mirrorContentType('index.html'), null);
  assert.equal(mirrorContentType('recordsession.php'), null);
  assert.equal(mirrorContentType('x.data.unityweb'), 'application/octet-stream');
  assert.equal(mirrorContentType('x.wasm.unityweb.part2'), 'application/octet-stream');
  assert.match(mirrorContentType('loader.js'), /javascript/);
  assert.equal(mirrorContentType('style.css'), 'text/css; charset=utf-8');
});

test('the transform is idempotent', () => {
  for (const id of STUBS) {
    const once = applyHostedBuild(fixture(id), HOSTED_BUILDS[id]);
    assert.equal(applyHostedBuild(once, HOSTED_BUILDS[id]), once);
  }
});

test('touch keys: visible, big enough, keyboard-only builds only, and they never cancel a click', () => {
  assert.ok(TOUCH_PAD_SIZE_PX >= 44);
  const source = touchControlsScript(HOSTED_BUILDS.clescaperoad.touchControls);
  assert.doesNotThrow(() => new vm.Script(source));
  assert.doesNotMatch(source, /pointerdown[^;]*preventDefault/);
  assert.match(source, /touch-action:none/);
  assert.match(source, /safe-area-inset-bottom/);
  assert.match(source, /pointer: coarse/);
  for (const id of STUBS) {
    const hasPads = /__inzoneTouchKeys/.test(served(id));
    // Only Escape Road lacks touch input of its own; the others draw theirs.
    assert.equal(hasPads, id === 'clescaperoad', `${id} pads`);
  }
});

test('touch keys press on pointerdown, release on pointerup, and never leave a key held', async () => {
  const events = [];
  const listeners = {};
  const el = () => ({
    children: [],
    className: '',
    style: {},
    setAttribute() {},
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(type, fn) { (this.l ||= {})[type] = fn; },
    setPointerCapture() {},
    dispatchEvent(e) { events.push(`${e.type}:${e.code}`); return true; },
  });
  const body = el();
  const canvas = el();
  const doc = {
    body,
    head: el(),
    documentElement: el(),
    visibilityState: 'visible',
    createElement: () => el(),
    getElementById: () => null,
    querySelector: () => canvas,
    addEventListener(type, fn) { listeners[`doc:${type}`] = fn; },
  };
  class KeyboardEvent { constructor(type, init) { this.type = type; Object.assign(this, init); } }
  const win = {
    matchMedia: () => ({ matches: true }),
    addEventListener(type, fn) { listeners[`win:${type}`] = fn; },
  };
  const ctx = { window: win, document: doc, KeyboardEvent, Date, setTimeout, Object };
  vm.runInNewContext(touchControlsScript(HOSTED_BUILDS.clescaperoad.touchControls), ctx);
  const root = body.children[0];
  const [left, right] = root.children;
  right.l.pointerdown({ pointerId: 1 });
  right.l.pointerup({ pointerId: 1 });
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(events, ['keydown:KeyD', 'keyup:KeyD'], 'a quick tap still delivers a held key');
  events.length = 0;
  left.l.pointerdown({ pointerId: 2 });
  listeners['win:blur']();
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(events, ['keydown:KeyA', 'keyup:KeyA'], 'blur releases a held key');
});

test('every stub has verified controls text and a landscape flag only where the build is drawn for landscape', () => {
  for (const id of STUBS) {
    const c = gameControls(id);
    assert.ok(c && c.primary, `${id} has no controls text`);
    assert.match(c.verifiedAgainst, /2026-09-30/);
  }
  assert.equal(gameControls('clescaperoad').landscape, undefined, 'Escape Road fits portrait');
  for (const id of ['kart-bros', 'clelytraflight', 'karate-bros']) {
    assert.equal(gameControls(id).landscape, true);
    assert.ok(gameControls(id).orientationHint);
  }
  // The old claims that sent players the wrong way are gone.
  assert.doesNotMatch(JSON.stringify(flagshipKnowledge('kart-bros')), /Invalid code, then Host/);
  assert.match(flagshipKnowledge('kart-bros').controls[0], /Quick Play/);
  assert.match(flagshipKnowledge('clelytraflight').objective, /no takeoff/i);
});

test('Nightclub: a touch on the canvas focuses it, as a click already does — and nothing else', () => {
  const html = instrumentGameHtml('<html><head></head><body></body></html>', {
    baseHref: '/gcs/games/nightclub-showdown-inzone-production/v2/',
    gameId: 'nightclub-showdown-inzone-production',
  });
  assert.match(html, new RegExp(NIGHTCLUB_TOUCH_FOCUS_MARKER));
  const source = nightclubTouchFocusScript();
  assert.doesNotMatch(source, /\.click\(/);
  assert.doesNotMatch(source, /paused\s*=\s*false/);
  assert.doesNotMatch(source, /resumeGame|preventDefault/);
  assert.match(source, /passive: true/);

  let handler = null;
  let focusedCalls = 0;
  const canvas = { id: 'webgl', focus() { doc.activeElement = canvas; } };
  const doc = { visibilityState: 'visible', activeElement: null, getElementById: () => canvas };
  const hx = { focused: false, onFocus(b) { focusedCalls += 1; this.focused = b; } };
  const win = {
    __NightclubRuntime: { Boot: { ME: { s2d: { window: hx } } } },
    addEventListener(type, fn, opts) { if (type === 'touchstart') { handler = fn; assert.equal(opts.capture, true); } },
  };
  vm.runInNewContext(source, { window: win, document: doc });
  handler({ target: { id: 'resultsCard' } });
  assert.equal(hx.focused, false, 'a touch on the HUD is not a touch on the game');
  handler({ target: canvas });
  assert.equal(doc.activeElement, canvas);
  assert.equal(hx.focused, true);
  handler({ target: canvas });
  assert.equal(focusedCalls, 1, 'already focused: no repeat');
  doc.visibilityState = 'hidden';
  hx.focused = false;
  handler({ target: canvas });
  assert.equal(hx.focused, false, 'a hidden page is never told it has focus');
});

test('no injected script id shadows its own window install guard', () => {
  // An element id is a named property on window. A tag whose id equals the
  // guard makes `if (window.__guard) return;` true before the script runs,
  // and the shim silently never installs — which is what happened to the
  // audio duck and the Nightclub focus hold.
  const tags = [
    gameAudioDuckTag(),
    nightclubCompanionFocusTag(),
    nightclubTouchFocusTag(),
    touchControlsTag(HOSTED_BUILDS.clescaperoad.touchControls),
  ];
  for (const tag of tags) {
    const id = /<script id="([^"]+)"/.exec(tag)[1];
    assert.doesNotMatch(tag, new RegExp(`window\\.${id.replace(/[-]/g, '\\-')}\\b(?!-)`), `id ${id} shadows its guard`);
  }
});
