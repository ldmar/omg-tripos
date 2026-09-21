/* ============================================================
   OhMyGoch Trip OS · crypto.js
   Wrappers WebCrypto · AES-GCM 256 · ECDH P-256 · PBKDF2-SHA256
   Nada de esto toca la red. La clave nunca sale del device.
   ============================================================ */

const PBKDF2_ITERATIONS = 600_000;   // OWASP 2023 para SHA-256
const PBKDF2_HASH       = 'SHA-256';
const AES_KEY_LENGTH    = 256;
const IV_BYTES          = 12;        // 96 bits, recomendado para GCM

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ---------- Primitivas ---------- */

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function randomId(bytes = 16) {
  return [...randomBytes(bytes)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/* ---------- Derivación de clave maestra desde PIN/frase ---------- */

export async function deriveMasterKey(pin, saltB64) {
  const salt = saltB64 ? fromB64(saltB64) : randomBytes(16);
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(pin), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    baseKey,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false,                              // no extraíble: no se puede exportar
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
  );
  return { key, salt: toB64(salt) };
}

/* ---------- AES-GCM: string y Blob ---------- */

export async function encryptString(key, plaintext, aad) {
  const iv = randomBytes(IV_BYTES);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad ? enc.encode(aad) : undefined },
    key,
    enc.encode(plaintext)
  );
  return { v: 1, iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

export async function decryptString(key, payload, aad) {
  if (!payload || payload.v !== 1) throw new Error('Payload inválido');
  const pt = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromB64(payload.iv),
      additionalData: aad ? enc.encode(aad) : undefined,
    },
    key,
    fromB64(payload.ct)
  );
  return dec.decode(pt);
}

export async function encryptBlob(key, blob, aad) {
  const iv = randomBytes(IV_BYTES);
  const buf = await blob.arrayBuffer();
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad ? enc.encode(aad) : undefined },
    key, buf
  );
  return { v: 1, iv: toB64(iv), ct };
}

export async function decryptBlob(key, payload, mime = 'application/octet-stream', aad) {
  const pt = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromB64(payload.iv),
      additionalData: aad ? enc.encode(aad) : undefined,
    },
    key, payload.ct
  );
  return new Blob([pt], { type: mime });
}

/* ---------- Key wrapping (para claves de viaje) ---------- */

export async function wrapKey(masterKey, dataKey) {
  const raw = await crypto.subtle.exportKey('raw', dataKey);
  const iv = randomBytes(IV_BYTES);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, masterKey, raw);
  return { v: 1, iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

export async function unwrapKey(masterKey, wrapped) {
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(wrapped.iv) },
    masterKey,
    fromB64(wrapped.ct)
  );
  return crypto.subtle.importKey(
    'raw', raw, { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false, ['encrypt', 'decrypt']
  );
}

export async function generateDataKey() {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: AES_KEY_LENGTH }, true, ['encrypt', 'decrypt']
  );
}

/* ---------- ECDH P-256 para el canal P2P ---------- */

export async function generateEcdhKeyPair() {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,                             // extraíble para poder emitir por QR
    ['deriveKey', 'deriveBits']
  );
}

export async function exportPublicKeyJwk(publicKey) {
  return crypto.subtle.exportKey('jwk', publicKey);
}

export async function importPublicKeyJwk(jwk) {
  return crypto.subtle.importKey(
    'jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []
  );
}

export async function deriveSharedAesKey(privateKey, peerPublicKey) {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false, ['encrypt', 'decrypt']
  );
}

/* ---------- Helpers base64 ---------- */

function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

function fromB64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------- Wipe criptográfico ---------- */

export function wipeBytes(...arrays) {
  for (const a of arrays) {
    if (a instanceof Uint8Array) a.fill(0);
    else if (a instanceof ArrayBuffer) new Uint8Array(a).fill(0);
  }
}

/* ---------- PIN strength (mínimo, sin deps) ---------- */

export function pinStrength(pin) {
  if (!pin) return { score: 0, label: 'Vacío' };
  if (pin.length < 4) return { score: 1, label: 'Muy corto' };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter(r => r.test(pin)).length;
  const lengthBonus = Math.min(pin.length / 16, 1);
  const score = Math.min(4, Math.round(classes * 0.7 + lengthBonus * 1.3));
  const labels = ['Muy débil', 'Débil', 'Aceptable', 'Fuerte', 'Muy fuerte'];
  return { score, label: labels[score] };
}