import { touchControlsTag, type TouchControlLayout } from './touch-controls.ts';

/**
 * Third-party builds we host, and exactly what we change about them.
 *
 * Four of the five flagships are "Ultimate Game Stash" stubs: a single
 * index.html in our bucket whose real files (Unity data, wasm, OpenFL bundle,
 * images) live in somebody else's GitHub repo and were fetched by the player's
 * browser from cdn.jsdelivr.net. Every problem the device reports traced back
 * to that arrangement or to desktop-only assumptions inside the builds:
 *
 *   - Moving references. Kart Bros and Elytra pointed at `@main`, so whoever
 *     controls those repos could change the game — or its JavaScript, which
 *     runs same-origin on inzone.games in an unsandboxed frame that holds the
 *     player's Firebase session — without us shipping anything.
 *   - A third-party CDN on every phone. Filters, WebViews and carriers that
 *     refuse cdn.jsdelivr.net (or Escape Road's `classroom.google.com/
 *     drive.google.com` path, built to slip past school filters and flagged
 *     by the same tools for exactly that reason) got a stage with no game.
 *   - Other people's ad and analytics SDKs. Karate Bros loads the adinplay tag
 *     as a *synchronous* script: where that host is black-holed rather than
 *     refused the parser stops, and the page sits on div#loading until the
 *     network gives up. Escape Road shipped an on-page debug console (eruda,
 *     unpinned @latest) and a Firebase project that is not ours.
 *
 * So every build here is served from a pinned, same-origin mirror —
 * `/mirror/<gameId>/…` streams `<repo>@<sha>/<dir>/…` (see
 * app/mirror/[gameId]/[...path]/route.ts) — and the entry HTML is rewritten on
 * its way through /gcs to point at it. A pin is a full commit SHA and never a
 * branch: the files behind it cannot change.
 *
 * Every change below was checked by booting the build in Chromium through
 * this exact transform (phone portrait, phone landscape) — see the
 * `verified` note on each profile. None of them invents gameplay: they remove
 * things that stop a build starting, and add keys a build asks for but a phone
 * does not have.
 */

export type UpstreamPin = {
  /** GitHub owner/repo that holds the build's own files. */
  repo: string;
  /** Full 40-hex commit SHA. Never a branch or tag. */
  sha: string;
  /** Directory inside the repo, unencoded; '' for the repo root. */
  dir: string;
};

export type TextPatch = {
  find: string;
  replace: string;
  why: string;
};

export type HostedBuildProfile = {
  gameId: string;
  upstream: UpstreamPin;
  /** External script srcs removed from the entry HTML. */
  dropScriptSrc: RegExp[];
  /** Inline scripts removed when their body matches. */
  dropInlineScript: RegExp[];
  /** Undo Cloudflare Rocket Loader's type mangling so scripts run natively,
   *  without fetching rocket-loader.min.js from the upstream. */
  restoreRocketLoader?: boolean;
  /** Exact-string edits to the entry HTML. A find that is absent is skipped. */
  patches: TextPatch[];
  /** Scripts that must run before the build's own (inserted first in <head>). */
  earlyShims: string[];
  /** Styles appended to <head>. */
  styles: string[];
  touchControls?: TouchControlLayout;
  /** What was run to establish the profile works. */
  verified: string;
};

export const MIRROR_ROUTE_PREFIX = '/mirror/';

export function mirrorBase(gameId: string): string {
  return `${MIRROR_ROUTE_PREFIX}${gameId}/`;
}

/* ── Shims ─────────────────────────────────────────────────────────────── */

/** A Firebase that accepts every call and sends nothing.
 *  Escape Road's Unity plugin calls `firebase.analytics().logEvent()` the
 *  instant a run starts; with its (third-party) Firebase scripts removed, or
 *  merely blocked by an ad blocker, that call threw inside wasm and Unity
 *  aborted the game on its first key press. Every property is the same inert
 *  callable; `then` never fires, so nothing waits on a result that comes back
 *  wrong. */
