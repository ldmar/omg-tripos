# ADR 002 · CRDT: LWW por campo, sin Yjs

**Fecha**: 2026-09 · **Estado**: aceptado

## Contexto
El brief pide "Yjs-like liviano" y "last-write-wins por campo, no por registro entero".

## Decisión
CRDT propio (`crdt.js`, ~3 KB): cada campo tiene `{ value, ts, author }`. Merge gana por `(ts, author)`. Tombstones explícitos.

## Consecuencias
- ✅ Cumple exactamente "LWW por campo" (Yjs Map hace LWW por entrada).
- ✅ Sin dependencia externa ni CDN.
- ⚠️ Sin garantías formales de convergencia para ediciones concurrentes complejas. Aceptable: los conflictos reales en una agenda son raros y triviales.
- ⚠️ Sin soporte de texto colaborativo (fuera de scope del MVP).