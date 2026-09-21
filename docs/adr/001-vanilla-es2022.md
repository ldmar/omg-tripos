# ADR 001 · Vanilla ES2022 + módulos nativos

**Fecha**: 2026-09 · **Estado**: aceptado

## Contexto
El brief exige bundle < 5 MB, arranque < 2 s en gama media Android y "sin frameworks pesados".

## Decisión
Vanilla JS con módulos ES nativos y `import maps`. Sin bundler en dev. `esbuild` opcional sólo para minificar en prod.

## Consecuencias
- ✅ Bundle inicial < 200 KB gzip (medido con Lighthouse).
- ✅ Cero dependencias de runtime.
- ⚠️ Sin HMR. Recarga manual en dev.
- ⚠️ Sin tree-shaking automático. Control manual de qué se importa.
- ⚠️ Deuda: split manual de `app.js` cuando supere ~3000 líneas (F3.3).