export const INERT_FIREBASE_SHIM = String.raw`
(function () {
  try {
    if (window.firebase) return;
    var inert;
    var fn = function () { return inert; };
    inert = new Proxy(fn, {
      get: function (t, k) {
        if (k === 'then' || k === 'catch' || k === 'finally') return function () { return inert; };
        if (k === Symbol.toPrimitive) return function () { return ''; };
        if (k === 'toString' || k === 'valueOf') return function () { return ''; };
        return inert;
      },
      apply: function () { return inert; }
    });
    window.firebase = inert;
  } catch (e) {}
})();
`.trim();

/** Escape Road's own lifecycle, recorded where the build already reports it.
 *
 *  Inspected against classroom.google.com@45b2d69 by playing two full runs
 *  with every outbound call recorded (September 2026):
 *    - `firebase.analytics().logEvent('Press_play_game')` fires on the first
 *      steer of every run — a key or pad press, never a tap on the title —
 *      and at no other time. The ▶ on the Wanted card logs
 *      `Restart_button_click_level` and `_showInter_escape-road` instead.
 *    - The ARRESTED card logs nothing. What the build does at every game
 *      over is add one to its interstitial counter, PlayerPrefs `ads`, and
 *      persist PlayerPrefs to IndexedDB. Run 1 took it 0 → 1 with a new
 *      best, run 2 took it 1 → 2 without one; a run start and the ▶ tap
 *      leave it alone.
 *
 *  So this wraps whatever Firebase is installed (the inert stub, here) and
 *  records only the event NAME — parameters are dropped unread — and reads
 *  the one integer `ads` out of each PlayerPrefs write on its way to
 *  IndexedDB. Both land on `window.__inzoneBuildEvents` and as an
 *  `inzone:build-event` on the game window, where the same-origin adapter
 *  (lib/escape-road-gameplay-adapter.ts) listens. Nothing is sent anywhere,
 *  and every call still reaches the Firebase and IndexedDB it was made on. */
export const BUILD_EVENTS_SHIM = String.raw`
(function () {
  try {
    if (window.__inzoneBuildEvents) return;
    var NAME = /^[A-Za-z0-9_-]{1,64}$/;
    var probe = { v: 1, events: [], prefs: {} };
    window.__inzoneBuildEvents = probe;
    var note = function (detail) {
      probe.events.push(detail);
      if (probe.events.length > 50) probe.events.shift();
      try { window.dispatchEvent(new CustomEvent('inzone:build-event', { detail: detail })); } catch (e) {}
    };

    var fb = window.firebase;
    if (fb && typeof fb.analytics === 'function') {
      var analyticsOf = function (a) {
        return new Proxy(a, {
          get: function (t, k) {
            if (k !== 'logEvent') return t[k];
            return function (name) {
              try { if (typeof name === 'string' && NAME.test(name)) note({ kind: 'log', name: name }); } catch (e) {}
              return t.logEvent.apply(t, arguments);
            };
          }
        });
      };
      window.firebase = new Proxy(fb, {
        get: function (t, k) {
          if (k !== 'analytics') return t[k];
          return function () { return analyticsOf(t.analytics.apply(t, arguments)); };
        }
      });
    }

    // Unity PlayerPrefs: "UnityPrf" + 8 header bytes, then entries of
    // [key length][key][type][value]; 0xFE is a little-endian int32.
    var readInt = function (bytes, want) {
      if (bytes.length < 16 || String.fromCharCode.apply(null, Array.prototype.slice.call(bytes, 0, 8)) !== 'UnityPrf') return null;
      var i = 16;
      var u32 = function (at) { return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0; };
      while (i < bytes.length) {
        var n = bytes[i++];
        if (n === 0x80) { n = u32(i); i += 4; }
        var key = String.fromCharCode.apply(null, Array.prototype.slice.call(bytes, i, i + n)); i += n;
        var t = bytes[i++];
        if (t === 0xfe) { if (key === want) return u32(i) | 0; i += 4; }
        else if (t === 0xfd) { i += 4; }
        else if (t === 0x80) { i += 4 + u32(i); }
        else if (t < 0x80) { i += t; }
        else return null;
      }
      return null;
    };
    var store = window.IDBObjectStore && window.IDBObjectStore.prototype;
    if (store && typeof store.put === 'function') {
      var put = store.put;
      store.put = function (value, key) {
        try {
          if (typeof key === 'string' && /\/PlayerPrefs$/.test(key) && value && value.contents && value.contents.length) {
            var ads = readInt(value.contents, 'ads');
            if (ads !== null && ads !== probe.prefs.ads) {
              probe.prefs.ads = ads;
              note({ kind: 'pref', key: 'ads', value: ads });
            }
          }
        } catch (e) {}
        return put.apply(this, arguments);
      };
    }
  } catch (e) {}
})();
`.trim();

