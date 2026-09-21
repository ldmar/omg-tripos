/* ============================================================
   ui/management.js · Trips + Travelers + Settings + Notif modal
   ============================================================ */

import * as bus from './bus.js';
import * as trips from '../trips.js';
import * as sync from '../sync.js';
import * as vault from '../vault.js';
import * as crypto from '../crypto.js';
import * as wallet from '../wallet.js';
import * as chat from '../chat.js';
import * as travelers from '../travelers.js';
import * as settings from '../settings.js';
import * as notif from '../notifications.js';
import * as daymode from '../daymode.js';
import {
  EMOJIS, openModalEl, closeModalEl, toast, escapeHtml, uid,
  fmtDateShort, call, emit,
} from './bus.js';

const { ctx } = bus;

/* ============================================================
   Estado
   ============================================================ */
let currentEmoji = '🌍';
let tcTravelers = 1;
let tripActionsTargetId = null;
let tripRenameTargetId = null;

let travSelectedRole = 'guest';
let travSelectedColor = '#ff5c39';
let travEditingId = null;

let backupMode = 'export';
let pendingImportFile = null;

export function init() {
  wireTrips();
  wireTravelers();
  wireSettings();
  wireNotif();
  wireImport();
}

export function render() {
  renderTravelersList();
}

/* ============================================================
   TRIPS
   ============================================================ */
function wireTrips() {
  document.getElementById('tripSelector')?.addEventListener('click', openTripsList);
  document.getElementById('tripsNewBtn')?.addEventListener('click', () => {
    closeModalEl(document.getElementById('tripsListModal'));
    setTimeout(openTripCreate, 200);
  });
  document.getElementById('tripsListModal')?.addEventListener('click', e => {
    if (e.target.hasAttribute('data-trips-close') || e.target.closest('[data-trips-close]')) closeModalEl(document.getElementById('tripsListModal'));
  });

  document.getElementById('tcTravelers')?.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    tcTravelers = chip.dataset.n === '5' ? 5 : +chip.dataset.n;
    document.querySelectorAll('#tcTravelers .chip').forEach(c => c.classList.toggle('is-active', c === chip));
  });
  document.getElementById('tripCreateForm')?.addEventListener('submit', onCreateTrip);
  document.getElementById('tripCreateModal')?.addEventListener('click', e => {
    if (e.target.hasAttribute('data-trip-create-close') || e.target.closest('[data-trip-create-close]')) closeModalEl(document.getElementById('tripCreateModal'));
  });

  document.getElementById('tripActionsModal')?.addEventListener('click', e => {
    if (e.target.hasAttribute('data-trip-actions-close') || e.target.closest('[data-trip-actions-close]')) closeModalEl(document.getElementById('tripActionsModal'));
  });
  document.getElementById('taRename')?.addEventListener('click', onTaRename);
  document.getElementById('taDuplicate')?.addEventListener('click', onTaDuplicate);
  document.getElementById('taDelete')?.addEventListener('click', onTaDelete);

  document.getElementById('tripRenameForm')?.addEventListener('submit', onRenameTrip);
  document.getElementById('tripRenameModal')?.addEventListener('click', e => {
    if (e.target.hasAttribute('data-trip-rename-close') || e.target.closest('[data-trip-rename-close]')) closeModalEl(document.getElementById('tripRenameModal'));
  });
}

async function openTripsList() {
  await renderTripsList();
  openModalEl(document.getElementById('tripsListModal'));
}

async function renderTripsList() {
  const list = await trips.listTrips();
  const el = document.getElementById('tripsList');
  if (!list.length) {
    el.innerHTML = `<p style="text-align:center;color:var(--muted);font-size:13px;padding:20px">No hay viajes</p>`;
    return;
  }
  const active = await trips.getActiveTrip();
  el.innerHTML = list.map(t => {
    const isActive = active?.id === t.id;
    const dateRange = (t.startDate && t.endDate) ? `${fmtDateShort(t.startDate)} → ${fmtDateShort(t.endDate)} · ` : '';
    const daysLabel = t.days ? `${t.days} día${t.days > 1 ? 's' : ''}` : 'Sin fechas';
    return `
      <div class="trip-item ${isActive ? 'is-active' : ''}" data-trip-id="${t.id}" role="button" tabindex="0">
        <div class="trip-item__flag">${t.flag || '🌍'}</div>
        <div class="trip-item__body">
          <p class="trip-item__title">${escapeHtml(t.title || 'Sin nombre')}</p>
          <p class="trip-item__meta">${dateRange}${daysLabel}</p>
        </div>
        ${isActive ? '<div class="trip-item__check"><svg><use href="#i-check"/></svg></div>'
          : `<button type="button" class="trip-item__more" data-trip-more="${t.id}" aria-label="Opciones"><svg><use href="#i-more"/></svg></button>`}
      </div>`;
  }).join('');

  el.querySelectorAll('[data-trip-id]').forEach(node => {
    node.addEventListener('click', async e => {
      if (e.target.closest('[data-trip-more]')) return;
      closeModalEl(document.getElementById('tripsListModal'));
      await call('switchTrip', node.dataset.tripId);
    });
  });
  el.querySelectorAll('[data-trip-more]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      closeModalEl(document.getElementById('tripsListModal'));
      openTripActions(btn.dataset.tripMore);
    });
  });
}

function openTripCreate() {
  currentEmoji = '🌍';
  tcTravelers = 1;
  document.getElementById('tcTitle').value = '';
  document.getElementById('tcStart').value = '';
  document.getElementById('tcEnd').value = '';
  document.getElementById('tcCurrency').value = 'EUR';
  document.getElementById('tcClone').checked = false;
  document.getElementById('tcCloneRow').hidden = !ctx.events.length;
  document.querySelectorAll('#tcTravelers .chip').forEach(c => c.classList.toggle('is-active', +c.dataset.n === tcTravelers));
  buildEmojiPicker();
  updateDateRangeLabel();
  openModalEl(document.getElementById('tripCreateModal'));
  setTimeout(() => document.getElementById('tcTitle').focus(), 150);
}

