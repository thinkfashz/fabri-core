# FORGE CORE STOCK · Paneles Cliente y Negocio

**Especificación de módulos, carpetas, endpoints y diseño independiente**
Versión 1 · 17 de noviembre de 2026 · repo `thinkfashz/fabri-core`

---

## 0. Qué se construye y qué no

Hoy conviven tres superficies:

| Superficie | Ruta actual | Para qué |
|---|---|---|
| PWA de compra rápida | `/app/` | mapa, escaneo, carrito y pedido en el teléfono |
| Páginas sueltas | `/producto.html`, `/carrito.html`, `/checkout.html`, `/seguir.html`, `/verificar.html` | enlaces directos y compartir |
| Panel del dueño embebido | `/app/` → pestaña «Panel» (`negocio.js`) | resumen, pedidos, catálogo, reseñas y ajustes |

Esta especificación agrega **dos paneles profesionales independientes**, sin romper lo anterior:

- **Cliente:** `/panel/cliente/` — portal de compra con barra lateral, historial, favoritos, direcciones y reseñas.
- **Negocio:** `/panel/negocio/` — panel de administración con barra lateral, operación, catálogo, reportes y configuración.

La PWA `/app/` sigue existiendo para la compra en movimiento; los paneles enlazan a ella para mapa y visor 3D. Los endpoints son los mismos: no se duplica la lógica.

### Regla de independencia

Cada módulo es una página completa, con su propio HTML, CSS y JS:

```text
web/panel/
  comun/                 # solo tokens, shell, sesión, API y formato
  cliente/
    inicio/index.html + inicio.css + inicio.js
    mapa/index.html + mapa.css + mapa.js
    ...
  negocio/
    resumen/index.html + resumen.css + resumen.js
    ...
```

- Ningún módulo importa el CSS de otro.
- El shell aporta navegación, topbar y tokens; **no impone layout de contenido**.
- Navegación por enlaces reales (`<a href>`), no SPA. View Transitions es opcional.
- Cada página define su `data-layout` (`mapa`, `ficha`, `tabla`, `kanban`, `editor`, `timeline`, `galeria`, `formulario`, `lista`) y su acento secundario.
- Los estados vacío, cargando y error son parte de la página, no un modal genérico.

### Leyenda de endpoints

| Marca | Significado |
|---|---|
| ✅ | Ya existe en `api-telefono/api/mercado.ts` o `auth.ts` |
| 🟡 | Propuesto: se agrega como acción en `mercado.ts`/`auth.ts` (máx. 12 funciones en `api/`) |
| 🧩 | Requiere tabla o columna nueva, creada en `asegurar` con `IF NOT EXISTS` |

Los endpoints nuevos **no crean archivos en `api-telefono/api/`**: se despachan dentro de `mercado.ts` o `auth.ts`. La lógica pesada va en helpers `_mercado_*.js`, que no cuentan como funciones del API.

---

## 1. Sistema de diseño del shell

Base: `web/components.css` (tokens `--ds-*`). El panel **no inventa una paleta nueva**.

### 1.1 Barra lateral translúcida al 60 %

```css
/* web/panel/comun/shell.css */
:root {
  --panel-glass: rgba(8, 9, 10, 0.60);        /* 60 % exacto */
  --panel-glass-strong: rgba(8, 9, 10, 0.78);
  --panel-blur: 18px;
  --panel-nav-w: 264px;
  --panel-topbar-h: 64px;
  --panel-line: rgba(255, 255, 255, 0.09);
  --panel-line-accent: rgba(200, 245, 66, 0.22);
}

.sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 40;
  width: var(--panel-nav-w);
  display: flex;
  flex-direction: column;
  padding: 18px 14px calc(18px + env(safe-area-inset-bottom));
  background: var(--panel-glass);
  -webkit-backdrop-filter: blur(var(--panel-blur)) saturate(140%);
  backdrop-filter: blur(var(--panel-blur)) saturate(140%);
  border-right: 1px solid var(--panel-line);
}

/* Sin backdrop-filter (navegadores viejos): fondo casi opaco, no texto ilegible. */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .sidebar { background: var(--panel-glass-strong); }
}

.sidebar::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(200, 245, 66, 0.055), transparent 34%);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 44px;
  padding: 0 12px;
  border-radius: 12px;
  color: var(--ds-text-secondary);
  font-size: var(--ds-text-sm);
  text-decoration: none;
  transition: background 160ms ease, color 160ms ease, transform 160ms ease;
}

.nav-item:hover { background: rgba(255, 255, 255, 0.05); color: var(--ds-text-primary); }

.nav-item[aria-current="page"] {
  position: relative;
  color: var(--ds-text-primary);
  background: rgba(200, 245, 66, 0.10);
  box-shadow: inset 0 0 0 1px var(--panel-line-accent);
}

.nav-item[aria-current="page"]::before {
  content: "";
  position: absolute;
  left: -14px;
  top: 10px;
  bottom: 10px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--ds-accent);
}

.nav-seccion {
  margin: 18px 12px 6px;
  font-size: 10.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ds-text-tertiary);
}

/* Móvil: cajón, mismo 60 % sobre el contenido. */
@media (max-width: 900px) {
  .sidebar {
    width: min(84vw, 320px);
    transform: translateX(-102%);
    transition: transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
    background: var(--panel-glass);
  }
  .sidebar[data-abierta="true"] { transform: none; }
  .shell-backdrop {
    position: fixed; inset: 0; z-index: 35;
    background: rgba(0, 0, 0, 0.45);
  }
}

@media (prefers-reduced-motion: reduce) {
  .sidebar, .nav-item { transition: none; }
}
```

### 1.2 Reglas del shell

| Pieza | Regla |
|---|---|
| Ancho | 264 px en escritorio; cajón de `min(84vw, 320px)` en móvil |
| Fondo | `rgba(8,9,10,.60)` + `blur(18px)` + `saturate(140%)` |
| Borde | 1 px `rgba(255,255,255,.09)`; activo con lima al 22 % |
| Altura de ítem | 44 px mínimo táctil; icono 20 px, trazo 1.8 |
| Secciones | «Descubrir», «Mi compra», «Mi cuenta» (cliente); «Operación», «Catálogo», «Mi negocio», «Crecimiento», «Configuración» (negocio) |
| Foco | `outline: 2px solid var(--ds-accent); outline-offset: 2px` |
| Teclado | `Esc` cierra el cajón; foco atrapado dentro; primer enlace recibe foco al abrir |
| Topbar | 64 px, sticky, `rgba(8,9,10,.78)` + blur; hamburguesa solo en móvil |
| Contenido | máx. 1240 px; 32 px de padding en escritorio, 16 px en móvil |
| Movimiento | 160–280 ms; nunca animar `width`/`height`; respetar `prefers-reduced-motion` |

### 1.3 Estructura HTML común

```html
<!doctype html>
<html lang="es-CL" data-panel="cliente">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#08090A">
  <title>Inicio · FORGE CORE STOCK</title>
  <link rel="stylesheet" href="/components.css">
  <link rel="stylesheet" href="/panel/comun/shell.css">
  <link rel="stylesheet" href="./inicio.css">
</head>
<body data-modulo="inicio" data-layout="editorial">
  <a class="skip" href="#contenido">Saltar al contenido</a>
  <aside class="sidebar" id="sidebar" aria-label="Navegación del cliente"></aside>
  <div class="shell-backdrop" hidden data-cerrar-sidebar></div>
  <header class="topbar">…</header>
  <main id="contenido" class="page">…</main>
  <script type="module" src="/panel/comun/shell.js"></script>
  <script type="module" src="./inicio.js"></script>
</body>
</html>
```

`shell.js` lee `data-panel`, pinta la navegación desde `nav-cliente.js` o `nav-negocio.js`, resuelve la sesión con `sesion.js` y marca `aria-current="page"` comparando la ruta. No pinta contenido.

### 1.4 Dos densidades, una marca

| | Cliente | Negocio |
|---|---|---|
| Tono | editorial, cálido, fotográfico | operativo, denso, numérico |
| Radio | 18–24 px | 10–14 px |
| Tipografía | titular condensado + cuerpo 15 px | cuerpo 14 px + cifras mono |
| Fondo de contenido | `--ds-bg-app` con textura suave | `--ds-bg-app` plano |
| Datos | precio grande, una acción por pantalla | tablas, filtros y acciones en línea |
| Acento | lima para precio/acción | lima solo para el dato protagonista y el estado activo |

### 1.5 Nube, dominios y autenticación real

Los paneles **no llevan servidor propio**: son HTML, CSS y JS estáticos que se publican en el mismo proyecto de Vercel que la web. La sesión y los datos viven en InsForge.

| Pieza | Dónde vive | Qué hace |
|---|---|---|
| Paneles | Vercel · proyecto `web` → `https://forge-core-stock.vercel.app/panel/cliente/…` y `/panel/negocio/…` | sirve las 31 páginas estáticas |
| API | Vercel · proyecto `api-telefono` → `https://fabri-api.vercel.app/api/…` | auth, mercado, inventario, catálogo |
| Base | **InsForge · PostgreSQL** | `core_usuarios`, `core_sesiones`, `mercado_*`, `inv_productos` |

