# TAURI_ANDROID_GUIDE.md — FABRI-CORE PRO

Nota: El proyecto actual **no usa Tauri v2**. Es un APK Android nativo con WebView + Rust/JNI.

## Arquitectura real

| Capa | Ruta | Tecnología |
|------|------|------------|
| APK | `android/` | Java + WebView |
| Assets web | `android/assets/www/` | HTML/CSS/JS |
| Núcleo Rust | `src-tauri/src/lib.rs` | Rust cdylib (JNI) |
| Build APK | `scripts/compilar.sh` | Shell + zipalign + apksigner |

## Integración Rust ↔ JavaScript

Desde JavaScript:
```js
const crudo = window.FabrickNative.call(op, JSON.stringify(payload || {}));
```

Desde Rust (JNI):
- Dispatch mediante `match` (no `?` en funciones JNI que retornan jstring)
- Tablas SQLite: `productos`, `clientes`, `facturas`, `detalle_factura`, `aprendizajes`, `conocimiento_vectorial`, `skills_registro`, etc.

## Reglas

- No forzar integración de Tauri v2 si no existe en el proyecto
- Mantener Rust como núcleo preferido
- Usar integraciones Android solo cuando aporten valor verificado
- No sacrificar offline, SQLite, funciones locales o seguridad por efectos visuales

---

*Versión 1.0.0 — 2026-10-24*
