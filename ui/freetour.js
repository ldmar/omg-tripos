/* ============================================================
   ui/freetour.js · Buscar free tours (GuruWalk) + preview + agregar
   ============================================================ */

import * as bus from './bus.js';
import * as freetour from '../freetour.js';
import * as trips from '../trips.js';
import * as sync from '../sync.js';
import * as vault from '../vault.js';
import {
  openModalEl, closeModalEl, toast, escapeHtml, uid, call, emit,
} from './bus.js';

const { ctx } = bus;

/* ---------- Estado ---------- */
let currentResults = null;
let currentQuery = null;
let lastSelectedTour = null;
let detailCache = new Map();      // productId → detail

/* ============================================================
   Init
   ============================================================ */
export function init() {
  const modal = document.getElementById('freetourModal');
  if (!modal) return;

  document.getElementById('freetourOpenBtn')?.addEventListener('click', openSearch);
  document.getElementById('emptyFreetourBtn')?.addEventListener('click', openSearch);
  document.getElementById('ftBackBtnDetail')?.addEventListener('click', backToResults);

  modal.addEventListener('click', e => {
    if (e.target.hasAttribute('data-freetour-close') || e.target.closest('[data-freetour-close]')) close();
  });

  document.getElementById('ftSearchBtn')?.addEventListener('click', doSearch);
  document.getElementById('ftDestination')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
  });

  document.getElementById('ftResults')?.addEventListener('click', onResultClick);
  document.getElementById('ftBackBtn')?.addEventListener('click', backToResults);
}

/* ============================================================
   Apertura / cierre
   ============================================================ */
export function openSearch(prefillCity = '') {
  const modal = document.getElementById('freetourModal');
  if (!modal) return;

  // Pre-llenar con la ciudad del viaje si podemos inferirla
  const city = prefillCity || inferCityFromTrip();

  document.getElementById('ftDestination').value = city;
  document.getElementById('ftSearchView').hidden = false;
  document.getElementById('ftResultsView').hidden = true;
  document.getElementById('ftDetailView').hidden = true;

  currentResults = null;
  currentQuery = null;
  lastSelectedTour = null;

  openModalEl(modal);
  setTimeout(() => document.getElementById('ftDestination').focus(), 150);

  if (city) doSearch();
}

function close() {
  closeModalEl(document.getElementById('freetourModal'));
}

function backToResults() {
  document.getElementById('ftDetailView').hidden = true;
  document.getElementById('ftResultsView').hidden = false;
}

/* ============================================================
   Inferir ciudad desde el viaje activo
   ============================================================ */
function inferCityFromTrip() {
  // 1. Si hay un evento con "place" que matchee una ciudad, usarlo
  for (const ev of ctx.events || []) {
    const p = (ev.place || '').trim();
    if (p && p.length < 40 && !/\d/.test(p)) return p.split(',')[0].trim();
  }
  // 2. Si el título del viaje empieza con "Escapada a X", "Finde en X", etc.
  const m = (ctx.trip?.title || '').match(/(?:a|en|de)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/);
  return m ? m[1] : '';
}

/* ============================================================
   Búsqueda
   ============================================================ */
