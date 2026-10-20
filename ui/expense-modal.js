/* ============================================================
   ui/expense-modal.js · Modal de gasto (crear / editar)
   - Split equal o custom
   - Valida que customSplits sumen el total
   - Persiste vía expenses.createExpense / updateExpense
   ============================================================ */

import * as bus from './bus.js';
import * as expenses from '../expenses.js';
import * as trips from '../trips.js';
import {
  openModalEl, closeModalEl, toast, escapeHtml, call,
} from './bus.js';

const { ctx } = bus;

/* ---------- Estado ---------- */
let currentCategory = 'other';
let currentSplitType = 'equal';
let travelersCache = [];
let splitSelection = new Set();     // ids seleccionados en modo equal
let customValues = {};              // { travelerId: number } en modo custom
let editingId = null;

/* ============================================================
   Init
   ============================================================ */
export function init() {
  const modal = document.getElementById('expenseModal');
  if (!modal) return;

  modal.addEventListener('click', e => {
    if (e.target.hasAttribute('data-expense-close') ||
        e.target.closest('[data-expense-close]')) close();
  });

  document.getElementById('exCategoryChips')?.addEventListener('click', onCategoryClick);
  document.getElementById('exSplitChips')?.addEventListener('click', onSplitClick);
  document.getElementById('exSplitPeople')?.addEventListener('change', onSplitPeopleChange);
  document.getElementById('exSplitCustomPeople')?.addEventListener('input', onCustomInput);
  document.getElementById('exAmount')?.addEventListener('input', updateRemaining);
  document.getElementById('expenseForm')?.addEventListener('submit', onSubmit);
  document.getElementById('exDeleteBtn')?.addEventListener('click', onDelete);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.hidden) close();
  });
}

/* ============================================================
   Abrir / cerrar
   ============================================================ */
export async function open(id = null) {
  if (!ctx.trip?.id) { toast('Sin viaje activo'); return; }

  try {
    travelersCache = await trips.getTravelersByTrip(ctx.trip.id);
  } catch { travelersCache = []; }

  if (!travelersCache.length) {
    toast('Agregá viajeros primero para dividir gastos');
    return;
  }

  editingId = id;
  const editing = id ? await expenses.getExpense(id) : null;

  document.getElementById('expenseTitle').textContent = editing ? 'Editar gasto' : 'Nuevo gasto';
  document.getElementById('exDeleteBtn').hidden = !editing;
  document.getElementById('exError').hidden = true;

  // Reset defaults
  currentCategory = editing?.category || 'other';
  currentSplitType = editing?.splitType || 'equal';
  splitSelection = new Set(
    editing?.splitAmong?.length ? editing.splitAmong : travelersCache.map(t => t.id)
  );
  customValues = editing?.customSplits ? { ...editing.customSplits } : {};

  // Poblar campos
  document.getElementById('exId').value      = editing?.id || '';
  document.getElementById('exTitle').value   = editing?.title || '';
  document.getElementById('exAmount').value  = editing?.amount || '';
  document.getElementById('exCurrency').value = editing?.currency || ctx.trip?.currency || 'EUR';
  document.getElementById('exNotes').value   = editing?.notes || '';

  // Pagador
  const paidBySel = document.getElementById('exPaidBy');
  paidBySel.innerHTML = travelersCache.map(t =>
    `<option value="${t.id}">${escapeHtml(t.name)}</option>`
  ).join('');
  if (editing?.paidBy) paidBySel.value = editing.paidBy;
  else if (travelersCache.length) paidBySel.value = travelersCache[0].id;

  buildCategoryChips();
  buildSplitChips();
  buildSplitPeople();
  buildCustomPeople();
  updateRemaining();

  openModalEl(document.getElementById('expenseModal'));
  setTimeout(() => document.getElementById('exTitle').focus(), 150);
}

export function close() {
  closeModalEl(document.getElementById('expenseModal'));
  document.getElementById('expenseForm')?.reset();
  editingId = null;
}

/* ============================================================
   Categorías
   ============================================================ */
function buildCategoryChips() {
  const cats = expenses.getCategories();
  const el = document.getElementById('exCategoryChips');
  el.innerHTML = Object.entries(cats).map(([k, c]) => `
    <button type="button" class="chip ${k === currentCategory ? 'is-active' : ''}"
            data-cat="${k}" style="--chip-c:${c.color}">
      <span>${c.icon}</span><span>${c.label}</span>
    </button>`).join('');
}
function onCategoryClick(e) {
  const btn = e.target.closest('.chip'); if (!btn) return;
  currentCategory = btn.dataset.cat;
  buildCategoryChips();
}

/* ============================================================
   Split type
   ============================================================ */
function buildSplitChips() {
  document.querySelectorAll('#exSplitChips .chip').forEach(c => {
    c.classList.toggle('is-active', c.dataset.split === currentSplitType);
  });
  document.getElementById('exSplitEqual').hidden  = currentSplitType !== 'equal';
  document.getElementById('exSplitCustom').hidden = currentSplitType !== 'custom';
}
function onSplitClick(e) {
  const btn = e.target.closest('.chip'); if (!btn) return;
  currentSplitType = btn.dataset.split;
  buildSplitChips();
  if (currentSplitType === 'custom') {
    // Pre-poblar con partes iguales sobre los seleccionados
    const amount = parseFloat(document.getElementById('exAmount').value) || 0;
    const ids = [...splitSelection];
    customValues = {};
    if (ids.length) {
      const per = +(amount / ids.length).toFixed(2);
      for (const id of ids) customValues[id] = per;
    }
    buildCustomPeople();
  }
  updateRemaining();
}

