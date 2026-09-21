/* ============================================================
   OhMyGoch Trip OS · sync.js  (v3.0)
   - Sin Yjs, sin y-webrtc, sin CDN → arranca offline
   - WebRTC DataChannel + WebSocket signaling mínimo
   - CRDT LWW por campo (crdt.js)
   - ECDH P-256 handshake → AES-GCM E2E sobre el canal
   ============================================================ */

import * as crypto from './crypto.js';
import { LWWCollection } from './crdt.js';

/* ---------- Signaling ---------- */
const SIGNALING_URLS = [
  'wss://signaling.y-webrtc.fly.dev',
  'wss://y-webrtc-eu.fly.dev',
  'wss://y-webrtc.fly.dev',
  'wss://signaling.yjs.dev',      // último por si resucita
];
/* ---------- ICE ---------- */
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

function tryNext() {
  if (idx >= SIGNALING_URLS.length) {
    console.info(
      '[sync] Sin signaling. La sync entre dispositivos queda inactiva; ' +
      'la sync local (mismo navegador, varias pestañas) sigue funcionando.'
    );
    return;
  }
  // …resto igual
}

/* ============================================================
   Estado del módulo
   ============================================================ */
let tripId         = null;
let peerId         = crypto.randomId(8);
let ecdhKeys       = null;     // { publicKey, privateKey }
let sharedKey      = null;     // CryptoKey derivada de ECDH
let signaling      = null;
let channels       = new Map();// peerId → RTCDataChannel
let pcs            = new Map();// peerId → RTCPeerConnection
let eventsCRDT     = null;     // LWWCollection
let metaCRDT       = null;     // LWWMap
let remoteListener = null;
let metaListener   = null;
let peersListener  = null;
let broadcastCh    = null;     // BroadcastChannel same-device

/* ============================================================
   Init / destroy
   ============================================================ */
export async function initSync(forTripId, opts = {}) {
  if (tripId === forTripId && eventsCRDT) return getSnapshot();

  destroySync();
  tripId = forTripId;
  eventsCRDT = new LWWCollection(peerId);
  metaCRDT   = new (await import('./crdt.js')).LWWMap(peerId);

  // Cargar estado persistido (IndexedDB "omg-tripos-sync")
  await loadPersisted();

  // Handshake ECDH
  ecdhKeys = await crypto.generateEcdhKeyPair();

  // Same-device: BroadcastChannel para pestañas/ventanas
  try {
    broadcastCh = new BroadcastChannel(`omg-sync-${tripId}`);
    broadcastCh.onmessage = (e) => handleIncoming(e.data, 'local');
  } catch {}

  // Cross-device: signaling + WebRTC
  connectSignaling(tripId);

  return getSnapshot();
}

export function destroySync() {
  for (const ch of channels.values()) try { ch.close(); } catch {}
  for (const pc of pcs.values()) try { pc.close(); } catch {}
  channels.clear();
  pcs.clear();
  try { signaling?.close(); } catch {}
  try { broadcastCh?.close(); } catch {}
  signaling = null;
  broadcastCh = null;
  eventsCRDT = null;
  metaCRDT = null;
  sharedKey = null;
  ecdhKeys = null;
  tripId = null;
}

/* ============================================================
   Signaling WebSocket (protocolo pub/sub estilo y-webrtc)
   ============================================================ */
function connectSignaling(room) {
  let idx = 0;
  const tryNext = () => {
    if (idx >= SIGNALING_URLS.length) {
      console.warn('[sync] sin signaling disponible, modo same-device');
      return;
    }
    const url = SIGNALING_URLS[idx++];
    try {
      const ws = new WebSocket(url);
      let opened = false;
      ws.onopen = () => {
        opened = true;
        signaling = ws;
        ws.send(JSON.stringify({
          type: 'subscribe',
          topics: [room],
          peerId,
        }));
        announceToRoom(room);
      };
      ws.onmessage = (e) => {
        try { handleSignalMessage(JSON.parse(e.data)); } catch {}
      };
      ws.onerror = () => { if (!opened) tryNext(); };
      ws.onclose = () => { if (!opened) tryNext(); else setTimeout(() => tryNext(), 3000); };
    } catch { tryNext(); }
  };
  tryNext();
}

function announceToRoom(room) {
  publish({ type: 'announce', peerId });
}

function publish(msg) {
  if (!signaling || signaling.readyState !== 1) return;
  signaling.send(JSON.stringify({ type: 'publish', topic: tripId, ...msg }));
}

