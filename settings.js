/* ============================================================
   OhMyGoch Trip OS · settings.js
   Auto-lock · cambio de PIN · export/import backup cifrado · wipes
   ============================================================ */

import * as vault   from './vault.js';
import * as crypto  from './crypto.js';
import * as trips   from './trips.js';
import * as wallet  from './wallet.js';
import * as chat    from './chat.js';

const AUTOLOCK_KEY = 'ohmygoch_autolock_ms';
const LAST_BACKUP_KEY = 'ohmygoch_last_backup_at';

const AUTOLOCK_OPTIONS = [
  { ms: 60_000,          label: '1 min' },
  { ms: 5 * 60_000,      label: '5 min' },
  { ms: 15 * 60_000,     label: '15 min' },
  { ms: 60 * 60_000,     label: '1 h'  },
  { ms: 0,               label: 'Nunca' },
];

const DEFAULT_AUTOLOCK_MS = 15 * 60_000;
const BACKUP_MIN_PASSWORD = 8;
const BACKUP_SCHEMA = 3;

/* ============================================================
   Auto-lock
   ============================================================ */
export function loadAutoLock() {
  const raw = localStorage.getItem(AUTOLOCK_KEY);
  const ms = raw === null ? DEFAULT_AUTOLOCK_MS : Number(raw);
  vault.setAutoLock(ms || 0);
  return ms;
}

export function getAutoLock() {
  const raw = localStorage.getItem(AUTOLOCK_KEY);
  return raw === null ? DEFAULT_AUTOLOCK_MS : Number(raw);
}

export function setAutoLock(ms) {
  localStorage.setItem(AUTOLOCK_KEY, String(ms));
  vault.setAutoLock(ms || 0);
}

export function getAutoLockOptions() { return [...AUTOLOCK_OPTIONS]; }

/* ============================================================
   Cambio de PIN
   ============================================================ */
export async function changePIN(oldPin, newPin) {
  if (newPin.length < 4) throw new Error('PIN nuevo muy corto (mínimo 4)');
  if (oldPin === newPin) throw new Error('El PIN nuevo debe ser distinto');
  await vault.changePIN(oldPin, newPin);
  return true;
}

/* ============================================================
   Backup cifrado (.omg)
   - Todo lo que ya está cifrado con data keys queda tal cual
   - Sólo re-envolvemos las data keys con una backup key derivada
     de una contraseña portátil (independiente del PIN del device)
   - El archivo es JSON: { v, salt, payload: { iv, ct } }
   ============================================================ */

