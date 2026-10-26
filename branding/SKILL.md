# fabricore-brand-system

Skill persistente para mantener la identidad visual de **FABRI-CORE PRO** en WEB y APP ANDROID.

> **Ubicación:** `branding/SKILL.md` (dentro del repositorio de FABRI-CORE)
> **Versión:** 1.0.0
> **Estado:** Activa

---

## 1. REGLAS OBLIGATORIAS

Antes de modificar cualquier interfaz (web o APK):

1. **Leer esta skill** completa.
2. **Leer `branding/tokens.json`** y `branding/tokens.css` como fuente canónica.
3. **Identificar si el cambio afecta a WEB, ANDROID o AMBAS plataformas.**
4. **No reutilizar automáticamente un layout de una plataforma en otra.**
5. **Reutilizar componentes y tokens existentes.** No crear componentes aislados.
6. **Documentar nuevos componentes y decisiones** en esta skill.
7. **Ejecutar las pruebas pertinentes** antes de considerar el trabajo terminado.
8. **Registrar cualquier desviación justificada** en el changelog.
9. **Mantener la documentación sincronizada con la implementación.**
10. **No declarar terminado un trabajo sin verificarlo.**

---

## 2. ARQUITECTURA REAL DEL PROYECTO

| Capa | Ruta real | Tecnología |
|------|-----------|------------|
| APK Android | `android/` | Java + WebView + Rust/JNI + SQLite |
| Assets web (dentro del APK) | `android/assets/www/` | HTML/CSS/JS |
| Estilos actuales | `android/assets/www/app.css` | CSS vanilla |
| Lógica frontend | `android/assets/www/app.js` | Vanilla JS |
| Núcleo Rust (JNI) | `src-tauri/src/lib.rs` | Rust cdylib |
| API en la nube | `api/` | Vercel Node.js (PostgreSQL InsForge) |
| Build APK | `scripts/compilar.sh` | Shell + zipalign + apksigner |
| Sistema de diseño | `branding/` | tokens.json + tokens.css |

> **Nota importante:** El proyecto **NO usa Tauri v2** a pesar de que el prompt maestro lo mencione. Es un APK nativo Android con WebView. No forzar integraciones de Tauri que no existen.

---

## 3. TOKENS DE DISEÑO (FUENTE CANÓNICA)

### Archivos
- `branding/tokens.json` — Valores canónicos (JSON)
- `branding/tokens.css` — Variables CSS generadas desde tokens.json

### Colores canónicos
| Token | Valor | Uso |
|-------|-------|-----|
| `--fb-fondo` | `#050505` | Fondo principal |
| `--fb-fondo-alt` | `#0B0B0B` | Fondo alternativo / superficies |
| `--fb-color-lima` | `#C8FF00` | Acento funcional (estados activos, progreso) |
| `--fb-color-lima-alt` | `#B7FF32` | Lima alternativo |
| `--fb-texto-principal` | `#FFFFFF` | Texto principal |
| `--fb-texto-secundario` | `#B7FF32` | Texto secundario |
| `--fb-superficie` | `#0B0B0B` | Tarjetas, paneles |
| `--fb-borde` | `#1A1A1A` | Bordes |
| `--fb-borde-color-enfoque` | `#C8FF00` | Borde de enfoque (focus) |

### Tipografía
- Familia: `Inter`
- H1: 48px escritorio / 32px móvil
- H2: 32px escritorio / 24px móvil
- Texto normal: 16px
- Etiquetas: 12px, mayúsculas, letter-spacing 0.08em
- Botones: 14px, peso medio

### Radios
- Botón / Input / Tarjeta / Modal: `12px`
- Pill: `20px`

### Transiciones
- Rápida: 150ms ease
- Normal: 300ms ease
- Lenta: 500ms ease

### Regla del color lima
> El lima es color de acento funcional, **no** para rellenar toda la interfaz. Usar solo en estados activos, indicadores de progreso, datos importantes y acciones principales.

---

## 4. REGLAS SEPARADAS POR PLATAFORMA

### WEB (`branding/web/`)
- Escritorio: navegación lateral, cabecera con contexto, gráficos amplios, paneles administrativos
- Móvil: responsive design, **no** copiar layout de Android
- Patrones de navegación propios de navegador

### APP ANDROID (`branding/mobile/`)
- Borde a borde, sin márgenes blancos artificiales
- Barras de navegación compactas, controles para el pulgar
- Tarjetas compactas, jerarquía vertical
- Respeto por áreas seguras y recortes de pantalla
- Gestos solo cuando sean útiles y descubribles
- **No copiar sidebar de escritorio en la APK**

### Componentes compartidos (`branding/components/`)
- Botones, tarjetas, campos, barras de progreso, diálogos, menús, estados vacíos, notificaciones, loaders
- Usar tokens de `tokens.css`

---

## 5. COMPONENTES REUTILIZABLES (en `tokens.css`)

| Componente | Clase CSS | Descripción |
|------------|-----------|-------------|
| Botón primario | `.btn-primario` | Fondo lima, texto negro, radio 12px |
| Botón secundario | `.btn-secundario` | Fondo transparente, borde gris |
| Botón ghost | `.btn-ghost` | Sin fondo, solo texto |
| Tarjeta | `.tarjeta` | Fondo superficie, borde, sombra sutil |
| Tarjeta estadística | `.tarjeta-estadistica` | Valor + etiqueta |
| Input | `.input-base` | Fondo fondo-alt, borde, radio 12px |
| Barra de progreso | `.barra-progreso` + `.barra-progreso-lleno` | 6px altura, lima |
| Chip | `.chip` / `.chip.activo` | Pill, radio 20px |
| Estado vacío | `.estado-vacio` | Centro, icono + texto |
| Loader industrial | `.loader-industrial` | Fondo negro, monograma F, lima |

