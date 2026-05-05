/* ============================================================
   ROY FRANCO BOX — Service Worker
   Cache-first strategy for static assets, network-first for Firebase
   ============================================================ */

const CACHE_NAME = 'roybox-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/dashboard.html',
    '/manifest.json',
    '/css/dashboard.css',
    '/css/modern.css',
    '/js/firebase.js',
    '/js/dashboard.js',
    '/icons/apple-touch-icon.png',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png',
];

// Install — pre-cache static shell
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

// Activate — remove old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch — cache-first for static, network-first for API/Firebase
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET and cross-origin Firebase/CDN requests
    if (request.method !== 'GET') return;
    if (url.hostname.includes('firestore.googleapis.com')) return;
    if (url.hostname.includes('identitytoolkit.googleapis.com')) return;
    if (url.hostname.includes('securetoken.googleapis.com')) return;
    if (url.hostname.includes('fonts.googleapis.com')) return;
    if (url.hostname.includes('fonts.gstatic.com')) return;
    if (url.hostname.includes('cdnjs.cloudflare.com')) return;
    if (url.hostname.includes('gstatic.com')) return;

    event.respondWith(
        caches.match(request).then(cached => {
            if (cached) return cached;
            return fetch(request).then(response => {
                // Only cache successful same-origin responses
                if (!response || response.status !== 200 || response.type !== 'basic') {
                    return response;
                }
                const toCache = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(request, toCache));
                return response;
            }).catch(() => {
                // Offline fallback: return cached index if navigating
                if (request.mode === 'navigate') {
                    return caches.match('/index.html');
                }
            });
        })
    );
});