function buildEmojiPicker() {
  const el = document.getElementById('emojiPicker');
  el.innerHTML = EMOJIS.map(e => `<button type="button" class="emoji-opt" data-emoji="${e}">${e}</button>`).join('')
    + `<button type="button" class="emoji-opt emoji-other" data-emoji="__OTHER__">+</button>`;

  el.onclick = ev => {
    const btn = ev.target.closest('.emoji-opt');
    if (!btn) return;
    let val = btn.dataset.emoji;
    if (val === '__OTHER__') {
      const custom = prompt('Pegá un emoji (o varios):');
      if (!custom) return;
      val = custom.slice(0, 4);
    }
    currentEmoji = val;
    el.querySelectorAll('.emoji-opt').forEach(b => b.classList.toggle('is-active', b.dataset.emoji === currentEmoji));
  };
  el.querySelectorAll('.emoji-opt').forEach(b => b.classList.toggle('is-active', b.dataset.emoji === currentEmoji));
}

async function onCreateTrip(ev) {
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
  const source = clone && ctx.trip?.id ? ctx.events.slice() : [];
  const newTrip = await trips.createTrip(data);

  for (const ev of source) {
    await trips.idbPut(trips.STORES.EVENTS, {
      ...ev, id: uid(), tripId: newTrip.id, done: false, updatedAt: Date.now(),
    });
  }
  if (source.length) toast(`Viaje creado · ${source.length} evento${source.length > 1 ? 's' : ''} copiado${source.length > 1 ? 's' : ''}`);
  else toast('Viaje creado');

  closeModalEl(document.getElementById('tripCreateModal'));
  await call('switchTrip', newTrip.id);
}

async function openTripActions(id) {
  tripActionsTargetId = id;
  const t = await trips.getTrip(id);
  if (t) document.getElementById('tripActionsTitle').textContent = t.title;
  openModalEl(document.getElementById('tripActionsModal'));
}

async function onTaRename() {
  const id = tripActionsTargetId;
  if (!id) return;
  const t = await trips.getTrip(id);
  closeModalEl(document.getElementById('tripActionsModal'));
  if (!t) return;
  tripRenameTargetId = id;
  document.getElementById('trTitle').value = t.title;
  openModalEl(document.getElementById('tripRenameModal'));
  setTimeout(() => document.getElementById('trTitle').focus(), 150);
}

async function onTaDuplicate() {
  const id = tripActionsTargetId;
  if (!id) return;
  const source = await trips.getTrip(id);
  closeModalEl(document.getElementById('tripActionsModal'));
  if (!source) return;
  const cloned = await trips.createTrip({
    title: source.title + ' (copia)',
    flag: source.flag, startDate: source.startDate, endDate: source.endDate,
    travelers: source.travelers, currency: source.currency,
  });
  const sourceEvents = await trips.getTripEvents(id);
  for (const ev of sourceEvents) {
    await trips.idbPut(trips.STORES.EVENTS, { ...ev, id: uid(), tripId: cloned.id, done: false, updatedAt: Date.now() });
  }
  toast(`Viaje duplicado · ${sourceEvents.length} evento${sourceEvents.length > 1 ? 's' : ''}`);
  await call('switchTrip', cloned.id);
}

async function onTaDelete() {
  const id = tripActionsTargetId;
  if (!id) return;
  closeModalEl(document.getElementById('tripActionsModal'));
  const t = await trips.getTrip(id);
  if (!t) return;
  const counts = await trips.countTripData(id);
  const msg = (counts.events || counts.files)
    ? `"${t.title}" tiene ${counts.events} evento(s) y ${counts.files} archivo(s).\n\n¿Eliminar definitivamente?`
    : `¿Eliminar "${t.title}"?`;
  if (!confirm(msg)) return;
  if ((counts.events || counts.files) && !confirm('Última confirmación. Se borran todos los datos.')) return;

  const wasActive = ctx.trip?.id === id;
  await settings.wipeTrip(id);
  if (wasActive) await call('switchTrip', null, { force: true });
  toast('Viaje eliminado');
  await renderTripsList();
}

async function onRenameTrip(ev) {
  ev.preventDefault();
  const id = tripRenameTargetId;
  if (!id) return;
  const title = document.getElementById('trTitle').value.trim();
  if (!title) return;
  await trips.updateTrip(id, { title });
  if (ctx.trip?.id === id) {
    ctx.trip = await trips.getActiveTrip();
    try { sync.setTripMeta({ title: ctx.trip.title, flag: ctx.trip.flag }); } catch {}
    emit('trip-changed');
  }
  closeModalEl(document.getElementById('tripRenameModal'));
  toast('Viaje renombrado');
  await renderTripsList();
}

/* ---------- Range picker ---------- */
const MES_LARGO = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
let rpStart = null, rpEnd = null, rpViewDate = new Date(), rpSelecting = 'start';

export function initRangePicker() {
  document.getElementById('tcDateRangeBtn')?.addEventListener('click', openRangePicker);
  document.getElementById('rpPrev')?.addEventListener('click', () => {
    rpViewDate = new Date(rpViewDate.getFullYear(), rpViewDate.getMonth() - 1, 1);
    renderRangePicker();
  });
  document.getElementById('rpNext')?.addEventListener('click', () => {
    rpViewDate = new Date(rpViewDate.getFullYear(), rpViewDate.getMonth() + 1, 1);
    renderRangePicker();
  });
  document.getElementById('rpClear')?.addEventListener('click', () => {
    rpStart = null; rpEnd = null; rpSelecting = 'start'; renderRangePicker();
  });
  document.getElementById('rpApply')?.addEventListener('click', () => {
    document.getElementById('tcStart').value = rpStart ? toYMD(rpStart) : '';
    document.getElementById('tcEnd').value = rpEnd ? toYMD(rpEnd) : '';
    updateDateRangeLabel();
    closeModalEl(document.getElementById('rangePickerModal'));
  });
  document.getElementById('rangePickerModal')?.addEventListener('click', e => {
    if (e.target.hasAttribute('data-range-close') || e.target.closest('[data-range-close]')) closeModalEl(document.getElementById('rangePickerModal'));
  });
}

