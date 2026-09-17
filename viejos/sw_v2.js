/* ============================================================
   OhMyGoch Trip OS · Service Worker   OMGTripOS
   ============================================================ */

const VERSION = 'OMGTripOS-v1.4.0';
const CORE = 'core-' + VERSION;
const RUNTIME = 'runtime-' + VERSION;

const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './parser.js',            // ← NUEVO · crítico para import offline
  './pdf-import.js', 
  './ocr-import.js', 
  './sync.js',  
  './notifications.js', 
  './manifest.json',        
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

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, CORE, './offline.html'));
    return;
  }

  if (!sameOrigin) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME));
    return;
  }

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

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ---------- Notification click ---------- */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const eventId = event.notification.data?.eventId;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        // Buscar una ventana abierta
        for (const client of clients) {
          if (client.url.includes(self.location.origin)) {
            client.focus();
            client.postMessage({
              type: 'notification-click',
              eventId,
              action: event.action || 'default',
            });
            return;
          }
        }
        // Abrir nueva ventana
        return self.clients.openWindow('./');
      })
  );
});
