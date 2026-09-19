/* ============================================================
   OhMyGoch Trip OS · app.js
   Multi-viaje + Import Mágico + Sync + Notif + Wallet + Día Activo
   ============================================================ */

import { analyze, analyzeMulti, PROVIDERS, EXAMPLES } from './parser.js';
import { extractTextFromPdf, isPdfFile, fmtBytes } from './pdf-import.js';
import { extractTextFromImage, isImageFile } from './ocr-import.js';
import * as trips from './trips.js';
import * as sync from './sync.js';
import * as notif from './notifications.js';
import * as daymode from './daymode.js';
import * as wallet from './wallet.js';

/* ============================================================
   CONSTANTES
   ============================================================ */
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

const EMOJIS = [
  '🌍','🇦🇷','🇪🇸','🇺🇸','🇧🇷','🇲🇽','🇨🇱','🇨🇴',
  '🇵🇪','🇺🇾','🇫🇷','🇮🇹','🇩🇪','🇬🇧','🇵🇹','🇯🇵',
  '🇨🇳','🇰🇷','🇹🇭','🇮🇳','🇦🇺','🇳🇿','🇿🇦','🇪🇬',
  '🇲🇦','🇹🇷','🇬🇷','🇨🇦','🇳🇱','🇧🇪','🇨🇭','🇦🇹',
];

/* ============================================================
   ESTADO
   ============================================================ */
let events = [];
let trip = null;

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

