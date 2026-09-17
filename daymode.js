/* ============================================================
   OhMyGoch Trip OS · daymode.js
   Modo Día Activo · pantalla enfocada + wake lock
   ============================================================ */

let wakeLock = null;
let clockTimer = null;
let isActive = false;
let currentEventId = null;
let getEventsFn = null;
let onEventDoneFn = null;

const $ = (id) => document.getElementById(id);

export function isDayModeActive() { return isActive; }
export function setEventProvider(fn) { getEventsFn = fn; }
export function setOnEventDone(fn) { onEventDoneFn = fn; }

/* ---------- Enter / Exit ---------- */
export async function enterDayMode() {
  if (isActive) return;
  isActive = true;
  currentEventId = null;

  const el = $('daymode');
  if (el) el.hidden = false;
  document.body.classList.add('daymode-on');

  await requestWakeLock();
  updateClock();
  clockTimer = setInterval(updateClock, 1000);

  document.addEventListener('visibilitychange', handleVisibilityChange);

  render();
  console.log('[daymode] activado · wake lock:', !!wakeLock);
}

export function exitDayMode() {
  if (!isActive) return;
  isActive = false;

  const el = $('daymode');
  if (el) el.hidden = true;
  document.body.classList.remove('daymode-on');

  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  releaseWakeLock();
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  currentEventId = null;
  console.log('[daymode] desactivado');
}

export function refresh() {
  if (isActive) render();
}

/* ---------- Wake Lock ---------- */
async function requestWakeLock() {
  try {
    if (!('wakeLock' in navigator)) return;
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (err) {
    console.warn('[daymode] wake lock falló:', err.message);
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

async function handleVisibilityChange() {
  if (document.visibilityState === 'visible' && isActive) {
    await requestWakeLock();
  }
}

/* ---------- Reloj ---------- */
function updateClock() {
  const now = new Date();
  const time = now.toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const date = now.toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long'
  });
  const clockEl = $('daymodeClock');
  const dateEl = $('daymodeDate');
  if (clockEl) clockEl.textContent = time;
  if (dateEl) dateEl.textContent = date.charAt(0).toUpperCase() + date.slice(1);
  updateCountdown();
}

/* ---------- Evento actual ---------- */
function getCurrentEvent() {
  if (!getEventsFn) return null;
  const events = getEventsFn();
  const now = Date.now();

  if (currentEventId) {
    const sel = events.find(e => e.id === currentEventId);
    if (sel && !sel.done) return sel;
  }

  return events
    .filter(e => !e.done && new Date(e.startAt).getTime() > now - 30 * 60 * 1000)
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))[0] || null;
}

/* ---------- Render principal ---------- */
function render() {
  const ev = getCurrentEvent();
  currentEventId = ev?.id || null;

  const badge = $('daymodeBadge');
  const title = $('daymodeTitle');
  const place = $('daymodePlace');
  const notes = $('daymodeNotes');
  const actions = $('daymodeActions');
  const wrap = $('daymode');

  if (!ev) {
    if (badge) badge.textContent = 'Día libre';
    if (title) title.textContent = 'Sin eventos próximos';
    if (place) place.textContent = '🎉 Disfrutá el día';
    if (notes) notes.textContent = '';
    if (actions) actions.hidden = true;
    if (wrap) wrap.classList.remove('is-live');
    renderCountdown();
    renderUpcoming();
    return;
  }

  if (actions) actions.hidden = false;

  const t = new Date(ev.startAt).getTime();
  const diff = t - Date.now();

  let badgeText = 'A continuación';
  let isLive = false;
  if (diff <= 0 && diff > -60 * 60 * 1000) { badgeText = 'Ahora'; isLive = true; }
  else if (diff <= -60 * 60 * 1000) badgeText = 'Pendiente';

  if (badge) badge.textContent = badgeText;
  if (title) title.textContent = ev.title || '—';
  if (place) place.textContent = ev.place ? `📍 ${ev.place}` : '';
  if (notes) notes.textContent = ev.notes || '';
  if (wrap) wrap.classList.toggle('is-live', isLive);

  renderCountdown();
  renderUpcoming();
}

