/* ============================================================
   Tests · trips.js
   Importa el módulo UNA sola vez y limpia stores entre tests
   ============================================================ */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

let trips;

beforeAll(async () => {
  trips = await import('../trips.js');
  await trips.ensureInitialized();   // crea la DB y stores
});

beforeEach(async () => {
  // Limpiar todos los stores sin tocar la conexión
  await trips.idbClear(trips.STORES.EVENTS);
  await trips.idbClear(trips.STORES.META);
  await trips.idbClear(trips.STORES.TRIPS);
  await trips.idbClear(trips.STORES.TRAVELERS);
});

/* ============================================================
   Fixtures
   ============================================================ */
const TRIP_A = {
  title: 'Madrid',
  flag: '🇪🇸',
  startDate: '2026-10-05',
  endDate: '2026-10-08',
  travelers: 4,
  currency: 'EUR',
};

const TRIP_B = {
  title: 'Bariloche',
  flag: '🇦🇷',
  startDate: '2027-01-10',
  endDate: '2027-01-15',
  travelers: 2,
  currency: 'ARS',
};

function makeEvent(tripId, overrides = {}) {
  return {
    id: 'ev_' + Math.random().toString(36).slice(2, 10),
    tripId,
    type: 'activity',
    title: 'Evento',
    startAt: '2026-10-05T10:00:00.000Z',
    place: '',
    notes: '',
    done: false,
    updatedAt: Date.now(),
    ...overrides,
  };
}

/* ============================================================
   ensureInitialized
   ============================================================ */
describe('ensureInitialized', () => {
  it('crea un viaje por defecto si no hay ninguno', async () => {
    // El beforeEach limpió todo, no hay viajes
    await trips.ensureInitialized();

    const all = await trips.listTrips();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe('Mi primer viaje');

    const active = await trips.getActiveTrip();
    expect(active).toBeTruthy();
    expect(active.id).toBe(all[0].id);
  });

  it('no duplica si ya hay viajes', async () => {
    await trips.ensureInitialized();
    const first = await trips.listTrips();

    await trips.ensureInitialized();
    const second = await trips.listTrips();
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe(first[0].id);
  });
});

/* ============================================================
   createTrip
   ============================================================ */
describe('createTrip', () => {
  it('genera id único y calcula days', async () => {
    const t = await trips.createTrip(TRIP_A);

    expect(t.id).toMatch(/^trip_/);
    expect(t.title).toBe('Madrid');
    expect(t.flag).toBe('🇪🇸');
    expect(t.days).toBe(4);
    expect(t.travelers).toBe(4);
    expect(t.currency).toBe('EUR');
    expect(t.createdAt).toBeGreaterThan(0);
  });

  it('setea el viaje recién creado como activo', async () => {
    const t = await trips.createTrip(TRIP_A);
    const active = await trips.getActiveTrip();
    expect(active.id).toBe(t.id);
  });

  it('maneja fechas faltantes (days = 0)', async () => {
    const t = await trips.createTrip({ title: 'Sin fecha' });
    expect(t.days).toBe(0);
    expect(t.startDate).toBeNull();
  });

  it('aplica defaults razonables', async () => {
    const t = await trips.createTrip({ title: 'X' });
    expect(t.flag).toBe('🌍');
    expect(t.currency).toBe('EUR');
    expect(t.travelers).toBe(1);
    expect(t.timezone).toBeTruthy();
  });
});

/* ============================================================
   listTrips + updateTrip
   ============================================================ */
describe('listTrips + updateTrip', () => {
  it('listTrips ordena por updatedAt desc', async () => {
    const a = await trips.createTrip(TRIP_A);
    await new Promise(r => setTimeout(r, 10));
    const b = await trips.createTrip(TRIP_B);

    const list = await trips.listTrips();
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });

  it('updateTrip recalcula days si cambian fechas', async () => {
    const t = await trips.createTrip(TRIP_A);
    expect(t.days).toBe(4);

    const updated = await trips.updateTrip(t.id, { endDate: '2026-10-10' });
    expect(updated.days).toBe(6);
  });

  it('updateTrip falla si el viaje no existe', async () => {
    await expect(trips.updateTrip('inexistente', { title: 'X' })).rejects.toThrow();
  });

  it('getTrip devuelve null si no existe', async () => {
    expect(await trips.getTrip('nope')).toBeNull();
  });
});

/* ============================================================
   Eventos
   ============================================================ */