function fmtDateShort(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
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

function computeDayNumber() {
  if (!trip?.startDate) return null;
  const start = new Date(trip.startDate);
  const now = new Date();
  const diff = Math.floor((now - start) / (24 * 60 * 60 * 1000)) + 1;
  if (diff < 1 || (trip.days && diff > trip.days)) return null;
  return diff;
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
   CARGA
   ============================================================ */
async function loadAll() {
  const active = await trips.getActiveTrip();
  trip = active || { id: 'default', title: 'Mi viaje', flag: '🌍', days: 0, travelers: 1 };
  events = await trips.getTripEvents(trip.id);
}

/* ============================================================
   RENDER
   ============================================================ */
function renderTrip() {
  const flagEmoji = document.getElementById('tripFlagEmoji');
  const titleEl = document.getElementById('tripTitle');
  const heroName = document.getElementById('heroTripName');
  const heroDay = document.getElementById('heroDay');
  const heroDate = document.getElementById('heroDate');
  const heroDays = document.getElementById('heroDays');
  const heroTravelers = document.getElementById('heroTravelers');

  const tripTitle = trip?.title || 'Mi viaje';
  const tripFlag = trip?.flag || '🌍';

  if (flagEmoji) flagEmoji.textContent = tripFlag;
  if (titleEl) titleEl.textContent = tripTitle;
  if (heroName) heroName.textContent = tripTitle;

  const dayNum = computeDayNumber();
  if (heroDay) {
    if (dayNum && trip?.days) heroDay.textContent = `Día ${dayNum} de ${trip.days}`;
    else if (trip?.startDate && trip?.days) heroDay.textContent = `${trip.days} días`;
    else heroDay.textContent = 'Tu viaje';
  }

  if (heroDate) {
    if (trip?.startDate && trip?.endDate) {
      heroDate.textContent = `${fmtDateShort(trip.startDate)} → ${fmtDateShort(trip.endDate)}`;
    } else {
      heroDate.textContent = fmtDateShort(new Date().toISOString());
    }
  }

  if (heroDays) {
    heroDays.textContent = trip?.days
      ? `${trip.days} día${trip.days > 1 ? 's' : ''}`
      : 'Sin fechas';
  }

  if (heroTravelers) {
    heroTravelers.textContent = trip?.travelers
      ? `${trip.travelers} viajero${trip.travelers > 1 ? 's' : ''}`
      : 'Sin viajeros';
  }

  const today = events.filter(e => isToday(e.startAt));
  const done = today.filter(e => e.done).length;
  const pct = today.length ? Math.round((done / today.length) * 100) : 0;
  const progressEl = document.getElementById('heroProgress');
  if (progressEl) progressEl.style.width = pct + '%';
}

function renderNext() {
  const n = computeNext();
  const card = document.getElementById('nextCard');
  if (!card) return;
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
  const emptyTitle = document.getElementById('emptyTitle');
  const emptyDesc = document.getElementById('emptyDesc');
  if (!ol || !empty) return;

  if (!events.length) {
    ol.innerHTML = '';
    empty.hidden = false;

    // ✅ FIX: fallback seguro si trip o trip.title no está disponible
    const tripName = trip?.title || 'tu viaje';
    if (emptyTitle) emptyTitle.textContent = `Sin eventos en "${tripName}"`;
    if (emptyDesc) emptyDesc.innerHTML = `Tocá <strong>+</strong> para agregar un evento, o <strong>📥</strong> para importar tu reserva.`;
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
  await trips.idbPut(trips.STORES.EVENTS, e);
  sync.setEvent(e);
  await renderAll();
  toast(e.done ? '✓ Marcado como hecho' : 'Marcado como pendiente');
}

async function saveEvent(ev) {
  ev.tripId = trip?.id;
  ev.updatedAt = Date.now();
  await trips.idbPut(trips.STORES.EVENTS, ev);
  sync.setEvent(ev);
  await renderAll();
}

async function deleteEvent(id) {
  try {
    const files = await wallet.getFilesByEvent(id);
    for (const f of files) await wallet.deleteFile(f.id);
  } catch {}
  await trips.idbDelete(trips.STORES.EVENTS, id);
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
    await trips.idbDelete(trips.STORES.EVENTS, e.id);
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

  list.querySelectorAll('[data-cat-idx]').forEach(sel => {
    sel.addEventListener('change', (ev) => {
      const idx = +sel.dataset.catIdx;
      const item = editingAttachments[idx];
      if (!item) return;
      item.category = sel.value;
      if (!item.isNew && item.id) {
        wallet.updateFile(item.id, { category: sel.value }).catch(() => {});
      }
    });
  });

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
    tripId: trip?.id,
    type: currentType,
    title: document.getElementById('fTitle').value.trim(),
    startAt: fromLocalInput(document.getElementById('fStart').value),
    place: document.getElementById('fPlace').value.trim(),
    notes: document.getElementById('fNotes').value.trim(),
    done: exists?.done || false,
    updatedAt: Date.now(),
  };
  await saveEvent(payload);

  for (const a of editingAttachments) {
    if (a.isNew && a.file) {
      try {
        await wallet.saveFile(a.file, {
          tripId: trip?.id,
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
  const vp = document.getElementById('viewport');
  if (vp) vp.scrollTo({ top: 0, behavior: 'smooth' });

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
    const icon = p.textContent.trim();
    const sheetIcon = document.getElementById('sheetIcon');
    const sheetTitle = document.getElementById('sheetTitle');
    const sheetMeta = document.getElementById('sheetMeta');
    if (sheetIcon) sheetIcon.textContent = icon;
    if (sheetTitle) sheetTitle.textContent = p.dataset.label;
    if (sheetMeta) sheetMeta.textContent = 'Seleccionado · cerca de ti';
  });
});

/* ============================================================
   FAB
   ============================================================ */
document.getElementById('fab').addEventListener('click', () => openModal());
document.getElementById('clearDoneBtn').addEventListener('click', clearDone);

/* ============================================================
   TOAST
   ============================================================ */
let toastTimer;
function toast(msg) {
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

/* ============================================================
   WALLET
   ============================================================ */
let walletFilter = 'all';
let walletFilesCache = [];
let walletObjectUrls = [];
let wcatPending = [];
let wcatSelected = 'boarding';

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
    walletFilesCache = await wallet.getAllFiles(trip?.id);
  } catch (err) {
    console.error('Wallet load error:', err);
    walletFilesCache = [];
  }

  const count = walletFilesCache.length;
  const totalBytes = walletFilesCache.reduce((s, f) => s + (f.size || 0), 0);
  if (walletStats) {
    walletStats.textContent = count ? `${count} · ${wallet.fmtBytes(totalBytes)}` : 'Vacío';
  }

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

walletFilters.addEventListener('click', (ev) => {
  const chip = ev.target.closest('.chip');
  if (!chip) return;
  walletFilter = chip.dataset.cat;
  walletFilters.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('is-active', c.dataset.cat === walletFilter);
  });
  renderWallet();
});

document.getElementById('walletUploadBtn').addEventListener('click', () => {
  document.getElementById('walletUploadInput').click();
});

document.getElementById('walletUploadInput').addEventListener('change', async (e) => {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (!files.length) return;

  const valid = files.filter(f => {
    if (f.size > 15 * 1024 * 1024) { toast(`${f.name} · más de 15MB`); return false; }
    return true;
  });
  if (!valid.length) return;

  wcatPending = valid;
  wcatSelected = guessCategory(valid[0], null);
  openWalletCatModal();
});

function buildWcatGrid() {
  const cats = wallet.getCategories();
  wcatGrid.innerHTML = Object.entries(cats).map(([k, v]) => `
    <button type="button" class="wcat__item" data-cat="${k}" style="--wcat-c:${v.color}">
      <span class="wcat__item-check">✓</span>
      <span class="wcat__item-icon">${v.icon}</span>
      <span>${v.label}</span>
    </button>
  `).join('');

  wcatGrid.querySelectorAll('.wcat__item').forEach(b => {
    b.classList.toggle('is-active', b.dataset.cat === wcatSelected);
  });
}

wcatGrid.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.wcat__item');
  if (!btn) return;
  wcatSelected = btn.dataset.cat;
  wcatGrid.querySelectorAll('.wcat__item').forEach(b => {
    b.classList.toggle('is-active', b.dataset.cat === wcatSelected);
  });
});

