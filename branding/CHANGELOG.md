# CHANGELOG.md — FABRI-CORE PRO

Registro de cambios del sistema de diseño y branding.

## [2.13.0] — 2026-10-27 · Nube: escáner con cámara y wiki de productos

La nube deja de pedir el código a mano. La APK no cambia en esta entrega.

### Añadido
- **Escáner de códigos** (`web/app/core-scan.js`): overlay a pantalla completa
  con marco, láser y confirmación. Tres capas: `BarcodeDetector` nativo
  (EAN-13/8, UPC-A/E, Code 128/39, ITF, Codabar, QR y Data Matrix), respaldo
  **ZXing** vendorizado (336 KB, Apache-2.0, cargado sólo si el navegador no
  trae detector y fuera del precache) y entrada manual siempre disponible.
- **Robustez de cámara**: `facingMode: environment` con reintento sin
  restricciones, enfoque continuo, linterna cuando la cámara la expone, cambio
  de cámara, recorte central del fotograma, pausa al ocultar la pestaña,
  apagado de pistas al cerrar, pitido y vibración al leer.
- **Verificación GS1**: el checksum de EAN-8, UPC-A, EAN-13 y EAN-14 se
  comprueba antes de aceptar; un código mal tecleado no llega a la API.
- **Wiki de productos** (`web/app/core-wiki.js`): consulta en cascada Open
  Food Facts → Open Beauty Facts → Open Products Facts (libres, sin clave,
  CORS abierto, ODbL), normaliza la ficha —nombre, marca, cantidad, categoría
  del inventario, Nutri-Score, NOVA, etiquetas, alérgenos, ingredientes— y la
  guarda en la SQLite del navegador (`product_wiki`).
- **Ficha manual**: cuando ninguna base conoce el código se puede completar el
  nombre, la marca y la categoría; queda en la wiki local, que es lo que
  resuelve el catálogo chileno.
- **Pantalla Wiki** (`#s-wiki`) con buscador, ficha editorial, lista de lo
  guardado y atribución ODbL visible; «Usar en el inventario» rellena el alta.
- **Franja de escaneo** en el alta de productos: escanear → ficha → campos
  rellenados (sólo los vacíos) con miniatura y acción «Usar».
- **Prueba** `tests/web/escaneo.js`: checksums reales, rechazo de códigos
  rotos, normalización de Open Food Facts, categorías, NOVA y escapado de HTML.

### Cambiado
- `Permissions-Policy` pasa de `camera=()` a **`camera=(self)`**: la cabecera
  anterior apagaba la cámara en producción aunque el código estuviera bien.
- Service worker **`fcore-v5`**: precachea `core-scan.js` y `core-wiki.js`.
- La landing menciona el escáner y la wiki en el bento y en la comparativa.
- `docs/APK.md` §5 documenta el escáner web y la wiki.

### Corregido
- `te\b` en el clasificador de categorías casaba con «chocolate» y metía los
  dulces en bebidas; ahora exige límite de palabra inicial.
- «hola mundo» pasaba como Code 128 al normalizarse; un código alfanumérico
  debe contener al menos un dígito.
- La cantidad «400 g e» arrastraba la marca de estimación ℮.

## [2.12.0] — 2026-10-27 · Nube v2.0 «Aurora» (PWA)

La versión web deja de ser «la APK sin base local» y estrena contexto propio:
azul noche, vidrio, Lottie y gráficos d3. La APK no cambia en esta entrega.

### Añadido
- **Sistema de diseño «Aurora»** (`web/app/styles.css`, ~1.000 líneas): iris
  `#8C8CFF` sobre azul noche `#04060D`, aqua `#3FE0C9` como secundario, lima
  `#C8F542` solo como señal de marca. Superficies de vidrio con borde capilar,
  sombras en dos capas, radios de 8 a 28 px y movimiento con `--ease`/`--spring`.
- **Rail lateral desde 960 px**: el mismo `<nav>` que en móvil es barra inferior
  se convierte en rail con marca, tres grupos (Núcleo / Operación / Sistema) y
  pie de estado. En móvil quedan 5 destinos + hoja «Más».
- **lottie-web vendorizado** (`web/app/vendor/lottie.min.js`, 5.12.2, 305.543 B,
  licencia incluida) y **cinco animaciones generadas** por
  `scripts/animaciones.mjs`: `core` (boot y héroe), `sync` (rail), `scan`
  (inventario), `check` (hito de instalación) y `empty` (estados vacíos).
- **Cargador Lottie compartido** (`web/app/lottie-mount.js`): caché de JSON,
  fallback estático, pausa fuera de pantalla y con `prefers-reduced-motion`.
