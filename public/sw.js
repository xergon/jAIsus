/* jAIsus service worker — plain JS, served as-is from /public.
 *
 * Goals:
 *   1. Fast repeat loads (cache static assets)
 *   2. Graceful offline fallback (inline HTML page when truly offline)
 *   3. Stay out of the way of /api/* — chat/TTS/vision MUST always hit the network
 *   4. Don't fight VersionCheck — when a new build is detected, the page hard-reloads
 *      and the network-first navigation strategy will pull fresh HTML
 *
 * NOTE: This file is not aware of src/lib/sw-config.ts (no module system in SWs).
 * The CACHE_VERSION below MUST be kept in sync with SW_VERSION in src/lib/sw-config.ts.
 */

// Audit fix: bump per release. Keeping cache versions identical across builds
// meant a stale cached `/` HTML (with old hashed chunk URLs) could be served
// after a deploy, 404'ing on chunk fetches. Bump this whenever the SW or the
// cached HTML / app-shell strategy changes — keep in sync with SW_VERSION in
// src/lib/sw-config.ts so the in-app version check still triggers a reload.
const CACHE_VERSION = 'v3';
const CACHE_NAME = 'jaisus-' + CACHE_VERSION;
const MAX_CACHE_ENTRIES = 50;
const NAV_NETWORK_TIMEOUT_MS = 3000;

// Small app shell — precached on install so the first offline visit has something to show.
// Audit fix: `/` was previously precached, which let an offline PWA serve a STALE
// HTML body across builds (with old hashed-asset references that 404 on the next
// load). The navigation handler is network-first and falls back to the inline
// OFFLINE_HTML below, so we don't need to precache the root.
// Videos are not precached: media is never served by this worker (see the fetch
// handler) and the files already have a long-lived HTTP cache.
const APP_SHELL = [
  '/manifest.json',
];

// Inline offline fallback page — single self-contained HTML string, on-brand.
// It retries by itself (when the connection comes back, and every 15 s), and has
// a button, because an installed PWA has no reload control.
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>j(AI)sus — Offline</title>
<style>
  *,*::before,*::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: radial-gradient(ellipse at top, #2a1a0a 0%, #140a04 60%, #050302 100%);
    color: #f5e8d4;
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    text-align: center;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 28rem; }
  h1 {
    font-size: clamp(2.25rem, 8vw, 3.25rem);
    font-weight: 300;
    letter-spacing: 0.02em;
    margin: 0 0 1.25rem;
    color: #f8d99a;
    text-shadow: 0 0 24px rgba(248, 217, 154, 0.25);
  }
  h1 b { font-weight: 700; color: #ffb95c; }
  p {
    font-size: 1.0625rem;
    line-height: 1.6;
    margin: 0 0 0.75rem;
    opacity: 0.88;
  }
  .small { font-size: 0.875rem; opacity: 0.55; margin-top: 1.75rem; }
  button {
    margin-top: 1.25rem;
    min-height: 44px;
    padding: 0.625rem 1.5rem;
    font: inherit;
    font-size: 1rem;
    color: #140a04;
    background: #f8d99a;
    border: 0;
    border-radius: 999px;
    cursor: pointer;
  }
  button:active { transform: scale(0.97); }
  .dot {
    display: inline-block;
    width: 0.5rem; height: 0.5rem;
    background: #ffb95c; border-radius: 50%;
    margin-right: 0.5rem; vertical-align: middle;
    box-shadow: 0 0 8px rgba(255, 185, 92, 0.6);
    animation: pulse 2.4s ease-in-out infinite;
  }
  @keyframes pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }
</style>
</head>
<body>
  <main class="wrap">
    <h1>j<b>AI</b>sus</h1>
    <p>You're offline — but I'm still here in spirit.</p>
    <p>Reconnect to talk.</p>
    <button type="button" onclick="location.reload()">Try again</button>
    <p class="small"><span class="dot"></span>Waiting for a signal</p>
  </main>
  <script>
    addEventListener('online', function () { location.reload(); });
    setTimeout(function () { location.reload(); }, 15000);
  </script>
