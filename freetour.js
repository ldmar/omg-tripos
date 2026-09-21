/* ============================================================
   OhMyGoch Trip OS · freetour.js
   Cliente MCP para GuruWalk · búsqueda de free tours
   API real: https://back.guruwalk.com/mcp
   - JSON-RPC 2.0 sobre POST + JSON plano
   - Stateless · CORS abierto
   - Todo el tráfico va por HTTPS a back.guruwalk.com
   ============================================================ */

const MCP_URL = 'https://back.guruwalk.com/mcp';
const CACHE_TTL_MS = 5 * 60 * 1000;

let nextId = 1;
const cache = new Map();   // key → { t, data }

/* ============================================================
   Core · RPC
   ============================================================ */
async function rpc(method, params, signal) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: nextId++,
      method,
      params,
    }),
    signal,
  });

  if (!res.ok) throw new Error(`GuruWalk HTTP ${res.status}`);

  const json = await res.json();
  if (json.error) {
    const detail = json.error.data ? ` · ${json.error.data}` : '';
    throw new Error(`GuruWalk: ${json.error.message}${detail}`);
  }
  return json.result;
}

async function callTool(name, args, signal) {
  const result = await rpc('tools/call', { name, arguments: args }, signal);
  const text = result?.content?.find(c => c.type === 'text')?.text;
  if (!text) throw new Error(`Tool ${name} sin content`);
  try { return JSON.parse(text); }
  catch { return text; }
}

/* ============================================================
   Caché
   ============================================================ */
function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.t > CACHE_TTL_MS) { cache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data) {
  cache.set(key, { t: Date.now(), data });
}
export function clearCache() { cache.clear(); }

/* ============================================================
   API pública
   ============================================================ */

/**
 * Busca tours y actividades en una ciudad.
 * @param {object} opts
 * @param {string} opts.destination  "Madrid" | "Rome" | "Buenos Aires"
 * @param {string} [opts.language='es']
 * @param {string} [opts.startDate]  'YYYY-MM-DD'
 * @param {string} [opts.endDate]    'YYYY-MM-DD'
 * @param {string} [opts.country]    Desambigua ciudades homónimas
 * @param {number} [opts.adults]
 * @param {number} [opts.children]
 */
export async function searchTours(opts, signal) {
  const key = JSON.stringify(opts);
  const cached = cacheGet(key);
  if (cached) return cached;

  const args = {
    destination: opts.destination,
    language: opts.language || 'es',
  };
  if (opts.startDate) args.start_date = opts.startDate;
  if (opts.endDate)   args.end_date   = opts.endDate;
  if (opts.country)   args.country    = opts.country;
  if (opts.adults)    args.how_many_adults   = opts.adults;
  if (opts.children)  args.how_many_children = opts.children;

  const res = await callTool('search_tours_activities_by_destination', args, signal);

  if (res.coverage === 'none') {
    const empty = {
      destination: res.destination || opts.destination,
      place: null,
      categories: [],
      freeTours: [],
      paid: [],
    };
    cacheSet(key, empty);
    return empty;
  }

  const products = res.featured_products || [];
  const out = {
    destination: res.place?.name || opts.destination,
    place: res.place,
    categories: res.categories || [],
    freeTours: products.filter(p => p.type === 'free_tour'),
    paid: products.filter(p => p.type === 'product'),
    pagination: res.pagination,
    attribution: res.attribution,
  };
  cacheSet(key, out);
  return out;
}

/**
 * Detalle completo de un tour (incluye itinerario, meeting point, cómo encontrar al guía).
 * @param {number|string} productId
 * @param {'free_tour'|'product'} type
 * @param {string} [language='es']
 */