---

## 6. LOADER DE MARCA (2,5 segundos)

**Ubicación:** `android/assets/www/` — se inyecta al arrancar la APK

- Duración objetivo: 2500ms
- Fondo: `#050505`
- Monograma F (sin deformar)
- Acento: `#C8FF00`
- Tipografía: Inter
- **No bloquear hilo principal**
- **No simular que DB/IA están listos si no lo están**
- Si falla: mostrar estado de error recuperable
- Respetar `prefers-reduced-motion`

---

## 7. GUÍA DE REDESÑO DE PÁGINAS

Para cada página:

1. Identificar propósito principal
2. Conservar funciones actuales
3. Corregir jerarquía visual
4. Mejorar espaciado, tipografía, alineación
5. Unificar botones, formularios, iconos, tarjetas
6. Eliminar duplicaciones visuales
7. Mejorar estados: carga, error, éxito, vacío
8. Comprobar que elementos no se corten
9. Ajustar navegación a la plataforma
10. Verificar que acciones sigan funcionando
11. Comprobar accesibilidad
12. Documentar cambios

**No inventar módulos nuevos para rellenar el menú.** Primero mejorar lo existente.

---

## 8. ACCESIBILIDAD

- Contraste mínimo 4.5:1
- Objetivos táctiles mínimos 44×44px (recomendado 48×48px)
- Foco visible (`:focus-visible`)
- Etiquetas accesibles para iconos
- Jerarquía semántica (h1-h6, landmarks)
- Navegación por teclado en web
- Compatibilidad lectores de pantalla
- Escalado de texto
- `prefers-reduced-motion` redujo animaciones
- Mensajes de error comprensibles

---

## 9. PROCEDIMIENTO DE PRUEBAS

### Web
- Todas las rutas existentes
- Navegación y enlaces
- Responsive design (móvil, tablet, escritorio)
- Gráficos y estadísticas
- Estados vacíos y errores
- Formularios y acciones
- Consola sin errores de ejecución
- Accesibilidad (contraste, foco, lectores)
- Regresiones visuales

### Android / APK
- Compilación real del APK (`scripts/compilar.sh`)
- Instalación y arranque
- Navegación por pantallas
- Botón Atrás de Android
- Teclado virtual no cubre controles
- Orientación vertical/horizontal
- Offline funcional
- Conexión a nube (API Vercel)
- Memoria y CPU razonables

---

## 10. CHECKLIST DE REVISIÓN VISUAL

- [ ] Colores coinciden con `tokens.json`
- [ ] Tipografía Inter aplicada
- [ ] Radios 12px en botones/inputs/tarjetas
- [ ] Lima solo como acento, no relleno masivo
- [ ] No hay márgenes blancos artificiales en APK
- [ ] Loader de 2.5s en arranque (solo inicial, no cada navegación)
- [ ] Estados vacíos implementados
- [ ] Estados de error recuperables
- [ ] Transiciones ≤ 300ms
- [ ] Contraste ≥ 4.5:1
- [ ] Objetivos táctiles ≥ 44px
- [ ] Sin duplicación de navegación web→Android
- [ ] Documentación actualizada

---

## 11. PROCEDIMIENTO DE ACTUALIZACIÓN DE DOCUMENTACIÓN

1. Editar `branding/tokens.json` si cambian valores de diseño
2. Regenerar `branding/tokens.css` desde tokens.json
3. Actualizar `android/assets/www/app.css` con las nuevas variables
4. Actualizar esta SKILL.md con nuevas reglas o componentes
5. Actualizar changelog en `branding/CHANGELOG.md`
6. Verificar que APK y web sigan funcionando

---

## 12. REGISTRO DE DECISIONES Y CAMBIOS

| Fecha | Decisión | Justificación |
|-------|----------|---------------|
| 2026-10-24 | Sistema de diseño basado en tokens.json + tokens.css | Fuente única de verdad, evita divergencia |
| 2026-10-24 | No usar Tauri v2 (proyecto es APK nativo Android) | Arquitectura real del repositorio |
| 2026-10-24 | Color lima solo como acento funcional | Regla de branding canónico |
| 2026-10-24 | Loader 2.5s solo en arranque inicial | No bloquear navegaciones internas |

---

## 13. INSTRUCCIONES PARA AGENTES FUTUROS

1. Leer `branding/SKILL.md` antes de tocar cualquier interfaz.
2. Leer `branding/tokens.json` y `branding/tokens.css`.
3. Identificar plataforma objetivo: WEB o ANDROID.
4. Reutilizar componentes de `branding/components/` o clases de `tokens.css`.
5. No declarar trabajo terminado sin pasar el checklist de revisión visual.
6. Cualquier cambio de color/tipografía/radio debe pasar por `tokens.json` primero.
7. No almacenar secretos, claves, tokens ni credenciales en la skill ni en la documentación.

---

## 14. ARCHIVOS RELACIONADOS

- `branding/tokens.json` — Tokens canónicos
- `branding/tokens.css` — Variables CSS
- `branding/BRAND_GUIDELINES.md` — Guía de marca
- `branding/DESIGN_SYSTEM.md` — Sistema de diseño
- `branding/CHANGELOG.md` — Registro de cambios
- `android/assets/www/app.css` — Estilos del APK (debe importar tokens.css)
- `android/assets/www/app.js` — Lógica del APK
- `scripts/compilar.sh` — Script de compilación APK

---

*Última actualización: 2026-10-24*
