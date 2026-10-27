# STATE — FABRI-CORE

Última actualización: 2026-10-27

## Sesión 2026-10-27 (19) · Nube v2.0 — «Aurora», Lottie y d3

La PWA deja de ser «la APK sin base local»: tiene su propio contexto visual.
Publicada en `https://fabri-core-web.vercel.app/` (landing) y `/app/` (consola).
Deployment `dpl_7p9B4n1bZKboQc52qu9tNWVhM3vx`, estado `READY`, alias de producción
`fabri-core-web.vercel.app`. **La APK no cambia en esta sesión.**

### Qué se hizo
| Qué | Dónde |
|---|---|
| **Sistema «Aurora»**: iris `#8C8CFF` sobre azul noche `#04060D`, vidrio, sombras en dos capas, motion `--ease`/`--spring` | `web/app/styles.css` (~1.000 líneas) |
| **Rail lateral ≥960 px** y barra inferior de 5 destinos + hoja «Más» en móvil | `styles.css`, `index.html`, `cloud.js` |
| **lottie-web 5.12.2 vendorizado** (305.543 B + licencia), sin CDN | `web/app/vendor/lottie.min.js` |
| **5 animaciones Lottie generadas y validadas** (core, sync, scan, check, empty) | `scripts/animaciones.mjs` → `web/app/anim/` |
| **Cargador compartido** con caché, fallback, `IntersectionObserver` y modo reducido | `web/app/lottie-mount.js` |
| **Gráficos d3 reales**: anillo de memoria por tipo y barras de tablas con filas, con firma anti-repintado | `web/app/cloud.js` |
| **Capa de UI**: ⌘K, hoja «Más», migas, contadores, reloj, espejo FTS e hito de instalación | `web/app/cloud.js` |
| **Shell nuevo**: héroe con orbe, 4 KPIs, 2 gráficos, módulos, acento e instalación; cabeceras propias para Datos/IA/Hoja/Cuenta | `web/app/index.html` |
| **Landing editorial**: héroe con orbe y chips, bento de 7 módulos, APK vs Nube, 3 pasos, malla real y stack | `web/index.html` |
| **Iconos Aurora** (192, 512, maskable, favicon) | `scripts/iconos-nube.py` |
| **Prueba de la nube** (contrato, sistema, Lottie, offline, manifest, cabeceras) | `tests/web/diseno.js` |
| **Skill del sistema de diseño** | `~/.config/opencode/skills/fabricore-nube/` |

### Verificación
- `node tests/web/diseno.js` **en verde** (42 ids de `app.js`, 45 de inventario,
  98 clases del HTML, clases de los módulos, tokens, 5 Lottie, 23 archivos del
  precache, cero CDN, 7 scripts, iconos y cabeceras).
- `node tests/web/boleta.js` **en verde**.
- `node scripts/animaciones.mjs` **5/5**; `python3 scripts/iconos-nube.py` **4/4**.
- Balance de etiquetas de `web/index.html` y `web/app/index.html`: sin errores.
- Balance de llaves de `styles.css`: 401/401.
- Producción comprobada con `curl -4`: `/`, `/app/`, `styles.css`, `cloud.js`,
  `lottie-mount.js`, `anim/core.json`, `vendor/lottie.min.js`, `sw.js` y
  `manifest.webmanifest` responden **200**; `/app/anim/` con
  `cache-control: immutable`; `/api/estado` devuelve las cuatro capas.

### Decisiones
- **Contexto distinto, no skin**: la nube puede permitirse Lottie (305 KB), d3,
  materiales y rail; la APK sigue sin runtime de animación.
- **Lottie generado por script**, no escrito a mano: un `ty` mal puesto deja el
  hueco en blanco sin error visible.
- **Contrato intacto**: el rediseño es CSS + shell + `cloud.js`; no se tocó la
  lógica de `app.js`, `core-pro.js` ni `core-sheet.js` (solo acentos).
- **«Más» es un `<div>`**: `app.js` enlaza todos los `.nav button` y un botón sin
  `data-go` apagaría todas las pantallas.
- **Sin navegador headless** en este entorno: la verificación es por contrato en
  Node, no por captura. Queda pendiente la revisión visual del usuario.

### Pendiente
- Revisión visual en dispositivo real (el modelo no procesa imágenes: el usuario
  debe describir lo que ve).
- Cámara en la web para el escáner EAN (hoy formulario).
- La APK sigue sin lottie: es deliberado, no un olvido.

## Sesión 2026-10-27 (18) · APK 0.9.26 — la portada del producto

APK: `dist/FABRI-CORE-0.9.26.apk` · **4.218.325 B** ·
sha256 `4ef65bea9d905593f4fecf2da43b8287fe08be86b66b5ca41f8f64268aaaebc1` ·
versionCode **41** · copiada a `/sdcard/FABRI-CORE-0.9.26.apk` y a
`/data/local/tmp/FABRI-CORE-0.9.26.apk`.
Firma debug, minSdk 24, target 34. Instalar **encima** de la 0.9.25.

### Qué se hizo (el inicio como portada de producto)
| Qué | Dónde |
|---|---|
| **Héroe con canvas propio** (barras que respiran + línea de escaneo), apagado con el acceso abierto, fuera de la vista o con `prefers-reduced-motion` | `inicio.js` (`inicioLienzo`), `index.html` (`#inHeroCanvas`), `inicio.css` |
| **KPIs del negocio reales** (productos, valor de venta, utilidad, stock bajo) desde `inventario.resumen` | `inicio.js` (`inPintarKpis`, `inicioRefrescar`) |
| **Tres gráficos d3**: ventas de 7 días (barras), categorías (anillo + leyenda), más vendidos (ítems de boletas) | `inicio.js` (`inChartVentas`, `inChartCategorias`, `inChartTop`), `d3-mini.js` |
| **d3 vendorizado**: bundle esbuild con `d3-array`, `d3-scale`, `d3-shape`, global `window.d3s`, 50.802 B | `android/assets/www/d3-mini.js` (generador: `/tmp/opencode/d3b`) |
| **`marcas.js`**: 14 marcas SVG (lobe-icons MIT + simple-icons CC0) y 22 iconos animados de animateicons (solo datos + animador propio con Web Animations API) | `android/assets/www/marcas.js` (generador `/tmp/opencode/gen-marcas.mjs` + `marcas-cola.js`) |
| **«Qué es FABRI-CORE»** y valor para almacén/minimarket (sin mensualidad, sin internet, rápido, datos propios) | `index.html` (`#v-inicio`, `.in-quees`) |
| **Seis fichas con iconos animados**: lector de barras, wiki/bases libres, SQLite local, nube, boletas, asistente IA | `index.html` (`data-ani-icono`), `inicio.js` (`inicioPintarIconos`) |
| **Bloque técnico plegado** en `<details>`: verificador, dispositivo, modelos y acciones rápidas, sin perder ningún id | `index.html` (`#inTecnico`) |
| **Enganche**: `pintarInicio()` llama a `inicioRefrescar()` (caché de 20 s, reintento mientras el núcleo migra) | `app.js` |
| **Acciones nuevas**: `ir-inventario` y `escanear-codigo` (abre inventario y enciende la cámara) | `app.js` |
| **Prueba nueva** de la portada (ids, iconos, marcas, bloque técnico, KPIs/gráficos con datos y estado vacío) | `tests/arranque/inicio.js` (paso 8/8) |

### Verificación
- `bash tests/arranque/correr.sh` **8/8** ✔ (sintaxis, DOM hostil, carga sin
  bloqueo del puente, loader, puente, identidad, candado y **portada**)
- `bash tests/inventario/correr.sh` **4/4** ✔
- `node --check` de `inicio.js`, `marcas.js`, `d3-mini.js` y `app.js` ✔
- APK verificada: `versionCode=41`, `versionName=0.9.26`, y dentro de
  `assets/www` viajan `inicio.js`, `inicio.css`, `marcas.js` y `d3-mini.js`
  idénticos a los del árbol (sha256 comparados).

### Decisiones
- **lottie-web no se incluye** (~250 KB + reproductor): el movimiento que se
  pedía se resuelve con canvas y Web Animations API, con 0 KB de dependencia.
- **animateicons sin su runtime**: se vendorizan solo los datos de cada icono
  (~1 KB) y se reproducen con un animador propio de ~120 líneas; el paquete
  completo son 20 MB de `dist`.
- Los assets son **planos** en `assets/www/` (el build los empaqueta con
  `aapt2 -A`), así que no hace falta tocar el pipeline de compilación.

### Pendiente
- **lottie-web**: ofrecido al usuario para un punto concreto; sin respuesta.
- **OCR offline real**: requiere migrar el build a Gradle (tarea aparte).
- **S3 / factura servida**: empaquetar el JSON, enviarlo con token, guardarlo y
  servirlo como factura HTML/canvas. No iniciado.
- Endpoint de embeddings tipo Gemini (no cabe en la APK). No iniciado.
- Puente de Termux: el usuario dijo «después lo vemos».

## Sesión 2026-10-27 (17) · APK 0.9.25 — el módulo de inventario completo

APK: `dist/FABRI-CORE-0.9.25.apk` · **4.168.907 B** ·
sha256 `0284b890e89d17393f71eccc99254f2a952968b65daae67a9d5639154263d828` ·
versionCode **40** · copiada a `/sdcard/FABRI-CORE-0.9.25.apk` y a
`/data/local/tmp/FABRI-CORE-0.9.25.apk`.
Firma debug, minSdk 24, target 34. Instalar **encima** de la 0.9.24.

### Qué se hizo (el módulo entero, de escanear a cobrar)
| Qué | Dónde |
|---|---|
| **Apilador continuo**: escaneo sin cerrar la cámara; lista con miniatura, nombre y precio; repetidos suman cantidad; guarda el lote con UNA escritura | `inventario.js` (`invModoApilador`, `invApilador*`, `NVAP`), `index.html` (`#invApiladorCaja`), `inventario.css` |
| **Importación masiva** (Eleventa/Excel/CSV/TSV/JSON): alias de columnas, número chileno, vista previa y ejecución en lote | `inventario.js` (`invParseImportacion`, `invCampoImport`, `invNumImport`, `invImportar*`), `index.html` (`#invImportarPanel`) |
| **Catálogo en tarjetas**: miniatura en canvas (color por producto + iniciales), código de barras SVG, chips, acciones, paginación de 80 | `inventario.js` (`invPintarCatalogo`, `invCardHtml`, `invDibujarMiniatura`, `invHash`), `inventario.css` (`.inv-catalogo`, `.inv-card*`) |
| **Código de barras SVG**: EAN-13 (95 módulos) si el dígito de control es válido, Code 39 si no | `inventario.js` (`invBitsEan13`, `invBitsCode39`, `invBarrasSvg`) |
| **Boleta con efecto de impresión**: cuerpo de ticket compartido pantalla/papel, identidad del negocio, detalle, neto/IVA/total, barras del folio, «¡GRACIAS POR SU COMPRA!», `@page` 80/58/A4 | `inventario.js` (`invTicketCuerpo`, `invBoletaDocumento`, `invImprimir`), `inventario.css` (`.tk-*`, `ticketEmerger`) |
| **Iconos SVG en línea** (fin de los emoji del módulo) | `inventario.js` (`INV_SVG`, `ico`, `invPintarIconos`), `index.html` (`data-ico`) |
| **Verificación real del sistema** + limpieza de errores por versión | `src-tauri/src/lib.rs` (`revision_limpiar_db`, `revision_verificar_db`, `op_mantenimiento`), `app.js` (`revisionVerificar`, `revisionLimpiar`), `index.html` |
| **Un solo camino de escritura**: alta individual e importación usan `inv_upsert`; acción `importar` (lote en una transacción) | `src-tauri/src/lib.rs` |
| **OCR con degradación honesta**: por reflexión (ML Kit v2 / visión de GMS); sin motor, el botón **no aparece** | `android/java/cl/fabrick/core/OcrNativo.java`, `NativeBridge.ocrEstado()/ocr()` |
| Prueba nueva del módulo | `tests/inventario/nuevo.js` (paso 4/4 de `correr.sh`) |

### Verificación
- `cargo check --target aarch64-linux-android --release` ✔ (solo el warning preexistente `token`)
- `javac` de todo `android/java` ✔ · `node --check` de `inventario.js` y `app.js` ✔
- `tests/inventario/correr.sh` **4/4** ✔ · `tests/arranque/correr.sh` **7/7** ✔
- APK verificada: `versionCode=40`, `versionName=0.9.25`, contiene
  `assets/www/inventario.js` con el parser, el apilador y `invBarrasSvg`, y
  `ocrEstado`/`OcrNativo` dentro de `classes.dex`.

### Decisiones
- **ML Kit se evalúa pero no se empaqueta en este build**: el build es sin Gradle
  (`javac → d8 → aapt2`) y `text-recognition:16.0.1` arrastra ~30 AAR de androidx
  que exigirían fusionar manifiestos y recursos a mano. Queda el puente por
  reflexión, apagado y honesto, que se enciende solo con un build Gradle.
- La vista previa del ticket ya no dibuja un EAN falso: el código de barras dice
  `PREVIA`.

### Pendiente
- **OCR offline real**: requiere migrar el build a Gradle (tarea aparte).
- **S3 / factura servida**: empaquetar el JSON, enviarlo a su base con token,
  guardarlo en tablas y servirlo como factura HTML/canvas. No iniciado.
