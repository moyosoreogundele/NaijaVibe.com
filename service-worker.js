/* Network-first for app code so connected users receive each deployment promptly. */
const VERSION = 'nv-v21';
const CORE = ['index.html', 'css/variables.css', 'css/global.css', 'css/layout.css', 'css/components.css', 'js/app.js', 'js/utils.js', 'assets/logos/logo.svg'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    console.error('Could not parse a NaijaVibe push notification:', error);
  }
  const title = typeof payload.title === 'string' ? payload.title : 'NaijaVibe';
  const body = typeof payload.body === 'string' ? payload.body : 'You have a new notification.';
  const target = typeof payload.url === 'string' ? payload.url : '/notifications.html';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/assets/logos/logo.svg',
    badge: '/assets/logos/logo.svg',
    data: { url: target }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data && event.notification.data.url || '/notifications.html', self.location.origin);
    if (target.origin !== self.location.origin) target.href = new URL('/notifications.html', self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(target.href);
        return client.focus();
      }
    }
    return self.clients.openWindow(target.href);
  })());
});
self.addEventListener('fetch', (e) => {
  const r = e.request; if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  const url = new URL(r.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) return;
  const networkFirst = r.mode === 'navigate' || /\.(?:html|css|js|json|webmanifest)$/i.test(url.pathname);
  if (networkFirst) {
    e.respondWith(fetch(r).then(res => {
      if (res.ok) caches.open(VERSION).then(cache => cache.put(r, res.clone()));
      return res;
    }).catch(async () => (await caches.match(r)) || (r.mode === 'navigate' ? caches.match('index.html') : Response.error())));
    return;
  }
  e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => {
    if (res.ok) caches.open(VERSION).then(cache => cache.put(r, res.clone()));
    return res;
  })));
});
