/**
 * PokéVault service worker — exists for one job: lock-screen push alerts.
 * No offline caching here (the app's own offline story lives in its data
 * layer); a fetch handler that lies about freshness would be worse than none.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