/** Elytra's jslib reaches for Playgama bridge globals and a `showNextAd` that
 *  the stub page never defined. A jslib call that throws aborts Unity, so each
 *  missing global gets a harmless answer: every "is X supported" is "false",
 *  every ad or platform action is a no-op. Existing globals are left alone. */
export const PLAYGAMA_DEFAULTS_SHIM = String.raw`
(function () {
  try {
    var no = function () {};
    var str = function (v) { return function () { return v; }; };
    var set = function (name, value) { if (typeof window[name] === 'undefined') window[name] = value; };
    var actions = ['showNextAd', 'initSdk', 'showInterstitial', 'showRewarded', 'showBanner', 'hideBanner',
      'addToFavorites', 'addToHomeScreen', 'checkAdBlock', 'getAllGames', 'getGameById', 'authorizePlayer',
      'achievementsGetList', 'achievementsShowNativePopup', 'achievementsUnlock', 'createPost', 'inviteFriends',
      'joinCommunity', 'rate', 'share', 'leaderboardsGetEntries', 'leaderboardsSetScore', 'paymentsConsumePurchase',
      'paymentsGetCatalog', 'paymentsGetPurchases', 'paymentsPurchase', 'remoteConfigGet', 'sendMessageToPlatform',
      'setMinimumDelayBetweenInterstitial', 'getServerTime', 'getStorageData', 'setStorageData', 'deleteStorageData'];
    for (var i = 0; i < actions.length; i++) set(actions[i], no);
    var flags = ['getIsAchievementsNativePopupSupported', 'getIsAchievementsSupported', 'getIsAddToFavoritesSupported',
      'getIsAddToHomeScreenSupported', 'getIsBannerSupported', 'getIsCreatePostSupported', 'getIsExternalLinksAllowed',
      'getIsGetAchievementsListSupported', 'getIsInterstitialSupported', 'getIsInviteFriendsSupported',
      'getIsJoinCommunitySupported', 'getIsPaymentsSupported', 'getIsPlatformGetAllGamesSupported',
      'getIsPlatformGetGameByIdSupported', 'getIsPlayerAuthorizationSupported', 'getIsPlayerAuthorized',
      'getIsRateSupported', 'getIsRemoteConfigSupported', 'getIsRewardedSupported', 'getIsShareSupported',
      'getIsStorageAvailable', 'getIsStorageSupported', 'getIsLeaderboardSupported'];
    for (var j = 0; j < flags.length; j++) set(flags[j], str('false'));
    set('getIsPlatformAudioEnabled', str('true'));
    set('getPlatformId', str('mock'));
    set('getPlatformTld', str(''));
    set('getPlatformPayload', str(''));
    set('getPlayerId', str(''));
    set('getPlayerName', str(''));
    set('getPlayerPhotos', str('[]'));
    set('getLeaderboardsType', str('not_available'));
    set('getInterstitialState', str('closed'));
    set('getRewardedPlacement', str(''));
    set('getMinimumDelayBetweenInterstitial', str('60'));
    set('getStorageDefaultType', str('local_storage'));
    set('getPlatformLanguage', function () { try { return (navigator.language || 'en').slice(0, 2); } catch (e) { return 'en'; } });
    set('getVisibilityState', function () { return document.visibilityState || 'visible'; });
  } catch (e) {}
})();
`.trim();

