/* ============================================================
   OhMyGoch Trip OS · app.js
   ============================================================ */

import { analyze, analyzeMulti, PROVIDERS, EXAMPLES } from './parser.js';
import { extractTextFromPdf, isPdfFile, fmtBytes } from './pdf-import.js';
import { extractTextFromImage, isImageFile } from './ocr-import.js';
import * as sync from './sync.js';
import * as notif from './notifications.js';
import * as daymode from './daymode.js';
import * as wallet from './wallet.js';

/* ============================================================
   CONSTANTES
   ============================================================ */
const DB_NAME = 'ohmygoch';
const DB_VERSION = 1;
const STORE_EVENTS = 'events';
const STORE_META = 'meta';
const TRIP_KEY = 'trip';

const TYPE_META = {
  flight:    { icon: '✈', label: 'Vuelo',       color: '#3b82f6' },
  transport: { icon: '🚇', label: 'Transporte', color: '#06b6d4' },
  hotel:     { icon: '🏨', label: 'Hotel',      color: '#8b5cf6' },
  airbnb:    { icon: '🏠', label: 'Airbnb',     color: '#ec4899' },
  car:       { icon: '🚗', label: 'Auto',       color: '#6366f1' },
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

/* ============================================================
   INDEXEDDB
   ============================================================ */
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

/* ============================================================
   UTILS
   ============================================================ */
function uid() {
  return 'e_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function normalize(s = '') {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9áéíóúñ]/gi, '');
}

function sameDay(a, b) {
  if (!a || !b) return false;
  const da = new Date(a), db2 = new Date(b);
  return da.getFullYear() === db2.getFullYear() &&
         da.getMonth() === db2.getMonth() &&
         da.getDate() === db2.getDate();
}

function findDuplicate(candidate, existingList) {
  if (!existingList || !existingList.length) return null;
  for (const ev of existingList) {
    if (candidate.confirmation_code && ev.confirmation_code &&
        candidate.confirmation_code === ev.confirmation_code) {
      return ev;
    }
    if (candidate.type === ev.type &&
        normalize(candidate.title) === normalize(ev.title) &&
        sameDay(candidate.startAt, ev.startAt)) {
      return ev;
    }
  }
  return null;
}

/* ============================================================
   SEED
   ============================================================ */
function seedEvents() {
  const now = new Date();
  const at = (h, m = 0) => {
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  const base = [
    { type: 'flight',    title: 'Vuelo BCN → MAD',         place: 'Aeropuerto El Prat T1',      notes: 'Vueling VY1234 · Puerta B12', startAt: at(9, 0),  done: true },
    { type: 'transport', title: 'Metro a Sol',             place: 'Estación Nuevos Ministerios', notes: 'Línea 8 + Cercanías',         startAt: at(11, 30), done: true },
    { type: 'food',      title: 'Comida en San Miguel',    place: 'Plaza San Miguel',           notes: 'Reserva confirmada · 4 pax',  startAt: at(12, 30), done: false },
    { type: 'hotel',     title: 'Check-in Hotel Gran Vía', place: 'Gran Vía 1',                 notes: 'Ref. BK-8827341 · Doble x2',  startAt: at(15, 0),  done: false },
    { type: 'activity',  title: 'Museo del Prado',         place: 'Calle de Ruiz de Alarcón',   notes: 'Entradas 4 · gratis 18h-20h', startAt: at(17, 30), done: false },
    { type: 'food',      title: 'Cena en La Latina',       place: 'Calle Cava Baja',            notes: 'Sugerencia: Casa Lucio',      startAt: at(20, 30), done: false },
    { type: 'activity',  title: 'Tablao Flamenco',         place: 'Corral de la Morería',       notes: 'Reserva Lucas · 4 entradas',  startAt: at(22, 30), done: false },
  ];
  return base.map(e => ({ id: uid(), updatedAt: Date.now(), ...e }));
}

async function ensureSeed() {
  const trip = await idbGet(STORE_META, TRIP_KEY);
  if (!trip || !trip.id) {
    await idbPut(STORE_META, { key: TRIP_KEY, ...TRIP });
  }

  const events = await idbAll(STORE_EVENTS);
  if (!events.length) {
    for (const e of seedEvents()) await idbPut(STORE_EVENTS, e);
  }
}

/* ============================================================
   ESTADO
   ============================================================ */
let events = [];
let trip = { ...TRIP };

async function loadAll() {
  const stored = await idbGet(STORE_META, TRIP_KEY);
  trip = (stored && stored.id) ? stored : { ...TRIP };
  events = (await idbAll(STORE_EVENTS)).sort(
    (a, b) => new Date(a.startAt) - new Date(b.startAt)
  );
}

/* ============================================================
   FORMATO
   ============================================================ */
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
  return d.getFullYear() === n.getFullYear() &&
         d.getMonth() === n.getMonth() &&
         d.getDate() === n.getDate();
}

function computeNext() {
  const now = Date.now();
  return events
    .filter(e => !e.done && new Date(e.startAt).getTime() > now - 5 * 60 * 1000)
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))[0];
}

function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(val) {
  return new Date(val).toISOString();
}

/* ============================================================
   RENDER
   ============================================================ */
function renderTrip() {
  document.getElementById('tripTitle').textContent = trip.title;

  const today = events.filter(e => isToday(e.startAt));
  const done = today.filter(e => e.done).length;
  const pct = today.length ? Math.round((done / today.length) * 100) : 0;
  document.getElementById('heroProgress').style.width = pct + '%';

  const opts = { day: 'numeric', month: 'short' };
  document.getElementById('heroDate').textContent =
    new Date().toLocaleDateString('es-AR', opts);
}

