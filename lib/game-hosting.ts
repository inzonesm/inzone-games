import { GAME_SDK_BOOTSTRAP_MARKER, gameSdkBootstrapTag } from './game-sdk/iframe-sdk.ts';

/* Game hosting constants + the viewport-fit script.
 *
 * Shared by BOTH sides of the fit story (keep it free of 'use client' so the
 * server route can import it):
 *
 *   • lib/upload-pipeline.ts bakes the script into a build's entry HTML at
 *     upload time.
 *   • app/gcs/[...path]/route.ts serves ALREADY-uploaded games same-origin and
 *     injects the script at request time, so existing games fit without a
 *     re-upload.
 *
 * The script itself is a port of the InZone Flutter app's WebView injection
 * (inzone-flutter-app community_game_screen.dart, _viewportFitScript — keep
 * the two in sync). It fixes the two ways HTML5/WebGL games render wrong:
 *
 * 1. Games without a `<meta name="viewport">` tag get a normalized
 *    `width=device-width` one (matters when the build URL is opened directly
 *    on a phone; inside an iframe the meta is ignored and harmless).
 * 2. Fixed-size canvases / Unity containers (e.g. a 1280×720 build) that
 *    overflow the viewport are pinned to it and scaled back down with
 *    `object-fit: contain`, so the whole game stays visible instead of
 *    looking zoomed-in / cut off.
 *
 * Guarded by `window.__inzoneViewportFit`, so running it twice (upload-baked
 * copy + route-injected copy + the app's WebView injection) is a no-op.
 */

/** The bucket that holds uploaded HTML5 games and Unity builds. Separate from
 *  the default project bucket so storage rules can be scoped (public read for
 *  the bundle path, authed writes only). */
export const HTML_BUCKET = 'inzone-html';

/** Public path-style URL prefix every uploaded build lives under. */
export const GCS_GAMES_PREFIX = `https://storage.googleapis.com/${HTML_BUCKET}/`;

/** Rewrite a bucket-hosted game URL to the same-origin /gcs proxy route (which
 *  streams the same objects but injects the viewport-fit script into HTML).
 *  Query strings (e.g. ?serverUrl=… for multiplayer) survive, so games can
 *  still read them from window.location.search. Non-bucket URLs pass through
 *  untouched. */
export function sameOriginGameUrl(url: string): string {
  return url.startsWith(GCS_GAMES_PREFIX) ? `/gcs/${url.slice(GCS_GAMES_PREFIX.length)}` : url;
}

export const VIEWPORT_FIT_SCRIPT = String.raw`
(function () {
  try {
    if (window.__inzoneViewportFit) return;
    window.__inzoneViewportFit = true;

    var ensureViewportMeta = function () {
      try {
        var head = document.head || document.getElementsByTagName('head')[0];
        if (!head) return;
        var meta = document.querySelector('meta[name="viewport"]');
        if (!meta) {
          meta = document.createElement('meta');
          meta.setAttribute('name', 'viewport');
          head.appendChild(meta);
        }
        meta.setAttribute('content',
          'width=device-width, height=device-height, initial-scale=1.0, ' +
          'minimum-scale=1.0, maximum-scale=1.0, user-scalable=no, ' +
          'viewport-fit=cover');
      } catch (e) {}
    };

    var injectFitStyles = function () {
      try {
        if (document.getElementById('__inzone-fit-style')) return;
        if (!document.head && !document.documentElement) return;
        var style = document.createElement('style');
        style.id = '__inzone-fit-style';
        style.textContent =
          'html, body {' +
          '  margin: 0 !important; padding: 0 !important;' +
          '  width: 100% !important; height: 100% !important;' +
          '  overflow: hidden !important;' +
          '}' +
          '#unity-container, #unityContainer, #gameContainer,' +
          '#game-container, #game_container, #canvas-container,' +
          '.webgl-content {' +
          '  position: fixed !important; left: 0 !important; top: 0 !important;' +
          '  width: 100vw !important; height: 100vh !important;' +
          '  max-width: 100vw !important; max-height: 100vh !important;' +
          '  margin: 0 !important; transform: none !important;' +
          '}';
        (document.head || document.documentElement).appendChild(style);
      } catch (e) {}
    };

    var fitCanvas = function (c, vw, vh) {
      try {
        var rect = c.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        var overflows =
          rect.width > vw + 1 || rect.height > vh + 1 ||
          rect.left < -1 || rect.top < -1 ||
          rect.right > vw + 1 || rect.bottom > vh + 1;
        if (!overflows) return;
        c.style.setProperty('width', '100vw', 'important');
        c.style.setProperty('height', '100vh', 'important');
        c.style.setProperty('max-width', '100vw', 'important');
        c.style.setProperty('max-height', '100vh', 'important');
        c.style.setProperty('object-fit', 'contain', 'important');
        c.style.setProperty('display', 'block', 'important');
        c.style.setProperty('margin', '0', 'important');
        c.style.setProperty('position', 'fixed', 'important');
        c.style.setProperty('left', '0', 'important');
        c.style.setProperty('top', '0', 'important');
      } catch (e) {}
    };

    var refit = function () {
      try {
        ensureViewportMeta();
        injectFitStyles();
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        if (!vw || !vh) return;
        var canvases = document.getElementsByTagName('canvas');
        for (var i = 0; i < canvases.length; i++) {
          fitCanvas(canvases[i], vw, vh);
        }
      } catch (e) {}
    };
    window.__inzoneRefit = refit;

    // Engines create/resize their canvas asynchronously, so retry a few
    // times after the document settles rather than fitting only once.
    var schedule = function () {
      refit();
      setTimeout(refit, 500);
      setTimeout(refit, 1500);
      setTimeout(refit, 3000);
      setTimeout(refit, 6000);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', schedule);
    } else {
      schedule();
    }
    window.addEventListener('load', schedule);
    window.addEventListener('resize', function () { setTimeout(refit, 50); });
    window.addEventListener('orientationchange', function () {
      setTimeout(refit, 250);
    });

    // The meta tag can run as early as parse time; the rest waits for the DOM.
    ensureViewportMeta();
  } catch (e) {}
})();
`;