/** pleaserotate.js (Kart Bros) paints a full white "PLEASE ROTATE YOUR
 *  DEVICE" wall over a portrait phone before the menu. Its own option turns
 *  that off; the host offers the real landscape path instead
 *  (lib/display-mode.ts `landscapePrompt`). */
export const PLEASE_ROTATE_OFF_SHIM = 'window.PleaseRotateOptions = { startOnPageLoad: false };';

/** Kart Bros reads a room code out of its own URL (MainMenuScreen
 *  .ExtractRoomCodeFromURL over Application.absoluteURL): kartbros.io/CODE
 *  joins room CODE. Served as …/v1/index.html, it read "index.html" as a code
 *  and opened "INVALID CODE" over the menu on every single load — the
 *  "lobby-first" screen a phone saw before it could reach Quick Play. The
 *  document URL loses its file name before the engine starts; every asset
 *  resolves through the build's own <base>, so nothing else moves. */
export const DROP_ENTRY_FILENAME_SHIM = String.raw`
(function () {
  try {
    var p = window.location.pathname;
    if (!/\/index\.html?$/i.test(p)) return;
    history.replaceState(history.state, '', p.replace(/index\.html?$/i, '') + window.location.search + window.location.hash);
  } catch (e) {}
})();
`.trim();

function scriptTag(source: string, id: string): string {
  return `<script id="${id}">${source}</script>`;
}

/* ── Profiles ──────────────────────────────────────────────────────────── */

const AD_AND_TRACKER_SRCS: RegExp[] = [
  /(^|\/\/|\.)adinplay\.com\//i,
  /(^|\/\/|\.)googletagmanager\.com\//i,
  /\/cdn-cgi\//i,
];