- Endpoint de embeddings tipo Gemini (no cabe en la APK). No iniciado.
- Puente de Termux: el usuario dijo «después lo vemos».

## Sesión 2026-10-27 (16) · APK 0.9.24 — escáner pro, las 2 bases y más fuentes libres

APK: `dist/FABRI-CORE-0.9.24.apk` · **4.140.235 B** ·
sha256 `e1172093df80f98b774b9c6b573aa9421c2e77e82314b03daee9191217297403` ·
versionCode **39** · copiada a `/sdcard/FABRI-CORE-0.9.24.apk`.
Firma debug, minSdk 24, target 34. Instalar **encima** de la 0.9.23.

### Qué se hizo (alcance elegido: escáner pro + 2 bases + UI)
| Qué | Dónde |
|---|---|
| Malla de escaneo en canvas (grilla + barrido + esquinas + destello) | `index.html` (`#invMalla`), `inventario.css`, `inventario.js` (`invMalla*`) |
| Búsqueda en TU nube: local → nube → libres | `inventario.js` (`invNubeBuscarCodigo`, `invMostrarNube`) |
| Acción `buscar` (por código y por texto) + desplegada | `api-telefono/api/inventario.ts` |
| Open Prices (precios reales) | `inventario.js` (`invOpenPrices`) |
| Wikipedia/Wikidata (descripción) | `inventario.js` (`invWikiDescripcion`) |
| Autocompletado de códigos clasificado | `index.html` (`#invCodigos`), `inventario.js` (`invPoblarDatalist`) |
| Resumen de tu nube en el paso 2 | `inventario.js` (`invNubeResumenPintar`) |
| Prueba nueva de las 2 bases + escáner | `tests/inventario/nube.js`, `tests/inventario/correr.sh` |

### Verificación
- `tests/inventario/correr.sh` **3/3** ✔ · `tests/arranque/correr.sh` **7/7** ✔
- API en producción: `GET /api/inventario` lista `acciones` con `buscar` ✔; sin
  token responde `SIN_TOKEN` ✔.

### Pendiente (segunda entrega)
- **S3 / factura servida**: el usuario quiere empaquetar el JSON del producto y
  enviarlo a su base con un token, organizado en tablas, y luego servirlo como
  factura HTML/canvas con efecto de impresión profesional. No iniciado.
- Pool de lectura del núcleo (opción 2 de rendimiento), si la base crece.

## Sesión 2026-10-27 (15) · APK 0.9.23 — rendimiento sólido (SQLite afinado + op `panel`)

APK: `dist/FABRI-CORE-0.9.23.apk` · **4.136.139 B** ·
sha256 `5c56a31cf95ded67a3bb88039617ed10e1331122c8dbbe832e9a1ff2bc0b14b3` ·
versionCode **38** · copiada a `/sdcard/FABRI-CORE-0.9.23.apk`.
Firma debug, minSdk 24, target 34. Instalar **encima** de la 0.9.22.

### Por qué (rumbo elegido: «Rendimiento sólido», 1 + 3)
Con el carril ya arreglado (0.9.22), quedaba la mitad del problema que **sí** se
puede mejorar de verdad: el núcleo tiene **una sola conexión detrás de un solo
candado**, así que aunque el teléfono tiene 8 núcleos, las consultas van de a
una; y cada panel hacía cinco viajes. No era potencia, era **serialización y
E/S**. Se descartaron el pool de lectura (opción 2, toca ~30 operaciones) y las
capacidades nuevas (opción 4, embeddings reales exigen nube/clave).

### Hecho
| Qué | Dónde |
|---|---|
| `afinar(db)`: `synchronous=NORMAL`, `cache_size=-16000` (16 MB), `mmap_size=256 MB`, `temp_store=MEMORY`, `busy_timeout=1500` | `src-tauri/src/lib.rs` (3 aperturas) |
| `op_panel`: todo el estado del Flujo (`sqlite` + `inventario` + `revision`) en un solo candado | `src-tauri/src/lib.rs` |
| `revision_listar_db` / `revision_resumen_db` reusables sin anidar candado | `src-tauri/src/lib.rs` |
| Flujo de 5 llamadas a 2 (`ping` + `panel`), con respaldo individual | `android/assets/www/flujo.js` |
| Prueba ampliada: `op_panel` sin candado anidado + pragmas de `afinar()` | `tests/arranque/candado.js` |

### Verificación
- `cargo check --target aarch64-linux-android --release` ✔ (solo el warning preexistente `token`)
- `tests/arranque/correr.sh` **7/7** ✔ · `tests/inventario/lector.js` ✔ · `tests/inventario/ean.js` ✔

### Pendiente / sin confirmar
- Endpoint de embeddings tipo Gemini en `fabri-api.vercel.app` (no cabe dentro de
  la APK: necesita clave y red). No iniciado.
- Pool de lectura (opción 2) queda como mejora futura si la base crece.

## Sesión 2026-10-27 (14) · APK 0.9.22 — el auto-bloqueo del carril (núcleo ocupado siempre)

APK: `dist/FABRI-CORE-0.9.22.apk` · **4.132.043 B** ·
sha256 `03b688541ad8093b2283572136bb6a5ab52893d1ba6fb8d3e8ff03860a4e34fb` ·
versionCode **37** · copiada a `/sdcard/FABRI-CORE-0.9.22.apk`.
Firma debug, minSdk 24, target 34. Instalar **encima** de la 0.9.21.

### El fallo real (del informe del diagnóstico en el teléfono)
Con el token ya arreglado (0.9.21), el diagnóstico mostró otra cosa: las
operaciones, cuando corrían, tardaban **0–74 ms**, pero casi todas fallaban con
`núcleo ocupado: no se pudo tomar el carril en 800 ms`, y `manifiestos` con
`superó 20000 ms`. Un candado tomado y nunca soltado.

Causa: **auto-bloqueo de `con_estado`.** `dir_datos()` tomaba `ESTADO.lock()`
(bloqueante) y se llamaba desde dentro de un `con_estado(...)` por la ruta
`datos_manifiesto()` → `manifiestos_dinamicos()` → `dir_datos()`. Un
`std::sync::Mutex` no es reentrante: el hilo se esperaba a sí mismo para
siempre. El disparador: la acción `componentes accion:"estado"` (descargar o
verificar un módulo), llamada en `app.js:1159` y `app.js:1351`. Desde ese
instante el carril quedaba muerto para toda la sesión.

### Corregido
| Qué | Dónde |
|---|---|
| `dir_datos()` usa su propio candado `DIR_DATOS`; ya no toca `ESTADO` | `src-tauri/src/lib.rs` |
| `con_estado()` con guardia de reentrancia (`EN_ESTADO`): error en vez de cuelgue | `src-tauri/src/lib.rs` |
| `con_estado()` suelta el carril antes de `ULTIMAS_OPS` (sin inversión) | `src-tauri/src/lib.rs` |
| `componentes accion:"estado"` resuelve `datos_manifiesto()` fuera del carril | `src-tauri/src/lib.rs` |
| Prueba estática del candado | `tests/arranque/candado.js` (suite 7/7) |

### Verificación
- `cargo check --target aarch64-linux-android --release` ✔ (sin romper nada)
- `tests/arranque/correr.sh` **7/7** ✔ · `tests/inventario/lector.js` ✔ · `tests/inventario/ean.js` ✔

## Sesión 2026-10-27 (13) · APK 0.9.21 — el token asíncrono (SQL, Inventario y Flujo)

APK: `dist/FABRI-CORE-0.9.21.apk` · **4.132.043 B** ·
sha256 `556ecabe03a6bffb889ce311bf9c0abe81b70d850b8d20c9718b8325457cbed1` ·
versionCode **36** · copiada a `/sdcard/FABRI-CORE-0.9.21.apk`.
Firma debug, minSdk 24, target 34. Instalar **encima** de la 0.9.20.

### El fallo real (visible en el registro del teléfono)
El log mostró que **toda** operación asíncrona agotaba su tope exacto:
`ping tardó 6003 ms`, `sqlite tardó 6009 ms`, `modulos tardó 15011 ms`,
`componentes tardó 15065 ms`, `logs tardó 15032 ms` y `refresco del flujo lento`
cada 6 s. Un `ping` manual en la consola sí respondía al instante.

Causa: **el token no coincidía.** Java decide la clave (`callAsync` →
`"a" + ASYNC_SEQ`) y entrega el resultado por `window.__fabriAsync`, pero
JavaScript se registraba con un token propio
(`"a" + (++fabriAsyncSeq) + "_" + Date.now()`). El mapa `FABRI_ASYNC` del JS
nunca tenía la clave que Java entregaba, así que **cada resultado se descartaba
en silencio** y la promesa sólo se resolvía al vencer el tope. La vía síncrona
(`call()`, la de la consola) no usa tokens: por eso funcionaba.

### Corregido
| Qué | Dónde |
|---|---|
| `apiAsync` registra el callback bajo `acuse.token` (el de Java) y, si el acuse no trae token, resuelve por la vía síncrona | `android/assets/www/app.js` |
| Colchón `FABRI_TARDIOS`: si el resultado llega antes del registro, se recoge igual | `android/assets/www/app.js` |
| `flujoPintarCon` trata cada valor como objeto seguro (no lanza al leer `.ok`) | `android/assets/www/flujo.js` |
| Prueba de regresión del contrato del token | `tests/arranque/puente.js` |

### Versión
| Sitio | Antes → Después |
|---|---|
| `android/AndroidManifest.xml` | versionCode 35→36 · versionName 0.9.20→0.9.21 |
| `src-tauri/Cargo.toml` | 0.9.20→0.9.21 |
| `scripts/compilar.sh` | `NOMBRE` 0.9.20→0.9.21 |

### Verificación
- `tests/arranque/correr.sh` 6/6 ✔ · `tests/inventario/lector.js` ✔ · `tests/inventario/ean.js` ✔
- `tests/arranque/puente.js` § contrato del token ✔ (habría atrapado el fallo)
- El APK compilado contiene `acuse.token` y `FABRI_TARDIOS` (`unzip -p ... assets/www/app.js`).

## Sesión 2026-10-26 (12) · APK 0.9.14 — los dos fallos de 0.9.13 en el teléfono

APK: `dist/FABRI-CORE-0.9.14.apk` · **4107467 B** ·
sha256 `1a44edfa1a2295eb77ac57325f378b381a37495c3f51e1384b34d6c41eaae716`
versionCode **29** · copiada a `/storage/emulated/0/Download/FABRI-CORE-0.9.14.apk`.
Firma debug, minSdk 24, target 34. Instalar **encima** de la 0.9.13.

### Los dos fallos que salieron al probar 0.9.13 en el teléfono

**1. `ReferenceError: PROVEEDORES_CHAT is not defined` / `toast is not a function` /
`ReferenceError: hora is not defined`.** Tres símbolos que sí estaban usados
(`chatLlenarProveedores`, `saludPintar`, `entrarPin`) pero no definidos. Causa:
un reemplazo de esta sesión **borró el bloque de utilidades y estado** (desde
`function apiRuntime` hasta `function jsError`), que incluía `toast`, `hora`,
`esc`, `bytes`, `fechaHora`, `claseEstado`, `const estadoApp`,
`const PROVEEDORES_CHAT`, `const TERMUX_COMANDOS` y `function navegar`. El
verificador de sintaxis no lo veía porque los usos estaban más abajo y
`node --check` no resuelve referencias. Restaurado desde la versión anterior
(`bf87d58`), sin perder el carril asíncrono ni las novedades de esta versión.

**2. `no such column: datos in SELECT … FROM perfil`.** La columna `datos`
sólo se creaba en `inv_esquema` (el esquema de inventario), así que la app
funcionaba hasta que el usuario abría Inventario. Ahora el `ALTER TABLE`
idempotente va también en `migrar()`, que corre en el primer `init` de cada
arranque.

### Lo corregido en 0.9.14

| Cambio | Archivo |
|---|---|
| Bloque de utilidades/estado restaurado (`toast`, `hora`, `esc`, `estadoApp`, `PROVEEDORES_CHAT`, `navegar`…) | `app.js` |
| `ALTER TABLE perfil ADD COLUMN datos` en `migrar()` (no solo en el esquema de inventario) | `src-tauri/src/lib.rs` |
| Versión 0.9.13 → 0.9.14 (versionCode 28 → 29) en manifiesto, Cargo.toml y `scripts/compilar.sh` | 3 archivos |

### Nota de compilación

El primer APK de esta corrección (4.095.110 B, `b14cd9d3…`) se compiló **antes**
de cambiar el sync a `/api/inventario` y llevaba el contrato viejo. Se recompiló:
el APK bueno es **4.095.110 B**, `b14cd9d3…`, con `api/inventario` dentro
(verificado con `unzip -p`). Código real ya sincronizado al repo en `de23c43`.

---

## Sesión 2026-10-26 (11) · APK 0.9.13 — el puente deja de bloquear (carril asíncrono) + «Mi identidad»

APK: `dist/FABRI-CORE-0.9.13.apk` · **4.107.467 B** ·
sha256 `2e843acebc81e927b58680ef64ab202ccd374f15e07c37cfeab404e810bc80d5`
versionCode **28** · copiada a `/storage/emulated/0/Download/FABRI-CORE-0.9.13.apk`.
Firma debug, minSdk 24, target 34. Instalar **encima** de la 0.9.12.

