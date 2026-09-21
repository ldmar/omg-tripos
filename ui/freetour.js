/* ============================================================
   ui/freetour.js · Buscar free tours (GuruWalk) + preview + agregar
   - Vistas: search → results → detail
   - Guard contra PointerEvent pasado como argumento
   - Sin dependencias externas: usa freetour.js como cliente MCP
   ============================================================ */

import * as bus from './bus.js';
import * as freetour from '../freetour.js';
import * as vault from '../vault.js';
import {
  openModalEl, closeModalEl, toast, escapeHtml, call,
} from './bus.js';

const { ctx } = bus;

/* ============================================================
   Estado del módulo
   ============================================================ */
let currentResults = null;
let currentQuery = null;
let detailCache = new Map();       // productId → detail (in-memory)

/* ============================================================
   Guard: detectar si un argumento es un Event y no un string
   ============================================================ */
function isEventLike(x) {
  return !!x && typeof x === 'object' &&
    ('target' in x || 'preventDefault' in x || 'type' in x);
}

function cleanString(x) {
  if (isEventLike(x)) return '';
  if (typeof x !== 'string') return '';
  if (x.includes('[object')) return '';
  return x.trim();
}

/* ============================================================
   Init · wireo todo una sola vez
   ============================================================ */
export function init() {
  const modal = document.getElementById('freetourModal');
  if (!modal) {
    console.warn('[ui/freetour] modal #freetourModal no existe en el DOM');
    return;
  }

  // Abridores · listeners SIN pasar el event a openSearch
  document.getElementById('freetourOpenBtn')?.addEventListener('click', () => openSearch());
  document.getElementById('emptyFreetourBtn')?.addEventListener('click', () => openSearch());

  // Cierre
  modal.addEventListener('click', e => {
    if (e.target.hasAttribute('data-freetour-close') ||
        e.target.closest('[data-freetour-close]')) {
      close();
    }
  });

  // Vista 1: búsqueda · listener SIN pasar el event a doSearch
  document.getElementById('ftSearchBtn')?.addEventListener('click', () => doSearch());
  document.getElementById('ftDestination')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
  });

  // Vista 2: resultados
  document.getElementById('ftResults')?.addEventListener('click', onResultClick);
  document.getElementById('ftBackBtn')?.addEventListener('click', () => backToSearch());

  // Vista 3: detalle
  document.getElementById('ftBackBtnDetail')?.addEventListener('click', () => backToResults());

  // Escape cierra el modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.hidden) close();
  });
}

/* ============================================================
   Apertura / cierre
   ============================================================ */
export function openSearch(prefillCity = '') {
  // Blindaje: si llega un Event, ignorarlo
  prefillCity = cleanString(prefillCity);

  const modal = document.getElementById('freetourModal');
  if (!modal) return;

  const input = document.getElementById('ftDestination');

  // Limpiar input si quedó basura de una sesión previa
  if (input.value.includes('[object')) input.value = '';

  const city = prefillCity || inferCityFromTrip();
  input.value = city;

  // Reset de vistas
  document.getElementById('ftSearchView').hidden = false;
  document.getElementById('ftResultsView').hidden = true;
  document.getElementById('ftDetailView').hidden = true;

  currentResults = null;
  currentQuery = null;

  openModalEl(modal);
  setTimeout(() => input.focus(), 150);

  if (city) doSearch();
}

export function close() {
  closeModalEl(document.getElementById('freetourModal'));
}

function backToSearch() {
  document.getElementById('ftResultsView').hidden = true;
  document.getElementById('ftDetailView').hidden = true;
  document.getElementById('ftSearchView').hidden = false;

  // Restaurar el último input válido, no basura
  const input = document.getElementById('ftDestination');
  if (input.value.includes('[object')) input.value = '';
  const last = currentQuery?.destination;
  if (last) input.value = last;

  setTimeout(() => input.focus(), 150);
}

function backToResults() {
  document.getElementById('ftDetailView').hidden = true;
  document.getElementById('ftResultsView').hidden = false;
}

