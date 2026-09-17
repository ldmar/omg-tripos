/* ============================================================
   OhMyGoch Trip OS · notifications.js
   Motor de recordatorios · tiempo + ubicación
   100% client-side
   ============================================================ */

const SETTINGS_KEY = 'ohmygoch_notif_settings';
const FIRED_KEY = 'ohmygoch_fired_notifs';
const CHECK_INTERVAL = 60 * 1000;

const DEFAULT_SETTINGS = {
  enabled: false,
  leadMin: 30,
  geofencing: false,
  geofenceRadius: 300,
};

let settings = { ...DEFAULT_SETTINGS };
let checkTimer = null;
let watchId = null;
let lastCheck = Date.now();
let currentEvents = [];
let onNavigate = null;    // callback para abrir un evento desde la notif

/* ============================================================
   Settings
   ============================================================ */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
  return settings;
}

export function saveSettings(patch) {
  settings = { ...settings, ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  return settings;
}

export function getSettings() {
  return { ...settings };
}

/* ============================================================
   Permisos
   ============================================================ */
export function hasNotificationPermission() {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

export function hasGeolocationPermission() {
  return navigator.permissions
    ? navigator.permissions.query({ name: 'geolocation' })
        .then(p => p.state === 'granted')
        .catch(() => false)
    : Promise.resolve(true);
}

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

/* ============================================================
   Inicialización
   ============================================================ */
export function setNavigateHandler(fn) {
  onNavigate = fn;
}

export function start(events) {
  currentEvents = events;
  lastCheck = Date.now();

  if (checkTimer) clearInterval(checkTimer);
  if (settings.enabled) {
    checkTimer = setInterval(tick, CHECK_INTERVAL);
    // Primer check a los 5s (por si hay algo inminente)
    setTimeout(tick, 5000);
  }

  if (settings.geofencing) startGeofencing();
  else stopGeofencing();
}

export function stop() {
  if (checkTimer) { clearInterval(checkTimer); checkTimer = null; }
  stopGeofencing();
}

export function refreshEvents(events) {
  currentEvents = events;
}

/* ============================================================
   Motor de tiempo
   ============================================================ */
function tick() {
  if (!settings.enabled) return;
  if (!hasNotificationPermission()) return;

  const now = Date.now();
  const fired = loadFired();

  for (const ev of currentEvents) {
    if (ev.done) continue;
    if (ev.noReminder) continue;
    if (!ev.startAt) continue;

    const start = new Date(ev.startAt).getTime();
    const leadMin = ev.reminderMin ?? settings.leadMin;
    const reminderAt = start - leadMin * 60 * 1000;

    // Se cruzó el umbral entre el último check y ahora
    if (reminderAt > lastCheck && reminderAt <= now) {
      const key = `${ev.id}@${reminderAt}`;
      if (!fired[key]) {
        fireTimeNotification(ev, leadMin);
        fired[key] = now;
      }
    }
  }

  // Cleanup: fired > 7 días
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  for (const k of Object.keys(fired)) {
    if (fired[k] < cutoff) delete fired[k];
  }
  saveFired(fired);
  lastCheck = now;
}

function loadFired() {
  try { return JSON.parse(localStorage.getItem(FIRED_KEY) || '{}'); }
  catch { return {}; }
}
function saveFired(obj) {
  try { localStorage.setItem(FIRED_KEY, JSON.stringify(obj)); } catch {}
}

/* ============================================================
   Motor de ubicación
   ============================================================ */
export function startGeofencing() {
  if (!('geolocation' in navigator)) return;
  if (watchId != null) return;

  watchId = navigator.geolocation.watchPosition(
    onPosition,
    (err) => console.warn('[geo] error:', err.message),
    { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 }
  );
}

export function stopGeofencing() {
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

function onPosition(pos) {
  if (!settings.geofencing) return;
  if (!hasNotificationPermission()) return;

  const { latitude, longitude } = pos.coords;
  const today = new Date().toDateString();
  const fired = loadFired();

  for (const ev of currentEvents) {
    if (ev.done) continue;
    if (ev.noReminder) continue;
    if (!ev.location?.lat || !ev.location?.lng) continue;

    const dist = haversine(
      latitude, longitude,
      ev.location.lat, ev.location.lng
    );
    const radius = ev.geofenceRadius ?? settings.geofenceRadius;

    if (dist < radius) {
      const key = `geo:${ev.id}:${today}`;
      if (!fired[key]) {
        fireGeoNotification(ev, Math.round(dist));
        fired[key] = Date.now();
        saveFired(fired);
      }
    }
  }
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* ============================================================
   Envío de notificaciones
   ============================================================ */
async function fireTimeNotification(ev, leadMin) {
  const leadLabel = leadMin >= 60
    ? `${Math.round(leadMin / 60)} h`
    : `${leadMin} min`;
  const title = `⏰ En ${leadLabel}: ${ev.title}`;
  const body = [ev.place, ev.notes].filter(Boolean).join(' · ') || 'OhMyGoch Trip OS';
  await showNotification(title, body, ev.id);
}

async function fireGeoNotification(ev, distanceM) {
  const distLabel = distanceM < 1000
    ? `a ${distanceM} m`
    : `a ${(distanceM / 1000).toFixed(1)} km`;
  const title = `📍 Estás cerca: ${ev.title}`;
  const body = `${ev.place || 'Sin dirección'} · ${distLabel}`;
  await showNotification(title, body, ev.id);
}

async function showNotification(title, body, eventId) {
  const opts = {
    body,
    icon: 'icons/icon-192.png',
    badge: 'icons/favicon-32.png',
    tag: `ev-${eventId}`,
    data: { eventId },
    requireInteraction: false,
    silent: false,
  };

  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg && reg.showNotification) {
      reg.showNotification(title, opts);
    } else {
      new Notification(title, opts);
    }
  } catch (err) {
    console.warn('[notif] error:', err);
    try { new Notification(title, opts); } catch {}
  }
}

/* ============================================================
   Test
   ============================================================ */
export async function sendTestNotification() {
  const ok = await requestNotificationPermission();
  if (!ok) return false;
  await showNotification(
    '🔔 OhMyGoch · Test',
    'Si ves esto, los recordatorios funcionan.',
    'test'
  );
  return true;
}

/* ============================================================
   Status
   ============================================================ */
export function getStatus() {
  return {
    notifPermission: typeof Notification !== 'undefined'
      ? Notification.permission
      : 'unsupported',
    geolocation: 'geolocation' in navigator,
    geofencingActive: watchId != null,
    settings: { ...settings },
  };
}