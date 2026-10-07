/* ============================================================
   OhMyGoch Trip OS · expenses.js
   Gastos compartidos · CRUD + split + balance + settlements
   - Cifrado en reposo de title/notes con la data key del viaje
   - Metadata operativa en claro para queries y CRDT
   ============================================================ */

import * as vault  from './vault.js';
import * as crypto from './crypto.js';
import * as trips  from './trips.js';

const DB_NAME = 'omg-tripos-expenses';
const DB_VERSION = 1;
const STORE = 'expenses';

const CATEGORIES = {
  food:      { label: 'Comida',      icon: '🍽', color: '#f97316' },
  transport: { label: 'Transporte',  icon: '🚇', color: '#06b6d4' },
  lodging:   { label: 'Alojamiento', icon: '🏨', color: '#8b5cf6' },
  activity:  { label: 'Actividad',   icon: '🎨', color: '#10b981' },
  other:     { label: 'Otro',        icon: '📎', color: '#6b7280' },
};

export function getCategories() { return { ...CATEGORIES }; }

/* ============================================================
   IndexedDB
   ============================================================ */
let _db;
function db() {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(STORE)) {
        const s = idb.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('tripId',    'tripId',    { unique: false });
        s.createIndex('createdAt', 'createdAt', { unique: false });
        s.createIndex('category',  'category',  { unique: false });
      }
    };
    req.onsuccess = () => {
      const idb = req.result;
      idb.onversionchange = () => { idb.close(); _db = null; };
      resolve(idb);
    };
    req.onerror = () => reject(req.error);
  });
  return _db;
}

function tx(mode, fn) {
  return db().then(idb => new Promise((resolve, reject) => {
    const t = idb.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    t.onerror    = () => reject(t.error);
    t.onabort    = () => reject(t.error);
  }));
}

/* ============================================================
   Validación
   ============================================================ */
export function validateExpense(data) {
  const errors = [];
  if (!data.title || !data.title.trim())  errors.push('Falta el título');
  if (typeof data.amount !== 'number' || data.amount <= 0) errors.push('Monto inválido');
  if (!data.currency)                     errors.push('Falta la moneda');
  if (!data.paidBy)                       errors.push('Falta quién pagó');
  if (data.splitType === 'custom') {
    const splits = data.customSplits || {};
    const sum = Object.values(splits).reduce((s, v) => s + (Number(v) || 0), 0);
    if (Math.abs(sum - data.amount) > 0.01) {
      errors.push(`Los montos custom suman ${sum.toFixed(2)}, no ${data.amount.toFixed(2)}`);
    }
  }
  if (errors.length) throw new Error(errors.join(' · '));
}

/* ============================================================
   CRUD
   ============================================================ */
export function uid() {
  return 'ex_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export async function createExpense(tripId, data) {
  if (!tripId) throw new Error('Sin viaje');

  const record = {
    id: uid(),
    tripId,
    amount:      Number(data.amount),
    currency:    data.currency || 'EUR',
    paidBy:      data.paidBy,
    splitAmong:  Array.isArray(data.splitAmong) ? [...data.splitAmong] : [],
    splitType:   data.splitType || 'equal',
    customSplits: data.splitType === 'custom' ? { ...(data.customSplits || {}) } : null,
    category:    data.category || 'other',
    createdAt:   Date.now(),
    updatedAt:   Date.now(),
  };

  validateExpense({ ...record, title: data.title });

  // Cifrar title + notes
  if (vault.isUnlocked()) {
    const key = await vault.getTripKey(tripId, { create: true });
    record.titleEncrypted = await crypto.encryptString(
      key, data.title.trim(), `expense:${record.id}`
    );
    if (data.notes) {
      record.notesEncrypted = await crypto.encryptString(
        key, data.notes.trim(), `expense-notes:${record.id}`
      );
    }
  } else {
    // Sin vault, guardamos en claro (usuario sin PIN configurado)
    record.title = data.title.trim();
    if (data.notes) record.notes = data.notes.trim();
  }

  await tx('readwrite', s => s.put(record));
  return record;
}

