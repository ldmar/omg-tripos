/* ============================================================
   OhMyGoch Trip OS · parser.js
   Motor de Import Mágico · 100% cliente · funciona offline
   Proveedores: Booking · Airbnb · Vuelo · Auto · Genérico
   ============================================================ */

/* ---------- Diccionario de meses (es + en) ---------- */
const MONTHS = {
  enero:0, febrero:1, marzo:2, abril:3, mayo:4, junio:5, julio:6,
  agosto:7, septiembre:8, setiembre:8, octubre:9, noviembre:10, diciembre:11,
  ene:0, feb:1, mar:2, abr:3, may:4, jun:5, jul:6, ago:7, sep:8, set:8, oct:9, nov:10, dic:11,
  january:0, february:1, march:2, april:3, may:4, june:5, july:6,
  august:7, september:8, october:9, november:10, december:11,
  jan:0, apr:3, aug:7, dec:11
};

/* ============================================================
   Parser de fechas
   ============================================================ */
export function parseDate(str, refYear) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase();
  const year = refYear || new Date().getFullYear();

  // ISO: 2026-10-05
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);

  // dd/mm/yyyy · dd-mm-yyyy · dd.mm.yyyy
  m = s.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    return new Date(y, +m[2] - 1, +m[1]);
  }

  // "5 de octubre de 2026" · "5 octubre 2026" · "5 de octubre"
  m = s.match(/(\d{1,2})\s*(?:de\s+)?([a-záéíóúñ]+)(?:\s*(?:de\s+|,\s*)?(\d{4}))?/);
  if (m && MONTHS[m[2]] !== undefined) {
    return new Date(m[3] ? +m[3] : year, MONTHS[m[2]], +m[1]);
  }

  // "october 5, 2026" · "october 5"
  m = s.match(/([a-záéíóúñ]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?/);
  if (m && MONTHS[m[1]] !== undefined) {
    return new Date(m[3] ? +m[3] : year, MONTHS[m[1]], +m[2]);
  }

  return null;
}

/* ---------- Helpers ---------- */
function toISO(date, time) {
  if (!date) return null;
  const d = new Date(date);
  if (time && /^\d{1,2}:\d{2}/.test(time)) {
    const [h, min] = time.split(':').map(Number);
    d.setHours(h || 0, min || 0, 0, 0);
  }
  return d.toISOString();
}

