/* ============================================================
   ui/event-modal.js · Modal de evento + adjuntos
   - Chips tipados (8 tipos incluyendo freetour)
   - Adjuntos con categoría
   - Botón "Ver en Maps" cuando hay geo / URL / place
   ============================================================ */

import * as bus from './bus.js';
import * as trips from '../trips.js';
import * as wallet from '../wallet.js';
import {
  TYPE_META, openModalEl, closeModalEl, toast, escapeHtml,
  uid, toLocalInput, fromLocalInput, call,
  getMapsUrl,
} from './bus.js';

const { ctx } = bus;

/* ============================================================
   Estado del modal
   ============================================================ */
let currentType = 'activity';
let editingAttachments = [];

/* ============================================================
   Init · wireo todo una sola vez
   ============================================================ */
export function init() {
  document.getElementById('typeChips')?.addEventListener('click', onChipClick);
  document.getElementById('eventForm')?.addEventListener('submit', onSubmit);
  document.getElementById('deleteBtn')?.addEventListener('click', onDelete);

  document.getElementById('modal')?.addEventListener('click', e => {
    if (e.target.hasAttribute('data-close') ||
        e.target.closest('[data-close]')) close();
  });

  document.getElementById('fAttachBtn')?.addEventListener('click', () => {
    document.getElementById('fAttachInput').click();
  });
  document.getElementById('fAttachInput')?.addEventListener('change', onAttachChange);

  document.addEventListener('keydown', e => {
    const m = document.getElementById('modal');
    if (e.key === 'Escape' && m && !m.hidden) close();
  });

  buildChips();
}

/* ============================================================
   Chips de tipos
   ============================================================ */
function buildChips() {
  const el = document.getElementById('typeChips');
  if (!el) return;
  el.innerHTML = Object.entries(TYPE_META).map(([k, m]) => `
    <button type="button" class="chip" data-type="${k}" style="--chip-c:${m.color}">
      <span>${m.icon}</span><span>${m.label}</span>
    </button>`).join('');
}

function onChipClick(e) {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  currentType = btn.dataset.type;
  setChipActive();
}

function setChipActive() {
  document.querySelectorAll('#typeChips .chip').forEach(c => {
    c.classList.toggle('is-active', c.dataset.type === currentType);
  });
}

/* ============================================================
   Abrir modal
   ============================================================ */
export async function open(id) {
  const isEdit = !!id;
  const e = isEdit ? ctx.events.find(x => x.id === id) : null;

  document.getElementById('modalTitle').textContent = isEdit ? 'Editar evento' : 'Nuevo evento';
  document.getElementById('fId').value = e?.id || '';
  document.getElementById('fTitle').value = e?.title || '';
  document.getElementById('fStart').value = e
    ? toLocalInput(e.startAt)
    : toLocalInput(new Date(Date.now() + 3600000).toISOString());
  document.getElementById('fPlace').value = e?.place || '';
  document.getElementById('fNotes').value = e?.notes || '';
  document.getElementById('deleteBtn').hidden = !isEdit;
  document.getElementById('saveBtn').textContent = isEdit ? 'Guardar' : 'Crear evento';

  currentType = e?.type || 'activity';
  setChipActive();

  // Adjuntos existentes
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

  // Botón Maps · visible si el evento tiene coords, URL de meeting point o place
  renderMapsButton(e, isEdit);

  openModalEl(document.getElementById('modal'));
  setTimeout(() => document.getElementById('fTitle').focus(), 150);
}

/* ============================================================
   Botón Maps
   ============================================================ */
function renderMapsButton(e, isEdit) {
  const row = document.getElementById('fMapsRow');
  const btn = document.getElementById('fMapsBtn');
  if (!row || !btn) return;

  if (!isEdit || !e) {
    row.hidden = true;
    btn.removeAttribute('href');
    return;
  }

  const url = getMapsUrl(e);
  if (!url) {
    row.hidden = true;
    btn.removeAttribute('href');
    return;
  }

  btn.href = url;
  row.hidden = false;

  // Texto contextual
  const label = btn.querySelector('span');
  if (label) {
    if (e.tourMeta?.meetingPointUrl || e.type === 'freetour') {
      label.textContent = 'Ver punto de encuentro en Maps';
    } else if (e.geo?.lat && e.geo?.lng) {
      label.textContent = 'Ver ubicación en Maps';
    } else {
      label.textContent = 'Buscar en Maps';
    }
  }
}

/* ============================================================
   Cerrar modal
   ============================================================ */
function close() {
  closeModalEl(document.getElementById('modal'));
  document.getElementById('eventForm')?.reset();
  editingAttachments = [];
  renderAttachments();
  document.getElementById('fMapsRow')?.setAttribute('hidden', '');
}