Comprobado el 18-11-2026: `GET https://fabri-api.vercel.app/api/auth?diag=1` responde `nube: "insforge"`, `base_configurada: true`, las tres tablas presentes y el último latido en 327 ms. `GET /api/health` confirma `INSFORGE_DATABASE_URL` y `FABRI_API_TOKEN` enlazados.

#### Trampa que hay que respetar

```text
https://forge-core-stock.vercel.app/api/auth   → auth vieja (Go + Vercel Blob), SIN configurar
https://fabri-api.vercel.app/api/auth          → auth real (InsForge Postgres)
```

La primera responde `{"ok":false,"cloud":"unconfigured"}`. Por eso `web/panel/comun/api.js` **siempre** usa la base absoluta:

```js
export const API_BASE = 'https://fabri-api.vercel.app';
export const AUTH_URL = `${API_BASE}/api/auth`;
```

Un `fetch('/api/auth')` relativo desde el panel pega en la auth muerta y el login falla sin explicación. No usar rutas relativas para la API en ninguna página.

#### Contrato de sesión

| Acción | Método | Cuerpo / cabecera | Devuelve |
|---|---|---|---|
| `asegurar` | POST | `{ accion: "asegurar" }` | crea tablas si faltan |
| `registrar` | POST | `email`, `nombre`, `pass`, `acepta_terminos`, `dispositivo`, `codigo?` | `{ token, usuario }` |
| `entrar` | POST | `email`, `pass`, `dispositivo` | `{ token, usuario }` |
| `sesion` | POST | `Authorization: Bearer <token>` | usuario vigente |
| `salir` | POST | Bearer | revoca el token |
| `aceptar_terminos` | POST | Bearer | versión vigente aceptada |
| `borrar` | POST | `email`, `pass` | baja de la propia cuenta |
| `usuarios` | POST | `x-admin` (`FABRI_API_TOKEN`) | lista de cuentas |

- Hash: PBKDF2-HMAC-SHA256, 120.000 iteraciones, sal única por cuenta.
- Token: aleatorio; en la base sólo queda su SHA-256, atado al dispositivo (`sha256(dispositivo | usuario_id | token_hash)`). Copiar el token a otro equipo no sirve.
- Rol: `owner` para la primera cuenta o `CORE_ROOT_EMAIL`; el resto `member`. El rol **no** da permiso sobre un local: eso lo decide `dueno_id` en `mercado_locales`.
- Tope: 200 cuentas (`CORE_MAX_CUENTAS`). Registro abierto si `CORE_INVITE` está vacío.

#### Lo que comparten los paneles con `/app/`

`sesion.js` reutiliza **las mismas claves** que `core-nube.js`, para que entrar en la PWA valga en el panel y viceversa:

| Clave | Contenido |
|---|---|
| `fcore.nube` | `{ token, usuario, ts }` |
| `fcore.dispositivo` | id aleatorio del navegador |

Guardia por panel:

- **Cliente:** navega como invitado. Si hay token, C09/C10/C11/C12 leen la nube; si no, usan `localStorage` y muestran «entra para sincronizar».
- **Negocio:** sin token válido redirige a `/app/#cuenta` y vuelve a la misma página tras entrar (`?volver=`). Toda llamada manda `Authorization: Bearer`.

#### Decisión: login propio sobre InsForge vs. Auth de InsForge

Hoy el login es **real y persistente en InsForge**, pero no usa el servicio *Auth* de la plataforma: `fabri-api` escribe en `core_usuarios`/`core_sesiones` con su propio hash y sus propias sesiones. Eso ya permite login entre dispositivos, roles, términos, bloqueo por intentos y listado de cuentas.

**Decisión del 18-11-2026: se migra al Auth de InsForge.** El plan completo está en [`docs/AUTH-INSFORGE-MIGRACION.md`](./AUTH-INSFORGE-MIGRACION.md).

La forma elegida es **BFF**: InsForge valida la contraseña y `fabri-api` sigue emitiendo la sesión de 30 días. Así el JWT de InsForge no entra a `mercado.ts`, `core_usuarios.id` sigue siendo la FK de `dueno_id` y `core-nube.js` no cambia. La migración es **perezosa**: cada cuenta pasa a InsForge en su primer login, sin reset masivo ni correos. Interruptor `AUTH_MODO` (`legacy` → `dual` → `insforge`) y `core_usuarios.pass_hash` se conserva como respaldo.

---

## 2. Mapa de rutas y carpetas

### 2.1 Compartido

| Ruta | Carpeta | Qué contiene |
|---|---|---|
| `/panel/comun/shell.css` | `web/panel/comun/` | tokens del shell, sidebar, topbar, page, skip, foco |
| `/panel/comun/shell.js` | `web/panel/comun/` | navegación, cajón móvil, sesión, `aria-current` |
| `/panel/comun/nav-cliente.js` | `web/panel/comun/` | manifiesto de navegación del cliente |
| `/panel/comun/nav-negocio.js` | `web/panel/comun/` | manifiesto de navegación del negocio |
| `/panel/comun/api.js` | `web/panel/comun/` | `fetch` con Bearer, timeout, reintento y errores legibles |
| `/panel/comun/sesion.js` | `web/panel/comun/` | token, cuenta, guardia de ruta, cierre de sesión |
| `/panel/comun/formato.js` | `web/panel/comun/` | CLP, fechas, teléfono, estados, badges |

### 2.2 Cliente

| # | Módulo | Ruta | Carpeta | Endpoint principal | Fase |
|---|---|---|---|---|---|
| C01 | Inicio | `/panel/cliente/inicio/` | `web/panel/cliente/inicio/` | `locales`, `productos_buscar` ✅ | 1 |
| C02 | Mapa | `/panel/cliente/mapa/` | `web/panel/cliente/mapa/` | `locales` ✅ | 2 |
| C03 | Buscar | `/panel/cliente/buscar/` | `web/panel/cliente/buscar/` | `productos_buscar` ✅ | 1 |
| C04 | Tienda | `/panel/cliente/tienda/?id=` | `web/panel/cliente/tienda/` | `local_ver` ✅ | 1 |
| C05 | Producto | `/panel/cliente/producto/?local=&sku=` | `web/panel/cliente/producto/` | `local_ver` ✅ / `producto_ver` 🟡 | 1 |
| C06 | Carrito | `/panel/cliente/carrito/` | `web/panel/cliente/carrito/` | `local_ver` ✅ + localStorage | 1 |
| C07 | Checkout | `/panel/cliente/checkout/` | `web/panel/cliente/checkout/` | `pedido_crear` ✅ | 1 |
| C08 | Pedido | `/panel/cliente/pedido/?token=` | `web/panel/cliente/pedido/` | `pedido_seguir` ✅ | 1 |
| C09 | Mis pedidos | `/panel/cliente/pedidos/` | `web/panel/cliente/pedidos/` | `mis_pedidos` ✅ | 2 |
| C10 | Favoritos | `/panel/cliente/favoritos/` | `web/panel/cliente/favoritos/` | `favoritos_listar` ✅ | 2 |
| C11 | Direcciones | `/panel/cliente/direcciones/` | `web/panel/cliente/direcciones/` | `direcciones_listar` ✅ | 2 |
| C12 | Reseñas | `/panel/cliente/resenas/` | `web/panel/cliente/resenas/` | `resenas_mias`, `resena_crear` ✅ | 2 |
| C13 | Cuenta | `/panel/cliente/cuenta/` | `web/panel/cliente/cuenta/` | `auth` ✅ + resumen de 4 acciones ✅ | 2 |
| C14 | Ayuda | `/panel/cliente/ayuda/` | `web/panel/cliente/ayuda/` | sin endpoint | 1 |

### 2.3 Negocio

