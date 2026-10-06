'use strict';
const CACHE = 'bilis-shell-v6';
const ASSETS = [
  './', './index.html', './css/style.css', './js/theme.js', './js/app.js',
  './js/client-info.js', './js/speedtest.js', './favicon.svg',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './speedtest_worker.js', './vendor/librespeed/speedtest.js',
  './vendor/librespeed/speedtest_worker.js',
];
const shellURLs = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('bilis-shell-') && key !== CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  // Never intercept measurements, settings, IP lookups, or other hosts.
  if (event.request.method !== 'GET' || !shellURLs.has(event.request.url)) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        // A full cache must not prevent a successful network response loading.
        try {
          const cache = await caches.open(CACHE);
          await cache.put(event.request, response.clone());
        } catch {}
      }
      return response;
    } catch (error) {
      const cached = await caches.match(event.request, { cacheName: CACHE });
      if (cached) return cached;
      throw error;
    }
  })());
});