async function handleSignalMessage(msg) {
  if (msg.type === 'announce' && msg.peerId !== peerId) {
    // Sólo el peer con menor ID inicia la oferta (determinista)
    if (peerId < msg.peerId) return;
    await initiateOffer(msg.peerId);
    return;
  }
  if (msg.type === 'offer' && msg.to === peerId) {
    await handleOffer(msg);
    return;
  }
  if (msg.type === 'answer' && msg.to === peerId) {
    await handleAnswer(msg);
    return;
  }
  if (msg.type === 'ice' && msg.to === peerId) {
    const pc = pcs.get(msg.from);
    if (pc) try { await pc.addIceCandidate(msg.candidate); } catch {}
  }
}

/* ============================================================
   WebRTC — oferta / respuesta
   ============================================================ */
async function createPC(remotePeerId) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      publish({
        type: 'ice', from: peerId, to: remotePeerId,
        candidate: e.candidate.toJSON(),
      });
    }
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
      try { pc.close(); } catch {}
      pcs.delete(remotePeerId);
      channels.delete(remotePeerId);
      emitPeers();
    }
  };
  pcs.set(remotePeerId, pc);
  return pc;
}

async function initiateOffer(remotePeerId) {
  const pc = createPC(remotePeerId);
  const dc = pc.createDataChannel('omg', { ordered: true });
  wireChannel(dc, remotePeerId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  publish({ type: 'offer', from: peerId, to: remotePeerId, sdp: pc.localDescription });
}

async function handleOffer(msg) {
  const pc = createPC(msg.from);
  pc.ondatachannel = (e) => wireChannel(e.channel, msg.from);
  await pc.setRemoteDescription(msg.sdp);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  publish({ type: 'answer', from: peerId, to: msg.from, sdp: pc.localDescription });
}

async function handleAnswer(msg) {
  const pc = pcs.get(msg.from);
  if (!pc) return;
  await pc.setRemoteDescription(msg.sdp);
}

/* ============================================================
   DataChannel — handshake ECDH + mensajería
   ============================================================ */
function wireChannel(dc, remotePeerId) {
  channels.set(remotePeerId, dc);

  dc.onopen = async () => {
    // Handshake: enviamos nuestra public key
    const jwk = await crypto.exportPublicKeyJwk(ecdhKeys.publicKey);
    dc.send(JSON.stringify({ t: 'hello', peerId, jwk }));

    // Snapshot completo para peer nuevo
    dc.send(JSON.stringify({
      t: 'snap',
      events: eventsCRDT.serialize(),
      meta: metaCRDT.serialize(),
    }));

    emitPeers();
  };

  dc.onmessage = async (e) => {
    try {
      const msg = JSON.parse(e.data);
      await handleIncoming(msg, remotePeerId);
    } catch (err) {
      console.warn('[sync] mensaje inválido', err);
    }
  };

  dc.onclose = () => {
    channels.delete(remotePeerId);
    emitPeers();
  };
}

async function handleIncoming(msg, from) {
  // Handshake
  if (msg.t === 'hello') {
    if (!sharedKey) {
      const peerPub = await crypto.importPublicKeyJwk(msg.jwk);
      sharedKey = await crypto.deriveSharedAesKey(ecdhKeys.privateKey, peerPub);
    }
    return;
  }

  // Snapshot inicial
  if (msg.t === 'snap') {
    const changedEv = mergeRemote('events', msg.events);
    const changedMeta = mergeRemote('meta', [['__root', msg.meta]]);
    if (changedEv || changedMeta) {
      await persist();
      if (remoteListener) remoteListener();
    }
    return;
  }

  // Operación incremental (event)
  if (msg.t === 'ev') {
    const changed = eventsCRDT.applyRemote(msg.id, msg.fields);
    if (changed) {
      await persist();
      if (remoteListener) remoteListener();
    }
    return;
  }

  // Mensaje de chat cifrado
  if (msg.t === 'chat') {
    if (chatListener) chatListener(msg);
    return;
  }

  // Metadata
  if (msg.t === 'meta') {
    const changed = metaCRDT.merge(msg.fields);
    if (changed) {
      await persist();
      if (metaListener) metaListener(metaCRDT.toObject());
    }
  }
}

function mergeRemote(kind, serialized) {
  let changed = false;
  if (kind === 'events') {
    for (const [id, fields] of serialized || []) {
      if (eventsCRDT.applyRemote(id, fields)) changed = true;
    }
  } else {
    for (const [_, fields] of serialized || []) {
      if (metaCRDT.merge(fields)) changed = true;
    }
  }
  return changed;
}

/* ============================================================
   API pública — eventos
   ============================================================ */
export function setEvent(ev) {
  if (!eventsCRDT || !ev?.id) return;
  eventsCRDT.upsert(ev.id, ev);
  const fields = eventsCRDT.items.get(ev.id).diffSince(new Map());
  broadcast({ t: 'ev', id: ev.id, fields });
  persist();
}

export function deleteEventSync(id) {
  if (!eventsCRDT) return;
  const map = eventsCRDT.items.get(id);
  if (!map) return;
  map.delete('__deleted');
  const fields = map.serialize().filter(([k]) => k === '__deleted');
  broadcast({ t: 'ev', id, fields });
  persist();
}

export function getAllEvents() {
  if (!eventsCRDT) return [];
  return eventsCRDT.list();
}

/* ============================================================
   API pública — metadata del viaje
   ============================================================ */
export function setTripMeta(meta) {
  if (!metaCRDT) return;
  for (const [k, v] of Object.entries(meta)) {
    if (v !== undefined) metaCRDT.set(k, v);
  }
  const fields = metaCRDT.serialize();
  broadcast({ t: 'meta', fields });
  persist();
}

export function getTripMeta() {
  return metaCRDT ? metaCRDT.toObject() : {};
}

/* ============================================================
   Canal de chat (expuesto a chat.js)
   ============================================================ */
let chatListener = null;
export function onChatMessage(cb) { chatListener = cb; }

export async function sendChat(plaintext, meta) {
  if (!sharedKey) throw new Error('Sin peer conectado o handshake incompleto');
  const payload = await crypto.encryptString(sharedKey, plaintext, 'chat');
  broadcast({ t: 'chat', payload, meta });
}

export async function decryptChat(payload) {
  if (!sharedKey) throw new Error('Sin clave compartida');
  return crypto.decryptString(sharedKey, payload, 'chat');
}

/* ============================================================
   Broadcast helper — same-device + remotos
   ============================================================ */
function broadcast(msg) {
  // Same-device (otras pestañas)
  try { broadcastCh?.postMessage(msg); } catch {}
  // Cross-device
  const data = JSON.stringify(msg);
  for (const dc of channels.values()) {
    if (dc.readyState === 'open') try { dc.send(data); } catch {}
  }
}

/* ============================================================
   Persistencia local (IndexedDB)
   ============================================================ */
const IDB_NAME = 'omg-tripos-sync';
const IDB_VER  = 1;
const STORE    = 'state';

let _db;
function db() {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VER);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'tripId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _db;
}

