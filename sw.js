/* ============================================================
   OhMyGoch Trip OS · Service Worker
   v3.0.4 · network-first crítico + cache-first assets + SWR remoto
   ============================================================ */

const VERSION = 'OMGTripOS-v3.0.5';
const CORE    = 'core-' + VERSION;
const RUNTIME = 'runtime-' + VERSION;

// Assets críticos → SIEMPRE frescos (network-first)
const FRESH_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',

  // Módulos core
  './trips.js',
  './parser.js',
  './sync.js',
  './crypto.js',
  './vault.js',
  './crdt.js',
  './settings.js',
  './travelers.js',
  './freetour.js', 

  // Módulos UI
  './ui/bus.js',
  './ui/today.js',
  './ui/wallet.js',
  './ui/event-modal.js',
  './ui/chat.js',
  './ui/map.js',
  './ui/management.js',
  './ui/freetour.js', 
];

// Assets de relleno → cache-first (lazy, no críticos al arranque)
const CORE_ASSETS = [
  './pdf-import.js',
  './ocr-import.js',
  './notifications.js',
  './alerts.js',
  './daymode.js',
  './wallet.js',
  './chat.js',
  './offline.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CORE)
      .then(cache => cache.addAll([...FRESH_ASSETS, ...CORE_ASSETS]).catch(err => {
        console.warn('[sw] addAll parcial:', err);
      }))
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

  const path = url.pathname.split('/').pop();
  if (FRESH_ASSETS.some(a => a.endsWith(path)) || path === '') {
    event.respondWith(networkFirst(request, CORE, null));
    return;
  }

  event.respondWith(cacheFirst(request, CORE));
});

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
    if (offlinePath) {
      const offline = await caches.match(offlinePath);
      if (offline) return offline;
    }
    const index = await cache.match('./index.html');
    if (index) return index;
    return new Response('Offline', { status: 503 });
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

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const eventId = event.notification.data?.eventId;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
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
        return self.clients.openWindow('./');
      })
  );
});
