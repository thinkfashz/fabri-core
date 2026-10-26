# APP_WEB_GUIDE.md — FABRI-CORE PRO

Guía de implementación para la versión WEB de FABRI-CORE PRO.

## Diseño por dispositivo

### Escritorio
- Dashboard con composición equilibrada
- Navegación lateral
- Cabecera con contexto, búsqueda y acciones
- Gráficos y tablas con suficiente espacio
- Paneles de información y controles administrativos
- Aprovechamiento del ancho de pantalla

### Navegador móvil
- Responsive design (no copiar layout de Android)
- Patrones de navegación propios de navegador

## Componentes WEB

Usar clases de `branding/tokens.css`:
- `.btn-primario`, `.btn-secundario`, `.btn-ghost`
- `.tarjeta`, `.tarjeta-estadistica`
- `.input-base`
- `.barra-progreso`
- `.chip`

## Navegación

- No copiar el sidebar de escritorio en la versión móvil web
- Mantener navegación lateral en escritorio
- Menú hamburguesa o similar en móvil

---

*Versión 1.0.0 — 2026-10-24*