function pick(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function confidence(score) {
  return Math.max(0, Math.min(1, score));
}

/* ============================================================
   PARSER · Booking.com
   ============================================================ */
function parseBooking(text) {
  const events = [];
  const warnings = [];

  const code = pick(text, [
    /(?:n[uú]mero de reserva|reservation number|c[oó]digo de reserva)[:\s#]*([A-Z0-9\-]{6,20})/i
  ]);

  const hotelName = pick(text, [
    /(?:Hotel|Alojamiento|Propiedad|Accommodation)[:\s]+([^\n,]{4,80})/i,
    /^\s*([A-ZÁÉÍÓÚÑ][^\n]{5,70})\s*$/m
  ]) || 'Alojamiento';

  const address = pick(text, [
    /(?:Direcci[oó]n|Address)[:\s]+([^\n]{5,120})/i
  ]) || '';

  const checkinRaw = pick(text, [
    /Check-?\s*in[:\s]+([^\n]{4,60}?)(?:\s+A partir|\s+from|\n|$)/i,
    /Check-?\s*in[:\s]+([^\n]+)/i
  ]);
  const checkinDate = parseDate(checkinRaw);

  const checkinTime = pick(text, [
    /(?:A partir de las|from)[:\s]+(\d{1,2}:\d{2})/i
  ]) || '15:00';

  const checkoutRaw = pick(text, [
    /Check-?\s*out[:\s]+([^\n]{4,60}?)(?:\s+Antes|\s+before|\n|$)/i,
    /Check-?\s*out[:\s]+([^\n]+)/i
  ]);
  const checkoutDate = parseDate(checkoutRaw);

  const checkoutTime = pick(text, [
    /(?:Antes de las|before)[:\s]+(\d{1,2}:\d{2})/i
  ]) || '12:00';

  const priceRaw = pick(text, [
    /(?:Total|Importe total)[:\s]*[€$£]?\s*([\d.,]+)/i,
    /([\d.,]+)\s*[€$£]/i
  ]);
  const price = priceRaw ? priceRaw.replace(',', '.') : null;

  if (!checkinDate) warnings.push('No pude detectar la fecha de check-in');
  if (!hotelName || hotelName === 'Alojamiento') warnings.push('No detecté el nombre del alojamiento');

  const notesParts = [];
  if (code) notesParts.push(`Ref. ${code}`);
  if (price) notesParts.push(`Total €${price}`);

  if (checkinDate) {
    events.push({
      type: 'hotel',
      title: hotelName,
      startAt: toISO(checkinDate, checkinTime),
      endAt: checkoutDate ? toISO(checkoutDate, checkoutTime) : null,
      place: address,
      notes: notesParts.join(' · '),
      confirmation_code: code,
      cost: price,
      currency: 'EUR',
      confidence: confidence(
        0.4 + (checkinDate ? 0.25 : 0) + (hotelName !== 'Alojamiento' ? 0.15 : 0) +
        (address ? 0.1 : 0) + (code ? 0.1 : 0)
      )
    });
  }

  return { provider: 'booking', providerName: 'Booking.com', events, warnings };
}

/* ============================================================
   PARSER · Airbnb
   ============================================================ */
function parseAirbnb(text) {
  const events = [];
  const warnings = [];

  const code = pick(text, [
    /(?:c[oó]digo de confirmaci[oó]n|confirmation code)[:\s]*([A-Z0-9]{6,15})/i
  ]);

  const listing = pick(text, [
    /(?:Alojamiento|Listing|Propiedad|Apartamento|Apartment)[:\s]+([^\n]{4,80})/i,
    /^\s*(Apartamento[^\n]{3,60})\s*$/im,
    /^\s*(Casa[^\n]{3,60})\s*$/im
  ]) || 'Alojamiento Airbnb';

  const address = pick(text, [
    /(?:Direcci[oó]n|Address|Ubicaci[oó]n)[:\s]+([^\n]{5,120})/i
  ]) || '';

  const checkinRaw = pick(text, [
    /(?:Llegada|Check-?\s*in|Checkin|Arrival)[:\s]+([^\n]{4,60})/i
  ]);
  const checkinDate = parseDate(checkinRaw);

  const checkoutRaw = pick(text, [
    /(?:Salida|Check-?\s*out|Checkout|Departure)[:\s]+([^\n]{4,60})/i
  ]);
  const checkoutDate = parseDate(checkoutRaw);

  const priceRaw = pick(text, [
    /(?:Total|Importe total)[:\s]*[€$£]?\s*([\d.,]+)/i
  ]);
  const price = priceRaw ? priceRaw.replace(',', '.') : null;

  const checkinTime = pick(text, [/(?:Llegada|Check-?\s*in)[^\n]*?(\d{1,2}:\d{2})/i]) || '15:00';
  const checkoutTime = pick(text, [/(?:Salida|Check-?\s*out)[^\n]*?(\d{1,2}:\d{2})/i]) || '11:00';

  if (!checkinDate) warnings.push('No pude detectar la fecha de llegada');

  if (checkinDate) {
    events.push({
      type: 'airbnb',
      title: listing,
      startAt: toISO(checkinDate, checkinTime),
      endAt: checkoutDate ? toISO(checkoutDate, checkoutTime) : null,
      place: address,
      notes: code ? `Código: ${code}` : '',
      confirmation_code: code,
      cost: price,
      currency: 'EUR',
      confidence: confidence(
        0.4 + (checkinDate ? 0.25 : 0) + (listing !== 'Alojamiento Airbnb' ? 0.15 : 0) +
        (address ? 0.1 : 0) + (code ? 0.1 : 0)
      )
    });
  }

  return { provider: 'airbnb', providerName: 'Airbnb', events, warnings };
}

/* ============================================================
   PARSER · Vuelos (genérico, multi-aerolínea)
   ============================================================ */
function parseFlight(text) {
  const events = [];
  const warnings = [];

  const flightNum = pick(text, [
    /(?:Vuelo|Flight)[:\s#]*([A-Z]{2}\s?\d{2,4})/i,
    /\b([A-Z]{2}\s?\d{2,4})\b/
  ]);
  const flightNumClean = flightNum ? flightNum.replace(/\s/g, '') : null;

  // Ruta: BCN → MAD, BCN-MAD, o (BCN) ... (MAD)
  let origin = pick(text, [/\b([A-Z]{3})\s*(?:→|->|–|—|-|a|to)\s*[A-Z]{3}\b/]);
  let destination = pick(text, [/\b[A-Z]{3}\s*(?:→|->|–|—|-|a|to)\s*([A-Z]{3})\b/]);
  if (!origin || !destination) {
    const codes = [...text.matchAll(/\(([A-Z]{3})\)/g)].map(x => x[1]);
    if (codes.length >= 2) { origin = codes[0]; destination = codes[1]; }
  }

  const dateRaw = pick(text, [
    /(?:Fecha|Date)[:\s]+([^\n]{4,60})/i,
    /(\d{1,2}\s+de\s+[a-záéíóúñ]+\s+de\s+\d{4})/i,
    /(\d{1,2}\s+de\s+[a-záéíóúñ]+)/i,
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/
  ]);
  const flightDate = parseDate(dateRaw);

  const departure = pick(text, [/(?:Salida|Departure|Sale)[:\s]*(\d{1,2}:\d{2})/i]);
  const arrival = pick(text, [/(?:Llegada|Arrival|Llega)[:\s]*(\d{1,2}:\d{2})/i]);
  const gate = pick(text, [/(?:Puerta|Gate)[:\s]*([A-Z]\d{1,3})/i]);
  const seat = pick(text, [/(?:Asiento|Seat)[:\s]*(\d{1,2}[A-F])/i]);
  const code = pick(text, [/(?:Confirmaci[oó]n|Reserva|PNR|Booking ref|C[oó]digo)[:\s]*([A-Z0-9]{5,10})/i]);

  if (!flightDate) warnings.push('No pude detectar la fecha del vuelo');
  if (!origin || !destination) warnings.push('No pude detectar la ruta');

  const title = flightNumClean
    ? `${flightNumClean} · ${origin || '?'} → ${destination || '?'}`
    : `Vuelo ${origin || '?'} → ${destination || '?'}`;

  const noteParts = [];
  if (gate) noteParts.push(`Puerta ${gate}`);
  if (seat) noteParts.push(`Asiento ${seat}`);
  if (code) noteParts.push(`Ref. ${code}`);

  if (flightDate && (flightNumClean || origin)) {
    events.push({
      type: 'flight',
      title,
      startAt: toISO(flightDate, departure || '00:00'),
      endAt: arrival ? toISO(flightDate, arrival) : null,
      place: origin ? `Aeropuerto ${origin}` : '',
      notes: noteParts.join(' · '),
      confirmation_code: code,
      confidence: confidence(
        0.35 + (flightDate ? 0.2 : 0) + (flightNumClean ? 0.15 : 0) +
        (origin && destination ? 0.15 : 0) + (departure ? 0.1 : 0) + (code ? 0.05 : 0)
      )
    });
  }

  return { provider: 'flight', providerName: 'Vuelo', events, warnings };
}

/* ============================================================
   PARSER · Alquiler de auto
   ============================================================ */
function parseCar(text) {
  const events = [];
  const warnings = [];

  // Quitar header tipo "Reserva 3 -"
  const cleanLines = text.split('\n')
    .map(l => l.trim())
    .filter(l => l && !/^(Reserva|Booking|Segmento|Itinerario|Detalle|Reservation|Segment)\s*\d*\s*[:#-]/i.test(l));

  const firstLine = cleanLines[0] || '';

  // Título: primera línea útil, o genérico
  let title = 'Alquiler de auto';
  if (/alquiler|renta|rent\s*a\s*car|car\s*rental/i.test(firstLine)) {
    title = firstLine.slice(0, 70);
  } else if (firstLine && firstLine.length < 70) {
    title = firstLine;
  }

  const code = pick(text, [
    /(?:Reserva|C[oó]digo|Reservation|Confirmation)[:\s#]*([A-Z0-9\-]{5,20})/i
  ]);

  const pickup = pick(text, [
    /(?:Recogida|Retiro|Retirada|Pick-?\s*up)[:\s]+([^\n]{2,80})/i
  ]);

  const dropoff = pick(text, [
    /(?:Devoluci[oó]n|Entrega|Drop-?\s*off)[:\s]+([^\n]{2,80})/i
  ]);

  const dateRaw = pick(text, [
    /Fecha[:\s]+([^\n]{4,60})/i,
    /(\d{1,2}\s+de\s+[a-záéíóúñ]+\s+de\s+\d{4})/i,
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/
  ]);
  const date = parseDate(dateRaw);

  const timeMatch = text.match(/(\d{1,2}:\d{2})/);

  const noteParts = [];
  if (code) noteParts.push(`Ref. ${code}`);
  if (dropoff) noteParts.push(`Devolución: ${dropoff}`);

  if (date) {
    events.push({
      type: 'car',
      title,
      startAt: toISO(date, timeMatch?.[1] || '10:00'),
      endAt: null,
      place: pickup || '',
      notes: noteParts.join(' · '),
      confirmation_code: code,
      confidence: confidence(
        0.35 + (date ? 0.2 : 0) + (pickup ? 0.15 : 0) + (code ? 0.1 : 0) + 0.05
      )
    });
  } else {
    warnings.push('No pude detectar la fecha del alquiler');
  }

  return { provider: 'car', providerName: 'Alquiler de auto', events, warnings };
}

/* ============================================================
   PARSER · Genérico (fallback universal)
   ============================================================ */
function parseGeneric(text) {
  const events = [];
  const warnings = [];

  // Limpiar headers de segmento
  const cleanLines = text.split('\n')
    .map(l => l.trim())
    .filter(l => l && !/^(Reserva|Booking|Segmento|Itinerario|Detalle|Reservation|Segment)\s*\d*\s*[:#-]/i.test(l));

  if (!cleanLines.length) {
    return { provider: 'generic', providerName: 'Evento', events, warnings: ['Segmento vacío'] };
  }

  // Título: primera línea útil
  const title = cleanLines[0].slice(0, 80);

  // Buscar cualquier fecha
  const datePatterns = [
    /(\d{1,2}\s+de\s+[a-záéíóúñ]+\s+de\s+\d{4})/i,
    /(\d{1,2}\s+de\s+[a-záéíóúñ]+)/i,
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/,
    /(\d{4}-\d{1,2}-\d{1,2})/
  ];
  let dateRaw = null;
  for (const p of datePatterns) {
    const m = text.match(p);
    if (m) { dateRaw = m[1]; break; }
  }
  const date = parseDate(dateRaw);

  const timeMatch = text.match(/(\d{1,2}:\d{2})/);

  // Buscar lugar
  const placeLine = cleanLines.find(l =>
    /^(?:Lugar|Direcci[oó]n|Ubicaci[oó]n|Address|Location|Destino)[:\s]/i.test(l)
  );
  const place = placeLine ? placeLine.replace(/^[^:]+:\s*/, '') : '';

  // Notas: el resto del contenido
  const notes = cleanLines.slice(1).join(' · ').slice(0, 200);

  events.push({
    type: 'note',
    title,
    startAt: date
      ? toISO(date, timeMatch?.[1] || '12:00')
      : new Date().toISOString(),
    endAt: null,
    place,
    notes,
    confirmation_code: null,
    confidence: date ? 0.4 : 0.15
  });

  if (!date) warnings.push('Sin fecha · se agregó con la fecha de hoy');

  return { provider: 'generic', providerName: 'Evento', events, warnings };
}

/* ============================================================
   DETECCIÓN + API PÚBLICA
   ============================================================ */
export const PROVIDERS = {
  auto:     { id: 'auto',     name: 'Auto',        emoji: '✨', detect: () => true },
  booking:  { id: 'booking',  name: 'Booking.com', emoji: '🏨',
              detect: t => /booking\.com/i.test(t) || /n[uú]mero de reserva/i.test(t),
              parse: parseBooking },
  airbnb:   { id: 'airbnb',   name: 'Airbnb',      emoji: '🏠',
              detect: t => /airbnb/i.test(t) || /c[oó]digo de confirmaci[oó]n/i.test(t),
              parse: parseAirbnb },
  flight:   { id: 'flight',   name: 'Vuelo',       emoji: '✈️',
              detect: t => /(?:Vuelo|Flight|Boarding|PNR)/i.test(t) || /\b[A-Z]{2}\s?\d{2,4}\b/.test(t),
              parse: parseFlight },
  car:      { id: 'car',      name: 'Auto',        emoji: '🚗',
              detect: t => /(?:Alquiler|Renta|Rent\s*a\s*car|Car\s*rental|Recogida|Retiro|Hertz|Avis|Europcar|Sixt)/i.test(t),
              parse: parseCar },
  despegar: { id: 'despegar', name: 'Despegar',    emoji: '🌎',
              detect: t => /despegar/i.test(t),
              parse: parseFlight },
  generic:  { id: 'generic',  name: 'Evento',      emoji: '📝',
              detect: () => false,
              parse: parseGeneric },
};

export function analyze(text, forced = 'auto') {
  if (!text || text.trim().length < 20) {
    return { provider: null, providerName: null, events: [], warnings: ['El texto es demasiado corto.'] };
  }

  if (forced !== 'auto') {
    const p = PROVIDERS[forced];
    if (!p || !p.parse) return { provider: null, providerName: null, events: [], warnings: ['Proveedor no soportado.'] };
    return p.parse(text);
  }

  // Detección automática (en orden de especificidad)
  const order = ['booking', 'airbnb', 'despegar', 'flight', 'car'];
  for (const key of order) {
    const p = PROVIDERS[key];
    if (p.detect(text)) {
      const result = p.parse(text);
      if (result.events.length > 0) return result;
    }
  }

  // Fallback: probar todos y quedarse con el que más eventos detectó
  //const results = order.map(k => PROVIDERS[k].parse(text));
  //results.sort((a, b) => b.events.length - a.events.length);
  //if (results[0]?.events?.length) return results[0];

    // 2. Fallback genérico — NO probamos todos los proveedores,
  //    porque los parseadores permisivos (car) generan eventos
  //    con cualquier texto que contenga una fecha.
  return parseGeneric(text);
}

/* ============================================================
   ANÁLISIS MULTI-EVENTO
   Detecta emails con varios bookings (vuelo + hotel + auto)
   ============================================================ */

/**
 * Divide un texto largo en segmentos independientes.
 * Estrategia:
 *   1. Busca headers repetidos (Reserva 1, Segmento 2, etc.)
 *   2. Cae a separadores (---, ===, doble línea vacía)
 */
function splitIntoSegments(text) {
  const headerRegex = /(?:^|\n)\s*(?:Reserva|Booking|Segmento|Itinerario|Detalle|Reservation|Segment|Flight|Hotel|Alojamiento)\s*\d*\s*[:#-]/gi;
  const indices = [];
  let match;
  while ((match = headerRegex.exec(text)) !== null) indices.push(match.index);

  if (indices.length > 1) {
    const segments = [];
    for (let i = 0; i < indices.length; i++) {
      const start = indices[i];
      const end = i < indices.length - 1 ? indices[i + 1] : text.length;
      segments.push(text.slice(start, end).trim());
    }
    return segments.filter(s => s.length > 40);
  }

  const separators = [/-{4,}/, /={4,}/, /\n\s*\n\s*\n\s*\n/];
  for (const sep of separators) {
    const parts = text.split(sep).map(s => s.trim()).filter(s => s.length > 60);
    if (parts.length > 1) return parts;
  }

  return [text];
}

/**
 * Analiza el texto y devuelve TODOS los eventos detectables.
 * Si el texto es de un solo proveedor, delega a `analyze`.
 * Si detecta múltiples secciones, las parsea por separado.
 */
export function analyzeMulti(text, forced = 'auto') {
  if (!text || text.trim().length < 20) {
    return { provider: null, providerName: null, events: [], warnings: ['Texto demasiado corto.'] };
  }

  // Si el usuario forzó un proveedor, respetar
  if (forced !== 'auto') return analyze(text, forced);

  const segments = splitIntoSegments(text);

  if (segments.length <= 1) {
    return analyze(text, 'auto');
  }

  const allEvents = [];
  const allWarnings = [];
  const providers = new Set();

  for (const seg of segments) {
    const result = analyze(seg, 'auto');
    if (result.events.length) {
      allEvents.push(...result.events);
      if (result.providerName) providers.add(result.providerName);
    }
    allWarnings.push(...result.warnings);
  }

  if (!allEvents.length) {
    return analyze(text, 'auto');
  }

  // Deduplicar por (type + title + startAt)
  const seen = new Set();
  const unique = [];
  for (const ev of allEvents) {
    const key = `${ev.type}|${(ev.title || '').toLowerCase()}|${ev.startAt || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ev);
  }

  return {
    provider: 'multi',
    providerName: providers.size > 1
      ? [...providers].join(' + ')
      : (providers.values().next().value || 'Multi'),
    events: unique,
    warnings: [...new Set(allWarnings)],
  };
}

/* ---------- Ejemplos para demo ---------- */
export const EXAMPLES = {
  booking: `Confirmación de reserva - Booking.com

¡Gracias por tu reserva!

Número de reserva: 3287451902
PIN: 4821

Hotel Atlántico Madrid
Dirección: Gran Vía 38, 28013 Madrid, España
Teléfono: +34 91 555 1234

Check-in: sábado, 5 de octubre de 2026
A partir de las: 15:00
Check-out: martes, 8 de octubre de 2026
Antes de las: 12:00

Habitación Doble Superior con vistas
2 huéspedes · 3 noches

Total: €620,00
Impuestos incluidos`,

  flight: `Confirmación de vuelo - Vueling

Tu vuelo está confirmado

Pasajero: Juan Pérez
Vuelo: VY 1234
Confirmación: ABC123

Ruta: BCN → MAD
Fecha: 5 de octubre de 2026
Salida: 08:45
Llegada: 10:05

Puerta: B12
Asiento: 12A
Terminal: T1

Barcelona-El Prat (BCN) - Madrid-Barajas (MAD)`,

  airbnb: `Reserva confirmada - Airbnb

Código de confirmación: HMABC123XY
Llegada: 5 de octubre de 2026
Salida: 8 de octubre de 2026

Apartamento en el centro histórico
Dirección: Calle Mayor 15, Madrid

Total: €450

Anfitrión: María`,

  multi: `Reserva 1 - Vuelo
Vuelo: AR1234
Ruta: BCN → MAD
Fecha: 5 de octubre de 2026
Salida: 08:45

Reserva 2 - Hotel
Hotel Atlántico Madrid
Dirección: Gran Vía 38
Check-in: 5 de octubre de 2026
A partir de las: 15:00
Check-out: 8 de octubre de 2026

Reserva 3 - Auto
Alquiler de auto
Recogida: Aeropuerto MAD
Fecha: 5 de octubre de 2026`,
};
