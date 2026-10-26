# DESIGN_DECISIONS.md — FABRI-CORE PRO

Registro de decisiones de diseño tomadas durante la implementación.

| Fecha | Decisión | Justificación | Estado |
|-------|----------|---------------|--------|
| 2026-10-24 | Sistema de diseño basado en `tokens.json` + `tokens.css` | Fuente única de verdad, evita divergencia entre valores | Aprobado |
| 2026-10-24 | No usar Tauri v2 | El proyecto real es APK nativo Android con WebView + Rust/JNI, no hay configuración de Tauri | Aprobado |
| 2026-10-24 | Color lima solo como acento funcional | Regla de branding canónico (prompt maestro) | Aprobado |
| 2026-10-24 | Loader 2.5s solo en arranque inicial | No bloquear navegaciones internas, regla del prompt maestro | Aprobado |
| 2026-10-24 | MobileLLM-125M como botón con advertencia >50MB | Regla de oro and4oid: no descargar >50MB sin autorización | Pendiente autorización |

---

*Versión 1.0.0 — 2026-10-24*