| # | Módulo | Ruta | Carpeta | Endpoint principal | Fase | Estado |
|---|---|---|---|---|---|---|
| N01 | Resumen | `/panel/negocio/resumen/` | `web/panel/negocio/resumen/` | `ventas_serie`, `pedidos_listar` ✅ | 2 | ✅ desplegado |
| N02 | Pedidos | `/panel/negocio/pedidos/` | `web/panel/negocio/pedidos/` | `pedidos_listar`, `pedido_estado` ✅ | 2 | ✅ desplegado |
| N03 | Productos | `/panel/negocio/productos/` | `web/panel/negocio/productos/` | `local_mio`, `productos_subir`, `producto_borrar` ✅ | 2 | ✅ desplegado |
| N04 | Inventario | `/panel/negocio/inventario/` | `web/panel/negocio/inventario/` | `productos_subir` ✅ | 2 | ✅ desplegado |
| N05 | Ofertas | `/panel/negocio/ofertas/` | `web/panel/negocio/ofertas/` | `productos_subir` ✅ | 3 | 🟡 pendiente |
| N06 | Mi tienda | `/panel/negocio/tienda/` | `web/panel/negocio/tienda/` | `local_actualizar`, `local_estado` ✅ | 2 | ✅ desplegado |
| N07 | Horarios y entrega | `/panel/negocio/horarios/` | `web/panel/negocio/horarios/` | `local_actualizar` ✅ | 2 | ✅ desplegado |
| N08 | Reseñas | `/panel/negocio/resenas/` | `web/panel/negocio/resenas/` | `resenas_panel`, `resena_moderar` ✅ | 2 | ✅ desplegado |
| N09 | Clientes | `/panel/negocio/clientes/` | `web/panel/negocio/clientes/` | `clientes_listar` 🟡 | 3 | 🟡 pendiente |
| N10 | Reportes | `/panel/negocio/reportes/` | `web/panel/negocio/reportes/` | `ventas_serie` ✅ / `reportes_exportar` 🟡 | 3 | 🟡 pendiente |
| N11 | Cupones | `/panel/negocio/cupones/` | `web/panel/negocio/cupones/` | `cupones_*` 🟡🧩 | 3 | 🟡 pendiente |
| N12 | Pagos | `/panel/negocio/pagos/` | `web/panel/negocio/pagos/` | `pagos_config`, `liquidaciones_listar` 🟡🧩 | 3 | 🟡 pendiente |
| N13 | Equipo | `/panel/negocio/equipo/` | `web/panel/negocio/equipo/` | `equipo_*` 🟡🧩 | 4 | 🟡 pendiente |
| N14 | Notificaciones | `/panel/negocio/notificaciones/` | `web/panel/negocio/notificaciones/` | `push_local_suscribir`, `push_local_baja` ✅ | 2 | ✅ desplegado |
| N15 | Auditoría | `/panel/negocio/auditoria/` | `web/panel/negocio/auditoria/` | `auditoria_listar` 🟡🧩 | 4 | 🟡 pendiente |
| N16 | Ajustes | `/panel/negocio/ajustes/` | `web/panel/negocio/ajustes/` | `local_actualizar`, `local_borrar` ✅ | 2 | ✅ desplegado |
| N17 | Integraciones | `/panel/negocio/integraciones/` | `web/panel/negocio/integraciones/` | `integraciones_*` 🟡🧩 | 4 | 🟡 pendiente |

---

## 3. Panel Cliente · módulos

### C01 · Inicio

- **Carpeta:** `web/panel/cliente/inicio/` · **Ruta:** `/panel/cliente/inicio/`
- **Objetivo:** que el comprador vea en 5 segundos qué hay cerca, qué está en oferta y cómo sigue su último pedido.
- **Conexión:** `GET /api/mercado?accion=locales&con_catalogo=0&lat=&lon=` ✅ + `GET /api/mercado?accion=productos_buscar&precio_max=` ✅ para ofertas. Token de `/api/auth` solo para el saludo y el pedido activo.
- **Endpoint:** `locales` y `productos_buscar` (lectura pública, sin Bearer).
- **Uso:** 1) el navegador pide ubicación; 2) se pintan tiendas a menos de 3 km; 3) el bloque «Sigue tu pedido» lee `fcore.placer.pedidos` y muestra el más reciente con enlace a C08; 4) las ofertas llevan a C05.
- **Diseño propio:** hero editorial a dos columnas en escritorio (titular + foto de mercado), riel horizontal de tiendas con logo y distancia, una tarjeta ancha de pedido activo, grilla de ofertas de 3 columnas. Sin KPI ni tablas.
- **Estados:** sin ubicación (banner con «usar Santiago centro»), sin tiendas, sin ofertas, offline con último JSON.
- **Fase:** 1.

### C02 · Mapa

- **Carpeta:** `web/panel/cliente/mapa/` · **Ruta:** `/panel/cliente/mapa/`
- **Objetivo:** explorar el mapa global de tiendas, ver la ubicación propia y entrar a una marca.
- **Conexión:** `GET /api/mercado?accion=locales&con_catalogo=0` ✅.
- **Endpoint:** `locales`.
- **Uso:** 1) mapa a pantalla completa; 2) filtros por rubro, texto y radio; 3) ubicación propia con precisión GPS y radio dibujado; 4) clic en pin → tarjeta inferior con logo, horario, mínimo y envío; 5) «Ver tienda» → C04.
- **Diseño propio:** mapa full-bleed con Leaflet **local** (`/app/vendor/leaflet.js`), teselas OSM oscurecidas por CSS, buscador flotante arriba y hoja inferior con riel de tiendas. La ubicación propia se pinta en un **canvas** sobre las teselas: punto, halo pulsante solo con GPS de ahora, círculo de precisión real y radio de búsqueda punteado. `maxZoom: 20` sobre teselas nativas 19 para poder acercarse hasta ~0,12 m/px.
- **Estados:** permiso denegado (no se pinta Santiago como si fuera propio), teselas caídas (aviso y enlaces), sin tiendas en el radio, ubicación cacheada marcada «Guardada recién/hace N h» sin fingir GPS vivo.
- **Fase:** 2.

### C03 · Buscar

- **Carpeta:** `web/panel/cliente/buscar/` · **Ruta:** `/panel/cliente/buscar/?q=`
- **Objetivo:** encontrar un producto en todas las marcas y comparar precio y distancia.
- **Conexión:** `GET /api/mercado?accion=productos_buscar&q=&categoria=&precio_max=&lat=&lon=&orden=&limite=` ✅.
- **Endpoint:** `productos_buscar`.
- **Uso:** 1) escribe 2+ letras o elige categoría/precio; 2) filtra por tienda abierta; 3) ordena por cercanía, precio o nombre; 4) abre C05 o C04.
- **Diseño propio:** cabecera de búsqueda sticky con input grande, chips de categoría y un riel de filtros; resultados en filas comparativas (foto 56 px, nombre, tienda, precio, km, estado «cerrada»), no grilla de tarjetas.
- **Estados:** menos de 2 letras, sin resultados, base caída (`SIN_BASE`), tienda cerrada marcada pero visible.
- **Fase:** 1.

### C04 · Tienda

- **Carpeta:** `web/panel/cliente/tienda/` · **Ruta:** `/panel/cliente/tienda/?id=`
- **Objetivo:** abrir el link único de una marca y comprar su catálogo completo.
- **Conexión:** `GET /api/mercado?accion=local_ver&id=` ✅ (público, sin cuenta).
- **Endpoint:** `local_ver`.
- **Uso:** 1) portada con logo, marca, descripción, horario y calificación; 2) catálogo por categorías; 3) agregar al carrito de esa marca; 4) compartir el link/QR.
- **Diseño propio:** portada de marca a sangre con logo centrado, ficha de confianza (abierto, mínimo, envío, retiro), catálogo en lista densa con categorías pegajosas y barra inferior de carrito. Nada de hero genérico.
- **Estados:** tienda cerrada (catálogo visible, compra bloqueada), sin catálogo, link inválido.
- **Fase:** 1.

### C05 · Producto

- **Carpeta:** `web/panel/cliente/producto/` · **Ruta:** `/panel/cliente/producto/?local=&sku=`
- **Objetivo:** decidir la compra con foto, precio efectivo, stock, retiro/envío y comparación entre marcas.
- **Conexión:** `GET /api/mercado?accion=local_ver&id=` ✅ y filtro por SKU; para deep links estables se propone `producto_ver` 🟡 (mismo dato, una sola tienda + producto).
- **Endpoint:** `local_ver` ✅ / `producto_ver` 🟡.
- **Uso:** 1) foto y nombre; 2) precio con descuento y vigencia; 3) elegir cantidad; 4) agregar al carrito o ver «también en» otras marcas; 5) volver a C04.
- **Diseño propio:** dos columnas 58/42 en escritorio (galería + caja de compra sticky), una columna en móvil; sello de oferta; comparativa de marcas en acordeón. Sin grilla de productos.
- **Estados:** SKU borrado, stock 0, oferta vencida, tienda cerrada.
- **Fase:** 1.

### C06 · Carrito

- **Carpeta:** `web/panel/cliente/carrito/` · **Ruta:** `/panel/cliente/carrito/`
- **Objetivo:** revisar el pedido multi-marca, respetar mínimo y envío de cada tienda y avanzar al pago.
- **Conexión:** `GET /api/mercado?accion=local_ver&id=` ✅ por cada tienda del carrito (revalidar precio, stock, mínimo y estado); carrito en `localStorage` (`fcore.placer.carrito`).
- **Endpoint:** `local_ver` (una llamada por tienda, en paralelo, máx. 4).
- **Uso:** 1) ve el carrito agrupado por marca; 2) ajusta cantidades; 3) corrige líneas cuyo precio cambió; 4) «Continuar» solo si cada grupo cumple su mínimo.
- **Diseño propio:** lista agrupada por tienda con subtotal por grupo; resumen sticky a la derecha en escritorio y barra inferior en móvil; alerta ámbar por precio cambiado o mínimo faltante. Sin tarjetas por producto.
- **Estados:** vacío (CTA al mapa), tienda cerrada, producto agotado, precio actualizado.
- **Fase:** 1.

### C07 · Checkout

