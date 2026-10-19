/* Frame Designer service worker: lets the installed app open offline.
   Network first, so a deployed update shows up on the next load; the cache is the fallback. */
const CACHE = 'frame-designer-v4';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'js/core.js', 'js/geom.js', 'js/render.js', 'js/app.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'fonts/fonts.css',
  'fonts/barlow-400-latin-ext.woff2', 'fonts/barlow-400-latin.woff2',
  'fonts/barlow-500-latin-ext.woff2', 'fonts/barlow-500-latin.woff2',
  'fonts/barlow-600-latin-ext.woff2', 'fonts/barlow-600-latin.woff2',
  'fonts/barlow-semi-condensed-500-latin-ext.woff2', 'fonts/barlow-semi-condensed-500-latin.woff2',
  'fonts/barlow-semi-condensed-600-latin-ext.woff2', 'fonts/barlow-semi-condensed-600-latin.woff2',
  'fonts/barlow-semi-condensed-700-latin-ext.woff2', 'fonts/barlow-semi-condensed-700-latin.woff2',
  'fonts/ibm-plex-mono-400-latin-ext.woff2', 'fonts/ibm-plex-mono-400-latin.woff2',
  'fonts/ibm-plex-mono-500-latin-ext.woff2', 'fonts/ibm-plex-mono-500-latin.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    // Revalidate with the server so an update shows up at once rather than after the HTTP cache expires.
    fetch(req.url, { cache: 'no-cache', credentials: 'same-origin', redirect: req.mode === 'navigate' ? 'manual' : 'follow' }).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