/* ============================================================
   Inferencia de ciudad desde el viaje activo
   ============================================================ */
function inferCityFromTrip() {
  // 1. Buscar en los places de los eventos ya cargados
  for (const ev of ctx.events || []) {
    const p = (ev.place || '').trim();
    if (!p) continue;
    if (p.length > 40) continue;
    if (p.includes('http')) continue;               // descartar URLs
    if (/\d/.test(p)) continue;                     // descartar direcciones con números
    if (/^(aeropuerto|hotel|hostal|airbnb)/i.test(p)) continue;
    return p.split(',')[0].trim();
  }

  // 2. Si el título es "Escapada a Madrid", "Finde en Bariloche", "Viaje a Roma"
  const m = (ctx.trip?.title || '').match(/(?:a|en|de)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/);
  return m ? m[1] : '';
}

/* ============================================================
   Búsqueda
   ============================================================ */
async function doSearch() {
  // Blindaje: si llegó un event desde algún listener mal wireado, ignorarlo
  const input = document.getElementById('ftDestination');
  const destination = cleanString(input.value);

  if (!destination) {
    toast('Poné una ciudad primero');
    return;
  }

  const btn = document.getElementById('ftSearchBtn');
  const results = document.getElementById('ftResults');

  btn.disabled = true;
  btn.textContent = 'Buscando…';
  results.innerHTML = `
    <div class="ft-loading">
      <div class="pdf-drop__spinner"></div>
      <span>Consultando GuruWalk…</span>
    </div>`;

  // Rango de fechas: del viaje si las tiene, si no dejar que GuruWalk aplique default
  const hasDates = !!(ctx.trip?.startDate && ctx.trip?.endDate);
  const startDate = hasDates ? ctx.trip.startDate.slice(0, 10) : null;
  const endDate   = hasDates ? ctx.trip.endDate.slice(0, 10)   : null;

  try {
    let res = await freetour.searchTours({
      destination,
      language: 'es',
      startDate,
      endDate,
      adults: ctx.trip?.travelers || 2,
    });

    // Fallback: si no hubo resultados con las fechas del viaje, reintentar sin rango
    if (!res.freeTours.length && !res.paid.length && hasDates) {
      console.info('[ui/freetour] sin resultados con fechas del viaje, reintentando sin rango');
      res = await freetour.searchTours({
        destination,
        language: 'es',
        adults: ctx.trip?.travelers || 2,
      });
    }

    currentResults = res;
    currentQuery = { destination, startDate, endDate };

    renderResults(res);
  } catch (err) {
    console.warn('[ui/freetour] search falló:', err);

    if (!navigator.onLine) {
      results.innerHTML = `
        <div class="ft-empty">
          <div class="ft-empty__icon">📡</div>
          <h4>Sin conexión</h4>
          <p>Para buscar free tours nuevos necesitás internet. Los que ya agregaste siguen guardados y disponibles offline.</p>
        </div>`;
    } else {
      results.innerHTML = `
        <div class="ft-empty">
          <div class="ft-empty__icon">😕</div>
          <h4>No pude buscar</h4>
          <p>${escapeHtml(err.message || 'Error desconocido')}</p>
        </div>`;
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Buscar';
  }
}

/* ============================================================
   Render · lista de resultados
   ============================================================ */
function renderResults(res) {
  document.getElementById('ftSearchView').hidden = true;
  document.getElementById('ftResultsView').hidden = false;

  const head = document.getElementById('ftResultsHead');
  const body = document.getElementById('ftResults');

  const freeCount = res.freeTours?.length || 0;
  const paidCount = res.paid?.length || 0;

  if (!freeCount && !paidCount) {
    head.textContent = `Sin resultados para "${res.destination}"`;

    // Distinguir cobertura vs fechas
    const hint = res.place
      ? 'GuruWalk no tiene tours disponibles para esas fechas. Probá ajustar el rango del viaje o buscá otra ciudad.'
      : `GuruWalk todavía no tiene cobertura en "${res.destination}".`;

    body.innerHTML = `
      <div class="ft-empty">
        <div class="ft-empty__icon">🔍</div>
        <h4>Sin tours disponibles</h4>
        <p>${escapeHtml(hint)}</p>
      </div>`;
    return;
  }

  head.textContent = freeCount > 0
    ? `${res.destination} · ${freeCount} free tour${freeCount === 1 ? '' : 's'}`
    : `${res.destination} · sin free tours`;

  const html = [];
  for (const t of res.freeTours) html.push(renderTourCard(t));

  if (res.paid?.length) {
    html.push(`<div class="ft-section-sep">Otras actividades pagas</div>`);
    for (const t of res.paid.slice(0, 4)) html.push(renderProductCard(t));
  }

  body.innerHTML = html.join('');
}

function renderTourCard(t) {
  const rating = t.rating ? `⭐ ${t.rating}` : '';
  const reviews = t.reviews_count ? `${t.reviews_count} reseñas` : '';
  const dur = typeof t.duration === 'number' ? `${t.duration} min` : '';
  const metaParts = [rating, reviews, dur].filter(Boolean);

  return `
    <article class="ft-card ft-card--free" data-tour-id="${t.id}" data-tour-type="free_tour">
      <div class="ft-card__badge">Free tour</div>
      <h4 class="ft-card__title">${escapeHtml(t.name || 'Free tour')}</h4>
      ${metaParts.length ? `<div class="ft-card__meta">${metaParts.map(p => `<span>${escapeHtml(p)}</span>`).join('')}</div>` : ''}
      <div class="ft-card__actions">
        <button type="button" class="ft-card__cta" data-action="detail" data-id="${t.id}">
          Ver detalle
        </button>
      </div>
    </article>`;
}

function renderProductCard(t) {
  const price = t.pricing_from?.retail
    ? `desde ${t.pricing_from.currency || '€'} ${t.pricing_from.retail}`
    : '';
  const rating = t.rating ? `⭐ ${t.rating}` : '';
  const metaParts = [rating, price].filter(Boolean);

  return `
    <article class="ft-card ft-card--paid" data-tour-id="${t.id}" data-tour-type="product">
      <div class="ft-card__badge ft-card__badge--paid">Actividad</div>
      <h4 class="ft-card__title">${escapeHtml(t.name || 'Actividad')}</h4>
      ${metaParts.length ? `<div class="ft-card__meta">${metaParts.map(p => `<span>${escapeHtml(p)}</span>`).join('')}</div>` : ''}
      <div class="ft-card__actions">
        <a class="ft-card__link" href="${t.booking_url}" target="_blank" rel="noopener">
          Ver y reservar →
        </a>
      </div>
    </article>`;
}

/* ============================================================
   Click en card → abrir detalle
   ============================================================ */
function onResultClick(e) {
  const btn = e.target.closest('[data-action="detail"]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (Number.isNaN(id)) return;
  openDetail(id);
}

/* ============================================================
   Detalle
   ============================================================ */
async function openDetail(productId) {
  document.getElementById('ftResultsView').hidden = true;
  document.getElementById('ftDetailView').hidden = false;

  const container = document.getElementById('ftDetailBody');
  container.innerHTML = `
    <div class="ft-loading">
      <div class="pdf-drop__spinner"></div>
      <span>Cargando detalle…</span>
    </div>`;

  try {
    let detail = detailCache.get(productId);
    if (!detail) {
      detail = await freetour.getTourDetail(productId, 'free_tour', 'es');
      if (detail) detailCache.set(productId, detail);
    }

    if (!detail) {
      container.innerHTML = `
        <div class="ft-empty">
          <div class="ft-empty__icon">😕</div>
          <h4>Sin detalle</h4>
          <p>No pude cargar la información de este tour.</p>
        </div>`;
      return;
    }

    renderDetail(detail);
  } catch (err) {
    console.warn('[ui/freetour] detail falló:', err);
    container.innerHTML = `
      <div class="ft-empty">
        <div class="ft-empty__icon">😕</div>
        <h4>Error</h4>
        <p>${escapeHtml(err.message || 'Error desconocido')}</p>
      </div>`;
  }
}

function renderDetail(d) {
  const container = document.getElementById('ftDetailBody');
  const dur = typeof d.duration === 'number'
    ? `${d.duration} min`
    : (d.duration || '—');

  const itineraryHtml = (d.itinerary || []).length
    ? `<div class="ft-detail__section">
        <h5>Itinerario</h5>
        <ol class="ft-detail__itinerary">
          ${d.itinerary.map(stop => `<li>${escapeHtml(stop)}</li>`).join('')}
        </ol>
      </div>`
    : '';

  const meetingHtml = d.how_to_find_me
    ? `<div class="ft-detail__section ft-detail__section--meet">
        <h5>Cómo encontrarlo</h5>
        <p>${escapeHtml(d.how_to_find_me)}</p>
        ${d.meeting_point_url
          ? `<a class="ft-detail__maplink" href="${d.meeting_point_url}" target="_blank" rel="noopener">Ver en el mapa →</a>`
          : ''}
      </div>`
    : '';

  const guideHtml = d.guide?.name
    ? `<div class="ft-detail__guide">
        <span class="ft-detail__guide-label">Guía</span> ${escapeHtml(d.guide.name)}
      </div>`
    : '';

  const metaParts = [];
  if (d.reviews?.rating) metaParts.push(`⭐ ${d.reviews.rating}`);
  if (d.reviews?.count)  metaParts.push(`${d.reviews.count} reseñas`);
  metaParts.push(dur);

  container.innerHTML = `
    <article class="ft-detail">
      <header class="ft-detail__head">
        <h3>${escapeHtml(d.name || 'Free tour')}</h3>
        <div class="ft-detail__meta">
          ${metaParts.map(p => `<span>${escapeHtml(p)}</span>`).join('')}
        </div>
        ${guideHtml}
      </header>

      ${meetingHtml}
      ${itineraryHtml}

      <div class="ft-detail__actions">
        <button type="button" class="btn btn--primary btn--lg" id="ftAddBtn">
          Agregar al itinerario
        </button>
        ${d.url
          ? `<a class="btn btn--ghost" href="${d.url}" target="_blank" rel="noopener">Reservar en GuruWalk →</a>`
          : ''}
      </div>
    </article>`;

  document.getElementById('ftAddBtn')?.addEventListener('click', () => addTourToTrip(d));
}

/* ============================================================
   Agregar al itinerario
   ============================================================ */
async function addTourToTrip(detail) {
  if (!ctx.trip?.id) {
    toast('Sin viaje activo');
    return;
  }
  if (!vault.isUnlocked()) {
    toast('Desbloqueá el wallet primero');
    return;
  }

  // Recuperar el tour original desde los resultados
  const tour = currentResults?.freeTours?.find(t =>
    t.id === detail.id || t.id === detail.product_id
  );

  if (!tour) {
    toast('Tour no encontrado en los resultados');
    return;
  }

  // Por defecto: primer día del viaje a las 10:00, o mañana a las 10:00
  let baseDate;
  if (ctx.trip?.startDate) {
    baseDate = new Date(ctx.trip.startDate + 'T10:00:00');
  } else {
    baseDate = new Date();
    baseDate.setDate(baseDate.getDate() + 1);
    baseDate.setHours(10, 0, 0, 0);
  }

  const startAt = baseDate.toISOString();
  const durMin = typeof detail.duration === 'number'
    ? detail.duration
    : (typeof tour.duration === 'number' ? tour.duration : 120);
  const endAt = new Date(baseDate.getTime() + durMin * 60000).toISOString();

  const ev = freetour.tourToEvent(tour, detail, ctx.trip.id, startAt, endAt);
  ev.type = 'freetour';

  await call('saveEvent', ev);

  close();
  call('setView', 'today');

  const displayTitle = ev.title.length > 40 ? ev.title.slice(0, 40) + '…' : ev.title;
  toast(`✓ "${displayTitle}" agregado · tocá para editar horario`);
}

/* ============================================================
   Re-export para uso externo
   ============================================================ */
export { openSearch as open };