</body>
</html>`;

// --- install: precache the app shell -----------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL).catch(() => {
        // If any single shell asset 404s we don't want install to fail —
        // try them individually and ignore failures.
        return Promise.all(APP_SHELL.map((url) =>
          cache.add(url).catch(() => undefined)
        ));
      }))
      .then(() => self.skipWaiting())
  );
});

// --- activate: drop old caches and take control ------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith('jaisus-') && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

// --- helpers -----------------------------------------------------------------

// Bound the cache size. Caches API doesn't expose LRU, so we approximate:
// when over the limit, delete the oldest-inserted entries (first in .keys()).
async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  const overflow = keys.length - max;
  for (let i = 0; i < overflow; i++) {
    await cache.delete(keys[i]);
  }
}

function offlineResponse() {
  return new Response(OFFLINE_HTML, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// Network-first. The timeout only applies when there is a cached copy to fall
// back to: HTML is served no-store and never cached, so without a cached copy a
// slow (but working) network must be awaited, not replaced by the offline page.
async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  const networkPromise = fetch(request);
  networkPromise.catch(() => undefined); // avoid an unhandled rejection if we stop waiting on it
  const cached = await cache.match(request);
  try {
    let response;
    if (cached) {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('nav-timeout')), NAV_NETWORK_TIMEOUT_MS);
      });
      response = await Promise.race([networkPromise, timeoutPromise]);
    } else {
      response = await networkPromise;
    }
    // Only cache successful, basic (same-origin) responses — AND respect
    // the response's Cache-Control header. Audit fix: previously we'd cache
    // the response unconditionally, which silently undid the `no-store`
    // directive next.config.ts sets on `/` to prevent stale-HTML PWA traps.
    if (response && response.ok && response.type === 'basic') {
      const cc = (response.headers.get('Cache-Control') || '').toLowerCase();
      const uncacheable = /no-store|no-cache|private/.test(cc);
      if (!uncacheable) {
        cache.put(request, response.clone())
          .then(() => trimCache(CACHE_NAME, MAX_CACHE_ENTRIES))
          .catch(() => undefined);
      }
    }
    return response;
  } catch {
    if (cached) return cached;
    // Last resort: inline offline page. `/` is no longer precached so we
    // skip the cache.match('/') fallback that used to live here.
    return offlineResponse();
  }
}

// Cache-first with background revalidation (stale-while-revalidate).
async function cacheFirstStatic(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      // 200 only: Cache.put rejects partial (206) responses.
      if (response && response.status === 200 && response.type === 'basic') {
        cache.put(request, response.clone())
          .then(() => trimCache(CACHE_NAME, MAX_CACHE_ENTRIES))
          .catch(() => undefined);
      }
      return response;
    })
    .catch(() => undefined);

  if (cached) return cached;
  const fresh = await networkFetch;
  if (fresh) return fresh;
  // No cache, no network — let the browser show its default error.
  return Response.error();
}

// --- fetch: route requests by type -------------------------------------------
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Only handle GET
  if (request.method !== 'GET') return;

  // /api/* — pass straight through. NEVER cache AI/TTS/vision/version responses.
  if (url.pathname.startsWith('/api/')) return;

  // Media — leave to the browser. Video/audio elements send Range requests and
  // Safari needs 206 Partial Content answers; a cached full 200 breaks playback.
  if (
    request.headers.has('range') ||
    request.destination === 'video' ||
    request.destination === 'audio' ||
    /\.(mp4|webm|mov|mp3|m4a|wav|ogg)$/i.test(url.pathname)
  ) return;

  // Navigation requests (HTML documents) — network-first with offline fallback
  const isNavigation =
    request.mode === 'navigate' ||
    (request.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Everything else (static assets: JS, CSS, fonts, images) — cache-first
  event.respondWith(cacheFirstStatic(request));
});

// --- message: let the page force-activate a new SW ---------------------------
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// --- push: render a notification when the server pushes a verse --------------
// Payload (JSON): { title?: string, body?: string, url?: string }
// Falls back to a generic copy if the payload is missing or unparseable so the
// user always sees something coherent on push.
//
// SECURITY: payload comes from the push server, which is trusted because
// only our server has the VAPID private key. But we still apply belt-and-
// suspenders:
//   - Whitelist only the three fields we expect (no spread of arbitrary keys
//     like `icon`, `actions`, `image` — those could be abused if VAPID leaks).
//   - Force `url` to a same-origin pathname; cross-origin opens are dropped
//     to '/'. This is the open-redirect guard.
function sanitizePushPayload(raw) {
  const out = { title: 'jAIsus', body: 'A new verse for today.', url: '/' };
  if (raw && typeof raw === 'object') {
    if (typeof raw.title === 'string' && raw.title.length <= 80) out.title = raw.title;
    if (typeof raw.body === 'string' && raw.body.length <= 300) out.body = raw.body;
    if (typeof raw.url === 'string') {
      try {
        const parsed = new URL(raw.url, self.location.origin);
        // Same-origin only — drops `https://attacker.example.com/...`.
        if (parsed.origin === self.location.origin) out.url = parsed.pathname + parsed.search;
      } catch {
        // Malformed URL — fall back to '/'.
      }
    }
  }
  return out;
}

self.addEventListener('push', (event) => {
  let raw = null;
  if (event.data) {
    try { raw = event.data.json(); } catch { /* keep defaults */ }
  }
  const payload = sanitizePushPayload(raw);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: payload.url },
      tag: 'daily-verse', // collapses duplicates if multiple arrive same day
    })
  );
});

// --- notificationclick: focus an open window or open the app ------------------
// Tap behavior: bring an existing jAIsus tab forward if there is one;
// otherwise open a new window at the URL the server told us to (already
// sanitized to same-origin in sanitizePushPayload above).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let url = '/';
  if (event.notification.data && typeof event.notification.data.url === 'string') {
    // Defense in depth — re-validate same-origin even though the payload
    // sanitizer already did. `data` is mutable in some browser implementations.
    try {
      const parsed = new URL(event.notification.data.url, self.location.origin);
      if (parsed.origin === self.location.origin) url = parsed.pathname + parsed.search;
    } catch { /* keep '/' */ }
  }
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        if ('focus' in client) {
          await client.focus();
          // Audit fix: previously we just focused whatever tab was open and
          // dropped the notification's URL on the floor. Now navigate the
          // focused client to the requested path (same-origin already verified
          // above; client.navigate enforces same-origin again).
          try {
            const clientUrl = new URL(client.url, self.location.origin);
            if (clientUrl.pathname + clientUrl.search !== url && typeof client.navigate === 'function') {
              await client.navigate(url);
            }
          } catch { /* keep focused tab as-is on URL parse failure */ }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })()
  );
});
