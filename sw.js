/**
 * PokéVault service worker — two jobs, kept strictly separate:
 *  1. Lock-screen push alerts (unchanged, below).
 *  2. An app-SHELL offline cache so a cold, no-signal launch in a card shop is
 *     the app, not a white screen.
 *
 * The freshness rule the old push-only worker protected still holds: ONLY
 * same-origin app assets (HTML shell + content-hashed JS/CSS/fonts/images) are
 * cached. Every DATA request — Supabase and the image CDNs are all cross-origin
 * — bypasses this worker untouched, so prices and collection can never be served
 * stale from here. The data-side offline story stays the vault's own
 * localStorage snapshot (localdb.web.ts), which the UI badges OFFLINE.
 */

// Bump this to force a one-time purge of the old shell after a change to the
// caching behaviour itself. Day-to-day deploys need no bump: hashed asset names
// change when their contents do, and navigations are network-first.
const SHELL_CACHE = 'pokevault-shell-v1';

self.addEventListener('install', (event) => {
  // Prime the offline fallback with the root shell, then take over at once.
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add('/'))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  // Drop any cache from a previous SHELL_CACHE version, then claim clients.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

// Only the content-hashed bundle paths are safe to serve cache-first: the name
// changes whenever the bytes do. Bare-root files (favicon, icons, sw.js itself)
// keep the SAME name across regenerations — caching them first would freeze them.
const IMMUTABLE_ASSET = /^\/(_expo\/static|assets)\//;

// Bare-root same-origin files: network-first so a regenerated icon shows up
// without a cache-version bump; the cache only answers offline.
const ROOT_FILE = /\.(ico|png|jpe?g|gif|svg|webp|mp4|json)$/i;

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Cross-origin (Supabase API, TCGplayer image CDN) is NEVER cached here — data
  // must stay network-only so freshness never lies. Leave it to the browser.
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first, so a fresh deploy's HTML always wins while
  // online; the cached shell answers only when the network is truly gone.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Keep the offline shell current from each successful root load.
          if (response.ok && url.pathname === '/') {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(() => caches.match('/').then((cached) => cached || Response.error())),
    );
    return;
  }

  // Immutable hashed bundle assets: cache-first for a fast, offline launch.
  if (IMMUTABLE_ASSET.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Bare-root files: network-first, cached copy only when the network is gone.
  if (ROOT_FILE.test(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || Response.error())),
    );
    return;
  }
  // Any other same-origin GET falls through to the browser's default handling.
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'PokéVault', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'PokéVault alert';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      // iOS ignores these and shows the app icon; Android/desktop use them.
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