- **Carpeta:** `web/panel/cliente/checkout/` · **Ruta:** `/panel/cliente/checkout/`
- **Objetivo:** cerrar el pedido con datos, entrega y pago, sin cobrar dos veces ni confiar en el precio del navegador.
- **Conexión:** `POST /api/mercado { accion: "pedido_crear" }` ✅ con `idempotencia`, `items`, `cliente`, `telefono`, `entrega`, dirección, `metodo_pago` (`efectivo`, `transferencia`, `tarjeta`), `pago_con`, `nota`.
- **Endpoint:** `pedido_crear`.
- **Uso:** 1) confirma contacto; 2) elige retiro o delivery; 3) elige medio de pago (tarjeta es demo); 4) revisa total, envío y ahorro; 5) confirma; 6) guarda `seguimiento` y va a C08.
- **Diseño propio:** formulario por pasos a la izquierda y resumen sticky a la derecha; pasos numerados, no pestañas; estado de éxito con código y botón «seguir». Si hay varias marcas, un bloque de checkout por tienda y un resumen global.
- **Estados:** mínimo no alcanzado, local cerrado (`CERRADO`), efectivo insuficiente (`PAGO_CORTO`), doble toque (idempotencia devuelve el mismo pedido).
- **Fase:** 1.

### C08 · Pedido

- **Carpeta:** `web/panel/cliente/pedido/` · **Ruta:** `/panel/cliente/pedido/?token=` o `?codigo=&contacto=`
- **Objetivo:** saber exactamente en qué va el pedido y avisar al comprador.
- **Conexión:** `POST /api/mercado { accion: "pedido_seguir", token }` ✅ o `{ codigo, contacto }`; `push_suscribir`/`push_baja` ✅.
- **Endpoint:** `pedido_seguir`, `push_suscribir`, `push_baja`.
- **Uso:** 1) línea de tiempo `nuevo → visto → listo → entregado`; 2) datos de retiro o dirección; 3) clave de entrega si existe; 4) activar avisos; 5) calificar cuando esté entregado (C12).
- **Diseño propio:** línea de tiempo vertical con nodos y hora, bloque de código grande, mapa mini si es delivery, botón de ayuda; sin tablas.
- **Estados:** token inválido, pedido cancelado, sin red (último estado guardado).
- **Fase:** 1.

### C09 · Mis pedidos

- **Carpeta:** `web/panel/cliente/pedidos/` · **Ruta:** `/panel/cliente/pedidos/`
- **Objetivo:** ver el historial completo entre dispositivos, no solo el de este teléfono.
- **Conexión:** `POST /api/mercado { accion: "mis_pedidos" }` ✅ con Bearer; `mercado_pedidos.cliente_id` ✅. Sin sesión se usa `fcore.placer.pedidos` y cada pedido se abre con su enlace (`pedido_seguir`).
- **Endpoint:** `mis_pedidos` ✅ (con respaldo local honesto).
- **Uso:** 1) lista por estado y por mes; 2) busca por código o tienda; 3) abre C08; 4) «volver a pedir» reconstruye el carrito con precios actuales.
- **Diseño propio:** lista cronológica con separadores por mes, chips de estado y miniatura de tienda; en escritorio, dos paneles (lista + detalle). Sin tarjetas KPI.
- **Estados:** sin sesión (invita a entrar), sin pedidos, pedidos solo locales (aviso).
- **Fase:** 2.

### C10 · Favoritos

- **Carpeta:** `web/panel/cliente/favoritos/` · **Ruta:** `/panel/cliente/favoritos/`
- **Objetivo:** guardar productos y marcas para volver sin buscar de nuevo.
- **Conexión:** `favoritos_listar` / `favorito_alternar` ✅ (tabla `mercado_favoritos` ✅); espejo local en `fcore.panel.favoritos`.
- **Endpoint:** `favoritos_listar`, `favorito_alternar` ✅.
- **Uso:** 1) corazón en C04/C05; 2) pestañas Productos / Tiendas; 3) aviso de baja de precio si el producto sigue existiendo; 4) abrir C05.
- **Diseño propio:** dos columnas: lista de favoritos y panel de «cambios de precio»; en móvil, segmentos. Fotos pequeñas, precios alineados a la derecha.
- **Estados:** vacío con CTA a buscar; producto eliminado (se marca, no se rompe).
- **Fase:** 2.

### C11 · Direcciones

- **Carpeta:** `web/panel/cliente/direcciones/` · `Ruta:` `/panel/cliente/direcciones/`
- **Objetivo:** guardar direcciones con comuna, referencia y punto en el mapa para no reescribirlas en cada checkout.
- **Conexión:** `direcciones_listar`, `direccion_guardar`, `direccion_borrar` ✅ (tabla `mercado_direcciones` ✅); espejo local en `fcore.panel.direcciones`.
- **Endpoint:** `direcciones_*` ✅.
- **Uso:** 1) nueva dirección; 2) escribir calle y mover el pin (sin geocodificación inventada); 3) alias («casa», «trabajo»); 4) marcar predeterminada; 5) el checkout la ofrece.
- **Diseño propio:** formulario a la izquierda y mapa/pin a la derecha; tarjetas de dirección con alias grande; en móvil, pasos. Sin tabla.
- **Estados:** sin direcciones, sin pin (lat/lon en 0), sin red (espejo local), tope de 20.
- **Fase:** 2.

### C12 · Reseñas

- **Carpeta:** `web/panel/cliente/resenas/` · **Ruta:** `/panel/cliente/resenas/`
- **Objetivo:** calificar pedidos entregados y ver el historial de lo que el comprador opinó.
- **Conexión:** `resenas_listar` ✅ (público por tienda), `resena_crear` ✅ (prueba de compra con token o código + últimos 4), `resenas_mias` ✅ (`mercado_resenas.usuario_id` ✅).
- **Endpoint:** `resenas_listar`, `resena_crear`, `resenas_mias` ✅.
- **Uso:** 1) pedidos pendientes de calificar; 2) estrellas y texto; 3) enviar; 4) ver la reseña publicada y la respuesta del local (cuando exista).
- **Diseño propio:** bandeja de «pendientes» arriba con foto de tienda y estrellas grandes; abajo, historial en lista. Sin formularios largos.
- **Estados:** sin pedidos entregados, ya calificado, error de red.
- **Fase:** 2.

### C13 · Cuenta

- **Carpeta:** `web/panel/cliente/cuenta/` · **Ruta:** `/panel/cliente/cuenta/`
- **Objetivo:** una sola página para identidad, seguridad, sesión y lo que la cuenta tiene guardado en InsForge.
- **Conexión:** `POST /api/auth { accion: "sesion" }` ✅, `salir` ✅, `borrar` ✅; resumen con `mis_pedidos`, `favoritos_listar`, `direcciones_listar` y `resenas_mias` ✅. `perfil_actualizar` y `pass_cambiar` siguen 🟡: el cambio de clave se hace por el flujo de recuperación.
- **Endpoint:** `auth` (`sesion`, `salir`, `borrar`) + las cuatro acciones privadas de `mercado` para el resumen.
- **Uso:** 1) entrar, crear cuenta o recuperar la clave; 2) ver el resumen real de pedidos, favoritos, direcciones y reseñas en la nube; 3) cambiar la contraseña; 4) revisar la sesión; 5) cerrar sesión; 6) eliminar la cuenta con confirmación.
- **Diseño propio:** ficha de identidad con inicial grande, bloque «En la nube» con cuatro contadores enlazados a sus módulos, secciones apiladas y zona de peligro separada al final; no es un dashboard.
- **Estados:** sin sesión (login embebido), token vencido, error de contraseña, nube sin respuesta con reintento; nunca se muestran datos locales como si fueran de la cuenta.
- **Fase:** 2.

### C14 · Ayuda

- **Carpeta:** `web/panel/cliente/ayuda/` · **Ruta:** `/panel/cliente/ayuda/`
- **Objetivo:** resolver dudas sin salir del panel y dar salida a un reclamo.
- **Conexión:** sin endpoint; enlaces a `terminos.html`, estado del API (`GET /api/health`) y WhatsApp de la tienda.
- **Endpoint:** ninguno.
- **Uso:** 1) busca en preguntas frecuentes; 2) abre el tema; 3) si no resuelve, botón de contacto; 4) enlace a términos.
- **Diseño propio:** buscador grande, acordeón por tema y tarjeta de contacto; una columna legible de 68ch, sin sidebar de contenido.
- **Estados:** sin resultados, sin conexión.
- **Fase:** 1.

---

## 4. Panel Negocio · módulos

### N01 · Resumen

