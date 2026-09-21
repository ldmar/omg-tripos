# ADR 004 · ECDH efímero en el DataChannel

**Fecha**: 2026-09 · **Estado**: aceptado

## Contexto
El signaling es público y compartido. Cualquier observador puede leer SDP/ICE. El payload viaja por DataChannel WebRTC.

## Decisión
Cada sesión de sync genera un par ECDH P-256 efímero. Al abrir el DataChannel, los peers intercambian public keys JWK y derivan AES-256.

## Consecuencias
- ✅ El signaling nunca ve plaintext.
- ✅ Forward secrecy por sesión.
- ⚠️ MITM del signaling puede hacer relay transparente (no leer). Mitigación futura: fingerprint out-of-band en QR.
- ⚠️ Sin autenticación de peers. Cualquiera en el signaling puede intentar handshake. Hoy: el handshake falla si no hay clave; mensajes no se aceptan hasta derivar clave compartida.