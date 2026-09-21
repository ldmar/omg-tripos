/* ============================================================
   OhMyGoch Trip OS · chat.js
   Mensajería grupal E2E sobre el DataChannel de sync.js
   - Transporte cifrado con clave ECDH efímera (sync.js)
   - Historial cifrado en reposo con data key del viaje (vault.js)
   - Sin backend: los mensajes viajan directo entre peers
   ============================================================ */

import * as vault from './vault.js';
import * as crypto from './crypto.js';
import * as sync from './sync.js';

const DB_NAME = 'omg-tripos-chat';
const DB_VERSION = 1;
const STORE = 'messages';

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
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
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
   Estado
   ============================================================ */
let tripId = null;
let localIdentity = { id: 'local', name: 'Vos', color: '#ff5c39' };
let messages = [];
let newMsgListeners = [];
let statusListeners = [];
let busy = false;

/* ============================================================
   Init / destroy
   ============================================================ */
export async function initChat(forTripId, identity = {}) {
  destroyChat();
  tripId = forTripId;
  localIdentity = { ...localIdentity, ...identity };

  messages = await loadAll();

  sync.onChatMessage(handleIncoming);
  return messages;
}

export function destroyChat() {
  messages = [];
  newMsgListeners = [];
  statusListeners = [];
  tripId = null;
  busy = false;
}

export function onNewMessage(cb)  { newMsgListeners.push(cb); }
export function onStatusChange(cb){ statusListeners.push(cb); }
export function getMessages()     { return [...messages]; }
export function getLocalId()      { return localIdentity.id; }

/* ============================================================
   Enviar
   ============================================================ */
export async function sendMessage(text) {
  if (!tripId) throw new Error('Sin viaje activo');
  const clean = (text || '').trim();
  if (!clean) return null;
  if (clean.length > 500) throw new Error('Máximo 500 caracteres');

  const id = 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const createdAt = Date.now();

  // Cifrado en reposo
  const vaultKey = await vault.getTripKey(tripId, { create: true });
  const bodyEncrypted = await crypto.encryptString(
    vaultKey,
    JSON.stringify({ text: clean }),
    `msg:${id}`
  );

  const record = {
    id,
    tripId,
    authorId: localIdentity.id,
    authorName: localIdentity.name,
    authorColor: localIdentity.color,
    bodyEncrypted,
    createdAt,
    status: 'pending',
  };

  await tx('readwrite', s => s.put(record));
  messages.push(record);
  emitNew(record);

  // Intento de envío
  await trySend(record, clean);
  return record;
}

async function trySend(record, plaintext) {
  const transport = JSON.stringify({
    text: plaintext,
    senderId:    localIdentity.id,
    senderName:  localIdentity.name,
    senderColor: localIdentity.color,
  });

  try {
    await sync.sendChat(transport, { id: record.id, createdAt: record.createdAt });
    record.status = 'sent';
  } catch (err) {
    // Sin peer o handshake incompleto: queda local
    record.status = 'unsent';
    console.info('[chat] mensaje guardado localmente (sin peer):', err.message);
  }

  await tx('readwrite', s => s.put(record));
  const idx = messages.findIndex(m => m.id === record.id);
  if (idx >= 0) messages[idx] = record;
  emitStatus(record);
}

/* ============================================================
   Recibir
   ============================================================ */
async function handleIncoming(msg) {
  if (!msg?.payload || !tripId) return;

  let plaintext;
  try {
    plaintext = await sync.decryptChat(msg.payload);
  } catch (err) {
    console.warn('[chat] no se pudo descifrar E2E:', err.message);
    return;
  }

  let parsed;
  try { parsed = JSON.parse(plaintext); }
  catch { parsed = { text: String(plaintext) }; }

  const id = msg.meta?.id || 'm_' + Date.now().toString(36);
  const createdAt = msg.meta?.createdAt || Date.now();

  // Idempotencia: si ya lo tenemos, ignorar
  if (messages.find(m => m.id === id)) return;

  // Cifrado en reposo
  let bodyEncrypted;
  try {
    const vaultKey = await vault.getTripKey(tripId, { create: true });
    bodyEncrypted = await crypto.encryptString(
      vaultKey,
      JSON.stringify({ text: parsed.text || '' }),
      `msg:${id}`
    );
  } catch (err) {
    console.warn('[chat] no se pudo cifrar para reposo:', err.message);
    return;
  }

  const record = {
    id,
    tripId,
    authorId:    parsed.senderId    || 'peer',
    authorName:  parsed.senderName  || 'Otro dispositivo',
    authorColor: parsed.senderColor || '#8a8d94',
    bodyEncrypted,
    createdAt,
    status: 'received',
  };

  await tx('readwrite', s => s.put(record));
  messages.push(record);
  messages.sort((a, b) => a.createdAt - b.createdAt);
  emitNew(record);
}

/* ============================================================
   Descifrado on-demand del cuerpo (para render)
   ============================================================ */
export async function decryptMessageBody(record) {
  if (!record?.bodyEncrypted) return '';
  if (!vault.isUnlocked()) return '🔒 Bloqueado';
  try {
    const key = await vault.getTripKey(tripId);
    if (!key) return '🔒 Bloqueado';
    const json = await crypto.decryptString(key, record.bodyEncrypted, `msg:${record.id}`);
    return JSON.parse(json).text || '';
  } catch (err) {
    console.warn('[chat] decrypt body falló:', err.message);
    return '(no se pudo leer)';
  }
}

/* ============================================================
   Carga desde IndexedDB
   ============================================================ */
async function loadAll() {
  if (!tripId) return [];
  const idb = await db();
  const list = await new Promise((resolve, reject) => {
    const t = idb.transaction(STORE, 'readonly');
    const idx = t.objectStore(STORE).index('tripId');
    const req = idx.getAll(tripId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });
  list.sort((a, b) => a.createdAt - b.createdAt);
  return list;
}

/* ============================================================
   Stats / wipe
   ============================================================ */
export async function countMessages(tripIdArg = tripId) {
  if (!tripIdArg) return 0;
  const list = await new Promise((resolve, reject) => {
    db().then(idb => {
      const t = idb.transaction(STORE, 'readonly');
      const req = t.objectStore(STORE).index('tripId').count(tripIdArg);
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror   = () => reject(req.error);
    });
  });
  return list;
}

export async function wipeTripMessages(tripIdArg) {
  const idb = await db();
  await new Promise((resolve, reject) => {
    const t = idb.transaction(STORE, 'readwrite');
    const idx = t.objectStore(STORE).index('tripId');
    const cur = idx.openCursor(tripIdArg);
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) { c.delete(); c.continue(); }
      else resolve();
    };
    cur.onerror = () => reject(cur.error);
  });
}

/* ============================================================
   Emisores
   ============================================================ */
function emitNew(record) {
  for (const cb of newMsgListeners) {
    try { cb(record); } catch (e) { console.warn(e); }
  }
}
function emitStatus(record) {
  for (const cb of statusListeners) {
    try { cb(record); } catch (e) { console.warn(e); }
  }
}

/* ============================================================
   Export/import para backup
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
