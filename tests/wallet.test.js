/* ============================================================
   Tests · wallet.js
   Storage cifrado de documentos
   - Importa el módulo UNA sola vez y limpia stores entre tests
   - Mockea vault para evitar PBKDF2 (rápido)
   ============================================================ */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

/* ============================================================
   Mock de vault · clave AES real generada una sola vez
   ============================================================ */
const vaultState = vi.hoisted(() => ({ unlocked: true }));

vi.mock('../vault.js', async () => {
  const { webcrypto } = await import('node:crypto');
  let _key = null;

  async function getKey() {
    if (!_key) {
      _key = await webcrypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    }
    return _key;
  }

  return {
    isUnlocked: () => vaultState.unlocked,
    getTripKey: async () => {
      if (!vaultState.unlocked) throw new Error('Vault locked');
      return getKey();
    },
    lock: () => {},
    unlock: async () => {},
    setup: async () => {},
  };
});

/* ============================================================
   Setup · importar wallet una sola vez
   ============================================================ */
let wallet;

beforeAll(async () => {
  wallet = await import('../wallet.js');
});

beforeEach(async () => {
  // Limpiar el store sin tocar la conexión IDB
  await wallet.clearAllFiles();
});

/* ============================================================
   Fixtures
   ============================================================ */
const TRIP_ID = 'trip_test_001';

function makePdfBlob(content = 'contenido de prueba', name = 'documento.pdf') {
  return new File([content], name, { type: 'application/pdf' });
}
function makeTxtBlob(content = 'texto', name = 'notas.txt') {
  return new File([content], name, { type: 'text/plain' });
}

/* ============================================================
   saveFile · vault locked
   ============================================================ */
describe('saveFile · vault locked', () => {
  beforeEach(() => { vaultState.unlocked = false; });

  it('guarda el blob plano si el vault está bloqueado', async () => {
    const rec = await wallet.saveFile(makePdfBlob(), { tripId: TRIP_ID });

    expect(rec.id).toMatch(/^f_/);
    expect(rec.tripId).toBe(TRIP_ID);
    expect(rec.name).toBe('documento.pdf');
    expect(rec.mime).toBe('application/pdf');
    expect(rec.encrypted).toBe(false);
    expect(rec.blob).toBeInstanceOf(Blob);
  });

  it('aplica categoría por defecto "other"', async () => {
    const rec = await wallet.saveFile(makeTxtBlob(), { tripId: TRIP_ID });
    expect(rec.category).toBe('other');
  });
});

/* ============================================================
   saveFile · vault unlocked
   ============================================================ */
describe('saveFile · vault unlocked', () => {
  beforeEach(() => { vaultState.unlocked = true; });

  it('cifra el blob en reposo cuando el vault está desbloqueado', async () => {
    const content = 'secreto-12345';
    await wallet.saveFile(makePdfBlob(content), { tripId: TRIP_ID });

    // Leer el registro crudo desde IDB (no el hidratado)
    const raw = await new Promise((resolve, reject) => {
      const req = indexedDB.open('omg-tripos-wallet');
      req.onsuccess = () => {
        const idb = req.result;
        const tx = idb.transaction('files', 'readonly');
        const all = tx.objectStore('files').getAll();
        all.onsuccess = () => { idb.close(); resolve(all.result || []); };
        all.onerror = () => { idb.close(); reject(all.error); };
      };
      req.onerror = () => reject(req.error);
    });

    expect(raw).toHaveLength(1);
    const record = raw[0];

    // Está marcado como cifrado
    expect(record.encrypted).toBe(true);

    // Tiene el payload cifrado
    expect(record.blobEncrypted).toBeTruthy();
    expect(record.blobEncrypted.v).toBe(1);
    expect(record.blobEncrypted.iv).toBeTruthy();
    expect(record.blobEncrypted.ct).toBeTruthy();

    // NO tiene el blob plano
    expect(record.blob).toBeUndefined();

    // El ciphertext NO contiene el plaintext legible
    const ctBytes = new Uint8Array(record.blobEncrypted.ct);
    const ctAsText = new TextDecoder().decode(ctBytes);
    expect(ctAsText).not.toContain(content);
  });

  it('getFile descifra el blob de vuelta', async () => {
    const content = 'contenido secreto';
    const rec = await wallet.saveFile(makePdfBlob(content), { tripId: TRIP_ID });

    const fetched = await wallet.getFile(rec.id);
    expect(fetched.blob).toBeInstanceOf(Blob);
    expect(fetched.blob.type).toBe('application/pdf');

    const text = await fetched.blob.text();
    expect(text).toBe(content);
  });

  it('rechaza archivos > 15 MB', async () => {
    const big = new File([new ArrayBuffer(16 * 1024 * 1024)], 'grande.pdf', {
      type: 'application/pdf',
    });
    await expect(wallet.saveFile(big, { tripId: TRIP_ID })).rejects.toThrow(/15 MB/);
  });

  it('acepta categoría explícita en opts', async () => {
    const rec = await wallet.saveFile(makePdfBlob(), {
      tripId: TRIP_ID,
      category: 'boarding',
    });
    expect(rec.category).toBe('boarding');
  });
});

