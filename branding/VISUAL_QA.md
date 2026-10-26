# VISUAL_QA.md — FABRI-CORE PRO

Procedimiento de revisión visual y checklist de calidad.

## Checklist de revisión visual

### Colores y marca
- [ ] Colores coinciden con `branding/tokens.json`
- [ ] Lima solo como acento funcional (no relleno masivo)
- [ ] Fondo principal `#050505`, texto principal `#FFFFFF`

### Tipografía
- [ ] Familia Inter aplicada
- [ ] Tamaños según escala (H1, H2, texto, etiquetas, botones)
- [ ] Pesos correctos (regular 400, medio 500, bold 700)

### Radios y bordes
- [ ] Botones, inputs, tarjetas: radio 12px
- [ ] Chips: radio 20px
- [ ] Bordes: 1px color `#1A1A1A`

### Espaciado y layout
- [ ] Espaciado según tokens (xs, sm, md, lg, xxl)
- [ ] No hay márgenes blancos artificiales en APK
- [ ] Elementos no se cortan en pantalla

### Componentes
- [ ] Botones usan `.btn-primario`, `.btn-secundario` o `.btn-ghost`
- [ ] Tarjetas usan `.tarjeta`
- [ ] Inputs usan `.input-base`
- [ ] Barras de progreso usan `.barra-progreso`

### Accesibilidad
- [ ] Contraste ≥ 4.5:1
- [ ] Objetivos táctiles ≥ 44px
- [ ] Foco visible (`:focus-visible`)
- [ ] `prefers-reduced-motion` respetado

### Estados
- [ ] Estado vacío implementado cuando no hay datos
- [ ] Estado de error recuperable
- [ ] Estado de carga sin bloquear interacción

### Loader
- [ ] Loader industrial solo en arranque inicial (no cada navegación)
- [ ] Duración 2500ms
- [ ] No bloquea hilo principal

### Navegación
- [ ] No hay duplicación de navegación web→Android
- [ ] Botón Atrás de Android respetado
- [ ] Transiciones limpias entre pantallas

### Plataforma
- [ ] WEB: navegación lateral en escritorio, responsive en móvil
- [ ] ANDROID: borde a borde, barras compactas, controles para pulgar

---

*Versión 1.0.0 — 2026-10-24*