/* ============================================================
   Modo equal · checkboxes
   ============================================================ */
function buildSplitPeople() {
  const el = document.getElementById('exSplitPeople');
  el.innerHTML = travelersCache.map(t => `
    <label class="ex-person">
      <input type="checkbox" data-tid="${t.id}"
             ${splitSelection.has(t.id) ? 'checked' : ''} />
      <span class="ex-person__avatar" style="--a:${t.color}">
        ${escapeHtml(initials(t.name))}
      </span>
      <span class="ex-person__name">${escapeHtml(t.name)}</span>
    </label>`).join('');
}
function onSplitPeopleChange(e) {
  const cb = e.target.closest('input[type="checkbox"]'); if (!cb) return;
  const id = cb.dataset.tid;
  if (cb.checked) splitSelection.add(id);
  else splitSelection.delete(id);
}

/* ============================================================
   Modo custom · inputs por persona
   ============================================================ */
function buildCustomPeople() {
  const el = document.getElementById('exSplitCustomPeople');
  el.innerHTML = travelersCache.map(t => {
    const val = customValues[t.id] != null ? customValues[t.id] : '';
    return `
      <div class="ex-person ex-person--custom">
        <span class="ex-person__avatar" style="--a:${t.color}">
          ${escapeHtml(initials(t.name))}
        </span>
        <span class="ex-person__name">${escapeHtml(t.name)}</span>
        <input type="number" class="ex-person__input" data-cid="${t.id}"
               inputmode="decimal" step="0.01" min="0" placeholder="0.00"
               value="${val}" />
      </div>`;
  }).join('');
}
function onCustomInput(e) {
  const inp = e.target.closest('[data-cid]'); if (!inp) return;
  const id = inp.dataset.cid;
  const val = parseFloat(inp.value);
  if (isNaN(val) || val === 0) delete customValues[id];
  else customValues[id] = +val.toFixed(2);
  updateRemaining();
}

/* ============================================================
   Update remaining
   ============================================================ */
function updateRemaining() {
  const el = document.getElementById('exSplitRemaining');
  if (!el) return;
  const amount = parseFloat(document.getElementById('exAmount').value) || 0;
  const sum = Object.values(customValues).reduce((s, v) => s + Number(v), 0);
  const diff = +(amount - sum).toFixed(2);

  if (Math.abs(diff) < 0.01) {
    el.textContent = `✓ ${amount.toFixed(2)}`;
    el.style.color = 'var(--c-activity)';
  } else if (diff > 0) {
    el.textContent = `Faltan ${diff.toFixed(2)}`;
    el.style.color = 'var(--accent-text)';
  } else {
    el.textContent = `Sobra ${Math.abs(diff).toFixed(2)}`;
    el.style.color = '#ef4444';
  }
}

/* ============================================================
   Submit
   ============================================================ */
async function onSubmit(ev) {
  ev.preventDefault();
  const errEl = document.getElementById('exError');
  const saveBtn = document.getElementById('exSaveBtn');
  errEl.hidden = true;
  saveBtn.disabled = true;

  try {
    const amount = parseFloat(document.getElementById('exAmount').value);
    const title  = document.getElementById('exTitle').value.trim();
    const notes  = document.getElementById('exNotes').value.trim();
    const paidBy = document.getElementById('exPaidBy').value;
    const currency = document.getElementById('exCurrency').value;

    if (!title) throw new Error('Falta el título');
    if (!amount || amount <= 0) throw new Error('Monto inválido');
    if (!paidBy) throw new Error('Falta quién pagó');

    let splitAmong = [];
    let customSplits = null;

    if (currentSplitType === 'equal') {
      splitAmong = [...splitSelection];
      if (!splitAmong.length) throw new Error('Seleccioná al menos un viajero');
    } else {
      // Custom: splitAmong = todos los que tienen monto > 0
      splitAmong = Object.keys(customValues).filter(id => customValues[id] > 0);
      if (!splitAmong.length) throw new Error('Asigná montos a al menos un viajero');
      const sum = Object.values(customValues).reduce((s, v) => s + Number(v), 0);
      if (Math.abs(sum - amount) > 0.01) {
        throw new Error(`Los montos suman ${sum.toFixed(2)}, no ${amount.toFixed(2)}`);
      }
      customSplits = { ...customValues };
    }

    const payload = {
      title,
      amount,
      currency,
      paidBy,
      splitAmong,
      splitType: currentSplitType,
      customSplits,
      category: currentCategory,
      notes,
    };

    if (editingId) {
      await expenses.updateExpense(editingId, payload);
      toast('Gasto actualizado');
    } else {
      await expenses.createExpense(ctx.trip.id, payload);
      toast('Gasto agregado');
    }

    close();
    await call('renderAll');
  } catch (err) {
    errEl.textContent = err.message || 'Error';
    errEl.hidden = false;
  } finally {
    saveBtn.disabled = false;
  }
}

/* ============================================================
   Delete
   ============================================================ */
async function onDelete() {
  if (!editingId) return;
  if (!confirm('¿Eliminar este gasto?')) return;
  await expenses.deleteExpense(editingId);
  close();
  toast('Gasto eliminado');
  await call('renderAll');
}

/* ============================================================
   Utils
   ============================================================ */
function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2)
    .map(w => w[0] || '').join('').toUpperCase() || '?';
}