- **Capa de interfaz de la nube** (`web/app/cloud.js`): anillo de memoria por
  tipo y barras de tablas con filas sobre d3 real, con firma anti-repintado;
  contadores animados; migas; paleta de comandos ⌘K; hoja «Más»; reloj; espejo
  del modo FTS; hito de instalación con Lottie.
- **Héroe del panel** con orbe Lottie, cuatro KPIs y dos gráficos; **panel de
  módulos**, selector de acento y bloque de instalación.
- **Cabeceras propias** para Datos, IA, Hoja y Cuenta, que antes dependían del
  encabezado genérico.
- **Landing editorial nueva** (`web/index.html`): héroe con orbe y chips
  flotantes, bento de siete módulos, comparativa APK/Nube, tres pasos, malla
  real de `/api/estado`, stack y cierre. Reveal con `IntersectionObserver`.
- **Iconos Aurora** generados por `scripts/iconos-nube.py` (192, 512, maskable
  y favicon), con degradado iris→aqua y zona segura para Android.
- **Imagen social 1200×630** generada por `scripts/og-nube.py`, con el titular
  de la landing y la marca; `og:image` apunta a la URL absoluta de producción.
- **Prueba de la nube** (`tests/web/diseno.js`): contrato de 42 ids de `app.js`,
  45 de inventario, clases del HTML y de los módulos, tokens, Lottie, precache,
  ausencia de CDN, sintaxis, manifest, iconos y cabeceras de Vercel.

### Cambiado
- `THEMES` de `app.js` pasa a **aurora / aqua / lima / ámbar**, con acento
  principal y secundario (`--accent-2`); un tema viejo en `localStorage` se
  normaliza a Aurora.
- El service worker sube a **`fcore-v4`** y precachea `cloud.js`,
  `lottie-mount.js`, `vendor/lottie.min.js`, `vendor/d3-mini.js` y los cinco JSON.
- `vercel.json` cachea `/app/anim/(.*)` como inmutable, igual que `/app/vendor/`.
- `manifest.webmanifest`: tema y fondo `#04060D`, nombre y descripción de la nube.
- `core-pro.js` y `core-sheet.js`: bordes y lavados de acento pasan a
  `var(--accent)` / `var(--accent-soft)`; cabecera de planilla a `#161b2b`.

### Corregido
- El disparador «Más» nunca se mostraba en móvil (regla base en `display:none`).
- `lottie-mount.js` no estaba incluido en el HTML de la app: ninguna animación
  se montaba aunque el runtime y los JSON estuvieran precacheados.
- El contador animado se realimentaba con sus propias escrituras y peleaba
  consigo mismo; ahora ignora su última escritura y normaliza el formato.
- `color-mix` con fallback plano: sin soporte, el botón primario quedaba
  transparente.

## [2.11.0] — 2026-10-27 · Portada del producto (0.9.26)

El inicio deja de ser un tablero técnico y pasa a ser la portada del producto:
primero el negocio, después el sistema. Todo con datos reales del SQLite del
teléfono, sin descargar nada en tiempo de ejecución.

### Añadido
- **Héroe con canvas propio** (`#inHeroCanvas`): barras de «código de barras» que
  respiran y una línea de escaneo que recorre el lienzo. Se apaga solo con el
  acceso abierto, fuera de la vista o si el sistema pide menos movimiento.
- **Estadísticas del negocio**: cuatro KPIs (productos, valor de venta, utilidad
  potencial y stock bajo) calculados con `inventario.resumen`, con el stock bajo
  destacado en ámbar.
- **Tres gráficos d3** (`d3-mini.js`, bundle propio de 50 KB con `d3-array`,
  `d3-scale` y `d3-shape`): ventas de los últimos 7 días en barras, reparto del
  catálogo por categoría en anillo con leyenda y productos más vendidos medidos
  sobre los ítems de las boletas. Sin datos muestran un estado vacío honesto,
  nunca cifras inventadas.
- **Sección «Qué es FABRI-CORE»** con el valor para un almacén, minimarket o
  local de barrio: sin mensualidad, sin internet, rápido de operar y con los
  datos en manos del dueño.
- **Seis fichas con iconos animados**: lector de código de barras, wiki y bases
  libres, SQLite local, sincronización en la nube, boletas y caja, y asistente
  con IA. Cada icono se anima al tocarlo o al pasar el dedo.
- **Tira de marcas retro-iluminadas**: Rust, SQLite, JavaScript, Android y Tauri
  (simple-icons, CC0) junto a los proveedores de IA y nube (lobe-icons, MIT).
- **`marcas.js`**: 14 marcas en SVG en línea y 22 iconos animados de
  animateicons — sólo los datos de cada icono, reproducidos con la Web
  Animations API del propio WebView en vez de arrastrar los 20 MB de la librería.
