/* ============================================================
   OhMyGoch Trip OS · alerts.js
   Extiende notifications.js con 3 alertas adicionales:
     1. Vencimiento de documentos (7 d / 3 d / 1 d antes)
     2. Check-in online disponible (24 h antes del vuelo)
     3. Digest matutino (08:00 local, una vez por día)
   Scheduler propio cada 30 min + check al boot.
   ============================================================ */

import * as wallet from './wallet.js';

const FIRED_KEY      = 'ohmygoch_alerts_fired';
const CHECK_INTERVAL = 30 * 60 * 1000;   // 30 min
const DIGEST_HOUR    = 8;                 // 08:00 local
const PRUNE_DAYS     = 30;

let checkTimer    = null;
let currentTripId = null;
let currentEvents = [];

/* ============================================================
   API
   ============================================================ */
export function startAlerts(tripId, events) {
  currentTripId = tripId;
  currentEvents = events || [];
  stopAlerts();
  checkTimer = setInterval(tick, CHECK_INTERVAL);
  setTimeout(tick, 3000);                 // primer check a los 3 s
}

export function stopAlerts() {
  if (checkTimer) { clearInterval(checkTimer); checkTimer = null; }
}

export function refreshAlerts(events) {
  currentEvents = events || [];
}

/* ============================================================
   Tick principal
   ============================================================ */
async function tick() {
  if (!currentTripId) return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const fired = loadFired();
  const now = Date.now();

  try {
    await checkDocExpiry(fired, now);
    checkFlightCheckIn(fired, now);
    checkFreeTourReminders(fired, now);
    checkDailyDigest(fired, now);
  } catch (err) {
    console.warn('[alerts] tick error:', err);
  }

  pruneFired(fired, now);
  saveFired(fired);
}

/* ============================================================
   1 · Documentos por vencer
   ============================================================ */
async function checkDocExpiry(fired, now) {
  let docs;
  try { docs = await wallet.getAllFiles(currentTripId); }
  catch { return; }

  for (const doc of docs) {
    if (!doc.expiresAt) continue;

    const exp = new Date(doc.expiresAt).getTime();
    if (Number.isNaN(exp)) continue;

    const daysLeft = Math.ceil((exp - now) / (24 * 60 * 60 * 1000));
    if (daysLeft <= 0) continue;          // ya vencido: no notificamos

    // Buscamos el primer umbral que cruzamos
    for (const threshold of [7, 3, 1]) {
      if (daysLeft <= threshold) {
        const key = `doc:${doc.id}:${threshold}`;
        if (!fired[key]) {
          await notify(
            '🪪 Documento por vencer',
            `${doc.name} vence en ${daysLeft} día${daysLeft > 1 ? 's' : ''}`
          );
          fired[key] = now;
        }
        break;                            // un umbral por tick
      }
    }
  }
}

/* ============================================================
   2 · Check-in online (24 h antes del vuelo)
   ============================================================ */
function checkFlightCheckIn(fired, now) {
  for (const ev of currentEvents) {
    if (ev.type !== 'flight' || ev.done || !ev.startAt) continue;

    const start = new Date(ev.startAt).getTime();
    if (Number.isNaN(start)) continue;

    const hoursTo = (start - now) / (60 * 60 * 1000);

    // Ventana [22 h, 24 h) → ya se puede hacer check-in
    if (hoursTo > 22 && hoursTo <= 24) {
      const key = `checkin:${ev.id}`;
      if (!fired[key]) {
        notify(
          '✈️ Check-in online disponible',
          `${ev.title} · en 24 h. Entrá a la app de la aerolínea.`
        ).catch(() => {});
        fired[key] = now;
      }
    }
  }
}

/* ============================================================
   2b · Free tours: 30 min antes (al punto) y 10 min antes (navegar)
   ============================================================ */
function checkFreeTourReminders(fired, now) {
  for (const ev of currentEvents) {
    if (ev.type !== 'freetour' && !ev.tourMeta) continue;
    if (ev.done || !ev.startAt) continue;

    const start = new Date(ev.startAt).getTime();
    if (Number.isNaN(start)) continue;

    const minsTo = (start - now) / 60000;

    // Aviso previo: 30 min antes
    if (minsTo > 28 && minsTo <= 30) {
      const key = `tour30:${ev.id}`;
      if (!fired[key]) {
        const hint = ev.tourMeta?.howToFindMe || ev.place || 'Revisá el punto de encuentro';
        notify(
          `🚶 Free tour en 30 min: ${ev.title.slice(0, 40)}`,
          hint
        ).catch(() => {});
        fired[key] = now;
      }
    }

    // Última llamada: 10 min antes
    if (minsTo > 9 && minsTo <= 10) {
      const key = `tour10:${ev.id}`;
      if (!fired[key]) {
        const hint = ev.tourMeta?.howToFindMe || '¡Andá al punto de encuentro!';
        notify(
          `⏰ ¡En 10 min! ${ev.title.slice(0, 40)}`,
          hint
        ).catch(() => {});
        fired[key] = now;
      }
    }
  }
}


/* ============================================================
   3 · Digest matutino
   ============================================================ */
function checkDailyDigest(fired, now) {
  const d = new Date(now);
  if (d.getHours() < DIGEST_HOUR) return;

  const dayKey = `digest:${d.toDateString()}`;
  if (fired[dayKey]) return;

  const today = currentEvents.filter(ev => {
    if (ev.done || !ev.startAt) return false;
    const t = new Date(ev.startAt);
    return t.toDateString() === d.toDateString();
  });

  if (!today.length) return;

  const preview = today.slice(0, 3).map(ev => {
    const t = new Date(ev.startAt).toLocaleTimeString('es-AR', {
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    return `${t} ${ev.title}`;
  }).join(' · ');

  const extra = today.length > 3 ? ` (+${today.length - 3} más)` : '';

  notify(
    `☀️ Hoy tenés ${today.length} evento${today.length > 1 ? 's' : ''}`,
    preview + extra
  ).catch(() => {});

  fired[dayKey] = now;
}

/* ============================================================
   Envío (reusa SW si está, si no Notification directo)
   ============================================================ */
async function notify(title, body) {
  const opts = {
    body,
    icon:  'icons/icon-192.png',
    badge: 'icons/favicon-32.png',
    tag:   'omg-alert',
    silent: false,
  };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.showNotification) reg.showNotification(title, opts);
    else new Notification(title, opts);
  } catch (err) {
    console.warn('[alerts] notify falló:', err);
  }
}

/* ============================================================
   Persistencia de "ya disparados"
   ============================================================ */
function loadFired() {
  try { return JSON.parse(localStorage.getItem(FIRED_KEY) || '{}'); }
  catch { return {}; }
}
function saveFired(obj) {
  try { localStorage.setItem(FIRED_KEY, JSON.stringify(obj)); } catch {}
}
function pruneFired(fired, now) {
  const cutoff = now - PRUNE_DAYS * 24 * 60 * 60 * 1000;
  for (const k of Object.keys(fired)) {
    if (fired[k] < cutoff) delete fired[k];
  }
}

/* ============================================================
   Test helper (opcional, para debug)
   ============================================================ */
export async function sendTestDigest() {
  const today = currentEvents.filter(ev => {
    if (ev.done || !ev.startAt) return false;
    const t = new Date(ev.startAt);
    return t.toDateString() === new Date().toDateString();
  });
  await notify(
    `🧪 Test digest · ${today.length} evento${today.length === 1 ? '' : 's'}`,
    today.slice(0, 3).map(ev => ev.title).join(' · ') || '(sin eventos hoy)'
  );
}
