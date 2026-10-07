/* ============================================================
   Tests · expenses.js
   - Mock de vault con clave AES real
   - Cubre: validación, CRUD, cifrado, balance, settlements
   ============================================================ */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

/* ============================================================
   Mock de vault
   ============================================================ */
const vaultState = vi.hoisted(() => ({ unlocked: true }));

vi.mock('../vault.js', async () => {
  const { webcrypto } = await import('node:crypto');
  let _key = null;
  async function getKey() {
    if (!_key) {
      _key = await webcrypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
      );
    }
    return _key;
  }
  return {
    isUnlocked: () => vaultState.unlocked,
    getTripKey: async () => {
      if (!vaultState.unlocked) throw new Error('Vault locked');
      return getKey();
    },
  };
});

/* ============================================================
   Setup
   ============================================================ */
let expenses;

beforeAll(async () => {
  expenses = await import('../expenses.js');
});

beforeEach(async () => {
  vaultState.unlocked = true;
  await expenses.clearAllExpenses();
});

const TRIP = 'trip_test';
const T1 = 'tr_ana';
const T2 = 'tr_lucas';
const T3 = 'tr_sofia';

/* ============================================================
   validateExpense
   ============================================================ */
describe('validateExpense', () => {
  it('acepta un gasto válido', () => {
    expect(() => expenses.validateExpense({
      title: 'Cena',
      amount: 50,
      currency: 'EUR',
      paidBy: T1,
      splitType: 'equal',
    })).not.toThrow();
  });

  it('rechaza sin título', () => {
    expect(() => expenses.validateExpense({
      amount: 50, currency: 'EUR', paidBy: T1,
    })).toThrow(/título/);
  });

  it('rechaza monto <= 0', () => {
    expect(() => expenses.validateExpense({
      title: 'X', amount: 0, currency: 'EUR', paidBy: T1,
    })).toThrow(/Monto/);
    expect(() => expenses.validateExpense({
      title: 'X', amount: -10, currency: 'EUR', paidBy: T1,
    })).toThrow(/Monto/);
  });

  it('rechaza sin pagador', () => {
    expect(() => expenses.validateExpense({
      title: 'X', amount: 10, currency: 'EUR',
    })).toThrow(/pagó/);
  });

  it('rechaza custom splits que no suman el total', () => {
    expect(() => expenses.validateExpense({
      title: 'X', amount: 100, currency: 'EUR', paidBy: T1,
      splitType: 'custom',
      customSplits: { [T1]: 30, [T2]: 30 },   // suma 60 ≠ 100
    })).toThrow(/custom suman/);
  });

  it('acepta custom splits que suman el total', () => {
    expect(() => expenses.validateExpense({
      title: 'X', amount: 100, currency: 'EUR', paidBy: T1,
      splitType: 'custom',
      customSplits: { [T1]: 50, [T2]: 50 },
    })).not.toThrow();
  });
});

/* ============================================================
   CRUD
   ============================================================ */
describe('createExpense', () => {
  it('crea y devuelve id + timestamps', async () => {
    const rec = await expenses.createExpense(TRIP, {
      title: 'Cena',
      amount: 90,
      currency: 'EUR',
      paidBy: T1,
      splitAmong: [T1, T2, T3],
      category: 'food',
    });

    expect(rec.id).toMatch(/^ex_/);
    expect(rec.tripId).toBe(TRIP);
    expect(rec.amount).toBe(90);
    expect(rec.category).toBe('food');
    expect(rec.createdAt).toBeGreaterThan(0);
    expect(rec.titleEncrypted).toBeTruthy();
    expect(rec.title).toBeUndefined();
  });

  it('cifra title y notes', async () => {
    await expenses.createExpense(TRIP, {
      title: 'Cena secreta',
      notes: 'En un lugar reservado',
      amount: 100,
      currency: 'EUR',
      paidBy: T1,
    });

    const list = await expenses.getAllExpenses(TRIP);
    expect(list).toHaveLength(1);

    // El getAll devuelve hidratado
    expect(list[0].title).toBe('Cena secreta');
    expect(list[0].notes).toBe('En un lugar reservado');
  });

  it('guarda en claro si el vault está bloqueado', async () => {
    vaultState.unlocked = false;
    const rec = await expenses.createExpense(TRIP, {
      title: 'Sin vault',
      amount: 50,
      currency: 'EUR',
      paidBy: T1,
    });

    expect(rec.title).toBe('Sin vault');
    expect(rec.titleEncrypted).toBeUndefined();
  });
});

