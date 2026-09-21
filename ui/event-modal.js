/* ============================================================
   ui/event-modal.js · Modal de evento + adjuntos
   ============================================================ */

import * as bus from './bus.js';
import * as trips from '../trips.js';
import * as wallet from '../wallet.js';
import * as sync from '../sync.js';
import {
  TYPE_META, openModalEl, closeModalEl, toast, escapeHtml,
  uid, toLocalInput, fromLocalInput, call,
} from './bus.js';

const { ctx } = bus;

let currentType = 'activity';
let editingAttachments = [];

export function init() {
  document.getElementById('typeChips').addEventListener('click', onChipClick);
  document.getElementById('eventForm').addEventListener('submit', onSubmit);
  document.getElementById('deleteBtn').addEventListener('click', onDelete);
  document.getElementById('modal').addEventListener('click', e => {
    if (e.target.hasAttribute('data-close') || e.target.closest('[data-close]')) close();
  });
  document.getElementById('fAttachBtn').addEventListener('click', () => {
    document.getElementById('fAttachInput').click();
  });
  document.getElementById('fAttachInput').addEventListener('change', onAttachChange);
  document.addEventListener('keydown', e => {
    const m = document.getElementById('modal');
    if (e.key === 'Escape' && !m.hidden) close();
  });

  buildChips();
}

function buildChips() {
  const el = document.getElementById('typeChips');
  el.innerHTML = Object.entries(TYPE_META).map(([k, m]) => `
    <button type="button" class="chip" data-type="${k}" style="--chip-c:${m.color}">
      <span>${m.icon}</span><span>${m.label}</span>
    </button>`).join('');
}

function onChipClick(e) {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  currentType = btn.dataset.type;
  document.querySelectorAll('#typeChips .chip').forEach(c => {
    c.classList.toggle('is-active', c.dataset.type === currentType);
  });
}

function setChipActive() {
  document.querySelectorAll('#typeChips .chip').forEach(c => {
    c.classList.toggle('is-active', c.dataset.type === currentType);
  });
}

/* ---------- Abrir ---------- */
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

  editingAttachments = [];
  if (isEdit) {
    try {
      const files = await wallet.getFilesByEvent(e.id);
      editingAttachments = files.map(f => ({
        id: f.id, isNew: false, record: f, category: f.category || 'other',
      }));
    } catch {}
  }
  renderAttachments();

  openModalEl(document.getElementById('modal'));
  setTimeout(() => document.getElementById('fTitle').focus(), 150);
}

function close() {
  closeModalEl(document.getElementById('modal'));
  document.getElementById('eventForm').reset();
  editingAttachments = [];
  renderAttachments();
}

/* ---------- Submit ---------- */
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
  await call('saveEvent', payload);

  for (const a of editingAttachments) {
    if (a.isNew && a.file) {
      try {
        await wallet.saveFile(a.file, {
          tripId: ctx.trip?.id, eventId: id, eventType: currentType, category: a.category,
        });
      } catch (err) { toast(`Error: ${err.message}`); }
    }
  }

  close();
  toast(exists ? 'Evento actualizado' : 'Evento creado');
}

async function onDelete() {
  const id = document.getElementById('fId').value;
  if (!id || !confirm('¿Eliminar este evento?')) return;
  await call('deleteEvent', id);
  close();
}

/* ---------- Attachments ---------- */
function renderAttachments() {
  const list = document.getElementById('fAttachList');
  if (!list) return;
  if (!editingAttachments.length) { list.innerHTML = ''; return; }

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
          ${thumb ? `<img src="${thumb}" alt="" onload="URL.revokeObjectURL(this.src)" />` : icon}
        </div>
        <div class="attach-item__body">
          <div class="attach-item__name">${escapeHtml(name)}</div>
          <div class="attach-item__meta">${a.isNew ? 'Nuevo · ' : ''}${size}</div>
        </div>
        <select class="attach-item__cat" data-cat-idx="${i}" aria-label="Categoría">${opts}</select>
        <button type="button" class="attach-item__remove" data-remove="${i}" aria-label="Quitar">
          <svg><use href="#i-x"/></svg>
        </button>
      </div>`;
  }).join('');

  list.querySelectorAll('[data-cat-idx]').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = +sel.dataset.catIdx;
      const item = editingAttachments[idx];
      if (!item) return;
      item.category = sel.value;
      if (!item.isNew && item.id) wallet.updateFile(item.id, { category: sel.value }).catch(() => {});
    });
  });

  list.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      const idx = +btn.dataset.remove;
      const item = editingAttachments[idx];
      if (item && !item.isNew && item.id) wallet.deleteFile(item.id).catch(() => {});
      editingAttachments.splice(idx, 1);
      renderAttachments();
    });
  });
}

async function onAttachChange(e) {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  for (const f of files) {
    if (f.size > 15 * 1024 * 1024) { toast(`${f.name} · más de 15MB`); continue; }
    editingAttachments.push({
      id: null, isNew: true, file: f,
      category: guessCategory(f, currentType),
      preview: {
        name: f.name, size: f.size, mime: f.type,
        thumbnail: f.type.startsWith('image/') ? f : null,
      },
    });
  }
  renderAttachments();
}

function guessCategory(file, eventType) {
  const name = (file.name || '').toLowerCase();
  if (/boarding|tarjeta.*embarque|boardingpass/.test(name)) return 'boarding';
  if (/voucher|reserva|booking|airbnb|hotel/.test(name)) return 'voucher';
  if (/seguro|insurance|poliza/.test(name)) return 'insurance';
  if (/\b(dni|pasaporte|passport|licencia)\b/.test(name)) return 'id';
  if (/\b(auto|car|rental|hertz|avis)\b/.test(name)) return 'car';
  if (eventType === 'flight') return 'boarding';
  if (eventType === 'hotel' || eventType === 'airbnb') return 'voucher';
  if (eventType === 'car') return 'car';
  return 'other';
}