/* ============================================================
   Submit
   ============================================================ */
async function onSubmit(ev) {
  ev.preventDefault();

  const id = document.getElementById('fId').value || uid();
  const exists = ctx.events.find(x => x.id === id);

  const payload = {
    id,
    tripId: ctx.trip?.id,
    type: currentType,
    title: document.getElementById('fTitle').value.trim(),
    startAt: fromLocalInput(document.getElementById('fStart').value),
    place: document.getElementById('fPlace').value.trim(),
    notes: document.getElementById('fNotes').value.trim(),
    done: exists?.done || false,
    updatedAt: Date.now(),
  };

  // Preservar tourMeta, geo y confirmation_code si editás un freetour
  if (exists?.tourMeta) payload.tourMeta = exists.tourMeta;
  if (exists?.geo)      payload.geo = exists.geo;
  if (exists?.confirmation_code) payload.confirmation_code = exists.confirmation_code;
  if (exists?.cost)     payload.cost = exists.cost;
  if (exists?.currency) payload.currency = exists.currency;

  await call('saveEvent', payload);

  // Guardar adjuntos nuevos
  for (const a of editingAttachments) {
    if (a.isNew && a.file) {
      try {
        await wallet.saveFile(a.file, {
          tripId: ctx.trip?.id,
          eventId: id,
          eventType: currentType,
          category: a.category,
        });
      } catch (err) {
        console.warn('[event-modal] no se pudo guardar adjunto:', err);
        toast(`Error: ${err.message}`);
      }
    }
  }

  close();
  toast(exists ? 'Evento actualizado' : 'Evento creado');
}

/* ============================================================
   Eliminar
   ============================================================ */
async function onDelete() {
  const id = document.getElementById('fId').value;
  if (!id || !confirm('¿Eliminar este evento?')) return;
  await call('deleteEvent', id);
  close();
}

/* ============================================================
   Adjuntos · render + wiring
   ============================================================ */
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
    const opts = Object.entries(cats).map(([k, v]) =>
      `<option value="${k}" ${a.category === k ? 'selected' : ''}>${v.icon} ${v.label}</option>`
    ).join('');

    return `
      <div class="attach-item" data-idx="${i}">
        <div class="attach-item__icon">
          ${thumb
            ? `<img src="${thumb}" alt="" onload="URL.revokeObjectURL(this.src)" />`
            : icon}
        </div>
        <div class="attach-item__body">
          <div class="attach-item__name">${escapeHtml(name)}</div>
          <div class="attach-item__meta">${a.isNew ? 'Nuevo · ' : ''}${size}</div>
        </div>
        <select class="attach-item__cat" data-cat-idx="${i}" aria-label="Categoría">
          ${opts}
        </select>
        <button type="button" class="attach-item__remove" data-remove="${i}" aria-label="Quitar">
          <svg><use href="#i-x"/></svg>
        </button>
      </div>`;
  }).join('');

  // Cambio de categoría
  list.querySelectorAll('[data-cat-idx]').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = +sel.dataset.catIdx;
      const item = editingAttachments[idx];
      if (!item) return;
      item.category = sel.value;
      if (!item.isNew && item.id) {
        wallet.updateFile(item.id, { category: sel.value }).catch(() => {});
      }
    });
  });

  // Quitar adjunto
  list.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', ev => {
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

async function onAttachChange(e) {
  const files = [...(e.target.files || [])];
  e.target.value = '';

  for (const f of files) {
    if (f.size > 15 * 1024 * 1024) {
      toast(`${f.name} · más de 15MB`);
      continue;
    }
    editingAttachments.push({
      id: null,
      isNew: true,
      file: f,
      category: guessCategory(f, currentType),
      preview: {
        name: f.name,
        size: f.size,
        mime: f.type,
        thumbnail: f.type.startsWith('image/') ? f : null,
      },
    });
  }
  renderAttachments();
}

/* ============================================================
   Auto-categorización de adjuntos
   ============================================================ */
function guessCategory(file, eventType) {
  const name = (file.name || '').toLowerCase();

  if (/boarding|tarjeta.*embarque|boardingpass/.test(name)) return 'boarding';
  if (/voucher|reserva|booking|airbnb|hotel/.test(name)) return 'voucher';
  if (/seguro|insurance|poliza|p[oó]liza/.test(name)) return 'insurance';
  if (/\b(dni|pasaporte|passport|licencia|cedula|c[eé]dula)\b/.test(name)) return 'id';
  if (/\b(auto|car|rental|hertz|avis|europcar|sixt)\b/.test(name)) return 'car';

  if (eventType === 'flight')   return 'boarding';
  if (eventType === 'hotel' || eventType === 'airbnb') return 'voucher';
  if (eventType === 'car')      return 'car';

  return 'other';
}
