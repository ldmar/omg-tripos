# SECURITY · OhMyGoch Trip OS

Última actualización: 2026-09 · v3.0

## Modelo de amenazas

### Activos a proteger
- Documentos de viaje (pasaportes, boarding passes, seguros, vouchers)
- Datos personales de viajeros (nombres, contactos, documentos)
- Mensajes del chat grupal
- Coordenadas e itinerarios

### Adversarios considerados
| # | Adversario | Mitigación |
|---|---|---|
| 1 | Device perdido/robado | Cifrado en reposo AES-GCM 256 con PIN |
| 2 | Script malicioso en origen (XSS) | Sin `innerHTML` con datos de usuario, escape estricto, CSP en server |
| 3 | Peer malicioso en sync | ECDH efímero + AES-GCM; sin clave, no lee ni inyecta |
| 4 | Relay/signaling comprometido | Signaling sólo ve SDP/ICE, nunca payload |
| 5 | App maliciosa en el device | **Fuera de alcance** |

### Fuera de alcance
- Atacante con acceso físico + root mientras el vault está desbloqueado
- Compromiso del navegador o de WebCrypto
- Side-channels de timing (fuera del scope de una PWA)

## Qué se cifra

| Dato | Algoritmo | Clave | AAD |
|---|---|---|---|
| Documentos (blobs) | AES-GCM 256 | Data key del viaje | `doc:{docId}` |
| Thumbnails | AES-GCM 256 | Data key del viaje | `thumb:{docId}` |
| `Traveler.encryptedProfile` | AES-GCM 256 | Data key del viaje | `trav:{travId}` |
| Mensajes del chat (reposo) | AES-GCM 256 | Data key del viaje | `msg:{msgId}` |
| Chat (transporte P2P) | AES-GCM 256 | ECDH efímero de sesión | `chat` |
| Data keys por viaje | AES-GCM 256 (key wrap) | Master key | — |

## Qué NO se cifra (y por qué)

| Dato | Motivo |
|---|---|
| Metadata de viaje (título, fechas, bandera) | Necesaria para listar viajes sin desbloquear. No sensible por sí sola. |
| Índices IDB (`tripId`, `startAt`, `category`) | Necesarios para queries < 50 ms. |
| `name`, `mime`, `size` de adjuntos | Necesarios para UI sin descifrar el blob. |
| Salt de PBKDF2 | Público por diseño. |
| `pinCheck` | Cifrado, pero su existencia es pública. |

## KDF

- **PBKDF2-SHA256, 600.000 iteraciones** (OWASP 2023)
- Salt de 16 bytes por vault, regenerado en cada `setup()`
- Argon2id: **planeado v3.1** (WASM lazy, opt-in desde settings)

## Handshake P2P

1. Cada peer genera par **ECDH P-256** efímero al iniciar `sync.initSync()`
2. Signaling transporta **sólo SDP + ICE** (nunca payload)
3. Al abrir el DataChannel, intercambio de **public keys JWK**
4. Se deriva **AES-256 vía ECDH** (WebCrypto)
5. Todos los mensajes de chat van **cifrados con AAD `"chat"`**

Un atacante que controle el signaling puede MITM del SDP (relay transparente), pero **no puede leer el tráfico**. Mitigación futura: fingerprint out-of-band en el QR.

## Wipe criptográfico

`vault.destroyTripKey(tripId)` borra la data key envuelta. Los blobs cifrados permanecen en IndexedDB pero son **irrecuperables sin la clave**.

Cumple **GDPR art. 17** (derecho al olvido) y **Ley 25.326 art. 16** (AR).

## Ciclo de vida de claves

| Evento | Acción |
|---|---|
| Primer uso | `setup(pin)` → PBKDF2 → master key en memoria |
| Nuevo viaje | `getTripKey(tripId, {create: true})` → data key aleatoria envuelta |
| 15 min inactivo | `vault.lock()` → master key borrada de memoria |
| Cambio de PIN | re-wrap de todas las data keys con `changePIN()` |
| Borrado de viaje | `destroyTripKey(tripId)` → crypto-shredding |

## Reportar vulnerabilidades

`security@ohmygoch.example` (PGP en `/security.asc`)