// The website's service worker (ticket 11): Web Push only. It shows each push as a
// notification and opens the app at the notification's link when tapped. No offline
// caching: every request still goes to the network as before.
//
// Served from the site root (/sw.js, copied from public/ by `expo export`), so its scope is
// the whole app. The payload comes from the notify Edge Function:
// { title, body, url, icon, tag } (see src/notify/run.ts, webPayload).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/** Only paths inside this site are opened ("/assignment/..."), never another origin. */
function appPath(url) {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : '/';
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'New notification', {
      body: data.body || '',
      icon: data.icon || '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag,
      data: { url: appPath(data.url) },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = appPath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        // The app navigates itself (src/lib/notificationTaps.web.ts), keeping its state. A
        // refused focus() must not stop that.
        try {
          await open.focus();
        } catch {}
        open.postMessage({ type: 'open-url', url: path });
        return;
      }
      await self.clients.openWindow(path);
    })(),
  );
});
