/* ============================================================
   Tests · crypto.js
   Requiere Node 20+ (crypto.subtle nativo)
   ============================================================ */

import { describe, it, expect } from 'vitest';
import * as crypto from '../crypto.js';

describe('randomBytes / randomId', () => {
  it('randomBytes devuelve Uint8Array del tamaño pedido', () => {
    const b = crypto.randomBytes(16);
    expect(b).toBeInstanceOf(Uint8Array);
    expect(b.length).toBe(16);
  });

  it('randomId produce hex string del tamaño correcto', () => {
    const id = crypto.randomId(8);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('dos llamadas consecutivas producen valores distintos', () => {
    expect(crypto.randomId(16)).not.toBe(crypto.randomId(16));
  });
});

describe('deriveMasterKey (PBKDF2)', () => {
  it('deriva clave AES-GCM no extraíble', async () => {
    const { key, salt } = await crypto.deriveMasterKey('test-pin-123');
    expect(key).toBeInstanceOf(CryptoKey);
    expect(key.extractable).toBe(false);
    expect(key.algorithm.name).toBe('AES-GCM');
    expect(salt).toMatch(/^[A-Za-z0-9+/=]+$/);   // base64
  });

  it('mismo PIN + mismo salt → misma clave (verificable por roundtrip)', async () => {
    const { salt } = await crypto.deriveMasterKey('pin');
    const { key: k1 } = await crypto.deriveMasterKey('pin', salt);
    const { key: k2 } = await crypto.deriveMasterKey('pin', salt);

    const ct = await crypto.encryptString(k1, 'hola');
    const pt = await crypto.decryptString(k2, ct);
    expect(pt).toBe('hola');
  });

  it('PIN distinto → no puede descifrar', async () => {
    const { key: k1, salt } = await crypto.deriveMasterKey('pin-a');
    const { key: k2 } = await crypto.deriveMasterKey('pin-b', salt);
    const ct = await crypto.encryptString(k1, 'secreto');
    await expect(crypto.decryptString(k2, ct)).rejects.toThrow();
  });
});

describe('encryptString / decryptString', () => {
  it('roundtrip básico', async () => {
    const { key } = await crypto.deriveMasterKey('p');
    const ct = await crypto.encryptString(key, 'mensaje secreto');
    expect(ct.v).toBe(1);
    expect(ct.iv).toBeTruthy();
    expect(ct.ct).toBeTruthy();
    const pt = await crypto.decryptString(key, ct);
    expect(pt).toBe('mensaje secreto');
  });

  it('soporta unicode + emojis', async () => {
    const { key } = await crypto.deriveMasterKey('p');
    const texto = 'Hola ñandú 🦙 東京';
    const ct = await crypto.encryptString(key, texto);
    expect(await crypto.decryptString(key, ct)).toBe(texto);
  });

  it('AAD incorrecto → falla', async () => {
    const { key } = await crypto.deriveMasterKey('p');
    const ct = await crypto.encryptString(key, 'x', 'aad-1');
    await expect(crypto.decryptString(key, ct, 'aad-2')).rejects.toThrow();
    expect(await crypto.decryptString(key, ct, 'aad-1')).toBe('x');
  });

  it('payload alterado → falla autenticación', async () => {
    const { key } = await crypto.deriveMasterKey('p');
    const ct = await crypto.encryptString(key, 'x');

    // Corromper 1 byte del ciphertext
    const tampered = { ...ct, ct: ct.ct.slice(0, -4) + 'AAAA' };
    await expect(crypto.decryptString(key, tampered)).rejects.toThrow();
  });

  it('rechaza payload sin v=1', async () => {
    const { key } = await crypto.deriveMasterKey('p');
    await expect(crypto.decryptString(key, { v: 99, iv: 'x', ct: 'y' })).rejects.toThrow();
  });
});

describe('encryptBlob / decryptBlob', () => {
  it('roundtrip preserva bytes y mime', async () => {
    const { key } = await crypto.deriveMasterKey('p');
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128]);
    const blob = new Blob([bytes], { type: 'application/octet-stream' });

    const enc = await crypto.encryptBlob(key, blob);
    const dec = await crypto.decryptBlob(key, enc, 'application/octet-stream');

    expect(dec.type).toBe('application/octet-stream');
    const decBytes = new Uint8Array(await dec.arrayBuffer());
    expect([...decBytes]).toEqual([...bytes]);
  });
});