export const HOSTED_BUILDS: Readonly<Record<string, HostedBuildProfile>> = {
  'kart-bros': {
    gameId: 'kart-bros',
    upstream: { repo: 'bubbls/UGS-Assets', sha: '9cf433220236bb0471ab3a68ec8fe3e0a2799e36', dir: 'kart bros' },
    dropScriptSrc: [...AD_AND_TRACKER_SRCS],
    // A third-party service worker has no business registering on inzone.games.
    dropInlineScript: [/navigator\.serviceWorker\.register/],
    patches: [
      {
        // Unity renders at the device pixel ratio unless told otherwise — 3x
        // on most phones, nine times the pixels of 1x on a budget GPU.
        find: 'showBanner: unityShowBanner,',
        replace: 'showBanner: unityShowBanner,\n      devicePixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),',
        why: 'cap render resolution on high-DPR phones',
      },
    ],
    earlyShims: [
      scriptTag(PLEASE_ROTATE_OFF_SHIM, '__inzone-pleaserotate-off'),
      scriptTag(DROP_ENTRY_FILENAME_SHIM, '__inzone-entry-url'),
    ],
    styles: [],
    verified:
      'Chromium 844x390 touch: QUICK PLAY → Choose your bro → Choose a track → race with the build\'s own drag-to-steer, gas and item controls. 390x780: menu shown without the white rotate wall.',
  },
  clelytraflight: {
    gameId: 'clelytraflight',
    upstream: { repo: 'familiapablo/lopx', sha: 'dfa64e22167e668c4d2fd0f745bbf4508ded3b94', dir: '' },
    dropScriptSrc: [...AD_AND_TRACKER_SRCS],
    dropInlineScript: [],
    patches: [],
    earlyShims: [scriptTag(PLAYGAMA_DEFAULTS_SHIM, '__inzone-playgama-defaults')],
    styles: [],
    verified:
      'Chromium 844x390 touch: 1 PLAYER launches straight into a glide with the build\'s own two joysticks; no takeoff key exists or is needed. 390x780: the engine refuses portrait with its own "rotate to landscape" screen.',
  },
  'karate-bros': {
    gameId: 'karate-bros',
    upstream: { repo: 'bubbls/UGS-Assets', sha: 'ba0d3910bd7dde2f6171c57d658113f9df69dd77', dir: 'karate bros' },
    // Removing the adinplay tag leaves `adplayer` undefined, which the page's
    // own ShowVideo() treats as "ad blocked" and completes at once.
    dropScriptSrc: [...AD_AND_TRACKER_SRCS],
    dropInlineScript: [],
    patches: [],
    earlyShims: [],
    styles: [
      // OpenFL scales its 16:9 stage into whatever box it gets and anchors it
      // to the top, leaving a phone's lower three quarters black. A centred
      // 16:9 box gives the same scale, balanced bands, and letterbox Rook can
      // measure. Input stays aligned: OpenFL reads the element's own rect.
      '<style id="__inzone-portrait-stage">@media (orientation: portrait){#openfl-content{position:absolute!important;left:0!important;width:100%!important;height:56.25vw!important;max-height:100%!important;top:max(0px,calc(50% - 28.125vw))!important}}</style>',
    ],
    verified:
      'Chromium 844x390 touch: PLAY NOW → Choose your bro (default fighter already selected) → READY → Round 1 with the build\'s own ◀ ▶, punch and jump pads. 390x780: centred stage, PLAY NOW responds to a tap.',
  },
  clescaperoad: {
    gameId: 'clescaperoad',
    upstream: {
      repo: 'abisdbest/classroom.google.com',
      sha: '45b2d69c626dc365753f6922d2c48c4075683ef5',
      dir: 'drive.google.com/escape road',
    },
    dropScriptSrc: [
      ...AD_AND_TRACKER_SRCS,
      /cdn\.jsdelivr\.net\/npm\/eruda/i,
      /gstatic\.com\/firebasejs\//i,
      /rocket-loader(\.min)?\.js/i,
    ],
    dropInlineScript: [/eruda\.init\(/, /initializeApp\(firebaseConfig\)/],
    restoreRocketLoader: true,
    patches: [],
    // Order matters: the recorder wraps the Firebase the inert stub installs.
    earlyShims: [
      scriptTag(INERT_FIREBASE_SHIM, '__inzone-inert-firebase'),
      scriptTag(BUILD_EVENTS_SHIM, '__inzone-build-events-script'),
    ],
    styles: [],
    touchControls: {
      // Clears the build's own garage and More Games buttons in the corners.
      bottomPx: 64,
      keys: [
        { label: '◀', aria: 'Steer left', key: 'a', code: 'KeyA', keyCode: 65, side: 'left' },
        { label: '▶', aria: 'Steer right', key: 'd', code: 'KeyD', keyCode: 68, side: 'right' },
      ],
    },
    verified:
      'Chromium 390x780 touch: taps alone never start a run. With the pads\' A/D: run starts, car steers, crash shows the WANTED/ARRESTED card with a score, a tap on its ▶ returns to the title and A/D starts run two.',
  },
};

export function hostedBuild(gameId: string): HostedBuildProfile | null {
  return HOSTED_BUILDS[gameId] ?? null;
}

/* ── Mirror mapping ────────────────────────────────────────────────────── */

const PIN_SHA = /^[0-9a-f]{40}$/;

function encodePath(parts: string[]): string {
  return parts.filter((p) => p.length > 0).map(encodeURIComponent).join('/');
}

/** Path segments a mirror request may carry: no traversal, no empties, no
 *  control characters. The route only ever serves inside one pinned folder. */
export function safeMirrorSegments(segments: string[]): boolean {
  if (segments.length === 0 || segments.length > 16) return false;
  return segments.every((s) => s.length > 0 && s.length <= 200 && s !== '.' && s !== '..' && !/[\\\u0000-\u001f]/.test(s));
}

/** Where a mirror path is fetched from, in order: jsDelivr for the pinned
 *  commit (its CDN, immutable at a SHA), then GitHub's raw host for the same
 *  commit if jsDelivr fails or refuses a large file. */
export function mirrorUpstreamUrls(profile: HostedBuildProfile, segments: string[]): string[] {
  const { repo, sha, dir } = profile.upstream;
  if (!PIN_SHA.test(sha)) return [];
  if (!safeMirrorSegments(segments)) return [];
  const rel = encodePath([...dir.split('/'), ...segments]);
  return [
    `https://cdn.jsdelivr.net/gh/${repo}@${sha}/${rel}`,
    `https://raw.githubusercontent.com/${repo}/${sha}/${rel}`,
  ];
}

const MIME: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  wasm: 'application/wasm',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'video/webm',
  otf: 'font/otf',
  ttf: 'font/ttf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml',
};

