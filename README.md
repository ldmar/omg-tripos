# OhMyGoch Trip OS

PWA instalable, offline-first, cifrada en reposo. Planificación de viajes grupales sin backend obligatorio.

- **Bundle inicial**: < 200 KB gzip
- **Arranque**: < 2 s en gama media Android (4G)
- **Offline**: 100 % funcional desde el primer arranque
- **Cifrado**: AES-GCM 256 en reposo, ECDH + AES-GCM en tránsito
- **Sin frameworks**: Vanilla ES2022 + módulos nativos

## Correr en local

Requerimientos: Node 18+ (sólo para el server estático) o Python 3.

```bash
# Opción 1: con npx
npx serve -p 3002 .

# Opción 2: con Python
python3 -m http.server 3002

# Opción 3: cualquier server estático
```

Abrí `http://localhost:3002`. En dev, el SW se desactiva automáticamente (`IS_DEV`).

## Estructura

```
.
├── index.html          Shell semántico + 11 modales + sprite SVG
├── styles.css          Design tokens + dark mode + reduced-motion
├── manifest.json       PWA manifest (any + maskable)
├── sw.js               Service Worker (network-first / cache-first / SWR)
│
├── app.js              Orquestador + UI wiring
├── trips.js            Storage de viajes + eventos (IDB)
├── wallet.js           Storage de documentos cifrados (IDB + AES-GCM)
├── chat.js             Mensajería cifrada E2E (IDB + DataChannel)
│
├── crypto.js           Wrappers WebCrypto (AES-GCM, ECDH, PBKDF2)
├── vault.js            Sesión de claves + lock screen + wipe
├── crdt.js             LWW por campo (sin dependencias)
├── sync.js             P2P WebRTC + CRDT + ECDH handshake
│
├── parser.js           Import mágico (Booking, Airbnb, vuelos, autos)
├── pdf-import.js       Extracción de PDF (pdf.js lazy)
├── ocr-import.js       OCR de imágenes (Tesseract lazy)
│
├── daymode.js          Modo Día Activo + wake lock
├── notifications.js    Recordatorios base
├── alerts.js           Alertas extendidas (docs, check-in, digest)
│
├── icons/              Íconos PWA (192, 512, maskable, favicons)
└── docs/adr/           Architecture Decision Records
```

## Testear offline

1. Abrí la app en Chrome con DevTools
2. **Application → Service Workers → Offline**
3. Recargá (F5). La app debe:
   - Mostrar el itinerario completo
   - Permitir crear/editar/borrar eventos
   - Permitir abrir documentos del wallet
   - Todo persiste al cerrar y reabrir
4. En consola, `navigator.onLine` es `false` pero la app sigue operativa

## Verificar instalabilidad

### Android (Chrome / Edge / Samsung Internet)

1. Abrí la app. Después de ~30 s debería aparecer el banner custom de instalación.
2. Si no aparece, `⋮ → Instalar aplicación`.
3. El ícono debe quedar en el launcher como WebAPK real (no como shortcut).
4. Abrila desde el launcher → debe abrir en **standalone** (sin barra de URL).

### iPhone (Safari 16.4+)

1. **Compartir → Añadir a pantalla de inicio**.
2. Abrí desde el home screen → modo standalone.
3. Para notificaciones: `Ajustes → Safari → Notificaciones → OhMyGoch`.

### Verificar el service worker

- **DevTools → Application → Service Workers** → estado `activated and is running`
- **Application → Cache Storage** → `core-OMGTripOS-v3.0.0` y `runtime-OMGTripOS-v3.0.0`
- **Lighthouse → PWA** → todos los checks en verde

### Verificar el cifrado

1. Configurá un PIN al abrir por primera vez.
2. Subí un PDF al wallet.
3. **DevTools → Application → IndexedDB → `omg-tripos-wallet` → `files`**
4. El registro debe tener:
   - `encrypted: true`
   - `blobEncrypted: { v: 1, iv, ct }`
   - **NO** `blob` plano

## Hoja de ruta de monetización

Todo gated por feature flags locales (`localStorage.omg_plan = "free" | "pro" | "agency"`). Sin bloqueo del core.

| Feature | Free | Pro | Agencia |
|---|---|---|---|
| Viajes activos | 1 | ∞ | ∞ |
| Viajeros por viaje | 3 | 20 | ∞ |
| Adjuntos cifrados | 100 MB | 5 GB | 50 GB |
| Export PDF itinerario | — | ✅ | ✅ + branding |
| Sync vía relay propio | — | ✅ | ✅ |
| Backup cifrado | — | ✅ | ✅ + retención |
| Marca blanca | — | — | ✅ |
| Panel multi-cliente | — | — | ✅ |

**Degradación offline**: cada feature premium debe seguir funcionando en su versión free sin conexión. Los gates se evalúan localmente contra `omg_plan`.

## Deuda técnica conocida

| Punto | Estado |
|---|---|
| Argon2id (via WASM) | Pendiente v3.1, opt-in |
| Reintento de chat sin peer | Pendiente F4 |
| Split de `app.js` en `ui/*.js` | Pendiente F3.3 |
| Notificaciones con app cerrada | Limitación de plataforma, ver `SECURITY.md` §R1 |
| iOS storage eviction | Mitigación: export cifrado de vault (F3.2) |

## Licencia

Proprietary · OhMyGoch © 2026