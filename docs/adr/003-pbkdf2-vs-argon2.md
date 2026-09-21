# ADR 003 · PBKDF2 nativo como KDF default

**Fecha**: 2026-09 · **Estado**: aceptado

## Contexto
Argon2id es superior contra GPU cracking, pero en WebAssembly suma ~150 KB al bundle y carga WASM en el camino crítico del unlock.

## Decisión
PBKDF2-SHA256 con 600.000 iteraciones (OWASP 2023). Argon2id queda como opción opt-in desde settings (lazy load).

## Consecuencias
- ✅ Unlock < 800 ms en Pixel 6a, con cero bytes de bundle.
- ⚠️ Resistencia a GPU attack inferior a Argon2id. Mitigado por PIN largo y auto-lock corto.
- ⚠️ Deuda: implementar Argon2id opt-in en v3.1.