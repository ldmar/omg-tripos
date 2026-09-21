/* ============================================================
   OhMyGoch Trip OS · wallet.js  (v2)
   Storage cifrado · AES-GCM 256 en reposo
   - Metadata en claro (name, mime, size, category) para queries
   - Blob + thumbnail cifrados con la data key del viaje
   - Fallback a plano si vault cerrado (con flag .encrypted = false)
   ============================================================ */

import * as vault from './vault.js';
import * as crypto from './crypto.js';

const DB_NAME = 'omg-tripos-wallet';
const DB_VERSION = 2;
const STORE_FILES = 'files';

const CATEGORIES = {
  boarding:  { label: 'Boarding',   icon: '🎫', color: '#3b82f6' },
  voucher:   { label: 'Voucher',    icon: '🏨', color: '#8b5cf6' },
  insurance: { label: 'Seguro',     icon: '🛡', color: '#10b981' },
  id:        { label: 'Documento',  icon: '🪪', color: '#f59e0b' },
  car:       { label: 'Auto',       icon: '🚗', color: '#6366f1' },
  other:     { label: 'Otro',       icon: '📎', color: '#6b7280' },
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
    req.onupgradeneeded = (e) => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(STORE_FILES)) {
        const store = idb.createObjectStore(STORE_FILES, { keyPath: 'id' });
        store.createIndex('tripId',     'tripId',     { unique: false });
        store.createIndex('eventId',    'eventId',    { unique: false });
        store.createIndex('category',   'category',   { unique: false });
        store.createIndex('uploadedAt', 'uploadedAt', { unique: false });
      }
      // v1 → v2: no schema break, sólo nuevos campos opcionales.
      // Los registros viejos tienen `blob` plano y `encrypted` undefined.
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
  return _db;
}

function tx(mode, fn) {
  return db().then(idb => new Promise((resolve, reject) => {
    const t = idb.transaction(STORE_FILES, mode);
    const result = fn(t.objectStore(STORE_FILES));
    t.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    t.onerror    = () => reject(t.error);
    t.onabort    = () => reject(t.error);
  }));
}

/* ============================================================
   API pública
   ============================================================ */
export function uid() {
  return 'f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export async function saveFile(file, opts = {}) {
  if (!file) throw new Error('Sin archivo');
  if (file.size > 15 * 1024 * 1024) throw new Error('Máximo 15 MB por archivo');

  const quota = await checkQuota(file.size);
  if (!quota.ok) throw new Error(quota.reason);

  const id = uid();
  const thumbnail = await generateThumbnail(file).catch(() => null);
  const category = opts.category || autoCategory(file, opts.eventType);

  const record = {
    id,
    tripId: opts.tripId || null,
    eventId: opts.eventId || null,
    name: file.name || 'archivo',
    mime: file.type || 'application/octet-stream',
    size: file.size,
    category,
    uploadedAt: Date.now(),
    updatedAt: Date.now(),
    encrypted: false,
  };

  const tryEncrypt = vault.isUnlocked() && opts.tripId;

  if (tryEncrypt) {
    try {
      const key = await vault.getTripKey(opts.tripId, { create: true });
      record.blobEncrypted = await crypto.encryptBlob(key, file, `doc:${id}`);
      if (thumbnail) {
        record.thumbnailEncrypted = await crypto.encryptBlob(key, thumbnail, 'image/jpeg', `thumb:${id}`);
      }
      record.encrypted = true;
    } catch (err) {
      console.warn('[wallet] cifrado falló, guardando en claro:', err);
      record.blob = file;
      if (thumbnail) record.thumbnail = thumbnail;
    }
  } else {
    record.blob = file;
    if (thumbnail) record.thumbnail = thumbnail;
  }

  await tx('readwrite', s => s.put(record));
  return hydrate(record, /* withBlob */ false);
}

/** Devuelve un registro con el blob descifrado. */
export async function getFile(id) {
  const rec = await tx('readonly', s => s.get(id));
  if (!rec) return null;
  return hydrate(rec, /* withBlob */ true);
}

/** Devuelve todos los registros del viaje (o todos). Blobs NO descifrados. */
export async function getAllFiles(tripId = null) {
  const all = (await tx('readonly', s => s.getAll())) || [];
  const filtered = tripId ? all.filter(f => f.tripId === tripId) : all;
  filtered.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
  return Promise.all(filtered.map(r => hydrate(r, false)));
}

