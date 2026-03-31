const CACHE_NAME = 'cobalt-v1';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/css/base.css',
  '/css/layout.css',
  '/css/editor.css',
  '/css/ui.css',
  '/js/app.js',
  '/js/blocks.js',
  '/js/db.js',
  '/js/editor.js',
  '/js/render.js',
  '/js/store.js',
  '/js/ui.js',
  '/js/utils.js',
  '/assets/icon-192.svg',
  '/assets/icon-512.svg',
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
      fetch(request).catch(() => caches.match('/index.html'))
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
