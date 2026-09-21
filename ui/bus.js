/* ============================================================
   OhMyGoch Trip OS · ui/bus.js
   Estado compartido + slots de dependencia + helpers comunes
   ============================================================ */

/* ---------- Estado global ---------- */
export const ctx = {
  trip: null,
  events: [],
  // Slots que registra app.js
  renderAll: null,
  setView: null,
  refreshSubsystems: null,
  // Slots que registran otros módulos
  openEventModal: null,
  saveEvent: null,
  deleteEvent: null,
  toggleDone: null,
};

export function register(key, fn) {
  ctx[key] = fn;
}

export function call(key, ...args) {
  const fn = ctx[key];
  if (!fn) { console.warn(`[bus] slot "${key}" no registrado`); return; }
  return fn(...args);
}

/* ---------- Event emitter ---------- */
const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, []);
  listeners.get(event).push(fn);
  return () => off(event, fn);
}

export function off(event, fn) {
  const arr = listeners.get(event);
  if (!arr) return;
  const i = arr.indexOf(fn);
  if (i >= 0) arr.splice(i, 1);
}

export function emit(event, payload) {
  for (const fn of listeners.get(event) || []) {
    try { fn(payload); } catch (e) { console.warn(`[bus] listener ${event}:`, e); }
  }
}

/* ---------- Modal helpers (accesibles con inert) ---------- */
export function openModalEl(el) {
  if (!el) return;
  el.hidden = false;
  el.inert = false;
  el.removeAttribute('aria-hidden');
}

export function closeModalEl(el) {
  if (!el) return;
  if (el.contains(document.activeElement)) document.activeElement.blur();
  el.inert = true;
  el.hidden = true;
  el.setAttribute('aria-hidden', 'true');
}

/* ---------- Toast ---------- */
let toastTimer;
export function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add('is-visible'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('is-visible');
    setTimeout(() => { t.hidden = true; }, 250);
  }, 2200);
}

/* ---------- Formatters ---------- */
export function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function uid(prefix = 'e_') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function fmtDateShort(iso) {
  return new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

export function relTime(iso) {
  const diff = new Date(iso).getTime() - Date.now();
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 1) return 'ahora';
  if (Math.abs(mins) < 60) return mins > 0 ? `en ${mins} min` : `hace ${-mins} min`;
  const h = Math.round(mins / 60);
  if (Math.abs(h) < 24) return h > 0 ? `en ${h} h` : `hace ${-h} h`;
  const d = Math.round(h / 24);
  return d > 0 ? `en ${d} d` : `hace ${-d} d`;
}

export function isToday(iso) {
  const d = new Date(iso), n = new Date();
  return d.getFullYear() === n.getFullYear() &&
         d.getMonth() === n.getMonth() &&
         d.getDate() === n.getDate();
}

export function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(val) {
  return new Date(val).toISOString();
}

export function normalize(s = '') {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9áéíóúñ]/gi, '');
}

export function sameDay(a, b) {
  if (!a || !b) return false;
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() &&
         da.getMonth() === db.getMonth() &&
         da.getDate() === db.getDate();
}

/* ---------- Constantes compartidas ---------- */
export const TYPE_META = {
  flight:    { icon: '✈',  label: 'Vuelo',      color: '#3b82f6' },
  transport: { icon: '🚇', label: 'Transporte', color: '#06b6d4' },
  hotel:     { icon: '🏨', label: 'Hotel',      color: '#8b5cf6' },
  airbnb:    { icon: '🏠', label: 'Airbnb',     color: '#ec4899' },
  car:       { icon: '🚗', label: 'Auto',       color: '#6366f1' },
  food:      { icon: '🍽', label: 'Comida',     color: '#f97316' },
  activity:  { icon: '🎨', label: 'Actividad',  color: '#10b981' },
  freetour:  { icon: '🚶', label: 'Free tour',  color: '#ef4444' },
  note:      { icon: '📝', label: 'Nota',       color: '#6b7280' },
};

export const EMOJIS = [
  '🌍','🇦🇷','🇪🇸','🇺🇸','🇧🇷','🇲🇽','🇨🇱','🇨🇴',
  '🇵🇪','🇺🇾','🇫🇷','🇮🇹','🇩🇪','🇬🇧','🇵🇹','🇯🇵',
  '🇨🇳','🇰🇷','🇹🇭','🇮🇳','🇦🇺','🇳🇿','🇿🇦','🇪🇬',
  '🇲🇦','🇹🇷','🇬🇷','🇨🇦','🇳🇱','🇧🇪','🇨🇭','🇦🇹',
];
