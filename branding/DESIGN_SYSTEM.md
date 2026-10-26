# DESIGN_SYSTEM.md — FABRI-CORE PRO

Sistema de diseño versionado, centralizado y reutilizable.

## Estructura de archivos

```
branding/
├── README.md
├── BRAND_GUIDELINES.md
├── DESIGN_DECISIONS.md
├── CHANGELOG.md
├── tokens.json          ← Fuente canónica de valores
├── tokens.css           ← Generado desde tokens.json
├── assets/              ← Logotipos, iconos, imágenes
├── components/          ← Componentes reutilizables
├── web/                 ← Componentes exclusivos WEB
├── mobile/              ← Componentes exclusivos ANDROID
├── accessibility/       ← Reglas y tests de accesibilidad
├── screenshots/         ← Capturas antes/después
└── testing/             ← Pruebas visuales y de regresión
```

## Tokens

Ver `branding/tokens.json` y `branding/tokens.css`.

## Componentes reutilizables

Definidos en `tokens.css`:
- `.btn-primario`, `.btn-secundario`, `.btn-ghost`
- `.tarjeta`, `.tarjeta-estadistica`
- `.input-base`
- `.barra-progreso` + `.barra-progreso-lleno`
- `.chip`, `.chip.activo`
- `.estado-vacio`
- `.loader-industrial`

## Reglas de integración

1. Los valores de `tokens.json` son la fuente canónica.
2. `tokens.css` se genera desde `tokens.json` (no divergir).
3. `android/assets/www/app.css` debe importar o referenciar las variables de `tokens.css`.
4. Cada nueva página debe reutilizar componentes y tokens existentes.

---

*Versión 1.0.0 — 2026-10-24*
