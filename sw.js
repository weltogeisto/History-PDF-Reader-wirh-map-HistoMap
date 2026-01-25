const CACHE_NAME = 'stt-reader-v3';

// Files that are guaranteed to be available locally. Keep this list lean to avoid install failures.
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './app.js',
];

// A separate cache for runtime-fetched resources (e.g. third‑party CDNs).
const RUNTIME_CACHE = 'stt-runtime-v3';

// Optional CDN assets to warm up on install. If any fail, the install still succeeds.
const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/feather-icons',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.Default.css',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/leaflet.markercluster.js',
  'https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js',
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
    // Force immediate activation
    self.skipWaiting();
  })());
});

// Activate event: remove old caches and take over immediately.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Delete ALL old caches to ensure fresh content
    await Promise.all(
      keys
        .filter((k) => ![CACHE_NAME, RUNTIME_CACHE].includes(k))
        .map((k) => caches.delete(k)),
    );
    // Take control of all clients immediately
    self.clients.claim();
  })());
});

// Respond to skip waiting messages from clients
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch handler: NETWORK-FIRST for local files (always get latest), cache-first for CDN assets
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const req = event.request;
  const isLocalFile = req.url.startsWith(self.location.origin);

  event.respondWith((async () => {
    // NETWORK-FIRST for local files to ensure users always get latest version
    if (isLocalFile) {
      try {
        const res = await fetch(req);
        if (res && res.status === 200) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, res.clone());
        }
        return res;
      } catch (e) {
        // Offline fallback to cache
        const cached = await caches.match(req);
        if (cached) return cached;
        // Navigation fallback
        if (req.mode === 'navigate' || req.destination === 'document') {
          const fallback = await caches.match('./index.html');
          return fallback || Response.error();
        }
        return Response.error();
      }
    }

    // CACHE-FIRST for CDN assets (they don't change)
    const cached = await caches.match(req);
    if (cached) return cached;

    try {
      const res = await fetch(req);
      const cacheable = res && (res.status === 200 || res.type === 'opaque');
      if (cacheable) {
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch (e) {
      return Response.error();
    }
  })());
});