describe('wrapKey / unwrapKey', () => {
  it('wrap y unwrap preservan la clave', async () => {
    const { key: master } = await crypto.deriveMasterKey('master-pin');
    const dataKey = await crypto.generateDataKey();

    const wrapped = await crypto.wrapKey(master, dataKey);
    expect(wrapped.v).toBe(1);

    const unwrapped = await crypto.unwrapKey(master, wrapped);
    expect(unwrapped.algorithm.name).toBe('AES-GCM');

    // Verificar que la unwrapped funciona para cifrar/descifrar igual
    const ct = await crypto.encryptString(dataKey, 'x');
    expect(await crypto.decryptString(unwrapped, ct)).toBe('x');
  });

  it('master key incorrecta → unwrap falla', async () => {
    const { key: m1 } = await crypto.deriveMasterKey('a');
    const { key: m2 } = await crypto.deriveMasterKey('b');
    const dk = await crypto.generateDataKey();
    const wrapped = await crypto.wrapKey(m1, dk);
    await expect(crypto.unwrapKey(m2, wrapped)).rejects.toThrow();
  });
});

describe('ECDH', () => {
  it('dos pares derivan la misma clave compartida', async () => {
    const a = await crypto.generateEcdhKeyPair();
    const b = await crypto.generateEcdhKeyPair();

    const sharedAB = await crypto.deriveSharedAesKey(a.privateKey, b.publicKey);
    const sharedBA = await crypto.deriveSharedAesKey(b.privateKey, a.publicKey);

    // Verificar que ambas claves sirven para el mismo cifrado
    const ct = await crypto.encryptString(sharedAB, 'handshake');
    expect(await crypto.decryptString(sharedBA, ct)).toBe('handshake');
  });

  it('public key exportable/importable como JWK', async () => {
    const { publicKey } = await crypto.generateEcdhKeyPair();
    const jwk = await crypto.exportPublicKeyJwk(publicKey);
    expect(jwk.kty).toBe('EC');
    expect(jwk.crv).toBe('P-256');

    const imported = await crypto.importPublicKeyJwk(jwk);
    expect(imported.algorithm.name).toBe('ECDH');
  });

  it('tercero no puede descifrar', async () => {
    const a = await crypto.generateEcdhKeyPair();
    const b = await crypto.generateEcdhKeyPair();
    const c = await crypto.generateEcdhKeyPair();

    const sharedAB = await crypto.deriveSharedAesKey(a.privateKey, b.publicKey);
    const sharedAC = await crypto.deriveSharedAesKey(a.privateKey, c.publicKey);

    const ct = await crypto.encryptString(sharedAB, 'solo A y B');
    await expect(crypto.decryptString(sharedAC, ct)).rejects.toThrow();
  });
});

describe('pinStrength', () => {
  it('vacío → score 0', () => {
    expect(crypto.pinStrength('').score).toBe(0);
  });

  it('muy corto → score bajo', () => {
    expect(crypto.pinStrength('123').score).toBeLessThanOrEqual(1);
  });

  it('larga + clases mixtas → score alto', () => {
    const s = crypto.pinStrength('Tr3s-Gat0s-Bailan!2026');
    expect(s.score).toBeGreaterThanOrEqual(3);
  });

  it('devuelve label', () => {
    const s = crypto.pinStrength('abc123');
    expect(typeof s.label).toBe('string');
    expect(s.label.length).toBeGreaterThan(0);
  });
});

describe('wipeBytes', () => {
  it('llena los bytes con 0', () => {
    const b = new Uint8Array([1, 2, 3, 4, 5]);
    crypto.wipeBytes(b);
    expect([...b]).toEqual([0, 0, 0, 0, 0]);
  });
});