/* ============================================================
   Categorización automática
   ============================================================ */
describe('categorización automática', () => {
  beforeEach(() => { vaultState.unlocked = false; });

  it('detecta boarding por nombre de aerolínea', async () => {
    const rec = await wallet.saveFile(
      new File(['x'], 'boarding-pass-iberia.pdf', { type: 'application/pdf' }),
      { tripId: TRIP_ID }
    );
    expect(rec.category).toBe('boarding');
  });

  it('detecta voucher por nombre de hotel', async () => {
    const rec = await wallet.saveFile(
      new File(['x'], 'voucher-hotel-madrid.pdf', { type: 'application/pdf' }),
      { tripId: TRIP_ID }
    );
    expect(rec.category).toBe('voucher');
  });

  it('detecta seguro', async () => {
    const rec = await wallet.saveFile(
      new File(['x'], 'poliza-seguro-viaje.pdf', { type: 'application/pdf' }),
      { tripId: TRIP_ID }
    );
    expect(rec.category).toBe('insurance');
  });

  it('detecta documento de identidad', async () => {
    const rec = await wallet.saveFile(
      new File(['x'], 'pasaporte-juan.pdf', { type: 'application/pdf' }),
      { tripId: TRIP_ID }
    );
    expect(rec.category).toBe('id');
  });

  it('usa eventType como fallback', async () => {
    const rec = await wallet.saveFile(
      new File(['x'], 'archivo-generico.pdf', { type: 'application/pdf' }),
      { tripId: TRIP_ID, eventType: 'flight' }
    );
    expect(rec.category).toBe('boarding');
  });
});

/* ============================================================
   Queries
   ============================================================ */
describe('queries', () => {
  beforeEach(() => { vaultState.unlocked = false; });

  it('getAllFiles filtra por tripId y ordena desc por uploadedAt', async () => {
    await wallet.saveFile(makeTxtBlob('a', 'a.txt'), { tripId: 'trip_A' });
    await new Promise(r => setTimeout(r, 5));
    await wallet.saveFile(makeTxtBlob('b', 'b.txt'), { tripId: 'trip_A' });
    await wallet.saveFile(makeTxtBlob('c', 'c.txt'), { tripId: 'trip_B' });

    const aFiles = await wallet.getAllFiles('trip_A');
    expect(aFiles).toHaveLength(2);
    expect(aFiles[0].name).toBe('b.txt');

    const all = await wallet.getAllFiles();
    expect(all).toHaveLength(3);
  });

  it('getFilesByEvent filtra por eventId', async () => {
    await wallet.saveFile(makeTxtBlob('1', 'a.txt'), { tripId: TRIP_ID, eventId: 'ev_1' });
    await wallet.saveFile(makeTxtBlob('2', 'b.txt'), { tripId: TRIP_ID, eventId: 'ev_1' });
    await wallet.saveFile(makeTxtBlob('3', 'c.txt'), { tripId: TRIP_ID, eventId: 'ev_2' });

    const ev1 = await wallet.getFilesByEvent('ev_1');
    expect(ev1).toHaveLength(2);

    const ev2 = await wallet.getFilesByEvent('ev_2');
    expect(ev2).toHaveLength(1);
  });

  it('getFilesByEvent devuelve [] para eventId falsy', async () => {
    expect(await wallet.getFilesByEvent(null)).toEqual([]);
    expect(await wallet.getFilesByEvent('')).toEqual([]);
  });

  it('getFile devuelve null si no existe', async () => {
    expect(await wallet.getFile('nope')).toBeNull();
  });
});