async function doSearch() {
  const destination = document.getElementById('ftDestination').value.trim();
  if (!destination) { toast('Poné una ciudad'); return; }

  const btn = document.getElementById('ftSearchBtn');
  const results = document.getElementById('ftResults');

  btn.disabled = true;
  btn.textContent = 'Buscando…';
  results.innerHTML = `<div class="ft-loading"><div class="pdf-drop__spinner"></div><span>Consultando GuruWalk…</span></div>`;

  // Rango de fechas: sólo si el viaje las tiene. Si no, dejar que GuruWalk
  // aplique su default (booking date ± 2 días) y devuelva todo lo agendable.
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

    // Fallback: si no hubo resultados con las fechas del viaje, reintentar
    // sin rango (por si los tours operan en otras fechas)
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
    console.warn('[freetour] search falló:', err);
    if (!navigator.onLine) {
      results.innerHTML = `<div class="ft-empty"><div class="ft-empty__icon">📡</div><h4>Sin conexión</h4><p>Para buscar free tours necesitás internet. Los que ya agregaste están guardados.</p></div>`;
    } else {
      results.innerHTML = `<div class="ft-empty"><div class="ft-empty__icon">😕</div><h4>No pude buscar</h4><p>${escapeHtml(err.message)}</p></div>`;
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

  if (!res.freeTours.length && !res.paid.length) {
    head.textContent = `Sin resultados para "${res.destination}"`;
    body.innerHTML = `<div class="ft-empty"><div class="ft-empty__icon">🔍</div><h4>Sin tours disponibles</h4><p>Probá con otra ciudad, o ajustá las fechas del viaje.</p></div>`;
    return;
  }

  head.textContent = `${res.destination} · ${res.freeTours.length} free tour${res.freeTours.length === 1 ? '' : 's'} encontrado${res.freeTours.length === 1 ? '' : 's'}`;

  const html = [];
  for (const t of res.freeTours) html.push(renderTourCard(t));
  if (res.paid.length) {
    html.push(`<div class="ft-section-sep">Otras actividades pagas</div>`);
    for (const t of res.paid.slice(0, 4)) html.push(renderProductCard(t));
  }
  body.innerHTML = html.join('');
}

function renderTourCard(t) {
  const rating = t.rating ? `⭐ ${t.rating}` : '';
  const reviews = t.reviews_count ? `· ${t.reviews_count} reseñas` : '';
  const dur = typeof t.duration === 'number' ? `· ${t.duration} min` : '';

  return `
    <article class="ft-card ft-card--free" data-tour-id="${t.id}" data-tour-type="free_tour">
      <div class="ft-card__badge">Free tour</div>
      <h4 class="ft-card__title">${escapeHtml(t.name)}</h4>
      <div class="ft-card__meta">
        ${rating ? `<span>${rating}</span>` : ''}
        ${reviews ? `<span>${reviews}</span>` : ''}
        ${dur ? `<span>${dur}</span>` : ''}
      </div>
      <div class="ft-card__actions">
        <button type="button" class="ft-card__cta" data-action="detail" data-id="${t.id}">
          Ver detalle
        </button>
      </div>
    </article>`;
}

function renderProductCard(t) {
  const price = t.pricing_from?.retail
    ? `${t.pricing_from.currency || '€'} ${t.pricing_from.retail}`
    : '';
  return `
    <article class="ft-card ft-card--paid" data-tour-id="${t.id}" data-tour-type="product">
      <div class="ft-card__badge ft-card__badge--paid">Actividad</div>
      <h4 class="ft-card__title">${escapeHtml(t.name)}</h4>
      <div class="ft-card__meta">
        ${t.rating ? `<span>⭐ ${t.rating}</span>` : ''}
        ${price ? `<span>desde ${price}</span>` : ''}
      </div>
      <div class="ft-card__actions">
        <a class="ft-card__link" href="${t.booking_url}" target="_blank" rel="noopener">
          Ver y reservar →
        </a>
      </div>
    </article>`;
}

/* ============================================================
   Click en card → detail
   ============================================================ */
function onResultClick(e) {
  const btn = e.target.closest('[data-action="detail"]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  openDetail(id);
}

/* ============================================================
   Detalle
   ============================================================ */
async function openDetail(productId) {
  document.getElementById('ftResultsView').hidden = true;
  document.getElementById('ftDetailView').hidden = false;

  const container = document.getElementById('ftDetailBody');
  container.innerHTML = `<div class="ft-loading"><div class="pdf-drop__spinner"></div><span>Cargando detalle…</span></div>`;

  try {
    let detail = detailCache.get(productId);
    if (!detail) {
      detail = await freetour.getTourDetail(productId, 'free_tour', 'es');
      if (detail) detailCache.set(productId, detail);
    }
    if (!detail) {
      container.innerHTML = `<div class="ft-empty"><div class="ft-empty__icon">😕</div><h4>Sin detalle</h4><p>No pude cargar la información de este tour.</p></div>`;
      return;
    }
    renderDetail(detail);
  } catch (err) {
    console.warn('[freetour] detail falló:', err);
    container.innerHTML = `<div class="ft-empty"><div class="ft-empty__icon">😕</div><h4>Error</h4><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function renderDetail(d) {
  const container = document.getElementById('ftDetailBody');
  const dur = typeof d.duration === 'number' ? `${d.duration} min` : (d.duration || '—');

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
        ${d.meeting_point_url ? `<a class="ft-detail__maplink" href="${d.meeting_point_url}" target="_blank" rel="noopener">Ver en el mapa →</a>` : ''}
      </div>`
    : '';

  const guideHtml = d.guide?.name
    ? `<div class="ft-detail__guide"><span class="ft-detail__guide-label">Guía</span> ${escapeHtml(d.guide.name)}</div>`
    : '';

  container.innerHTML = `
    <article class="ft-detail">
      <header class="ft-detail__head">
        <h3>${escapeHtml(d.name || 'Free tour')}</h3>
        <div class="ft-detail__meta">
          ${d.reviews?.rating ? `<span>⭐ ${d.reviews.rating}</span>` : ''}
          ${d.reviews?.count ? `<span>· ${d.reviews.count} reseñas</span>` : ''}
          <span>· ${escapeHtml(String(dur))}</span>
        </div>
        ${guideHtml}
      </header>

      ${meetingHtml}
      ${itineraryHtml}

      <div class="ft-detail__actions">
        <button type="button" class="btn btn--primary btn--lg" id="ftAddBtn">
          Agregar al itinerario
        </button>
        ${d.url ? `<a class="btn btn--ghost" href="${d.url}" target="_blank" rel="noopener">Reservar en GuruWalk →</a>` : ''}
      </div>
    </article>`;

  document.getElementById('ftAddBtn').addEventListener('click', () => addTourToTrip(d));
}

/* ============================================================
   Agregar al itinerario
   ============================================================ */
async function addTourToTrip(detail) {
  if (!ctx.trip?.id) { toast('Sin viaje activo'); return; }
  if (!vault.isUnlocked()) { toast('Desbloqueá el wallet primero'); return; }

  // Buscar el tour en los resultados cacheados (para recuperar booking_url)
  const tour = currentResults?.freeTours?.find(t => t.id === detail.id || t.id === detail.product_id);
  if (!tour) { toast('Tour no encontrado en los resultados'); return; }

  // Por defecto: primer día del viaje, 10:00 local
  const baseDate = ctx.trip?.startDate
    ? new Date(ctx.trip.startDate + 'T10:00:00')
    : new Date(Date.now() + 24 * 3600 * 1000);

  const startAt = baseDate.toISOString();
  const durMin = typeof detail.duration === 'number' ? detail.duration : 120;
  const endAt = new Date(baseDate.getTime() + durMin * 60000).toISOString();

  const ev = freetour.tourToEvent(tour, detail, ctx.trip.id, startAt, endAt);
  ev.type = 'freetour';   // override: tipo específico para mejor UX

  await call('saveEvent', ev);

  close();
  call('setView', 'today');

  toast(`✓ "${ev.title.slice(0, 40)}${ev.title.length > 40 ? '…' : ''}" agregado · tocá para editar horario`);
}

/* ============================================================
   Re-export para uso externo
   ============================================================ */
export { openSearch as open };