describe('eventos', () => {
  it('getTripEvents filtra por tripId y ordena por startAt', async () => {
    const trip = await trips.createTrip(TRIP_A);

    await trips.idbPut(trips.STORES.EVENTS, makeEvent(trip.id, {
      id: 'ev_late', startAt: '2026-10-08T20:00:00.000Z',
    }));
    await trips.idbPut(trips.STORES.EVENTS, makeEvent(trip.id, {
      id: 'ev_early', startAt: '2026-10-05T08:00:00.000Z',
    }));
    await trips.idbPut(trips.STORES.EVENTS, makeEvent(trip.id, {
      id: 'ev_mid', startAt: '2026-10-06T12:00:00.000Z',
    }));
    await trips.idbPut(trips.STORES.EVENTS, makeEvent('otro_viaje', { id: 'ev_other' }));

    const events = await trips.getTripEvents(trip.id);
    expect(events.map(e => e.id)).toEqual(['ev_early', 'ev_mid', 'ev_late']);
  });

  it('getTripEvents devuelve [] para tripId falsy', async () => {
    expect(await trips.getTripEvents(null)).toEqual([]);
    expect(await trips.getTripEvents('')).toEqual([]);
  });

  it('deleteTrip borra eventos y viajeros del viaje', async () => {
    const trip = await trips.createTrip(TRIP_A);

    await trips.idbPut(trips.STORES.EVENTS, makeEvent(trip.id, { id: 'ev_1' }));
    await trips.idbPut(trips.STORES.EVENTS, makeEvent(trip.id, { id: 'ev_2' }));
    await trips.idbPut(trips.STORES.TRAVELERS, {
      id: 'tr_1', tripId: trip.id, name: 'Ana', role: 'guest',
    });

    await trips.deleteTrip(trip.id);

    expect(await trips.getTripEvents(trip.id)).toHaveLength(0);
    expect(await trips.getTravelersByTrip(trip.id)).toHaveLength(0);

    const all = await trips.listTrips();
    expect(all).toHaveLength(1);
    expect(all[0].id).not.toBe(trip.id);
  });
});

/* ============================================================
   Viajeros
   ============================================================ */
describe('travelers', () => {
  it('getTravelersByTrip ordena organizers primero', async () => {
    const trip = await trips.createTrip(TRIP_A);

    await trips.idbPut(trips.STORES.TRAVELERS, {
      id: 'tr_guest_1', tripId: trip.id, name: 'Ana', role: 'guest', createdAt: 1000,
    });
    await trips.idbPut(trips.STORES.TRAVELERS, {
      id: 'tr_organizer', tripId: trip.id, name: 'Vos', role: 'organizer', createdAt: 2000,
    });
    await trips.idbPut(trips.STORES.TRAVELERS, {
      id: 'tr_guest_2', tripId: trip.id, name: 'Lucas', role: 'guest', createdAt: 3000,
    });

    const list = await trips.getTravelersByTrip(trip.id);
    expect(list.map(t => t.id)).toEqual([
      'tr_organizer', 'tr_guest_1', 'tr_guest_2',
    ]);
  });

  it('getTravelersByTrip devuelve [] sin tripId', async () => {
    expect(await trips.getTravelersByTrip(null)).toEqual([]);
  });

  it('getTraveler devuelve null si no existe', async () => {
    expect(await trips.getTraveler('nope')).toBeNull();
  });
});

/* ============================================================
   IDB helpers
   ============================================================ */
describe('idb helpers', () => {
  it('idbPut + idbGet hacen roundtrip', async () => {
    const obj = { key: 'k1', value: 'hola' };
    await trips.idbPut(trips.STORES.META, obj);
    expect(await trips.idbGet(trips.STORES.META, 'k1')).toEqual(obj);
  });

  it('idbGet devuelve undefined si no existe', async () => {
    expect(await trips.idbGet(trips.STORES.META, 'nope')).toBeUndefined();
  });

  it('idbAll devuelve todos los registros', async () => {
    await trips.idbPut(trips.STORES.META, { key: 'a', value: 1 });
    await trips.idbPut(trips.STORES.META, { key: 'b', value: 2 });
    const all = await trips.idbAll(trips.STORES.META);
    expect(all).toHaveLength(2);
  });

  it('idbClear vacía el store', async () => {
    await trips.idbPut(trips.STORES.META, { key: 'a', value: 1 });
    await trips.idbClear(trips.STORES.META);
    expect(await trips.idbAll(trips.STORES.META)).toHaveLength(0);
  });

  it('STORES expone los 4 stores', () => {
    expect(trips.STORES).toEqual({
      EVENTS: 'events',
      META: 'meta',
      TRIPS: 'trips',
      TRAVELERS: 'travelers',
    });
  });
});
