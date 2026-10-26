# ACCESSIBILITY.md — FABRI-CORE PRO

Reglas de accesibilidad para WEB y APP ANDROID.

## Contraste

- Contraste mínimo 4.5:1 para texto normal
- Contraste mínimo 3:1 para texto grande (18px+ o 14px+ bold)
- Colores de texto sobre fondo oscuro verificados

## Objetivos táctiles

- Mínimo: 44×44px
- Recomendado: 48×48px
- Aplicar a botones, enlaces, inputs, chips

## Foco visible

- `:focus-visible` con borde 2px color lima (`#C8FF00`)
- Outline offset 2px
- Ningún elemento interactivo sin indicador de foco

## Jerarquía semántica

- Usar h1-h6 en orden correcto
- Landmarks: header, nav, main, footer
- Labels asociados a inputs (`for` / `id`)

## Navegación por teclado (WEB)

- Orden lógico de tabulación
- Saltar a contenido principal
- Menús navegables con teclado

## Lectores de pantalla

- Etiquetas accesibles para iconos (`aria-label`)
- Estados anunciados (cargando, error, éxito)
- Estados vacíos descriptivos

## Escalado de texto

- No usar unidades fijas que impidan escalado
- `rem` o `em` para tamaños relativos

## Reducción de movimiento

- Respetar `prefers-reduced-motion: reduce`
- Desactivar animaciones y transiciones cuando esté activo
- Duración de animación 0.01ms en modo reducido

## Mensajes de error

- Comprensibles, sin jerga técnica innecesaria
- Sugerir acción de recuperación
- Asociados al campo correspondiente (`aria-describedby`)

## Estados de carga

- No bloquear interacción innecesariamente
- Indicador visual claro
- Mensaje de estado (cargando, error, vacío)

---

*Versión 1.0.0 — 2026-10-24*