function openWalletCatModal() {
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
      await wallet.saveFile(f, { tripId: trip?.id, category: wcatSelected });
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
        await trips.idbDelete(trips.STORES.EVENTS, dup.id);
        sync.deleteEventSync(dup.id);
        replaced++;
      }
    }

    await saveEvent({
      id: uid(),
      tripId: trip?.id,
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
    if (!trip?.id) return;

    try { sync.destroySync(); } catch {}

    const { roomId } = await sync.initSync(trip.id);

    sync.setLocalUser({ name: 'Vos', color: '#ff5c39' });

    // Publicar meta del viaje
    sync.setTripMeta({
      title: trip.title,
      flag: trip.flag,
      startDate: trip.startDate,
      endDate: trip.endDate,
      travelers: trip.travelers,
      currency: trip.currency,
      timezone: trip.timezone,
    });

    // Eventos remotos
    sync.onRemoteChange(async () => {
      await applyRemoteState();
      await renderAll();
      await renderWallet();
      toast('⟳ Actualizado desde otro dispositivo');
    });

    // Meta del viaje remota
    sync.onTripMetaChange(async (meta) => {
      if (!meta || !meta.title) return;

      const needsUpdate =
        meta.title !== trip.title ||
        meta.flag !== trip.flag ||
        meta.startDate !== trip.startDate ||
        meta.endDate !== trip.endDate;

      if (!needsUpdate) return;

      console.log('📥 Meta del viaje recibida:', meta);

      trip = await trips.updateTrip(trip.id, {
        title: meta.title,
        flag: meta.flag,
        startDate: meta.startDate || trip.startDate,
        endDate: meta.endDate || trip.endDate,
        travelers: meta.travelers || trip.travelers,
        currency: meta.currency || trip.currency,
        timezone: meta.timezone || trip.timezone,
      });

      renderTrip();
      toast(`✓ Viaje actualizado: ${meta.title}`);
    });

    sync.onPeersChange((peers) => renderPeers(peers));

    await applyRemoteState();
    await renderAll();

    // Link: tripId~secret (¡importante el formato!)
    const url = new URL(location.href);
    url.searchParams.set('join', `${trip.id}~${sync.getSecret(trip.id)}`);
    if (shareLink) shareLink.value = url.toString();

    qrLoaded = false;
    updateSyncStatus();
    console.log('🔗 Sync activo · room:', roomId, '· viaje:', trip.title, '(' + trip.id + ')');
  } catch (err) {
    console.warn('Sync no disponible:', err);
    updateSyncStatus('error');
  }
}

