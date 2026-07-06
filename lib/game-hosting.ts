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

/** Inject the viewport-fit script into a game's HTML (idempotent). Inserted as
 *  early as possible — right after <head> when present — so the viewport meta
 *  is normalized before the game's own scripts run. */
export function injectViewportFit(html: string): string {
  if (html.includes('__inzoneViewportFit')) return html; // already instrumented
  const at = (re: RegExp): number => {
    const m = re.exec(html);
    return m ? m.index + m[0].length : -1;
  };
  let i = at(/<head[^>]*>/i);
  if (i === -1) i = at(/<html[^>]*>/i);
  if (i === -1) i = 0;
  return html.slice(0, i) + VIEWPORT_FIT_TAG + html.slice(i);
}