- **El bloque técnico no se pierde**: verificador, dispositivo, modelos y
  acciones rápidas quedan dentro de un `<details>` al final de la portada.

### Cambiado
- `pintarInicio()` ahora engancha `inicioRefrescar()`: la portada se repinta sola
  al navegar, al volver del segundo plano y cuando el núcleo termina de migrar.
- Acciones nuevas en la portada: **Abrir inventario** y **Escanear código**
  (abre el inventario y enciende la cámara).

### Decisiones
- **lottie-web no se incluye**: el efecto que se buscaba (iconos y lienzo con
  vida) se resuelve con canvas y Web Animations API con ~0 KB de dependencia;
  lottie-web añadiría ~250 KB y un reproductor completo para animaciones que
  aquí son de segundos.
- Los assets viajan **dentro de la APK** (sin red, sin CDN) y en archivos planos
  bajo `assets/www/`, que es lo que empaqueta `aapt2 -A`.

### Pruebas
- `tests/arranque/inicio.js` (paso 8/8): ids de la portada, iconos y marcas
  referenciados existen, el bloque técnico sigue intacto, los KPIs y los tres
  gráficos se pintan con datos falsos y el estado vacío no inventa nada.

## [2.10.0] — 2026-10-27 · Inventario completo (0.9.25)

Entrega del módulo de inventario como sistema entero: escanear, cargar, ver y
cobrar. Todo funciona sin red, sin librerías nuevas y sin recursos externos
(los iconos y las miniaturas se dibujan en el propio código).

### Añadido
- **Apilador continuo**: modo de escaneo que no cierra la cámara. Cada código
  entra a una lista con **miniatura, nombre y precio**, con sonido y vibración;
  los repetidos suman cantidad. Al terminar se guarda el lote completo con
  **una sola escritura** en la base. El nombre se resuelve en segundo plano
  (base local → tu nube → bases libres) sin frenar el escaneo.
- **Importación masiva desde otra base** (Eleventa, Excel, CSV/TSV/JSON):
  reconoce las columnas por su nombre (`Producto`/`Descripción`, `Código de
  barras`, `Precio`, `Costo`, `Existencia`, `Marca`, `Categoría`), tolera
  formato de número chileno (`1.490`, `1.234,56`) y **muestra una vista previa**
  antes de escribir. Las filas sin nombre se omiten y se informan.
- **Catálogo en tarjetas**: miniatura dibujada en canvas (color estable por
  producto + iniciales; si la ficha trae imagen real, manda la imagen),
  **código de barras SVG** (EAN-13 si el dígito de control es válido; Code 39
  si no) y acciones por producto. Con paginación de 80 tarjetas.
- **Boleta con efecto de impresión**: cuerpo de ticket compartido entre la
  pantalla y el papel, con identidad del negocio, folio, cliente, detalle con
  cantidad y unitario, neto/IVA/total, código de barras del folio, agradecimiento
  y pie legal. Documento de impresión con `@page` real para 80 mm, 58 mm y A4;
  el carrito ya no borra el ticket al emitirlo.
- **Iconos SVG en línea** (`ico()` + `data-ico`): fuera los emoji del módulo.
- **Verificación real del sistema** (página Revisión): `Verificar ahora` ejecuta
  pruebas contra SQLite y el disco y muestra el resultado; `Limpiar errores`
  borra el registro viejo. En cada actualización, el núcleo **limpia solo** los
  errores de la versión anterior.
- **OCR del inventario con degradación honesta**: `OcrNativo` busca por reflexión
  un motor local (ML Kit v2 o visión de Play Services); si no hay, **el botón no
  aparece**. Se encenderá solo cuando el build pase a Gradle, sin tocar la
  interfaz ni el núcleo.

### Cambiado
- Alta individual y importación masiva escriben por el **mismo camino**
  (`inv_upsert`): una sola forma de guardar producto, sin divergencias.
- Núcleo: `importar` (lote en una transacción, devuelve nuevos/actualizados/errores),
  `revision.limpiar`, `revision.verificar` y limpieza por versión dentro de
  `op_mantenimiento`.

### Pruebas
- `tests/inventario/nuevo.js`: importación (CSV/TSV/JSON/sin encabezado),
  código de barras EAN-13 y Code 39, ticket y documento imprimible, apilador
  y marcado. Integrada como paso 4/4 de `tests/inventario/correr.sh`.

## [2.9.0] — 2026-10-26

