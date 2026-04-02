const CACHE_NAME = 'cobalt-v3';
const BASE = '/Cobalt';

const PRECACHE_URLS = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/css/base.css',
  BASE + '/css/layout.css',
  BASE + '/css/editor.css',
  BASE + '/css/ui.css',
  BASE + '/js/app.js',
  BASE + '/js/blocks.js',
  BASE + '/js/db.js',
  BASE + '/js/editor.js',
  BASE + '/js/parser.js',
  BASE + '/js/render.js',
  BASE + '/js/store.js',
  BASE + '/js/ui.js',
  BASE + '/js/utils.js',
  BASE + '/assets/icon-192.png',
  BASE + '/assets/icon-512.png',
];

const CDN_CACHE_NAME = 'cobalt-cdn-v1';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME && key !== CDN_CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  // CDN assets: cache-first with network fallback
  if (url.hostname !== location.hostname) {
    event.respondWith(
      caches.open(CDN_CACHE_NAME).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok) cache.put(request, response.clone());
          return response;
        } catch {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // Navigation requests: network-first
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(BASE + '/index.html'))
    );
    return;
  }

  // Same-origin static assets: stale-while-revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(request);
      const fetchPromise = fetch(request).then(response => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
