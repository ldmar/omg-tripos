/* ============================================================
   RUTA · App logic
   IndexedDB + render + CRUD + PWA hooks
   ============================================================ */

/* ---------- Constantes ---------- */
const DB_NAME = 'ruta';
const DB_VERSION = 1;
const STORE_EVENTS = 'events';
const STORE_META = 'meta';
const TRIP_KEY = 'trip';

const TYPE_META = {
  flight:    { icon: '✈', label: 'Vuelo',       color: '#3b82f6' },
  transport: { icon: '🚇', label: 'Transporte', color: '#06b6d4' },
  hotel:     { icon: '🏨', label: 'Hotel',      color: '#8b5cf6' },
  airbnb:    { icon: '🏠', label: 'Airbnb',     color: '#ec4899' },
  food:      { icon: '🍽', label: 'Comida',     color: '#f97316' },
  activity:  { icon: '🎨', label: 'Actividad',  color: '#10b981' },
  note:      { icon: '📝', label: 'Nota',       color: '#6b7280' },
};

const TRIP = {
  id: 'madrid-2026',
  title: 'Escapada a Madrid',
  flag: '🇪🇸',
  days: 5,
  travelers: 4,
};

/* ---------- IndexedDB wrapper (minimal, promise-based) ---------- */
let _db;
function db() {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(STORE_EVENTS)) {
        const store = idb.createObjectStore(STORE_EVENTS, { keyPath: 'id' });
        store.createIndex('startAt', 'startAt');
      }
      if (!idb.objectStoreNames.contains(STORE_META)) {
        idb.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _db;
}