async function applyRemoteState() {
  const remote = sync.getAllEvents();
  if (!remote.length) return;

  const remoteFiltered = remote.filter(ev => !ev.tripId || ev.tripId === trip.id);
  if (!remoteFiltered.length) return;

  const local = await trips.getTripEvents(trip.id);
  const localById = new Map(local.map(e => [e.id, e]));

  for (const rEv of remoteFiltered) {
    if (!rEv.tripId) rEv.tripId = trip.id;
    const lEv = localById.get(rEv.id);
    if (!lEv) {
      await trips.idbPut(trips.STORES.EVENTS, rEv);
    } else {
      const rT = rEv.updatedAt || 0;
      const lT = lEv.updatedAt || 0;
      if (rT > lT) await trips.idbPut(trips.STORES.EVENTS, rEv);
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

/* ---------- QR generator · qrcodejs + fallback API ---------- */
const QR_CDNS = [
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
];

let qrLibLoading = null;

async function loadQrLib() {
  if (window.QRCode) return window.QRCode;
  if (qrLibLoading) return qrLibLoading;

  qrLibLoading = new Promise(async (resolve, reject) => {
    for (const url of QR_CDNS) {
      try {
        const ok = await tryLoadScript(url);
        if (ok && window.QRCode) {
          console.log('✅ QR lib cargada desde:', url);
          return resolve(window.QRCode);
        }
      } catch (err) {
        console.warn('⚠️ Falló CDN:', url, err.message);
      }
    }
    reject(new Error('Todos los CDNs fallaron'));
  });

  return qrLibLoading;
}

function tryLoadScript(url) {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    const timer = setTimeout(() => {
      s.remove();
      resolve(false);
    }, 5000);
    s.onload = () => { clearTimeout(timer); resolve(true); };
    s.onerror = () => { clearTimeout(timer); s.remove(); resolve(false); };
    document.head.appendChild(s);
  });
}

async function renderQr(text) {
  if (!shareQr) return;
  if (!text) {
    shareQr.innerHTML = `<div class="share__qr-placeholder">Sin link todavía</div>`;
    return;
  }

  shareQr.innerHTML = `<div class="share__qr-placeholder">Generando QR…</div>`;

  // ---------- Intento 1 · qrcodejs ----------
  try {
    const QRCode = await loadQrLib();
    shareQr.innerHTML = '';
    qrLoaded = true;

    new QRCode(shareQr, {
      text,
      width: 240,
      height: 240,
      colorDark: '#0f172a',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel?.M ?? 0,
    });

    const el = shareQr.querySelector('canvas, img');
    if (el) {
      el.style.width = '100%';
      el.style.height = '100%';
      el.style.display = 'block';
      el.style.imageRendering = 'pixelated';
    }

    console.log('✅ QR generado con qrcodejs');
    return;
  } catch (err) {
    console.warn('⚠️ qrcodejs falló:', err.message);
  }

  // ---------- Intento 2 · API externa ----------
  try {
    const apiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(text)}`;
    shareQr.innerHTML = '';

    const img = document.createElement('img');
    img.alt = 'QR del viaje';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.display = 'block';
    img.style.imageRendering = 'pixelated';

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('API QR no respondió'));
      img.src = apiUrl;
      setTimeout(() => reject(new Error('Timeout')), 8000);
    });

    shareQr.appendChild(img);
    qrLoaded = true;
    console.log('✅ QR generado con API externa');
    return;
  } catch (err) {
    console.warn('⚠️ API externa falló:', err.message);
  }

  // ---------- Fallback final ----------
  shareQr.innerHTML = `
    <div class="share__qr-placeholder">
      <div style="font-size:42px;margin-bottom:8px">📱</div>
      <div style="font-weight:700;color:var(--text);margin-bottom:4px">QR no disponible</div>
      <div style="font-size:11px;line-height:1.4">
        Copiá el link de abajo y<br>compartilo manualmente
      </div>
    </div>
  `;
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
document.getElementById('groupInviteBtn')?.addEventListener('click', openShare);

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
    title: 'OhMyGoch Trip OS · ' + (trip?.title || ''),
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

/* ============================================================
   HANDLE JOIN · ¡CRÍTICO para compartir viajes!
   ============================================================ */
async function handleJoin() {
  const params = new URLSearchParams(location.search);
  const join = params.get('join');
  if (!join) return false;

  console.log('🔗 Join detectado · parámetro:', join);

  // Formato: tripId~secret
  const parts = join.split('~');
  if (parts.length !== 2) {
    console.warn('🔗 Formato desconocido:', join);
    history.replaceState({}, '', location.pathname);
    return false;
  }

  const [joinTripId, secret] = parts;
  if (!joinTripId || !secret) {
    history.replaceState({}, '', location.pathname);
    return false;
  }

  // Guardar el secret para este viaje
  localStorage.setItem(`ohmygoch_secret_${joinTripId}`, secret);

  // ¿Existe el viaje localmente?
  const existing = await trips.getTrip(joinTripId);

  // Crear el viaje O REPARARLO si está corrupto (sin title)
  if (!existing || !existing.title) {
    await trips.idbPut(trips.STORES.TRIPS, {
      id: joinTripId,
      title: existing?.title || 'Viaje compartido',
      flag: existing?.flag || '🌍',
      startDate: existing?.startDate || null,
      endDate: existing?.endDate || null,
      days: existing?.days || 0,
      travelers: existing?.travelers || 1,
      currency: existing?.currency || 'EUR',
      timezone: existing?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
    });
    console.log('✨ Viaje placeholder creado/reparado:', joinTripId);
  } else {
    console.log('📚 Viaje ya existía localmente:', existing.title);
  }

  // Activar este viaje
  await trips.setActiveTrip(joinTripId);
  console.log('✅ Viaje activado:', joinTripId);

  history.replaceState({}, '', location.pathname);
  return true;
}

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
   MULTI-VIAJE
   ============================================================ */
const tripsListModal = document.getElementById('tripsListModal');
const tripsList = document.getElementById('tripsList');
const tripsNewBtn = document.getElementById('tripsNewBtn');

const tripCreateModal = document.getElementById('tripCreateModal');
const tripCreateForm = document.getElementById('tripCreateForm');
const emojiPicker = document.getElementById('emojiPicker');

const tripActionsModal = document.getElementById('tripActionsModal');
const tripActionsTitle = document.getElementById('tripActionsTitle');

const tripRenameModal = document.getElementById('tripRenameModal');
const tripRenameForm = document.getElementById('tripRenameForm');

let currentEmoji = '🌍';
let tcTravelers = 1;
let tripActionsTargetId = null;
let tripRenameTargetId = null;

async function renderTripsList() {
  const list = await trips.listTrips();
  if (!list.length) {
    tripsList.innerHTML = `<p style="text-align:center;color:var(--muted);font-size:13px;padding:20px">No hay viajes</p>`;
    return;
  }

  const active = await trips.getActiveTrip();

  tripsList.innerHTML = list.map(t => {
    const isActive = active?.id === t.id;
    const dateRange = (t.startDate && t.endDate)
      ? `${fmtDateShort(t.startDate)} → ${fmtDateShort(t.endDate)} · `
      : '';
    const daysLabel = t.days ? `${t.days} día${t.days > 1 ? 's' : ''}` : 'Sin fechas';

    return `
      <div class="trip-item ${isActive ? 'is-active' : ''}" data-trip-id="${t.id}" role="button" tabindex="0">
        <div class="trip-item__flag">${t.flag || '🌍'}</div>
        <div class="trip-item__body">
          <p class="trip-item__title">${escapeHtml(t.title || 'Sin nombre')}</p>
          <p class="trip-item__meta">${dateRange}${daysLabel}</p>
        </div>
        ${isActive
          ? '<div class="trip-item__check"><svg><use href="#i-check"/></svg></div>'
          : `<button type="button" class="trip-item__more" data-trip-more="${t.id}" aria-label="Opciones">
              <svg><use href="#i-more"/></svg>
             </button>`}
      </div>
    `;
  }).join('');

  tripsList.querySelectorAll('[data-trip-id]').forEach(el => {
    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-trip-more]')) return;
      const id = el.dataset.tripId;
      closeTripsListModal();
      await switchTrip(id);
    });
  });

  tripsList.querySelectorAll('[data-trip-more]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.tripMore;
      closeTripsListModal();
      openTripActions(id);
    });
  });
}

function openTripsListModal() {
  renderTripsList();
  tripsListModal.hidden = false;
  tripsListModal.setAttribute('aria-hidden', 'false');
}
function closeTripsListModal() {
  tripsListModal.hidden = true;
  tripsListModal.setAttribute('aria-hidden', 'true');
}

tripsListModal.addEventListener('click', (ev) => {
  if (ev.target.hasAttribute('data-trips-close') ||
      ev.target.closest('[data-trips-close]')) closeTripsListModal();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !tripsListModal.hidden) closeTripsListModal();
});

document.getElementById('tripSelector')?.addEventListener('click', openTripsListModal);

function buildEmojiPicker() {
  emojiPicker.innerHTML = EMOJIS.map(e => `
    <button type="button" class="emoji-opt" data-emoji="${e}">${e}</button>
  `).join('') + `
    <button type="button" class="emoji-opt emoji-other" data-emoji="__OTHER__">+</button>
  `;

  emojiPicker.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.emoji-opt');
    if (!btn) return;
    let val = btn.dataset.emoji;
    if (val === '__OTHER__') {
      const custom = prompt('Pegá un emoji (o varios):');
      if (!custom) return;
      val = custom.slice(0, 4);
    }
    currentEmoji = val;
    emojiPicker.querySelectorAll('.emoji-opt').forEach(b => {
      b.classList.toggle('is-active', b.dataset.emoji === currentEmoji);
    });
  });

  emojiPicker.querySelectorAll('.emoji-opt').forEach(b => {
    b.classList.toggle('is-active', b.dataset.emoji === currentEmoji);
  });
}

function openTripCreateModal() {
  currentEmoji = '🌍';
  tcTravelers = 1;
  document.getElementById('tcTitle').value = '';
  document.getElementById('tcStart').value = '';
  document.getElementById('tcEnd').value = '';
  document.getElementById('tcCurrency').value = 'EUR';
  document.getElementById('tcClone').checked = false;

  const cloneRow = document.getElementById('tcCloneRow');
  cloneRow.hidden = !events.length;

  document.querySelectorAll('#tcTravelers .chip').forEach(c => {
    c.classList.toggle('is-active', +c.dataset.n === tcTravelers);
  });

  buildEmojiPicker();

  tripCreateModal.hidden = false;
  tripCreateModal.setAttribute('aria-hidden', 'false');
  setTimeout(() => document.getElementById('tcTitle').focus(), 150);
}

function closeTripCreateModal() {
  tripCreateModal.hidden = true;
  tripCreateModal.setAttribute('aria-hidden', 'true');
}

tripCreateModal.addEventListener('click', (ev) => {
  if (ev.target.hasAttribute('data-trip-create-close') ||
      ev.target.closest('[data-trip-create-close]')) closeTripCreateModal();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !tripCreateModal.hidden) closeTripCreateModal();
});

document.getElementById('tcTravelers').addEventListener('click', (ev) => {
  const chip = ev.target.closest('.chip');
  if (!chip) return;
  tcTravelers = chip.dataset.n === '5' ? 5 : +chip.dataset.n;
  document.querySelectorAll('#tcTravelers .chip').forEach(c => {
    c.classList.toggle('is-active', c === chip);
  });
});

tripsNewBtn.addEventListener('click', () => {
  closeTripsListModal();
  setTimeout(openTripCreateModal, 200);
});

tripCreateForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const title = document.getElementById('tcTitle').value.trim();
  if (!title) return;

  const data = {
    title,
    flag: currentEmoji,
    startDate: document.getElementById('tcStart').value || null,
    endDate: document.getElementById('tcEnd').value || null,
    travelers: tcTravelers,
    currency: document.getElementById('tcCurrency').value,
  };

  const clone = document.getElementById('tcClone').checked;
  const currentEvents = clone && trip?.id ? events.slice() : [];

  const newTrip = await trips.createTrip(data);

  if (currentEvents.length) {
    for (const ev of currentEvents) {
      const cloned = {
        ...ev,
        id: uid(),
        tripId: newTrip.id,
        done: false,
        updatedAt: Date.now(),
      };
      await trips.idbPut(trips.STORES.EVENTS, cloned);
    }
    toast(`Viaje creado · ${currentEvents.length} evento${currentEvents.length > 1 ? 's' : ''} copiado${currentEvents.length > 1 ? 's' : ''}`);
  } else {
    toast('Viaje creado');
  }

  closeTripCreateModal();
  await switchTrip(newTrip.id);
  setView('today');
});

async function switchTrip(newTripId) {
  if (newTripId === trip?.id) return;

  console.log('🔄 Cambiando a viaje:', newTripId);

  try { sync.destroySync(); } catch {}
  await trips.setActiveTrip(newTripId);
  await loadAll();

  renderTrip();
  renderNext();
  renderTimeline();
  await renderWallet();

  notif.refreshEvents(events);
  if (notif.getSettings().enabled) {
    notif.start(events);
  }

  if (daymode.isDayModeActive()) {
    daymode.refresh();
  }

  await startSync();
}

function openTripActions(tripId) {
  tripActionsTargetId = tripId;
  trips.getTrip(tripId).then(t => {
    if (t) tripActionsTitle.textContent = t.title;
  });
  tripActionsModal.hidden = false;
  tripActionsModal.setAttribute('aria-hidden', 'false');
}

function closeTripActions() {
  tripActionsModal.hidden = true;
  tripActionsModal.setAttribute('aria-hidden', 'true');
  tripActionsTargetId = null;
}

tripActionsModal.addEventListener('click', (ev) => {
  if (ev.target.hasAttribute('data-trip-actions-close') ||
      ev.target.closest('[data-trip-actions-close]')) closeTripActions();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !tripActionsModal.hidden) closeTripActions();
});

document.getElementById('taRename').addEventListener('click', async () => {
  const id = tripActionsTargetId;
  if (!id) return;
  const t = await trips.getTrip(id);
  closeTripActions();
  if (!t) return;
  tripRenameTargetId = id;
  document.getElementById('trTitle').value = t.title;
  tripRenameModal.hidden = false;
  tripRenameModal.setAttribute('aria-hidden', 'false');
  setTimeout(() => document.getElementById('trTitle').focus(), 150);
});

document.getElementById('taDuplicate').addEventListener('click', async () => {
  const id = tripActionsTargetId;
  if (!id) return;
  const source = await trips.getTrip(id);
  closeTripActions();
  if (!source) return;

  const cloned = await trips.createTrip({
    title: source.title + ' (copia)',
    flag: source.flag,
    startDate: source.startDate,
    endDate: source.endDate,
    travelers: source.travelers,
    currency: source.currency,
  });

  const sourceEvents = await trips.getTripEvents(id);
  for (const ev of sourceEvents) {
    const newEv = {
      ...ev,
      id: uid(),
      tripId: cloned.id,
      done: false,
      updatedAt: Date.now(),
    };
    await trips.idbPut(trips.STORES.EVENTS, newEv);
  }

  toast(`Viaje duplicado · ${sourceEvents.length} evento${sourceEvents.length > 1 ? 's' : ''}`);
  await switchTrip(cloned.id);
});

document.getElementById('taDelete').addEventListener('click', async () => {
  const id = tripActionsTargetId;
  if (!id) return;
  closeTripActions();

  const t = await trips.getTrip(id);
  if (!t) return;

  const counts = await trips.countTripData(id);
  const hasData = counts.events > 0 || counts.files > 0;

  const msg = hasData
    ? `"${t.title}" tiene ${counts.events} evento(s) y ${counts.files} archivo(s).\n\n¿Eliminar definitivamente? Esta acción no se puede deshacer.`
    : `¿Eliminar "${t.title}"?`;

  if (!confirm(msg)) return;
  if (hasData && !confirm('Última confirmación: se van a borrar todos los datos del viaje.')) return;

  const wasActive = trip?.id === id;
  if (wasActive) {
    try { sync.destroySync(); } catch {}
  }

  await trips.deleteTrip(id);

  if (wasActive) {
    await loadAll();
    renderTrip();
    renderNext();
    renderTimeline();
    await renderWallet();
    notif.refreshEvents(events);
    if (notif.getSettings().enabled) notif.start(events);
    await startSync();
  }

  toast('Viaje eliminado');
  await renderTripsList();
});

function closeTripRename() {
  tripRenameModal.hidden = true;
  tripRenameModal.setAttribute('aria-hidden', 'true');
  tripRenameTargetId = null;
}

tripRenameModal.addEventListener('click', (ev) => {
  if (ev.target.hasAttribute('data-trip-rename-close') ||
      ev.target.closest('[data-trip-rename-close]')) closeTripRename();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !tripRenameModal.hidden) closeTripRename();
});

tripRenameForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const id = tripRenameTargetId;
  if (!id) return;
  const title = document.getElementById('trTitle').value.trim();
  if (!title) return;

  await trips.updateTrip(id, { title });

  if (trip?.id === id) {
    trip = await trips.getActiveTrip();
    renderTrip();
    // Re-publicar meta a los peers
    try { sync.setTripMeta({ title: trip.title, flag: trip.flag }); } catch {}
  }

  closeTripRename();
  toast('Viaje renombrado');
  await renderTripsList();
});

document.getElementById('emptyImportBtn')?.addEventListener('click', () => openImport());
document.getElementById('emptyCreateBtn')?.addEventListener('click', () => openModal());

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
   PWA · Install · detección robusta (MIUI-safe)
   ============================================================ */
let deferredPrompt = null;
const installBanner = document.getElementById('installBanner');
const installBtn = document.getElementById('installBtn');
const installClose = document.getElementById('installClose');

function isPWAInstalled() {
  try {
    // Flag persistente (lo seteamos cuando el user instaló o cuando detectamos el modo app)
    if (localStorage.getItem('ohmygoch_installed') === '1') return true;

    // Media queries estándar
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
    if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;

    // iOS
    if (window.navigator.standalone === true) return true;

    // Android PWA launch (referrer especial)
    if (document.referrer && document.referrer.startsWith('android-app://')) return true;

    // WebView standalone
    if (window.self !== window.top) return true;

    return false;
  } catch {
    return false;
  }
}

function markInstalled() {
  localStorage.setItem('ohmygoch_installed', '1');
  installBanner.hidden = true;
  document.body.classList.add('is-standalone');
}

function applyStandaloneClass() {
  const on = isPWAInstalled();
  document.body.classList.toggle('is-standalone', on);
  if (on) installBanner.hidden = true;
  return on;
}

// Chequeo agresivo al inicio · si estamos en modo app, marcamos
if (isPWAInstalled()) markInstalled();

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();

  // Ya está instalada → nunca mostrar banner
  if (isPWAInstalled()) {
    deferredPrompt = null;
    installBanner.hidden = true;
    return;
  }

  // El user ya descartó el banner
  if (localStorage.getItem('ohmygoch_install_dismissed') === '1') {
    deferredPrompt = null;
    return;
  }

  deferredPrompt = e;
  installBanner.hidden = false;
});

installBtn?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  try {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      markInstalled();
      toast('¡Instalada! 🎉');
    }
  } catch {}
  deferredPrompt = null;
  installBanner.hidden = true;
});

installClose?.addEventListener('click', () => {
  installBanner.hidden = true;
  localStorage.setItem('ohmygoch_install_dismissed', '1');
});

window.addEventListener('appinstalled', () => {
  markInstalled();
  toast('OhMyGoch instalada');
});

/* ---------- Detección de cambios de display-mode ---------- */
try {
  const mq = window.matchMedia('(display-mode: standalone)');
  mq.addEventListener?.('change', () => {
    if (isPWAInstalled()) {
      markInstalled();
      toast('✓ Modo app activado');
    }
  });
} catch {}

/* ============================================================
   PWA · Online/Offline · detección robusta
   navigator.onLine en Android da falsos negativos → ping real
   ============================================================ */
const offlineBanner = document.getElementById('offlineBanner');
let onlineCheckTimer = null;
let confirmOfflineTimer = null;
let isConfirmedOffline = false;

async function pingReal() {
  try {
    // Endpoint liviano + cache-busting
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 4000);
    await fetch(`https://api.qrserver.com/v1/create-qr-code/?size=10x10&data=x&_=${Date.now()}`, {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    return true;
  } catch {
    return false;
  }
}