/* ============================================================
   updateFile / deleteFile
   ============================================================ */
describe('updateFile + deleteFile', () => {
  beforeEach(() => { vaultState.unlocked = false; });

  it('updateFile persiste el cambio y actualiza updatedAt', async () => {
    const rec = await wallet.saveFile(makeTxtBlob(), { tripId: TRIP_ID });
    const originalUpdatedAt = rec.updatedAt;

    await new Promise(r => setTimeout(r, 5));

    const updated = await wallet.updateFile(rec.id, { category: 'insurance' });
    expect(updated.category).toBe('insurance');
    expect(updated.updatedAt).toBeGreaterThan(originalUpdatedAt);

    const fetched = await wallet.getFile(rec.id);
    expect(fetched.category).toBe('insurance');
  });

  it('updateFile falla si el archivo no existe', async () => {
    await expect(wallet.updateFile('nope', { category: 'other' })).rejects.toThrow();
  });

  it('deleteFile elimina el registro', async () => {
    const rec = await wallet.saveFile(makeTxtBlob(), { tripId: TRIP_ID });
    await wallet.deleteFile(rec.id);
    expect(await wallet.getFile(rec.id)).toBeNull();
  });
});

/* ============================================================
   Utils
   ============================================================ */
describe('fmtBytes', () => {
  it('formatea bytes, KB y MB', () => {
    expect(wallet.fmtBytes(0)).toBe('0 B');
    expect(wallet.fmtBytes(500)).toBe('500 B');
    expect(wallet.fmtBytes(2048)).toBe('2.0 KB');
    expect(wallet.fmtBytes(5 * 1024 * 1024)).toBe('5.00 MB');
  });
});

describe('isPdf / isImage', () => {
  it('detecta PDF por mime', () => {
    expect(wallet.isPdf({ mime: 'application/pdf', name: 'x' })).toBe(true);
    expect(wallet.isPdf({ mime: 'image/jpeg', name: 'x' })).toBe(false);
  });

  it('detecta PDF por extensión', () => {
    expect(wallet.isPdf({ mime: '', name: 'ticket.pdf' })).toBe(true);
  });

  it('detecta imagen por mime', () => {
    expect(wallet.isImage({ mime: 'image/png', name: 'x' })).toBe(true);
    expect(wallet.isImage({ mime: 'application/pdf', name: 'x' })).toBe(false);
  });
});

describe('getCategories', () => {
  it('devuelve las 6 categorías esperadas', () => {
    const cats = wallet.getCategories();
    expect(Object.keys(cats)).toEqual(
      expect.arrayContaining(['boarding', 'voucher', 'insurance', 'id', 'car', 'other'])
    );
  });

  it('cada categoría tiene label, icon y color', () => {
    const cats = wallet.getCategories();
    for (const cat of Object.values(cats)) {
      expect(cat.label).toBeTruthy();
      expect(cat.icon).toBeTruthy();
      expect(cat.color).toMatch(/^#/);
    }
  });
});