### Corregido
- **La app salió con dos fallos al probarla en el teléfono.** Un reemplazo de esta
  sesión **borró el bloque de utilidades y estado** (`toast`, `hora`, `esc`,
  `bytes`, `fechaHora`, `claseEstado`, `const estadoApp`, `const PROVEEDORES_CHAT`,
  `const TERMUX_COMANDOS` y `function navegar`). El verificador de sintaxis no
  lo veía porque los usos están más abajo y `node --check` no resuelve
  referencias: `chatLlenarProveedores` pedía `PROVEEDORES_CHAT`, `saludPintar`
  pedía `hora` y `entrarPin` pedía `toast`. Restaurado desde la versión anterior
  (`bf87d58`), sin perder el carril asíncrono ni las novedades de esta versión.
- **`no such column: datos in SELECT … FROM perfil`.** La columna `datos` de la
  ficha de identidad sólo se creaba en `inv_esquema` (el esquema de inventario),
  así que la app funcionaba hasta que el usuario abría Inventario. Ahora el
  `ALTER TABLE` idempotente va también en `migrar()`, que corre en el primer
  `init` de cada arranque.

## [2.8.0] — 2026-10-26

### Corregido
- **La app se quedaba pegada al interactuar.** Todas las lecturas de pantalla
  seguían usando la vía **síncrona** del puente (`call()`), que devuelve el
  resultado en el mismo instante y por eso **bloquea el hilo de JavaScript**
  hasta 600 ms (y antes 1,2 s). Con el hilo ocupado no corren `setTimeout` ni
  `requestAnimationFrame`: los botones no respondían y las pantallas no
  terminaban de pintarse. Ahora hay un **carril asíncrono** (`callAsync` en
  Java, `apiAsync`/`apiTarde` en JS): el resultado vuelve por
  `window.__fabriAsync` cuando está listo, sin parar nada. La vía síncrona queda
  sólo para acciones puntuales (guardar, borrar, registrar).
- **El código `7791293043791` mostraba «Open Products Facts: HTTP 500».** La app
  trataba un 404 o un 500 de las bases libres como si fuese un fallo propio. Un
  404 significa «no está en esa base» y un 500, «esa base está caída»: en ambos
  casos se **salta en silencio** y, si ninguna lo tiene, el mensaje dice la
  verdad — «no está publicado en las bases libres» — en vez de exponer el HTTP.
- **La guía de inventario se sentía congelada.** Cada paso (resumen, productos,
  precios, márgenes, boletas) esperaba al núcleo antes de pintar. Ahora se
  refresca por el carril asíncrono, encadenada y con guarda para no apilar
  consultas.

### Añadido
- **Página «Mi identidad»**: nombre comercial, **logo real** (reducido a 256 px
  JPEG en un lienzo), razón social, RUT formateado, giro, dirección, teléfono,
  correo e **ID de cliente** con formato `FAB-XXXX-XXXX`, sin caracteres que se
  confunden (I, O, 0, 1). Se guarda en la tabla `perfil` (columna nueva `datos`
  en JSON) y se cachea en `localStorage` (`fabrick.identidad`) para que el login
  y la boleta lo lean sin consultar la base.
- **Boleta con la ficha completa**: el documento imprimible (80 mm / 58 mm / A4)
  muestra logo, nombre comercial, razón social, RUT, giro, dirección, teléfono,
  correo e ID de cliente.
- **Pruebas nuevas**: `tests/arranque/puente.js` (vía síncrona acotada, carril
  asíncrono, `ping` local, cola de 24, coalescencia), `tests/arranque/identidad.js`
  (ID de cliente, RUT, iniciales, caché) y `tests/inventario/lector.js`
  (404/404/500 del caso real, producto válido, sin red, presupuesto total).

### Documentación
- `docs/APK.md`: tiempo del puente, lista de pruebas y tabla de versiones.

## [2.7.0] — 2026-10-26

### Corregido
- **Al reabrir la app quedaba el cargador encima del login y ningún botón
  respondía.** Android pausa las animaciones CSS al pasar a segundo plano; al
  volver, la animación `loader-salida` no se había completado y la capa seguía
  visible y capturando toques. Peor: `.loader-oculto` sólo bajaba la opacidad,
  así que la propia animación de salida **volvía a pintarla**. Ahora la clase
  lleva `animation: none` + `visibility: hidden`, y `pageshow` /
  `visibilitychange` retiran la capa sin condiciones al volver.
- **`LENTO` se mostraba como error.** El núcleo puede tardar más de 900 ms sin
  estar roto; ahora se trata como `NUCLEO_OCUPADO` y se reintenta en silencio.
- **El `versionCode` estaba fijo en el script de compilación.** Tres sitios
  declaraban la versión (Cargo.toml, manifiesto y el script) y podían
  desincronizarse sin que nadie lo notara. Ahora el script la lee del manifiesto
  y verifica, con `aapt2 dump badging`, que lo que quedó dentro del APK es
  exactamente eso; si no coincide, aborta.