### El fallo de fondo: el puente bloqueaba el hilo de JavaScript

Aunque el arranque ya estaba arreglado (0.9.11/0.9.12), la app **seguía pegada
al interactuar**: cada lectura de pantalla usaba la vía **síncrona** `call()`,
que devuelve el resultado en el mismo instante y, para hacerlo, **frena el hilo
de JavaScript** hasta el tope (600 ms, y antes 1,2 s). Cinco capas se sumaban:

1. `NativeBridge` tenía **un solo hilo** y `call()` esperaba en él (tope 1,2 s).
2. Las pantallas se rendían ante `NUCLEO_OCUPADO`/`LENTO` en vez de reintentar.
3. `init`, mantenimiento y registros abrían **hilos propios** que peleaban por
   el mutex global de Rust (`ESTADO`).
4. La guía de inventario hacía **una llamada bloqueante por paso**.
5. El lector trataba HTTP 404/500 como error final.

### Lo corregido en 0.9.13

| Cambio | Archivo |
|---|---|
| Carril **asíncrono** `callAsync` (token + entrega por `window.__fabriAsync`); `ping` lo contesta Java (`pingLocal`) | `NativeBridge.java` |
| Vía síncrona sólo para acciones puntuales; `TOPE_CALL_MS` **600 ms** | `NativeBridge.java` |
| Cola acotada a **24** con `AbortPolicy` y coalescencia por `op + payload` | `NativeBridge.java` |
| `apiAsync`/`apiTarde` no bloqueantes con reintento; `RAMAS_VISTA` + `refrescarVistaActual()` | `app.js` |
| Todas las lecturas migradas al carril asíncrono (inicio, diagnóstico, modelos, RAG, GraphRAG, SQL, nube) | `app.js` |
| SQLite de la hoja de datos (listar, insertar, borrar, actualizar, exportar, importar, auditoría) por `apiTarde` | `datos.js` |
| Respaldo de la base por `apiTarde` | `conexiones.js` |
| Refresco del flujo en paralelo con guarda | `flujo.js` |
| Guía de inventario encadenada por `apiTarde`, margen con freno de 140 ms | `inventario.js` |
| Lector: 404/500 se **saltan**; 4,5 s por host y **12 s** en total; mensaje honesto | `inventario.js` |
| Columna `datos TEXT` (JSON) con migración idempotente; `op_perfil` `guardar_datos` | `src-tauri/src/lib.rs` |

### Página «Mi identidad» (nueva)

- `identidad.js` (~418 líneas) + sección `v-id` en `index.html` + estilos `.id-*`.
- Nombre comercial (columna `nombre`), **logo real** a 256 px JPEG, razón social,
  RUT formateado (`76.543.210-8`), giro, dirección, teléfono, correo e **ID de
  cliente** `FAB-XXXX-XXXX` (sin I/O/0/1).
- Se guarda en `perfil.datos` (JSON, tope 24 KB) y se cachea en `localStorage`
  (`fabrick.identidad`); el login y la boleta lo leen de ahí.
- La boleta (pantalla e impresión 80/58/A4) imprime la ficha completa.

### El caso `7791293043791`

Verificado con `curl`: Open Food Facts da **404**, Open Beauty Facts **404**,
Open Products Facts **500**, UPCitemdb **0 ítems**. El producto **no existe** en
las bases libres. Antes la app mostraba «Open Products Facts: HTTP 500» como si
fuese su fallo; ahora lo salta y dice «no está publicado en las bases libres»,
con `Añadirlo como producto nuevo` como salida normal.

### Pruebas

| Suite | Resultado |
|---|---|
| `tests/arranque/correr.sh` | **6/6** (sintaxis, DOM hostil, carga, loader/logo, puente, identidad) |
| `tests/arranque/puente.js` | verde (síncrona acotada, `callAsync`, `ping` local, cola 24, coalescencia) |
| `tests/arranque/identidad.js` | verde (ID, RUT, iniciales, caché) |
| `tests/inventario/lector.js` | verde (404/404/500, producto real, sin red, presupuesto) |
| `tests/inventario/ean.js` | 13/13 |

### Authelia y FairScan

Revisados y documentados en `docs/SEGURIDAD-Y-VISION.md`. **No se instalan**:
Authelia es un proxy de identidad HTTP (no una librería) y FairScan una app
GPL-3.0 (no un SDK). Se adoptan sus ideas (sesión con caducidad, bloqueo por
intentos, todo en el dispositivo).

### Pendiente

- Probar en el teléfono: navegar todas las pantallas sin colgarse, escanear un
  código real y guardar la ficha de identidad con logo.
- **GitHub Actions sigue bloqueado por facturación** (`account is locked due to a
  billing issue`): resolver en GitHub → Settings → Billing.

---

## Sesión 2026-10-26 (10) · APK 0.9.12 + inventario en la nube + web con la misma ficha

APK: `dist/FABRI-CORE-0.9.12.apk` · **4.095.110 B** ·
sha256 `b14cd9d3d3fca113dab548bb8cc10f2c7c8a6785ed15bf208498e99de3f09541`
versionCode **27** · copiada a `/storage/emulated/0/Download/FABRI-CORE-0.9.12.apk`.
Firma debug, minSdk 24, target 34. Instalar **encima** de la 0.9.11.

### El fallo que quedaba: al reabrir, loader y login muertos

Los videos del usuario mostraban 1 %, 7 %, una imagen y luego nada, sin botones.
No era el arranque (ya corregido en 0.9.11): era **la vuelta del segundo plano**.

- Android pausa temporizadores y animaciones CSS al ocultar la app. Al reabrir,
  la animación `loader-salida` **no se había completado** y el loader seguía
  encima del login (z-index alto), capturando todos los toques.
- La clase `.loader-oculto` sólo ponía `opacity: 0`, pero la animación de salida
  (`animation: loader-salida 360ms ease 2.9s forwards`) la sobreescribía: al
  retirar la clase el navegador **volvía a pintar** la capa opaca.
- `pageshow`/`visibilitychange` no tenían manejador: si el WebView restauraba la
  página desde su caché (`persisted`), nadie retiraba el loader ni rearmaba el
  arranque.

### Lo corregido en 0.9.12

| Cambio | Archivo |
|---|---|
| `.loader-oculto` con `animation: none` + `visibility: hidden` (la animación ya no puede resucitarla) | `app.css` |
| `alVolver()` en `pageshow` y `visibilitychange`: retira el loader sin condiciones y rearma el arranque (idempotente) | `app.js` |
| `LENTO` tratado como `NUCLEO_OCUPADO` (reintento silencioso, no error) | `app.js` |
| `--version-code` se **lee del manifiesto** y se verifica dentro de la APK | `scripts/compilar.sh` |
| `imprimir(html, formato)` con `PrintManager` (80 mm / 58 mm / A4) | `NativeBridge.java` |
| Columna `ficha TEXT` con migración idempotente (`PRAGMA table_info`) | `src-tauri/src/lib.rs` |
| `boletas` devuelve `items/neto/iva/pago` para reimprimir | `src-tauri/src/lib.rs` |
| Lector EAN-13/EAN-8/UPC-A propio (el WebView no trae `BarcodeDetector`) | `inventario.js` |
| Ficha ampliada, etiquetas «free», filtro y chips | `inventario.js`, `index.html` |
| Impresión con documento propio y botón «Reimprimir» en el historial | `inventario.js` |
| Sync con `/api/inventario` (`accion:"subir"`, upsert por código) | `inventario.js` |
| Prueba del lector EAN: 13/13 | `tests/inventario/ean.js` |

### Nube

| Pieza | Estado |
|---|---|
| `POST /api/inventario` (`asegurar`/`subir`/`bajar`/`resumen`) | desplegado en `https://fabri-api.vercel.app` |
| Tabla `inv_productos` en InsForge | **creada y verificada** (`?diag=1` → `tabla_existe: true`) |
| `asegurar` sin token | permitido a propósito: DDL fijo e idempotente, sin datos |
| Web con loader/login/inventario | `https://fabri-core-web.vercel.app/app/` |
| Guía de 5 pasos + carrito + impresión en la web | misma ficha que la APK (80 mm / 58 mm / A4) |
| Respaldo de la APK en la nube | release `v0.9.12` (asset 4.095.110 B) |
| Workflow de compilación Rust | `.github/workflows/apk-rust.yml` (bloqueado por facturación de GitHub) |
| Escritura verificada de punta a punta | subir 2 → reenviar (upsert) → bajar → resumen → borrar → 401 sin token |

### Documentos nuevos

- `docs/APK.md` — qué es, por qué, tecnologías, compilación local y nube, contrato, versiones y límites.
- `docs/SEGURIDAD-Y-VISION.md` — evaluación de Authelia, FairScan y MediaPipe con decisiones.

### La web ya hace lo mismo que la app

- **Guía de 5 pasos** (`#invPasos`) con anclas `data-guia` — no `#ancla`, porque
  el hash de la URL es el router de pantallas y un ancla lo rompía al recargar.
- **Margen por fila** en la lista: (precio − costo) ÷ precio, y botón «+» que
  lleva el producto a la boleta.
- **Carrito** en memoria con cantidades, neto/IVA despejados igual que el núcleo
  Rust (total ÷ 1,19) y documento imprimible por iframe oculto
  (`invBolDocumento` + `invImprimir`): rollo 80 mm, 58 mm o A4, y «Guardar como
  PDF» con el diálogo del sistema.
- **Prueba de la boleta**: `tests/web/boleta.js` 14/14 (aritmética, carrito
  vacío, cantidades basura, escapado de HTML y los tres formatos). Se agregó al
  workflow.

### Pendiente

- Probar en el teléfono: reabrir desde segundo plano y confirmar que el login responde.
- Pegar `FABRI_API_TOKEN` en el login web (campo «clave de la nube») y subir un producto de prueba.
- Integrar MediaPipe Barcode local (ver `docs/SEGURIDAD-Y-VISION.md` § 3).
- **GitHub Actions está bloqueado por facturación**: los runs mueren en 3 s con
  «the job was not started because your account is locked due to a billing
  issue». No es el workflow (no llega a ejecutar ningún paso). Hay que resolver
  el pago en GitHub → Settings → Billing; después, Actions → APK Rust → Run
  workflow.

### Nota de compilación

El primer APK de esta sesión (4.091.014 B, `7e6e70d4…`) se compiló **antes** de
cambiar el sync a `/api/inventario` y llevaba el contrato viejo. Se recompiló:
el APK bueno es **4.095.110 B**, `b14cd9d3…`, con `api/inventario` dentro
(verificado con `unzip -p`). Código real ya sincronizado al repo en `de23c43`.

---

## Sesión 2026-10-26 (9) · APK 0.9.11 (versionCode 26)

APK: `dist/FABRI-CORE-0.9.11.apk` · **4.082.822 B** ·
sha256 `4d7135641123c4781dc1316501fabc2556add7853c08e7456b1e19965fef3c49`
Copiada a `/storage/emulated/0/Download/FABRI-CORE-0.9.11.apk` (hash idéntico).
Firma: debug (`CN=Debug`), minSdk 24, target 34. Instalar **encima** de la 0.9.10.

### El fallo: loader en 0 % y login muerto

Los dos síntomas eran **el mismo**: el hilo de JavaScript quedaba bloqueado
esperando al núcleo.

- `iniciar()` hacía `api("ping")` + `api("sys")` + `compsActualizar()` +
  `api("manifiestos")` + … **siete llamadas síncronas**, y `NativeBridge.call()`
  esperaba hasta **10 s por operación** a que terminara la migración de SQLite.
  Con el hilo ocupado no corren `setTimeout` ni `requestAnimationFrame`: la
  barra se quedaba en 0 % y el `setTimeout(ocultarLoader)` nunca llegaba.
- `FabriLogin.iniciar()` terminaba con `perfilCargar()`, que lee `usuarios` y
  `perfil` en SQLite: la tarjeta ya estaba pintada (la pinta el motor gráfico),
  pero el hilo seguía bloqueado → **login visible y sin respuesta**.
- Agravantes: `onConsoleMessage` (hilo de interfaz) llamaba al puente de forma
  síncrona; `leerConfig()` hacía cuatro esperas por arranque desde
  `chatEstado()`; `logs`/`revision` crecían sin poda y `fabrick.log` no rotaba.

### Lo corregido

| Cambio | Archivo |
|---|---|
| Espera máxima de 1,2 s; `ping` no espera; `NUCLEO_OCUPADO` en vez de bloquear | `NativeBridge.java` |
| El loader se retira antes de tocar el núcleo; núcleo en el turno siguiente; reintento sin bloquear con `nucleoListo()` | `app.js` |
| `perfilCargar()` diferido; PIN primero contra preferencias | `app.js` |
| Barra y desvanecido por animación CSS; `pointer-events: none` | `app.css` |
| `ColaConsola` (hilo de fondo) para `onConsoleMessage` | `ColaConsola.java` |
| Bitácora de arranque en archivo, sin núcleo | `Bitacora.java` |
| Poda de `logs`/`revision` (3.000) y rotación de `fabrick.log` (512 KB) | `src-tauri/src/lib.rs` |
| F sólida sin relleno `#050505` (el «cuadro negro») | `logo-loader.svg`, `logo-f.svg` |
| Vista **Diagnóstico → Bitácora de arranque** | `index.html`, `app.js` |