export async function updateExpense(id, patch) {
  const existing = await tx('readonly', s => s.get(id));
  if (!existing) throw new Error('Gasto no encontrado');

  const next = { ...existing, updatedAt: Date.now() };

  // Campos numéricos/operativos · en claro
  if (patch.amount !== undefined)     next.amount = Number(patch.amount);
  if (patch.currency !== undefined)   next.currency = patch.currency;
  if (patch.paidBy !== undefined)     next.paidBy = patch.paidBy;
  if (patch.splitAmong !== undefined) next.splitAmong = [...patch.splitAmong];
  if (patch.splitType !== undefined)  next.splitType = patch.splitType;
  if (patch.category !== undefined)   next.category = patch.category;
  if (patch.customSplits !== undefined) {
    next.customSplits = patch.splitType === 'custom' ? { ...patch.customSplits } : null;
  }

  // Cifrado de title/notes si cambian
  if (patch.title !== undefined || patch.notes !== undefined) {
    if (vault.isUnlocked()) {
      const key = await vault.getTripKey(next.tripId);
      if (patch.title !== undefined) {
        next.titleEncrypted = await crypto.encryptString(
          key, patch.title.trim(), `expense:${id}`
        );
        delete next.title;
      }
      if (patch.notes !== undefined) {
        if (patch.notes) {
          next.notesEncrypted = await crypto.encryptString(
            key, patch.notes.trim(), `expense-notes:${id}`
          );
        } else {
          delete next.notesEncrypted;
        }
        delete next.notes;
      }
    } else {
      if (patch.title !== undefined) next.title = patch.title.trim();
      if (patch.notes !== undefined) next.notes = patch.notes.trim();
    }
  }

  validateExpense({ ...next, title: patch.title ?? next.title ?? 'placeholder' });

  await tx('readwrite', s => s.put(next));
  return next;
}

export async function deleteExpense(id) {
  await tx('readwrite', s => s.delete(id));
}

export async function clearAllExpenses() {
  await tx('readwrite', s => s.clear());
}

/* ============================================================
   Lectura · con hidratación (descifrado de title/notes)
   ============================================================ */
export async function getExpense(id) {
  const rec = await tx('readonly', s => s.get(id));
  if (!rec) return null;
  return hydrate(rec);
}

export async function getAllExpenses(tripId = null) {
  const all = (await tx('readonly', s => s.getAll())) || [];
  const filtered = tripId ? all.filter(e => e.tripId === tripId) : all;
  filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return Promise.all(filtered.map(r => hydrate(r)));
}

export async function getExpensesByCategory(tripId, category) {
  const all = await getAllExpenses(tripId);
  return all.filter(e => e.category === category);
}

/* ============================================================
   Hidratación
   ============================================================ */
async function hydrate(rec) {
  const out = { ...rec };
  delete out.titleEncrypted;
  delete out.notesEncrypted;

  if (!vault.isUnlocked()) {
    out.locked = true;
    out.title = out.title || '🔒 Gasto';
    return out;
  }

  try {
    const key = await vault.getTripKey(rec.tripId);
    if (!key) { out.locked = true; return out; }

    if (rec.titleEncrypted) {
      out.title = await crypto.decryptString(key, rec.titleEncrypted, `expense:${rec.id}`);
    }
    if (rec.notesEncrypted) {
      out.notes = await crypto.decryptString(key, rec.notesEncrypted, `expense-notes:${rec.id}`);
    }
  } catch (err) {
    console.warn('[expenses] decrypt falló:', err.message);
    out.locked = true;
    out.title = out.title || '🔒 Gasto';
  }
  return out;
}

/* ============================================================
   Balance · quién pagó cuánto y cuánto le corresponde
   ------------------------------------------------------------
   - splitAmong vacío = "todos los viajeros del viaje"
   - Cada viajero tiene: pagó X, le toca Y
   - Balance = pagó - le_toca
     positivo → le deben
     negativo → debe
   ============================================================ */

/**
 * @param {Array} expenses
 * @param {Array<string>} travelerIds  Todos los viajeros del viaje
 * @returns {{ [travelerId]: { paid: number, owes: number, balance: number } }}
 */