function toYMD(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fromYMD(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function rpSameDay(a, b) {
  return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function fmtRangeDate(d) {
  const m = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return d ? `${d.getDate()} ${m[d.getMonth()]}` : '';
}
function openRangePicker() {
  const s = document.getElementById('tcStart').value;
  const e = document.getElementById('tcEnd').value;
  rpStart = fromYMD(s); rpEnd = fromYMD(e);
  rpViewDate = rpStart ? new Date(rpStart) : new Date();
  rpSelecting = rpStart && !rpEnd ? 'end' : 'start';
  renderRangePicker();
  openModalEl(document.getElementById('rangePickerModal'));
}
function renderRangePicker() {
  const year = rpViewDate.getFullYear(), month = rpViewDate.getMonth();
  document.getElementById('rpMonthLabel').textContent = `${MES_LARGO[month]} ${year}`;
  document.getElementById('rpTitle').textContent = rpSelecting === 'start' ? 'Seleccioná la fecha de inicio' : 'Seleccioná la fecha de fin';

  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startWeekday = (first.getDay() + 6) % 7;
  const daysInMonth = last.getDate();
  const today = new Date();

  let html = '';
  const prevLast = new Date(year, month, 0).getDate();
  for (let i = 0; i < startWeekday; i++) html += `<button type="button" class="range-picker__day is-outside" disabled>${prevLast - startWeekday + i + 1}</button>`;

  for (let i = 1; i <= daysInMonth; i++) {
    const d = new Date(year, month, i);
    let cls = 'range-picker__day';
    if (rpSameDay(d, today)) cls += ' is-today';
    if (rpStart && rpSameDay(d, rpStart)) cls += ' is-selected is-start';
    if (rpEnd && rpSameDay(d, rpEnd)) cls += ' is-selected is-end';
    if (rpStart && rpEnd && d > rpStart && d < rpEnd) cls += ' is-between';
    html += `<button type="button" class="${cls}" data-date="${toYMD(d)}">${i}</button>`;
  }

  const total = Math.ceil((startWeekday + daysInMonth) / 7) * 7;
  const remaining = total - (startWeekday + daysInMonth);
  for (let i = 1; i <= remaining; i++) html += `<button type="button" class="range-picker__day is-outside" disabled>${i}</button>`;

  const grid = document.getElementById('rpGrid');
  grid.innerHTML = html;
  grid.querySelectorAll('[data-date]').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = fromYMD(btn.dataset.date);
      if (!d) return;
      if (rpSelecting === 'start') { rpStart = d; rpEnd = null; rpSelecting = 'end'; }
      else {
        if (d < rpStart) { rpStart = d; rpEnd = null; rpSelecting = 'end'; }
        else { rpEnd = d; rpSelecting = 'start'; }
      }
      renderRangePicker();
    });
  });

  const sum = document.getElementById('rpSummary');
  const apply = document.getElementById('rpApply');
  if (rpStart && rpEnd) {
    const days = Math.round((rpEnd - rpStart) / 86400000) + 1;
    sum.textContent = `${fmtRangeDate(rpStart)} → ${fmtRangeDate(rpEnd)} · ${days} día${days > 1 ? 's' : ''}`;
    apply.disabled = false;
  } else if (rpStart) {
    sum.textContent = `${fmtRangeDate(rpStart)} → elegí la fecha de fin`;
    apply.disabled = true;
  } else {
    sum.textContent = 'Elegí la fecha de inicio';
    apply.disabled = true;
  }
}
function updateDateRangeLabel() {
  const btn = document.getElementById('tcDateRangeBtn');
  const lbl = document.getElementById('tcDateRangeLabel');
  if (!btn || !lbl) return;
  const s = fromYMD(document.getElementById('tcStart').value);
  const e = fromYMD(document.getElementById('tcEnd').value);
  if (s && e) {
    const days = Math.round((e - s) / 86400000) + 1;
    lbl.textContent = `${fmtRangeDate(s)} → ${fmtRangeDate(e)} · ${days} día${days > 1 ? 's' : ''}`;
    btn.classList.remove('is-empty');
  } else if (s) {
    lbl.textContent = `${fmtRangeDate(s)} → elegí fin`;
    btn.classList.remove('is-empty');
  } else {
    lbl.textContent = 'Elegí las fechas';
    btn.classList.add('is-empty');
  }
}

/* ============================================================
   TRAVELERS
   ============================================================ */
function wireTravelers() {
  document.getElementById('travelerAddBtn')?.addEventListener('click', () => openTravelerModal());
  document.getElementById('travRoles')?.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    travSelectedRole = chip.dataset.role;
    renderTravRoles();
  });
  document.getElementById('travColors')?.addEventListener('click', e => {
    const btn = e.target.closest('.color-opt');
    if (!btn) return;
    travSelectedColor = btn.dataset.color;
    renderTravColors();
  });
  document.getElementById('travelerForm')?.addEventListener('submit', onSaveTraveler);
  document.getElementById('travDeleteBtn')?.addEventListener('click', onDeleteTraveler);
  document.getElementById('travelerModal')?.addEventListener('click', e => {
    if (e.target.hasAttribute('data-trav-close') || e.target.closest('[data-trav-close]')) closeModalEl(document.getElementById('travelerModal'));
  });
}