### Cómo se diagnostica la próxima vez

`docs/ARRANQUE-Y-ACCESO.md` (documento nuevo) explica la cadena del fallo, las
nueve invariantes del arranque, la tabla de etiquetas de la bitácora y el
checklist previo a tocar el arranque o el login.

En el teléfono: **Menú ☰ → Diagnóstico → Bitácora de arranque**. A los 5 s deja
`loader=`, `login=`, `delegacion=` y `nucleo=`. Si `delegacion=false`, `app.js`
no terminó; si `nucleo` no tiene línea de fin, `init` se colgó.

### Pruebas

`tests/arranque/correr.sh` — 4 bloques: sintaxis, DOM hostil (0 roturas), carga
sin llamadas bloqueantes al puente y loader/logo. Todo en verde.
`tests/seguridad/correr.sh` 23/23 y `validar-manifiestos.sh` 23/23.

## Sesión 2026-10-26 (8) · APK 0.9.10 (versionCode 25)

APK: `dist/FABRI-CORE-0.9.10.apk` · 4.074.630 B ·
sha256 `58fe74c3b04e0539a289367c4b26689c32f7f1189a070e511ebb2359d9727814`
Copiada a `/storage/emulated/0/Download/FABRI-CORE-0.9.10.apk` (hash idéntico).

### La causa real de los botones muertos

El arnés `dom-hostil.js` reprodujo el fallo: **19 llamadas
`document.getElementById("x").addEventListener(...)` en el nivel superior** de
`app.js` (chat, consola, módulos). Si un id no existía en el HTML, la primera
lanzaba `Cannot read properties of null` y **cortaba el script entero**: ni
`FabriLogin` ni el arranque final se ejecutaban. La pantalla quedaba en
«Comprobando acceso…» con el PIN visible (porque el HTML ya lo trae sin
`hidden`) y **ningún botón respondía**.

Corregido con `al(id, evento, fn)`, que devuelve `null` si el elemento no está y
no lanza. El arnés pasa de **19 roturas a 0** y `FabriLogin` queda definido.

### Respaldo del login sin depender de app.js

`index.html` incluye ahora un script de respaldo **antes** de `diagnostico.js`:

- Conecta «Entrar con PIN», «Crear PIN», «Activar huella», «Restablecer acceso»
  y «Modo diagnóstico» directamente al puente nativo.
- Si `app.js` sí cargó, cada manejador de respaldo se retira solo
  (`if (window.__fabriDelegacion) return`), así no hay doble ejecución. El
  retiro se ata a la **delegación de clics realmente registrada**, no a que
  `FabriLogin` exista: si el script muriera entre una cosa y la otra, el
  respaldo sigue activo. El resultado biométrico también cae al respaldo
  (`__fabriRespaldoResultado`) en ese caso.
- A los 6 s, si `window.FabriLogin` no existe, escribe en `#loginEstado` el
  motivo y el último error del escáner (`FabriDiag.ultimo`).

### Tarjeta del operador

- **«Cambiar foto» ya no está en la fila inferior.** La foto
  (`#loginPhotoWrap`) es un botón accesible (`role="button"`, teclado
  Enter/Espacio): al tocarla abre el selector. Hay una pista de texto bajo el
  estado («Toca la foto del operador para cambiarla»).
- **«Activar huella al iniciar»** ocupa el primer lugar de la fila y nace
  visible; sólo se oculta si la huella ya está activada. Si el teléfono no tiene
  huella o el Android es < 28, el botón explica el motivo exacto al tocarlo.
- **Escáner perpetuo**: banda de barrido animada sobre la foto
  (`scan-banda`, 2,9 s) además de la línea fina que responde al PIN. Se detiene
  con `prefers-reduced-motion`.
- **Código de barras real**: `codigoOperador()` deriva un código estable
  `FC XXXX XXXX XX` de indicativo + nombre (FNV-1a + mezcla); `barcodeConstruir()`
  dibuja 32 barras SVG deterministas y escribe el número debajo. El fondo CSS de
  respaldo sólo se ve si el SVG quedó vacío.

### Evidencia de arranque en Java

`MainActivity.onPageFinished` evalúa `window.FabriLogin` y `window.FabriDiag` y
registra el resultado en `revision` (`tipo=arranque`, severidad `error` si
`FabriLogin` no es objeto). `onReceivedError` ahora registra también los
**subrecursos** que no cargan (antes sólo el frame principal), con la URL exacta.

### Verificación

- `node --check app.js` y `diagnostico.js`: OK.
- `dom-hostil.js`: 369 ids, DOM completo carga, **0 roturas**,
  `FabriLogin` definido.
- `login-tarjeta.js` (nuevo): sin «Cambiar foto», huella visible, foto accesible,
  barras dibujadas (32), código `FC 8A86 BB62 5A` estable.
- APK verificada por contenido: 0 `btnLoginFoto`, 1 «Activar huella al iniciar»,
  `barcodeConstruir`/`codigoOperador`/`al(` en `app.js`, `get ultimo` en
  `diagnostico.js`, «scripts de la interfaz» en `classes.dex`.

### Pendiente de confirmación en dispositivo

Instalar 0.9.10 encima y revisar:

1. El login debe mostrar la foto con la banda de escaneo y el código con número.
2. Tocar la foto debe abrir el selector de imagen.
3. «Activar huella al iniciar» debe pedir el PIN y luego la huella.
4. Si algo falla, `DIAG` debe mostrar el error y `revision` debe tener la fila
   `arranque` con `login=object;diag=object`.

## Sesión 2026-10-25 (7) · APK 0.9.9 (versionCode 24)

APK: `dist/FABRI-CORE-0.9.9.apk` · 4.070.534 B ·
sha256 `fc9e0476f7359df9f7cdcbe428fe0b85c537d6d1c785f073858cd6b0a2dd7a90`
Copiada a `/storage/emulated/0/Download/FABRI-CORE-0.9.9.apk` (hash idéntico).

### La causa del cuelgue, encontrada en el HTML

`#loginEntrar` nacía con `hidden`. Si el JavaScript no llegaba al final del
script —por cualquier excepción previa— los dos paneles quedaban ocultos y la
capa mostraba «Comprobando acceso…» para siempre: **la casilla del PIN no
existía en pantalla**. Ahora el panel del PIN está visible en el HTML y sólo se
oculta cuando `app.js` decide mostrar «crear PIN». Un fallo de arranque ya no
deja la pantalla vacía.

### El arranque ya no se puede cortar en cadena

Antes: `iniciar(); chatIniciar(); saludIniciar(); FabriLogin.iniciar();` en
secuencia. Una excepción en `chatIniciar()` cortaba el script y el login nunca
se inicializaba. Ahora cada paso va por `pasoArranque(nombre, fn)`: el fallo se
anota en el escáner y **el login se ejecuta igual**, al final y con su propia
red. Además se eliminó el `capa.hidden = true` del `catch`: era un bypass de
autenticación.

### `initNucleo()` fuera del hilo de interfaz

`onCreate` abría SQLite y migraba el esquema **antes de crear la WebView**. Si
tardaba, la ventana se quedaba negra sin interfaz. Ahora la WebView se crea y
carga primero, y el núcleo arranca en el hilo `nucleo-init`. `NativeBridge.call`
espera al núcleo con tope de 10 s (`CountDownLatch`), así que una llamada
temprana de JavaScript no se pierde ni bloquea para siempre.

### Escáner global con respaldo local (`diagnostico.js`)

Se carga **antes** de `app.js` para capturar también sus errores. Sin
dependencias, con estilos en línea: si el CSS no carga, sigue legible.

- Captura `error` (incluido el de recursos que no cargan), `unhandledrejection`
  y `console.error`.
- Botón flotante `DIAG` con contador de eventos sin leer (a 76 px del borde para
  no tapar los botones del login).
- «Probar todo»: origen, user agent, presencia y métodos del puente,
  `localStorage`, `huellaEstado` y las ops reales (`ping`, `sys`, `perfil`,
  `usuarios`, `inventario`, `revision.resumen`, `manifiestos`).
- «Copiar» usa el puente (`copiar`) y cae a `navigator.clipboard`.
- **Vigilante de arranque**: a los 5 s comprueba si `window.FabriLogin` existe.
  Si no, muestra el panel del PIN y escribe **el error exacto** en
  `#loginEstado`, sin depender de nada más. Si `app.js` cargó pero el estado
  sigue en «Comprobando acceso…», también lo explica y adjunta el primer error.

### Login respaldado en la tabla `usuarios`

La base no tenía tabla de usuarios: el PIN vivía sólo en `SharedPreferences`.

- Tabla `usuarios` (usuario, nombre, indicativo, foto, rol, algoritmo, sal,
  hash, iteraciones, activo, creado, ultimo_acceso). El perfil existente se
  refleja como usuario `operador` en la migración.
- `op_usuarios` con `listar`, `verificador`, `crear`/`sincronizar`,
  `ultimo_acceso`, `actualizar`, `borrar` y `resumen`. Nunca se guarda el PIN en
  claro: sólo el verificador PBKDF2.
- Al crear el PIN, `Huella.configurarPin` devuelve algoritmo, sal, hash e
  iteraciones; la interfaz los guarda en `usuarios`. Si eso fallara, el PIN
  sigue funcionando y queda el aviso en `revision`.
- **Respaldo real**: si las preferencias del teléfono perdieron el PIN pero la
  base tiene el verificador, el login ofrece el PIN y verifica con
  `huellaVerificarPinExterno` (mismo PBKDF2 y **mismo bloqueo por intentos**).
  Un PIN incorrecto **nunca** prueba la base: eso duplicaría los intentos y
  saltaría el bloqueo.
- La tarjeta del login lee nombre, indicativo y foto de `usuarios` (con `perfil`
  como respaldo), y `entrar()` registra `ultimo_acceso`.
- `K_PIN_ALGO` se guarda en las preferencias: en SDK < 26 el Keystore sólo
  ofrece PBKDF2-SHA1 y verificar con SHA-256 habría dejado fuera a esos equipos.

SQL verificado en sqlite3 real: crear conserva el nombre, y un `sincronizar` sin
hash **no** borra el verificador.

### Sincronización del inventario: automática y con reintento

Antes sólo corría si el usuario pulsaba «Sincronizar». Ahora:

- Reintento cada 60 s cuando hay nube configurada, con espera creciente
  (1, 2, 4… hasta 30 min) y tope de fallos.
- Se adelanta al volver del segundo plano y al recuperar conexión (`online`).
- En segundo plano (`document.hidden`) no gasta red.
- El camino silencioso **no usa `api()`**: no llena `revision` con un fallo por
  minuto; registra sólo la recuperación.
- Se marca `sync_ts` únicamente tras un HTTP correcto. Si `sync_marcar` falla,
  el lote se considera no sincronizado (antes se ignoraba el resultado).
- Sin nube configurada se sigue exportando el lote a un archivo y se explica,
  sin fingir éxito.

### Arneses

- `/tmp/opencode/respaldo.js`: **17/17** (crear PIN y guardarlo en `usuarios`,
  preferencias perdidas + verificador en base, PIN correcto por base, PIN
  incorrecto que no cae a la base, app.js sin arrancar, login sin actualizar
  estado).
- `/tmp/opencode/salud.js`: 16/16. `/tmp/opencode/arranque.js`: verde.
- `tests/seguridad/correr.sh` 23/23 y `validar-manifiestos.sh` 23/23.

## Sesión 2026-10-25 (6) · APK 0.9.8 (versionCode 23)

APK: `dist/FABRI-CORE-0.9.8.apk` · 4.054.079 B ·
sha256 `7566bafe240b28b44286a2dc4bcfea5c46e68a37692ef6fefb547497db59d6e8`
Copiada a `/storage/emulated/0/Download/FABRI-CORE-0.9.8.apk` (hash idéntico).

### La interfaz deja `file://` y pasa a un origen https propio

En `file:///android_asset/` el WebView **bloquea `fetch()`, los módulos ES y la
compilación de WebAssembly**: justo lo que necesita el runtime de visión. La
salida elegida (opción 1) es `https://appassets.local/`, servido por
`ActivosWeb.java` con `shouldInterceptRequest`, sin abrir ningún puerto y sin
depender de `androidx.webkit` (que exigiría un AAR en un pipeline sin Gradle).

- `ActivosWeb` traduce `/` → `assets/www/` y `/componentes/` →
  `filesDir/componentes/` (para los modelos ya descargados).
- MIME explícito; `.wasm` va como `application/wasm` (con otro MIME el WebView
  rechaza la compilación en streaming) y los pesos (`.task`, `.tflite`) como
  `application/octet-stream`.
- Sin traversal: se rechazan `..`, barras invertidas y rutas absolutas; en
  `componentes/` se compara la ruta canónica contra la raíz.
- `Cache-Control: no-cache` para que un update de la APK se vea de inmediato.
- **Red de seguridad**: `onReceivedError` de la ventana principal vuelve a
  `file:///android_asset/www/index.html`. Se pierden fetch/WASM, pero la app
  abre en vez de quedarse en blanco.
- `setAllowContentAccess(true)`: el selector de fotos del login entrega
  `content://` y sin esto la foto elegida nunca llegaba a la página.
