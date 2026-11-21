'use strict';
/* Ozbak service worker v3: network-first for the app shell + bundled data
   so updates propagate on the next visit, with cache fallback for offline
   use. (Live data itself comes from Supabase at runtime, not from this
   cache.) Bump CACHE whenever the shell changes materially. */
const CACHE = 'ozbak-v3';
const SHELL = ['./', './index.html', './style.css', './app.js', './data.json', './ozbak-logo.png', './manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin) return; // remote assets (e.g. Supabase photos): browser handles them
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html')))
  );
});