describe('updateExpense', () => {
  it('modifica el monto y preserva el resto', async () => {
    const rec = await expenses.createExpense(TRIP, {
      title: 'Cena',
      amount: 90,
      paidBy: T1,
      category: 'food',
    });

    const updated = await expenses.updateExpense(rec.id, { amount: 120 });
    expect(updated.amount).toBe(120);
    expect(updated.category).toBe('food');
    expect(updated.paidBy).toBe(T1);
  });

  it('permite cambiar el título (re-cifra)', async () => {
    const rec = await expenses.createExpense(TRIP, {
      title: 'Original', amount: 50, paidBy: T1,
    });

    await expenses.updateExpense(rec.id, { title: 'Nuevo' });
    const fetched = await expenses.getExpense(rec.id);
    expect(fetched.title).toBe('Nuevo');
  });

  it('falla si no existe', async () => {
    await expect(expenses.updateExpense('nope', { amount: 10 })).rejects.toThrow();
  });
});

describe('deleteExpense', () => {
  it('elimina el registro', async () => {
    const rec = await expenses.createExpense(TRIP, {
      title: 'X', amount: 50, paidBy: T1,
    });
    await expenses.deleteExpense(rec.id);
    expect(await expenses.getExpense(rec.id)).toBeNull();
  });
});

/* ============================================================
   getAllExpenses
   ============================================================ */
describe('getAllExpenses', () => {
  it('filtra por tripId y ordena desc', async () => {
    await expenses.createExpense('tripA', {
      title: 'A1', amount: 10, paidBy: T1,
    });
    await new Promise(r => setTimeout(r, 5));
    await expenses.createExpense('tripA', {
      title: 'A2', amount: 20, paidBy: T1,
    });
    await expenses.createExpense('tripB', {
      title: 'B1', amount: 30, paidBy: T1,
    });

    const tripA = await expenses.getAllExpenses('tripA');
    expect(tripA).toHaveLength(2);
    expect(tripA[0].title).toBe('A2');   // más reciente primero
  });

  it('devuelve [] sin gastos', async () => {
    expect(await expenses.getAllExpenses('tripVacio')).toEqual([]);
  });
});

/* ============================================================
   computeBalances · pura
   ============================================================ */
describe('computeBalances', () => {
  const travelers = [T1, T2, T3];

  it('un solo gasto dividido por igual', () => {
    const ex = [{
      amount: 90, paidBy: T1, splitAmong: [T1, T2, T3], splitType: 'equal',
    }];

    const b = expenses.computeBalances(ex, travelers);

    // T1 pagó 90, le toca 30 → +60
    expect(b[T1].balance).toBe(60);
    // T2 y T3 deben 30 cada uno
    expect(b[T2].balance).toBe(-30);
    expect(b[T3].balance).toBe(-30);
  });

  it('suma de balances siempre = 0', () => {
    const ex = [
      { amount: 90,  paidBy: T1, splitAmong: [T1, T2, T3], splitType: 'equal' },
      { amount: 60,  paidBy: T2, splitAmong: [T1, T2],     splitType: 'equal' },
      { amount: 30,  paidBy: T3, splitAmong: [T1, T2, T3], splitType: 'equal' },
    ];
    const b = expenses.computeBalances(ex, travelers);
    const sum = Object.values(b).reduce((s, x) => s + x.balance, 0);
    expect(Math.abs(sum)).toBeLessThan(0.01);
  });

  it('splitAmong vacío = todos los viajeros', () => {
    const ex = [{
      amount: 60, paidBy: T1, splitAmong: [], splitType: 'equal',
    }];
    const b = expenses.computeBalances(ex, travelers);
    expect(b[T1].balance).toBe(40);      // pagó 60, le toca 20
    expect(b[T2].balance).toBe(-20);
    expect(b[T3].balance).toBe(-20);
  });

  it('customSplits respeta montos distintos', () => {
    const ex = [{
      amount: 100,
      paidBy: T1,
      splitType: 'custom',
      splitAmong: [T1, T2],
      customSplits: { [T1]: 20, [T2]: 80 },
    }];
    const b = expenses.computeBalances(ex, travelers);
    expect(b[T1].balance).toBe(80);    // pagó 100, le toca 20
    expect(b[T2].balance).toBe(-80);
    expect(b[T3].balance).toBe(0);
  });

  it('pagador fuera de splitAmong también suma su parte', () => {
    const ex = [{
      amount: 60, paidBy: T1, splitAmong: [T2, T3], splitType: 'equal',
    }];
    const b = expenses.computeBalances(ex, travelers);
    // T1 pagó 60 pero no participa → le deben 60
    expect(b[T1].balance).toBe(60);
    expect(b[T2].balance).toBe(-30);
    expect(b[T3].balance).toBe(-30);
  });
});