- `setMixedContentMode(MIXED_CONTENT_ALWAYS_ALLOW)`: con el origen https, la
  sincronización del inventario hacia un servidor propio por `http` (LAN)
  habría quedado bloqueada en silencio por ser contenido mixto. Antes, en
  `file://`, no había esa restricción. El tráfico en claro sigue acotado por
  `network_security_config` y por `normalizarBase()` en el núcleo.
- Efecto secundario buscado: `fetch()` a las APIs libres del inventario ahora
  sale con un origen real (`https://appassets.local`), así que el CORS puede
  resolverse; antes el origen opaco lo impedía.

Verificado por contenido, no por fecha: el `classes.dex` de la APK contiene
`appassets.local` y `ActivosWeb`.

### Vigilancia automática: ping y consulta de errores

`saludIniciar()` comprueba el núcleo **cada 45 s** y consulta el resumen de
`revision`; se pausa en segundo plano (`document.hidden`) y se adelanta al
volver con `visibilitychange`.

- **No usa `api()`**: `api()` anota en `revision` cada operación fallida, y un
  ping caído cada 45 s llenaría la tabla de ruido y taparía el error original.
  Llama al puente en crudo y registra **sólo el cambio** de estado.
- Primera lectura = línea base (no registra nada). Avisa cuando el total de
  errores **sube**, con el número de nuevos.
- Al tercer fallo seguido avisa en pantalla; al recuperarse relanza `sys`,
  repinta el inicio y registra la vuelta.
- El piloto de la cabecera pasa a `núcleo activo · N errores` (clase
  `.pill-warning` nueva) y lleva en el `title` la hora y la latencia del ping.
- Arnés `/tmp/opencode/salud.js`: **16/16** en cinco escenarios (sano, subida
  de errores, caída, caída persistente, recuperación). Encontró un fallo real:
  la primera comprobación (`antes === null`) se contaba como recuperación.

### Módulo de visión: manifiestos ya registrados

`modelo-face-landmarker` y `modelo-efficientdet-lite0` entran en `MANIFIESTOS`
(`src-tauri/src/lib.rs`), así que aparecen como módulos descargables con hash
verificado. El runtime que los consume va en el WebView y se integra en el
inventario (opción 3): la malla del login sigue siendo SVG, sin MediaPipe.

## Sesión 2026-10-25 (5) · APK 0.9.7 (versionCode 22)

APK: `dist/FABRI-CORE-0.9.7.apk` · 4.049.983 B ·
sha256 `c1df308f5aa16430c5c13d33ea6f2e9515ae8d5fac78530359bf57ab7bbde4b4`
Copiada a `/storage/emulated/0/Download/FABRI-CORE-0.9.7.apk` (hash idéntico).

### Pantalla negra: causa real y arreglo

No era el login ni el JavaScript. El **renderer de Chromium es un proceso
aparte** y es lo primero que Android mata cuando falta memoria; en esta sesión
se midieron **92 MB libres** con `npm install omniroute` (383 MB) y dos
procesos de OpenCode corriendo. Sin `onRenderProcessGone`, la WebView queda
muerta y la app muestra negro para siempre aunque el proceso siga vivo.

- `MainActivity.WebViewClient` implementa ahora `onRenderProcessGone`:
  registra el hecho en `revision`, avisa con un `Toast` y llama a `recreate()`
  para que la interfaz vuelva sola (el estado real vive en SQLite). Devuelve
  `true` para que el sistema no mate la actividad.
- `onTrimMemory` ya **no libera el GGUF en el hilo de interfaz**: liberar
  cientos de MB ahí bloquea el dibujado y produce ANR (la otra forma de llegar
  a la pantalla negra). Ahora el trabajo va a un hilo `trim-memoria` con un
  `AtomicBoolean liberando` que impide dos liberaciones simultáneas.

### Login con foto, malla facial y escaneo

- Tabla `perfil` (fila única `id = 1`: nombre, indicativo, foto, actualizado) y
  operación `perfil` con acciones `obtener` / `guardar` / `borrar_foto`.
- La foto se guarda como **data URL JPEG reducida a 256 px** (~20 KB), no el
  original: el núcleo rechaza cualquier cosa que no empiece con `data:image/`
  o que supere 900 KB.
- `mallaConstruir()` dibuja la malla facial con líneas y círculos SVG sobre una
  elipse deformada (frente y mentón angostos), sin dependencias.
- El escaneo (línea fina + esquinas pulsando + etiqueta `ESCANEANDO…`) se
  activa con `focus`/`input` en los campos de PIN y mientras el sistema espera
  la huella; se apaga en `resultado()`.
- **Auto-prompt de huella**: al abrir y al desbloquear por inactividad se pide
  la huella sola si está activada (`autoHuellaHecha` evita repetirla y
  `bloquear()` la rearma). El token sigue siendo aleatorio, cifrado con una
  clave AES del AndroidKeyStore ligada a biometría.
- **Red de seguridad del login**: si `aplicar()` falla o responde con error,
  se muestra igual el panel del PIN. Nunca queda en «Comprobando acceso…».
  Verificado con el arnés `/tmp/opencode/arranque.js` en dos escenarios
  (estado normal y `huellaEstado` devolviendo error).

### Módulo de visión: manifiestos preparados

- `manifiestos/modelos/modelo-face-landmarker.json` (3.758.596 B,
  sha256 `64184e22…bc9ff`) y `modelo-efficientdet-lite0.json`
  (7.254.339 B, sha256 `4b591000…80993`), descargados de
  `storage.googleapis.com/mediapipe-models` y validados por el validador
  (23/23). **Todavía no están registrados en `MANIFIESTOS`**: se hace en 0.9.8
  junto con el runtime que los consume.
- Límite de diseño confirmado: Android 10+ (W^X) prohíbe ejecutar `.so`
  descargados, así que el runtime de visión debe vivir dentro del WebView
  (JS/WASM) y el módulo descargable es el **modelo**. Es la misma regla que ya
  documenta `src-tauri/src/modulos.rs`.

## Sesión 2026-10-25 (4) · APK 0.9.6 (versionCode 21)

APK: `dist/FABRI-CORE-0.9.6.apk` · 4.041.791 B ·
sha256 `1d42d2865cd06b4a3e629ca6a22f55ff8a9cb1bbee2bfe624e9ae126b3cb0f07`
Copiada a `/storage/emulated/0/Download/FABRI-CORE-0.9.6.apk` (hash idéntico).

### Los tres bugs, corregidos en origen

1. **La IA local se quedaba «cargando» para siempre.**
   `RuntimeNativo` usaba `synchronized`, así que una carga colgada bloqueaba
   para siempre el hilo que pedía el estado: la UI no podía ni preguntar.
   Ahora hay un `ReentrantLock` con timeout (`tomarCandado(ms)`), los campos de
   estado son `volatile` y `estado()` responde **sin candado** con
   `cargando`, `cargando_ms`, `colgada` (`COLGADA_MS = 45000`) y `abandonada`.
   `NativeBridge.localAbandonarCarga()` permite soltar el modelo. En JS,
   `chatVigilarCargaLocal()` revisa cada 2 s y `chatCargaLocalColgada()` ofrece
   abandonar; el vigilante se limpia en `FabriChat.localCargado` y en
   `chatLiberarModeloLocal`.

2. **La app pedía descargar dos veces lo ya descargado.**
   La base decía `PENDIENTE` aunque el archivo estuviera en disco con su recibo.
   `compsActualizar()` ahora cruza los componentes con
   `descargasEstado()` (que escanea `filesDir/componentes/<id>/*.recibo.json`),
   corrige la base y marca `.chip-verificado`. La acción `estado` del núcleo
   pasó de UPDATE a **UPSERT**, así que un id sin fila ya no se pierde.
   El modal muestra «Descarga en disco», «URL de descarga», «Descarga
   habilitada» y un botón para copiar la URL de lo que falte.

3. **La app se cerraba al salir.**
   `KEYCODE_BACK` desde el inicio llamaba a `finish()`. Ahora
   `moveTaskToBack(true)`: la tarea va al fondo, la app sigue viva y al volver
   aparece en la misma vista. Además `onTrimMemory` libera el GGUF **antes** de
   que el kernel mate el proceso, y el manifest declara
   `alwaysRetainTaskState="true"` y `configChanges` ampliado
   (`uiMode|density|fontScale`).

### Chat rediseñado con el lenguaje de LobeChat, sin la librería

Se midió `@lobehub/ui@6.9.0` antes de decidir: **8,1 MB** sin empaquetar,
3.808 archivos, React 19 + `motion` + `@splinetool/runtime`, **49 dependencias**.
Incompatible con una app vanilla sobre `file://` y ~1–2 MB de JS extra en un
teléfono donde el kernel mata al proceso con más RSS. Se replicó el **diseño**:

- el asistente no va en burbuja: texto sobre el fondo, como documento
- el usuario sí: burbuja gris a la derecha (radio 16/16/4/16)
- compositor flotante `sticky` con `backdrop-filter`, el único con sombra
- avatar de 28 px con estados `idle`/`thinking`/`talking`
- bloques de código con cabecera de lenguaje y botón copiar
- markdown mínimo: títulos, listas, negrita, código en línea
- pie del mensaje (hora + copiar/leer) que se revela al hover
- botón «nueva conversación» en la cabecera
- tipografía 14 px / 1.62; respeta `prefers-reduced-motion`

### Vista «Flujo en tiempo real» (`v-flujo`)

Mapa vertical del pipeline con **estado real**, no inventado: núcleo Rust
(`ping`), SQLite (`sqlite.tablas`), inventario (`resumen`), APIs libres (bajo
demanda), IA local (`localEstado`), IA remota (`chatEstado`), nube
(`localStorage`), puente Termux (`termuxEstado`) e impresión. Refresco cada 5 s
con interruptor «Auto», KPIs (nodos activos, errores, avisos, descargas
verificadas) y lista de fallos leída de `revision` con hora, origen y ms.
Si un nodo no se puede comprobar, lo dice en vez de mostrarse verde.

### Consola interactiva del teléfono

`termux-puente.py` sube a **v1.1.0** con `POST /comando`: shell libre para la
consola de la APK. Guardas: sólo loopback, token obligatorio, cuerpo ≤ 8 KB,
comando ≤ 4000 caracteres, timeout 25 s, salida tope 60 KB, denylist de
operaciones irreversibles y registro en `~/fabrick-comandos.log`.
Lado Java: `TermuxPuente.comando()` + `NativeBridge.termuxComando()`.
Lado JS: `flujoEjecutar()` / `flujoRecibir()`, historial ↑↓ y atajos (RAM,
disco, procesos, log del puente). `FabriTermux.recibir` enruta `r.libre` al
terminal del flujo. La bottomnav queda en 5 (inicio, chat, inventario, flujo,
consola); Módulos y Diag siguen en el drawer.

### Pruebas de esta sesión

- `node --check` OK en `app.js`, `flujo.js`, `inventario.js`.
- `javac` contra `android-34/android.jar` → exit 0.
- `python3 -m py_compile scripts/termux-puente.py` OK.
- Puente probado en vivo: comando libre OK, `rm -rf /` denegado, sin token 403.
- `bash tests/seguridad/correr.sh` → **23/23**.
- `bash tests/seguridad/validar-manifiestos.sh` → **21/21**.
- `unzip -l` confirma en la APK: `flujo.js` (14.385 B), `flujo.css` (7.117 B),
  `inventario.js` (42.970 B), `inventario.css` (12.952 B) y
  `termux-puente.py` v1.1.0.
- `aapt2 dump badging`: `versionCode='21' versionName='0.9.6'`, permisos
  `INTERNET`, `REQUEST_INSTALL_PACKAGES`, `CAMERA`, cámara `required="false"`.

### Pendiente

- **MediaPipe**: la descarga supera los 50 MB y necesita autorización explícita.
- Revocar el token de Vercel expuesto (`https://vercel.com/account/tokens`).
- El puente debe arrancarse una vez desde Termux (sin Termux:Boot;
  `RUN_COMMAND` es `signature`).

## Sesión 2026-10-25 (3) · APK 0.9.5 (versionCode 20)

APK: `dist/FABRI-CORE-0.9.5.apk` · 4.029.372 B ·
sha256 `dd2856554facab2a6349f865b761a7af8d0f0d3282a2832b97200e1a521af906`

Módulo de **Inventario guiado** completo: `inventario.js` (42.970 B) +
`inventario.css` (12.952 B) + vista `v-inventario`, con backend Rust
`op_inventario` sobre `fabrick.db` y las tablas `inv_productos`, `inv_precios`,
`inv_movimientos` e `inv_boletas`. Acciones: `listar`, `guardar`, `borrar`,
`buscar_codigo`, `precio_agregar`, `precios`, `margen`, `movimiento`,
`resumen`, `boleta_crear`, `boletas`, `exportar`, `sync_pendientes`,
`sync_marcar`. Flujo por pasos: escanear → lista → envío a base → comparación
de precios → tabla con calculadora y márgenes → detalle → categoría →
animación de envío → impresora de boleta/factura. El CSV exportado lleva BOM
`\uFEFF` para que Excel respete los acentos.

## Sesión 2026-10-25 (2) · APK 0.9.4 (versionCode 19)

