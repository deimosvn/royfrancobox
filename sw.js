/* ============================================================
   ROY FRANCO BOX — Service Worker (v2 - cache cleared)
   Network-first to avoid stale cache issues in development
   ============================================================ */

const CACHE_NAME = 'roybox-v2';

// Install — clear ALL old caches
self.addEventListener('install', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.map(k => caches.delete(k)))
        )
    );
    self.skipWaiting();
});

// Activate — claim clients immediately
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch — network-first (avoid stale cache)
self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    // Skip Firebase/CDN
    if (url.hostname.includes('googleapis.com')) return;
    if (url.hostname.includes('gstatic.com')) return;
    if (url.hostname.includes('cdnjs.cloudflare.com')) return;

    event.respondWith(
        fetch(request)
            .then(response => response)
            .catch(() => caches.match(request))
    );
});