function renderNext() {
  const n = computeNext();
  const card = document.getElementById('nextCard');
  if (!n) { card.style.display = 'none'; return; }
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
  const notifSettings = notif.getSettings();

  ol.innerHTML = events.map(e => {
    const meta = TYPE_META[e.type] || TYPE_META.note;
    const t = new Date(e.startAt).getTime();
    const isLive = !e.done && t <= now && now - t < 60 * 60 * 1000;
    const isNext = !e.done && t > now;
    const status = e.done ? 'done' : (isLive ? 'next' : (isNext ? 'next' : 'upcoming'));

    const hasReminder = notifSettings.enabled && !e.done && e.startAt && !e.noReminder;
    const reminderBadge = hasReminder
      ? `<span class="tl__reminder">🔔 ${e.reminderMin ?? notifSettings.leadMin}m</span>`
      : '';

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
            <h4>${escapeHtml(e.title)}${isLive ? '<span class="pill pill--live">Ahora</span>' : ''}${e.done ? '<span class="pill pill--done">Hecho</span>' : ''}${reminderBadge}</h4>
            ${e.notes ? `<p>${escapeHtml(e.notes)}</p>` : ''}
            ${e.place ? `<p class="tl__place"><svg><use href="#i-pin"/></svg>${escapeHtml(e.place)}</p>` : ''}
          </div>
        </div>
      </li>
    `;
  }).join('');

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

async function renderAll() {
  await loadAll();
  renderTrip();
  renderNext();
  renderTimeline();
}

/* ============================================================
   ACCIONES
   ============================================================ */
async function toggleDone(id) {
  const e = events.find(x => x.id === id);
  if (!e) return;
  e.done = !e.done;
  e.updatedAt = Date.now();
  await idbPut(STORE_EVENTS, e);
  sync.setEvent(e);
  await renderAll();
  toast(e.done ? '✓ Marcado como hecho' : 'Marcado como pendiente');
}

async function saveEvent(ev) {
  ev.updatedAt = Date.now();
  await idbPut(STORE_EVENTS, ev);
  sync.setEvent(ev);
  await renderAll();
}

async function deleteEvent(id) {
  try {
    const files = await wallet.getFilesByEvent(id);
    for (const f of files) await wallet.deleteFile(f.id);
  } catch {}
  await idbDelete(STORE_EVENTS, id);
  sync.deleteEventSync(id);
  await renderAll();
  await renderWallet();
  toast('Evento eliminado');
}

async function clearDone() {
  const done = events.filter(e => e.done);
  if (!done.length) { toast('No hay eventos hechos'); return; }
  if (!confirm(`¿Eliminar ${done.length} evento(s) ya realizados?`)) return;
  for (const e of done) {
    try {
      const files = await wallet.getFilesByEvent(e.id);
      for (const f of files) await wallet.deleteFile(f.id);
    } catch {}
    await idbDelete(STORE_EVENTS, e.id);
    sync.deleteEventSync(e.id);
  }
  await renderAll();
  await renderWallet();
  toast('Eventos limpiados');
}

/* ============================================================
   MODAL · EVENTO
   ============================================================ */
const modal = document.getElementById('modal');
const form = document.getElementById('eventForm');
const typeChips = document.getElementById('typeChips');
let currentType = 'activity';

// Adjuntos del evento en edición (temporal)
// Cada item: { id, isNew, file?, preview?, record?, category }
let editingAttachments = [];

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

async function openModal(id) {
  const isEdit = !!id;
  const e = isEdit ? events.find(x => x.id === id) : null;

  document.getElementById('modalTitle').textContent = isEdit ? 'Editar evento' : 'Nuevo evento';
  document.getElementById('fId').value = e?.id || '';
  document.getElementById('fTitle').value = e?.title || '';
  document.getElementById('fStart').value = e
    ? toLocalInput(e.startAt)
    : toLocalInput(new Date(Date.now() + 60 * 60 * 1000).toISOString());
  document.getElementById('fPlace').value = e?.place || '';
  document.getElementById('fNotes').value = e?.notes || '';
  document.getElementById('deleteBtn').hidden = !isEdit;
  document.getElementById('saveBtn').textContent = isEdit ? 'Guardar' : 'Crear evento';

  currentType = e?.type || 'activity';
  setChipActive();

  editingAttachments = [];
  if (isEdit) {
    try {
      const files = await wallet.getFilesByEvent(e.id);
      editingAttachments = files.map(f => ({
        id: f.id,
        isNew: false,
        record: f,
        category: f.category || 'other',
      }));
    } catch {}
  }
  renderAttachments();

  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  setTimeout(() => document.getElementById('fTitle').focus(), 150);
}

function closeModal() {
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  form.reset();
  editingAttachments = [];
  renderAttachments();
}

modal.addEventListener('click', ev => {
  if (ev.target.hasAttribute('data-close') || ev.target.closest('[data-close]')) closeModal();
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && !modal.hidden) closeModal();
});

/* ---------- Adjuntos ---------- */
function renderAttachments() {
  const list = document.getElementById('fAttachList');
  if (!list) return;

  if (!editingAttachments.length) {
    list.innerHTML = '';
    return;
  }

  const cats = wallet.getCategories();

  list.innerHTML = editingAttachments.map((a, i) => {
    const rec = a.record || a.preview;
    const thumb = rec?.thumbnail ? URL.createObjectURL(rec.thumbnail) : null;
    const icon = a.isNew ? '📎' : (rec?.mime === 'application/pdf' ? '📄' : '🖼');
    const name = rec?.name || 'archivo';
    const size = rec?.size ? wallet.fmtBytes(rec.size) : '';

    const selectOptions = Object.entries(cats).map(([k, v]) =>
      `<option value="${k}" ${a.category === k ? 'selected' : ''}>${v.icon} ${v.label}</option>`
    ).join('');

    return `
      <div class="attach-item" data-idx="${i}">
        <div class="attach-item__icon">
          ${thumb ? `<img src="${thumb}" alt="" onload="URL.revokeObjectURL(this.src)" />` : icon}
        </div>
        <div class="attach-item__body">
          <div class="attach-item__name">${escapeHtml(name)}</div>
          <div class="attach-item__meta">${a.isNew ? 'Nuevo · ' : ''}${size}</div>
        </div>
        <select class="attach-item__cat" data-cat-idx="${i}" aria-label="Categoría">
          ${selectOptions}
        </select>
        <button type="button" class="attach-item__remove" data-remove="${i}" aria-label="Quitar">
          <svg><use href="#i-x"/></svg>
        </button>
      </div>
    `;
  }).join('');

  // Cambio de categoría
  list.querySelectorAll('[data-cat-idx]').forEach(sel => {
    sel.addEventListener('change', (ev) => {
      const idx = +sel.dataset.catIdx;
      const item = editingAttachments[idx];
      if (!item) return;
      item.category = sel.value;
      // Si es existente, actualizar en IndexedDB ya mismo
      if (!item.isNew && item.id) {
        wallet.updateFile(item.id, { category: sel.value }).catch(() => {});
      }
    });
  });

  // Remover
  list.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const idx = +btn.dataset.remove;
      const item = editingAttachments[idx];
      if (item && !item.isNew && item.id) {
        wallet.deleteFile(item.id).catch(() => {});
      }
      editingAttachments.splice(idx, 1);
      renderAttachments();
    });
  });
}

document.getElementById('fAttachBtn').addEventListener('click', () => {
  document.getElementById('fAttachInput').click();
});

document.getElementById('fAttachInput').addEventListener('change', async (e) => {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  for (const f of files) {
    if (f.size > 15 * 1024 * 1024) { toast(`${f.name} · más de 15MB`); continue; }

    // Auto-categoría por nombre + tipo de evento actual
    const autoCat = guessCategory(f, currentType);

    editingAttachments.push({
      id: null,
      isNew: true,
      file: f,
      category: autoCat,
      preview: {
        name: f.name,
        size: f.size,
        mime: f.type,
        thumbnail: f.type.startsWith('image/') ? f : null,
      },
    });
  }
  renderAttachments();
});

/* Auto-categoría local (mismo criterio que wallet.js) */
function guessCategory(file, eventType) {
  const name = (file.name || '').toLowerCase();

  if (/boarding|tarjeta.*embarque|pase.*abordar|boardingpass/.test(name)) return 'boarding';

  if (/aerolineas|aerol[ií]neas|lufthansa|iberia|vueling|latam|avianca|american|united|delta|klm|air\s*france|ryanair|easyjet|gol|azul|copa|despegar/.test(name)) return 'boarding';

  if (/^(ar|la|aa|ua|dl|ib|vy|af|kl|av|g3)\b/i.test(name.replace(/[_\-.]+/g, ' '))) return 'boarding';

  if (/voucher|reserva|booking|airbnb|hotel/.test(name)) return 'voucher';
  if (/seguro|insurance|poliza|p[oó]liza/.test(name)) return 'insurance';
  if (/\b(dni|pasaporte|passport|id\b|c[eé]dula|licencia)\b/.test(name)) return 'id';
  if (/\b(auto|car|rental|alquiler|hertz|avis|europcar|sixt)\b/.test(name)) return 'car';

  if (eventType === 'flight') return 'boarding';
  if (eventType === 'hotel' || eventType === 'airbnb') return 'voucher';
  if (eventType === 'car') return 'car';

  return 'other';
}

form.addEventListener('submit', async ev => {
  ev.preventDefault();
  const id = document.getElementById('fId').value || uid();
  const exists = events.find(x => x.id === id);
  const payload = {
    id,
    type: currentType,
    title: document.getElementById('fTitle').value.trim(),
    startAt: fromLocalInput(document.getElementById('fStart').value),
    place: document.getElementById('fPlace').value.trim(),
    notes: document.getElementById('fNotes').value.trim(),
    done: exists?.done || false,
    updatedAt: Date.now(),
  };
  await saveEvent(payload);

  // Guardar adjuntos nuevos con la categoría elegida
  for (const a of editingAttachments) {
    if (a.isNew && a.file) {
      try {
        await wallet.saveFile(a.file, {
          eventId: id,
          eventType: currentType,
          category: a.category,
        });
      } catch (err) {
        console.warn('No se pudo guardar adjunto:', err);
        toast(`Error: ${err.message}`);
      }
    }
  }

  closeModal();
  toast(exists ? 'Evento actualizado' : 'Evento creado');
  renderWallet();
});

document.getElementById('deleteBtn').addEventListener('click', async () => {
  const id = document.getElementById('fId').value;
  if (!id || !confirm('¿Eliminar este evento?')) return;
  await deleteEvent(id);
  closeModal();
});

/* ============================================================
   TABS
   ============================================================ */
function setView(name) {
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('is-active', v.dataset.view === name);
  });
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('is-active', t.dataset.tab === name);
  });
  document.getElementById('viewport').scrollTo({ top: 0, behavior: 'smooth' });

  if (name === 'wallet') renderWallet();
}

document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => setView(t.dataset.tab));
});

/* ============================================================
   MAPA
   ============================================================ */
document.querySelectorAll('.pin').forEach(p => {
  p.addEventListener('click', () => {
    document.querySelectorAll('.pin').forEach(x => x.classList.remove('is-selected'));
    p.classList.add('is-selected');
    document.getElementById('sheetIcon').textContent = p.textContent.trim();
    document.getElementById('sheetTitle').textContent = p.dataset.label;
    document.getElementById('sheetMeta').textContent = 'Seleccionado · cerca de ti';
  });
});

/* ============================================================
   FAB
   ============================================================ */
document.getElementById('fab').addEventListener('click', () => openModal());
document.getElementById('clearDoneBtn').addEventListener('click', clearDone);

/* ============================================================
   RESET DEMO
   ============================================================ */
(() => {
  const flag = document.getElementById('tripFlag');
  let timer;
  const start = () => {
    timer = setTimeout(async () => {
      if (!confirm('¿Reiniciar el demo? Se borrarán los eventos y archivos.')) return;
      await idbClear(STORE_EVENTS);
      await idbClear(STORE_META);
      await wallet.clearAllFiles();
      sync.clearAllEvents();
      await ensureSeed();
      await renderAll();
      await renderWallet();
      toast('Demo reiniciado');
    }, 800);
  };
  const cancel = () => clearTimeout(timer);
  flag.addEventListener('pointerdown', start);
  flag.addEventListener('pointerup', cancel);
  flag.addEventListener('pointercancel', cancel);
  flag.addEventListener('pointerleave', cancel);
})();

/* ============================================================
   TOAST
   ============================================================ */
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

/* ============================================================
   WALLET · render + gestión + MODAL CATEGORÍA
   ============================================================ */
let walletFilter = 'all';
let walletFilesCache = [];
let walletObjectUrls = [];

// Estado del modal de categoría
let wcatPending = [];         // archivos pendientes de subir
let wcatSelected = 'boarding'; // categoría por defecto

const walletGrid = document.getElementById('walletGrid');
const walletEmpty = document.getElementById('walletEmpty');
const walletStats = document.getElementById('walletStats');
const walletFilters = document.getElementById('walletFilters');
const walletCatModal = document.getElementById('walletCatModal');
const wcatGrid = document.getElementById('wcatGrid');
const wcatFiles = document.getElementById('wcatFiles');

async function renderWallet() {
  for (const url of walletObjectUrls) URL.revokeObjectURL(url);
  walletObjectUrls = [];

  try {
    walletFilesCache = await wallet.getAllFiles();
  } catch (err) {
    console.error('Wallet load error:', err);
    walletFilesCache = [];
  }

  const count = walletFilesCache.length;
  const totalBytes = walletFilesCache.reduce((s, f) => s + (f.size || 0), 0);
  walletStats.textContent = count ? `${count} · ${wallet.fmtBytes(totalBytes)}` : 'Vacío';

  const filtered = walletFilter === 'all'
    ? walletFilesCache
    : walletFilesCache.filter(f => f.category === walletFilter);

  if (!filtered.length) {
    walletGrid.innerHTML = '';
    walletEmpty.hidden = walletFilesCache.length > 0;
    return;
  }
  walletEmpty.hidden = true;

  const cats = wallet.getCategories();

  walletGrid.innerHTML = filtered.map(f => {
    const cat = cats[f.category] || cats.other;
    const isLinked = !!f.eventId;
    let thumbHtml = `<div class="wallet-card__thumb-icon">${cat.icon}</div>`;

    if (f.thumbnail) {
      const url = URL.createObjectURL(f.thumbnail);
      walletObjectUrls.push(url);
      thumbHtml = `<img src="${url}" alt="" loading="lazy" />`;
    } else if (wallet.isPdf(f)) {
      thumbHtml = `<div class="wallet-card__thumb-icon">📄</div>`;
    } else if (wallet.isImage(f)) {
      const url = URL.createObjectURL(f.blob);
      walletObjectUrls.push(url);
      thumbHtml = `<img src="${url}" alt="" loading="lazy" />`;
    }

    const date = new Date(f.uploadedAt).toLocaleDateString('es-AR', {
      day: 'numeric', month: 'short'
    });

    return `
      <div class="wallet-card" data-file-id="${f.id}">
        <div class="wallet-card__thumb">
          ${thumbHtml}
          <div class="wallet-card__cat-badge">${cat.label}</div>
          ${isLinked ? '<div class="wallet-card__linked">🔗</div>' : ''}
        </div>
        <div class="wallet-card__body">
          <p class="wallet-card__name">${escapeHtml(f.name)}</p>
          <p class="wallet-card__meta">
            <span>${date}</span>
            <span>${wallet.fmtBytes(f.size)}</span>
          </p>
        </div>
      </div>
    `;
  }).join('');

  walletGrid.querySelectorAll('[data-file-id]').forEach(el => {
    el.addEventListener('click', () => openViewer(el.dataset.fileId));
  });
}

/* ---------- Filtros ---------- */
walletFilters.addEventListener('click', (ev) => {
  const chip = ev.target.closest('.chip');
  if (!chip) return;
  walletFilter = chip.dataset.cat;
  walletFilters.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('is-active', c.dataset.cat === walletFilter);
  });
  renderWallet();
});

/* ---------- Upload desde FAB → modal de categoría ---------- */
document.getElementById('walletUploadBtn').addEventListener('click', () => {
  document.getElementById('walletUploadInput').click();
});

document.getElementById('walletUploadInput').addEventListener('change', async (e) => {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (!files.length) return;

  // Filtrar por tamaño
  const valid = files.filter(f => {
    if (f.size > 15 * 1024 * 1024) { toast(`${f.name} · más de 15MB`); return false; }
    return true;
  });
  if (!valid.length) return;

  // Elegir auto-categoría
  wcatPending = valid;
  wcatSelected = wallet.getCategories() ? guessCategory(valid[0], null) : 'boarding';

  openWalletCatModal();
});

/* ---------- Modal de categoría ---------- */
function buildWcatGrid() {
  const cats = wallet.getCategories();
  wcatGrid.innerHTML = Object.entries(cats).map(([k, v]) => `
    <button type="button" class="wcat__item" data-cat="${k}" style="--wcat-c:${v.color}">
      <span class="wcat__item-check">✓</span>
      <span class="wcat__item-icon">${v.icon}</span>
      <span>${v.label}</span>
    </button>
  `).join('');

  wcatGrid.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.wcat__item');
    if (!btn) return;
    wcatSelected = btn.dataset.cat;
    wcatGrid.querySelectorAll('.wcat__item').forEach(b => {
      b.classList.toggle('is-active', b.dataset.cat === wcatSelected);
    });
  });

  // Set initial active
  wcatGrid.querySelectorAll('.wcat__item').forEach(b => {
    b.classList.toggle('is-active', b.dataset.cat === wcatSelected);
  });
}

function openWalletCatModal() {
  // Texto de archivos
  if (wcatPending.length === 1) {
    wcatFiles.innerHTML = `<strong>${escapeHtml(wcatPending[0].name)}</strong> · ${wallet.fmtBytes(wcatPending[0].size)}`;
  } else {
    wcatFiles.innerHTML = `<strong>${wcatPending.length} archivos</strong> por subir`;
  }

  buildWcatGrid();
  walletCatModal.hidden = false;
  walletCatModal.setAttribute('aria-hidden', 'false');
}

function closeWalletCatModal() {
  walletCatModal.hidden = true;
  walletCatModal.setAttribute('aria-hidden', 'true');
  wcatPending = [];
}

walletCatModal.addEventListener('click', (ev) => {
  if (ev.target.hasAttribute('data-wcat-close') ||
      ev.target.closest('[data-wcat-close]')) closeWalletCatModal();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !walletCatModal.hidden) closeWalletCatModal();
});

document.getElementById('wcatConfirm').addEventListener('click', async () => {
  if (!wcatPending.length) return;

  let ok = 0, fail = 0;
  for (const f of wcatPending) {
    try {
      await wallet.saveFile(f, { category: wcatSelected });
      ok++;
    } catch (err) {
      console.warn(err);
      fail++;
    }
  }

  closeWalletCatModal();
  await renderWallet();

  if (ok && !fail) toast(`✓ ${ok} archivo${ok > 1 ? 's' : ''} subido${ok > 1 ? 's' : ''}`);
  else if (ok && fail) toast(`${ok} subidos · ${fail} con error`);
  else toast('No se pudo subir');
});

/* ============================================================
   VIEWER
   ============================================================ */
const walletViewer = document.getElementById('walletViewer');
const wvName = document.getElementById('wvName');
const wvContent = document.getElementById('wvContent');
let currentViewerFile = null;
let currentViewerUrl = null;

async function openViewer(fileId) {
  const file = await wallet.getFile(fileId);
  if (!file) { toast('Archivo no encontrado'); return; }

  currentViewerFile = file;
  wvName.textContent = file.name;
  wvContent.innerHTML = '';

  if (currentViewerUrl) URL.revokeObjectURL(currentViewerUrl);
  currentViewerUrl = URL.createObjectURL(file.blob);

  if (wallet.isPdf(file)) {
    const iframe = document.createElement('iframe');
    iframe.src = currentViewerUrl;
    iframe.title = file.name;
    wvContent.appendChild(iframe);
  } else if (wallet.isImage(file)) {
    const img = document.createElement('img');
    img.src = currentViewerUrl;
    img.alt = file.name;
    wvContent.appendChild(img);
  } else {
    wvContent.innerHTML = `<div class="wallet-viewer__error">
      Este tipo de archivo no se puede visualizar.<br>
      Tocá ⬇ para descargarlo.
    </div>`;
  }

  walletViewer.hidden = false;
  walletViewer.setAttribute('aria-hidden', 'false');
}

function closeViewer() {
  walletViewer.hidden = true;
  walletViewer.setAttribute('aria-hidden', 'true');
  if (currentViewerUrl) {
    URL.revokeObjectURL(currentViewerUrl);
    currentViewerUrl = null;
  }
  wvContent.innerHTML = '';
  currentViewerFile = null;
}

document.getElementById('wvClose').addEventListener('click', closeViewer);
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !walletViewer.hidden) closeViewer();
});

document.getElementById('wvShare').addEventListener('click', async () => {
  if (!currentViewerFile) return;
  try {
    if (navigator.share && navigator.canShare?.({ files: [currentViewerFile.blob] })) {
      await navigator.share({
        files: [new File([currentViewerFile.blob], currentViewerFile.name, { type: currentViewerFile.mime })],
        title: currentViewerFile.name,
      });
    } else {
      toast('Compartir no soportado · usá Descargar');
    }
  } catch (err) {
    if (err.name !== 'AbortError') toast('No se pudo compartir');
  }
});

document.getElementById('wvDownload').addEventListener('click', () => {
  if (!currentViewerFile || !currentViewerUrl) return;
  const a = document.createElement('a');
  a.href = currentViewerUrl;
  a.download = currentViewerFile.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  toast('Descargando…');
});

document.getElementById('wvOpenNew').addEventListener('click', () => {
  if (!currentViewerUrl) return;
  window.open(currentViewerUrl, '_blank', 'noopener');
});

document.getElementById('wvDelete').addEventListener('click', async () => {
  if (!currentViewerFile) return;
  if (!confirm(`¿Eliminar "${currentViewerFile.name}"?`)) return;
  await wallet.deleteFile(currentViewerFile.id);
  closeViewer();
  await renderWallet();
  toast('Archivo eliminado');
});

/* ============================================================
   IMPORT MÁGICO
   ============================================================ */
const importModal = document.getElementById('importModal');
const importInput = document.getElementById('importInput');
const importPreview = document.getElementById('importPreview');
const importText = document.getElementById('importText');
const providerChips = document.getElementById('providerChips');
const analyzeBtn = document.getElementById('importAnalyzeBtn');

let importProvider = 'auto';
let importResult = null;
let importSelected = new Set();
let importDupDecisions = new Map();

function buildProviderChips() {
  providerChips.innerHTML = Object.values(PROVIDERS).map(p => `
    <button type="button" class="chip" data-provider="${p.id}">
      <span>${p.emoji}</span><span>${p.name}</span>
    </button>
  `).join('');
  providerChips.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.chip');
    if (!btn) return;
    importProvider = btn.dataset.provider;
    providerChips.querySelectorAll('.chip').forEach(c => {
      c.classList.toggle('is-active', c.dataset.provider === importProvider);
    });
  });
  providerChips.querySelector('[data-provider="auto"]').classList.add('is-active');
}

function openImport(prefill = '') {
  resetImport();
  if (prefill) {
    importText.value = prefill;
    updateAnalyzeState();
  }
  importModal.hidden = false;
  importModal.setAttribute('aria-hidden', 'false');
  setTimeout(() => importText.focus(), 200);
}

function closeImport() {
  importModal.hidden = true;
  importModal.setAttribute('aria-hidden', 'true');
}

function resetImport() {
  importText.value = '';
  importProvider = 'auto';
  providerChips.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('is-active', c.dataset.provider === 'auto');
  });
  importResult = null;
  importSelected.clear();
  importDupDecisions.clear();
  importInput.hidden = false;
  importPreview.hidden = true;
  updateAnalyzeState();
  hideDropStatus();
}

function updateAnalyzeState() {
  analyzeBtn.disabled = importText.value.trim().length < 20;
}
importText.addEventListener('input', updateAnalyzeState);

document.getElementById('importExampleBtn').addEventListener('click', () => {
  const examples = Object.values(EXAMPLES);
  const current = importText.value.trim();
  const next = examples.find(e => e !== current) || examples[0];
  importText.value = next;
  importProvider = 'auto';
  providerChips.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('is-active', c.dataset.provider === 'auto');
  });
  updateAnalyzeState();
});

document.getElementById('importClearBtn').addEventListener('click', () => {
  importText.value = '';
  updateAnalyzeState();
});

analyzeBtn.addEventListener('click', () => {
  const text = importText.value;
  const result = analyzeMulti(text, importProvider);
  importResult = result;
  importSelected = new Set(result.events.map((_, i) => i));
  importDupDecisions.clear();
  renderImportPreview(result);
  importInput.hidden = true;
  importPreview.hidden = false;
});

document.getElementById('importBackBtn').addEventListener('click', () => {
  importPreview.hidden = true;
  importInput.hidden = false;
});

document.getElementById('importConfirmBtn').addEventListener('click', async () => {
  if (!importResult) return;

  const selected = importResult.events
    .map((ev, i) => ({ ev, i }))
    .filter(({ i }) => importSelected.has(i));

  if (!selected.length) { toast('No hay eventos seleccionados'); return; }

  let added = 0, replaced = 0, skipped = 0;

  for (const { ev, i } of selected) {
    const dup = findDuplicate(ev, events);
    const decision = importDupDecisions.get(i);

    if (dup) {
      if (decision === 'skip') { skipped++; continue; }
      if (decision === 'replace') {
        await idbDelete(STORE_EVENTS, dup.id);
        sync.deleteEventSync(dup.id);
        replaced++;
      }
    }

    await saveEvent({
      id: uid(),
      type: ev.type,
      title: ev.title,
      startAt: ev.startAt || new Date().toISOString(),
      endAt: ev.endAt || null,
      place: ev.place || '',
      notes: ev.notes || '',
      confirmation_code: ev.confirmation_code || null,
      cost: ev.cost || null,
      currency: ev.currency || null,
      done: false,
      updatedAt: Date.now(),
    });
    added++;
  }

  closeImport();
  setView('today');

  const parts = [];
  if (added) parts.push(`${added} agregado${added > 1 ? 's' : ''}`);
  if (replaced) parts.push(`${replaced} reemplazado${replaced > 1 ? 's' : ''}`);
  if (skipped) parts.push(`${skipped} salteado${skipped > 1 ? 's' : ''}`);
  toast(`✓ ${parts.join(' · ')}`);
});

function renderImportPreview(result) {
  const badge = document.getElementById('importProvider');
  const summary = document.getElementById('importSummary');
  const eventsEl = document.getElementById('importEvents');
  const warningsEl = document.getElementById('importWarnings');
  const warningsList = document.getElementById('importWarningsList');

  badge.textContent = result.providerName || 'Reserva';

  const dupCount = result.events.filter((ev, i) => {
    if (!importSelected.has(i)) return false;
    return findDuplicate(ev, events);
  }).length;

  summary.textContent = result.events.length === 1
    ? 'Se detectó 1 evento · tocá para editar'
    : `Se detectaron ${result.events.length} eventos · tocá para editar`;
  if (dupCount > 0) {
    summary.textContent += ` · ⚠ ${dupCount} duplicado${dupCount > 1 ? 's' : ''}`;
  }

  if (!result.events.length) {
    eventsEl.innerHTML = `
      <div class="empty" style="margin:0">
        <div class="empty__icon">🤔</div>
        <h4>No pude extraer nada</h4>
        <p>Probá pegando el email completo, o elegí el proveedor manualmente arriba.</p>
      </div>
    `;
  } else {
    eventsEl.innerHTML = result.events.map((ev, i) => {
      const meta = TYPE_META[ev.type] || TYPE_META.note;
      const conf = ev.confidence >= 0.75 ? 'high' : ev.confidence >= 0.5 ? 'mid' : 'low';
      const confLabel = conf === 'high' ? 'Alta' : conf === 'mid' ? 'Media' : 'Baja';
      const when = ev.startAt
        ? new Date(ev.startAt).toLocaleString('es-AR', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
          })
        : '—';
      const isSelected = importSelected.has(i);
      const dup = findDuplicate(ev, events);
      const decision = importDupDecisions.get(i);
      const dupClass = dup ? 'is-dup' : '';
      const dupBadge = dup
        ? `<span class="import-event__dup ${decision ? 'is-decided' : ''}">
             ${decision === 'skip' ? 'Saltar' :
               decision === 'replace' ? 'Reemplazar' :
               decision === 'duplicate' ? 'Duplicar' :
               '⚠ Ya existe'}
           </span>`
        : '';

      const dupActions = dup && isSelected ? `
        <div class="import-event__dup-actions">
          <button type="button" class="dup-btn ${decision === 'skip' ? 'is-active' : ''}" data-dup="${i}" data-act="skip">Saltar</button>
          <button type="button" class="dup-btn ${decision === 'replace' ? 'is-active' : ''}" data-dup="${i}" data-act="replace">Reemplazar</button>
          <button type="button" class="dup-btn ${decision === 'duplicate' ? 'is-active' : ''}" data-dup="${i}" data-act="duplicate">Duplicar</button>
        </div>
      ` : '';

      return `
        <div class="import-event ${isSelected ? 'is-selected' : ''} ${dupClass}" data-idx="${i}">
          <div class="import-event__icon">${meta.icon}</div>
          <div class="import-event__body">
            <div class="import-event__type">${meta.label}${dupBadge}</div>
            <div class="import-event__title">
              ${escapeHtml(ev.title)}
              <svg class="import-event__pencil"><use href="#i-pencil"/></svg>
            </div>
            <div class="import-event__meta"><svg><use href="#i-clock"/></svg>${when}</div>
            ${ev.place ? `<div class="import-event__meta"><svg><use href="#i-pin"/></svg>${escapeHtml(ev.place)}</div>` : ''}
          </div>
          <div class="import-event__check" data-check="${i}"><svg><use href="#i-check"/></svg></div>
          <span class="import-event__confidence conf--${conf}">${confLabel}</span>
          ${dupActions}
        </div>
      `;
    }).join('');

    eventsEl.querySelectorAll('[data-check]').forEach(el => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const idx = +el.dataset.check;
        const parent = el.closest('.import-event');
        if (importSelected.has(idx)) {
          importSelected.delete(idx);
          parent.classList.remove('is-selected');
        } else {
          importSelected.add(idx);
          parent.classList.add('is-selected');
        }
        renderImportPreview(importResult);
      });
    });

    eventsEl.querySelectorAll('[data-dup]').forEach(el => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const idx = +el.dataset.dup;
        const act = el.dataset.act;
        if (importDupDecisions.get(idx) === act) importDupDecisions.delete(idx);
        else importDupDecisions.set(idx, act);
        renderImportPreview(importResult);
      });
    });

    eventsEl.querySelectorAll('.import-event').forEach(el => {
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-check]')) return;
        if (ev.target.closest('[data-dup]')) return;
        openPreviewEdit(+el.dataset.idx);
      });
    });
  }

  if (result.warnings && result.warnings.length) {
    warningsEl.hidden = false;
    warningsList.innerHTML = result.warnings.map(w => `<li>· ${escapeHtml(w)}</li>`).join('');
  } else {
    warningsEl.hidden = true;
  }
}

/* ============================================================
   IMPORT · Editar evento en preview
   ============================================================ */
const previewEditModal = document.getElementById('previewEditModal');
const previewEditForm = document.getElementById('previewEditForm');
const peTypeChips = document.getElementById('peTypeChips');
let peCurrentType = 'activity';

function buildPeChips() {
  peTypeChips.innerHTML = Object.entries(TYPE_META).map(([key, m]) => `
    <button type="button" class="chip" data-type="${key}" style="--chip-c:${m.color}">
      <span>${m.icon}</span><span>${m.label}</span>
    </button>
  `).join('');
  peTypeChips.addEventListener('click', ev => {
    const btn = ev.target.closest('.chip');
    if (!btn) return;
    peCurrentType = btn.dataset.type;
    peTypeChips.querySelectorAll('.chip').forEach(c => {
      c.classList.toggle('is-active', c.dataset.type === peCurrentType);
    });
  });
}

function setPeChipsActive() {
  peTypeChips.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('is-active', c.dataset.type === peCurrentType);
  });
}

function openPreviewEdit(idx) {
  if (!importResult || !importResult.events[idx]) return;
  const ev = importResult.events[idx];

  document.getElementById('peIdx').value = idx;
  document.getElementById('peTitle').value = ev.title || '';
  document.getElementById('peStart').value = ev.startAt ? toLocalInput(ev.startAt) : '';
  document.getElementById('peEnd').value = ev.endAt ? toLocalInput(ev.endAt) : '';
  document.getElementById('pePlace').value = ev.place || '';
  document.getElementById('peCode').value = ev.confirmation_code || '';
  document.getElementById('peNotes').value = ev.notes || '';

  peCurrentType = ev.type || 'activity';
  setPeChipsActive();

  previewEditModal.hidden = false;
  previewEditModal.setAttribute('aria-hidden', 'false');
  setTimeout(() => document.getElementById('peTitle').focus(), 150);
}

function closePreviewEdit() {
  previewEditModal.hidden = true;
  previewEditModal.setAttribute('aria-hidden', 'true');
  previewEditForm.reset();
}

previewEditModal.addEventListener('click', ev => {
  if (ev.target.hasAttribute('data-preview-edit-close') ||
      ev.target.closest('[data-preview-edit-close]')) closePreviewEdit();
});

document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && !previewEditModal.hidden) closePreviewEdit();
});

previewEditForm.addEventListener('submit', ev => {
  ev.preventDefault();
  const idx = +document.getElementById('peIdx').value;
  if (!importResult || !importResult.events[idx]) return;

  importResult.events[idx] = {
    ...importResult.events[idx],
    type: peCurrentType,
    title: document.getElementById('peTitle').value.trim(),
    startAt: document.getElementById('peStart').value
      ? fromLocalInput(document.getElementById('peStart').value) : null,
    endAt: document.getElementById('peEnd').value
      ? fromLocalInput(document.getElementById('peEnd').value) : null,
    place: document.getElementById('pePlace').value.trim(),
    confirmation_code: document.getElementById('peCode').value.trim() || null,
    notes: document.getElementById('peNotes').value.trim(),
  };

  renderImportPreview(importResult);
  closePreviewEdit();
  toast('Evento actualizado');
});

importModal.addEventListener('click', (ev) => {
  if (ev.target.hasAttribute('data-import-close') || ev.target.closest('[data-import-close]')) {
    closeImport();
  }
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !importModal.hidden) closeImport();
});

document.getElementById('importBtn')?.addEventListener('click', () => openImport());

/* ============================================================
   IMPORT · Drag & drop
   ============================================================ */
const pdfDrop = document.getElementById('pdfDrop');
const cameraBtn = document.getElementById('cameraBtn');

function handleDroppedFile(file) {
  if (!file) return;
  if (isPdfFile(file)) return handlePdfFile(file);
  if (isImageFile(file)) return handleImageFile(file);
  toast('Formato no soportado. Solo PDF o imagen.');
}

function handlePdfFile(file) {
  showDropStatus(file.name, 'Extrayendo texto del PDF…');
  extractTextFromPdf(file)
    .then(text => {
      if (!text || text.length < 30) {
        showDropStatus(file.name, 'No pude extraer texto. ¿Es un PDF escaneado?');
        return;
      }
      importText.value = text;
      updateAnalyzeState();
      hideDropStatus();
      toast(`✓ PDF procesado · ${fmtBytes(file.size)}`);
    })
    .catch(err => {
      console.error(err);
      showDropStatus(file.name, 'Error: ' + err.message);
    });
}

function handleImageFile(file) {
  showDropStatus(file.name, 'Preparando OCR…');
  extractTextFromImage(file, (pct) => {
    showDropStatus(file.name, `Reconociendo texto… ${pct}%`);
  })
    .then(text => {
      if (!text || text.length < 20) {
        showDropStatus(file.name, 'No pude leer texto en la imagen');
        return;
      }
      importText.value = text;
      updateAnalyzeState();
      hideDropStatus();
      toast(`✓ Imagen procesada · ${fmtBytes(file.size)}`);
    })
    .catch(err => {
      console.error(err);
      showDropStatus(file.name, 'Error: ' + err.message);
    });
}

function showDropStatus(name, status) {
  if (!pdfDrop) return;
  pdfDrop.classList.add('is-processing');
  pdfDrop.innerHTML = `
    <div class="pdf-drop__spinner"></div>
    <strong>${escapeHtml(name)}</strong>
    <span>${escapeHtml(status)}</span>
  `;
}

function hideDropStatus() {
  if (!pdfDrop) return;
  pdfDrop.classList.remove('is-processing');
  pdfDrop.innerHTML = `
    <svg class="pdf-drop__icon"><use href="#i-file"/></svg>
    <strong>Arrastrá PDF o imagen</strong>
    <span>o <u>elegí un archivo</u> · reservas, capturas, boarding passes</span>
    <input type="file" id="dropInput" accept="application/pdf,.pdf,image/*" hidden />
    <input type="file" id="cameraInput" accept="image/*" capture="environment" hidden />
  `;
  rewireDropInputs();
}

function rewireDropInputs() {
  if (!pdfDrop) return;
  const input = pdfDrop.querySelector('#dropInput');
  if (!input) return;
  input.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) handleDroppedFile(f);
    e.target.value = '';
  });
}

if (pdfDrop) {
  pdfDrop.addEventListener('click', (e) => {
    if (e.target.closest('input[type="file"]')) return;
    pdfDrop.querySelector('#dropInput')?.click();
  });

  ['dragenter', 'dragover'].forEach(evt => {
    pdfDrop.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      pdfDrop.classList.add('is-dragover');
    });
  });
  ['dragleave', 'drop'].forEach(evt => {
    pdfDrop.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      pdfDrop.classList.remove('is-dragover');
    });
  });
  pdfDrop.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) handleDroppedFile(f);
  });

  rewireDropInputs();
}

if (cameraBtn) {
  cameraBtn.addEventListener('click', () => {
    const cam = pdfDrop?.querySelector('#cameraInput');
    if (cam) cam.click();
    else {
      const tmp = document.createElement('input');
      tmp.type = 'file';
      tmp.accept = 'image/*';
      tmp.capture = 'environment';
      tmp.addEventListener('change', (e) => {
        const f = e.target.files?.[0];
        if (f) handleDroppedFile(f);
      });
      tmp.click();
    }
  });
}

/* ============================================================
   Share Target
   ============================================================ */
(function handleShareTarget() {
  const params = new URLSearchParams(location.search);
  if (params.get('action') !== 'share-target') return;
  const shared = params.get('text') || params.get('url') || params.get('title') || '';
  if (shared) setTimeout(() => openImport(shared), 400);
  history.replaceState({}, '', location.pathname);
})();

window.addEventListener('message', (e) => {
  if (!e.data?.file) return;
  if (e.data.type !== 'pdf-shared' && e.data.type !== 'image-shared') return;
  openImport();
  setTimeout(() => handleDroppedFile(e.data.file), 300);
});

/* ============================================================
   SYNC P2P
   ============================================================ */
const shareModal = document.getElementById('shareModal');
const peersBadge = document.getElementById('peersBadge');
const peersList = document.getElementById('peersList');
const peersCount = document.getElementById('peersCount');
const shareLink = document.getElementById('shareLink');
const shareQr = document.getElementById('shareQr');
const shareStatus = document.getElementById('shareStatus');
const shareStatusText = document.getElementById('shareStatusText');

let qrLoaded = false;

async function startSync() {
  try {
    const tripId = trip?.id || 'default-trip';
    const { roomId } = await sync.initSync(tripId);

    sync.setLocalUser({ name: 'Vos', color: '#ff5c39' });

    sync.onRemoteChange(async () => {
      await applyRemoteState();
      await renderAll();
      toast('⟳ Actualizado desde otro dispositivo');
    });

    sync.onPeersChange((peers) => renderPeers(peers));

    await applyRemoteState();
    await renderAll();

    const url = new URL(location.href);
    url.searchParams.set('join', roomId);
    if (shareLink) shareLink.value = url.toString();

    updateSyncStatus();
    console.log('🔗 Sync activo · room:', roomId);
  } catch (err) {
    console.warn('Sync no disponible:', err);
    updateSyncStatus('error');
  }
}

async function applyRemoteState() {
  const remote = sync.getAllEvents();
  if (!remote.length) return;

  const local = await idbAll(STORE_EVENTS);
  const localById = new Map(local.map(e => [e.id, e]));

  for (const rEv of remote) {
    const lEv = localById.get(rEv.id);
    if (!lEv) {
      await idbPut(STORE_EVENTS, rEv);
    } else {
      const rT = rEv.updatedAt || 0;
      const lT = lEv.updatedAt || 0;
      if (rT > lT) await idbPut(STORE_EVENTS, rEv);
    }
  }
}

function renderPeers(peers) {
  const count = peers.length;
  if (peersCount) peersCount.textContent = count;
  if (peersBadge) {
    peersBadge.textContent = count;
    peersBadge.hidden = count === 0;
  }

  if (!peersList) return;
  if (!count) {
    peersList.innerHTML = `<li class="peers__empty">Nadie más conectado todavía</li>`;
    return;
  }
  peersList.innerHTML = peers.map(p => {
    const initial = (p.name || '?')[0].toUpperCase();
    return `
      <li class="peer">
        <div class="peer__avatar" style="background:${p.color}">${escapeHtml(initial)}</div>
        <span class="peer__name">${escapeHtml(p.name)}</span>
        <span class="peer__dot"></span>
      </li>
    `;
  }).join('');
}

function updateSyncStatus(mode = 'auto') {
  if (!shareStatus || !shareStatusText) return;
  const online = navigator.onLine;
  const connected = sync.isConnected();
  const peers = sync.getPeerCount();

  shareStatus.classList.remove('is-online', 'is-offline');

  if (mode === 'error') {
    shareStatus.classList.add('is-offline');
    shareStatusText.textContent = 'Sync no disponible. Revisá la conexión.';
    return;
  }
  if (!online) {
    shareStatus.classList.add('is-offline');
    shareStatusText.textContent = 'Sin internet · el link funcionará al volver';
    return;
  }
  if (connected) {
    shareStatus.classList.add('is-online');
    shareStatusText.textContent = peers > 0
      ? `${peers} ${peers === 1 ? 'dispositivo conectado' : 'dispositivos conectados'}`
      : 'Listo para compartir · esperando invitados';
  } else {
    shareStatus.classList.add('is-offline');
    shareStatusText.textContent = 'Conectando al relay…';
  }
}

window.addEventListener('online', () => updateSyncStatus());
window.addEventListener('offline', () => updateSyncStatus());

async function loadQrLib() {
  if (window.QRCode) return window.QRCode;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
    s.onload = () => resolve(window.QRCode);
    s.onerror = () => reject(new Error('QR lib no cargada'));
    document.head.appendChild(s);
  });
}

async function renderQr(text) {
  if (!shareQr) return;
  try {
    const QRCode = await loadQrLib();
    shareQr.innerHTML = '';
    const canvas = document.createElement('canvas');
    shareQr.appendChild(canvas);
    await QRCode.toCanvas(canvas, text, {
      width: 240, margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    });
    qrLoaded = true;
  } catch (err) {
    shareQr.innerHTML = `<div class="share__qr-placeholder">No se pudo generar el QR</div>`;
  }
}

function openShare() {
  if (!shareModal) return;
  shareModal.hidden = false;
  shareModal.setAttribute('aria-hidden', 'false');
  if (shareLink?.value && !qrLoaded) renderQr(shareLink.value);
  updateSyncStatus();
}

function closeShare() {
  if (!shareModal) return;
  shareModal.hidden = true;
  shareModal.setAttribute('aria-hidden', 'true');
}

shareModal?.addEventListener('click', (ev) => {
  if (ev.target.hasAttribute('data-share-close') ||
      ev.target.closest('[data-share-close]')) closeShare();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && shareModal && !shareModal.hidden) closeShare();
});

document.getElementById('shareBtn')?.addEventListener('click', openShare);

document.getElementById('shareCopy')?.addEventListener('click', async () => {
  if (!shareLink) return;
  try {
    await navigator.clipboard.writeText(shareLink.value);
    toast('Link copiado');
  } catch {
    shareLink.select();
    document.execCommand('copy');
    toast('Link copiado');
  }
});

document.getElementById('shareNativeBtn')?.addEventListener('click', async () => {
  if (!shareLink) return;
  const url = shareLink.value;
  const data = {
    title: 'OhMyGoch Trip OS · ' + trip.title,
    text: 'Sumate a nuestro viaje en OhMyGoch:',
    url,
  };
  if (navigator.share) {
    try { await navigator.share(data); } catch {}
  } else {
    try { await navigator.clipboard.writeText(url); toast('Link copiado'); }
    catch { shareLink.select(); document.execCommand('copy'); toast('Link copiado'); }
  }
});

(function handleJoin() {
  const params = new URLSearchParams(location.search);
  const join = params.get('join');
  if (!join) return;
  const m = join.match(/^ohmygoch-[a-z0-9]+-([a-z0-9]+)$/i);
  if (m && m[1]) localStorage.setItem('ohmygoch_sync_secret', m[1]);
  history.replaceState({}, '', location.pathname);
})();

/* ============================================================
   NOTIFICACIONES
   ============================================================ */
const notifModal = document.getElementById('notifModal');
const notifEnabled = document.getElementById('notifEnabled');
const notifGeo = document.getElementById('notifGeo');
const notifLeadChips = document.getElementById('notifLeadChips');
const notifRadiusChips = document.getElementById('notifRadiusChips');
const notifTimeGroup = document.getElementById('notifTimeGroup');
const notifGeoGroup = document.getElementById('notifGeoGroup');

function openNotifModal() {
  const s = notif.getSettings();
  notifEnabled.checked = s.enabled;
  notifGeo.checked = s.geofencing;
  notifTimeGroup.style.opacity = s.enabled ? '1' : '.4';
  notifGeoGroup.style.opacity = s.geofencing ? '1' : '.4';

  notifLeadChips.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('is-active', +c.dataset.lead === s.leadMin);
  });
  notifRadiusChips.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('is-active', +c.dataset.radius === s.geofenceRadius);
  });

  notifModal.hidden = false;
  notifModal.setAttribute('aria-hidden', 'false');
  updateNotifStatus();
}

function closeNotifModal() {
  notifModal.hidden = true;
  notifModal.setAttribute('aria-hidden', 'true');
}

async function updateNotifStatus() {
  const status = notif.getStatus();
  const dot = document.getElementById('notifPermDot');
  const txt = document.getElementById('notifPermText');
  dot.classList.remove('is-on', 'is-off', 'is-warn');

  if (status.notifPermission === 'granted') {
    dot.classList.add('is-on');
    const geoLabel = status.geolocation
      ? (status.geofencingActive ? ' · ubicación activa' : '') : ' · sin geolocalización';
    txt.textContent = `Notificaciones activas${geoLabel}`;
  } else if (status.notifPermission === 'denied') {
    dot.classList.add('is-off');
    txt.textContent = 'Notificaciones bloqueadas · revisá los permisos';
  } else if (status.notifPermission === 'unsupported') {
    dot.classList.add('is-warn');
    txt.textContent = 'Este navegador no soporta notificaciones';
  } else {
    dot.classList.add('is-warn');
    txt.textContent = 'Notificaciones no activadas todavía';
  }

  const b = document.getElementById('bellBtn');
  b.classList.toggle('iconbtn--notif-on', status.settings.enabled && status.notifPermission === 'granted');
}

notifModal.addEventListener('click', (ev) => {
  if (ev.target.hasAttribute('data-notif-close') ||
      ev.target.closest('[data-notif-close]')) closeNotifModal();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !notifModal.hidden) closeNotifModal();
});

notifEnabled.addEventListener('change', async () => {
  const on = notifEnabled.checked;
  if (on) {
    const ok = await notif.requestNotificationPermission();
    if (!ok) {
      notifEnabled.checked = false;
      toast('Permiso de notificaciones denegado');
      updateNotifStatus();
      return;
    }
  }
  notif.saveSettings({ enabled: on });
  notifTimeGroup.style.opacity = on ? '1' : '.4';
  notif.start(events);
  updateNotifStatus();
  renderTimeline();
  toast(on ? '🔔 Recordatorios activados' : 'Recordatorios desactivados');
});

notifGeo.addEventListener('change', async () => {
  const on = notifGeo.checked;
  if (on) {
    if (!('geolocation' in navigator)) {
      notifGeo.checked = false;
      toast('Sin soporte de geolocalización');
      return;
    }
    try {
      await new Promise((res, rej) => {
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000 });
      });
    } catch {
      notifGeo.checked = false;
      toast('Permiso de ubicación denegado');
      updateNotifStatus();
      return;
    }
  }
  notif.saveSettings({ geofencing: on });
  notifGeoGroup.style.opacity = on ? '1' : '.4';
  notif.start(events);
  updateNotifStatus();
  toast(on ? '📍 Alertas por ubicación activadas' : 'Alertas por ubicación desactivadas');
});

notifLeadChips.addEventListener('click', (ev) => {
  const chip = ev.target.closest('.chip');
  if (!chip) return;
  const lead = +chip.dataset.lead;
  notif.saveSettings({ leadMin: lead });
  notifLeadChips.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('is-active', +c.dataset.lead === lead);
  });
  notif.start(events);
  renderTimeline();
  toast(`Avisar ${lead} min antes`);
});

notifRadiusChips.addEventListener('click', (ev) => {
  const chip = ev.target.closest('.chip');
  if (!chip) return;
  const radius = +chip.dataset.radius;
  notif.saveSettings({ geofenceRadius: radius });
  notifRadiusChips.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('is-active', +c.dataset.radius === radius);
  });
  toast(`Radio ${radius} m`);
});

document.getElementById('notifTestBtn').addEventListener('click', async () => {
  const ok = await notif.sendTestNotification();
  if (ok) toast('Notificación enviada');
  else toast('No se pudo enviar · revisá permisos');
  updateNotifStatus();
});

document.getElementById('bellBtn').addEventListener('click', openNotifModal);

navigator.serviceWorker?.addEventListener('message', (ev) => {
  if (ev.data?.type === 'notification-click' && ev.data.eventId) {
    const evt = events.find(x => x.id === ev.data.eventId);
    if (evt) {
      closeNotifModal();
      setView('today');
      openModal(evt.id);
    }
  }
});

/* ============================================================
   MODO DÍA ACTIVO
   ============================================================ */
daymode.setEventProvider(() => events);
daymode.setOnEventDone(async (id) => {
  await toggleDone(id);
});

document.getElementById('daymodeBtn')?.addEventListener('click', () => {
  daymode.enterDayMode();
});

document.getElementById('daymodeClose')?.addEventListener('click', () => {
  daymode.exitDayMode();
});

document.getElementById('daymodeDoneBtn')?.addEventListener('click', async () => {
  await daymode.actionDone();
  toast('✓ Hecho · siguiente');
});

document.getElementById('daymodeSkipBtn')?.addEventListener('click', () => {
  daymode.actionSkip();
});

document.getElementById('daymodeNavBtn')?.addEventListener('click', async () => {
  const res = await daymode.actionNavigate();
  if (res && !res.ok && res.reason === 'sin-ubicacion') {
    toast('Sin ubicación para este evento');
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && daymode.isDayModeActive()) {
    daymode.exitDayMode();
  }
});

/* ============================================================
   PWA · Service Worker
   ============================================================ */
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

/* ============================================================
   PWA · Install
   ============================================================ */
let deferredPrompt = null;
const installBanner = document.getElementById('installBanner');
const installBtn = document.getElementById('installBtn');
const installClose = document.getElementById('installClose');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (!localStorage.getItem('ohmygoch_install_dismissed')) {
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
  localStorage.setItem('ohmygoch_install_dismissed', '1');
});

window.addEventListener('appinstalled', () => {
  installBanner.hidden = true;
  toast('OhMyGoch instalada en tu dispositivo');
});

/* ============================================================
   PWA · Online/Offline
   ============================================================ */
const offlineBanner = document.getElementById('offlineBanner');
function updateOnlineStatus() {
  offlineBanner.hidden = navigator.onLine;
  document.documentElement.dataset.online = navigator.onLine ? '1' : '0';
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

/* ============================================================
   Refrescar subsistemas
   ============================================================ */
const _originalRenderAll = renderAll;
renderAll = async function() {
  await _originalRenderAll();
  notif.refreshEvents(events);
  daymode.refresh();
};

/* ============================================================
   BOOT
   ============================================================ */
const IS_DEV =
  location.hostname === 'localhost' ||
  location.hostname === '127.0.0.1' ||
  location.hostname === '0.0.0.0' ||
  location.protocol === 'file:';

(async function boot() {
  buildChips();
  buildProviderChips();
  buildPeChips();
  await ensureSeed();
  await renderAll();
  updateOnlineStatus();
  await startSync();

  notif.loadSettings();
  notif.refreshEvents(events);
  if (notif.getSettings().enabled) {
    notif.start(events);
  }

  await renderWallet();

  if (IS_DEV) {
    console.log('🛠️  Modo DEV · Service Worker desactivado');
  } else {
    registerSW();
  }
})();