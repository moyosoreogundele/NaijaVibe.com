/* Network-first for app code so connected users receive each deployment promptly. */
const VERSION = 'nv-v20';
const CORE = ['index.html', 'css/variables.css', 'css/global.css', 'css/layout.css', 'css/components.css', 'js/app.js', 'js/utils.js', 'assets/logos/logo.svg'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
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
