/* ============================================================
   Setup global de tests
   - Reemplaza indexedDB con fake-indexeddb/auto
   - Garantiza que crypto.subtle exista en Node 20+
   ============================================================ */

import 'fake-indexeddb/auto';

// Node 20+ expone webcrypto nativo en globalThis.crypto.
// Si por algún motivo falta, fallar temprano con mensaje claro.
if (!globalThis.crypto?.subtle) {
  throw new Error('crypto.subtle no disponible — se requiere Node 20+');
}