APK: `dist/FABRI-CORE-0.9.4.apk` · 3.984.175 B ·
sha256 `5ef5af9f251b774249090de30207eea8381ac8151edf2cc84a4a580520a1023b`
Copiada a `/storage/emulated/0/Download/FABRI-CORE-0.9.4.apk`.

### Causa raíz del «Script error.» (12 veces en campo)

`pintarVerificadorGlobal()`, `pintarDispositivo()` y `pintarModelos()` usaban
`g.items`, `g.dispositivo`, `g.recomendados`… pero `g` sólo existía como
`const g = estadoApp.global` **dentro** de `pintarInicio()`. Cada vez que el
núcleo respondía (y por tanto `pintarInicio()` no salía por el `return`
temprano), las tres funciones lanzaban `ReferenceError: g is not defined`.
El WebView, en origen `file://`, no expone el detalle: lo reportaba como
`excepción no capturada: Script error.` con `?:0:0`. Explica exactamente los
errores al entrar a **inicio** y a **diag** (`cargarDiagnostico()` termina
llamando a `pintarInicio()`).

Arreglado con `const g = estadoApp.global` en cada función. Verificado con un
arnés en Node (`/tmp/opencode/smoke-app.js`) que evalúa `app.js` con un DOM
falso: contra el `app.js` de 0.9.3 da **5 fallos** (`ReferenceError: g is not
defined`), contra el de 0.9.4 da **0**.

### Otros bugs corregidos en esta sesión

1. **`pintarModelos` estaba definida dos veces** (tabla de recomendados del
   inicio y lista de detectados de la vista Modelos). La segunda anulaba la
   primera: la tabla de recomendados nunca se pintaba. La de la vista Modelos
   pasó a `pintarModelosDetectados()`.
2. **«Acceder con huella» visible con la huella sin activar.** `.btn` define
   `display`, y eso gana sobre el `display:none` implícito de `[hidden]`. Se
   añadió `[hidden] { display: none !important; }` a `app.css` y el botón nace
   `hidden` en el HTML (junto al separador «o usa tu PIN», que también se
   oculta si no hay huella). Los 3 clics que dieron `HUELLA_NO_ACTIVADA` ya no
   son posibles.
3. **`ping -4` / `ping -6` no existen en el ping de Termux.** `red` y `red6`
   devolvían el `Usage:` y parecían una caída de red. Ahora `ping -c 2 -W 2`
   (la dirección ya fija la familia) y `ping6` con respaldo a `ping -6`.
4. **Modelo de embeddings cargado como chat** (`bge-small-en-v1.5`): llama.cpp
   devolvía `0 tokens en 0 ms` y se registraba como `info`. Ahora se bloquea en
   tres capas: `NativeBridge.rutaModeloValida()` (autoritativa, error
   `MODELO_EMBEDDINGS`), `chatCargarModeloLocal()` y la lista del selector
   (`embeddings, no sirve para chat`, no elegible). Y una respuesta con 0
   tokens se registra como **error** con la causa probable.
5. **Etiqueta de clic inútil** (`clic: btn`, `clic: elemento`): ahora usa
   `textContent` recortado a 34 caracteres como respaldo (`clic: «Ver
   recomendados»`).
6. **Ruido en `revision`**: los clics repetidos en el mismo control dentro de
   1,2 s se deduplican (antes un doble toque generaba dos entradas).
7. **Errores sin stack**: `jsError(e, donde)` registra `e.message` + `e.stack`
   aplanado; el handler global usa `ev.error` cuando existe y `navegar()` aísla
   cada rama en try/catch, así el próximo fallo llega con función y línea.

### Pruebas de esta sesión

- `bash tests/seguridad/correr.sh` → **23/23**.
- `bash tests/seguridad/validar-manifiestos.sh` → **21/21**.
- `node --check app.js` → OK. Sin funciones duplicadas (`uniq -d` vacío).
- Arnés Node contra `app.js` dentro de la APK → **6/6 OK**.
- `aapt2 dump badging` → `versionCode=19 versionName=0.9.4 minSdk=24 targetSdk=34`.

### Pendiente

- Instalar 0.9.4 en el teléfono y revisar `v-revision`: los errores nuevos
  deben traer stack (función + línea) en vez de `Script error.`
- Recompilar el puente si se edita `scripts/termux-puente.py`: la copia que usa
  Termux (`~/termux-puente.py`) es independiente de la que va en los assets.

## Sesión 2026-10-25 (1) · APK 0.9.3 (versionCode 18)

APK: `dist/FABRI-CORE-0.9.3.apk` · 3.980.079 B ·
sha256 `83539795f567f0f17971e2dc53c297d2ddfa9ab6f74d5939730ebe437575c64b`
Copiada a `/storage/emulated/0/Download/FABRI-CORE-0.9.3.apk`.

### Diagnóstico real de los tres fallos reportados

1. **Terminal → Termux no funcionaba.** Causa medida: el permiso
   `com.termux.permission.RUN_COMMAND` de Termux 0.119 tiene
   `protectionLevel=0x00000001` (**signature**), verificado con
   `aapt2 dump xmltree`. Esta APK, firmada con otra clave, no puede obtenerlo
   nunca: el Intent falla en silencio. No es un bug de FABRI-CORE.
   Solución: puente loopback `127.0.0.1:8787` con lista blanca de 13 comandos
   (`scripts/termux-puente.py`, sólo stdlib). La APK manda un **id**, nunca shell.
   Verificado en el equipo: `/estado` responde, `ping` devuelve `puente-ok`,
   token incorrecto da `403 TOKEN`, `rm -rf /` da `NO_PERMITIDO`.
2. **Descargas que no avanzaban.** Causa: IPv6 resuelve pero no conecta en esta
   red; Java intentaba las direcciones AAAA primero y se quedaba hasta el
   timeout. Además el botón «Descargar» de la página **Modelos** sólo mostraba un
   aviso: nunca llamaba al descargador. Ahora `Red.forzarIPv4()` se ejecuta en el
   `static` del puente y en `onCreate`; el botón abre el modal real del
   componente (HTTPS + SHA-256 + tamaño + doble toque sobre 50 MiB).
3. **LLM lento / respuestas que no llegaban.** El chat pedía 512 tokens con
   `n_ctx=2048`; en un teléfono de 4 GB eso compite con la app. Ahora 192 tokens
   y `n_ctx=1024`. Se mide **tok/s reales** con `r.ms` y `r.tokens` del runtime y
   se muestran en el mensaje. Botón de enviar = cancelar: la inferencia no se
   puede abortar a mitad, así que se descarta el texto al llegar (y se dice).

### Añadido

- `Huella.java` + `HuellaBiometrica.java`: PIN PBKDF2-SHA256 (80.000 iteraciones,
  sal aleatoria, bloqueo 60 s tras 8 fallos) y huella con clave AES del
  `AndroidKeyStore` creada con `setUserAuthenticationRequired(true)` e
  `setInvalidatedByBiometricEnrollment(true)`. Sin biometría el keystore no
  descifra: la verificación es real, no un booleano de JavaScript.
- Login de marca: ID card v5 (malla 10 px, línea de escaneo, esquinas, sello,
  código de barras CSS), panel de PIN y de huella, `prefers-reduced-motion`.
- Re-bloqueo: Android a los 5 min en segundo plano (`onStop`/`onResume`) y
  temporizador de inactividad en la interfaz.
- Tabla `revision` en SQLite (tipo, severidad, origen, mensaje, detalle, ms) y
  ops `revision.registrar` / `.listar` / `.resumen`. La vista **Revisión y
  pruebas** muestra KPIs, filtros y exporta JSON. Se registran clics, errores de
  `api()`, operaciones > 900 ms, excepciones globales y promesas rechazadas.
- Vista de red real: sockets TCP/443 por familia a Hugging Face, OpenAI y GitHub,
  con veredicto sobre IPv6.
- `TermuxPuente.java`, `Red.java`; `NativeBridge` con `termux*`, `copiar`,
  `redDiagnostico`, `huella*`.
- 4 manifiestos nuevos con hash y tamaño reales de Hugging Face: SmolLM2 135M
  Q4_K_M (105.454.144 B) y Q2_K (88.201.792 B), Qwen2.5 0.5B Q2_K (415.182.688 B)
  y all-MiniLM-L6-v2 Q4_K_M (20.999.104 B). `MANIFIESTOS` pasa a 8 `include_str!`.
- `op_manifiestos` y `op_componentes` fusionan `filesDir/manifiestos/**`
  (manifiestos dinámicos, sin recompilar) y deduplican por id.
- `op_modelos_recomendados` derivado de los manifiestos descargables: antes eran
  ids sueltos que no existían en el catálogo, por eso ningún modelo nuevo se
  podía bajar.
- Logo e icono: marca sólida v5 (3 paths), `logo-f.svg`, `logo-loader.svg`,
  `ic_launcher_foreground.xml` en zona segura y PNG en 5 densidades.
- `.logo-wrapper` no tenía regla CSS: el SVG se dibujaba a 300×300 y empujaba el
  inicio. Ahora marco de 96 px.

### Pruebas ejecutadas

- `bash tests/seguridad/correr.sh` → **23/23**, 0 fallos.
- `bash tests/seguridad/validar-manifiestos.sh` → **21/21**, 0 fallos
  (incluye los 4 manifiestos nuevos).
- `cargo check --target aarch64-linux-android --release` → OK, 1 warning
  preexistente (`lib.rs:1321`).
- `javac` contra `android-34/android.jar` → OK.
- `node --check app.js` → OK.
- `aapt2 dump badging` → `versionCode=18 versionName=0.9.3 minSdk=24 targetSdk=34`.
- Puente Termux probado de punta a punta (arriba).

### Pendiente / bloqueado

- Instalar la APK y probar en el dispositivo: huella, PIN, puente, descarga.
- El puente se arranca **una vez desde Termux** (botón «Copiar instalador» →
  pegar). Sin Termux:Boot no hay auto-arranque.
- Descargar un modelo >50 MiB exige autorización explícita del usuario.
- Revocar el token de Vercel expuesto antes (ver más abajo).

## Hecho

- Fase 0: auditoría del dispositivo (`MEMORIA.md`).
- Fase 1: contenedor instalado (`cl.fabrick.core`, APK 0.1.0).
- Fase 3 · auditoría: 8 componentes clasificados con datos verificados (`docs/fase-3/auditoria.md`).
- Fase 3 · implementación:
  - Validador de manifiestos en Rust (`src-tauri/src/manifiesto.rs`) + CLI (`tools/validador`).
  - Descargador verificable en Java (`android/java/cl/fabrick/core/Descargador.java`).
  - Manifiestos reales en `manifiestos/` (runtime, qwen, bge, sqlite-vec).
  - APK 0.2.0 con `INTERNET` y operación `manifiestos`: `dist/FABRI-CORE-0.2.0.apk`
    (852.685 B, sha256 `9452818b…73e0c7f`).
  - Descargas autorizadas (565,5 MiB) con hash correcto en `componentes/`.
  - Pruebas: **23/23** descargador y **17/17** manifiestos.
  - Runtime verificado en el equipo: `llama-cli --version` → build 11835;
    inferencia en español a 14,1 t/s con el Qwen oficial.
- Fase 3 · kit v2 (2026-10-23):
  - Kit adoptado en `docs/kit/` (README, prompt maestro, roadmap, selector,
    esquema SQL/RAG y arquitectura InsForge) y skill instalada en
    `~/.config/opencode/skills/fabricore-architect/SKILL.md`.
  - `NativeBridge.java`: descarga en segundo plano con progreso, cancelación,
    reintento, validación de URL/hash/tamaño y sonda `t0()` (W^X).
  - `op_manifiestos` ampliada: nombre, descripción, origen, sha256, arquitectura,
    dependencias, directorio, interfaz y salud.
  - `app.js` + `index.html`: los botones se habilitan sólo con manifiesto válido y
    `habilitacion.descargar`; confirmación explícita sobre 50 MiB; progreso real,
    cancelación y persistencia del estado verificado. Botón de sonda T0 en Diagnóstico.
  - APK 0.2.2: `dist/FABRI-CORE-0.2.2.apk` (860.877 B,
    sha256 `1e806a65…f618c5`), copiada a `/storage/emulated/0/Download/`.
  - Pruebas tras el cambio: **23/23** y **17/17**, 0 fallos.

- Fase 3 · OmniRoute (APK 0.3.0, 2026-10-23):
  - Auditoría verificada: MIT, TypeScript/Next.js, `engines` Node
    `>=22.22.2 <23 || >=24 <27`, npm 3.8.52 descomprimido 461.386.234 B
    (29.296 archivos, 92 deps), tarball **114.391.796 B**, puerto 20128,
    API `/v1` con `Authorization: Bearer`.
  - Veredicto: **no se puede alojar dentro de la APK** (servidor Node/Next + W^X).
    La app implementa el rol de cliente.
  - `NativeBridge`: `omniEstado/Guardar/Probar/Chat` con `HttpURLConnection` en
    hilos de fondo, normalización de URL y rechazo de `http://` no loopback.
  - UI Diagnóstico: panel OmniRoute (URL, clave, modelo, probar, chat de prueba,
    copiar instalación de Termux). La clave no vuelve a la página ni al log.
  - `network_security_config.xml`: cleartext **sólo** loopback.
  - APK 0.3.0 compilada y firmada: `dist/FABRI-CORE-0.3.0.apk` (848 KB).
  - Pruebas: **23/23** y **17/17**, `node --check` OK, `networkSecurityConfig`
    presente en el manifiesto compilado.
  - Documento: `docs/fase-3/omniroute.md`.
  - Runtime nativo A1–A3: `runtime/llama-b11835/` ya tiene las 5 `.so` stripped,
    headers del tag `b11835` y el shim C compilado, **pero no se empaquetó** aún.
