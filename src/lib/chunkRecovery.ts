/**
 * Recovering from a web bundle that failed to load.
 *
 * EAS Hosting can answer a burst of cold loads with 429 (an HTML body), and a tab left open
 * across a redeploy can ask for a file that no longer exists and get index.html back. Either
 * way a script fails to load or parse and the page stays blank. The fix is one reload with a
 * cache-busting URL; a sessionStorage stamp stops it looping, after which the person gets a
 * "Couldn't load" screen with a Reload button.
 *
 * Two places use this: an inline script in dist/index.html (`chunkRecoveryScript`, added by
 * scripts/web-postexport.ts) that is installed before the bundle and catches script load
 * failures, and the root ErrorBoundary for errors React sees. No React Native imports here,
 * so the export script and unit tests can use it.
 */

/** Error messages that mean code failed to load, rather than a bug in the app. */
export const CHUNK_ERROR_SOURCE =
  "Loading module .* failed|Requiring unknown module|ChunkLoadError|Loading (CSS )?chunk .* failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unexpected token '<'";

const CHUNK_ERROR = new RegExp(CHUNK_ERROR_SOURCE, 'i');

/** The session flag that records an automatic reload (so it happens at most once a minute). */
export const RELOAD_KEY = 'app:chunk-reload-at';
export const RELOAD_WINDOW_MS = 60_000;
/** Query parameter that makes the reload bypass caches; removed again on load. */
export const RELOAD_PARAM = '_reload';

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const message =
    typeof error === 'string'
      ? error
      : `${(error as { name?: string }).name ?? ''} ${(error as { message?: string }).message ?? ''}`;
  // A JSON body that turned out to be HTML is a failed request, not failed code.
  if (/JSON/.test(message)) return false;
  return CHUNK_ERROR.test(message);
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Records an automatic reload unless one happened in the last minute. Returns whether the
 * caller should reload now. With no usable storage it never auto-reloads (no loop guard).
 */
export function claimAutoReload(storage: StorageLike | null, now: number): boolean {
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(RELOAD_KEY) ?? 0) || 0;
    if (now - last < RELOAD_WINDOW_MS) return false;
    storage.setItem(RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/** The current URL with a cache-busting parameter. */
export function cacheBustingUrl(href: string, now: number): string {
  const url = new URL(href);
  url.searchParams.set(RELOAD_PARAM, String(now));
  return url.toString();
}

function sessionStore(): StorageLike | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Reloads the page, bypassing caches (web only). */
export function hardReload() {
  if (typeof location === 'undefined') return;
  location.replace(cacheBustingUrl(location.href, Date.now()));
}

/**
 * For a load failure on web: reloads once (returns true, the page is going away) or returns
 * false when it already tried, so the caller shows the "Couldn't load" screen.
 */
export function recoverFromChunkError(): boolean {
  if (typeof location === 'undefined') return false;
  if (!claimAutoReload(sessionStore(), Date.now())) return false;
  hardReload();
  return true;
}

/**
 * The inline script for dist/index.html. It runs before the app bundle, so it also catches
 * the bundle itself failing (the app can't render anything then): it reloads once, then
 * shows a plain "Couldn't load" screen with a Reload button.
 */
export function chunkRecoveryScript(): string {
  const config = JSON.stringify({
    pattern: CHUNK_ERROR_SOURCE,
    key: RELOAD_KEY,
    windowMs: RELOAD_WINDOW_MS,
    param: RELOAD_PARAM,
  });
  return `(function () {
  var C = ${config};
  var P = new RegExp(C.pattern, 'i');
  function bust() { var u = new URL(location.href); u.searchParams.set(C.param, String(Date.now())); return u.toString(); }
  try {
    var here = new URL(location.href);
    if (here.searchParams.has(C.param)) {
      here.searchParams.delete(C.param);
      history.replaceState(history.state, '', here.pathname + here.search + here.hash);
    }
  } catch (e) {}
  var shown = false;
  function show() {
    if (shown || !document.body) return;
    shown = true;
    var dark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
    var box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.id = 'load-failed';
    box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:16px;font:16px/1.4 system-ui,sans-serif;text-align:center;background:' + (dark ? '#11161F;color:#F2F4F7' : '#FAF7F2;color:#1B2230');
    var p = document.createElement('p');
    p.textContent = "Couldn't load. Check your connection and reload.";
    p.style.margin = '0';
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Reload';
    b.style.cssText = 'min-height:48px;padding:0 24px;border:0;border-radius:999px;font:700 16px system-ui,sans-serif;background:#3A6894;color:#fff;cursor:pointer';
    b.onclick = function () { location.replace(bust()); };
    box.appendChild(p);
    box.appendChild(b);
    document.body.appendChild(box);
  }
  function recover() {
    if (window.__appRecovering) return true;
    var last = 0;
    try { last = Number(sessionStorage.getItem(C.key)) || 0; } catch (e) { last = Date.now(); }
    if (Date.now() - last >= C.windowMs) {
      try {
        sessionStorage.setItem(C.key, String(Date.now()));
        window.__appRecovering = true;
        location.replace(bust());
        return true;
      } catch (e) {}
    }
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
    return false;
  }
  window.__appChunkRecover = recover;
  function isChunk(m) { m = String(m || ''); return !/JSON/.test(m) && P.test(m); }
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t !== window && (t.tagName === 'SCRIPT' || (t.tagName === 'LINK' && t.rel === 'stylesheet'))) { recover(); return; }
    if (isChunk(e.message) || (e.error && isChunk(e.error.name + ' ' + e.error.message))) recover();
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    if (r && isChunk(typeof r === 'string' ? r : r.name + ' ' + r.message)) recover();
  });
})();`;
}
