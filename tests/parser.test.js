/* ============================================================
   Tests · parser.js
   ============================================================ */

import { describe, it, expect } from 'vitest';
import {
  parseDate, analyze, analyzeMulti, EXAMPLES, PROVIDERS,
} from '../parser.js';

describe('parseDate', () => {
  const refYear = 2026;

  it('parsea ISO YYYY-MM-DD', () => {
    const d = parseDate('2026-10-05', refYear);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9);   // octubre = 9
    expect(d.getDate()).toBe(5);
  });

  it('parsea dd/mm/yyyy', () => {
    const d = parseDate('05/10/2026', refYear);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9);
    expect(d.getDate()).toBe(5);
  });

  it('parsea dd-mm-yy y asume 2000s', () => {
    const d = parseDate('05-10-26', refYear);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9);
  });

  it('parsea "5 de octubre de 2026"', () => {
    const d = parseDate('5 de octubre de 2026', refYear);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9);
    expect(d.getDate()).toBe(5);
  });

  it('parsea "5 octubre 2026" sin "de"', () => {
    const d = parseDate('5 octubre 2026', refYear);
    expect(d.getMonth()).toBe(9);
    expect(d.getDate()).toBe(5);
  });

  it('parsea "5 de octubre" y usa el año de referencia', () => {
    const d = parseDate('5 de octubre', refYear);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9);
  });

  it('parsea "october 5, 2026"', () => {
    const d = parseDate('october 5, 2026', refYear);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9);
    expect(d.getDate()).toBe(5);
  });

  it('devuelve null para texto sin fecha', () => {
    expect(parseDate('hola mundo')).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate(null)).toBeNull();
  });
});

describe('analyze · Booking', () => {
  it('detecta Booking y extrae hotel, fechas y código', () => {
    const res = analyze(EXAMPLES.booking);
    expect(res.provider).toBe('booking');
    expect(res.events).toHaveLength(1);

    const ev = res.events[0];
    expect(ev.type).toBe('hotel');
    expect(ev.title).toContain('Atlántico');
    expect(ev.confirmation_code).toBe('3287451902');
    expect(new Date(ev.startAt).getMonth()).toBe(9);      // octubre
    expect(new Date(ev.startAt).getDate()).toBe(5);
    expect(new Date(ev.endAt).getDate()).toBe(8);
    expect(ev.confidence).toBeGreaterThan(0.5);
  });
});

describe('analyze · Vuelo', () => {
  it('detecta Vuelo y extrae ruta, fecha y código', () => {
    const res = analyze(EXAMPLES.flight);
    expect(res.provider).toBe('flight');
    expect(res.events).toHaveLength(1);

    const ev = res.events[0];
    expect(ev.type).toBe('flight');
    expect(ev.title).toContain('BCN');
    expect(ev.title).toContain('MAD');
    expect(ev.confirmation_code).toBe('ABC123');
    expect(new Date(ev.startAt).getDate()).toBe(5);
  });
});

describe('analyze · Airbnb', () => {
  it('detecta Airbnb y extrae código + fechas', () => {
    const res = analyze(EXAMPLES.airbnb);
    expect(res.provider).toBe('airbnb');
    expect(res.events).toHaveLength(1);

    const ev = res.events[0];
    expect(ev.type).toBe('airbnb');
    expect(ev.confirmation_code).toBe('HMABC123XY');
  });
});

describe('analyze · fallback genérico', () => {
  it('cae a genérico con texto sin proveedor claro', () => {
    const res = analyze('Reunión el 12 de marzo de 2026 a las 15:00 en la oficina');
    expect(res.provider).toBe('generic');
    expect(res.events).toHaveLength(1);
    expect(res.events[0].type).toBe('note');
  });

  it('devuelve warning si no hay fecha', () => {
    const res = analyze('Nota sin fecha ni proveedor');
    expect(res.warnings.some(w => /fecha/i.test(w))).toBe(true);
  });
});

describe('analyze · texto corto', () => {
  it('rechaza texto < 20 chars', () => {
    const res = analyze('Hola');
    expect(res.events).toHaveLength(0);
    expect(res.warnings.length).toBeGreaterThan(0);
  });
});

describe('analyzeMulti', () => {
  it('detecta múltiples eventos en un email con varias reservas', () => {
    const res = analyzeMulti(EXAMPLES.multi);
    expect(res.events.length).toBeGreaterThanOrEqual(2);

    const types = new Set(res.events.map(e => e.type));
    expect(types.size).toBeGreaterThan(1);
  });

  it('deduplica eventos idénticos', () => {
    const duplicated = EXAMPLES.flight + '\n\n' + EXAMPLES.flight;
    const res = analyzeMulti(duplicated);
    // Los 2 bloques tienen el mismo vuelo → 1 único evento
    expect(res.events.length).toBe(1);
  });

  it('respeta forzado de proveedor', () => {
    const res = analyzeMulti(EXAMPLES.booking, 'booking');
    expect(res.provider).toBe('booking');
  });

  it('incluye warnings cuando faltan datos', () => {
    const res = analyzeMulti('Reserva\nSin datos útiles', 'generic');
    expect(Array.isArray(res.warnings)).toBe(true);
  });
});

describe('PROVIDERS', () => {
  it('expone los 7 proveedores esperados', () => {
    const ids = Object.keys(PROVIDERS);
    expect(ids).toEqual(expect.arrayContaining([
      'auto', 'booking', 'airbnb', 'flight', 'car', 'despegar', 'generic',
    ]));
  });
});