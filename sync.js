/* ============================================================
   OhMyGoch Trip OS · sync.js
   Sync P2P entre dispositivos · WebRTC + Yjs
   Sin backend, sin cuentas, sin nube
   ============================================================ */

import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { IndexeddbPersistence } from 'y-indexeddb';

/* ---------- Estado ---------- */
let doc = null;
let provider = null;
let persistence = null;
let eventsMap = null;
let metaMap = null;
let roomId = null;
let suppressBroadcast = false;
let peersListener = null;
let changeListener = null;
let tripMetaListener = null;

const SIGNALING = [
  'wss://y-webrtc-eu.fly.dev',
];

/* ============================================================
   Secret por viaje · cada trip tiene su propio secret
   ============================================================ */
export function getSecret(tripId) {
  if (!tripId) return '';
  const key = `ohmygoch_secret_${tripId}`;
  let s = localStorage.getItem(key);
  if (!s) {
    // Migrar el secret legacy global (para no perder el viaje Madrid ya compartido)
    const legacy = localStorage.getItem('ohmygoch_sync_secret');
    s = legacy || Math.random().toString(36).slice(2, 10);
    localStorage.setItem(key, s);
  }
  return s;
}

/* ============================================================
   Room ID estable
   ============================================================ */
function hashTripId(tripId) {
  if (!tripId || typeof tripId !== 'string') tripId = 'default-trip';
  let h = 2166136261;
  for (let i = 0; i < tripId.length; i++) {
    h ^= tripId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function computeRoomId(tripId) {
  const secret = getSecret(tripId);
  return `ohmygoch-${hashTripId(tripId)}-${secret}`;
}

export function getRoomId() {
  return roomId;
}

/* ============================================================
   Inicialización
   ============================================================ */
export async function initSync(tripId, options = {}) {
  if (doc) return { doc, provider, persistence, roomId };

  const password = getSecret(tripId);
  roomId = computeRoomId(tripId);

  doc = new Y.Doc();
  eventsMap = doc.getMap('events');
  metaMap = doc.getMap('trip-meta');

  persistence = new IndexeddbPersistence(roomId, doc);
  await persistence.whenSynced;

  try {
    provider = new WebrtcProvider(roomId, doc, {
      signaling: SIGNALING,
      password,
      maxConns: 20,
    });

    if (provider.awareness && typeof provider.awareness.on === 'function') {
      provider.awareness.on('change', () => {
        if (peersListener) {
          const peers = [...provider.awareness.getStates().entries()]
            .filter(([clientId]) => clientId !== doc.clientID)
            .map(([clientId, state]) => ({
              clientId,
              name: state?.user?.name || 'Anónimo',
              color: state?.user?.color || '#8a8d94',
            }));
          peersListener(peers);
        }
      });
    }
  } catch (err) {
    console.warn('[sync] provider no pudo iniciar:', err);
  }

  // Cambios en eventos
  eventsMap.observeDeep((events, transaction) => {
    if (transaction.local) return;
    if (changeListener) changeListener();
  });

  // Cambios en metadata del viaje
  metaMap.observe((event, transaction) => {
    if (transaction.local) return;
    if (tripMetaListener) tripMetaListener(getTripMeta());
  });

  return { doc, provider, persistence, roomId };
}

/* ============================================================
   Presencia
   ============================================================ */
export function setLocalUser(user) {
  if (!provider?.awareness) return;
  try {
    provider.awareness.setLocalStateField('user', user);
  } catch (err) {
    console.warn('[sync] no se pudo setear presencia:', err);
  }
}

/* ============================================================
   Eventos: CRUD con Yjs
   ============================================================ */
export function setEvent(ev) {
  if (!eventsMap) return;
  suppressBroadcast = true;
  try {
    let yEvent = eventsMap.get(ev.id);
    if (!yEvent) {
      yEvent = new Y.Map();
      eventsMap.set(ev.id, yEvent);
    }
    for (const [k, v] of Object.entries(ev)) {
      yEvent.set(k, v);
    }
  } finally {
    suppressBroadcast = false;
  }
}

export function deleteEventSync(id) {
  if (!eventsMap) return;
  suppressBroadcast = true;
  try {
    eventsMap.delete(id);
  } finally {
    suppressBroadcast = false;
  }
}

export function clearAllEvents() {
  if (!eventsMap) return;
  suppressBroadcast = true;
  try {
    for (const key of [...eventsMap.keys()]) eventsMap.delete(key);
  } finally {
    suppressBroadcast = false;
  }
}

/* ============================================================
   Lectura
   ============================================================ */
export function getAllEvents() {
  if (!eventsMap) return [];
  const out = [];
  for (const [id, yEvent] of eventsMap.entries()) {
    const obj = { id };
    for (const [k, v] of yEvent.entries()) obj[k] = v;
    out.push(obj);
  }
  return out;
}

/* ============================================================
   Metadata del viaje · se sincroniza con los peers
   ============================================================ */
export function setTripMeta(meta) {
  if (!metaMap) return;
  suppressBroadcast = true;
  try {
    for (const [k, v] of Object.entries(meta)) {
      if (v !== undefined && v !== null) metaMap.set(k, v);
    }
  } finally {
    suppressBroadcast = false;
  }
}

export function getTripMeta() {
  if (!metaMap) return {};
  const out = {};
  for (const [k, v] of metaMap.entries()) out[k] = v;
  return out;
}

// mas adelante borrar esta funcion que no se usa
export function onTripMetaChange1(cb) {
  tripMetaListener = cb;
  // Disparar inmediatamente con la meta actual (si ya hay algo)
  const current = getTripMeta();
  if (current && Object.keys(current).length) {
    setTimeout(() => cb(current), 0);
  }
}

export function onTripMetaChange(cb) {
  tripMetaListener = cb;
  // ❌ BORRAR estas 4 líneas — disparan con la meta LOCAL
  // const current = getTripMeta();
  // if (current && Object.keys(current).length) {
  //   setTimeout(() => cb(current), 0);
  // }
  // ✅ Solo dispara cuando Yjs recibe cambios REMOTOS (transaction.local === false)
}

/* ============================================================
   Callbacks
   ============================================================ */
export function onRemoteChange(cb) { changeListener = cb; }
export function onPeersChange(cb) { peersListener = cb; }

/* ============================================================
   Lifecycle
   ============================================================ */
export function isConnected() {
  try {
    return provider?.connected ?? false;
  } catch {
    return false;
  }
}

export function getPeerCount() {
  try {
    if (!provider?.awareness) return 0;
    if (typeof provider.awareness.getStates !== 'function') return 0;
    return Math.max(0, provider.awareness.getStates().size - 1);
  } catch {
    return 0;
  }
}

export function destroySync() {
  try { provider?.destroy(); } catch {}
  try { persistence?.destroy(); } catch {}
  try { doc?.destroy(); } catch {}
  doc = null;
  provider = null;
  persistence = null;
  eventsMap = null;
  metaMap = null;
  roomId = null;
  tripMetaListener = null;
}
