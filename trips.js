/* ============================================================
   OhMyGoch Trip OS · trips.js
   Storage central · eventos + meta + trips
   ============================================================ */

const DB_NAME = 'omg-tripos';
const DB_VERSION = 3;
const OLD_DB_NAME = 'ohmygoch';
const OLD_WALLET_DB = 'ohmygoch-wallet';
const NEW_WALLET_DB = 'omg-tripos-wallet';
const STORE_EVENTS = 'events';
const STORE_META = 'meta';
const STORE_TRIPS = 'trips';
const STORE_TRAVELERS = 'travelers';
const META_ACTIVE = 'activeTripId';
const META_MIGRATED = 'migration_v2_done';

/* ============================================================
   DB setup
   ============================================================ */
let _db;
function db() {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const idb = req.result;
      const oldVersion = e.oldVersion;

      // v1: events + meta + trips
      if (oldVersion < 1) {
        if (!idb.objectStoreNames.contains(STORE_EVENTS)) {
          const s = idb.createObjectStore(STORE_EVENTS, { keyPath: 'id' });
          s.createIndex('tripId', 'tripId');
          s.createIndex('startAt', 'startAt');
        }
        if (!idb.objectStoreNames.contains(STORE_META)) {
          idb.createObjectStore(STORE_META, { keyPath: 'key' });
        }
        if (!idb.objectStoreNames.contains(STORE_TRIPS)) {
          idb.createObjectStore(STORE_TRIPS, { keyPath: 'id' });
        }
      }

      // v1.x: agregar índice tripId si falta (idempotente)
      if (idb.objectStoreNames.contains(STORE_EVENTS)) {
        const eventsStore = req.transaction.objectStore(STORE_EVENTS);
        if (!eventsStore.indexNames.contains('tripId')) {
          eventsStore.createIndex('tripId', 'tripId');
        }
        if (!eventsStore.indexNames.contains('startAt')) {
          eventsStore.createIndex('startAt', 'startAt');
        }
      }

      // v2: travelers
      if (!idb.objectStoreNames.contains(STORE_TRAVELERS)) {
        const t = idb.createObjectStore(STORE_TRAVELERS, { keyPath: 'id' });
        t.createIndex('tripId', 'tripId');
        console.log('[trips] store "travelers" creado');
      }

      console.log(`[trips] DB upgrade v${oldVersion} → v${DB_VERSION}`);
    };

    req.onsuccess = () => {
      const idb = req.result;

      // Liberar conexión si otra pestaña quiere upgradear
      idb.onversionchange = () => {
        console.log('[trips] versionchange · cerrando conexión');
        idb.close();
        _db = null;
      };

      // Verificación post-open
      const expected = [STORE_EVENTS, STORE_META, STORE_TRIPS, STORE_TRAVELERS];
      const missing = expected.filter(s => !idb.objectStoreNames.contains(s));
      if (missing.length) {
        console.error('[trips] stores faltantes tras open:', missing);
        idb.close();
        _db = null;
        return reject(new Error(`IDB inconsistente: faltan ${missing.join(', ')}`));
      }

      resolve(idb);
    };

    req.onerror = () => reject(req.error);

    req.onblocked = () => {
      console.warn('[trips] IDB upgrade bloqueado. Cerrá todas las demás pestañas de la app.');
    };
  });
  return _db;
}

/* ============================================================
   ✅ FIX: detectar IDBRequest vs valor plano
   ============================================================ */