/* ---------- Countdown ---------- */
function updateCountdown() {
  if (!isActive) return;
  const ev = getCurrentEvent();
  const el = $('daymodeCountdown');
  if (!el) return;

  if (!ev) { el.hidden = true; return; }
  el.hidden = false;

  const t = new Date(ev.startAt).getTime();
  const diff = t - Date.now();
  const abs = Math.abs(diff);

  let num, unit, label;
  if (abs < 60 * 1000) {
    num = 'Ahora'; unit = ''; label = '';
  } else if (abs < 60 * 60 * 1000) {
    num = String(Math.round(abs / 60000));
    unit = 'min';
    label = diff > 0 ? 'en' : 'hace';
  } else if (abs < 24 * 60 * 60 * 1000) {
    const h = Math.floor(abs / 3600000);
    const m = Math.round((abs % 3600000) / 60000);
    num = `${h}:${String(m).padStart(2, '0')}`;
    unit = 'hs';
    label = diff > 0 ? 'en' : 'hace';
  } else {
    num = String(Math.round(abs / (24 * 3600000)));
    unit = 'días';
    label = diff > 0 ? 'en' : 'hace';
  }

  const numEl = $('daymodeCountdownNum');
  const unitEl = $('daymodeCountdownUnit');
  const labelEl = $('daymodeCountdownLabel');
  if (numEl) numEl.textContent = num;
  if (unitEl) unitEl.textContent = unit;
  if (labelEl) labelEl.textContent = label;
}

function renderCountdown() { updateCountdown(); }

/* ---------- Upcoming ---------- */
function renderUpcoming() {
  const list = $('daymodeUpcoming');
  if (!list || !getEventsFn) return;

  const events = getEventsFn();
  const now = Date.now();
  const currentId = currentEventId;

  const upcoming = events
    .filter(e => !e.done && e.id !== currentId && new Date(e.startAt).getTime() > now)
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))
    .slice(0, 3);

  if (!upcoming.length) {
    list.innerHTML = '<li class="daymode__upcoming-empty">Nada más por hoy</li>';
    return;
  }

  list.innerHTML = upcoming.map(e => {
    const t = new Date(e.startAt);
    const time = t.toLocaleTimeString('es-AR', {
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    return `
      <li class="daymode__upcoming-item" data-id="${e.id}">
        <span class="daymode__upcoming-time">${time}</span>
        <span class="daymode__upcoming-title">${escapeHtml(e.title)}</span>
      </li>
    `;
  }).join('');

  list.querySelectorAll('[data-id]').forEach(el => {
    el.addEventListener('click', () => {
      currentEventId = el.dataset.id;
      render();
    });
  });
}

/* ---------- Acciones ---------- */
export async function actionDone() {
  const ev = getCurrentEvent();
  if (!ev) return;
  if (onEventDoneFn) await onEventDoneFn(ev.id);
  currentEventId = null;
  render();
}

export function actionSkip() {
  if (!getEventsFn) return;
  const events = getEventsFn();
  const now = Date.now();
  const currentId = currentEventId;

  const next = events
    .filter(e => !e.done && e.id !== currentId && new Date(e.startAt).getTime() > now - 30 * 60 * 1000)
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))[0];

  if (next) {
    currentEventId = next.id;
    render();
  }
}

export async function actionNavigate() {
  const ev = getCurrentEvent();
  if (!ev) return { ok: false, reason: 'sin-evento' };

  const query = ev.location?.lat && ev.location?.lng
    ? `${ev.location.lat},${ev.location.lng}`
    : ev.place;

  if (!query) return { ok: false, reason: 'sin-ubicacion' };

  const encoded = encodeURIComponent(query);
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isMobile = isIOS || isAndroid;

  // En mobile: intentar abrir la app nativa de mapas
  if (isMobile) {
    const nativeUrl = isIOS
      ? `maps://?q=${encoded}`
      : `geo:0,0?q=${encoded}`;

    // Abrir la app nativa. Si no responde en 1.5s, caer al navegador.
    const fallback = `https://www.google.com/maps/search/?api=1&query=${encoded}`;

    try {
      // Truco: usar un iframe invisible para intentar la app sin salir de la página
      const start = Date.now();
      window.location.href = nativeUrl;

      // Si después de 1.5s seguimos acá, no hay app nativa → fallback
      setTimeout(() => {
        if (Date.now() - start < 2000 && !document.hidden) {
          window.open(fallback, '_blank', 'noopener');
        }
      }, 1500);

      return { ok: true, native: true };
    } catch {
      // fallback
      window.open(fallback, '_blank', 'noopener');
      return { ok: true, fallback: true };
    }
  }

  // Desktop: Google Maps en pestaña nueva
  const url = `https://www.google.com/maps/search/?api=1&query=${encoded}`;
  window.open(url, '_blank', 'noopener');
  return { ok: true, desktop: true };
}

/* ---------- Utils ---------- */
function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