- **Carpeta:** `web/panel/negocio/resumen/` · **Ruta:** `/panel/negocio/resumen/`
- **Objetivo:** decidir el día en 10 segundos: ventas, pedidos abiertos, stock bajo y calificación.
- **Conexión:** `POST /api/mercado { accion: "ventas_serie", local_id, clave?, dias }` ✅ devuelve serie, totales, top de productos, estados, reseñas y visitas; `local_mio` ✅ para el selector de tienda.
- **Endpoint:** `ventas_serie` (una sola llamada) + `local_mio`.
- **Uso:** 1) elige tienda si tiene varias; 2) elige 7/30/90 días; 3) clic en «pedidos abiertos» → N02; 4) clic en «stock bajo» → N04.
- **Diseño propio:** franja de 4 cifras, gráfico de área de ventas, cola de pedidos en vivo a la derecha, top 5 y stock crítico en dos columnas. Densidad de escritorio; en móvil, todo apilado.
- **Estados:** tienda sin ventas (serie plana), sin reseñas, base caída.
- **Fase:** 2 · **Estado: ✅ desplegado.** Pide `ventas_serie` y `pedidos_listar` en paralelo; si la cola falla, la serie se sigue mostrando y la cola ofrece reintento.

### N02 · Pedidos

- **Carpeta:** `web/panel/negocio/pedidos/` · **Ruta:** `/panel/negocio/pedidos/`
- **Objetivo:** operar la cola: ver, preparar, marcar listo y entregar sin perder ninguno.
- **Conexión:** `pedidos_listar` ✅ (`local_id`, `clave?`, `estado?`, `limite`), `pedido_estado` ✅ (`nuevo`, `visto`, `listo`, `entregado`, `cancelado`), `push_local_suscribir`/`push_local_baja` ✅.
- **Endpoint:** `pedidos_listar`, `pedido_estado`, `push_local_*`.
- **Uso:** 1) entra un pedido; 2) ábrelo; 3) imprime o prepara; 4) marca «listo»; 5) entrega con clave si corresponde; 6) el comprador recibe el aviso.
- **Diseño propio:** kanban de 4 columnas en escritorio (`nuevo`, `visto`, `listo`, `entregado`) con contador y tiempo; tabla compacta alternativa; detalle en panel lateral, no en modal. En móvil, lista por estado con acciones grandes.
- **Estados:** sin pedidos, pedido cancelado, sin permiso, push no soportado.
- **Fase:** 2 · **Estado: ✅ desplegado.** Detalle dentro de la tarjeta (sin modal); aviso de entrega con código cuando el pedido lo exige; avisos push del local con `push_local_suscribir`/`push_local_baja`.
- **Código de verificación:** el detalle muestra el código único del envío (`V-XXXX-XXXX`) con botón para copiarlo y enlace al recorrido 3D. El historial usa la hora real del evento (`ts`).

### V · Verificación de envío con recorrido 3D

- **Carpeta:** `web/verificar.html`, `web/verificar.css`, `web/verificar.js` · **Ruta:** `/verificar.html?v=V-XXXX-XXXX`
- **Objetivo:** comprobar el estado real de un pedido con su **código único** y ver el reparto (distribuidor → carretera → casa o local) en una escena 3D.
- **Conexión:** `pedido_seguir` con `{ accion, verificacion }` ✅ (público, sin cuenta). Devuelve `pedido.verificacion`, `estado`, `eventos` con su `ts` y los datos del local.
- **Código único:** lo genera `pedido_crear` (`codigoVerificacion()`, 1 letra + 8 caracteres sin confundibles) y se guarda en `mercado_pedidos.verificacion` con índice único. Los pedidos anteriores lo reciben la primera vez que se abren por token o por código + teléfono: no hace falta migración manual.
- **Escena:** Three.js (vendor del repo) con cámara ortográfica, carretera, distribuidor, casa con techo y ventanas, poste de luz, anillos de parada y un auto de reparto que **se estaciona en la parada del estado real** (`nuevo` → origen, `visto` → salida, `listo` → mitad de ruta, `entregado` → casa). No simula un avance que el local no marcó.
- **Estados:** sin WebGL o con el contexto perdido se muestra un aviso honesto y el detalle textual completo; sin red se conserva el último estado verificado con su hora; código inexistente responde 404 y no inventa pedido.
- **Accesibilidad:** respeta `prefers-reduced-motion` (el auto aparece en su parada, sin animación), pausa el render con la pestaña oculta y libera geometrías y materiales al salir.
- **Integración:** el código aparece en el seguimiento del comprador (`seguir.html`), en el detalle de N02 (copiar), en el alta de la PWA (`placer.js`) y en C12 para pedidos entregados.
- **Fase:** 2 (extensión) · **Estado: ✅ desplegado.** Verificado contra producción: alta devuelve el código, se abre por código y por token, un código inexistente da 404, y el estado intermedio se ve «En camino» con «En ruta» activo. La escena se probó con un Three.js simulado (posición del auto por estado); el render WebGL no se puede verificar en el headless de este teléfono (el GPU no soporta `OES_packed_depth_stencil`).

### N03 · Productos

- **Carpeta:** `web/panel/negocio/productos/` · **Ruta:** `/panel/negocio/productos/`
- **Objetivo:** mantener el catálogo real, con foto, precio, SKU y categoría.
- **Conexión:** `local_mio` ✅ (tienda + catálogo), `productos_subir` ✅ (upsert por lote), `producto_borrar` ✅, `imagen_ver` ✅.
- **Endpoint:** `local_mio`, `productos_subir`, `producto_borrar`, `imagen_ver`.
- **Uso:** 1) busca o filtra; 2) crea/edita en línea; 3) sube foto (máx. 200 KB, 640 px); 4) importa CSV/JSON; 5) borra con confirmación.
- **Diseño propio:** tabla de datos con columnas fijas (foto, nombre, SKU, categoría, precio, stock), edición en línea y barra de acciones masivas; importador en panel lateral. En móvil, cada fila es una tarjeta (precio, stock y acciones siempre visibles, sin scroll horizontal).
- **Estados:** catálogo vacío, SKU duplicado, foto muy pesada, límite de 3000 productos.
- **Fase:** 2 · **Estado: ✅ desplegado.** La foto se achica a 640 px y 200 KB antes de subir; la importación acepta CSV y JSON con sinónimos de encabezado.

### N04 · Inventario

- **Carpeta:** `web/panel/negocio/inventario/` · **Ruta:** `/panel/negocio/inventario/`
- **Objetivo:** evitar vender lo que no hay y detectar agotados antes de que duela.
- **Conexión:** `local_mio` ✅ (stock actual) + `productos_subir` ✅ (ajuste por SKU).
- **Endpoint:** `productos_subir` con `stock` (y `sku`) + `local_mio`.
- **Uso:** 1) ordena por stock ascendente; 2) ajusta +/− en línea; 3) escanea un código para encontrar el SKU; 4) guarda el lote.
- **Diseño propio:** matriz de stock con celdas editables, semáforo (0, 1–5, 6+) y filtros por categoría; en móvil, lista con steppers. Sin gráficos.
- **Estados:** stock nulo (sin control), agotado, sin cambios, error de guardado.
- **Fase:** 2 · **Estado: ✅ desplegado.** Los cambios se acumulan y se guardan en un lote; cada producto viaja completo para no borrar nombre, precio ni categoría.

### N05 · Ofertas

- **Carpeta:** `web/panel/negocio/ofertas/` · **Ruta:** `/panel/negocio/ofertas/`
- **Objetivo:** crear descuentos con vigencia y ver el precio final que pagará el comprador.
- **Conexión:** `productos_subir` ✅ con `descuento` (0–90) y `oferta_hasta` (unix s; 0 = sin vencimiento); `local_mio` ✅ para el catálogo.
- **Endpoint:** `productos_subir`.
- **Uso:** 1) selecciona productos; 2) define % y fecha; 3) previsualiza el precio tachado; 4) publica; 5) apaga la oferta cuando quieras.
- **Diseño propio:** constructor de campaña a la izquierda y vista previa de tarjetas a la derecha; calendario compacto; lista de ofertas activas con cuenta regresiva.
- **Estados:** descuento > 90 %, fecha pasada, producto sin precio, oferta vencida.
- **Fase:** 3.

### N06 · Mi tienda

- **Carpeta:** `web/panel/negocio/tienda/` · **Ruta:** `/panel/negocio/tienda/`
- **Objetivo:** editar la ficha pública y el link único de la marca.
- **Conexión:** `local_actualizar` ✅ (nombre, marca, logo, descripción, rubro, teléfono, dirección, comuna, lat/lon), `local_estado` ✅ (abierto/cerrado), `local_ver` ✅ (vista previa pública).
- **Endpoint:** `local_actualizar`, `local_estado`, `local_ver`.
- **Uso:** 1) edita identidad; 2) sube logo (120 KB, 192 px); 3) ajusta el pin; 4) abre/cierra; 5) copia el link o descarga el QR.
- **Diseño propio:** editor con vista previa en vivo de la ficha pública (como C04) al lado; formulario por bloques. Sin tabla.
- **Estados:** logo muy pesado, dirección sin geocodificar, tienda cerrada, link no disponible.
- **Fase:** 2 · **Estado: ✅ desplegado.** El pin se mueve con coordenadas válidas en Chile o con el GPS del teléfono; el logo se achica a 192 px y 120 KB. Abrir/cerrar usa `local_estado` y actualiza el chip sin borrar lo que el dueño está escribiendo.

### N07 · Horarios y entrega