async function persist() {
  if (!tripId) return;
  const idb = await db();
  const data = {
    tripId,
    events: eventsCRDT.serialize(),
    meta: metaCRDT.serialize(),
    savedAt: Date.now(),
  };
  await new Promise((res, rej) => {
    const t = idb.transaction(STORE, 'readwrite');
    t.objectStore(STORE).put(data);
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
}

async function loadPersisted() {
  const idb = await db();
  const rec = await new Promise((res, rej) => {
    const t = idb.transaction(STORE, 'readonly');
    const r = t.objectStore(STORE).get(tripId);
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
  if (rec) {
    eventsCRDT.hydrate(rec.events || []);
    metaCRDT.fields = new Map(rec.meta || []);
  }
}

/* ============================================================
   Presencia / estado
   ============================================================ */
export function setLocalUser(user) {
  // Guardamos para enviarlo en el próximo announce (extensible)
  localUser = user;
}
let localUser = null;

export function getPeerCount() { return channels.size; }
export function isConnected() { return channels.size > 0; }
export function getRoomId()   { return tripId; }
export function getSecret()   { return null; }  // ya no aplica: la clave viene de ECDH

export function onRemoteChange(cb) { remoteListener = cb; }
export function onTripMetaChange(cb) { metaListener = cb; }
export function onPeersChange(cb) { peersListener = cb; }

function emitPeers() {
  if (!peersListener) return;
  const list = [...channels.keys()].map(id => ({
    id, name: 'Peer ' + id.slice(0, 4), color: '#8a8d94',
  }));
  peersListener(list);
}

export function getSnapshot() {
  return {
    roomId: tripId,
    peerId,
    eventCount: eventsCRDT?.items.size || 0,
    peers: channels.size,
  };
}