### Añadido
- **Ficha del producto**: etiquetas «free» (sin gluten, sin azúcar, sin lactosa,
  sin grasa, vegano, vegetariano, orgánico), alérgenos, Nutri-Score, NOVA, país
  e imagen, guardadas en `ficha` (JSON) para no depender de internet al filtrar.
- **Lector de código de barras propio**: EAN-13, EAN-8 y UPC-A sobre los
  fotogramas de la cámara, con validación de dígito de control. El WebView de
  Android no expone `BarcodeDetector`; antes la cámara quedaba inservible.
- **Categorías de inventario**: Alimentos, Bebidas, Alcohol, Dulces, Lácteos,
  Cosmética, Limpieza, Congelados, Mascotas, Otros.
- **Impresión real de boletas**: `PrintManager` con hoja fuera de pantalla,
  formato de 80 mm, 58 mm o A4, y botón «Reimprimir» en el historial.
- **Verificación de conexión visible** en la cabecera de la web (consulta
  `/api/health`, no sólo `navigator.onLine`).
- **Cargador de arranque y login de la web** con la misma ficha que la APK.
- **Guía de 5 pasos, carrito e impresión en la web**: margen por fila, botón «+»
  para la boleta, neto/IVA despejados igual que el núcleo y documento imprimible
  en 80 mm, 58 mm o A4 desde un iframe oculto (también «Guardar como PDF»).

### Documentación
- `docs/APK.md` y `docs/SEGURIDAD-Y-VISION.md` (Authelia, FairScan, MediaPipe).

## [2.6.0] — 2026-10-26

### Corregido
- **La app se quedaba en «LOADING CORE SYSTEM · 0 %».** El arranque llamaba al
  puente nativo de forma síncrona y el puente esperaba hasta 10 s por operación
  a que el núcleo terminara de migrar SQLite. Con siete operaciones seguidas, el
  hilo de JavaScript quedaba bloqueado más de un minuto: sin hilo libre no
  corren los `setTimeout`, ni `requestAnimationFrame`, ni los toques.
  Ahora la espera máxima es de 1,2 s, `ping` no espera nunca y las operaciones
  que necesitan SQLite devuelven `NUCLEO_OCUPADO` en vez de bloquear. El
  arranque del núcleo va en el turno siguiente a la primera pintura.
- **El login aparecía pero no respondía.** `FabriLogin.iniciar()` leía el perfil
  en SQLite (`usuarios` + `perfil`) antes de devolver el control, así que la
  tarjeta se pintaba con el hilo bloqueado. El perfil ahora se carga diferido y
  el PIN se verifica primero contra las preferencias del teléfono, que no
  dependen del núcleo.
- **El loader dependía de JavaScript.** Su barra la movía `requestAnimationFrame`
  y su salida, un `setTimeout`; si el hilo se bloqueaba, se quedaba en 0 %.
  Ahora la barra y el desvanecido son animaciones CSS (`transform` y `opacity`,
  compuestas en el hilo gráfico) y lleva `pointer-events: none` desde el primer
  instante, así que nunca se come un toque del login.
- **`onConsoleMessage` congelaba la pantalla.** Corre en el hilo de interfaz y
  llamaba al puente de forma síncrona. Ahora encola en `ColaConsola` (hilo de
  fondo, cola acotada). `onReceivedError` ya no bloquea.
- **«Cuadro negro» en la F del loader.** El SVG tenía un corte entre el asta y
  el brazo relleno de `#050505`, que tapaba el halo y se veía como un
  rectángulo distinto al fondo. La F es ahora una silueta sólida, sin rellenos
  oscuros ni máscaras (`logo-loader.svg` y `logo-f.svg`).
- **Registros sin límite.** `logs` y `revision` crecían para siempre y
  `logs/fabrick.log` no rotaba; la migración del arranque se volvía más lenta
  con el tiempo. Ahora se conservan las últimas 3.000 filas y el archivo rota a
  512 KB.

### Añadido
- **Bitácora de arranque** (`filesDir/arranque.log`): se escribe desde el primer
  instante sin depender del núcleo ni de SQLite. Se lee en **Diagnóstico →
  Bitácora de arranque** y dice qué pasó a los 5 s (`loader=`, `login=`,
  `delegacion=`, `nucleo=`), cuánto tardó `init`, qué operación llegó antes de
  tiempo y qué recurso no cargó.
- **`window.__fabriNucleoListo()`**: Java avisa a la interfaz cuando el núcleo
  termina; el arranque, el chat y la pantalla de acceso se repintan solos.
