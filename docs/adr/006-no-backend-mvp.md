# ADR 006 · Sin backend en el MVP

**Fecha**: 2026-09 · **Estado**: aceptado

## Contexto
El brief prohíbe backend obligatorio y telemetría agresiva. Pero la sync entre dispositivos necesita algún rendezvous.

## Decisión
MVP: sin backend propio. Sync vía WebRTC + signaling público (best-effort) + BroadcastChannel same-device. La app funciona 100 % sin signaling.

## Consecuencias
- ✅ Offline-first real: primer arranque sin red.
- ✅ Cero infraestructura que mantener.
- ⚠️ Sync cross-network falla en ~15 % de redes móviles (NAT simétrico sin TURN). Documentado en UI.
- ⚠️ Sin store-and-forward: los peers deben estar online simultáneamente (R2 del plan).
- ⚠️ Sin push notifications con app cerrada en iOS (R1). Mitigación: Periodic Background Sync en Android + relay de push en plan Pro.