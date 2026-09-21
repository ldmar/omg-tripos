# SECURITY.md · OhMyGoch Trip OS

## Modelo de amenazas

**Activos a proteger:**
- Documentos de viaje (pasaportes, boarding passes, seguros)
- Datos personales de viajeros (nombres, contactos, documentos)
- Mensajes de chat grupal
- Coordenadas e itinerarios

**Adversarios considerados:**
1. **Device perdido/robado** → mitigado por cifrado en reposo con PIN
2. **Script malicioso en el origen** (XSS) → mitigado parcialmente (CSP, sin innerHTML con datos de usuario)
3. **Peer malicioso en el sync** → mitigado por ECDH + AES-GCM; un peer sin la clave de viaje no puede leer ni inyectar
4. **Relay/signaling comprometido** → signaling sólo ve SDP/ICE, nunca datos
5. **App maliciosa en el device** → fuera de alcance (cualquier app con root puede leer memoria)

**NO considerados:**
- Atacante con acceso físico + root al device mientras el vault está desbloqueado
- Compromiso del navegador / WebCrypto
- Side-channels de timing (fuera del scope de una PWA)

## Qué se cifra

| Dato | Algoritmo | Clave | AAD |
|---|---|---|---|
| Documentos (blobs) | AES-GCM 256 | Data key del viaje | `doc:{docId}` |
| Thumbnails | AES-GCM 256 | Data key del viaje | `thumb:{docId}` |
| `Traveler.encryptedProfile` | AES-GCM 256 | Data key del viaje | `trav:{travId}` |
| Chat | AES-GCM 256 | Clave ECDH efímera de sesión | `chat` |
| Data keys (por viaje) | AES-GCM 256 (key wrap) | Master key (PBKDF2) | — |

## Qué NO se cifra (y por qué)

| Dato | Motivo |
|---|---|
| Metadata de viaje (título, fechas, bandera) | Necesaria para mostrar la lista de viajes sin desbloquear. No es sensible por sí sola. |
| Índices (`tripId`, `startAt`, `category`) | Necesarios para queries < 50ms |
| Salt de PBKDF2 | Público por diseño |
| Check vector del PIN | Cifrado, pero su existencia es pública |

## KDF

- **PBKDF2-SHA256, 600.000 iteraciones** (recomendación OWASP 2023)
- Salt de 16 bytes por vault
- Argon2id planeado para v3.1 (via WASM, lazy load, opt-in en config)

## Handshake P2P

1. Cada peer genera par **ECDH P-256** efímero al iniciar sync
2. Signaling sólo transporta **SDP + ICE** (nunca datos)
3. Al abrir el DataChannel, ambos intercambian **public keys por el canal**
4. Derivan clave AES-256 vía **ECDH → HKDF** (implícito en WebCrypto)
5. Todos los mensajes de chat van **cifrados con AES-GCM** y AAD `"chat"`

Un atacante que controle el signaling puede hacer MITM del SDP, pero **no puede leer el tráfico** (ECDH sobre el DataChannel). Sí podría hacer un relay transparente; mitigación planeada: fingerprint out-of-band (QR).

## Wipe criptográfico

`vault.destroyTripKey(tripId)` borra la data key envuelta del viaje. Los blobs cifrados permanecen en IndexedDB pero son **irrecuperables sin la clave**. Cumple GDPR art. 17 y Ley 25.326 art. 16.

## Reportar vulnerabilidades

security@ohmygoch.example (PGP en `/security.asc`)