- **Pruebas de arranque** (`tests/arranque/`): DOM hostil, carga sin bloqueo,
  loader sin JavaScript y logo sin relleno oscuro.

## [2.5.1] — 2026-10-26

### Corregido
- **Botones muertos y pantalla clavada en «Comprobando acceso…».** `app.js`
  tenía 19 `document.getElementById("x").addEventListener(...)` en el nivel
  superior: un id ausente lanzaba y cortaba el script antes de definir
  `FabriLogin` y de arrancar la interfaz. Ahora todos pasan por `al(id, evento,
  fn)`, que tolera ids ausentes. El arnés de DOM hostil baja de 19 roturas a 0.
- **Respaldo del login independiente de `app.js`.** Un script en `index.html`
  conecta PIN, creación de PIN, huella, restablecimiento y modo diagnóstico
  directamente al puente nativo; se retira solo cuando la delegación de clics
  de `app.js` está registrada de verdad. A los 6 s informa en `#loginEstado` si
  la interfaz no terminó de cargar.
- **Recursos que no cargan** (por ejemplo `app.js`) ya se registran en el log
  del núcleo con su URL exacta, no sólo los fallos del frame principal.

### Cambiado
- **«Cambiar foto» sale de la fila inferior.** La foto del operador es ahora el
  botón: se toca y abre el selector, con pista visible y soporte de teclado.
- **«Activar huella al iniciar»** ocupa el primer lugar de la fila y se ofrece
  desde el arranque; sólo se oculta si la huella ya está activada.

### Añadido
- **Escáner perpetuo** sobre la foto (banda de barrido de 2,9 s), respetando
  `prefers-reduced-motion`.
- **Código de barras con número**: código estable `FC XXXX XXXX XX` derivado del
  operador y 32 barras SVG deterministas, con respaldo CSS si falta JavaScript.
- **Evidencia de arranque en `revision`**: `onPageFinished` registra si
  `FabriLogin` y `FabriDiag` existen (`tipo=arranque`).

## [2.5.0] — 2026-10-25

### Corregido
- **La casilla del PIN ya no puede faltar.** `#loginEntrar` nace visible en el
  HTML; antes nacía con `hidden` y cualquier fallo de JavaScript dejaba la
  pantalla clavada en «Comprobando acceso…» sin campo donde escribir.
- **El arranque no se corta en cadena**: `pasoArranque()` aísla interfaz, chat,
  vigilante y acceso. Una excepción en el chat ya no impide que se pinte el
  login. Se eliminó el ocultamiento de la capa de acceso en el `catch` (era un
  bypass de autenticación).
- **`initNucleo()` sale del hilo de interfaz**: la WebView se pinta primero y el
  núcleo arranca en segundo plano; el puente espera con tope de 10 s.
- La sincronización del inventario sólo daba por enviado el lote aunque
  `sync_marcar` fallara; ahora se comprueba.

### Añadido
- **Escáner global `DIAG`** con respaldo local, cargado antes de `app.js`:
  captura errores de JavaScript, recursos que no cargan, promesas rechazadas y
  `console.error`; «Probar todo» recorre puente, almacenamiento y operaciones
  reales del núcleo.
- **Vigilante de arranque**: si `app.js` no termina, escribe el error exacto en
  la tarjeta de acceso y deja el PIN disponible.
- **Tabla `usuarios`** con el verificador PBKDF2 del PIN, `ultimo_acceso` y el
  perfil del operador. El login se respalda en la base y puede verificar contra
  ella si las preferencias del teléfono se pierden, manteniendo el bloqueo por
  intentos.
- **Sincronización automática del inventario** con espera creciente, disparo al
  recuperar conexión y al volver del segundo plano, sin llenar el registro de
  errores.

## [2.4.0] — 2026-10-25

### Añadido
- **Vigilancia automática del núcleo**: ping cada 45 s y consulta del registro
  de errores. El piloto de la cabecera muestra `núcleo activo · N errores`, y
  la app avisa sola cuando el núcleo deja de responder (al tercer fallo) o
  cuando aparece un error nuevo. Se pausa en segundo plano y se registra sólo
  el cambio de estado, sin llenar la tabla `revision` de ruido.
- **Origen `https://appassets.local`** para la interfaz, servido por
  intercepción (`ActivosWeb`). Habilita `fetch()`, módulos ES y WebAssembly,
  que `file://` bloquea. Incluye respaldo automático a `file://` si la
  interceptación fallara.

### Corregido
- El selector de fotos del login no podía entregar la imagen a la página
  (`setAllowContentAccess` estaba desactivado).
- La sincronización del inventario con un servidor propio por `http` habría
  dejado de funcionar al pasar a origen https (contenido mixto); se preserva el
  comportamiento anterior de forma explícita.

