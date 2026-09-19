/* ============================================================
   OhMyGoch Trip OS · wallet.js
   Storage de archivos · IndexedDB + Blobs · 100% client-side
   ============================================================ */

const DB_NAME = 'ohmygoch-wallet';
const DB_VERSION = 1;
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
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(STORE_FILES)) {
        const store = idb.createObjectStore(STORE_FILES, { keyPath: 'id' });
        store.createIndex('eventId', 'eventId', { unique: false });
        store.createIndex('category', 'category', { unique: false });
        store.createIndex('uploadedAt', 'uploadedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _db;
}

function tx(mode, fn) {
  return db().then(idb => new Promise((resolve, reject) => {
    const t = idb.transaction(STORE_FILES, mode);
    const s = t.objectStore(STORE_FILES);
    const result = fn(s);
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
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
    eventId: opts.eventId || null,
    name: file.name || 'archivo',
    mime: file.type || 'application/octet-stream',
    size: file.size,
    blob: file,
    thumbnail: thumbnail,
    category,
    uploadedAt: Date.now(),
    updatedAt: Date.now(),
  };

  await tx('readwrite', s => s.put(record));
  return record;
}

export async function getFile(id) {
  return tx('readonly', s => s.get(id));
}

export async function getAllFiles() {
  const all = await tx('readonly', s => s.getAll());
  return all.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
}

export async function getFilesByEvent(eventId) {
  if (!eventId) return [];
  const idx = await db().then(idb => {
    return new Promise((resolve, reject) => {
      const t = idb.transaction(STORE_FILES, 'readonly');
      const store = t.objectStore(STORE_FILES);
      const index = store.index('eventId');
      const req = index.getAll(eventId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  });
  return idx.sort((a, b) => (a.uploadedAt || 0) - (b.uploadedAt || 0));
}

export async function updateFile(id, patch) {
  const existing = await getFile(id);
  if (!existing) throw new Error('Archivo no encontrado');
  const updated = { ...existing, ...patch, updatedAt: Date.now() };
  await tx('readwrite', s => s.put(updated));
  return updated;
}

export async function deleteFile(id) {
  await tx('readwrite', s => s.delete(id));
}

export async function clearAllFiles() {
  await tx('readwrite', s => s.clear());
}

/* ============================================================
   Stats y quota
   ============================================================ */
export async function getStats() {
  const all = await getAllFiles();
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

  return { count, totalBytes, quotaBytes, usageBytes };
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
   Thumbnails
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
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(b => resolve(b), 'image/jpeg', 0.75);
      } catch {
        URL.revokeObjectURL(url);
        resolve(null);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

/* ============================================================
   Auto-categorización (mejorada)
   ============================================================ */
const AIRLINES_REGEX = /aerolineas|aerol[ií]neas|lufthansa|iberia|vueling|latam|avianca|american|united|delta|klm|air\s*france|ryanair|easyjet|air\s*europa|aeromex|aerom[eé]xico|\bgol\b|azul|copa|despegar|edreams|expedia|jetblue|norwegian|swiss|tap\s*air|alitalia|emirates|qatar|etihad|singapore/i;
const AIRLINE_CODES_REGEX = /^(ar|la|aa|ua|dl|ib|vy|af|kl|lh|av|cm|g3|ad|am|ac|ba|az|ux|ws|b6|nk|f9|as|ha|wn|ja|h2|v7|vx|w6|wz|u2|fr|dy|tp|ek|qr|ey|sq|tg|ca|cz|mu)\b/i;

function autoCategory(file, eventType) {
  const name = (file.name || '').toLowerCase();
  const mime = file.type || '';

  // 1. Boarding explícito
  if (/boarding|tarjeta.*embarque|pase.*abordar|check-?in.*pass|boardingpass/.test(name)) return 'boarding';

  // 2. Nombre de aerolínea conocida
  if (AIRLINES_REGEX.test(name)) return 'boarding';

  // 3. Código IATA al principio: "AR-...", "LA ...", "IB_..."
  const stripped = name.replace(/[_\-.]+/g, ' ').trim();
  if (AIRLINE_CODES_REGEX.test(stripped) && /\d/.test(stripped)) return 'boarding';

  // 4. Patrón vuelo: XX### o XX ####
  if (/\b[a-z]{2}\s?\d{2,4}\b/i.test(name) && /(vuelo|flight|air|aer)/.test(name)) return 'boarding';

  // 5. Voucher / Hotel
  if (/voucher|reserva|booking|airbnb|hotel|hospedaje|alojamiento|check-?in|check-?out/.test(name)) return 'voucher';

  // 6. Seguro
  if (/seguro|insurance|poliza|p[oó]liza|cobertura/.test(name)) return 'insurance';

  // 7. ID / Documento
  if (/\b(dni|pasaporte|passport|id\b|c[eé]dula|cedula|licencia|identidad)\b/.test(name)) return 'id';

  // 8. Auto
  if (/\b(auto|car|rental|alquiler|hertz|avis|europcar|sixt|budget|enterprise)\b/.test(name)) return 'car';

  // 9. Fallback por tipo de evento
  if (eventType === 'flight') return 'boarding';
  if (eventType === 'hotel' || eventType === 'airbnb') return 'voucher';
  if (eventType === 'car') return 'car';

  return 'other';
}

/* ============================================================
   Formatters
   ============================================================ */
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