export async function getFilesByEvent(eventId) {
  if (!eventId) return [];
  const list = await new Promise((resolve, reject) => {
    db().then(idb => {
      const t = idb.transaction(STORE_FILES, 'readonly');
      const idx = t.objectStore(STORE_FILES).index('eventId');
      const req = idx.getAll(eventId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
  });
  list.sort((a, b) => (a.uploadedAt || 0) - (b.uploadedAt || 0));
  return Promise.all(list.map(r => hydrate(r, false)));
}

export async function updateFile(id, patch) {
  const existing = await tx('readonly', s => s.get(id));
  if (!existing) throw new Error('Archivo no encontrado');
  const updated = { ...existing, ...patch, updatedAt: Date.now() };
  await tx('readwrite', s => s.put(updated));
  return hydrate(updated, false);
}

export async function deleteFile(id) {
  await tx('readwrite', s => s.delete(id));
}

export async function clearAllFiles() {
  await tx('readwrite', s => s.clear());
}

/* ============================================================
   Hidratación: convierte el record en su vista pública
   - Quita campos cifrados crudos del output
   - Descifra thumbnail siempre (barata)
   - Descifra blob sólo si withBlob
   - Marca `locked` si cifrado pero vault cerrado
   ============================================================ */
async function hydrate(rec, withBlob) {
  const out = { ...rec };
  delete out.blobEncrypted;
  delete out.thumbnailEncrypted;

  const isEncrypted = !!rec.encrypted;

  if (!isEncrypted) {
    // v1: ya viene plano
    if (rec.blob)       out.blob = rec.blob;
    if (rec.thumbnail)  out.thumbnail = rec.thumbnail;
    return out;
  }

  if (!vault.isUnlocked() || !rec.tripId) {
    out.locked = true;
    return out;
  }

  try {
    const key = await vault.getTripKey(rec.tripId);
    if (!key) { out.locked = true; return out; }

    if (withBlob && rec.blobEncrypted) {
      out.blob = await crypto.decryptBlob(key, rec.blobEncrypted, rec.mime, `doc:${rec.id}`);
    }
    if (rec.thumbnailEncrypted) {
      out.thumbnail = await crypto.decryptBlob(key, rec.thumbnailEncrypted, 'image/jpeg', `thumb:${rec.id}`);
    }
  } catch (err) {
    console.warn('[wallet] descifrado falló:', err);
    out.locked = true;
  }
  return out;
}

/* ============================================================
   Stats + quota
   ============================================================ */
export async function getStats(tripId = null) {
  const all = await getAllFiles(tripId);
  const count = all.length;
  const totalBytes = all.reduce((sum, f) => sum + (f.size || 0), 0);

  let quotaBytes = 0, usageBytes = 0;
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      quotaBytes = est.quota || 0;
      usageBytes = est.usage || 0;
    }
  } catch {}
  return { count, totalBytes, quotaBytes, usageBytes, encrypted: all.filter(f => f.encrypted).length };
}

async function checkQuota(newBytes) {
  try {
    if (!navigator.storage?.estimate) return { ok: true };
    const est = await navigator.storage.estimate();
    const remaining = (est.quota || 0) - (est.usage || 0);
    if (remaining > 0 && newBytes > remaining * 0.9) {
      return { ok: false, reason: 'Sin espacio. Borrá archivos primero.' };
    }
  } catch {}
  return { ok: true };
}

/* ============================================================
   Thumbnails + auto-categoría + formatters
   (idénticos a v1, sin cambios)
   ============================================================ */
async function generateThumbnail(file, maxSize = 300) {
  if (!file.type.startsWith('image/')) return null;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        canvas.width  = Math.max(1, Math.round(img.width  * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(b => resolve(b), 'image/jpeg', 0.75);
      } catch { URL.revokeObjectURL(url); resolve(null); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

const AIRLINES_REGEX = /aerolineas|aerol[ií]neas|lufthansa|iberia|vueling|latam|avianca|american|united|delta|klm|air\s*france|ryanair|easyjet|air\s*europa|aeromex|aerom[eé]xico|\bgol\b|azul|copa|despegar|edreams|expedia|jetblue|norwegian|swiss|tap\s*air|alitalia|emirates|qatar|etihad|singapore/i;
const AIRLINE_CODES_REGEX = /^(ar|la|aa|ua|dl|ib|vy|af|kl|lh|av|cm|g3|ad|am|ac|ba|az|ux|ws|b6|nk|f9|as|ha|wn|ja|h2|v7|vx|w6|wz|u2|fr|dy|tp|ek|qr|ey|sq|tg|ca|cz|mu)\b/i;

function autoCategory(file, eventType) {
  const name = (file.name || '').toLowerCase();
  if (/boarding|tarjeta.*embarque|pase.*abordar|check-?in.*pass|boardingpass/.test(name)) return 'boarding';
  if (AIRLINES_REGEX.test(name)) return 'boarding';
  const stripped = name.replace(/[_\-.]+/g, ' ').trim();
  if (AIRLINE_CODES_REGEX.test(stripped) && /\d/.test(stripped)) return 'boarding';
  if (/\b[a-z]{2}\s?\d{2,4}\b/i.test(name) && /(vuelo|flight|air|aer)/.test(name)) return 'boarding';
  if (/voucher|reserva|booking|airbnb|hotel|hospedaje|alojamiento|check-?in|check-?out/.test(name)) return 'voucher';
  if (/seguro|insurance|poliza|p[oó]liza|cobertura/.test(name)) return 'insurance';
  if (/\b(dni|pasaporte|passport|id\b|c[eé]dula|cedula|licencia|identidad)\b/.test(name)) return 'id';
  if (/\b(auto|car|rental|alquiler|hertz|avis|europcar|sixt|budget|enterprise)\b/.test(name)) return 'car';
  if (eventType === 'flight') return 'boarding';
  if (eventType === 'hotel' || eventType === 'airbnb') return 'voucher';
  if (eventType === 'car') return 'car';
  return 'other';
}

export function fmtBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

export function isPdf(file) {
  return file?.mime === 'application/pdf' || /\.pdf$/i.test(file?.name || '');
}
export function isImage(file) {
  return /^image\//.test(file?.mime || '');
}

/* ============================================================
   Migración v1 (plano) → v2 (cifrado)
   Escanea TODOS los archivos, agrupa por tripId y cifra en lote.
   Idempotente: los que ya tienen encrypted=true se saltean.
   ============================================================ */
export async function reencryptPlaintext() {
  if (!vault.isUnlocked()) throw new Error('Vault locked');

  const all = await tx('readonly', s => s.getAll());

  // Filtro ultra-estricto: rechaza null, undefined, "", "undefined", "null", números, objetos
  const isValid = (r) => {
    if (r.encrypted) return false;
    if (!r.blob) return false;
    const t = r.tripId;
    if (t == null) return false;
    if (typeof t !== 'string') return false;
    if (t.length === 0) return false;
    if (t === 'undefined' || t === 'null') return false;
    return true;
  };

  const pending = (all || []).filter(isValid);

  // Diagnóstico: qué quedó afuera
  const orphans = (all || []).filter(r => !r.encrypted && r.blob && !isValid(r));
  if (orphans.length) {
    console.warn(
      `[wallet] ${orphans.length} archivo(s) huérfano(s):`,
      orphans.map(o => ({
        id: (o.id || '').slice(0, 10),
        name: o.name,
        tripId: o.tripId,
        tripIdType: typeof o.tripId,
      }))
    );
  }

  if (!pending.length) return { migrated: 0, failed: [], total: 0, orphans: orphans.length };

  const keys = new Map();
  let migrated = 0;
  const failed = [];

  for (const rec of pending) {
    // Guard redundante: si algo cambió desde el filtro, saltear
    if (typeof rec.tripId !== 'string' || !rec.tripId) {
      failed.push({ id: rec.id, name: rec.name, reason: 'tripId inválido' });
      continue;
    }

    try {
      let key = keys.get(rec.tripId);
      if (!key) {
        key = await vault.getTripKey(rec.tripId, { create: true });
        keys.set(rec.tripId, key);
      }

      const blobCt = await crypto.encryptBlob(key, rec.blob, `doc:${rec.id}`);
      let thumbCt;
      if (rec.thumbnail) {
        thumbCt = await crypto.encryptBlob(key, rec.thumbnail, 'image/jpeg', `thumb:${rec.id}`);
      }

      const next = { ...rec, encrypted: true, blobEncrypted: blobCt, updatedAt: Date.now() };
      if (thumbCt) next.thumbnailEncrypted = thumbCt;
      delete next.blob;
      delete next.thumbnail;

      await tx('readwrite', s => s.put(next));
      migrated++;
    } catch (err) {
      console.warn(`[wallet] no se pudo migrar ${rec.id} (${rec.name}):`, err);
      failed.push({ id: rec.id, name: rec.name, reason: err.message });
    }
  }

  return { migrated, failed, total: pending.length, orphans: orphans.length };
}

/* ============================================================
   Export/import para backup cifrado
   - exportRaw: devuelve registros tal cual están (blobs cifrados)
   - importRaw: inserta sin transformar
   ============================================================ */
export async function exportRaw() {
  const all = await tx('readonly', s => s.getAll());
  return all || [];
}

export async function importRaw(records) {
  for (const rec of records || []) {
    await tx('readwrite', s => s.put(rec));
  }
}