export function computeBalances(expenses, travelerIds) {
  const balances = {};
  for (const id of travelerIds) {
    balances[id] = { paid: 0, owes: 0, balance: 0 };
  }

  for (const ex of expenses) {
    const amount = Number(ex.amount) || 0;
    const payer = ex.paidBy;
    const among = (ex.splitAmong && ex.splitAmong.length)
      ? ex.splitAmong
      : travelerIds;

    if (!among.length) continue;

    // Sumar al que pagó
    if (balances[payer]) {
      balances[payer].paid += amount;
    } else {
      balances[payer] = { paid: amount, owes: 0, balance: 0 };
    }

    // Calcular cuánto le toca a cada uno
    let shares = {};
    if (ex.splitType === 'custom' && ex.customSplits) {
      // Custom: cada uno paga lo que dice customSplits (validado al guardar)
      shares = { ...ex.customSplits };
    } else {
      // Equal: dividir en partes iguales
      const per = amount / among.length;
      for (const t of among) shares[t] = per;
    }

    for (const [tid, share] of Object.entries(shares)) {
      if (!balances[tid]) balances[tid] = { paid: 0, owes: 0, balance: 0 };
      balances[tid].owes += Number(share) || 0;
    }
  }

  // Balance neto
  for (const id of Object.keys(balances)) {
    const b = balances[id];
    b.balance = +(b.paid - b.owes).toFixed(2);
    b.paid    = +b.paid.toFixed(2);
    b.owes    = +b.owes.toFixed(2);
  }

  return balances;
}

/* ============================================================
   Settlements · "quién le paga a quién" con mínimo de transacciones
   Algoritmo greedy: matchea el deudor más grande con el acreedor
   más grande, transfiere el mínimo de los dos, y sigue.
   ============================================================ */

/**
 * @param {{ [travelerId]: { balance: number } }} balances
 * @returns {Array<{ from: string, to: string, amount: number }>}
 */
export function computeSettlements(balances) {
  const debtors = [];    // { id, amount: positivo }
  const creditors = [];  // { id, amount: positivo }

  for (const [id, b] of Object.entries(balances)) {
    const net = +(b.balance || 0).toFixed(2);
    if (net < -0.01) debtors.push({ id, amount: -net });
    else if (net > 0.01) creditors.push({ id, amount: net });
  }

  // Ordenar: deudores con más deuda primero, acreedores con más crédito primero
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transfers = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const amount = Math.min(d.amount, c.amount);

    transfers.push({
      from: d.id,
      to: c.id,
      amount: +amount.toFixed(2),
    });

    d.amount -= amount;
    c.amount -= amount;

    if (d.amount < 0.01) i++;
    if (c.amount < 0.01) j++;
  }

  return transfers;
}

/* ============================================================
   Totales
   ============================================================ */
export function getTripTotal(expenses) {
  const byCurrency = {};
  for (const ex of expenses) {
    const cur = ex.currency || 'EUR';
    byCurrency[cur] = (byCurrency[cur] || 0) + (Number(ex.amount) || 0);
  }
  for (const cur of Object.keys(byCurrency)) {
    byCurrency[cur] = +byCurrency[cur].toFixed(2);
  }
  return byCurrency;
}

/* ============================================================
   Wipe por viaje
   ============================================================ */
export async function wipeTripExpenses(tripId) {
  const idb = await db();
  await new Promise((resolve, reject) => {
    const t = idb.transaction(STORE, 'readwrite');
    const idx = t.objectStore(STORE).index('tripId');
    const cur = idx.openCursor(tripId);
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) { c.delete(); c.continue(); }
      else resolve();
    };
    cur.onerror = () => reject(cur.error);
  });
}

/* ============================================================
   Backup export/import
   ============================================================ */
export async function exportRaw() {
  return (await tx('readonly', s => s.getAll())) || [];
}

export async function importRaw(records) {
  for (const rec of records || []) {
    await tx('readwrite', s => s.put(rec));
  }
}