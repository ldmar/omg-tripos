# ADR 005 · Crypto-shredding para el wipe

**Fecha**: 2026-09 · **Estado**: aceptado

## Contexto
GDPR art. 17 y Ley 25.326 art. 16 requieren derecho al olvido. Borrar blobs cifrados de IDB es lento y falible en algunos browsers.

## Decisión
Cada viaje tiene una **data key** envuelta por la master key. El wipe de un viaje = borrar su data key. Los blobs quedan pero son irrecuperables.

## Consecuencias
- ✅ Wipe instantáneo (< 50 ms).
- ✅ A prueba de residuos: aunque el blob sobreviva en algún log del FS, sin la clave es ruido.
- ✅ Permite wipe granular (un viaje sin tocar los demás).
- ⚠️ Requiere que la master key no se filtre. Mitigado con auto-lock de 15 min.