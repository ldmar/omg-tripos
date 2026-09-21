# ADR 007 · Split de app.js en módulos ui/*

**Fecha**: 2026-09 · **Estado**: aceptado

## Contexto
`app.js` llegó a ~3000 líneas tras F1.5 + F2 + F3.2. Mezclaba orquestación, wiring de DOM, render de 5 vistas, 11 modales y manejo de estado. Difícil de navegar, imposible de testear unitariamente.

## Decisión
Patrón **bus compartido** (`ui/bus.js`):
- `ctx` — objeto con `trip`, `events` y slots de dependencia
- `register(key, fn)` / `call(key, ...)` — inyección de dependencias sin imports circulares
- `on/off/emit` — event emitter mínimo para re-render
- `openModalEl/closeModalEl` — helpers accesibles con `inert`
- `toast` — notificaciones UI

Módulos UI por responsabilidad:
| Módulo | Responsabilidad |
|---|---|
| `ui/today.js` | Hero + Next + Timeline |
| `ui/wallet.js` | Grid + Viewer + Upload + Categoría |
| `ui/event-modal.js` | Modal de evento + adjuntos |
| `ui/chat.js` | Render + send del chat |
| `ui/map.js` | Pins + sheet |
| `ui/management.js` | Trips + Travelers + Settings + Notif + Import |

`app.js` queda como orquestador (~250 líneas): boot, `setView`, `switchTrip`, `startSync`, PWA, lockscreen.

## Consecuencias
- ✅ Cada módulo es testeable aislado (basta inyectar `ctx`).
- ✅ Onboarding de contribuidores: encontrar dónde tocar es trivial.
- ✅ Deploy: se cachean por separado, cambios en un módulo no invalidan el resto.
- ⚠️ Boilerplate: `ui/bus.js` agrega ~200 líneas de infra.
- ⚠️ Riesgo de sprawl: si un módulo supera ~800 líneas, hay que partirlo de nuevo.