- **Carpeta:** `web/panel/negocio/horarios/` · **Ruta:** `/panel/negocio/horarios/`
- **Objetivo:** decir cuándo está abierto, cuánto es el mínimo y cómo entrega.
- **Conexión:** `local_actualizar` ✅ con `horario`, `minimo`, `envio`, `entrega` (`retiro`, `delivery`).
- **Endpoint:** `local_actualizar`.
- **Uso:** 1) pinta la semana; 2) agrega excepciones (feriado); 3) define mínimo y costo de envío; 4) activa retiro y/o delivery; 5) guarda.
- **Diseño propio:** grilla semanal de 7 columnas con franjas horarias, editor de excepciones debajo y una tarjeta de resumen «hoy abierto 09:00–20:00». Sin formularios largos.
- **Estados:** cruce de horarios, día cerrado, envío sin cobertura.
- **Fase:** 2.

### N08 · Reseñas

- **Carpeta:** `web/panel/negocio/resenas/` · **Ruta:** `/panel/negocio/resenas/`
- **Objetivo:** leer la voz del cliente y moderar lo que no corresponde.
- **Conexión:** `resenas_panel` ✅ (todas, incluidas ocultas), `resena_moderar` ✅ (ocultar/mostrar).
- **Endpoint:** `resenas_panel`, `resena_moderar`.
- **Uso:** 1) ve promedio y distribución; 2) filtra por estrellas; 3) oculta una reseña con motivo; 4) vuelve a mostrarla.
- **Diseño propio:** resumen de distribución a la izquierda y bandeja de reseñas a la derecha; cada reseña con estrellas, autor abreviado y pedido; acciones discretas.
- **Estados:** sin reseñas, todas ocultas, sin permiso.
- **Fase:** 2.

### N09 · Clientes

- **Carpeta:** `web/panel/negocio/clientes/` · **Ruta:** `/panel/negocio/clientes/`
- **Objetivo:** conocer a quién le vendes y detectar clientes recurrentes.
- **Conexión:** `clientes_listar` 🟡 (agrega pedidos por teléfono/email; sin exponer datos completos); `pedidos_listar` ✅ como respaldo.
- **Endpoint:** `clientes_listar` 🟡.
- **Uso:** 1) busca por nombre o teléfono; 2) ordena por última compra o total; 3) abre el historial; 4) exporta la lista si eres dueño.
- **Diseño propio:** tabla con cliente, pedidos, total, última compra y etiqueta «recurrente»; sin tarjetas. Datos personales enmascarados salvo el teléfono que el cliente dejó para el pedido.
- **Estados:** sin clientes, sin permiso, pedidos viejos sin contacto.
- **Fase:** 3.

### N10 · Reportes

- **Carpeta:** `web/panel/negocio/reportes/` · **Ruta:** `/panel/negocio/reportes/`
- **Objetivo:** entender qué se vende, cuándo y por qué canal.
- **Conexión:** `ventas_serie` ✅ (serie, top, estados, visitas); `reportes_exportar` 🟡 para CSV completo.
- **Endpoint:** `ventas_serie` ✅ / `reportes_exportar` 🟡.
- **Uso:** 1) elige rango; 2) compara ventas y pedidos; 3) revisa top 8; 4) exporta CSV; 5) vuelve al resumen.
- **Diseño propio:** gráfico grande de área, tabla de top productos y embudo de estados; filtros en una barra superior. Sin KPI repetidos.
- **Estados:** rango sin datos, visitas no disponibles (`alcance: app`), exportación vacía.
- **Fase:** 3.

### N11 · Cupones

- **Carpeta:** `web/panel/negocio/cupones/` · **Ruta:** `/panel/negocio/cupones/`
- **Objetivo:** crear códigos con monto o porcentaje, mínimo y vigencia, y medir su uso.
- **Conexión:** `cupones_listar`, `cupon_crear`, `cupon_editar`, `cupon_borrar` 🟡🧩 (tabla `mercado_cupones`); `cupon_validar` 🟡 en checkout.
- **Endpoint:** `cupones_*` 🟡.
- **Uso:** 1) nuevo cupón; 2) código, tipo, valor, mínimo, usos y fechas; 3) publica; 4) revisa usos; 5) desactiva.
- **Diseño propio:** lista de cupones con código en mono, estado y barra de uso; constructor en panel lateral con vista previa del descuento. Sin tabla pesada.
- **Estados:** código duplicado, vigencia invertida, cupón agotado.
- **Fase:** 3.

### N12 · Pagos

- **Carpeta:** `web/panel/negocio/pagos/` · **Ruta:** `/panel/negocio/pagos/`
- **Objetivo:** saber cómo cobra la tienda y cuánto le corresponde.
- **Conexión:** `pagos_config`, `liquidaciones_listar` 🟡🧩; hoy `pedido_crear` guarda `metodo_pago` y el checkout es demo.
- **Endpoint:** `pagos_config`, `liquidaciones_listar` 🟡.
- **Uso:** 1) elige medios aceptados (efectivo, transferencia, tarjeta demo); 2) revisa liquidaciones por período; 3) descarga el detalle.
- **Diseño propio:** dos bloques: métodos con interruptores y liquidaciones en tabla; aviso visible «pago demo, no mueve dinero real».
- **Estados:** sin liquidaciones, medio no configurado, pago demo.
- **Fase:** 3.

### N13 · Equipo

- **Carpeta:** `web/panel/negocio/equipo/` · **Ruta:** `/panel/negocio/equipo/`
- **Objetivo:** dar acceso a otras personas sin compartir la cuenta dueña.
- **Conexión:** `equipo_listar`, `equipo_invitar`, `equipo_rol`, `equipo_quitar` 🟡🧩 (tabla `mercado_equipo`).
- **Endpoint:** `equipo_*` 🟡.
- **Uso:** 1) invita por correo; 2) asigna rol (`admin`, `operador`, `lector`); 3) revoca; 4) audita quién hizo qué.
- **Diseño propio:** lista de miembros con avatar/inicial, rol en un select y estado de invitación; matriz de permisos debajo. Sin tarjetas.
- **Estados:** invitación pendiente, último dueño (no se puede quitar), correo repetido.
- **Fase:** 4.

### N14 · Notificaciones

- **Carpeta:** `web/panel/negocio/notificaciones/` · **Ruta:** `/panel/negocio/notificaciones/`
- **Objetivo:** enterarse de un pedido aunque el panel esté cerrado.
- **Conexión:** `push_local_suscribir` / `push_local_baja` ✅ (una fila por navegador en `mercado_push_local`).
- **Endpoint:** `push_local_suscribir`, `push_local_baja`.
- **Uso:** 1) activa avisos en este navegador; 2) prueba el aviso; 3) desactiva; 4) entiende que no hay lista de dispositivos (la API no la expone): cada navegador se suscribe por su cuenta.
- **Diseño propio:** tarjeta de estado del permiso, botón grande de activar/desactivar y lista de dispositivos; explicación clara de qué se avisa.
- **Estados:** permiso denegado, navegador sin push, suscripción vencida.
- **Fase:** 2.

### N15 · Auditoría

- **Carpeta:** `web/panel/negocio/auditoria/` · **Ruta:** `/panel/negocio/auditoria/`
- **Objetivo:** saber quién cambió un precio, un estado o un permiso.
- **Conexión:** `auditoria_listar` 🟡🧩 (tabla `mercado_auditoria`: actor, acción, entidad, antes/después, ts); los eventos de pedido ya viven en `mercado_eventos` ✅.
- **Endpoint:** `auditoria_listar` 🟡.
- **Uso:** 1) filtra por fecha, actor o tipo; 2) abre el detalle; 3) exporta.
- **Diseño propio:** tabla de log con columnas fijas (fecha, actor, acción, entidad) y diff en panel lateral; tipografía mono para IDs. Sin gráficos.
- **Estados:** sin eventos, filtro vacío, sin permiso.
- **Fase:** 4.

### N16 · Ajustes

- **Carpeta:** `web/panel/negocio/ajustes/` · **Ruta:** `/panel/negocio/ajustes/`
- **Objetivo:** cerrar la configuración del negocio y las acciones irreversibles.
- **Conexión:** `local_actualizar` ✅, `local_borrar` ✅, `auth` (`sesion`, `salir`, `borrar`) ✅.
- **Endpoint:** `local_actualizar`, `local_borrar`, `auth`.
- **Uso:** 1) datos legales y de contacto; 2) plan; 3) exportar catálogo/pedidos; 4) cerrar la tienda; 5) eliminar la tienda con confirmación escrita.
- **Diseño propio:** secciones apiladas con navegación interna, zona de peligro al final y confirmación de dos pasos; no es una tabla.
- **Estados:** cambios sin guardar, error de permisos, tienda con pedidos abiertos (bloquea borrado).
- **Fase:** 2.

### N17 · Integraciones

