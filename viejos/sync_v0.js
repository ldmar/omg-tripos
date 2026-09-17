/* ============================================================
   OhMyGoch Trip OS · sync.js
   Sync P2P entre dispositivos · WebRTC + Yjs
   Sin backend, sin cuentas, sin nube
   ============================================================ */

import * as Y from 'https://esm.sh/yjs@13.6.10';
import { WebrtcProvider } from 'https://esm.sh/y-webrtc@10.3.0';
import { IndexeddbPersistence } from 'https://esm.sh/y-indexeddb@9.0.12';

/* ---------- Estado ---------- */
let doc = null;
let provider = null;
let persistence = null;
let eventsMap = null;         // Y.Map<id, Y.Map>
let metaMap = null;           // Y.Map<string, value>
let roomId = null;
let suppressBroadcast = false;
let peersListener = null;
let changeListener = null;

const SIGNALING = ['wss://signaling.yjs.dev'];

/* ============================================================
   Room ID estable
   ============================================================ */
function hashTripId(tripId) {
  // FNV-1a simple
  let h = 2166136261;
  for (let i = 0; i < tripId.length; i++) {
    h ^= tripId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function getSecret() {
  let s = localStorage.getItem('ohmygoch_sync_secret');
  if (!s) {
    s = Math.random().toString(36).slice(2, 10);
    localStorage.setItem('ohmygoch_sync_secret', s);
  }
  return s;
}

function computeRoomId(tripId) {
  return `ohmygoch-${hashTripId(tripId)}-${getSecret()}`;
}

export function getRoomId() {
  return roomId;
}

/* ============================================================
   Inicialización
   ============================================================ */
export async function initSync(tripId, options = {}) {
  if (doc) return { doc, provider, persistence, roomId };

  const password = getSecret();
  roomId = computeRoomId(tripId);

  // Doc Yjs
  doc = new Y.Doc();
  eventsMap = doc.getMap('events');
  metaMap = doc.getMap('meta');

  // Persistencia local (IndexedDB)
  persistence = new IndexeddbPersistence(roomId, doc);
  await persistence.whenSynced;

  // Sync P2P
  provider = new WebrtcProvider(roomId, doc, {
    signaling: SIGNALING,
    password,
    awareness: doc.getMap('awareness'),
    maxConns: 20,
  });

  // Awareness: quién está conectado
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

  // Observar cambios remotos
  eventsMap.observeDeep((events, transaction) => {
    if (transaction.local) return;      // cambios nuestros, no re-notificar
    if (changeListener) changeListener();
  });

  return { doc, provider, persistence, roomId };
}

/* ============================================================
   Publicar estado local (presencia)
   ============================================================ */
export function setLocalUser(user) {
  if (!provider) return;
  provider.awareness.setLocalStateField('user', user);
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
    // Setear cada campo individualmente
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
   Leer todos los eventos del doc
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
   Metadata (trip name, flag, etc.)
   ============================================================ */
export function setMeta(key, value) {
  if (!metaMap) return;
  suppressBroadcast = true;
  try {
    metaMap.set(key, value);
  } finally {
    suppressBroadcast = false;
  }
}

export function getMeta(key) {
  return metaMap?.get(key) ?? null;
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
  return provider?.connected ?? false;
}

export function getPeerCount() {
  if (!provider) return 0;
  return Math.max(0, provider.awareness.getStates().size - 1);
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
}