export const VIEWPORT_FIT_TAG = `<script id="__inzone-viewport-fit">${VIEWPORT_FIT_SCRIPT}</script>`;

/* Keep the `?serverUrl=…` query param alive across a game's own client-side
 * navigations.
 *
 * Multiplayer clients dial their server from `?serverUrl=…` on the entry URL
 * (see withServerUrl in app/games/[id]/page.tsx). But some are single-page apps
 * that assume they own the origin root and rewrite their own URL — e.g. TOSIOS
 * does history.pushState('/new?playerName=…&roomName=…') when you create/join a
 * room, which REPLACES the whole query string and drops serverUrl. The client
 * then re-reads serverUrl from window.location.search at connect time, finds
 * nothing, and dies with `Missing "serverUrl"`. The game LOADS fine (param
 * present on the entry URL) so the lobby renders — the failure only shows up on
 * room create/join, which makes it look like a server/upload problem when it is
 * not.
 *
 * This shim captures serverUrl once at load (and stashes it in sessionStorage,
 * so it also survives a genuine document navigation), then wraps
 * history.pushState/replaceState to re-append it whenever a URL would drop it.
 * No-op for single-player games (no serverUrl to preserve). Guarded so running
 * it twice is harmless. Must run before the game's own scripts — injected right
 * after <head>, same as the viewport-fit script. */
export const SERVER_URL_PERSIST_SCRIPT = String.raw`
(function () {
  try {
    if (window.__inzoneServerUrlPersist) return;
    window.__inzoneServerUrlPersist = true;

    var KEY = '__inzoneServerUrl';
    var current = new URLSearchParams(window.location.search).get('serverUrl');
    if (current) {
      try { sessionStorage.setItem(KEY, current); } catch (e) {}
    } else {
      try { current = sessionStorage.getItem(KEY); } catch (e) {}
    }
    if (!current) return; // single-player game — nothing to preserve

    var withServerUrl = function (url) {
      try {
        var u = new URL(url, window.location.href);
        if (!u.searchParams.get('serverUrl')) u.searchParams.set('serverUrl', current);
        // Return an origin-relative URL so we don't fight the app's routing.
        return u.pathname + u.search + u.hash;
      } catch (e) {
        return url;
      }
    };

    var wrap = function (original) {
      return function (state, title, url) {
        if (url !== undefined && url !== null) url = withServerUrl(String(url));
        return original.call(this, state, title, url);
      };
    };
    // Install (and re-install) our wrappers OUTSIDE the game's own router
    // wrappers. The game bundles its router (e.g. react-router's history), which
    // also wraps pushState — and reads its own location object from the URL it
    // passes. If our wrapper sits *inside* the router's, the router computes its
    // location before serverUrl is re-added and never sees it, which can stop
    // the room-connect from firing. Re-installing after DOMContentLoaded/load
    // (once the router has set up) puts us back on the outside, so the router's
    // location carries serverUrl too. Guard flags stop unbounded re-stacking.
    var install = function () {
      history.pushState = wrap(history.pushState);
      history.replaceState = wrap(history.replaceState);
      // If the URL already lost serverUrl before this ran, put it back.
      if (!new URLSearchParams(window.location.search).get('serverUrl')) {
        try {
          history.replaceState(
            history.state,
            '',
            withServerUrl(window.location.pathname + window.location.search + window.location.hash),
          );
        } catch (e) {}
      }
    };
    install();
    var reinstalled = { dom: false, load: false };
    document.addEventListener('DOMContentLoaded', function () {
      if (reinstalled.dom) return;
      reinstalled.dom = true;
      install();
    });
    window.addEventListener('load', function () {
      if (reinstalled.load) return;
      reinstalled.load = true;
      install();
    });
  } catch (e) {}
})();
`;