export async function getTourDetail(productId, type, language = 'es', signal) {
  const key = `detail:${productId}:${type}:${language}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const res = await callTool('get_product_detail', {
    items: [{ product_id: Number(productId), type, language }],
  }, signal);

  const detail = res.results?.[0] || null;
  if (detail) cacheSet(key, detail);
  return detail;
}

/**
 * Disponibilidad real por fechas. Batch hasta 20 items.
 * @param {Array<{productId, type, fromDate, toDate}>} items
 */
export async function getAvailability(items, language = 'es', signal) {
  const payload = {
    items: items.map(it => ({
      product_id: String(it.productId),
      type: it.type,
      from_date: it.fromDate,
      to_date: it.toDate || it.fromDate,
      language,
    })),
  };
  const res = await callTool('get_product_availability', payload, signal);
  return res.results || [];
}

/* ============================================================
   Conversión a Event interno
   ============================================================ */

/**
 * Convierte un free tour + su detail en un Event de OhMyGoch.
 * @param {object} tour          Del search (featured_products)
 * @param {object|null} detail   Del getTourDetail
 * @param {string} tripId
 * @param {string} [startAt]     ISO del slot elegido (si el usuario ya eligió)
 * @param {string} [endAt]
 */
export function tourToEvent(tour, detail, tripId, startAt = null, endAt = null) {
  const dur = typeof detail?.duration === 'number' ? detail.duration
            : typeof tour?.duration === 'number' ? tour.duration
            : 120;

  const notes = [];
  if (detail?.guide?.name) notes.push(`Guía: ${detail.guide.name}`);
  if (detail?.how_to_find_me) notes.push(detail.how_to_find_me);
  notes.push(`${dur} min`);
  const placeName = extractPlaceName(detail);
  
  const hasCoords =
    typeof detail?.meeting_point_latitude === 'number' &&
    typeof detail?.meeting_point_longitude === 'number';

  return {
    id: 'ev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    tripId,
    type: 'activity',
    title: (tour?.name || detail?.name || 'Free tour').trim().slice(0, 120),
    startAt,
    endAt,
    // Antes:
    //   place: detail?.meeting_point_url || '',

    place: placeName,
    geo: hasCoords ? {
      lat: detail.meeting_point_latitude,
      lng: detail.meeting_point_longitude,
    } : null,
    notes: notes.filter(Boolean).join(' · '),
    tourMeta: {
      source: 'guruwalk',
      productId: tour?.id || detail?.id || null,
      type: tour?.type || detail?.type || 'free_tour',
      url: tour?.booking_url || detail?.url || null,
      rating: tour?.rating || detail?.reviews?.rating || null,
      reviewsCount: tour?.reviews_count || detail?.reviews?.count || null,
      durationMin: dur,
      guideName: detail?.guide?.name || null,
      howToFindMe: detail?.how_to_find_me || null,
      meetingPointUrl: detail?.meeting_point_url || null,
      meetingPointCoords: hasCoords ? {
        lat: detail.meeting_point_latitude,
        lng: detail.meeting_point_longitude,
      } : null,
      itinerary: detail?.itinerary || [],
      availableLanguages: detail?.available_languages || [],
      booked: false,
    },
    done: false,
    updatedAt: Date.now(),
  };
}

/* ============================================================
   Helpers
   ============================================================ */

export function isTourEvent(ev) {
  return ev?.tourMeta?.source === 'guruwalk';
}

export function tourSubtitle(tour) {
  const parts = [];
  if (tour.rating) parts.push(`⭐ ${tour.rating}`);
  if (tour.reviews_count) parts.push(`(${tour.reviews_count})`);
  if (typeof tour.duration === 'number') parts.push(`${tour.duration} min`);
  return parts.join(' · ');
}

/* ============================================================
   Helper · extrae un nombre legible del meeting point
   GuruWalk devuelve how_to_find_me con texto largo tipo:
   "Guía: X · Estaré en la Plazoleta Carlos Pellegrini, cerca..."
   Tomamos el "lugar" antes del primer punto/coma/· y lo
   limitamos a 80 chars. Fallback: primeras 80 chars del raw.
   ============================================================ */
function extractPlaceName(detail) {
  if (!detail) return '';

  const raw = (detail.how_to_find_me || detail.meeting_point_url || '').trim();
  if (!raw) return '';

  // Cortar en el primer "." / "·" / "," seguido de espacio
  const firstChunk = raw.split(/[.·,]/).map(s => s.trim()).filter(Boolean)[0] || raw;

  // Limpiar prefijos tipo "Guía: Nombre ·" que suelen venir pegados
  const cleaned = firstChunk.replace(/^(gu[ií]a\s*:\s*[^·.]*·?\s*)/i, '').trim();

  if (cleaned.length >= 3 && cleaned.length <= 80) return cleaned;
  return raw.slice(0, 80);
}