function tx(store, mode, fn) {
  return db().then(idb => new Promise((resolve, reject) => {
    const t = idb.transaction(store, mode);
    const s = t.objectStore(store);
    const result = fn(s);
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const idbAll    = (store)      => tx(store, 'readonly',  s => s.getAll());
const idbGet    = (store, key) => tx(store, 'readonly',  s => s.get(key));
const idbPut    = (store, val) => tx(store, 'readwrite', s => s.put(val));
const idbDelete = (store, key) => tx(store, 'readwrite', s => s.delete(key));
const idbClear  = (store)      => tx(store, 'readwrite', s => s.clear());

/* ---------- Seed ---------- */
function uid() {
  return 'e_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function seedEvents() {
  const now = new Date();
  const at = (h, m = 0) => {
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  const base = [
    { type: 'flight',    title: 'Vuelo BCN → MAD',        place: 'Aeropuerto El Prat T1',     notes: 'Vueling VY1234 · Puerta B12', startAt: at(9, 0),  done: true },
    { type: 'transport', title: 'Metro a Sol',            place: 'Estación Nuevos Ministerios', notes: 'Línea 8 + Cercanías',        startAt: at(11, 30), done: true },
    { type: 'food',      title: 'Comida en San Miguel',   place: 'Plaza San Miguel',          notes: 'Reserva confirmada · 4 pax', startAt: at(12, 30), done: false },
    { type: 'hotel',     title: 'Check-in Hotel Gran Vía',place: 'Gran Vía 1',                notes: 'Ref. BK-8827341 · Doble x2', startAt: at(15, 0),  done: false },
    { type: 'activity',  title: 'Museo del Prado',        place: 'Calle de Ruiz de Alarcón',  notes: 'Entradas 4 · gratis 18h-20h',startAt: at(17, 30), done: false },
    { type: 'food',      title: 'Cena en La Latina',      place: 'Calle Cava Baja',           notes: 'Sugerencia: Casa Lucio',     startAt: at(20, 30), done: false },
    { type: 'activity',  title: 'Tablao Flamenco',        place: 'Corral de la Morería',      notes: 'Reserva Lucas · 4 entradas', startAt: at(22, 30), done: false },
  ];
  return base.map(e => ({ id: uid(), ...e }));
}

async function ensureSeed() {
  const trip = await idbGet(STORE_META, TRIP_KEY);
  if (!trip) {
    await idbPut(STORE_META, { key: TRIP_KEY, ...TRIP });
  }
  const events = await idbAll(STORE_EVENTS);
  if (!events.length) {
    for (const e of seedEvents()) await idbPut(STORE_EVENTS, e);
  }
}

/* ---------- Estado en memoria ---------- */
let events = [];
let trip = { ...TRIP };

/* ---------- Carga y render ---------- */
async function loadAll() {
  trip = (await idbGet(STORE_META, TRIP_KEY)) || { ...TRIP };
  events = (await idbAll(STORE_EVENTS)).sort(
    (a, b) => new Date(a.startAt) - new Date(b.startAt)
  );
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function relTime(iso) {
  const diff = new Date(iso).getTime() - Date.now();
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 1) return 'ahora';
  if (Math.abs(mins) < 60) return mins > 0 ? `en ${mins} min` : `hace ${-mins} min`;
  const h = Math.round(mins / 60);
  if (Math.abs(h) < 24) return h > 0 ? `en ${h} h` : `hace ${-h} h`;
  const d = Math.round(h / 24);
  return d > 0 ? `en ${d} d` : `hace ${-d} d`;
}

function isToday(iso) {
  const d = new Date(iso), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function computeNext() {
  const now = Date.now();
  return events
    .filter(e => !e.done && new Date(e.startAt).getTime() > now - 5 * 60 * 1000)
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))[0];
}

function renderTrip() {
  document.getElementById('tripTitle').textContent = trip.title;
  document.getElementById('tripFlag').textContent = trip.flag;

  const today = events.filter(e => isToday(e.startAt));
  const done = today.filter(e => e.done).length;
  const pct = today.length ? Math.round((done / today.length) * 100) : 0;
  document.getElementById('heroProgress').style.width = pct + '%';

  const opts = { day: 'numeric', month: 'short' };
  document.getElementById('heroDate').textContent = new Date().toLocaleDateString('es-AR', opts);
}

function renderNext() {
  const n = computeNext();
  const card = document.getElementById('nextCard');
  if (!n) {
    card.style.display = 'none';
    return;
  }
  card.style.display = '';
  document.getElementById('nextTitle').textContent = n.title;
  document.getElementById('nextTime').textContent = `${fmtTime(n.startAt)} · ${relTime(n.startAt)}`;
  document.getElementById('nextPlace').textContent = n.place || 'Sin ubicación';
  document.getElementById('nextCta').onclick = () => openModal(n.id);
}

function renderTimeline() {
  const ol = document.getElementById('timeline');
  const empty = document.getElementById('emptyState');

  if (!events.length) {
    ol.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const now = Date.now();
  ol.innerHTML = events.map(e => {
    const meta = TYPE_META[e.type] || TYPE_META.note;
    const t = new Date(e.startAt).getTime();
    const isLive = !e.done && t <= now && now - t < 60 * 60 * 1000;
    const isNext = !e.done && t > now;
    const status = e.done ? 'done' : (isLive ? 'next' : (isNext ? 'next' : 'upcoming'));

    return `
      <li class="tl tl--${e.type} tl--${status}" data-id="${e.id}">
        <div class="tl__rail">
          <span class="tl__dot" data-toggle="${e.id}" title="${e.done ? 'Marcar como pendiente' : 'Marcar como hecho'}">
            ${e.done ? '<svg><use href="#i-check"/></svg>' : ''}
          </span>
        </div>
        <div class="tl__time">${fmtTime(e.startAt)}</div>
        <div class="tl__card" data-edit="${e.id}">
          <div class="tl__ico">${meta.icon}</div>
          <div class="tl__body">
            <h4>${escapeHtml(e.title)}${isLive ? '<span class="pill pill--live">Ahora</span>' : ''}${e.done ? '<span class="pill pill--done">Hecho</span>' : ''}</h4>
            ${e.notes ? `<p>${escapeHtml(e.notes)}</p>` : ''}
            ${e.place ? `<p class="tl__place"><svg><use href="#i-pin"/></svg>${escapeHtml(e.place)}</p>` : ''}
          </div>
        </div>
      </li>
    `;
  }).join('');

  // listeners
  ol.querySelectorAll('[data-toggle]').forEach(el => {
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      toggleDone(el.dataset.toggle);
    });
  });
  ol.querySelectorAll('[data-edit]').forEach(el => {
    el.addEventListener('click', () => openModal(el.dataset.edit));
  });
}

function escapeHtml(s = '') {
  return s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

async function renderAll() {
  await loadAll();
  renderTrip();
  renderNext();
  renderTimeline();
}

/* ---------- Acciones ---------- */
async function toggleDone(id) {
  const e = events.find(x => x.id === id);
  if (!e) return;
  e.done = !e.done;
  await idbPut(STORE_EVENTS, e);
  await renderAll();
  toast(e.done ? '✓ Marcado como hecho' : 'Marcado como pendiente');
}

async function saveEvent(ev) {
  await idbPut(STORE_EVENTS, ev);
  await renderAll();
}

async function deleteEvent(id) {
  await idbDelete(STORE_EVENTS, id);
  await renderAll();
  toast('Evento eliminado');
}

async function clearDone() {
  const done = events.filter(e => e.done);
  if (!done.length) { toast('No hay eventos hechos'); return; }
  if (!confirm(`¿Eliminar ${done.length} evento(s) ya realizados?`)) return;
  for (const e of done) await idbDelete(STORE_EVENTS, e.id);
  await renderAll();
  toast('Eventos limpiados');
}

/* ---------- Modal ---------- */
const modal = document.getElementById('modal');
const form = document.getElementById('eventForm');
const typeChips = document.getElementById('typeChips');
let currentType = 'activity';

function buildChips() {
  typeChips.innerHTML = Object.entries(TYPE_META).map(([key, m]) => `
    <button type="button" class="chip" data-type="${key}" style="--chip-c:${m.color}">
      <span>${m.icon}</span><span>${m.label}</span>
    </button>
  `).join('');
  typeChips.addEventListener('click', ev => {
    const btn = ev.target.closest('.chip');
    if (!btn) return;
    currentType = btn.dataset.type;
    typeChips.querySelectorAll('.chip').forEach(c => {
      c.classList.toggle('is-active', c.dataset.type === currentType);
    });
  });
}

function setChipActive() {
  typeChips.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('is-active', c.dataset.type === currentType);
  });
}

function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(val) {
  return new Date(val).toISOString();
}

function openModal(id) {
  const isEdit = !!id;
  const e = isEdit ? events.find(x => x.id === id) : null;

  document.getElementById('modalTitle').textContent = isEdit ? 'Editar evento' : 'Nuevo evento';
  document.getElementById('fId').value = e?.id || '';
  document.getElementById('fTitle').value = e?.title || '';
  document.getElementById('fStart').value = e ? toLocalInput(e.startAt) : toLocalInput(new Date(Date.now() + 60 * 60 * 1000).toISOString());
  document.getElementById('fPlace').value = e?.place || '';
  document.getElementById('fNotes').value = e?.notes || '';
  document.getElementById('deleteBtn').hidden = !isEdit;
  document.getElementById('saveBtn').textContent = isEdit ? 'Guardar' : 'Crear evento';

  currentType = e?.type || 'activity';
  setChipActive();

  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  setTimeout(() => document.getElementById('fTitle').focus(), 150);
}

function closeModal() {
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  form.reset();
}

modal.addEventListener('click', ev => {
  if (ev.target.hasAttribute('data-close') || ev.target.closest('[data-close]')) closeModal();
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && !modal.hidden) closeModal();
});

form.addEventListener('submit', async ev => {
  ev.preventDefault();
  const id = document.getElementById('fId').value || uid();
  const payload = {
    id,
    type: currentType,
    title: document.getElementById('fTitle').value.trim(),
    startAt: fromLocalInput(document.getElementById('fStart').value),
    place: document.getElementById('fPlace').value.trim(),
    notes: document.getElementById('fNotes').value.trim(),
    done: events.find(x => x.id === id)?.done || false,
  };
  await saveEvent(payload);
  closeModal();
  toast(events.find(x => x.id === id) ? 'Evento actualizado' : 'Evento creado');
});

document.getElementById('deleteBtn').addEventListener('click', async () => {
  const id = document.getElementById('fId').value;
  if (!id || !confirm('¿Eliminar este evento?')) return;
  await deleteEvent(id);
  closeModal();
});

/* ---------- Tabs ---------- */
function setView(name) {
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('is-active', v.dataset.view === name);
  });
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('is-active', t.dataset.tab === name);
  });
  document.getElementById('viewport').scrollTo({ top: 0, behavior: 'smooth' });
}
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => setView(t.dataset.tab));
});