/* ============================================================
   computeSettlements · pura
   ============================================================ */
describe('computeSettlements', () => {
  it('cadena simple: 1 deudor, 1 acreedor', () => {
    const balances = {
      [T1]: { balance: 30 },
      [T2]: { balance: -30 },
    };
    const s = expenses.computeSettlements(balances);
    expect(s).toEqual([{ from: T2, to: T1, amount: 30 }]);
  });

  it('múltiples deudores y acreedores', () => {
    const balances = {
      [T1]: { balance: 60 },
      [T2]: { balance: -30 },
      [T3]: { balance: -30 },
    };
    const s = expenses.computeSettlements(balances);
    expect(s).toHaveLength(2);
    expect(s.every(t => t.to === T1)).toBe(true);
    expect(s.reduce((sum, t) => sum + t.amount, 0)).toBe(60);
  });

  it('mínimo de transacciones (algoritmo greedy)', () => {
    // 1 acreedor grande, 2 deudores
    const balances = {
      [T1]: { balance: 100 },
      [T2]: { balance: -60 },
      [T3]: { balance: -40 },
    };
    const s = expenses.computeSettlements(balances);
    expect(s).toHaveLength(2);
  });

  it('balance cero no genera transacción', () => {
    const balances = {
      [T1]: { balance: 0 },
      [T2]: { balance: 0 },
    };
    expect(expenses.computeSettlements(balances)).toEqual([]);
  });

  it('ignora diferencias < 0.01 (redondeo)', () => {
    const balances = {
      [T1]: { balance: 0.005 },
      [T2]: { balance: -0.005 },
    };
    expect(expenses.computeSettlements(balances)).toEqual([]);
  });

  it('settlements resuelven los balances originales', () => {
    const balances = {
      [T1]: { balance: 60 },
      [T2]: { balance: -20 },
      [T3]: { balance: -40 },
    };
    const s = expenses.computeSettlements(balances);

    // Aplicar los settlements debe dejar todos en 0
    const result = { ...balances };
    for (const t of s) {
      result[t.from].balance += t.amount;
      result[t.to].balance   -= t.amount;
    }
    for (const b of Object.values(result)) {
      expect(Math.abs(b.balance)).toBeLessThan(0.01);
    }
  });
});

/* ============================================================
   getTripTotal
   ============================================================ */
describe('getTripTotal', () => {
  it('agrupa por moneda', () => {
    const ex = [
      { amount: 50, currency: 'EUR' },
      { amount: 30, currency: 'EUR' },
      { amount: 100, currency: 'ARS' },
    ];
    expect(expenses.getTripTotal(ex)).toEqual({ EUR: 80, ARS: 100 });
  });

  it('default EUR si falta currency', () => {
    expect(expenses.getTripTotal([{ amount: 20 }])).toEqual({ EUR: 20 });
  });

  it('lista vacía → objeto vacío', () => {
    expect(expenses.getTripTotal([])).toEqual({});
  });
});

/* ============================================================
   wipeTripExpenses
   ============================================================ */
describe('wipeTripExpenses', () => {
  it('borra sólo los gastos del viaje pedido', async () => {
    await expenses.createExpense('tripA', { title: 'a', amount: 10, paidBy: T1 });
    await expenses.createExpense('tripA', { title: 'b', amount: 20, paidBy: T1 });
    await expenses.createExpense('tripB', { title: 'c', amount: 30, paidBy: T1 });

    await expenses.wipeTripExpenses('tripA');

    expect(await expenses.getAllExpenses('tripA')).toEqual([]);
    expect(await expenses.getAllExpenses('tripB')).toHaveLength(1);
  });
});