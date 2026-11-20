// Service worker : appli disponible hors-ligne (réseau d'abord pour recevoir les mises à jour, sinon le cache).
const APP_CACHE = 'cl-app-v0.5.3';
const APP_FILES = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(APP_FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('cl-app-') && k !== APP_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  const net = Promise.race([fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }), new Promise((_, rej) => setTimeout(() => rej(new Error('lent')), 3500))]);
  e.respondWith(net.then(r => { const copy = r.clone(); caches.open(APP_CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
