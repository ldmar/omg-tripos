/* ============================================================
   ui/today.js · Hero + Next card + Timeline
   ============================================================ */

import * as bus from './bus.js';
import * as notif from '../notifications.js';
import { TYPE_META, escapeHtml, fmtTime, relTime, fmtDateShort, isToday, call } from './bus.js';

const { ctx } = bus;

export function init() {
  document.getElementById('clearDoneBtn')?.addEventListener('click', clearDone);
  document.getElementById('nextCta')?.addEventListener('click', () => {
    const n = computeNext();
    if (n) call('openEventModal', n.id);
  });
  document.getElementById('emptyImportBtn')?.addEventListener('click', () => bus.emit('open-import'));
  document.getElementById('emptyCreateBtn')?.addEventListener('click', () => call('openEventModal'));
}

export function render() {
  renderHero();
  renderNext();
  renderTimeline();
}

/* ---------- Hero ---------- */
function computeDayNumber() {
  const trip = ctx.trip;
  if (!trip?.startDate) return null;
  const start = new Date(trip.startDate);
  const now = new Date();
  const diff = Math.floor((now - start) / 86400000) + 1;
  if (diff < 1 || (trip.days && diff > trip.days)) return null;
  return diff;
}

function renderHero() {
  const trip = ctx.trip;
  const events = ctx.events;
  const tripTitle = trip?.title || 'Mi viaje';
  const tripFlag = trip?.flag || '🌍';

  document.getElementById('tripFlagEmoji').textContent = tripFlag;
  document.getElementById('tripTitle').textContent = tripTitle;
  document.getElementById('heroTripName').textContent = tripTitle;

  const dayNum = computeDayNumber();
  const heroDay = document.getElementById('heroDay');
  if (dayNum && trip?.days) heroDay.textContent = `Día ${dayNum} de ${trip.days}`;
  else if (trip?.startDate && trip?.days) heroDay.textContent = `${trip.days} días`;
  else heroDay.textContent = 'Tu viaje';

  const heroDate = document.getElementById('heroDate');
  if (trip?.startDate && trip?.endDate) {
    heroDate.textContent = `${fmtDateShort(trip.startDate)} → ${fmtDateShort(trip.endDate)}`;
  } else {
    heroDate.textContent = fmtDateShort(new Date().toISOString());
  }

  document.getElementById('heroDays').textContent = trip?.days
    ? `${trip.days} día${trip.days > 1 ? 's' : ''}` : 'Sin fechas';
  document.getElementById('heroTravelers').textContent = trip?.travelers
    ? `${trip.travelers} viajero${trip.travelers > 1 ? 's' : ''}` : 'Sin viajeros';

  const today = events.filter(e => isToday(e.startAt));
  const done = today.filter(e => e.done).length;
  const pct = today.length ? Math.round((done / today.length) * 100) : 0;
  document.getElementById('heroProgress').style.width = pct + '%';
}

/* ---------- Next ---------- */
function computeNext() {
  const now = Date.now();
  return ctx.events
    .filter(e => !e.done && new Date(e.startAt).getTime() > now - 5 * 60 * 1000)
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))[0];
}

function renderNext() {
  const card = document.getElementById('nextCard');
  const n = computeNext();
  if (!n) { card.style.display = 'none'; return; }
  card.style.display = '';
  document.getElementById('nextTitle').textContent = n.title;
  document.getElementById('nextTime').textContent  = `${fmtTime(n.startAt)} · ${relTime(n.startAt)}`;
  document.getElementById('nextPlace').textContent = n.place || 'Sin ubicación';
}

/* ---------- Timeline ---------- */
function renderTimeline() {
  const ol = document.getElementById('timeline');
  const empty = document.getElementById('emptyState');
  const events = ctx.events;

  if (!events.length) {
    ol.innerHTML = '';
    empty.hidden = false;
    const name = ctx.trip?.title || 'tu viaje';
    document.getElementById('emptyTitle').textContent = `Sin eventos en "${name}"`;
    document.getElementById('emptyDesc').innerHTML =
      `Tocá <strong>+</strong> para agregar un evento, o <strong>📥</strong> para importar tu reserva.`;
    return;
  }
  empty.hidden = true;

  const now = Date.now();
  const ns = notif.getSettings();

  ol.innerHTML = events.map(e => {
    const meta = TYPE_META[e.type] || TYPE_META.note;
    const t = new Date(e.startAt).getTime();
    const isLive = !e.done && t <= now && now - t < 3600000;
    const isNext = !e.done && t > now;
    const status = e.done ? 'done' : (isLive || isNext ? 'next' : 'upcoming');

    const hasReminder = ns.enabled && !e.done && e.startAt && !e.noReminder;
    const reminderBadge = hasReminder
      ? `<span class="tl__reminder">🔔 ${e.reminderMin ?? ns.leadMin}m</span>` : '';

    return `
      <li class="tl tl--${e.type} tl--${status}" data-id="${e.id}">
        <div class="tl__rail">
          <span class="tl__dot" data-toggle="${e.id}" title="${e.done ? 'Marcar pendiente' : 'Marcar hecho'}">
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
      </li>`;
  }).join('');

  ol.querySelectorAll('[data-toggle]').forEach(el => {
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      call('toggleDone', el.dataset.toggle);
    });
  });
  ol.querySelectorAll('[data-edit]').forEach(el => {
    el.addEventListener('click', () => call('openEventModal', el.dataset.edit));
  });
}

/* ---------- Clear done ---------- */
async function clearDone() {
  const done = ctx.events.filter(e => e.done);
  if (!done.length) { bus.toast('No hay eventos hechos'); return; }
  if (!confirm(`¿Eliminar ${done.length} evento(s) ya realizados?`)) return;
  for (const e of done) await call('deleteEvent', e.id, { silent: true });
  bus.toast('Eventos limpiados');
}