export async function renderTravelersList() {
  const list = document.getElementById('travelersList');
  const empty = document.getElementById('travelersEmpty');
  if (!list) return;
  const items = ctx.trip?.id ? await trips.getTravelersByTrip(ctx.trip.id) : [];
  if (!items.length) { list.innerHTML = ''; empty.hidden = false; return; }
  empty.hidden = true;
  list.innerHTML = items.map(t => `
    <button type="button" class="person" data-trav-id="${t.id}">
      <div class="avatar" style="--a:${t.color}">${escapeHtml(travelers.initials(t.name))}</div>
      <p>${escapeHtml(t.name)}</p>
      <span class="person__role ${t.role === 'organizer' ? '' : 'person__role--guest'}">
        ${t.role === 'organizer' ? 'Organizador' : 'Invitado'}
      </span>
    </button>`).join('');
  list.querySelectorAll('[data-trav-id]').forEach(el => {
    el.addEventListener('click', () => openTravelerModal(el.dataset.travId));
  });
}

async function openTravelerModal(id = null) {
  travEditingId = id;
  document.getElementById('travelerForm').reset();
  const title = document.getElementById('travTitle');
  const del = document.getElementById('travDeleteBtn');
  const nameEl = document.getElementById('travName');
  const docEl = document.getElementById('travDoc');
  const emEl = document.getElementById('travEmerg');
  const colors = travelers.getColorPalette();

  if (id) {
    const t = await trips.getTraveler(id);
    if (!t) { toast('Viajero no encontrado'); return; }
    title.textContent = 'Editar viajero';
    document.getElementById('travId').value = t.id;
    nameEl.value = t.name;
    travSelectedRole = t.role || 'guest';
    travSelectedColor = t.color || colors[0];
    del.hidden = false;
    const prof = await travelers.getTravelerProfile(t);
    docEl.value = prof?.document || '';
    emEl.value = prof?.emergencyContact || '';
  } else {
    title.textContent = 'Nuevo viajero';
    document.getElementById('travId').value = '';
    travSelectedRole = 'guest';
    travSelectedColor = colors[0];
    del.hidden = true;
    docEl.value = ''; emEl.value = '';
  }
  renderTravRoles();
  renderTravColors();
  openModalEl(document.getElementById('travelerModal'));
  setTimeout(() => nameEl.focus(), 150);
}

function renderTravRoles() {
  const roles = travelers.getRoles();
  document.getElementById('travRoles').innerHTML = Object.entries(roles).map(([k, v]) => `
    <button type="button" class="chip ${k === travSelectedRole ? 'is-active' : ''}" data-role="${k}">
      <span>${v.icon}</span><span>${v.label}</span>
    </button>`).join('');
}
function renderTravColors() {
  document.getElementById('travColors').innerHTML = travelers.getColorPalette().map(c => `
    <button type="button" class="color-opt ${c === travSelectedColor ? 'is-active' : ''}" style="--c:${c}" data-color="${c}" aria-label="Color ${c}"></button>
  `).join('');
}

async function onSaveTraveler(ev) {
  ev.preventDefault();
  if (!ctx.trip?.id) return;
  const data = {
    name: document.getElementById('travName').value.trim(),
    role: travSelectedRole,
    color: travSelectedColor,
    document: document.getElementById('travDoc').value.trim() || null,
    emergencyContact: document.getElementById('travEmerg').value.trim() || null,
  };
  if (!data.name) return;
  const saveBtn = document.getElementById('travSaveBtn');
  saveBtn.disabled = true;
  try {
    if (travEditingId) {
      const ex = await trips.getTraveler(travEditingId);
      if (ex) await travelers.updateTraveler(ex, data);
    } else {
      await travelers.createTraveler(ctx.trip.id, data);
    }
    closeModalEl(document.getElementById('travelerModal'));
    await renderTravelersList();
    toast(travEditingId ? 'Viajero actualizado' : 'Viajero agregado');
  } catch (err) { toast('Error: ' + err.message); }
  finally { saveBtn.disabled = false; }
}

async function onDeleteTraveler() {
  if (!travEditingId) return;
  if (!confirm('¿Eliminar este viajero?')) return;
  await travelers.deleteTraveler(travEditingId);
  closeModalEl(document.getElementById('travelerModal'));
  await renderTravelersList();
  toast('Viajero eliminado');
}

/* ============================================================
   SETTINGS
   ============================================================ */
function wireSettings() {
  document.getElementById('settingsBtn')?.addEventListener('click', openSettings);
  document.getElementById('settingsModal')?.addEventListener('click', e => {
    if (e.target.hasAttribute('data-settings-close') || e.target.closest('[data-settings-close]')) closeModalEl(document.getElementById('settingsModal'));
  });
  document.getElementById('autolockChips')?.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    settings.setAutoLock(Number(chip.dataset.ms));
    renderAutolockChips();
    toast(`Auto-lock: ${chip.textContent.trim()}`);
  });
  document.getElementById('lockNowBtn')?.addEventListener('click', () => {
    closeModalEl(document.getElementById('settingsModal'));
    vault.lock();
  });
  document.getElementById('changePINBtn')?.addEventListener('click', openChangePIN);
  document.getElementById('changePINModal')?.addEventListener('click', e => {
    if (e.target.hasAttribute('data-changepin-close') || e.target.closest('[data-changepin-close]')) closeModalEl(document.getElementById('changePINModal'));
  });
  document.getElementById('changePINForm')?.addEventListener('submit', onChangePIN);
  document.getElementById('cpNew')?.addEventListener('input', () => {
    const s = crypto.pinStrength(document.getElementById('cpNew').value);
    const el = document.getElementById('cpStrength');
    el.hidden = !document.getElementById('cpNew').value;
    el.dataset.score = s.score;
    el.textContent = s.label;
  });
  document.getElementById('exportBackupBtn')?.addEventListener('click', () => openBackupPassword('export'));
  document.getElementById('importBackupBtn')?.addEventListener('click', () => document.getElementById('importBackupInput').click());
  document.getElementById('importBackupInput')?.addEventListener('change', e => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (f) openBackupPassword('import', f);
  });
  document.getElementById('backupPasswordModal')?.addEventListener('click', e => {
    if (e.target.hasAttribute('data-bkp-close') || e.target.closest('[data-bkp-close]')) closeModalEl(document.getElementById('backupPasswordModal'));
  });
  document.getElementById('backupPasswordForm')?.addEventListener('submit', onBackupSubmit);
  document.getElementById('wipeTripBtn')?.addEventListener('click', onWipeTrip);
  document.getElementById('wipeAllBtn')?.addEventListener('click', onWipeAll);
}