## [2.3.0] — 2026-10-25

### Añadido
- **Identidad del operador en el acceso**: la tarjeta del login muestra la foto
  guardada en la base de datos (tabla `perfil`, data URL de 256 px), con malla
  facial SVG generada sobre el rostro y una línea de escaneo que barre mientras
  se escribe el PIN. Botón «Cambiar foto» con reducción automática antes de
  guardar.
- **Auto-prompt de huella** al abrir la app y al desbloquear por inactividad,
  sin repetirse dentro de la misma sesión.
- Manifiestos descargables del pipeline de visión: `modelo-face-landmarker`
  (3,6 MB) y `modelo-efficientdet-lite0` (6,9 MB), con hash verificado.

### Corregido
- **Pantalla negra permanente**: se implementa `onRenderProcessGone` en la
  WebView. Cuando Android mata el renderer de Chromium por falta de memoria, la
  actividad se reconstruye sola (`recreate()`) en vez de quedar en negro.
- **ANR al liberar memoria**: `onTrimMemory` mueve la liberación del modelo a un
  hilo de fondo con guarda de concurrencia, en lugar de bloquear el hilo de
  interfaz.
- **Acceso atascado en «Comprobando acceso…»**: si el estado de acceso falla,
  el panel del PIN se muestra igual.

## [2.2.0] — 2026-10-25

### Añadido
- **Chat con lenguaje visual tipo LLM UI (LobeChat)**, sin dependencias: el
  asistente deja de ir en burbuja y pasa a leerse como documento; el usuario
  conserva burbuja alineada a la derecha. Compositor flotante `sticky` con
  `backdrop-filter`, cabecera mínima, avatar de 28 px con estados
  (`thinking`/`talking`), botón «nueva conversación» en la cabecera, bloques de
  código con cabecera de lenguaje y botón copiar, markdown mínimo (títulos,
  listas, negrita, código en línea) y pie de mensaje que se revela al hover.
  Se descartó `@lobehub/ui`: 8,1 MB sin empaquetar, 3.808 archivos, React 19 y
  49 dependencias para una app vanilla sobre `file://`.
- **Vista «Flujo en tiempo real»** (`v-flujo`): mapa vertical del pipeline con
  estado real de cada nodo (núcleo Rust, SQLite, inventario, APIs libres, IA
  local, IA remota, nube, puente Termux, impresión), refresco automático cada
  5 s, KPIs de errores/avisos/descargas verificadas y lista de fallos leída de
  la tabla `revision` con hora, origen y duración.
- **Consola interactiva del teléfono** dentro de Flujo: shell libre por loopback
  con historial ↑↓, atajos (RAM, disco, procesos, log del puente), tope de 25 s
  y 60 KB de salida, denylist de comandos irreversibles y registro en
  `~/fabrick-comandos.log`. El puente sube a v1.1.0 con el endpoint `/comando`.
- **Impresión de boletas** vía `PrintManager` del sistema.

### Corregido
- **IA local que se quedaba «cargando» para siempre**: `RuntimeNativo` usa
  `ReentrantLock` con timeout en vez de `synchronized` y campos `volatile`; el
  estado expone `cargando_ms`, `colgada` y `abandonada`, y un vigilante en JS
  cada 2 s ofrece abandonar la carga a los 45 s.
- **Descarga doble de componentes**: `compsActualizar()` cruza la base con los
  recibos en disco (`filesDir/componentes/<id>/*.recibo.json`) y corrige el
  estado; la acción `estado` del núcleo pasó de UPDATE a UPSERT.
- **La app se cerraba al pulsar atrás desde el inicio**: ahora
  `moveTaskToBack(true)` la manda al fondo en vez de destruirla.
- **Modelo liberado bajo presión de memoria** (`onTrimMemory`): se suelta el
  GGUF antes de que el kernel mate el proceso.
- Versión APK: **0.9.6** (versionCode 21).

## [2.1.1] — 2026-10-25

### Corregido
- **Regla base `[hidden] { display: none !important; }`**. Cualquier clase con
  `display` (`.btn`, `.pill`, `.bloque`…) anulaba el ocultamiento por atributo:
  «Acceder con huella» se veía con la huella sin activar y sólo respondía
  `HUELLA_NO_ACTIVADA`. El botón y el separador «o usa tu PIN» ahora nacen
  ocultos y se revelan cuando el estado biométrico dice que hay huella activa.
- **`ReferenceError: g is not defined`** en `pintarVerificadorGlobal`,
  `pintarDispositivo` y `pintarModelos` (el WebView lo mostraba como
  `Script error.` sin línea, en inicio y diagnóstico). Cada función resuelve su
  propio `estadoApp.global`.
