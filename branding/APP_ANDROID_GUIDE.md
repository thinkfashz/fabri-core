# APP_ANDROID_GUIDE.md — FABRI-CORE PRO

Guía de implementación para la APK Android de FABRI-CORE PRO.

## Diseño nativo móvil

- Borde a borde (sin márgenes web artificiales)
- Barras de navegación compactas, adaptadas al contexto
- Controles cómodos para el pulgar
- Tipografía legible en pantallas pequeñas
- Tarjetas compactas, jerarquía vertical
- Gestos solo cuando sean útiles y descubribles
- Formularios adaptados al teclado virtual
- Respeto por áreas seguras y recortes de pantalla
- Scroll fluido, sin saltos ni elementos superpuestos
- Estados de carga y transición sin parpadeos

## Componentes ANDROID

Usar clases de `branding/tokens.css` inyectadas en `android/assets/www/app.css`:
- `.btn-primario`, `.btn-secundario`, `.btn-ghost`
- `.tarjeta`, `.tarjeta-estadistica`
- `.input-base`
- `.barra-progreso`
- `.chip`
- `.loader-industrial` (solo en arranque inicial)

## Navegación Android

- No copiar sidebar de escritorio
- Barra inferior o menú lateral compacto (hamburguesa)
- Botón Atrás de Android respetado
- Transiciones limpias entre pantallas

## Integración con Rust/JNI

- Los comandos Rust se llaman desde JavaScript vía `window.FabrickNative.call(op, payload)`
- No modificar archivos de Android sin verificar compatibilidad
- Usar Rust como núcleo preferido, no introducir arquitectura innecesaria

---

*Versión 1.0.0 — 2026-10-24*