function openSettings() {
  renderAutolockChips();
  renderLastBackup();
  renderStorageStats();
  openModalEl(document.getElementById('settingsModal'));
}
function renderAutolockChips() {
  const cur = settings.getAutoLock();
  document.getElementById('autolockChips').innerHTML = settings.getAutoLockOptions().map(o => `
    <button type="button" class="chip ${o.ms === cur ? 'is-active' : ''}" data-ms="${o.ms}">
      <span>${o.label}</span>
    </button>`).join('');
}
function renderLastBackup() {
  const iso = settings.getLastBackupAt();
  const el = document.getElementById('lastBackupHint');
  if (!el) return;
  if (!iso) { el.textContent = 'Nunca se hizo un backup.'; return; }
  const d = new Date(iso);
  el.textContent = `Último backup: ${d.toLocaleDateString('es-AR')} ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;
}
async function renderStorageStats() {
  const el = document.getElementById('storageStats');
  if (!el) return;
  try {
    const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
    const usage = est?.usage || 0, quota = est?.quota || 0;
    el.textContent = quota ? `${wallet.fmtBytes(usage)} de ${wallet.fmtBytes(quota)} (${Math.round(usage / quota * 100)}%)` : `${wallet.fmtBytes(usage)} en uso`;
  } catch { el.textContent = '—'; }
}

function openChangePIN() {
  document.getElementById('changePINForm').reset();
  document.getElementById('cpError').hidden = true;
  document.getElementById('cpStrength').hidden = true;
  document.getElementById('cpSubmit').disabled = false;
  openModalEl(document.getElementById('changePINModal'));
  setTimeout(() => document.getElementById('cpOld').focus(), 150);
}
async function onChangePIN(ev) {
  ev.preventDefault();
  const errEl = document.getElementById('cpError');
  const submit = document.getElementById('cpSubmit');
  errEl.hidden = true; submit.disabled = true;
  try {
    const oldP = document.getElementById('cpOld').value;
    const newP = document.getElementById('cpNew').value;
    const conf = document.getElementById('cpConfirm').value;
    if (newP !== conf) throw new Error('Los PIN nuevos no coinciden');
    await settings.changePIN(oldP, newP);
    closeModalEl(document.getElementById('changePINModal'));
    toast('✓ PIN cambiado');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally { submit.disabled = false; }
}

function openBackupPassword(mode, file = null) {
  backupMode = mode;
  pendingImportFile = file;
  document.getElementById('backupPasswordForm').reset();
  document.getElementById('bkpError').hidden = true;
  document.getElementById('bkpSubmit').disabled = false;
  document.getElementById('bkpTitle').textContent = mode === 'export' ? 'Contraseña del backup' : 'Restaurar backup';
  document.getElementById('bkpHint').textContent = mode === 'export'
    ? 'Elegí una contraseña para el archivo. No se guarda en ningún lado.'
    : 'Ingresá la contraseña con la que exportaste el archivo.';
  document.getElementById('bkpSubmit').textContent = mode === 'export' ? 'Exportar' : 'Restaurar';
  openModalEl(document.getElementById('backupPasswordModal'));
  setTimeout(() => document.getElementById('bkpPass').focus(), 150);
}
async function onBackupSubmit(ev) {
  ev.preventDefault();
  const errEl = document.getElementById('bkpError');
  const submit = document.getElementById('bkpSubmit');
  const hint = document.getElementById('bkpHint');
  errEl.hidden = true; submit.disabled = true;
  try {
    const pass = document.getElementById('bkpPass').value;
    const conf = document.getElementById('bkpConfirm').value;
    if (pass.length < 8) throw new Error('Mínimo 8 caracteres');

    if (backupMode === 'export') {
      if (pass !== conf) throw new Error('Las contraseñas no coinciden');
      const blob = await settings.exportVault(pass, msg => { hint.textContent = msg; });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `omg-backup-${new Date().toISOString().slice(0, 10)}.omg`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      closeModalEl(document.getElementById('backupPasswordModal'));
      closeModalEl(document.getElementById('settingsModal'));
      toast(`✓ Backup exportado (${wallet.fmtBytes(blob.size)})`);
    } else {
      if (!pendingImportFile) throw new Error('Sin archivo');
      hint.textContent = 'Restaurando…';
      const result = await settings.importVault(pendingImportFile, pass, msg => { hint.textContent = msg; });
      closeModalEl(document.getElementById('backupPasswordModal'));
      closeModalEl(document.getElementById('settingsModal'));
      toast(`✓ Restaurado: ${result.trips} viajes, ${result.events} eventos, ${result.wallet} docs`);
      await call('reloadAll');
    }
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally { submit.disabled = false; }
}

async function onWipeTrip() {
  if (!ctx.trip?.id) return;
  if (!confirm(`¿Borrar el viaje "${ctx.trip.title}"?`)) return;
  if (!confirm('Última confirmación. Irreversible.')) return;
  const id = ctx.trip.id;
  closeModalEl(document.getElementById('settingsModal'));
  try {
    await settings.wipeTrip(id);
    toast('Viaje borrado');
    await call('reloadAll');
  } catch (err) { toast('Error: ' + err.message); }
}
async function onWipeAll() {
  if (!confirm('⚠️ WIPE TOTAL\n\nSe borra todo y se destruyen las claves.')) return;
  if (!confirm('Última confirmación. ¿Seguro?')) return;
  try { await settings.wipeEverything(); location.reload(); }
  catch (err) { toast('Error: ' + err.message); }
}

/* ============================================================
   NOTIF MODAL
   ============================================================ */
function wireNotif() {
  document.getElementById('bellBtn')?.addEventListener('click', openNotif);
  document.getElementById('notifModal')?.addEventListener('click', e => {
    if (e.target.hasAttribute('data-notif-close') || e.target.closest('[data-notif-close]')) closeModalEl(document.getElementById('notifModal'));
  });
  document.getElementById('notifEnabled')?.addEventListener('change', onNotifToggle);
  document.getElementById('notifGeo')?.addEventListener('change', onNotifGeo);
  document.getElementById('notifLeadChips')?.addEventListener('click', e => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    notif.saveSettings({ leadMin: +chip.dataset.lead });
    document.querySelectorAll('#notifLeadChips .chip').forEach(c => c.classList.toggle('is-active', +c.dataset.lead === +chip.dataset.lead));
    notif.start(ctx.events);
    emit('render');
    toast(`Avisar ${chip.dataset.lead} min antes`);
  });
  document.getElementById('notifRadiusChips')?.addEventListener('click', e => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    notif.saveSettings({ geofenceRadius: +chip.dataset.radius });
    document.querySelectorAll('#notifRadiusChips .chip').forEach(c => c.classList.toggle('is-active', +c.dataset.radius === +chip.dataset.radius));
    toast(`Radio ${chip.dataset.radius} m`);
  });
  document.getElementById('notifTestBtn')?.addEventListener('click', async () => {
    const ok = await notif.sendTestNotification();
    toast(ok ? 'Notificación enviada' : 'No se pudo enviar');
    updateNotifStatus();
  });
}

function openNotif() {
  const s = notif.getSettings();
  document.getElementById('notifEnabled').checked = s.enabled;
  document.getElementById('notifGeo').checked = s.geofencing;
  document.getElementById('notifTimeGroup').style.opacity = s.enabled ? '1' : '.4';
  document.getElementById('notifGeoGroup').style.opacity = s.geofencing ? '1' : '.4';
  document.querySelectorAll('#notifLeadChips .chip').forEach(c => c.classList.toggle('is-active', +c.dataset.lead === s.leadMin));
  document.querySelectorAll('#notifRadiusChips .chip').forEach(c => c.classList.toggle('is-active', +c.dataset.radius === s.geofenceRadius));
  openModalEl(document.getElementById('notifModal'));
  updateNotifStatus();
}
function updateNotifStatus() {
  const s = notif.getStatus();
  const dot = document.getElementById('notifPermDot');
  const txt = document.getElementById('notifPermText');
  if (!dot) return;
  dot.classList.remove('is-on', 'is-off', 'is-warn');
  if (s.notifPermission === 'granted') { dot.classList.add('is-on'); txt.textContent = 'Notificaciones activas'; }
  else if (s.notifPermission === 'denied') { dot.classList.add('is-off'); txt.textContent = 'Bloqueadas · revisá permisos'; }
  else if (s.notifPermission === 'unsupported') { dot.classList.add('is-warn'); txt.textContent = 'No soportado'; }
  else { dot.classList.add('is-warn'); txt.textContent = 'No activadas'; }
  document.getElementById('bellBtn')?.classList.toggle('iconbtn--notif-on', s.settings.enabled && s.notifPermission === 'granted');
}
async function onNotifToggle() {
  const on = document.getElementById('notifEnabled').checked;
  if (on) {
    const ok = await notif.requestNotificationPermission();
    if (!ok) { document.getElementById('notifEnabled').checked = false; toast('Permiso denegado'); updateNotifStatus(); return; }
  }
  notif.saveSettings({ enabled: on });
  document.getElementById('notifTimeGroup').style.opacity = on ? '1' : '.4';
  notif.start(ctx.events);
  updateNotifStatus();
  emit('render');
  toast(on ? '🔔 Recordatorios activados' : 'Recordatorios desactivados');
}
async function onNotifGeo() {
  const on = document.getElementById('notifGeo').checked;
  if (on && !('geolocation' in navigator)) { document.getElementById('notifGeo').checked = false; toast('Sin geolocalización'); return; }
  notif.saveSettings({ geofencing: on });
  document.getElementById('notifGeoGroup').style.opacity = on ? '1' : '.4';
  notif.start(ctx.events);
  toast(on ? '📍 Alertas por ubicación activadas' : 'Desactivadas');
}

/* ============================================================
   IMPORT MÁGICO (movido acá — está muy acoplado a trips)
   ============================================================ */
let importProvider = 'auto';
let importResult = null;
let importSelected = new Set();
let importDupDecisions = new Map();

function wireImport() {
  bus.on('open-import', () => openImport());
  document.getElementById('importBtn')?.addEventListener('click', () => openImport());
  document.getElementById('importModal')?.addEventListener('click', e => {
    if (e.target.hasAttribute('data-import-close') || e.target.closest('[data-import-close]')) closeModalEl(document.getElementById('importModal'));
  });
  document.getElementById('providerChips')?.addEventListener('click', e => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    importProvider = chip.dataset.provider;
    document.querySelectorAll('#providerChips .chip').forEach(c => c.classList.toggle('is-active', c.dataset.provider === importProvider));
  });
  document.getElementById('importText')?.addEventListener('input', updateAnalyzeState);
  document.getElementById('importExampleBtn')?.addEventListener('click', onExample);
  document.getElementById('importClearBtn')?.addEventListener('click', () => {
    document.getElementById('importText').value = ''; updateAnalyzeState();
  });
  document.getElementById('importAnalyzeBtn')?.addEventListener('click', onAnalyze);
  document.getElementById('importBackBtn')?.addEventListener('click', () => {
    document.getElementById('importPreview').hidden = true;
    document.getElementById('importInput').hidden = false;
  });
  document.getElementById('importConfirmBtn')?.addEventListener('click', onImportConfirm);
  buildProviderChips();
}

function buildProviderChips() {
  // import dinámico para no bloquear el boot
  import('../parser.js').then(parser => {
    const el = document.getElementById('providerChips');
    el.innerHTML = Object.values(parser.PROVIDERS).map(p => `
      <button type="button" class="chip" data-provider="${p.id}">
        <span>${p.emoji}</span><span>${p.name}</span>
      </button>`).join('');
    el.querySelector('[data-provider="auto"]')?.classList.add('is-active');
  });
}

function updateAnalyzeState() {
  const el = document.getElementById('importText');
  const btn = document.getElementById('importAnalyzeBtn');
  if (el && btn) btn.disabled = el.value.trim().length < 20;
}

async function onExample() {
  const { EXAMPLES } = await import('../parser.js');
  const examples = Object.values(EXAMPLES);
  const cur = document.getElementById('importText').value.trim();
  const next = examples.find(e => e !== cur) || examples[0];
  document.getElementById('importText').value = next;
  importProvider = 'auto';
  document.querySelectorAll('#providerChips .chip').forEach(c => c.classList.toggle('is-active', c.dataset.provider === 'auto'));
  updateAnalyzeState();
}

async function onAnalyze() {
  const { analyzeMulti } = await import('../parser.js');
  const text = document.getElementById('importText').value;
  importResult = analyzeMulti(text, importProvider);
  importSelected = new Set(importResult.events.map((_, i) => i));
  importDupDecisions.clear();
  renderImportPreview();
  document.getElementById('importInput').hidden = true;
  document.getElementById('importPreview').hidden = false;
}

function findDuplicate(candidate) {
  const list = ctx.events;
  for (const ev of list) {
    if (candidate.confirmation_code && ev.confirmation_code === candidate.confirmation_code) return ev;
    if (candidate.type === ev.type &&
        (candidate.title || '').toLowerCase().trim() === (ev.title || '').toLowerCase().trim() &&
        ev.startAt && candidate.startAt &&
        new Date(candidate.startAt).toDateString() === new Date(ev.startAt).toDateString()) return ev;
  }
  return null;
}

function renderImportPreview() {
  const { TYPE_META } = bus;
  const badge = document.getElementById('importProvider');
  const summary = document.getElementById('importSummary');
  const list = document.getElementById('importEvents');
  const warn = document.getElementById('importWarnings');
  const warnList = document.getElementById('importWarningsList');

  badge.textContent = importResult.providerName || 'Reserva';
  const dupCount = importResult.events.filter((ev, i) => importSelected.has(i) && findDuplicate(ev)).length;
  summary.textContent = importResult.events.length === 1
    ? 'Se detectó 1 evento · tocá para editar'
    : `Se detectaron ${importResult.events.length} eventos · tocá para editar`;
  if (dupCount) summary.textContent += ` · ⚠ ${dupCount} duplicado${dupCount > 1 ? 's' : ''}`;

  if (!importResult.events.length) {
    list.innerHTML = `<div class="empty" style="margin:0"><div class="empty__icon">🤔</div><h4>No pude extraer nada</h4><p>Probá con el email completo o elegí el proveedor manualmente.</p></div>`;
  } else {
    list.innerHTML = importResult.events.map((ev, i) => {
      const meta = TYPE_META[ev.type] || TYPE_META.note;
      const isSel = importSelected.has(i);
      const dup = findDuplicate(ev);
      const decision = importDupDecisions.get(i);
      const conf = ev.confidence >= 0.75 ? 'high' : ev.confidence >= 0.5 ? 'mid' : 'low';
      const confLabel = conf === 'high' ? 'Alta' : conf === 'mid' ? 'Media' : 'Baja';
      const when = ev.startAt ? new Date(ev.startAt).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
      return `
        <div class="import-event ${isSel ? 'is-selected' : ''} ${dup ? 'is-dup' : ''}" data-idx="${i}">
          <div class="import-event__icon">${meta.icon}</div>
          <div class="import-event__body">
            <div class="import-event__type">${meta.label}${dup ? `<span class="import-event__dup ${decision ? 'is-decided' : ''}">${decision === 'skip' ? 'Saltar' : decision === 'replace' ? 'Reemplazar' : decision === 'duplicate' ? 'Duplicar' : '⚠ Ya existe'}</span>` : ''}</div>
            <div class="import-event__title">${escapeHtml(ev.title)}<svg class="import-event__pencil"><use href="#i-pencil"/></svg></div>
            <div class="import-event__meta"><svg><use href="#i-clock"/></svg>${when}</div>
            ${ev.place ? `<div class="import-event__meta"><svg><use href="#i-pin"/></svg>${escapeHtml(ev.place)}</div>` : ''}
          </div>
          <div class="import-event__check" data-check="${i}"><svg><use href="#i-check"/></svg></div>
          <span class="import-event__confidence conf--${conf}">${confLabel}</span>
          ${dup && isSel ? `<div class="import-event__dup-actions">
            <button type="button" class="dup-btn ${decision === 'skip' ? 'is-active' : ''}" data-dup="${i}" data-act="skip">Saltar</button>
            <button type="button" class="dup-btn ${decision === 'replace' ? 'is-active' : ''}" data-dup="${i}" data-act="replace">Reemplazar</button>
            <button type="button" class="dup-btn ${decision === 'duplicate' ? 'is-active' : ''}" data-dup="${i}" data-act="duplicate">Duplicar</button>
          </div>` : ''}
        </div>`;
    }).join('');

    list.querySelectorAll('[data-check]').forEach(el => {
      el.addEventListener('click', ev => {
        ev.stopPropagation();
        const i = +el.dataset.check;
        if (importSelected.has(i)) importSelected.delete(i); else importSelected.add(i);
        renderImportPreview();
      });
    });
    list.querySelectorAll('[data-dup]').forEach(el => {
      el.addEventListener('click', ev => {
        ev.stopPropagation();
        const i = +el.dataset.dup, act = el.dataset.act;
        if (importDupDecisions.get(i) === act) importDupDecisions.delete(i);
        else importDupDecisions.set(i, act);
        renderImportPreview();
      });
    });
    list.querySelectorAll('.import-event').forEach(el => {
      el.addEventListener('click', ev => {
        if (ev.target.closest('[data-check]') || ev.target.closest('[data-dup]')) return;
        openPreviewEdit(+el.dataset.idx);
      });
    });
  }

  if (importResult.warnings?.length) {
    warn.hidden = false;
    warnList.innerHTML = importResult.warnings.map(w => `<li>· ${escapeHtml(w)}</li>`).join('');
  } else warn.hidden = true;
}

async function onImportConfirm() {
  if (!importResult) return;
  const selected = importResult.events.map((ev, i) => ({ ev, i })).filter(({ i }) => importSelected.has(i));
  if (!selected.length) { toast('No hay eventos seleccionados'); return; }
  let added = 0, replaced = 0, skipped = 0;
  for (const { ev, i } of selected) {
    const dup = findDuplicate(ev);
    const dec = importDupDecisions.get(i);
    if (dup) {
      if (dec === 'skip') { skipped++; continue; }
      if (dec === 'replace') { await call('deleteEvent', dup.id, { silent: true }); replaced++; }
    }
    await call('saveEvent', {
      id: uid(), tripId: ctx.trip?.id,
      type: ev.type, title: ev.title,
      startAt: ev.startAt || new Date().toISOString(),
      endAt: ev.endAt || null,
      place: ev.place || '', notes: ev.notes || '',
      confirmation_code: ev.confirmation_code || null,
      cost: ev.cost || null, currency: ev.currency || null,
      done: false, updatedAt: Date.now(),
    });
    added++;
  }
  closeModalEl(document.getElementById('importModal'));
  call('setView', 'today');
  const parts = [];
  if (added) parts.push(`${added} agregado${added > 1 ? 's' : ''}`);
  if (replaced) parts.push(`${replaced} reemplazado${replaced > 1 ? 's' : ''}`);
  if (skipped) parts.push(`${skipped} salteado${skipped > 1 ? 's' : ''}`);
  toast(`✓ ${parts.join(' · ')}`);
}

/* Preview edit */
let peCurrentType = 'activity';
function openPreviewEdit(idx) {
  const ev = importResult.events[idx];
  if (!ev) return;
  document.getElementById('peIdx').value = idx;
  document.getElementById('peTitle').value = ev.title || '';
  document.getElementById('peStart').value = ev.startAt ? bus.toLocalInput(ev.startAt) : '';
  document.getElementById('peEnd').value   = ev.endAt   ? bus.toLocalInput(ev.endAt)   : '';
  document.getElementById('pePlace').value = ev.place || '';
  document.getElementById('peCode').value  = ev.confirmation_code || '';
  document.getElementById('peNotes').value = ev.notes || '';
  peCurrentType = ev.type || 'activity';

  const chips = document.getElementById('peTypeChips');
  chips.innerHTML = Object.entries(bus.TYPE_META).map(([k, m]) => `
    <button type="button" class="chip ${k === peCurrentType ? 'is-active' : ''}" data-type="${k}" style="--chip-c:${m.color}">
      <span>${m.icon}</span><span>${m.label}</span>
    </button>`).join('');
  chips.onclick = e => {
    const btn = e.target.closest('.chip'); if (!btn) return;
    peCurrentType = btn.dataset.type;
    chips.querySelectorAll('.chip').forEach(c => c.classList.toggle('is-active', c.dataset.type === peCurrentType));
  };

  document.getElementById('previewEditForm').onsubmit = e => {
    e.preventDefault();
    const i = +document.getElementById('peIdx').value;
    importResult.events[i] = {
      ...importResult.events[i],
      type: peCurrentType,
      title: document.getElementById('peTitle').value.trim(),
      startAt: document.getElementById('peStart').value ? bus.fromLocalInput(document.getElementById('peStart').value) : null,
      endAt:   document.getElementById('peEnd').value   ? bus.fromLocalInput(document.getElementById('peEnd').value)   : null,
      place: document.getElementById('pePlace').value.trim(),
      confirmation_code: document.getElementById('peCode').value.trim() || null,
      notes: document.getElementById('peNotes').value.trim(),
    };
    renderImportPreview();
    closeModalEl(document.getElementById('previewEditModal'));
    toast('Evento actualizado');
  };
  document.getElementById('previewEditModal').onclick = e => {
    if (e.target.hasAttribute('data-preview-edit-close') || e.target.closest('[data-preview-edit-close]')) closeModalEl(document.getElementById('previewEditModal'));
  };
  openModalEl(document.getElementById('previewEditModal'));
  setTimeout(() => document.getElementById('peTitle').focus(), 150);
}

function openImport(prefill = '') {
  resetImport();
  if (prefill) { document.getElementById('importText').value = prefill; updateAnalyzeState(); }
  openModalEl(document.getElementById('importModal'));
  setTimeout(() => document.getElementById('importText').focus(), 200);
}

function resetImport() {
  document.getElementById('importText').value = '';
  importProvider = 'auto';
  document.querySelectorAll('#providerChips .chip').forEach(c => c.classList.toggle('is-active', c.dataset.provider === 'auto'));
  importResult = null;
  importSelected.clear();
  importDupDecisions.clear();
  document.getElementById('importInput').hidden = false;
  document.getElementById('importPreview').hidden = true;
  updateAnalyzeState();
}