function tx(store, mode, fn) {
  return db().then(idb => new Promise((resolve, reject) => {
    const t = idb.transaction(store, mode);
    const s = t.objectStore(store);
    const result = fn(s);
    t.oncomplete = () => {
      // Si el resultado es un IDBRequest, extraer su .result
      // (undefined si no se encontró nada, el registro si sí)
      if (result instanceof IDBRequest) {
        resolve(result.result);
      } else {
        resolve(result);
      }
    };
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const idbAll    = (store)      => tx(store, 'readonly',  s => s.getAll());
export const idbGet    = (store, key) => tx(store, 'readonly',  s => s.get(key));
export const idbPut    = (store, val) => tx(store, 'readwrite', s => s.put(val));
export const idbDelete = (store, key) => tx(store, 'readwrite', s => s.delete(key));
export const idbClear  = (store)      => tx(store, 'readwrite', s => s.clear());

export const STORES = { EVENTS: STORE_EVENTS, META: STORE_META, TRIPS: STORE_TRIPS, TRAVELERS: STORE_TRAVELERS, };

/* ============================================================
   Utils
   ============================================================ */
export function uid() {
  return 'e_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function tripUid() {
  return 'trip_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function daysBetween(start, end) {
  if (!start || !end) return 0;
  const a = new Date(start), b = new Date(end);
  return Math.max(1, Math.round((b - a) / (24 * 60 * 60 * 1000)) + 1);
}

/* ============================================================
   Trip CRUD
   ============================================================ */
export async function listTrips() {
  const all = await idbAll(STORE_TRIPS);
  return (all || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getTrip(id) {
  if (!id) return null;
  const t = await idbGet(STORE_TRIPS, id);
  return t || null;
}

export async function getActiveTrip() {
  const meta = await idbGet(STORE_META, META_ACTIVE);
  if (!meta?.value) return null;
  return getTrip(meta.value);
}

export async function setActiveTrip(id) {
  await idbPut(STORE_META, { key: META_ACTIVE, value: id });
}

export async function createTrip(data) {
  const now = Date.now();
  const trip = {
    id: data.id || tripUid(),
    title: (data.title || 'Nuevo viaje').trim(),
    flag: data.flag || '🌍',
    startDate: data.startDate || null,
    endDate: data.endDate || null,
    days: daysBetween(data.startDate, data.endDate),
    travelers: data.travelers || 1,
    currency: data.currency || 'EUR',
    timezone: data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    createdAt: now,
    updatedAt: now,
  };
  await idbPut(STORE_TRIPS, trip);
  await setActiveTrip(trip.id);
  return trip;
}

export async function updateTrip(id, patch) {
  const existing = await getTrip(id);
  if (!existing) throw new Error('Viaje no encontrado');
  const updated = { ...existing, ...patch, updatedAt: Date.now() };
  if (patch.startDate || patch.endDate) {
    updated.days = daysBetween(updated.startDate, updated.endDate);
  }
  await idbPut(STORE_TRIPS, updated);
  return updated;
}

export async function deleteTrip(id) {
  const events = await getTripEvents(id);
  for (const ev of events) await idbDelete(STORE_EVENTS, ev.id);

  try { await deleteTripFiles(id); } catch (e) {
    console.warn('No se pudieron borrar archivos de wallet:', e);
  }

  const travelers = await getTravelersByTrip(id);
  for (const tr of travelers) await idbDelete(STORE_TRAVELERS, tr.id);
  await idbDelete(STORE_TRIPS, id);

  const activeMeta = await idbGet(STORE_META, META_ACTIVE);
  if (activeMeta?.value === id) {
    const remaining = await listTrips();
    if (remaining.length > 0) {
      await setActiveTrip(remaining[0].id);
    } else {
      const fresh = await createTrip({ title: 'Mi viaje', flag: '🌍' });
      await setActiveTrip(fresh.id);
    }
  }
}

export async function getTripEvents(tripId) {
  if (!tripId) return [];
  return new Promise((resolve, reject) => {
    db().then(idb => {
      const t = idb.transaction(STORE_EVENTS, 'readonly');
      const idx = t.objectStore(STORE_EVENTS).index('tripId');
      const req = idx.getAll(tripId);
      req.onsuccess = () => {
        const list = (req.result || []).sort(
          (a, b) => new Date(a.startAt) - new Date(b.startAt)
        );
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

export async function countTripData(tripId) {
  const events = await getTripEvents(tripId);
  let files = 0;
  try { files = await countTripFiles(tripId); } catch {}
  return { events: events.length, files };
}

/* ============================================================
   Travelers
   ============================================================ */
export async function getTravelersByTrip(tripId) {
  if (!tripId) return [];
  const idb = await db();

  // Guard: el store puede no existir si la DB quedó en v1
  if (!idb.objectStoreNames.contains(STORE_TRAVELERS)) {
    console.warn('[trips] store "travelers" no existe (DB en v1). Recargá con todas las demás pestañas cerradas.');
    return [];
  }

  return new Promise((resolve, reject) => {
    const t = idb.transaction(STORE_TRAVELERS, 'readonly');
    const idx = t.objectStore(STORE_TRAVELERS).index('tripId');
    const req = idx.getAll(tripId);
    req.onsuccess = () => {
      const list = (req.result || []).sort((a, b) => {
        if (a.role === 'organizer' && b.role !== 'organizer') return -1;
        if (b.role === 'organizer' && a.role !== 'organizer') return 1;
        return (a.createdAt || 0) - (b.createdAt || 0);
      });
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getTraveler(id) {
  if (!id) return null;
  const idb = await db();
  if (!idb.objectStoreNames.contains(STORE_TRAVELERS)) return null;
  return (await idbGet(STORE_TRAVELERS, id)) || null;
}

/* ============================================================
   Wallet helpers
   ============================================================ */
const WALLET_DB = NEW_WALLET_DB;
const WALLET_STORE = 'files';

function walletDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(WALLET_DB, 1);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(WALLET_STORE)) {
        const s = idb.createObjectStore(WALLET_STORE, { keyPath: 'id' });
        s.createIndex('tripId', 'tripId');
        s.createIndex('eventId', 'eventId');
        s.createIndex('category', 'category');
        s.createIndex('uploadedAt', 'uploadedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function countTripFiles(tripId) {
  const idb = await walletDb();
  return new Promise((resolve, reject) => {
    const t = idb.transaction(WALLET_STORE, 'readonly');
    const idx = t.objectStore(WALLET_STORE).index('tripId');
    const req = idx.count(tripId);
    req.onsuccess = () => resolve(req.result || 0);
    req.onerror = () => reject(req.error);
  });
}

async function deleteTripFiles(tripId) {
  const idb = await walletDb();
  return new Promise((resolve, reject) => {
    const t = idb.transaction(WALLET_STORE, 'readwrite');
    const idx = t.objectStore(WALLET_STORE).index('tripId');
    const req = idx.openCursor(tripId);
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) {
        cur.delete();
        cur.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error);
  });
}

/* ============================================================
   Migración v1 → v2
   ============================================================ */
async function oldDbExists(name) {
  try {
    const dbs = await indexedDB.databases?.();
    if (dbs) return dbs.some(d => d.name === name);
  } catch {}
  return false;
}

async function readOldEvents() {
  return new Promise((resolve) => {
    const req = indexedDB.open(OLD_DB_NAME);
    req.onsuccess = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains('events')) {
        idb.close();
        return resolve([]);
      }
      const t = idb.transaction('events', 'readonly');
      const all = t.objectStore('events').getAll();
      all.onsuccess = () => { idb.close(); resolve(all.result || []); };
      all.onerror = () => { idb.close(); resolve([]); };
    };
    req.onerror = () => resolve([]);
  });
}

async function readOldMeta() {
  return new Promise((resolve) => {
    const req = indexedDB.open(OLD_DB_NAME);
    req.onsuccess = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains('meta')) {
        idb.close();
        return resolve(null);
      }
      const t = idb.transaction('meta', 'readonly');
      const all = t.objectStore('meta').get('trip');
      all.onsuccess = () => { idb.close(); resolve(all.result || null); };
      all.onerror = () => { idb.close(); resolve(null); };
    };
    req.onerror = () => resolve(null);
  });
}

async function readOldWalletFiles() {
  return new Promise((resolve) => {
    const req = indexedDB.open(OLD_WALLET_DB);
    req.onsuccess = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains('files')) {
        idb.close();
        return resolve([]);
      }
      const t = idb.transaction('files', 'readonly');
      const all = t.objectStore('files').getAll();
      all.onsuccess = () => { idb.close(); resolve(all.result || []); };
      all.onerror = () => { idb.close(); resolve([]); };
    };
    req.onerror = () => resolve([]);
  });
}

export async function migrateFromOldDb() {
  const migrated = await idbGet(STORE_META, META_MIGRATED);
  if (migrated?.value) return { skipped: true };

  const hasOld = await oldDbExists(OLD_DB_NAME);
  const hasOldWallet = await oldDbExists(OLD_WALLET_DB);

  if (!hasOld && !hasOldWallet) {
    await idbPut(STORE_META, { key: META_MIGRATED, value: true });
    return { skipped: true };
  }

  const oldMeta = await readOldMeta();
  const tripId = oldMeta?.id || 'madrid-2026';
  const trip = {
    id: tripId,
    title: oldMeta?.title || 'Escapada a Madrid',
    flag: oldMeta?.flag || '🇪🇸',
    startDate: null,
    endDate: null,
    days: oldMeta?.days || 5,
    travelers: oldMeta?.travelers || 4,
    currency: 'EUR',
    timezone: 'Europe/Madrid',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await idbPut(STORE_TRIPS, trip);

  const oldEvents = await readOldEvents();
  for (const ev of oldEvents) {
    ev.tripId = tripId;
    await idbPut(STORE_EVENTS, ev);
  }

  const oldFiles = await readOldWalletFiles();
  if (oldFiles.length) {
    const idb = await walletDb();
    await new Promise((resolve, reject) => {
      const t = idb.transaction(WALLET_STORE, 'readwrite');
      const store = t.objectStore(WALLET_STORE);
      for (const f of oldFiles) {
        f.tripId = tripId;
        store.put(f);
      }
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  }

  await setActiveTrip(tripId);
  await idbPut(STORE_META, { key: META_MIGRATED, value: true });

  console.log(`✅ Migración: ${oldEvents.length} eventos · ${oldFiles.length} archivos`);
  return { migrated: true, events: oldEvents.length, files: oldFiles.length };
}

/* ============================================================
   Init
   ============================================================ */
export async function ensureInitialized() {
  try {
    await migrateFromOldDb();

    const trips = await listTrips();
    if (!trips.length) {
      const fresh = await createTrip({
        title: 'Mi primer viaje',
        flag: '🌍',
        travelers: 1,
      });
      await setActiveTrip(fresh.id);
    }

    const active = await getActiveTrip();
    if (!active) {
      const list = await listTrips();
      if (list.length) await setActiveTrip(list[0].id);
    }
  } catch (err) {
    console.error('[trips] ensureInitialized falló:', err);
    // Si es error de IDB inconsistente, no hay mucho que hacer acá.
    // El boot debe fallar visiblemente para que el usuario sepa.
    throw err;
  }
}


import * as vault from './vault.js';
import * as crypto from './crypto.js';

/**
 * Devuelve el perfil descifrado de un viajero.
 * @param {object} traveler  Registro con { id, tripId, encryptedProfile }
 * @returns {Promise<object|null>}
 */
export async function getTravelerProfile(traveler) {
  if (!traveler?.encryptedProfile) return traveler || null;
  if (!vault.isUnlocked()) throw new Error('Vault locked');
  const key = await vault.getTripKey(traveler.tripId);
  if (!key) throw new Error('Sin data key');
  const json = await crypto.decryptString(key, traveler.encryptedProfile, `trav:${traveler.id}`);
  return JSON.parse(json);
}

/**
 * Devuelve una copia del viajero con el perfil cifrado.
 * @param {object} traveler  { id, tripId, name, role, color, ... }
 * @param {object} profile   Datos sensibles (documento, contacto emergencia…)
 */
export async function setTravelerProfile(traveler, profile) {
  if (!vault.isUnlocked()) throw new Error('Vault locked');
  const key = await vault.getTripKey(traveler.tripId, { create: true });
  const encryptedProfile = await crypto.encryptString(
    key, JSON.stringify(profile), `trav:${traveler.id}`
  );
  // Los campos sensibles NUNCA van al registro plano:
  const { document, emergencyContact, ...publicFields } = traveler;
  return { ...publicFields, encryptedProfile };
}