- **Carpeta:** `web/panel/negocio/integraciones/` · **Ruta:** `/panel/negocio/integraciones/`
- **Objetivo:** conectar el catálogo con sistemas externos sin copiar y pegar.
- **Conexión:** `integraciones_listar`, `integracion_crear`, `integracion_borrar` 🟡🧩 (API keys con hash, webhooks y CSV programado).
- **Endpoint:** `integraciones_*` 🟡.
- **Uso:** 1) crea una clave; 2) copia una vez; 3) configura webhook; 4) prueba el envío; 5) revoca.
- **Diseño propio:** tarjetas de integración con estado, clave enmascarada y último evento; formulario de webhook con ejemplo de payload. Sin tabla.
- **Estados:** clave revocada, webhook caído, sin plan.
- **Fase:** 4 (solo si hay clientes que lo pidan).

---

## 5. Contrato de endpoints

### 5.1 Existentes que usan los paneles

| Acción | Método | Autorización | Devuelve | Módulos |
|---|---|---|---|---|
| `locales` | GET/POST | pública | tiendas activas, con o sin catálogo | C01, C02 |
| `local_ver` | GET/POST | pública | una tienda + catálogo + calificación | C04, C05, C06, N06 |
| `productos_buscar` | GET/POST | pública | productos de todas las tiendas, ordenados | C01, C03 |
| `codigo_buscar` | GET/POST | pública | marcas que tienen un EAN | C03 (escáner) |
| `imagen_ver` | GET | pública | foto versionada del producto | C04, C05, N03 |
| `pedido_crear` | POST | pública + idempotencia | pedido, total, `seguimiento` | C07 |
| `pedido_seguir` | POST | token, código+contacto o `verificacion` | estado y línea de tiempo | C08, C09, `/verificar.html` |
| `push_suscribir` / `push_baja` | POST | token del pedido | suscripción del comprador | C08 |
| `resenas_listar` | POST | pública | reseñas visibles + promedio | C12, C04 |
| `resena_crear` | POST | token del pedido | reseña creada | C12 |
| `local_mio` | POST | Bearer de cuenta | tiendas del dueño + catálogo + pendientes | N01, N03, N04, N05 |
| `local_actualizar` | POST | dueño/clave/admin | ficha actualizada | N06, N07, N16 |
| `local_estado` | POST | dueño/clave/admin | abierto/cerrado | N06 |
| `local_borrar` | POST | dueño/clave/admin | baja | N16 |
| `productos_subir` | POST | dueño/clave/admin | upsert de catálogo | N03, N04, N05 |
| `producto_borrar` | POST | dueño/clave/admin | baja de SKUs | N03 |
| `pedidos_listar` | POST | dueño/clave/admin | pedidos + historial + contadores | N02 |
| `pedido_estado` | POST | dueño/clave/admin | pedido actualizado | N02 |
| `resenas_panel` | POST | dueño/clave/admin | todas las reseñas | N08 |
| `resena_moderar` | POST | dueño/clave/admin | oculta/muestra | N08 |
| `ventas_serie` | POST | dueño/clave/admin | serie, totales, top, estados, reseñas, visitas | N01, N10 |
| `push_local_suscribir` / `push_local_baja` | POST | dueño/clave/admin | avisos de la tienda | N14 |
| `resumen` | POST | ADMIN global | conteos de toda la plataforma | administración interna |

### 5.2 Propuestos

| Acción | Método | Autorización | Para qué | Módulo | Fase |
|---|---|---|---|---|---|
| `producto_ver` | GET/POST | pública | un producto por `local_id` + `sku` para deep links | C05 | 1 |
| `mis_pedidos` | POST | Bearer | historial del comprador entre dispositivos | C09 | 2 |
| `pedido_cancelar` | POST | Bearer o token | cancelar mientras esté `nuevo` | C09/C08 | 3 |
| `favoritos_listar` | POST | Bearer | favoritos en la nube | C10 | 2 |
| `favorito_alternar` | POST | Bearer | agregar/quitar | C10 | 2 |
| `direcciones_listar` | POST | Bearer | direcciones guardadas | C11 | 2 |
| `direccion_guardar` | POST | Bearer | alta/edición | C11 | 2 |
| `direccion_borrar` | POST | Bearer | baja | C11 | 2 |
| `resenas_mias` | POST | Bearer | reseñas del comprador | C12 | 2 |
| `perfil_actualizar` | POST | Bearer | nombre y teléfono | C13 | 1 |
| `pass_cambiar` | POST | Bearer | contraseña | C13 | 2 |
| `clientes_listar` | POST | dueño/clave/admin | clientes agregados de los pedidos | N09 | 3 |
| `reportes_exportar` | POST | dueño/clave/admin | CSV de pedidos del rango | N10 | 3 |
| `cupones_listar` | POST | dueño/clave/admin | cupones del local | N11 | 3 |
| `cupon_crear` | POST | dueño/clave/admin | alta | N11 | 3 |
| `cupon_editar` | POST | dueño/clave/admin | edición/estado | N11 | 3 |
| `cupon_borrar` | POST | dueño/clave/admin | baja | N11 | 3 |
| `cupon_validar` | POST | pública | validar código en checkout | C07 | 3 |
| `pagos_config` | POST | dueño/admin | medios aceptados | N12 | 3 |
| `liquidaciones_listar` | POST | dueño/admin | períodos y montos | N12 | 3 |
| `equipo_listar` | POST | dueño/admin | miembros | N13 | 4 |
| `equipo_invitar` | POST | dueño/admin | invitación | N13 | 4 |
| `equipo_rol` | POST | dueño/admin | cambiar rol | N13 | 4 |
| `equipo_quitar` | POST | dueño/admin | revocar | N13 | 4 |
| `auditoria_listar` | POST | dueño/admin | log de cambios | N15 | 4 |
| `integraciones_listar` | POST | dueño/admin | claves y webhooks | N17 | 4 |
| `integracion_crear` | POST | dueño/admin | alta de clave/webhook | N17 | 4 |
| `integracion_borrar` | POST | dueño/admin | revocar | N17 | 4 |

### 5.3 Ejemplos de contrato

**Buscar productos**

```http
GET /api/mercado?accion=productos_buscar&q=arroz&categoria=abarrotes&precio_max=3000&lat=-33.45&lon=-70.66&orden=cercania&limite=30
```

```json
{
  "ok": true,
  "accion": "productos_buscar",
  "q": "arroz",
  "total": 12,
  "tiendas": 4,
  "productos": [
    { "local_id": "solucion", "tienda": "Solución", "sku": "ARROZ-1", "nombre": "Arroz 1 kg", "precio": 1290, "precio_efectivo": 1190, "descuento": 8, "stock": 24, "km": 0.8, "abierta": true }
  ]
}
```

**Crear pedido**

```http
POST /api/mercado
Content-Type: application/json

{
  "accion": "pedido_crear",
  "local_id": "solucion",
  "idempotencia": "cli-2026-11-17-001",
  "items": [{ "sku": "ARROZ-1", "cantidad": 2 }],
  "cliente": "Ana Pérez",
  "telefono": "+56912345678",
  "entrega": "delivery",
  "direccion": "Av. Siempre Viva 742",
  "comuna_entrega": "Santiago",
  "referencia_entrega": "Portón negro",
  "metodo_pago": "efectivo",
  "pago_con": 5000,
  "nota": "Tocar el timbre"
}
```

**Seguir pedido**

```http
POST /api/mercado
{ "accion": "pedido_seguir", "token": "<seguimiento>" }
```

**Panel del dueño**

```http
POST /api/mercado
Authorization: Bearer <token de /api/auth>
{ "accion": "ventas_serie", "local_id": "solucion", "dias": 7 }
```

### 5.4 Doctor nativo (observabilidad)

No es un módulo de compra: es la capa que mide si los módulos funcionan. Vive
en `api-telefono/api/diagnostico.ts` (sin gastar una función nueva) y en
`web/panel/doctor/`.

| Ruta | Autorización | Devuelve |
|---|---|---|
| `GET /api/diagnostico?accion=doctor&dias=14` | pública, CORS | sondeo HTTP real de 14 páginas y 5 APIs, malla de 3 capas, reportes agregados, almacenamiento, descubrimientos y `resumen_ia` |
| `POST /api/diagnostico` `{accion:"reporte", pagina, eventos[]}` | pública, CORS, rate limit | guarda un reporte comprimido (máx. 20 eventos y 8 KB) |
| `POST /api/diagnostico` `{accion:"limpiar", dia?, dias?}` | Bearer del dueño | borra un día o lo anterior a N días |
| `GET/POST /api/diagnostico` sin `accion` | Bearer del dueño | informe legacy de la malla |

- **Cliente**: `web/doctor.js`, script clásico sin `import`/`export` para servir
  igual en la PWA (antes de `app.js`) y en el panel (`import('/doctor.js')`).
  Captura errores, promesas, recursos, fallos de API, esqueletos a los 15 s y
  páginas lentas; deduplica y limpia correo/token/hash antes de enviar.
- **Página**: `/panel/doctor/`, con KPIs, periodo 1/7/14/30, gráfico, tablas por
  página/API/error, almacenamiento, descubrimientos y resumen copiable para IA.
- **Almacenamiento**: `doctor_dias`, una fila por día (no por evento), topes de
  25 páginas / 20 errores / 15 APIs, fila máxima 48 KB y retención de 30 días.
  El primer reporte real midió 826 B.
