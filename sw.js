'use strict';
/* Ozbak service worker v6: network-first for the app shell + bundled data
   so updates propagate on the next visit, with cache fallback for offline
   use. (Live data itself comes from Supabase at runtime, not from this
   cache.) Photos hosted on Supabase Storage are cached on first view
   (separate photo cache, kept across shell versions) so galleries remain
   fully visible offline. Bump CACHE whenever the shell changes materially. */
const CACHE = 'ozbak-v24';
const PHOTOS = 'ozbak-photos';
const SHELL = ['./', './index.html', './style.css', './app.js', './data.json', './ozbak-logo.png', './manifest.json', './qr-site.svg'];
const PHOTO_HOST = 'dapfearinbupdsuglrcs.supabase.co';
const PHOTO_PATH = '/storage/v1/object/public/';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== PHOTOS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin) {
    // Photos (Supabase Storage, public): cache-first — once a photo has been
    // seen online, it stays available offline. New uploads get new file
    // names, so a cached photo never goes stale.
    if (url.hostname === PHOTO_HOST && url.pathname.startsWith(PHOTO_PATH)) {
      e.respondWith(
        caches.open(PHOTOS).then((cache) => cache.match(e.request).then((hit) => {
          if (hit) return hit;
          return fetch(e.request).then((res) => {
            if (res && res.ok) { const copy = res.clone(); cache.put(e.request, copy).catch(() => {}); }
            return res;
          }).catch(() => new Response('', { status: 504 }));
        }))
      );
    }
    return; // other remote requests: browser handles them
  }
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html')))
  );
});