/* ---------- Map pins ---------- */
document.querySelectorAll('.pin').forEach(p => {
  p.addEventListener('click', () => {
    document.querySelectorAll('.pin').forEach(x => x.classList.remove('is-selected'));
    p.classList.add('is-selected');
    const icon = p.textContent.trim();
    document.getElementById('sheetIcon').textContent = icon;
    document.getElementById('sheetTitle').textContent = p.dataset.label;
    document.getElementById('sheetMeta').textContent = 'Seleccionado · cerca de ti';
  });
});

/* ---------- FAB / botones ---------- */
document.getElementById('fab').addEventListener('click', () => openModal());
document.getElementById('clearDoneBtn').addEventListener('click', clearDone);
document.getElementById('bellBtn').addEventListener('click', () => {
  const b = document.getElementById('bellBtn');
  b.classList.add('is-pinged');
  setTimeout(() => b.classList.remove('is-pinged'), 600);
  toast('Sin notificaciones nuevas');
});

/* ---------- Reset demo (long-press en la bandera) ---------- */
(() => {
  const flag = document.getElementById('tripFlag');
  let timer;
  const start = () => { timer = setTimeout(async () => {
    if (!confirm('¿Reiniciar el demo? Se borrarán los eventos actuales.')) return;
    await idbClear(STORE_EVENTS);
    await idbClear(STORE_META);
    await ensureSeed();
    await renderAll();
    toast('Demo reiniciado');
  }, 800); };
  const cancel = () => clearTimeout(timer);
  flag.addEventListener('pointerdown', start);
  flag.addEventListener('pointerup', cancel);
  flag.addEventListener('pointercancel', cancel);
  flag.addEventListener('pointerleave', cancel);
})();

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add('is-visible'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('is-visible');
    setTimeout(() => { t.hidden = true; }, 250);
  }, 2200);
}

