/* ============================================================
   OhMyGoch Trip OS · vault.js
   Sesión de claves + lock screen + wipe criptográfico
   - Master key: PBKDF2(PIN, salt) · vive SOLO en memoria
   - Data key por viaje: AES-256 aleatoria, envuelta por master
   - Crypto-shredding: borrar la data key = datos irrecuperables
   ============================================================ */

import * as crypto from './crypto.js';

const IDB_NAME    = 'omg-tripos-vault';
const IDB_VERSION = 1;
const STORE_META  = 'meta';    // { key, value }  → salt, pinCheck
const STORE_KEYS  = 'keys';    // { tripId, wrapped }  → data key envuelta
const META_SALT   = 'masterSalt';
const META_CHECK  = 'pinCheck';
const SALT_BYTES  = 16;

let masterKey    = null;        // CryptoKey en memoria (o null si locked)
let unlockedAt   = 0;
let autoLockMs   = 15 * 60 * 1000;   // 15 min por defecto
let lockTimer    = null;
let onLockCb     = null;

/* ============================================================
   IndexedDB
   ============================================================ */
let _db;
function db() {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(STORE_META)) {
        idb.createObjectStore(STORE_META, { keyPath: 'key' });
      }
      if (!idb.objectStoreNames.contains(STORE_KEYS)) {
        idb.createObjectStore(STORE_KEYS, { keyPath: 'tripId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _db;
}

function tx(store, mode, fn) {
  return db().then(idb => new Promise((resolve, reject) => {
    const t = idb.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    t.onerror    = () => reject(t.error);
    t.onabort    = () => reject(t.error);
  }));
}

const metaGet = k => tx(STORE_META, 'readonly',  s => s.get(k));
const metaPut = v => tx(STORE_META, 'readwrite', s => s.put(v));

/* ============================================================
   Bootstrap / estado
   ============================================================ */

/** ¿Ya se configuró un PIN en este device? */
export async function isConfigured() {
  const salt = await metaGet(META_SALT);
  return !!(salt && salt.value);
}

/** Crea un vault nuevo con el PIN dado. */
export async function setup(pin) {
  if (await isConfigured()) throw new Error('Vault ya configurado');
  const { key, salt } = await crypto.deriveMasterKey(pin);
  await metaPut({ key: META_SALT, value: salt });
  // Guardamos un test vector para validar el PIN al desbloquear
  const check = await crypto.encryptString(key, 'omg-ok', 'pin-check');
  await metaPut({ key: META_CHECK, value: check });
  masterKey = key;
  unlockedAt = Date.now();
  scheduleAutoLock();
  return true;
}

/** Desbloquea con PIN. Lanza si es incorrecto. */
export async function unlock(pin) {
  const saltMeta = await metaGet(META_SALT);
  if (!saltMeta?.value) throw new Error('Vault no configurado');
  const checkMeta = await metaGet(META_CHECK);
  if (!checkMeta?.value) throw new Error('Vault corrupto');

  const { key } = await crypto.deriveMasterKey(pin, saltMeta.value);
  try {
    const test = await crypto.decryptString(key, checkMeta.value, 'pin-check');
    if (test !== 'omg-ok') throw new Error('bad');
  } catch {
    throw new Error('PIN incorrecto');
  }
  masterKey = key;
  unlockedAt = Date.now();
  scheduleAutoLock();
  return true;
}

/** Bloquea: borra la master key de memoria. */
export function lock() {
  masterKey = null;
  unlockedAt = 0;
  if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; }
  if (onLockCb) try { onLockCb(); } catch {}
}

export function isUnlocked() {
  return masterKey !== null;
}

export function setAutoLock(ms) {
  autoLockMs = ms;
  if (masterKey) scheduleAutoLock();
}

export function onLock(cb) { onLockCb = cb; }

function scheduleAutoLock() {
  if (lockTimer) clearTimeout(lockTimer);
  lockTimer = setTimeout(() => lock(), autoLockMs);
}

/** Reset "user activity" — llamar desde eventos de UI. */
export function touch() {
  if (masterKey) scheduleAutoLock();
}

/* ============================================================
   Data keys por viaje
   ============================================================ */

/** Obtiene (o crea) la data key del viaje. Requiere unlocked. */
export async function getTripKey(tripId, { create = false } = {}) {
  if (!masterKey) throw new Error('Vault locked');

  const invalid =
    tripId == null ||
    typeof tripId !== 'string' ||
    tripId.length === 0 ||
    tripId === 'undefined' ||
    tripId === 'null';

  if (invalid) {
    throw new Error(`getTripKey: tripId inválido (${typeof tripId}: ${JSON.stringify(tripId)})`);
  }

  const rec = await tx(STORE_KEYS, 'readonly', s => s.get(tripId));
  if (rec?.wrapped) return crypto.unwrapKey(masterKey, rec.wrapped);
  if (!create) return null;

  const dataKey = await crypto.generateDataKey();
  const wrapped = await crypto.wrapKey(masterKey, dataKey);
  await tx(STORE_KEYS, 'readwrite', s => s.put({ tripId, wrapped, createdAt: Date.now() }));
  return dataKey;
}

/** Crypto-shredding: borra la data key → datos irrecuperables. */
export async function destroyTripKey(tripId) {
  await tx(STORE_KEYS, 'readwrite', s => s.delete(tripId));
}

/** Rota el PIN: re-envuelve todas las data keys. */
export async function changePIN(oldPin, newPin) {
  if (!masterKey) throw new Error('Vault locked');
  const saltMeta = await metaGet(META_SALT);
  const { key: oldKey } = await crypto.deriveMasterKey(oldPin, saltMeta.value);

  // Verificar oldPin comparando con el check actual
  const checkMeta = await metaGet(META_CHECK);
  try {
    await crypto.decryptString(oldKey, checkMeta.value, 'pin-check');
  } catch {
    throw new Error('PIN actual incorrecto');
  }

  const { key: newKey, salt: newSalt } = await crypto.deriveMasterKey(newPin);

  // Re-envolver cada data key
  const all = await tx(STORE_KEYS, 'readonly', s => s.getAll());
  for (const rec of all || []) {
    const raw = await crypto.unwrapKey(oldKey, rec.wrapped);   // CryptoKey no-extraíble
    // Necesitamos exportar+importar para re-envolver
    const rawBytes = await crypto.subtle.exportKey('raw', raw);
    const imported = await crypto.subtle.importKey(
      'raw', rawBytes, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
    );
    const rewrapped = await crypto.wrapKey(newKey, imported);
    await tx(STORE_KEYS, 'readwrite', s => s.put({ ...rec, wrapped: rewrapped }));
    crypto.wipeBytes(new Uint8Array(rawBytes));
  }

  // Actualizar salt y check
  await metaPut({ key: META_SALT, value: newSalt });
  const newCheck = await crypto.encryptString(newKey, 'omg-ok', 'pin-check');
  await metaPut({ key: META_CHECK, value: newCheck });

  masterKey = newKey;
  return true;
}

/* ============================================================
   Wipe total (GDPR / Ley 25.326)
   ============================================================ */
export async function wipeAll() {
  lock();
  try { indexedDB.deleteDatabase(IDB_NAME); } catch {}
}

/* ============================================================
   Import de backup: recibir una data key ya descifrada y
   envolverla con la master key del device actual.
   ============================================================ */
export async function importTripKey(tripId, dataKey) {
  if (!masterKey) throw new Error('Vault locked');
  if (typeof tripId !== 'string' || !tripId) {
    throw new Error('importTripKey: tripId inválido');
  }
  const wrapped = await crypto.wrapKey(masterKey, dataKey);
  await tx(STORE_KEYS, 'readwrite', s => s.put({
    tripId, wrapped, createdAt: Date.now(),
  }));
}