- Fase 3 · ecosistema (2026-10-23):
  - Auditoría de 13 repos (GraphRAG, LlamaIndex, sentence-transformers, ExecuTorch,
    MediaPipe, Tauri, RAGFlow, Chroma, Qdrant, Authelia, FairScan, MCP rust-sdk,
    mcp-go) con lenguaje, licencia y tamaño reales de la API de GitHub.
  - Decisión por capas en `docs/fase-3/ecosistema.md`: Rust embebido (llama.cpp,
    sqlite-vec, rmcp), servicios externos (OmniRoute, Qdrant, RAGFlow, Authelia,
    mcp-go) y artefactos verificados (`tipo: datos`) para GraphRAG/LlamaIndex.
  - FairScan se integra por Intent `org.fairscan.app.action.SCAN_TO_PDF` (GPL-3.0:
    no se copia código).
  - MCP: dentro de la APK sólo transporte HTTP; stdio exige `exec` (bloqueado).
  - Tauri se deja como opción futura: el shell WebView+JNI actual ya está probado.
- Fase 3 · módulos/plugins (APK 0.4.0, 2026-10-23):
  - Motor de módulos en Rust (`src-tauri/src/modulos.rs`): tabla `modulos`
    (manifiesto JSON + estado) y tabla `vectores` (f32 LE + metadatos).
  - Los módulos son **declarativos**: no traen código; declaran capacidades y el
    núcleo implementa las operaciones seguras. Se descarta `dlopen` de descargas
    (W^X + superficie de ataque).
  - Capacidades: `texto.dividir`, `plantilla.render`, `vector.indexar`,
    `vector.buscar` (coseno en Rust, k≤20, 20.000 filas), `archivo.analizar`
    (ELF/PE/ZIP-APK/GGUF/PDF/JSON/JS/texto, cabecera ELF, cadenas, ruta
    confinada a `dataDir`, 64 MiB).
  - Cuatro módulos incluidos: `vector-local` (Qdrant/Chroma), `rag-basico`
    (LlamaIndex/RAGFlow), `ingesta-local` (RAGFlow) y `analisis-local` (REA).
  - UI: vista **Módulos** (6º ítem del nav) con lista, capacidades, límites y
    ejecutor JSON. `navegar("modulos")` recarga.
  - Skill local `~/.config/opencode/skills/fabricore-modulos/SKILL.md` con el
    catálogo de repos que no corren en Android y su sustituto.
  - `modulos/publicar.sh`: exige una URL base HTTPS real, valida los módulos,
    calcula SHA-256/tamaño y genera `modulos/catalogo.json` +
    `manifiestos/modulos/*.json` (tipo `datos`, validados con `tools/validador`).
  - Documento: `docs/fase-3/modulos.md`.
  - APK 0.4.0 compilada y firmada: `dist/FABRI-CORE-0.4.0.apk` (893.726 B,
    sha256 `66aa9b2825edfeb49d184b7ac72fb4153bbfd38d6522fa66097343cbac392f01`).
  - APK 0.4.1 (importación de módulos): `dist/FABRI-CORE-0.4.1.apk`
    (897.822 B, sha256
    `99ef1f4cdc62e7c1bed53cc6626e87362b4cfce9e64e221dfe629491bb65c787`),
    copiada a `/storage/emulated/0/Download/`.
  - Importación: `modulos.importar` valida id/tipo/capacidades/límites/tamaño y
    hace upsert; la UI tiene «Importar módulo (.json)» con selector SAF
    (`onShowFileChooser` + `onActivityResult` en `MainActivity`).
  - Los 4 módulos de ejemplo se copiaron a
    `/storage/emulated/0/Download/fabrick-modulos/` para probar la importación.
  - Pruebas tras 0.4.1: **23/23** y **17/17**, `node --check` OK.
  - Pruebas tras el cambio: **23/23** y **17/17**, `node --check` OK; la APK
    contiene la vista `v-modulos` y el `.so` con las capacidades nuevas.
  - Pendiente: probar en pantalla, embeddings reales, GraphRAG, WASM y publicar
    los módulos en un repo GitHub propio (no hay repo ni token: no se inventan
    URLs ni hashes).

- Fase 3 · menú lateral, páginas e instalación (APK 0.5.0, 2026-10-23):
  - Diagnóstico de «la descarga se completa pero no instala»: el botón
    `Instalar` estaba deshabilitado a mano en `actualizarBotonesModal()` y no
    existía ninguna operación de instalación en el núcleo. Se separó el
    significado: descargar/verificar ≠ instalar; ejecutables y modelos siguen
    bloqueados por T0/W^X hasta A1–A3.
  - `modulos.instalar`: valida el componente, lee sólo `.json` de hasta 64 KB
    dentro de `filesDir/componentes/<id>/`, importa el manifiesto y marca el
    componente como `INSTALADO`. No ejecuta nada.
  - La UI habilita «Instalar módulo» para `datos`/`plugin`/`pagina` ya
    verificados y auto-instala al terminar la descarga. Para modelos muestra el
    motivo real (A1–A3) en vez de un botón mudo.
  - Menú lateral (☰) con «Ahora» y «Por construir»; cada página abre una vista
    con descripción, secciones, estado, instrucciones copiables y manifiesto
    JSON copiable.
  - 8 páginas `tipo: pagina`: memoria, grafo, voz, visión, automatizaciones,
    MCP, ajustes y ayuda (`modulos/paginas/`). Se siembran en SQLite y no se
    ejecutan como módulos.
  - `plugins/` con copias de los 4 módulos y las 8 páginas + `LEEME.md`; el
    script `modulos/publicar.sh` ahora genera `plugins/catalogo.json` y
    `manifiestos/{modulos,paginas}/` con hashes reales, exigiendo URL base.
  - Docs: `docs/fase-4/paginas-y-menu.md`; skill `fabricore-modulos`
    actualizada. Los JSON también se copiaron a
    `Download/fabrick-modulos/paginas/` y `Download/fabrick-plugin/`.
  - APK 0.5.0: **914.206 B**,
    sha256 `80ab68cef09739f81c81b65aa0aca776ce460dd92f1cecf522f2e8ad35cdc6e0`,
    copiada a `/storage/emulated/0/Download/FABRI-CORE-0.5.0.apk`.
  - Pruebas: **23/23** descargador, **17/17** manifiestos, `node --check` OK,
    validador **8/8** páginas generadas.

- Fase 3 · runtime nativo A1 (APK 0.6.0, 2026-10-23):
  - A1 implementado: se empaquetaron las 5 bibliotecas de llama.cpp
    (`libllama.so`, `libggml.so`, `libggml-base.so` y los backends CPU 8.0/8.2)
    más `libfabrick_llama.so` (shim JNI que sólo llama a `llama_version()`).
  - `RuntimeNativo.java` carga `ggml-base` → `ggml` → `llama` → shim y
    **captura cualquier error**: si falla, la app sigue y Diagnóstico muestra el
    motivo. No carga modelo ni infiere.
  - `NativeBridge.runtimeInfo()` + `apiRuntime()`; Diagnóstico muestra
    «Runtime nativo (A1): cargado · versión» o el error real.
  - Corrección del escáner: `op_modelos` ahora recorre hasta 2 niveles y
    `escanearModelos()` incluye `filesDir/componentes/`. Antes el modelo Qwen de
    469 MB descargado y verificado aparecía como **0 archivo(s)** porque el
    escáner sólo miraba `filesDir/modelos` y no era recursivo.
  - La tarjeta de componente ya no ofrece «Descargar» si el estado es
    `DESCARGADO_VERIFICADO` o `INSTALADO`.
  - APK 0.6.0: **3.777.933 B**,
    sha256 `1bde9c0e899276dd34da32e1e1b52599ed7c07bbe1708114a6dad7a0935cb5be`,
    copiada a `/storage/emulated/0/Download/FABRI-CORE-0.6.0.apk`.
  - Verificado en el artefacto: `lib/arm64-v8a/` incluye 7 `.so`, el símbolo
    `Java_cl_fabrick_core_RuntimeNativo_versionNativa` está exportado y
    `zipalign -c -p 4` + `apksigner verify` pasan.
  - Pruebas: **23/23** descargador, **17/17** manifiestos, `node --check` OK.
  - **Pendiente en pantalla**: actualizar sin desinstalar (para conservar el
    modelo), abrir Diagnóstico y confirmar «cargado · b11835»; luego Modelos →
    Escanear y ver el GGUF de 469 MB.

- Fase 3 · chat, Termux y repositorio (APK 0.7.0, 2026-10-23):
  - A2/A3 implementados en `fabrick_llama.c`, `jni_runtime.c`,
    `RuntimeNativo.java` y `NativeBridge.java`: `fc_iniciar_ruta` carga los
    backends CPU desde `nativeLibraryDir`, `fc_cargar` usa mmap, `fc_info`
    devuelve `n_params`/`n_vocab`, `fc_generar` limpia la memoria KV en cada
    turno y `fc_liberar` cierra el modelo.
  - Chat local: el GGUF debe estar dentro de `filesDir` y terminar en `.gguf`;
    el prompt usa ChatML y el resultado se entrega por
    `FabriChat.localFin`. El chat remoto es OpenAI-compatible: URL/clave/modelo
    en SQLite, `/v1/models` dinámico y `/v1/chat/completions` en segundo plano.
    La clave no vuelve a JavaScript.
  - `normalizarBase`: HTTPS en cualquier host; HTTP sólo en loopback o IPv4
    privada (10/8, 172.16/12, 192.168/16). `network_security_config.xml` permite
    cleartext y el código restringe el destino.
  - UI nueva: `v-chat` (modo local/remoto, presets OmniRoute/Ollama/LM Studio/
    OpenRouter/Groq/OpenAI/Mistral/Together/Hugging Face, burbujas modernas,
    estados, copiar/leer, TTS), `v-termux` (abrir Termux, comandos copiables,
    biblioteca de descargas, estado RAG/GraphRAG/TTS) y `v-repo` (URL
    configurable, repo conocido y descarga de APK firmada con hash/tamaño).
  - TTS: `android.speech.tts.TextToSpeech` con voz es-CL y respaldo al locale
    del sistema; botón Leer en cada respuesta y estado real en Termux.
  - Descarga e instalación nativa: `ApkProvider` + `content://cl.fabrick.core.apk/update.apk`
    + `REQUEST_INSTALL_PACKAGES`. La app descarga una APK firmada con HTTPS +
    SHA-256 + tamaño, la verifica, la copia a `filesDir/actualizaciones/update.apk`
    y abre el instalador del sistema. No se descarga ni ejecuta un `.so` suelto
    (W^X): el código nativo viaja dentro de la APK.
  - Páginas nuevas: `pagina-chat`, `pagina-termux`, `pagina-repositorio`; la
    página `pagina-voz` pasa a `PARCIAL` porque el TTS del sistema ya está
    integrado y el STT local sigue pendiente.
  - APK 0.7.0 compilada y firmada: `dist/FABRI-CORE-0.7.0.apk` (~3.709 KB).
  - **No incluye** los últimos cambios de instalador/RAG: se recompiló 0.7.1.

- Fase 3 · RAG léxico y cierre 0.7.1 (2026-10-23):
  - `op_rag` en el núcleo Rust: acciones `indexar`, `estado` y `buscar`.
    Indexa notas en la tabla `vectores` con vector vacío y busca con `LIKE`;
    es RAG **léxico**, no semántico. La UI de Termux permite indexar una nota y
    el chat tiene la casilla «Usar contexto RAG léxico».
  - GraphRAG no se declara conectado: no hay artefacto Android; queda la vía
    HTTP o el grafo local de la página `pagina-grafo`.
  - APK 0.7.1: **3.802.509 B**,
    sha256 `68930a11fb984fa0fb7181fa94c6bb3ff711262aa90cbd444c82f7a0261f8fbc`,
    copiada a `/storage/emulated/0/Download/FABRI-CORE-0.7.1.apk`.
  - Verificado en el artefacto: `versionCode=12`, `versionName=0.7.1`,
    `REQUEST_INSTALL_PACKAGES`, provider `cl.fabrick.core.apk`, vistas nuevas en
    `assets/www/`, símbolos JNI de A2/A3 (`fc_cargar`, `fc_generar`,
    `fc_info`, `fc_liberar`) y 7 `.so` arm64.
  - Pruebas: **23/23** descargador, **17/17** manifiestos, `node --check` y
    `javac` OK.
  - **Estado del dispositivo**: la versión instalada sigue siendo **0.5.0**
    (`versionCode=9`), con la **misma firma** que 0.7.1
    (`CN=Debug`, SHA-256 `959b85…946d`). Se abrió el instalador de 0.7.1 desde
    `Download`, pero **no se confirmó** la actualización. Al actualizar sin
    desinstalar se conserva el GGUF de 491.400.032 B.