function bufferToB64(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}
function b64ToBuffer(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function serializeBlobEncrypted(enc) {
  if (!enc) return null;
  return { v: enc.v, iv: enc.iv, ct: bufferToB64(enc.ct) };
}
function deserializeBlobEncrypted(obj) {
  if (!obj) return null;
  return { v: obj.v, iv: obj.iv, ct: b64ToBuffer(obj.ct) };
}

export async function exportVault(backupPassword, onProgress = () => {}) {
  if (!vault.isUnlocked()) throw new Error('Vault bloqueado');
  if (!backupPassword || backupPassword.length < BACKUP_MIN_PASSWORD) {
    throw new Error(`Contraseña muy corta (mínimo ${BACKUP_MIN_PASSWORD})`);
  }

  onProgress('Recolectando viajes…');
  const allTrips = await trips.listTrips();

  const events = [];
  const travelers = [];
  for (const t of allTrips) {
    events.push(...await trips.getTripEvents(t.id));
    travelers.push(...await trips.getTravelersByTrip(t.id));
  }

  onProgress('Recolectando documentos…');
  const walletRaw = await wallet.exportRaw();
  const chatRaw = await chat.exportRaw();

  onProgress('Cifrando claves…');
  const { key: backupKey, salt: backupSalt } = await crypto.deriveMasterKey(backupPassword);

  const keys = [];
  for (const t of allTrips) {
    const dk = await vault.getTripKey(t.id);
    if (!dk) continue;
    const raw = await crypto.subtle.exportKey('raw', dk);
    const imported = await crypto.subtle.importKey(
      'raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
    );
    const wrapped = await crypto.wrapKey(backupKey, imported);
    keys.push({ tripId: t.id, wrapped });
    crypto.wipeBytes(new Uint8Array(raw));
  }

  const payload = {
    schemaVersion: BACKUP_SCHEMA,
    createdAt: new Date().toISOString(),
    trips: allTrips,
    events,
    travelers,
    keys,
    wallet: walletRaw.map(r => ({
      ...r,
      blobEncrypted: serializeBlobEncrypted(r.blobEncrypted),
      thumbnailEncrypted: serializeBlobEncrypted(r.thumbnailEncrypted),
    })),
    chat: chatRaw,
  };

  onProgress('Cifrando backup…');
  const json = JSON.stringify(payload);
  const encrypted = await crypto.encryptString(backupKey, json, 'backup-v1');

  const file = {
    magic: 'omg-backup',
    v: 1,
    createdAt: payload.createdAt,
    salt: backupSalt,
    payload: encrypted,
  };

  localStorage.setItem(LAST_BACKUP_KEY, payload.createdAt);

  return new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
}

export async function importVault(blob, backupPassword, onProgress = () => {}) {
  if (!vault.isUnlocked()) throw new Error('Vault bloqueado');

  onProgress('Verificando archivo…');
  const text = await blob.text();
  let file;
  try { file = JSON.parse(text); }
  catch { throw new Error('No es un archivo .omg válido'); }

  if (file.magic !== 'omg-backup' || file.v !== 1) {
    throw new Error('Formato de backup no soportado');
  }

  onProgress('Descifrando backup…');
  const { key: backupKey } = await crypto.deriveMasterKey(backupPassword, file.salt);

  let payload;
  try {
    const json = await crypto.decryptString(backupKey, file.payload, 'backup-v1');
    payload = JSON.parse(json);
  } catch {
    throw new Error('Contraseña incorrecta o archivo corrupto');
  }

  if (payload.schemaVersion !== BACKUP_SCHEMA) {
    throw new Error(`Schema version incompatible (esperado ${BACKUP_SCHEMA}, encontrado ${payload.schemaVersion})`);
  }

  onProgress('Restaurando viajes…');
  for (const t of payload.trips || [])    await trips.idbPut(trips.STORES.TRIPS, t);
  for (const e of payload.events || [])   await trips.idbPut(trips.STORES.EVENTS, e);
  for (const tr of payload.travelers || []) await trips.idbPut(trips.STORES.TRAVELERS, tr);

  onProgress('Restaurando claves…');
  for (const { tripId, wrapped } of payload.keys || []) {
    const dk = await crypto.unwrapKey(backupKey, wrapped);
    const raw = await crypto.subtle.exportKey('raw', dk);
    const imported = await crypto.subtle.importKey(
      'raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
    );
    await vault.importTripKey(tripId, imported);
    crypto.wipeBytes(new Uint8Array(raw));
  }

  onProgress('Restaurando documentos…');
  if (payload.wallet?.length) {
    const restored = payload.wallet.map(r => ({
      ...r,
      blobEncrypted: deserializeBlobEncrypted(r.blobEncrypted),
      thumbnailEncrypted: deserializeBlobEncrypted(r.thumbnailEncrypted),
    }));
    await wallet.importRaw(restored);
  }

  onProgress('Restaurando chat…');
  if (payload.chat?.length) {
    await chat.importRaw(payload.chat);
  }

  return {
    trips:     payload.trips?.length     || 0,
    events:    payload.events?.length    || 0,
    travelers: payload.travelers?.length || 0,
    wallet:    payload.wallet?.length    || 0,
    chat:      payload.chat?.length      || 0,
  };
}

export function getLastBackupAt() {
  return localStorage.getItem(LAST_BACKUP_KEY);
}

/* ============================================================
   Wipes
   ============================================================ */
export async function wipeTrip(tripId) {
  if (!vault.isUnlocked()) throw new Error('Vault bloqueado');
  // 1. Crypto-shredding: borrar la data key
  await vault.destroyTripKey(tripId);
  // 2. Borrar todo lo que dependía de esa clave
  await trips.deleteTrip(tripId);
  await chat.wipeTripMessages(tripId);
  // Wallet ya lo limpia trips.deleteTrip (vía deleteTripFiles)
}

export async function wipeEverything() {
  await vault.wipeAll();
  try { indexedDB.deleteDatabase('omg-tripos'); } catch {}
  try { indexedDB.deleteDatabase('omg-tripos-wallet'); } catch {}
  try { indexedDB.deleteDatabase('omg-tripos-chat'); } catch {}
  try { indexedDB.deleteDatabase('omg-tripos-sync'); } catch {}
  try { localStorage.clear(); } catch {}
  try { caches.keys().then(keys => keys.forEach(k => caches.delete(k))); } catch {}
}