- **Ubicación exacta**: cada error guarda `archivo:línea:columna`, página y un
  stack acotado; `api.js` reporta el llamador, no la línea del cliente HTTP.

---

## 6. Datos nuevos propuestos

Todo se crea en `asegurar()` con `CREATE TABLE IF NOT EXISTS` y `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. No se toca ni se borra lo existente.

| Tabla / columna | Campos mínimos | Para qué |
|---|---|---|
| `mercado_pedidos.cliente_id` | `TEXT NOT NULL DEFAULT ''` + índice | historial del comprador (`mis_pedidos`) |
| `mercado_favoritos` | `usuario_id`, `local_id`, `sku`, `creado` (PK compuesta) | favoritos en la nube |
| `mercado_direcciones` | `id`, `usuario_id`, `alias`, `calle`, `numero`, `comuna`, `referencia`, `lat`, `lon`, `predeterminada` | direcciones |
| `mercado_cupones` | `id`, `local_id`, `codigo`, `tipo`, `valor`, `minimo`, `usos_max`, `usos`, `desde`, `hasta`, `activo` | cupones |
| `mercado_equipo` | `local_id`, `usuario_id`, `rol`, `estado`, `invitado_por`, `creado` | equipo y roles |
| `mercado_pagos_config` | `local_id`, `metodos` JSONB, `actualizado` | medios aceptados |
| `mercado_liquidaciones` | `id`, `local_id`, `periodo`, `bruto`, `comision`, `neto`, `estado`, `creado` | liquidaciones |
| `mercado_auditoria` | `id`, `local_id`, `actor_id`, `accion`, `entidad`, `entidad_id`, `antes` JSONB, `despues` JSONB, `ts` | auditoría |
| `core_usuarios.telefono` | `TEXT NOT NULL DEFAULT ''` | perfil del comprador |
| `doctor_dias` | `dia DATE PRIMARY KEY`, `datos JSONB`, `bytes`, `actualizado` | agregados diarios del doctor (no eventos crudos) |

Reglas:

- `cliente_id` se llena al crear el pedido si hay Bearer; si no, queda vacío y el pedido se sigue por token/código.
- Los cupones se validan en el servidor; el navegador nunca calcula el total final.
- Las claves de integración se guardan como hash, nunca en claro.
- La auditoría no guarda teléfonos ni direcciones completas; solo IDs y campos cambiados.
- `doctor_dias` es la excepción: se crea y se escribe desde `diagnostico.ts`, no desde `asegurar()` de `mercado.ts`, porque el doctor es transversal a los paneles.

---

## 7. Fases de construcción

### Fase 0 · Shell y cimientos (2–3 días)

- `panel/comun/shell.css`, `shell.js`, `nav-cliente.js`, `nav-negocio.js`, `api.js`, `sesion.js`, `formato.js`.
- Guardia de sesión: si no hay token, el panel del negocio redirige a `/app/#cuenta`; el cliente puede navegar como invitado.
- Sidebar translúcida al 60 %, cajón móvil, foco y `aria-current`.
- Prueba real: 360 px, 768 px, 1280 px; teclado; `prefers-reduced-motion`; sin `backdrop-filter`.

**Aceptación:** dos shells vacíos que navegan entre módulos sin errores de consola; sidebar legible sobre mapa y sobre tabla.

### Fase 1 · Cliente MVP (5–7 días)

C01–C08, C13, C14. C09–C12 se completaron en la fase 2 con datos en InsForge.

**Aceptación:** buscar, abrir tienda, agregar al carrito, pagar demo, seguir el pedido y verlo en el historial local; sin romper `/app/`.

### Fase 2 · Negocio MVP (6–8 días)

N01–N04, N06, N07, N08, N14 y N16 **desplegados**. `local_mio` es la fuente de verdad del panel; `aTienda` (ficha pública y mapa) no expone el plan del dueño.

**Aceptación:** el dueño entra con su cuenta, ve ventas de 7 días, avanza un pedido, edita stock y ficha, gestiona horario/entrega, modera reseñas, activa/desactiva avisos en este navegador y exporta o borra la tienda con confirmación; nada de esto requiere la `clave` si hay sesión. Hoy: resumen, cola de pedidos, catálogo, inventario, ficha, horarios, reseñas, notificaciones y ajustes funcionan con datos reales; faltan ofertas, clientes, reportes, cupones, pagos, equipo, auditoría e integraciones.

**Verificado el 2026-11-24:** ciclo completo con dos cuentas reales (dueña y compradora) por la interfaz: pedido de la compradora, entrega por N02 con código (`nuevo → visto → listo → entregado`), reseña 5★ en C12 y promedio 5,0 en N08. Datos temporales borrados al terminar; sin errores de consola.

### Fase 3 · Crecimiento (5–7 días)

N05, N09–N12, cupones en checkout, reportes exportados y cliente recurrente. Las acciones `mis_pedidos`, `favoritos_*`, `direcciones_*` y `resenas_mias` ya están en la nube (fase 2).

**Aceptación:** historial entre dispositivos, cupón aplicado en checkout, reporte exportado y cliente recurrente visible.

### Fase 4 · Equipo y plataforma (4–6 días)

N13, N15, N17, `perfil_actualizar`, `pass_cambiar`, auditoría e integraciones.

**Aceptación:** invitar un operador, revocar acceso, ver el log y conectar un webhook de prueba.

---

## 8. Checklist de aceptación por módulo

Cada página se considera terminada solo si cumple:

- [ ] Ruta y carpeta propias; no comparte CSS con otro módulo.
- [ ] Sidebar con `aria-current="page"` correcto y cajón móvil funcional.
- [ ] Estado de carga (skeleton), vacío, error y sin conexión.
- [ ] Funciona a 360 px sin scroll horizontal.
- [ ] Teclado: foco visible, `Esc` cierra cajón, formularios con `label`.
- [ ] Contraste AA en texto y controles.
- [ ] No imprime tokens, claves ni teléfonos completos.
- [ ] Endpoint existente o propuesto documentado; si es propuesto, marcado en la UI como «en construcción» solo en entorno interno, nunca en producción.
- [ ] Enlaces de compartir estables (`?id=`, `?local=&sku=`, `?token=`).
- [ ] `prefers-reduced-motion` respetado.
- [ ] Sin errores de consola en la prueba real.
- [ ] Documentado en `docs/PANELES-MODULOS.md` y en `STATE.md` si cambia una decisión.

---

## 9. Decisiones que quedan abiertas

1. **Un solo origen o dos.** Esta spec propone `/panel/cliente/` y `/panel/negocio/` bajo el mismo dominio. Si el dueño necesita un subdominio (`negocio.forge-core-stock.vercel.app`), el shell no cambia; solo la ruta base.
2. **Login del cliente.** El comprador puede pedir sin cuenta; el historial en la nube requiere Bearer. La página C09 debe explicarlo sin bloquear la compra.
3. **Pago real.** Hoy `tarjeta` es demo. N12 no debe prometer cobros reales hasta integrar Webpay/MercadoPago.
4. **Multi-tienda por dueño.** `local_mio` ya devuelve varias tiendas; el selector de tienda debe ser persistente (`fcore.negocio.sel`) y visible en la topbar.
5. **Cupones y equipo** agregan tablas; no se construyen hasta que un cliente real los pida (Fase 3/4).

---

## 10. Resumen ejecutivo

- **31 módulos**: 14 del cliente y 17 del negocio.
- **Carpeta propia** para cada uno, con `index.html`, `<modulo>.css` y `<modulo>.js`.
- **Shell compartido** solo para tokens, sidebar, sesión, API y formato.
- **Sidebar translúcida al 60 %** (`rgba(8,9,10,.60)` + `blur(18px)`), cajón en móvil y foco accesible.
- **23 acciones existentes** reutilizadas; **28 propuestas** dentro de `mercado.ts`/`auth.ts`, sin crear funciones nuevas en `api/`.
- **9 tablas/columnas nuevas** propuestas, todas con `IF NOT EXISTS`.
- **Todo en la nube:** paneles estáticos en Vercel (`forge-core-stock.vercel.app/panel/…`), API en `fabri-api.vercel.app` y cuentas reales en **InsForge**, con sesión compartida con `/app/`.
- **Login migrando al Auth de InsForge** con patrón BFF y migración perezosa (`AUTH_MODO=legacy → dual → insforge`); plan en [`docs/AUTH-INSFORGE-MIGRACION.md`](./AUTH-INSFORGE-MIGRACION.md).
- **Doctor nativo** en `/panel/doctor/`: sondea 14 páginas, 5 APIs y la malla, captura errores con `archivo:línea:columna` y guarda una fila por día en `doctor_dias` (826 B el primer reporte), con resumen copiable para IA.
- **Nunca** llamar `/api/auth` relativo: esa ruta es la auth vieja de Blob y está sin configurar. Siempre `https://fabri-api.vercel.app/api/auth`.
- **Fase 0–1** entrega el panel del cliente; **Fase 2** el del negocio; **Fase 3–4** crecimiento, equipo e integraciones.