- Fase 4 · Área 1: chat de lujo, asistente y barra inferior (2026-10-24):
  - **Barra inferior**: de 8 botones pequeños a **5 accesos** (Inicio, Chat,
    Módulos, Consola, Diag), botones más grandes, indicador luminoso del activo y
    altura de 68 px con `safe-area-inset-bottom`. Termux, Repositorio,
    Componentes y Modelos se movieron al menú lateral ☰ (secciones «Principal»
    y «Herramientas»).
  - **Cabecera del chat**: avatar `FC` con estados reales
    (`fabricore-idle` → `idle`, `thinking`, `talking`), nombre FABRI-CORE con
    degradado de marca, subtítulo humano y pill de estado
    («Local listo», «Remoto», «Cargando…», «Sin modelo»).
  - **Burbujas**: nombre + badge `[Local]` / `[Remoto]` en cada respuesta IA,
    sombras y bordes refinados, acciones Copiar/Leer, indicador de escritura.
    El estado vacío ahora saluda y ofrece 3 sugerencias tocables.
  - **Compositor**: foco con halo lima, botón de voz y enviar rediseñados;
    «Limpiar conversación» pasa a «Nueva charla».
  - **Personalidad estable** (`PERSONALIDAD` en `app.js`): español de Chile,
    respuestas de 2-3 líneas, muletillas naturales («mira», «oye», «al tiro»),
    puntuación pausada para que el TTS suene humano; el mismo texto alimenta
    los prompts local y remoto.
  - **TTS nativo**: `setLanguage(es-CL)` + `setSpeechRate(1.2f)` +
    `setPitch(0.95f)`; `UtteranceProgressListener` avisa a la WebView para que
    el avatar pase a `talking` al hablar y vuelva a `idle` al terminar o
    detenerse. `ttsTextoNatural()` limpia markdown y separa la puntuación antes
    de leer.
  - **APK 0.8.0**: **3.806.605 B**,
    sha256 `00c736ecaedf024a0e8fc5a850e002f55d82252f89f9406527d61960cd891d47`,
    `versionCode=13`, `versionName=0.8.0`, copiada a
    `/storage/emulated/0/Download/FABRI-CORE-0.8.0.apk`.
  - Verificado en el artefacto: firma `CN=Debug` (misma SHA-256
    `959b85…946d`), `zipalign -c -p 4` OK, `assets/www/` con la UI nueva y
    `FabriTts` + `UtteranceProgressListener` en `classes.dex`.
  - **No** se integraron Kokoro/Laya/ONNX ni binarios descargados: siguen
    prohibidos por W^X y por el límite de 50 MiB. La voz es la del sistema.

## En curso

### 0.9.1 · estadísticas reales, verificador global, selector de modelos y benchmark (2026-10-24)

- **IA conectada a la base de datos**: `op_estado_global`, `op_dispositivo_detalles`, `op_modelos_recomendados` en Rust; devuelven salud de componentes, filas de SQLite, modelo cargado, CPU, RAM, disco y recomendaciones de modelos según RAM.
- **Página de inicio rediseñada**: 6 KPIs (disco, RAM, tokens IA local, tokens API remota, modelo IA, salud global), verificador global con barra de progreso, detalles del dispositivo (tabla de hardware), modelos recomendados y detectados con tabla de comparación, benchmark de servicio.
- **Contador de tokens reales**: `chatAgregarRespuesta` cuenta tokens por origen (local/api) y actualiza KPIs en tiempo real.
- **Selector de modelos**: descarga de GGUF recomendados según RAM del dispositivo.
- **APK 0.9.1**: **3.864.084 B**, sha256 `a6b8f5770559c702573ca17cb73f2b9506756641b4943ceeabbd7741a07da9be`, `versionCode=15`, `versionName=0.9.1`.

Pendiente:
- Esperar a que termine cargo check y compilar APK final.
- Instalar 0.9.1 encima y probar: verificador global, KPIs de tokens, descarga de modelos, benchmark.
### 0.9.0 · hoja de datos editable + conexiones cifradas (2026-10-24)

- **SQLite editable** (`v-sql`, `android/assets/www/datos.js`):
  - Rust: `sqlite_actualizar`, `sqlite_insertar`, `sqlite_borrar`,
    `sqlite_importar`, `sqlite_auditoria`, `columnas_tabla`, `json_a_sql`,
    `auditar`, `validar_cambios`; `sqlite_filas` agrega `rowid AS _fila` y
    devuelve `editable`.
  - `op_sqlite` acepta `actualizar`, `insertar`, `borrar`, `importar`,
    `auditoria` además de las de lectura.
  - Tabla nueva `auditoria_datos` (migrada en `init`).
  - Hoja: modo ver/editar, celdas editables por tipo, filas nuevas en azul,
    cambios pendientes en amarillo, borrar fila con confirmación, paginación,
    importar CSV con vista previa (`,` o `;`, comillas), exportar CSV/JSON a
    `Android/data/cl.fabrick.core/files/Download`, panel de auditoría.
- **Conexiones «Criotokey»** (`v-conexiones`, `conexiones.js`):
  - `Boveda.java`: AES-256/GCM con clave de Android Keystore, archivo
    `filesDir/conexiones.bin`, escritura atómica, tokens enmascarados en la UI.
  - `Conexiones.java`: pruebas HTTPS reales (GitHub, Vercel, Cloudflare,
    Supabase, Firebase RTDB, Meta, Google, Neon, InsForge/otro), generador de
    código JS/curl, OAuth PKCE (GitHub, Google, Meta) y **device flow de
    Google** (sin redirect).
  - `NativeBridge`: `conexiones*`, `conexion*`, `conexionGoogleDevice*`,
    `abrirNavegadorSeguro`, `guardarArchivo`, `leerArchivoUri`.
  - `MainActivity`: `launchMode=singleTask`, `onNewIntent` y filtro
    `fabrickcore://oauth` para volver del navegador.
  - Respaldo de la base local en JSON y de conexiones (sin tokens).
- **APK 0.9.1**: **3.864.084 B**,
  sha256 `a6b8f5770559c702573ca17cb73f2b9506756641b4943ceeabbd7741a07da9be`,
  `versionCode=15`, `versionName=0.9.1`, copiada a
  `/storage/emulated/0/Download/FABRI-CORE-0.9.1.apk`.
  Verificado: firma `CN=Debug` (misma `959b85…946d`), `zipalign -c -p 4` OK,
  `assets/www/{datos,conexiones}.js` dentro del APK, `Boveda` y
  `conexionGoogleDeviceIniciar` en `classes.dex`, `intent-filter`
  `fabrickcore://oauth` en el manifiesto compilado.
- Documentos: `docs/fase-4/hoja-de-datos.md`,
  `docs/fase-4/conexiones-criotokey.md`.

Pendiente de esta entrega:

- Instalar 0.9.0 encima (sin desinstalar) y probar la hoja con una tabla real
  (editar una fila, agregar, borrar, exportar CSV y volver a importarlo).
- Probar una conexión real con token (GitHub es la más simple) y revisar que el
  token quede enmascarado.
- Para OAuth de GitHub: registrar `fabrickcore://oauth` en la OAuth App.
  Para Google: crear un cliente «TVs and Limited Input devices».

- Instalar **0.8.0** encima de la versión actual (sin desinstalar, para
  conservar el GGUF de 491.400.032 B en
  `filesDir/componentes/modelo-qwen05/`) y probar el **Área 1**:
  1. La barra inferior debe mostrar **5 accesos** y Termux/Repositorio deben
     estar en el menú ☰.
  2. Chat: avatar `FC`, pill de estado y saludo con 3 sugerencias.
  3. Cargar el modelo y enviar «Hola, responde en una frase»; la respuesta debe
     llevar el badge **Local** y el avatar pasar a `thinking` → `idle`.
  4. Pulsar **Leer**: el avatar debe animarse en `talking` y volver a `idle` al
     terminar; confirmar velocidad 1.2 y tono 0.95.
  5. Probar «Nueva charla» y el modo Remoto (badge **Remoto**).
- Probar el **chat remoto**: OmniRoute en `http://127.0.0.1:20128/v1` o un
  proveedor real; guardar, traer `/models`, enviar y confirmar que la clave no
  aparece en pantalla.
- Probar **TTS** (Probar voz y Leer en una respuesta), **Abrir Termux**,
  **copiar comandos**, **indexar una nota** y el toggle RAG léxico.
- Probar la **descarga/instalación de una APK firmada** en Repositorio: URL
  HTTPS + SHA-256 + tamaño; debe abrir el instalador del sistema, no instalar en
  silencio. Sin URL real no se puede completar esta prueba.
- Falta **probar el menú lateral (☰), las 11 páginas y la importación** de
  `Download/fabrick-modulos/paginas/pagina-ayuda.json` en 0.7.1.
- Reinicios: causa encontrada y corregida en `always-on.ts` (spawn de EverOS
  inexistente sin handler de `error`). Documento:
  `docs/fase-3/diagnostico-reinicios.md`. EverOS y `masterlib` siguen sin
  instalar; el panel Meta y el túnel están caídos por eso.
- Falta instalar OmniRoute en Termux (114 MB + ~440 MB + deps): **requiere
  autorización explícita** por superar 50 MiB y por el consumo de RAM.

## Bloqueado

| Tema | Bloqueo | Qué lo desbloquea |
|---|---|---|
| Verificar A2/A3 | El código compila y los símbolos están en la APK, pero no se ejecutó en pantalla; no hay `logcat` desde Termux | instalar 0.9.0 y cargar el GGUF real |
| Chat remoto | Falta un proveedor/URL real y su clave; no se inventan | configurar OmniRoute o una cuenta propia |
| OAuth GitHub/Google | Hace falta un Client ID propio registrado por el usuario | registrar la app y pegar el Client ID en la página |
| OAuth Meta | Meta exige HTTPS + revisión y su flujo nativo usa SDK | token de usuario desde el Explorador de Graph API |
| PostgreSQL remoto | SQLite no habla el protocolo de Postgres | driver JDBC embebido o proxy HTTP propio |
| Restaurar tokens | La clave AES vive en el keystore del dispositivo | no aplica: es una decisión de seguridad |
| `embeddings` | b11835 no trae `llama-embedding`; RAG sólo léxico | build con embeddings o `llama-server --embeddings` |
| `vec0.so` | falta probar la carga en el SQLite del núcleo | `SELECT vec_version()` con una BD desechable |
| Voz/STT | TTS del sistema integrado; whisper.cpp v1.9.5 sin binarios Android | compilar con NDK (RAM/tiempo) |
| GraphRAG | no existe artefacto Android | implementación nativa, grafo local o consumo HTTP |
| Repositorio | falta la URL exacta del repo de esta APK; el repo conocido contiene prototipos históricos | confirmación del autor |
| Instalación de APK | no hay una URL/hash/tamaño reales de release para probar | publicar la APK en un release firmado |

## Siguiente movimiento concreto

1. Instalar **FABRI-CORE-0.9.1.apk** desde
   `/storage/emulated/0/Download/` **encima de la versión actual** (no
   desinstalar: se perdería el modelo de 491.400.032 B del sandbox).
2. **Base de datos → abrir `config` → Editar** una celda, agregar una fila,
   guardar y revisar «Auditoría». Después **Bajar CSV** e importarlo en otra
   tabla para cerrar el ciclo subir/bajar.
3. **Conexiones → GitHub** con un token personal: debe quedar enmascarado y la
   prueba tiene que devolver tu usuario. Probar «Código» y copiarlo.
4. **Chat → enviar un mensaje**: la respuesta local ya no debería quedar vacía.
   Si el modelo está cargado, `localFin()` recibe el texto y lo muestra.
5. Revisar la UI: 5 accesos abajo, menú ☰ con «Base de datos» y «Conexiones»,
   avatar `FC` y pill de estado, diseño negro/lime (Brand System v2.4.1).
4. Enviar un mensaje corto: badge **Local** en la respuesta y avatar
   `thinking` → `idle`. Probar **Leer** (avatar `talking`) y **Nueva charla**.
5. Probar el chat remoto con OmniRoute (`http://127.0.0.1:20128/v1`) o un
   proveedor propio; la respuesta debe llevar badge **Remoto**. No se inventan
   claves ni URLs.
6. Probar TTS, Termux, indexar una nota + toggle RAG, y la descarga/instalación
   de una APK firmada (requiere URL + SHA-256 + tamaño reales).
7. Probar el menú lateral y las 8 páginas; importar `pagina-ayuda.json`.
8. Publicar módulos/páginas sólo cuando exista repo propio:
   `bash modulos/publicar.sh https://raw.githubusercontent.com/<usuario>/<repo>/main/plugins`;
   sin repo ni token no se inventan URLs.
9. Pedir al autor la **URL exacta del repositorio actual** y qué debe mostrar su
   página de interacción. No presentar `thinkfashz/fabri-core` como la APK
   actual: son prototipos históricos sin licencia.

## Reglas para retomar

- Leer `MEMORIA.md` y `docs/fase-3/ejecucion.md` antes de tocar código.
- Probar siempre con `bash tests/seguridad/correr.sh` y `bash tests/seguridad/validar-manifiestos.sh`.
- No reinstalar toolchain: Rust 1.99.1, clang 21.1.8, JDK 21 y SDK ya funcionan.
- Compilar con `bash scripts/compilar.sh` (wrapper de clang incluido).
- No usar `pm install` ni `am start` con `file://`.
- No habilitar botones a mano ni aceptar un manifiesto sin hash verificado.
