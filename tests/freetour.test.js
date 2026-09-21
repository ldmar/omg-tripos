/* ============================================================
   Tests · freetour.js
   Mockea fetch para verificar la lógica sin tocar la red real
   ============================================================ */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as freetour from '../freetour.js';

/* ---------- Fixtures ---------- */
const FIXTURE_SEARCH = {
  place: { id: 878, name: 'Madrid', slug: 'madrid', country: 'España', has_free_tours: true, url: 'https://...' },
  categories: [
    { id: 'free-tour', name: 'Free Tours', slug: 'free-tours', hub_slug: 'madrid', url: 'https://...' },
  ],
  featured_products: [
    {
      type: 'free_tour',
      id: 33767,
      name: 'Casco antiguo (Austrias)',
      rating: 4.91,
      reviews_count: 13464,
      duration: 135,
      booking_url: 'https://www.guruwalk.com/walks/33767-...?ref=abc',
    },
    {
      type: 'product',
      id: 1560,
      name: 'Consigna en Puerta del Sol',
      rating: 4.5,
      reviews_count: 11,
      duration: 840,
      pricing_from: { retail: 6.06, currency: 'EUR' },
      booking_url: 'https://www.guruwalk.com/walks/p1560-...?ref=abc',
    },
  ],
};

const FIXTURE_DETAIL = {
  product_id: 33767,
  type: 'free_tour',
  id: 33767,
  name: 'Casco antiguo (Austrias)',
  duration: 135,
  guide: { name: 'Carlos' },
  how_to_find_me: 'Frente a la estatua ecuestre, paraguas amarillo',
  meeting_point_latitude: 40.4155,
  meeting_point_longitude: -3.7074,
  meeting_point_url: 'https://maps.google.com/?q=...',
  itinerary: ['Plaza Mayor', 'Mercado San Miguel', 'Catedral'],
  available_languages: ['es', 'en'],
  reviews: { count: 13464, rating: 4.91 },
  url: 'https://www.guruwalk.com/walks/33767-...?ref=abc',
};

/* ---------- Helper: mock fetch que responde distinto según el tool ---------- */
function mockFetch(handlers) {
  return vi.fn(async (url, opts) => {
    const body = JSON.parse(opts.body);
    const toolName = body.params?.name;
    const handler = handlers[toolName] || handlers.default;
    if (!handler) throw new Error(`No handler para tool ${toolName}`);
    const data = typeof handler === 'function' ? handler(body.params.arguments) : handler;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(data) }],
        },
      }),
    };
  });
}

beforeEach(() => {
  freetour.clearCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/* ============================================================
   searchTours
   ============================================================ */
describe('searchTours', () => {
  it('devuelve freeTours y paid separados', async () => {
    vi.stubGlobal('fetch', mockFetch({
      search_tours_activities_by_destination: FIXTURE_SEARCH,
    }));

    const res = await freetour.searchTours({ destination: 'Madrid', language: 'es' });

    expect(res.destination).toBe('Madrid');
    expect(res.freeTours).toHaveLength(1);
    expect(res.paid).toHaveLength(1);
    expect(res.freeTours[0].id).toBe(33767);
    expect(res.categories).toHaveLength(1);
  });

  it('pasa los parámetros opcionales al tool', async () => {
    const fetchMock = mockFetch({ search_tours_activities_by_destination: FIXTURE_SEARCH });
    vi.stubGlobal('fetch', fetchMock);

    await freetour.searchTours({
      destination: 'Madrid',
      startDate: '2026-10-05',
      endDate: '2026-10-08',
      adults: 4,
      language: 'es',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.params.arguments.start_date).toBe('2026-10-05');
    expect(body.params.arguments.end_date).toBe('2026-10-08');
    expect(body.params.arguments.how_many_adults).toBe(4);
  });

  it('maneja cobertura vacía sin romper', async () => {
    vi.stubGlobal('fetch', mockFetch({
      search_tours_activities_by_destination: { coverage: 'none', destination: 'Narnia', message: 'Sin cobertura' },
    }));

    const res = await freetour.searchTours({ destination: 'Narnia' });
    expect(res.freeTours).toEqual([]);
    expect(res.paid).toEqual([]);
    expect(res.place).toBeNull();
  });

  it('usa caché en la segunda llamada', async () => {
    const fetchMock = mockFetch({ search_tours_activities_by_destination: FIXTURE_SEARCH });
    vi.stubGlobal('fetch', fetchMock);

    await freetour.searchTours({ destination: 'Madrid', language: 'es' });
    await freetour.searchTours({ destination: 'Madrid', language: 'es' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('propaga errores JSON-RPC', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_, opts) => {
      const body = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32602, message: 'Invalid params' },
        }),
      };
    }));

    await expect(freetour.searchTours({ destination: 'X' })).rejects.toThrow(/Invalid params/);
  });

  it('propaga errores HTTP', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
    await expect(freetour.searchTours({ destination: 'X' })).rejects.toThrow(/HTTP 503/);
  });
});

/* ============================================================
   getTourDetail
   ============================================================ */