async function checkOnline() {
  // No pingear si estamos en localhost · siempre online ahí
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    setOffline(false);
    return;
  }

  const ok = await pingReal();
  setOffline(!ok);
}

function setOffline(offline) {
  if (offline === isConfirmedOffline) return;
  isConfirmedOffline = offline;

  if (offlineBanner) offlineBanner.hidden = !offline;
  document.documentElement.dataset.online = offline ? '0' : '1';

  console.log(offline ? '📴 Offline confirmado' : '📶 Online confirmado');
}

function scheduleOnlineCheck() {
  clearTimeout(confirmOfflineTimer);
  // Debounce de 3s: esperar antes de mostrar "offline" (evita parpadeos)
  confirmOfflineTimer = setTimeout(checkOnline, 3000);
}

// Inicial: hacemos ping y esperamos a tener resultado antes de decidir
(async function initOnlineStatus() {
  // Al inicio asumimos online (no mostramos banner)
  setOffline(false);
  // Después de 2s, verificamos
  setTimeout(checkOnline, 2000);
  // Chequeo periódico cada 45s
  onlineCheckTimer = setInterval(checkOnline, 45000);
})();

// Eventos nativos (rápidos pero poco confiables en Android)
window.addEventListener('online', () => {
  // Solo confiar en 'online' · es una buena noticia (pasar a online)
  setOffline(false);
  scheduleOnlineCheck();
});

window.addEventListener('offline', () => {
  // No confiar directo en 'offline' · confirmar con ping
  scheduleOnlineCheck();
});

// Cuando el usuario vuelve a la app, re-verificar
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    scheduleOnlineCheck();
  }
});

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
  // 1. CRÍTICO: handleJoin ANTES de todo
  await handleJoin();

  // Detectar si ya está instalada (oculta banner y ajusta UI)
  applyStandaloneClass();
  
  // 2. Inicializar multi-viaje
  await trips.ensureInitialized();

  // 3. Cargar trip activo
  trip = await trips.getActiveTrip();

  // 4. UI
  buildChips();
  buildProviderChips();
  buildPeChips();

  // 5. Datos
  await loadAll();
  await renderAll();

  // 7. Sync
  await startSync();

  // 8. Notif
  notif.loadSettings();
  notif.refreshEvents(events);
  if (notif.getSettings().enabled) {
    notif.start(events);
  }

  // 9. Wallet
  await renderWallet();

  // 10. PWA
  if (IS_DEV) {
    console.log('🛠️  Modo DEV · Service Worker desactivado');
    console.log('📚 Viaje activo:', trip?.title, '(' + trip?.id + ')', '·', events.length, 'eventos');
  } else {
    registerSW();
  }
})();