- **`pintarModelos` duplicada**: la segunda definición anulaba la tabla de
  recomendados del inicio. La de la vista Modelos es `pintarModelosDetectados`.
- **Modelos de embeddings** ya no se pueden cargar como chat (0 tokens); se
  marcan como no elegibles en el selector.
- **Registro de clics**: etiqueta legible (`textContent` recortado) y
  deduplicación de 1,2 s para el mismo control.
- **Errores con stack**: `jsError()` guarda mensaje + stack; `navegar()` aísla
  cada vista en try/catch y avisa sin romper la navegación.
- Versión APK: **0.9.4** (versionCode 19).

## [2.1.0] — 2026-10-25

### Añadido
- **Acceso real con huella**: clave AES en `AndroidKeyStore` con
  `setUserAuthenticationRequired(true)`; el descifrado sólo ocurre tras una
  verificación biométrica del sistema. PIN PBKDF2-SHA256 como respaldo.
- **Login de marca (ID card v5)**: malla de 10 px, línea de escaneo, esquinas de
  encuadre, sello circular y código de barras generado con gradientes CSS.
  Botones `btn-l` de 52 px con radio 12 px. Respeta `prefers-reduced-motion`.
- **Vista Revisión y pruebas**: tabla `revision` en SQLite, KPIs, filtros por
  severidad y exportación JSON. Registra clics, errores de API, operaciones
  lentas (>900 ms), excepciones globales y promesas rechazadas.
- **Diagnóstico de red** con sockets reales por familia (IPv4/IPv6).
- **Puente Termux** por loopback con lista blanca de 13 comandos.
- Marco `.logo-wrapper` de 96 px: antes el SVG del inicio se dibujaba a 300×300.
- Azulejo `.logo` del topbar oscuro con borde lima (la marca es lima: sobre lima
  no se veía).

### Cambiado
- Chat local: 192 tokens por respuesta y `n_ctx=1024` (antes 512 / 2048).
- El mensaje del asistente muestra `tokens · ms · tok/s` reales.
- El botón de enviar cancela la inferencia local en curso (descarta el texto).
- El botón «Descargar» de Modelos abre el modal de descarga verificado en vez de
  mostrar un aviso.
- Los modelos recomendados se derivan de los manifiestos: todo lo que se lista se
  puede descargar.
- Versión APK: **0.9.3** (versionCode 18).

## [2.0.0] — 2026-10-24

### Añadido
- Logo F geométrico nuevo (logo-f.svg) en la vista Inicio
- Loader industrial 2.5s en arrancar (`.loader-industrial`)
- Pantalla Error / Informe único (v-error)
- Pantaña Integración (v-integracion) con pasos completos
- Funciones `errorIniciar`, `integracionGuardar`, `integracionProbar`, `integracionIniciar`
- Opera `op_nube` en Rust (estado + configurar URL/token)
- Endpoints API mejorados: diagnóstico, memoria, skills, modelos
- Arreglo del prompt local Qwen (respuestas vacías causadas por template corrupto)
- Integración de tokens FABRI-CORE PRO en `app.css` (`--fb-*`)
- Versión APK actualizada: 0.9.2

### Añadido
- `branding/tokens.json` — Tokens de diseño canónicos (colores, tipografía, espaciado, radios, sombras, transiciones)
- `branding/tokens.css` — Variables CSS generadas desde tokens.json
- `branding/SKILL.md` — Skill persistente `fabricore-brand-system` para futuros agentes
- `branding/BRAND_GUIDELINES.md` — Guía de marca
- `branding/DESIGN_SYSTEM.md` — Sistema de diseño
- `branding/APP_WEB_GUIDE.md` — Guía WEB
- `branding/APP_ANDROID_GUIDE.md` — Guía ANDROID
- `branding/TAURI_ANDROID_GUIDE.md` — Guía Rust/JNI/Android
- `branding/UI_COMPONENTS.md` — Catálogo de componentes
- `branding/ACCESSIBILITY.md` — Reglas de accesibilidad
- `branding/VISUAL_QA.md` — Checklist de revisión visual
- `branding/DESIGN_DECISIONS.md` — Registro de decisiones
- `branding/CHANGELOG.md` — Este archivo

### Estructura de carpetas creada
- `branding/assets/`
- `branding/components/`
- `branding/web/`
- `branding/mobile/`
- `branding/accessibility/`
- `branding/screenshots/`
- `branding/testing/`

### Pendiente
- Integración de tokens.css en `android/assets/www/app.css`
- Botón de descarga MobileLLM-125M en módulos (pendiente autorización >50MB)
- Rediseño de páginas individuales del dashboard
- Loader industrial de 2.5s en arranque de APK

---

*Versión 1.0.0 — 2026-10-24*