/** Extensions never served from a mirror: a document from someone else's repo
 *  must not be navigable on our origin, and server scripts are only ever a
 *  build's analytics beacons (Kart and Karate ping `recordsession.php`). */
const REFUSED_EXT = new Set(['html', 'htm', 'xhtml', 'php', 'map']);

export function mirrorContentType(fileName: string): string | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(fileName);
  const ext = m ? m[1].toLowerCase() : '';
  if (REFUSED_EXT.has(ext)) return null;
  // Unity's .unityweb (and the split .part1/.part2) are compressed blobs the
  // loader decompresses itself; they must not claim a Content-Encoding.
  return MIME[ext] ?? 'application/octet-stream';
}

/* ── Entry HTML transform ──────────────────────────────────────────────── */

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Matches this build's jsDelivr URL prefix at ANY ref (branch, tag or SHA),
 *  with the directory spelled either encoded or raw. */
export function upstreamPrefixPattern(pin: UpstreamPin): RegExp {
  const dirParts = pin.dir.split('/').filter(Boolean).map((part) =>
    part.split(' ').map(escapeRe).join('(?:%20| )'),
  );
  const dir = dirParts.length ? `${dirParts.join('/')}/` : '';
  return new RegExp(`(?:https?:)?//cdn\\.jsdelivr\\.net/gh/${escapeRe(pin.repo)}@[^/"'\\s]+/${dir}`, 'gi');
}

const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

function srcOf(attrs: string): string | null {
  const m = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}

function appendToHead(html: string, fragment: string): string {
  const i = html.search(/<\/head\s*>/i);
  if (i === -1) return fragment + html;
  return html.slice(0, i) + fragment + html.slice(i);
}

function insertAfterHeadOpen(html: string, fragment: string): string {
  const m = /<head[^>]*>/i.exec(html);
  if (!m) return fragment + html;
  const at = m.index + m[0].length;
  return html.slice(0, at) + fragment + html.slice(at);
}

export const HOSTED_BUILD_MARKER = 'data-inzone-hosted';

/**
 * Rewrite a hosted build's entry HTML: jsDelivr refs → pinned same-origin
 * mirror, drop the scripts listed on the profile, apply patches, add shims,
 * styles and touch keys. Idempotent.
 */
export function applyHostedBuild(html: string, profile: HostedBuildProfile): string {
  if (html.includes(HOSTED_BUILD_MARKER)) return html;
  let out = html.replace(upstreamPrefixPattern(profile.upstream), mirrorBase(profile.gameId));

  if (profile.restoreRocketLoader) {
    // Rocket Loader rewrites type="text/javascript" to "<hash>-text/javascript"
    // so its own loader runs them later. Put the real types back.
    out = out.replace(/\btype\s*=\s*"[0-9a-f]{16,40}-(text\/javascript|module)"/gi, 'type="$1"');
  }

  out = out.replace(SCRIPT_TAG, (whole, attrs: string, body: string) => {
    const src = srcOf(attrs);
    if (src !== null) {
      return profile.dropScriptSrc.some((re) => re.test(src)) ? '' : whole;
    }
    return profile.dropInlineScript.some((re) => re.test(body)) ? '' : whole;
  });

  for (const p of profile.patches) {
    if (out.includes(p.find)) out = out.replace(p.find, p.replace);
  }

  const early = profile.earlyShims.join('');
  const marker = `<meta name="inzone-hosted" ${HOSTED_BUILD_MARKER}="${profile.gameId}@${profile.upstream.sha.slice(0, 12)}">`;
  out = insertAfterHeadOpen(out, marker + early);

  const tail = [...profile.styles, profile.touchControls ? touchControlsTag(profile.touchControls) : ''].join('');
  if (tail) out = appendToHead(out, tail);
  return out;
}
