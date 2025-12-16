const CACHE_NAME = 'stt-reader-v2';

// Files that are guaranteed to be available locally. Keep this list lean to avoid install failures.
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './app.js',
];

// A separate cache for runtime-fetched resources (e.g. third‑party CDNs).
const RUNTIME_CACHE = 'stt-runtime-v2';

// Optional CDN assets to warm up on install. If any fail, the install still succeeds.
const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/feather-icons',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.Default.css',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/leaflet.markercluster.js',
  'https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js',
  'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
  'https://unpkg.com/tesseract.js@5.0.4/dist/tesseract.min.js',
  'https://unpkg.com/hammerjs@2.0.8/hammer.min.js',
  'https://unpkg.com/localforage@1.10.0/dist/localforage.min.js',
];

// Install event: pre-cache critical assets and warm up CDN cache (best effort).
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // Pre-cache local files
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE);

    // Warm up runtime cache without failing install
    const runtime = await caches.open(RUNTIME_CACHE);
    await Promise.allSettled(CDN_ASSETS.map(async (url) => {
      try {
        const res = await fetch(url, { mode: 'no-cors' });
        // Even opaque responses can be cached
        await runtime.put(url, res);
      } catch (_) {}
    }));
    self.skipWaiting();
  })());
});

// Activate event: remove old caches and take over immediately.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => ![CACHE_NAME, RUNTIME_CACHE].includes(k))
        .map((k) => caches.delete(k)),
    );
    self.clients.claim();
  })());
});

// Respond to skip waiting messages from clients
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch handler: cache-first, fallback to network, and fall back to cached index on navigation.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const req = event.request;
  event.respondWith((async () => {
    // Attempt to serve from cache first
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      // Cache only successful or opaque responses
      const cacheable = res && (res.status === 200 || res.type === 'opaque');
      if (cacheable) {
        const targetCacheName = req.url.startsWith(self.location.origin) ? CACHE_NAME : RUNTIME_CACHE;
        const cache = await caches.open(targetCacheName);
        cache.put(req, res.clone());
      }
      return res;
    } catch (e) {
      // Offline fallback for navigation
      if (req.mode === 'navigate' || req.destination === 'document') {
        const fallback = await caches.match('./index.html');
        return fallback || Response.error();
      }
      return Response.error();
    }
  })());
});