/* ---------- PWA: Service Worker ---------- */
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Nueva versión disponible · recargá');
        }
      });
    });
  } catch (err) {
    console.warn('SW error:', err);
  }
}

/* ---------- PWA: Install prompt ---------- */
let deferredPrompt = null;
const installBanner = document.getElementById('installBanner');
const installBtn = document.getElementById('installBtn');
const installClose = document.getElementById('installClose');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (!localStorage.getItem('ruta_install_dismissed')) {
    installBanner.hidden = false;
  }
});

installBtn?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') toast('¡Instalada! 🎉');
  deferredPrompt = null;
  installBanner.hidden = true;
});

installClose?.addEventListener('click', () => {
  installBanner.hidden = true;
  localStorage.setItem('ruta_install_dismissed', '1');
});

window.addEventListener('appinstalled', () => {
  installBanner.hidden = true;
  toast('Ruta instalada en tu dispositivo');
});

/* ---------- PWA: Online / Offline ---------- */
const offlineBanner = document.getElementById('offlineBanner');
function updateOnlineStatus() {
  offlineBanner.hidden = navigator.onLine;
  document.documentElement.dataset.online = navigator.onLine ? '1' : '0';
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

/* ---------- Boot ---------- */
(async function boot() {
  buildChips();
  await ensureSeed();
  await renderAll();
  updateOnlineStatus();
  registerSW();
})();