describe('getTourDetail', () => {
  it('devuelve el primer resultado del batch', async () => {
    vi.stubGlobal('fetch', mockFetch({
      get_product_detail: { results: [FIXTURE_DETAIL] },
    }));

    const detail = await freetour.getTourDetail(33767, 'free_tour', 'es');
    expect(detail.guide.name).toBe('Carlos');
    expect(detail.itinerary).toHaveLength(3);
    expect(detail.meeting_point_latitude).toBe(40.4155);
  });

  it('usa caché', async () => {
    const fetchMock = mockFetch({
      get_product_detail: { results: [FIXTURE_DETAIL] },
    });
    vi.stubGlobal('fetch', fetchMock);

    await freetour.getTourDetail(33767, 'free_tour', 'es');
    await freetour.getTourDetail(33767, 'free_tour', 'es');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('devuelve null si el resultado está vacío', async () => {
    vi.stubGlobal('fetch', mockFetch({
      get_product_detail: { results: [] },
    }));
    expect(await freetour.getTourDetail(999, 'free_tour')).toBeNull();
  });
});

/* ============================================================
   getAvailability
   ============================================================ */
describe('getAvailability', () => {
  it('formatea los items correctamente', async () => {
    const fetchMock = mockFetch({
      get_product_availability: {
        results: [{
          type: 'free_tour', product_id: '33767',
          from_date: '2026-10-05', to_date: '2026-10-05',
          events: [{ date: '2026-10-05', start_time: '10:00', available_seats: 12 }],
        }],
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await freetour.getAvailability(
      [{ productId: 33767, type: 'free_tour', fromDate: '2026-10-05' }],
      'es'
    );

    expect(res[0].events).toHaveLength(1);
    expect(res[0].events[0].start_time).toBe('10:00');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.params.arguments.items[0].product_id).toBe('33767');
    expect(body.params.arguments.items[0].from_date).toBe('2026-10-05');
  });
});

/* ============================================================
   tourToEvent
   ============================================================ */
describe('tourToEvent', () => {
  it('genera Event con tourMeta completo', () => {
    const tour = FIXTURE_SEARCH.featured_products[0];
    const ev = freetour.tourToEvent(tour, FIXTURE_DETAIL, 'trip_madrid');

    expect(ev.tripId).toBe('trip_madrid');
    expect(ev.type).toBe('activity');
    expect(ev.title).toContain('Casco antiguo');
    expect(ev.geo).toEqual({ lat: 40.4155, lng: -3.7074 });
    expect(ev.notes).toContain('Carlos');
    expect(ev.notes).toContain('paraguas amarillo');

    expect(ev.tourMeta.source).toBe('guruwalk');
    expect(ev.tourMeta.productId).toBe(33767);
    expect(ev.tourMeta.guideName).toBe('Carlos');
    expect(ev.tourMeta.howToFindMe).toContain('estatua');
    expect(ev.tourMeta.itinerary).toHaveLength(3);
    expect(ev.tourMeta.durationMin).toBe(135);
    expect(ev.tourMeta.meetingPointCoords).toEqual({ lat: 40.4155, lng: -3.7074 });
  });

  it('funciona sin detail (solo search)', () => {
    const tour = FIXTURE_SEARCH.featured_products[0];
    const ev = freetour.tourToEvent(tour, null, 'trip_madrid');
    expect(ev.title).toContain('Casco antiguo');
    expect(ev.geo).toBeNull();
    expect(ev.tourMeta.durationMin).toBe(135);  // viene del tour
    expect(ev.tourMeta.itinerary).toEqual([]);
  });

  it('acepta startAt y endAt externos', () => {
    const tour = FIXTURE_SEARCH.featured_products[0];
    const ev = freetour.tourToEvent(
      tour, FIXTURE_DETAIL, 't1',
      '2026-10-05T08:00:00.000Z',
      '2026-10-05T10:15:00.000Z'
    );
    expect(ev.startAt).toBe('2026-10-05T08:00:00.000Z');
    expect(ev.endAt).toBe('2026-10-05T10:15:00.000Z');
  });

  it('trunca títulos muy largos', () => {
    const tour = { ...FIXTURE_SEARCH.featured_products[0], name: 'A'.repeat(500) };
    const ev = freetour.tourToEvent(tour, null, 't1');
    expect(ev.title.length).toBeLessThanOrEqual(120);
  });

  it('isTourEvent detecta tours por tourMeta.source', () => {
    const ev = freetour.tourToEvent(FIXTURE_SEARCH.featured_products[0], null, 't1');
    expect(freetour.isTourEvent(ev)).toBe(true);
    expect(freetour.isTourEvent({ type: 'activity', title: 'x' })).toBe(false);
  });
});

/* ============================================================
   tourSubtitle
   ============================================================ */
describe('tourSubtitle', () => {
  it('arma el string con rating y duración', () => {
    expect(freetour.tourSubtitle({ rating: 4.91, reviews_count: 13464, duration: 135 }))
      .toContain('4.91');
    expect(freetour.tourSubtitle({ rating: 4.91, reviews_count: 13464, duration: 135 }))
      .toContain('135 min');
  });

  it('maneja campos ausentes', () => {
    expect(freetour.tourSubtitle({})).toBe('');
  });
});