/* ============================================================
   OhMyGochTripOS · Service Worker
   Estrategias: cache-first para assets, network-first para HTML,
   stale-while-revalidate para fuentes externas.
   ============================================================ */

const VERSION = 'OhMyGochTripOS-v1.0.0';
const CORE = 'core-' + VERSION;
const RUNTIME = 'runtime-' + VERSION;

const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './parser.js',       
  './manifest.webmanifest',
  './offline.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CORE)
      .then(cache => cache.addAll(CORE_ASSETS).catch(() => null))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CORE && k !== RUNTIME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // Navegación HTML → network-first con fallback a cache y offline.html
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, CORE, './offline.html'));
    return;
  }

  // Fuentes externas (Google Fonts) → stale-while-revalidate
  if (!sameOrigin) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME));
    return;
  }

  // Resto de assets propios → cache-first
  event.respondWith(cacheFirst(request, CORE));
});

/* ---------- Estrategias ---------- */

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return (await caches.match('./offline.html')) ||
           new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request, cacheName, offlinePath) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    const index = await cache.match('./index.html');
    if (index) return index;
    return (await caches.match(offlinePath)) ||
           new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const fetchPromise = fetch(request)
    .then(res => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return hit || (await fetchPromise) || new Response('', { status: 504 });
}

/* ---------- Mensajes del cliente (skip waiting, etc.) ---------- */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