export const SERVER_URL_PERSIST_TAG = `<script id="__inzone-serverurl-persist">${SERVER_URL_PERSIST_SCRIPT}</script>`;

/** Insert a tag as early as possible in a document — right after <head> when
 *  present, else after <html>, else at the very start — so it runs before the
 *  game's own scripts. */
export function insertEarly(html: string, tag: string): string {
  const at = (re: RegExp): number => {
    const m = re.exec(html);
    return m ? m.index + m[0].length : -1;
  };
  let i = at(/<head[^>]*>/i);
  if (i === -1) i = at(/<html[^>]*>/i);
  if (i === -1) i = 0;
  return html.slice(0, i) + tag + html.slice(i);
}

/** Inject the viewport-fit script into a game's HTML (idempotent). Inserted as
 *  early as possible — right after <head> when present — so the viewport meta
 *  is normalized before the game's own scripts run. */
export function injectViewportFit(html: string): string {
  if (html.includes('__inzoneViewportFit')) return html; // already instrumented
  return insertEarly(html, VIEWPORT_FIT_TAG);
}

/** Inject the serverUrl-persist shim into a game's HTML (idempotent). Keeps
 *  `?serverUrl=…` on the URL across the game's own client-side navigations so
 *  multiplayer SPAs can still find their server when creating/joining a room. */
export function injectServerUrlPersist(html: string): string {
  if (html.includes('__inzoneServerUrlPersist')) return html; // already instrumented
  return insertEarly(html, SERVER_URL_PERSIST_TAG);
}

/** Pin a game's document base URL to its own folder with a `<base href>`.
 *
 *  Games are served under `/gcs/games/<slug>/<version>/` but many SPAs assume
 *  they own the origin root — once they history.pushState to a root path like
 *  `/new`, the document URL leaves the game folder and relative asset requests
 *  (`assets/foo.png`) resolve against the wrong directory and 404. An explicit
 *  <base> fixes relative-URL resolution regardless of where the SPA navigates,
 *  so assets keep loading from the game folder. No-op if the game already sets
 *  its own <base>. (Root-absolute refs like `/assets/foo.png` still bypass base
 *  — those need a client-side build fix.) */
export function injectBaseHref(html: string, baseHref: string): string {
  if (/<base\b/i.test(html)) return html; // game already declares its own base
  return insertEarly(html, `<base href="${baseHref}">`);
}

/** Inject the isolated iframe SDK bootstrap (idempotent). Does not overwrite a
 *  game-owned InZoneSDK. Tokens and Firebase config are never placed in the
 *  game document; privileged work stays in the trusted host. */
export function injectGameSdk(html: string, gameId: string): string {
  if (html.includes(GAME_SDK_BOOTSTRAP_MARKER) || html.includes('id="__inzone-web-sdk"')) return html;
  return insertEarly(html, gameSdkBootstrapTag(gameId));
}

/**
 * Production HTML instrumentation used by `/gcs` and the runnable SDK example.
 * Order: SDK bootstrap, then `<base href>`, then existing serverUrl/viewport helpers.
 */
export function instrumentGameHtml(html: string, options: { baseHref: string; gameId: string }): string {
  return injectGameSdk(
    injectBaseHref(injectServerUrlPersist(injectViewportFit(html)), options.baseHref),
    options.gameId,
  );
}

/** CORS headers so opaque-origin sandboxed frames can load module scripts and
 *  relative assets without granting the game the host's origin. */
export function applyPublicGameCors(
  headers: Headers,
  request: { origin: string | null; url: string },
): void {
  const origin = request.origin;
  if (origin === 'null') {
    headers.set('Access-Control-Allow-Origin', 'null');
  } else if (origin) {
    try {
      if (new URL(origin).origin === new URL(request.url).origin) {
        headers.set('Access-Control-Allow-Origin', origin);
      }
    } catch {
      /* ignore malformed Origin */
    }
  }
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
}

export function gameIdFromGcsPath(segments: string[]): string {
  if (segments[0] === 'games' && typeof segments[1] === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(segments[1])) {
    return segments[1];
  }
  return 'hosted-game';
}
