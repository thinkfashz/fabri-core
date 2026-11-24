# STATE — FORGE CORE STOCK

> **Marca:** visible desde 2026-10-29 (commit `8f23efc`) el producto se llama
> **FORGE CORE STOCK** (antes FABRI-CORE). Las sesiones anteriores conservan el
> nombre de la época. Los identificadores técnicos **no** cambian: package
> `cl.fabrick.core`, crate `fabrick-core`, dominio `forge-core-stock.vercel.app`,
> repo `thinkfashz/fabri-core`.

Última actualización: 2026-11-24

## Sesión 2026-11-24 · APK 0.9.64 sobre la estable (0.9.63)

Pedido: la 1.2.0 no abría; conservar la app estable 0.9.63 con su logo, añadir
las funciones nuevas sin reescribir nada, compilar rápido y poder actualizar
encima.

**Por qué la 1.2.0 no servía**

- Era `cl.fabri.core.lite`: **otro package** distinto del de la estable
  (`cl.fabrick.core`). Android la trata como una app nueva, no como
  actualización; encima su arranque nunca se probó en el teléfono.
- Se descartó y se borró de Descargas para no confundir. No se puede
  diagnosticar el crash exacto sin el log del dispositivo.

**Qué es la 0.9.63**

- `cl.fabrick.core`, versionCode 78, contenedor Java + núcleo Rust que hospeda
  `android/assets/www` en una WebView (`appassets.local`).
- 4,4 MB, 7 bibliotecas nativas, misma firma de depuración.

**0.9.64 (aditiva, sin tocar Java ni Rust)**

- `android/AndroidManifest.xml`: versionCode **79**, versionName **0.9.64**.
- Nueva vista **«Tienda y CRM»** en el menú lateral:
  - conexión con identificador + clave, probar, estado de la nube
    (publicada, plan, productos, dispositivos), **asegurar tablas**,
    subir/bajar catálogo y desconectar;
  - **Productos**: lee el catálogo publicado y edita nombre, precio y stock
    con `productos_subir` + clave;
  - **Clientes**: CRM desde `clientes_listar` (teléfono enmascarado);
  - estado conectado/revisar y últimos fallos con su motivo.
- Archivos: `android/assets/www/tienda.js` y `tienda.css`; integración en
  `index.html` (menú, sección, script) y `app.js` (router).
- No se toca la base local ni las pantallas existentes: se conservan los
  2,07 GB de datos y el logo (mismos mipmaps).
- `scripts/compilar.sh`: `NOMBRE` 0.9.64 y `FORGE_SALTAR_RUST=1` para reutilizar
  las 7 bibliotecas del APK 0.9.63.

**Compilación y verificación**

- `FORGE_SALTAR_RUST=1 bash scripts/compilar.sh` → **1m 47s**, 4.442 KB.
- Package `cl.fabrick.core`, versionCode 79, versionName 0.9.64, label
  «FORGE CORE STOCK», icono `mipmap-anydpi-v26/ic_launcher.xml`.
- Firma idéntica a la 0.9.63 (`959b85cc…`): **actualiza encima** y conserva
  datos.
- Los IDs de recursos coinciden con la 0.9.63 (`0x7f030000` ic_launcher,
  `0x7f040000` app_name): el dex recompilado no queda desalineado.
- Entregada en `/storage/emulated/0/Download/FORGE-CORE-STOCK.apk` y
  `…-0.9.64.apk` (md5 `76c5910e8eb1a1cc14cfea2819d46ade`), y publicada en
  `web/descargas/FORGE-CORE-STOCK.apk`.

**Pendiente**: abrirla en el teléfono y probar la vista con una tienda real.
Si algo falla, el registro queda en Diagnóstico → Revisión.

## Sesión 2026-11-24 · APK 1.2.0, SW reparado y entrega en Descargas

Pedido: la APK es FORGE CORE STOCK (no «lite»), con versión de compilación;
simplificarla; añadir CRM, edición de productos de la nube, sincronización
estable, tablas en ambas bases y una pantalla de conexión con estado, fallos y
conectado/desconectado. En paralelo, reparar el service worker de `/app/`.
Entregar el APK fuera de Termux.

**Versiones**

- Historial real: **37 APK publicadas** en `dist/` (0.9.27 → 0.9.63), más la
  lite 1.1.0 y esta **1.2.0**. No hay un contador de builds; lo que existe son
  las versiones declaradas y los archivos publicados.
- `versionCode` 1 → **2**; `versionName` `1.1.0-lite` → **1.2.0**; etiqueta
  «FORGE CORE STOCK»; archivo `out/FORGE-CORE-STOCK-1.2.0.apk`.

**APK simplificada**

- Pestañas: **Inicio · Tienda · Productos · Clientes · Ajustes** (antes 7, con
  Consola, Datos, IA y Permisos). El código de esas pantallas queda compilado
  pero fuera de la navegación.
- `Inicio` muestra el estado de la tienda, última sincronización, productos,
  clientes y fallos.
- `Ajustes` muestra `FORGE CORE STOCK 1.2.0 (build 2026-11-24)`.

**Conexión y sincronización**

- `Shop.kt`: `asegurar` (crea tablas en `/api/inventario` y `/api/mercado`),
  `catalogo` (`local_ver`), `guardarProducto` (`productos_subir` + clave),
  `clientes` (`clientes_listar`), `estadoAdmin` (`conexion_estado`), además de
  `verificar`, `estado`, `subir`, `bajar` y reporte de `error`.
- `Db.kt` v4: tablas locales `shop_catalogo`, `shop_clientes`, `shop_sync` y
  `shop_fallos`; helpers de upsert y limpieza. Los fallos se guardan con su
  motivo y se muestran en la pestaña Tienda.
- Pantalla **Productos**: baja el catálogo publicado, permite editar nombre,
  precio y stock y guarda en la nube; también alta de producto nuevo.
- Pantalla **Clientes**: CRM real con teléfono enmascarado.
- Pantalla **Tienda**: probar, asegurar tablas, subir/bajar, estado en la nube
  (publicada, plan, productos, dispositivos, fallos) y fallos locales.

**Compilación y entrega**

- `bash build-fast.sh` → **263 s**, APK firmada de 112 KB.
- Copiada fuera del proot: `/sdcard/Download/FORGE-CORE-STOCK-1.2.0.apk`
  (md5 `07e0151ef8fe856d8507c7db7cebaf9d`).
- Publicada en `web/descargas/FORGE-CORE-STOCK.apk` y
  `FORGE-CORE-STOCK-1.2.0.apk`; los botones de la landing descargan con el
  nombre versionado.

**Service worker (`web/app/sw.js`, agente en paralelo)**

- Causa raíz: `caches.open().then(c => c.put(req, r.clone()))` se ejecutaba
  después de devolver `r`, cuando el navegador ya leía el body. De ahí
  `Failed to execute 'clone' on 'Response': Response body is already used` en
  cada navegación (líneas 63 y 71) y en silencio en `/datos/`.
- Arreglo: `redYCache()` clona en el mismo tick y **espera** la escritura
  dentro del `respondWith`; filtra `!r.ok`, opacas y 206; caché bump a
  `fcore-v100` (borra la v99 envenenada); `/api/` y otro origen siguen fuera.
- 26/26 suites web en verde y `node --check` OK.

**Pendiente**: instalar la 1.2.0 en un teléfono y probar con una tienda real
(conectar, subir/bajar, editar un producto y ver el dispositivo en el panel).

## Sesión 2026-11-24 · APK conectada, /app/ sin login y CRM de clientes

Pedido: conectar la APK con la tienda y compilarla rápido; hacer que `/app/`
deje explorar mapa, catálogo, producto y carrito sin cuenta y pida sesión recién
al comprar; y adaptar un CRM (GopherCRM) al panel y su barra lateral.

**APK · pestaña «Tienda» (`fast/lite/`)**

- `Shop.kt` (nuevo): puente con `/api/inventario` usando la MISMA clave de 8
  caracteres de la tienda. Acciones `verificar`, `estado`, `subir`, `bajar` y
  reporte de `error`. La clave se cifra con `Sec` (AES-256-GCM, Keystore) y
  nunca se escribe en claro ni en logs.
- `Db.kt`: `kvPut/kvGet/kvDel` y `productUpsert` (upsert por `sku`).
- `MainActivity.kt`: nueva pestaña «Tienda» con conexión, estado, subir/bajar
  catálogo y cambio de tienda. Todo en un pool; la UI no se bloquea.
- Cada llamada manda `huella` (Android ID), `etiqueta`, `plataforma` y
  `version`, para que el panel muestre dispositivos reales.
- `build-fast.sh` ahora autodetecta el SDK (`/root/android-sdk` o
  `~/android-sdk`). Compilado: **249 s**, APK firmada
  `out/forge-core-stock-lite.apk` (100 KB). `fast/out/` y `fast/lib/` pasaron a
  `.gitignore` (eran binarios versionados).
- Documento nuevo: `docs/APK-CONEXION.md`.

**`/app/` · explorar sin cuenta, comprar con cuenta**

- `app.js`: sin hash, el destino de un visitante es `publico` (antes el hash
  vacío no era «libre» y abría el login de entrada). Ya no hay login al abrir.
- `placer.js`: `pagar()` ahora es async y, si no hay sesión, abre `Pro.gate()` y
  sólo continúa cuando el comprador entra; si cancela, el carrito se conserva.
  El nombre se prellena desde la cuenta.
- Verificado por UI: `/app/` abre en `s-publico` con la barra pública y sin
  login; mapa, catálogo (42 locales) y ficha de la tienda con su producto se
  ven sin cuenta; al pulsar «Confirmar pedido» aparece el login y **no** se crea
  el pedido.

**CRM · N09 Clientes (`web/panel/negocio/clientes/`)**

- Página completa (HTML/CSS/JS propios) construida por un agente en paralelo,
  revisada e integrada: KPIs, buscador, chips de segmento, lista, ficha con
  últimos pedidos y CSV en el navegador.
- Backend `clientes_listar` en `mercado.ts`: agrupa los pedidos por
  `cliente_id` o por los últimos 8 dígitos del teléfono; teléfono `**** 1234`,
  id opaco `c-<hash>`, segmento (recurrente/nuevo/inactivo), ticket y últimos
  tres pedidos. Nunca devuelve `cliente_id`, correo ni teléfono completo.
- En el menú como «Clientes» (sin `pronto`).

**Verificación real (datos temporales borrados)**

- `clientes_listar`: 1 cliente, 2 pedidos, $2.400, «recurrente», `**** 3333`,
  id opaco; búsqueda OK; 401 sin sesión.
- UI del CRM: KPIs correctos, fila con «Ver ficha», ficha con KPIs y últimos
  pedidos, botón CSV generando un blob, sin scroll horizontal a 390 px,
  consola limpia.
- Tests: `tests/web/clientes-negocio.js` (23 comprobaciones) y 26/26 suites.
- Desplegado: API `fabri-api` y web `forge-core-stock`.

**Pendiente**: probar la APK en un teléfono con una tienda real (el build no se
ejecuta en este entorno); confirmar la compra con sesión por UI (el gate y el
prellenado ya están verificados).

## Sesión 2026-11-24 · Conexión APK/tienda con clave única (N18)

Pedido: que cada tienda tenga un código/API única para conectar la APK y los
dispositivos, sincronizar los productos, con respaldo local, estado y fallos,
en una página de conexión que verifique la clave, con animación en canvas
adaptada a todas las pantallas.

**Lo que ya existía (y no se duplicó)**

- `local_crear` genera una `clave` de 8 caracteres por tienda y guarda sólo su
  hash en `mercado_locales.clave_hash`; se devuelve una sola vez.
- `/api/inventario` ya era el puente APK↔nube con `local_id` + `clave`:
  `subir`, `bajar`, `buscar`, `borrar`, `subir_boletas`, `resumen`.
- Por eso **no se creó una segunda llave ni una función serverless nueva**: la
  credencial de conexión es esa misma clave.

**Backend**

- `/api/inventario` (mismo archivo): tabla `inv_conexiones` (local_id, huella
  hasheada, etiqueta, plataforma, versión, productos, conectado, último error,
  error_ts). Acciones nuevas:
  - `verificar` → ¿la clave abre esta tienda? (no registra dispositivo)
  - `estado` → igual + registra el dispositivo y devuelve dispositivos y fallos
  - `error` → registra un fallo del dispositivo
  - `desconectar` → da de baja este dispositivo
  - `respaldo` → catálogo completo de la nube en JSON
  - `subir` ahora anota el dispositivo (es una sincronización real).
- `mercado.ts`: `conexion_estado` (dueño/clave/admin) y `conexion_rotar`
  (exige `confirmar: true`, genera clave nueva, guarda hash y borra los
  dispositivos anteriores). `autorizarLocal` ahora también lee `activo`.
- Nada de datos sensibles en las respuestas: ni hash, ni correo, ni la clave.

**Página `/panel/negocio/conexion/` (N18)**

- Escena en **canvas 2D** (no WebGL, funciona sin GPU): tienda y dispositivos,
  pulsos según el estado real, vertical en pantallas angostas, DPR tope 2,
  `prefers-reduced-motion` y pausa con la pestaña oculta.
- Verificador de la clave contra la API, con latencia y distinción de clave
  mala, sin red y 503. La clave no se guarda en ningún lado.
- Estado real: clave configurada, productos en la nube, última sincronización y
  dispositivos conectados; lista de dispositivos con hora y estado; fallos
  reportados por el dispositivo.
- Rotar/generar clave con confirmación, clave visible una sola vez con copiar y
  aviso de que los equipos anteriores deben reconectarse.
- Pasos de conexión y enlace al respaldo real (exportación de Ajustes).
- En el menú del negocio como «Conexión»; `noindex` incluido.

**Puente en el cliente común**: `inventarioPost()` en `panel/comun/api.js`, para
no usar `fetch` suelto (los tests lo exigen).

**Verificación real (tienda y cuenta temporales, borradas al terminar)**

- API: estado inicial con clave y 0 dispositivos; verificar OK (897 ms);
  clave mala 401; `subir` 2 productos y dispositivo registrado; `estado` con
  «APK del local»; `error` visible en el panel del dueño; `bajar` 2 productos;
  rotar sin confirmar 400; rotar devuelve clave nueva con formato válido; clave
  vieja 401 y nueva 200; 0 dispositivos tras rotar; `respaldo` con 2 productos.
- UI (CDP): página con estado real, verificador OK (2 productos, 897 ms) y
  clave mala con su mensaje; canvas 2D pintando (5.113 px); sin scroll
  horizontal en 320, 390 y 1024 px; 2 columnas en escritorio; rotar mostró
  `VGW6-S8CD` y el aviso; con un dispositivo real apareció «APK del local ·
  android · 2.0.1 · 1 producto · ahora · conectado». Consola limpia.
- Tests: `tests/web/conexion-negocio.js` (42 comprobaciones) y 25/25 suites.
- Desplegado: API `fabri-api` y web `forge-core-stock`.

**Pendiente**: que la APK envíe `huella` estable y muestre esta misma pantalla
como «Stock → Conexión»; el contrato HTTP ya está listo y probado.

## Sesión 2026-11-24 · Separación estricta Cliente ↔ Negocio

Pedido: dejar separada la vista del cliente de la del negocio, que se comuniquen
sin mezclarse, y que no se muestre administración ni datos del dueño en las
pantallas de los usuarios.

**Lo que estaba mal**

- Los 26 HTML del panel no tenían `noindex`: se podían indexar.
- En `/app/` el botón «Negocio» (el panel del dueño embebido) estaba siempre
  visible, incluso para un comprador o un visitante.
- El sidebar del panel Cliente decía «Entrar para administrar tu negocio» a
  quien entraba a comprar.
- El pie del sidebar ofrecía «Estado y diagnóstico» también en la vista del
  comprador.
- No existía un puente explícito de Cliente a Negocio: un dueño no tenía cómo
  llegar a su panel desde su cuenta.

**Lo que se hizo**

- `noindex,nofollow` en los 26 HTML de `panel/` y en `/app/`.
- `web/app/negocio-acceso.js` (nuevo): el botón «Negocio» nace `hidden`; se
  revela sólo si `local_mio` devuelve tiendas propias o rol admin. Sin sesión,
  con la nube caída o sin tienda queda oculto; `#negocio` se corrige a `#panel`
  (incluye `hashchange`), se protege el clic y reacciona a `fcore:sesion`.
- `panel/comun/shell.js`: el texto del acceso y el pie dependen del panel. El
  comprador ve «comprar y seguir tus pedidos» y sólo «Abrir la app»; el negocio
  conserva diagnóstico y app de compra.
- `panel/cliente/cuenta/cuenta.js`: bloque «Tu negocio» que aparece **sólo** si
  `local_mio` devuelve tiendas; es un enlace de salida al panel del negocio, no
  un panel embebido. Una cuenta compradora no ve nada de negocio.

**Sin cambios de API**: la separación ya era correcta en el backend
(`aTienda` sin dueño/plan/clave, `pedido_seguir` sin token/teléfono/id,
`resenas_listar` sin `usuario_id`, `local_mio` filtrado por `dueno_id`). Se fijó
con tests para que no se rompa.

**Verificación real (cuentas dueña y compradora temporales, borradas al final)**

- Sin sesión: botón oculto; `/app/#negocio` → `#panel` y `s-negocio` no visible.
- Compradora: botón oculto; su Cuenta sin puente ni enlaces a `/panel/negocio/`;
  `/panel/negocio/pedidos/` muestra «Tu cuenta no tiene una tienda publicada»,
  0 pedidos y ningún dato sensible.
- Dueña: botón visible; Cuenta con «Tu negocio» y enlace a
  `/panel/negocio/resumen/`; el panel muestra su tienda.
- API: `local_mio` devuelve sólo `tienda-sep` a la dueña, 0 a la compradora y
  401 `SIN_CUENTA` sin token.
- `tests/web/separacion.js`: 43 comprobaciones. 24/24 suites web en verde.
- Desplegado en `forge-core-stock` (web). Sin cambios de API.

**Deuda anotada (no de separación):** `web/app/sw.js` lanza
`Failed to execute 'clone' on 'Response': Response body is already used` en cada
navegación; arreglarlo aparte, con subida de versión del service worker.

## Sesión 2026-11-24 · Verificación de envío con código único y recorrido 3D

Pedido: añadir al ciclo una página de verificación con un código único por
pedido y un recorrido 3D del reparto (distribuidor → carretera → casa) que
muestre el estado **real** del envío.

**Código único (`api-telefono/api/mercado.ts`)**

- `codigoVerificacion()`: 9 caracteres (`V` + 8 del alfabeto sin confundibles,
  nada de 0/O ni 1/I). Se muestra `V-XXXX-XXXX`.
- Nueva columna `mercado_pedidos.verificacion` con índice único; el `INSERT`
  del alta la guarda y `pedido_crear` la devuelve junto al seguimiento.
- `pedido_seguir` acepta `{ verificacion }` además de token y código+teléfono.
  Un código inexistente responde 404 `NO_ENCONTRADO`, con su propio texto.
- Los pedidos anteriores a la columna se completan la primera vez que alguien
  los abre (por token o por código + teléfono), con `UPDATE ... RETURNING` para
  no pisar el valor si dos peticiones coinciden. Sin migración manual.
- `pedidos_listar` y `resenas_mias` devuelven `verificacion` para que el panel y
  C12 puedan enlazar el recorrido.

**Página `/verificar.html` (`verificar.html`, `verificar.css`, `verificar.js`)**

- Pública, sin cuenta: se abre con `?v=V-XXXX-XXXX` o escribiendo el código; se
  formatea solo y tolera minúsculas y guiones.
- Estado real con chip, título y hora de actualización; refresco cada 20 s.
- Cuatro paradas con su hora real (de `eventos[].ts`): recibido, preparación,
  en camino/listo, entregado/retirado.
- Detalle real: tienda, dirección, contacto, entrega, total, pago con vuelto y
  el código de entrega mientras no se entrega.
- Escena Three.js: cámara ortográfica, carretera con guías, distribuidor con
  portón y paquetes, casa con techo, ventanas y buzón (o local, si es retiro),
  poste de luz, anillos de parada y auto de reparto. El auto **se estaciona en
  la parada del estado real**: `nuevo` origen, `visto` salida, `listo` mitad de
  ruta, `entregado` casa, `cancelado` origen. No inventa progreso.
- Honestidad: sin WebGL, con `webglcontextlost` o si Three.js no carga en 8 s,
  se muestra el aviso y el detalle textual completo. Sin red se conserva el
  último estado verificado con la hora de esa comprobación.
- Accesibilidad y peso: `prefers-reduced-motion` (sin animación), pausa el
  render con la pestaña oculta, `devicePixelRatio` tope 2 y `dispose()` de
  geometrías y materiales al salir.

**Integración con el ciclo**

- `seguir.html`: bloque con el código único y botón al recorrido 3D.
- N02: el detalle muestra el código con botón «Copiar» y el enlace al 3D.
- PWA (`placer.js`): guarda `verificacion` del alta y ofrece el recorrido en la
  pantalla de éxito.
- C12: botón «Recorrido 3D» en los pedidos entregados pendientes.
- N02 corregido: el historial usaba `ev.creado` (las filas traen `ts`), así que
  mostraba 1970; ahora usa `ev.ts`.

**Verificación real (producción, datos temporales borrados)**

- API `fabri-api`: alta devuelve `VTJKYKB9W` con formato válido; abrir por
  código y por token devuelve el mismo pedido y la misma verificación; código
  inexistente → 404; `nuevo → visto → listo → entregado` con clave; el panel
  recibe la verificación.
- Web (CDP, headless sin WebGL): el código escrito en minúsculas se formatea a
  `V-TJKY-KB9W` y abre; pedido en `listo` se lee «Tu pedido va en camino» con
  «En ruta» activo y el código de entrega visible; entregado muestra las cuatro
  paradas hechas y «Tu casa» activa; código inexistente muestra el error sin
  pintar pedido; sin red conserva el pedido y avisa con la hora; `seguir.html`
  muestra el bloque con el código y el enlace.
- Escena: el WebGL del headless de este teléfono es inestable (el GPU crashea
  con `OES_packed_depth_stencil` a los pocos segundos). En las pruebas la escena
  **se construyó y renderizó** (three creó el contexto y dibujó), y cuando el
  sistema se llevó el contexto entró el manejador `webglcontextlost` con el
  mensaje `[verificar] contexto WebGL perdido: se usa el detalle textual`. Es
  decir: el camino feliz y el de respaldo se ejercitaron de verdad. La posición
  del auto por estado se probó aparte con un Three.js simulado en Node:
  arranca en origen, `listo` → 0,58, `entregado` → 0,95, `cancelado` → origen,
  y `destruir()` no lanza.
- Tests: `tests/web/verificar-negocio.js` (53 comprobaciones) y 23/23 suites
  web en verde. Tres regex de contrato actualizadas (`efectivo`, `panel`,
  `seguimiento`) por el nuevo `verificacion` en el `INSERT` y el listado.
- Desplegado: API `dpl` de `fabri-api` y web `forge-core-stock` con
  `/verificar.html`, `/verificar.js` y `/verificar.css` en 200.

**Pendiente**: ver la escena en un navegador con GPU estable (el teléfono del
usuario). En este entorno el GPU del headless crashea y queda el modo texto.

## Sesión 2026-11-24 · Ciclo real pedido → entregado → reseña verificado

Cierra el último pendiente de la fase 2 del Panel Negocio: probar el ciclo
completo con cuentas reales, sin datos sembrados a mano.

- **Preparación:** dos cuentas temporales (dueña y compradora), tienda con un
  producto, y un pedido creado por la compradora con `pedido_crear` (queda
  ligado a `cliente_id`, requisito de `resenas_mias`).
- **Entrega por UI (N02, sesión dueña):** `nuevo → visto → listo → entregado`;
  el paso a `entregado` abrió el `prompt()` de la clave de entrega y se
  respondió el código real; `pedidos_listar` confirmó `estado = entregado`.
- **Reseña por UI (C12, sesión compradora):** el pedido apareció como
  pendiente desde `resenas_mias`, se eligieron 5★ y texto, y se publicó;
  `resenas_mias` quedó con 1 reseña y 0 pendientes.
- **Panel (N08, sesión dueña):** promedio público **5,0** con 1 visible,
  distribución 5★ = 1, filtros y botón de moderación; 0 errores de consola en
  las tres pantallas.
- **Limpieza:** `local_borrar` (tienda, productos, pedidos y reseñas) y
  `borrar` para ambas cuentas; `local_mio` respondió `SESION` al final.

**Hallazgo técnico (pruebas por CDP):** `dispositivo()` en
`web/panel/comun/sesion.js` sólo acepta ids de 16–64 chars `[A-Za-z0-9_-]`.
Sembrar una etiqueta corta (p. ej. `cierrea01`) hace que el navegador genere
otro id, la huella `huellaDispositivo()` no coincida y la API responda 401
«esta sesión se abrió en otro dispositivo». Para probar por navegador hay que
sembrar un id válido y re-loguear con ese mismo id; `fcore.nube` se guarda
como texto JSON, `fcore.dispositivo` y `fcore.panel.negocio.tienda` en crudo.

Sin cambios de código: sólo verificación. Repo limpio y pusheado.

## Sesión 2026-11-20 · Panel Negocio: N01–N04, N06, N07, N08, N14 y N16 desplegados

Pedido: construir el Panel Negocio (`web/panel/negocio/`), que no existía, con
los módulos de la fase 2 conectados a InsForge y sin crear funciones
serverless nuevas.

**Base del panel (`web/panel/comun/negocio.js` + `negocio.css`)**

- Reutiliza la MISMA sesión que el panel Cliente y la PWA (`fcore.nube`).
- `arrancar()` resuelve la tienda con `local_mio`, la guarda en
  `fcore.panel.negocio.tienda` y entrega un contexto (`cuenta`, `tiendas`,
  `tienda`, `elegir`, `fijar`, `recargar`, `llamar`) uniforme a cada módulo.
- Sin sesión muestra el acceso; sin tienda, un estado honesto con el camino
  para publicarla. El selector de tienda viaja en la barra superior.
- `comprimirImagen()` achica logo y foto en el navegador antes de subirlos.
- `limpiarSlot()` vacía el chip de tienda al cerrar sesión o borrar la última
  tienda, para que no quede un nombre pegado sobre una tienda que ya no existe.

**Módulos desplegados**

| Módulo | Ruta | Qué hace | Endpoints |
|---|---|---|---|
| N01 Resumen | `/panel/negocio/resumen/` | `ventas_serie` + `pedidos_listar` en paralelo; 4 cifras, serie por día, top 5, cola de pedidos, stock crítico. | `ventas_serie`, `pedidos_listar` |
| N02 Pedidos | `/panel/negocio/pedidos/` | Cola en 4 columnas, detalle en la tarjeta, `pedido_estado`, código de entrega y avisos push del local. | `pedidos_listar`, `pedido_estado` |
| N03 Productos | `/panel/negocio/productos/` | Catálogo real, alta/edición, foto, borrado, importación CSV/JSON; en móvil la tabla es tarjeta. | `productos_subir`, `producto_borrar` |
| N04 Inventario | `/panel/negocio/inventario/` | Matriz de stock con steppers, semáforo y guardado por lote. | `productos_subir` |
| N06 Mi tienda | `/panel/negocio/tienda/` | Ficha pública con vista previa en vivo, logo, pin por coordenadas/GPS y abrir/cerrar. | `local_actualizar`, `local_estado` |
| N07 Horarios y entrega | `/panel/negocio/horarios/` | Semana en 7 filas con franjas horarias, abrir/cerrar tienda, mínimo de compra, costo de envío y retiro/delivery. `horario.js` (puro, sin deps) parsea/escribe texto libre ≤120 chars con parser tolerante (rangos `Lun-Vie`, coma, acentos, `cerrado`). | `local_actualizar`, `local_estado` |
| N08 Reseñas | `/panel/negocio/resenas/` | Promedio y distribución (excluye ocultas), filtros por estrellas, moderar ocultar/mostrar con confirmación inline. | `resenas_panel`, `resena_moderar` |
| N14 Notificaciones | `/panel/negocio/notificaciones/` | Estado real de permiso/VAPID/suscripción de ESTE navegador; activar/desactivar/probar aviso local. Sin inventar lista de dispositivos (la API no la expone). | `ventas_serie`, `push_local_suscribir`, `push_local_baja` |
| N16 Ajustes | `/panel/negocio/ajustes/` | Cuenta y salida, plan (solo se muestra), pausa/publicación con `local_activo`, contacto con `local_actualizar`, exportación CSV/JSON en el navegador, borrado protegido por pedidos abiertos y confirmación escrita. | `local_actualizar`, `local_activo`, `local_borrar`, `pedidos_listar` |

**Módulos pendientes (fases 3–4)**

N05 Ofertas, N09 Clientes, N10 Reportes, N11 Cupones, N12 Pagos, N13 Equipo,
N15 Auditoría, N17 Integraciones — quedan `pronto` en el menú (sin página).

**Backend (`api-telefono/api/mercado.ts`)**

- `local_mio` expone `plan` y `activo` (aditivo, solo en el panel). `aTienda`
  (ficha pública y mapa) no expone el plan del dueño.
- `resenas_panel`: `calificacion.ocultas` ahora cuenta sobre TODAS las filas de
  la tienda (antes el `WHERE oculta = false` devolvía siempre 0). `n` y
  `promedio` siguen excluyendo las ocultas.
- Desplegado: `dpl_CxaCQn3ste7HixEiUBKG7jNA4QdK` (fabri-api).

**Verificación real (cuenta y tienda temporales, borradas al terminar)**

- Registro 201, sesión 200, `local_crear` 200, `local_mio` con `plan`/`activo`.
- Por la interfaz real (CDP headless, perfil aislado):
  - N07: guardó horario (80 chars, mezcla de días abiertos/cerrados), cerró y
    abrió la tienda; `local_mio` confirmó `horario`, `abierto`, `entrega`,
    `envio`, `minimo`; 0 errores de consola.
  - N08: filtró 5★ (2 items), ocultó una (promedio 4,3 → 4,0), la restauró
    (4,3); `resenas_panel` confirmó `ocultas` = 1 → 0.
  - N14: permiso denegado en headless (no se puede forzar), pantalla honesta
    (botón deshabilitado, explicación). `push_local_suscribir` y
    `push_local_baja` verificados directamente contra la API (ok).
  - N16: exportó catálogo CSV/JSON y pedidos (archivos reales en `/tmp/neg-dl`);
    pausó y republicó la tienda; guardó contacto; creó un pedido abierto y
    bloqueó el borrado; canceló el pedido, escribió el nombre exacto, borró
    la tienda y `local_mio` quedó con 0 tiendas; chip de la barra se limpió.
- `web/__seed-neg.html` borrado antes de commitear.
- 22/22 suites de `tests/web/` en verde:
  - `tests/web/panel-negocio.js`: 42 comprobaciones (9 módulos, contrato del
    shell, rutas reales, API absoluta, imports, CSS por módulo, `local_mio`
    con plan/activo, `resenas_panel` conta ocultas, `aTienda` sin plan).
  - `tests/web/horario-negocio.js`: 24 comprobaciones del parser/serializador
    (texto canónico, tolerancia a mayúsculas/acentos, 120 chars, `hoy`,
    `validar`).
- TypeScript limpio sobre los 12 `.ts`.

**Producción**

- Web `dpl_CSVdtfuNvc3tFqFrRmwp3o78Et2E` (forge-core-stock.vercel.app).
  `/panel/negocio/resumen/`, `/pedidos/`, `/productos/`, `/inventario/`,
  `/tienda/`, `/horarios/`, `/resenas/`, `/notificaciones/` y `/ajustes/`
  responden 200; `/panel/negocio` y `/panel/negocio/` redirigen al resumen
  (307); `negocio.js` y `nav-negocio.js` en vivo con los 9 módulos.
- Sin sesión, la pantalla de acceso se muestra sin errores de consola.

**Hecho**: N07, N08, N14 y N16 ya no están `pronto` en el menú.
**Pendiente**: nada de la fase 2; el ciclo real pedido → entregado → reseña se
verificó el 2026-11-24 (ver la sesión de esa fecha).

## Sesión 2026-11-20 · Mapa con canvas y cuenta conectada a InsForge

Pedido: acercar más el mapa, dibujar la ubicación propia con canvas y conectar
de verdad el login y los datos (reseñas, compras, favoritos, direcciones) a
InsForge.

**Mapa C02**

| Cambio | Detalle |
|---|---|
| Zoom real | `maxZoom: 20` con `maxNativeZoom: 19`: OSM entrega hasta 19 y Leaflet escala la última tesela; en Chile son ~0,12 m/px. Pasos de 0,5 y rueda más fina. |
| Canvas propio | Capa `<canvas>` sobre las teselas (debajo de los pines) que dibuja punto, aro, halo pulsante y círculo de precisión GPS. Se redibuja en `move`, `zoom`, `resize` y `viewreset`; respeta `prefers-reduced-motion`. |
| Precisión honesta | `pedirUbicacion` usa alta precisión y guarda `accuracy`; el chip muestra «Mi ubicación · ±18 m» o «Guardada hace 2 h». Sin GPS no se pinta Santiago como ubicación propia: se conserva la última o no se dibuja nada. |
| Radio visible | El radio de 1/3/10 km se dibuja punteado en el canvas y el zoom se calcula con los metros por píxel para que entre en pantalla. «Todo Chile» encuadra las tiendas. |
| Estado inicial | El selector parte en «Todo Chile» (antes decía 3 km sin filtrar). Al tocar «mi ubicación» pasa a 3 km y encuadra ese radio. |

**Cuenta C13**

- Bloque «En la nube» con los conteos reales de `mis_pedidos`,
  `favoritos_listar`, `direcciones_listar` y `resenas_mias`, enlazados a sus
  módulos y con reintento si InsForge no responde. Sin endpoints nuevos.
- Se corrigió el texto que todavía decía que el historial vivía sólo en el
  navegador. Ahora explica que pedidos, favoritos, direcciones y reseñas
  viajan con la cuenta.

**Fallo real encontrado en la captura**: el `<select>` decía «3 km» pero
`estado.radio` era 0 y no se dibujaba ni filtraba nada. Se alineó el estado
inicial con «Todo Chile» y se dejó el cambio a 3 km para cuando hay ubicación.

**Verificación**

- 20/20 suites de `tests/web/` en verde; `tests/web/panel.js` suma pruebas de
  `maxZoom 20`, canvas, precisión, radio y del resumen de C13.
- TypeScript limpio con `tsc --noEmit --skipLibCheck --noImplicitAny false`
  sobre los 12 `.ts` de `api-telefono/api`.
- Cuenta temporal real contra producción: `registrar` 201, `sesion` 200,
  favorito alta/listado/baja (1 → 0), dirección alta/listado/baja (1 → 0),
  `mis_pedidos` y `resenas_mias` 200 con 0. Después `borrar` 200 y `entrar`
  401 `CREDENCIALES`: no quedó cuenta de prueba.
- Capturas a 390 px del mapa (local con ubicación cacheada y canvas) y de la
  cuenta (local con sesión real y conteos 2 favoritos / 1 dirección; producción
  con el login). Sin errores de consola.

**Producción**: web `dpl_HuxU74yBraKu6foB6Gn6qMrQ8GeY` (READY). Verificado en
`https://forge-core-stock.vercel.app/panel/cliente/mapa/` y `/cuenta/` (200) y
`mapa.js` en vivo con `maxNativeZoom`.

**Pendiente**: editar nombre/teléfono desde C13 (`perfil_actualizar`), ciclo
completo pedido → entregado → reseña con una cuenta real y stock, y retirar el
evento controlado del doctor cuando haya `FABRI_API_TOKEN`.

## Sesión 2026-11-19 · Panel Cliente fase 2: C09–C12

Pedido: completar los cuatro módulos que quedaban como `pronto`, conectados a
InsForge y sin crear funciones serverless nuevas (el tope de 12 `.ts` sigue).

**Backend (`api-telefono/api/mercado.ts`)**

| Cambio | Detalle |
|---|---|
| `mercado_pedidos.cliente_id` | índice parcial; `pedido_crear` lo guarda si el Bearer es válido |
| `mercado_resenas.usuario_id` | índice parcial; `resena_crear` lo guarda si hay cuenta |
| `mercado_favoritos` | PK `(usuario_id, tipo, local_id, sku)` + snapshot nombre/precio |
| `mercado_direcciones` | tope 20 por cuenta; una sola predeterminada; `lat/lon = 0` es «sin pin» |
| Acciones nuevas | `mis_pedidos`, `favoritos_listar`, `favorito_alternar`, `direcciones_listar`, `direccion_guardar`, `direccion_borrar`, `resenas_mias` |

Las siete acciones están en la lista pública del GET y las cuatro tablas en
`asegurar`. La prueba de compra de una reseña **no** cambia: token del pedido o
código + últimos 4 del teléfono.

**Frontend**

- C09 · Mis pedidos: historial remoto (`mis_pedidos`) + local
  (`fcore.placer.pedidos`), filtros, búsqueda por código/tienda, separadores por
  mes, detalle en dos paneles y «volver a pedir» con el catálogo y precios de
  hoy. Los pedidos de invitado se marcan «sólo en este teléfono».
- C10 · Favoritos: pestañas Productos/Tiendas, corazón en la ficha de producto,
  precio actual leído del catálogo vivo, panel de bajas reales contra el precio
  guardado y producto eliminado marcado (`existe: false`). Sube los favoritos
  locales que la cuenta todavía no tiene.
- C11 · Direcciones: formulario con alias, calle, comuna y referencia; mapa
  Leaflet **local** (`/app/vendor/leaflet.js`), pin arrastrable, predeterminada,
  editar y borrar. Sin buscador de calles ni geocodificación inventada.
- C12 · Reseñas: pedidos entregados pendientes con estrellas grandes, envío con
  token o código + últimos 4, historial propio (`resenas_mias`) y respaldo local
  en `fcore.panel.resenas`.
- Piezas comunes nuevas: `web/panel/comun/favoritos.js` y
  `web/panel/comun/direcciones.js` (nube + espejo local). El checkout ofrece las
  direcciones guardadas desde el espejo y luego desde la nube.
- `nav-cliente.js` ya no tiene `pronto`; agrega Direcciones y Reseñas en «Mi
  cuenta».

**Fallos reales encontrados al revisar capturas** (corregidos, con prueba)

- C09 quedaba con el `<body>` vacío: `querySelector('[data-detalle]')` atrapaba
  el propio `<body data-detalle="0">` y `innerHTML` borraba sidebar, topbar y
  contenido. Ahora el detalle se selecciona por `.pedido-detalle`.
- `favoritos.css` tenía una llave `}` de más: la media query de 880 px no se
  aplicaba y en móvil la columna lateral de 340 px aplastaba la lista a 32 px.
  Se corrigió y las seis hojas nuevas/tocadas quedaron con llaves balanceadas.
- «Cargando» y los estados vacíos se muestran sin fingir datos: sin sesión, sin
  red y sin pedidos se explican con enlaces reales.

**Verificación**: 20/20 suites de `tests/web/` en verde (panel ampliado con los
4 módulos y el contrato de las 7 acciones) y `tsc` 5.6.3 sin errores. Capturas a
390 px de C09–C12 con el headless shell, locales y en producción.

**Producción**: API `fabri-suxmpjqqa` y web `forge-core-stock-382f95mjo`.
`asegurar` devuelve las 9 tablas (incluidas `mercado_favoritos` y
`mercado_direcciones`) y las cuatro acciones privadas responden **401
SIN_CUENTA** sin sesión. Las 4 páginas nuevas responden 200 y el menú ya no
tiene `pronto`.

**Pendiente**: probar con una cuenta real el ciclo completo (crear pedido con
Bearer → verlo en C09 → marcarlo entregado → reseñarlo en C12) y retirar el
evento controlado del doctor cuando haya `FABRI_API_TOKEN`.

## Sesión 2026-11-19 · Doctor nativo: páginas, componentes y APIs medidas

Pedido: un «reactdoctor» nativo que mida los estados reales de páginas,
componentes y APIs, con página de estadísticas, errores exactos en
`archivo:línea:columna`, almacenamiento cloud ultracomprimido y resumen legible
por IA, antes de seguir con los módulos. La app es JavaScript puro, sin React:
se construyó el equivalente nativo en vez de fingir una integración de React.

**Contrato (todo dentro de `diagnostico.ts`; la API sigue en 12 funciones `.ts`, el tope)**

| Ruta | Autorización | Qué hace |
|---|---|---|
| `GET /api/diagnostico?accion=doctor&dias=14` | pública, CORS | sondea 14 páginas y 5 APIs reales, lee los reportes agregados y devuelve el resumen IA |
| `POST /api/diagnostico {accion:'reporte'}` | pública, CORS, rate limit | guarda un reporte comprimido del navegador en la fila del día |
| `POST /api/diagnostico {accion:'limpiar'}` | Bearer del dueño | borra un día o lo anterior a N días (datos de prueba) |
| `GET/POST /api/diagnostico` sin `accion` | Bearer del dueño | informe legacy de la malla, sin cambios |

**Economía de datos**: una fila por día en `doctor_dias` (`dia DATE PRIMARY
KEY`, `datos JSONB`, `bytes`), no una por evento. Topes de 25 páginas / 20
errores / 15 APIs por fila, fila máxima 48 KB y retención de 30 días. El
navegador manda como máximo 12 eventos por carga y un latido por página/día; el
servidor acepta 20 eventos y 8 KB por reporte. Medido en producción: primer
reporte con 3 eventos = **826 B**.

**Cliente doctor** (`web/doctor.js`, sin `import`/`export` para servir en la PWA
y en el panel): captura `error`, `unhandledrejection`, recursos rotos, fallos de
API, esqueletos visibles a los 15 s y páginas de más de 4 s; deduplica (máximo
3 repeticiones); limpia tokens, correos y hashes; usa `keepalive` y
`sendBeacon`; se desactiva en localhost y webdriver. `api.js` le pasa los fallos
de `auth`, `mercado` y `mercadoPost` con la ubicación del llamador
(`archivo:línea:columna`).

**Página** `/panel/doctor/` (standalone, sin sidebar): estado vivo, 6 KPIs,
periodo 1/7/14/30, un gráfico de fallos por día, tablas de páginas, APIs y
errores con stack expandible, almacenamiento, descubrimientos y resumen
copiable para IA. Caché local de 6 h con marca «stale» y refresco cada 30 s.

**Fallos reales encontrados al revisar capturas** (corregidos, con prueba):

- En móvil las tablas apiladas salían sin etiquetas: faltaba `data-label` en
  cada `td` y las columnas largas se aplastaban a la derecha.
- El sondeo usa `/ruta/` y el reporte normaliza a `/ruta`: la misma página se
  duplicaba. Ahora se cruzan sin la barra final.
- GET y POST de la misma ruta se mezclaban en una sola fila; ahora la clave es
  método + ruta.
- El reporte se leía dos veces en el POST (stream consumido); se lee una vez.

**Verificación**: 20/20 suites de `tests/web/` en verde (nueva
`tests/web/doctor.js`, que además ejecuta el doctor real en un navegador
simulado); `tsc` 5.6.3 sin errores. Producción: 14/14 páginas, 5/5 APIs y 3/3
capas de la malla; el POST real guardó 826 B y el GET devolvió el error con
`archivo:línea:columna` y correo/token ya limpiados; `limpiar` sin token
responde **401**. Capturas a 390 px y 1280 px sin scroll horizontal. Deploys:
`fabri-3y3r5cgu3` (API) y `forge-core-stock-gzu1x9a5c` (web).

**Pendiente**: la fila de hoy conserva 1 evento controlado de la prueba de humo
(«prueba controlada del doctor»). Para retirarlo cuando haya token:
`curl -X POST https://fabri-api.vercel.app/api/diagnostico -H "Authorization:
Bearer $FABRI_API_TOKEN" -H "Content-Type: application/json" -d
'{"accion":"limpiar","dia":"2026-11-19"}'`. Después: C09–C12 del Cliente y el
panel Negocio.

## Sesión 2026-11-18 · Panel Cliente, fase 1

Pedido: construir los módulos de `docs/PANELES-MODULOS.md` empezando por la
fase 1 del Cliente. Cada módulo es una página completa con **HTML, CSS y JS
propios**; el shell compartido no impone layout.

**Entregado (10 módulos):** C01 Inicio, C02 Mapa, C03 Buscar, C04 Tienda,
C05 Producto, C06 Carrito, C07 Checkout, C08 Pedido, C13 Cuenta y C14 Ayuda.
C09 Mis pedidos, C10 Favoritos, C11 Direcciones y C12 Reseñas quedan como
`pronto` en el menú (se pintan como `<span>`, no como enlace): no hay 404.

| Pieza | Dónde |
|---|---|
| Shell, piezas comunes y regla `[hidden]` | `web/panel/comun/shell.css` |
| Cliente HTTP con base absoluta, caché y reintento GET | `web/panel/comun/api.js` |
| Sesión PWA + `recuperar()` / `recuperarCodigo()` | `web/panel/comun/sesion.js` |
| Carrito compartido con la PWA y `aplicarCatalogo()` | `web/panel/comun/carrito.js` |
| Catálogo, pedidos e formato | `web/panel/comun/{catalogo,pedidos,formato}.js` |
| Navegación de ambos paneles | `web/panel/comun/nav-cliente.js`, `nav-negocio.js` |
| Términos de uso | `web/terminos.html` + `web/terminos.css` |
| Redirecciones del panel | `web/panel/index.html`, `web/panel/cliente/index.html`, `web/vercel.json` |
| Suite del panel (19.ª) | `tests/web/panel.js` |

**Decisiones**

- La API del panel usa **base absoluta** `https://fabri-api.vercel.app`. Una
  ruta `/api` relativa pega en el proyecto de la web y falla sin decir por qué.
- El carrito y la sesión reutilizan las claves de la PWA
  (`fcore.placer.carrito`, `fcore.nube`, `fcore.dispositivo`,
  `fcore.placer.pedidos`): lo armado en el panel se termina en la app.
- Cada módulo importa `../../comun/...`. Con `../comun/` el navegador no
  resuelve el módulo y la página queda en skeleton, sin error visible.
- Lo que el endpoint no expone (edición de perfil, dispositivos, sincronización
  entre equipos) se muestra como no disponible. No se inventan endpoints ni
  estados, ni se promete sincronización en el login.
- El checkout replica el contrato real de `pedido_crear`: idempotencia,
  revalidación de precios/stock y mapeo de cada rechazo del servidor.

**Fallos reales encontrados al revisar capturas** (corregidos, con prueba):

- Imports con un `../` de más en los 10 módulos → todas las páginas en skeleton.
- `[hidden]` no ocultaba `.ds-btn` (el componente declara `display:inline-flex`):
  el contador «0» del carrito y «Actualizar precios» se veían igual.
- `.exito` vivía sólo en `checkout.css` y pedido lo usaba → icono de 520 px.
  Ahora es pieza compartida en `shell.css`.
- `.migas` vivía sólo en `producto.css` y tienda lo usaba → ruta sin estilo.
- En el mapa, nombre y meta eran `<span>` en línea: la elipsis no aplicaba y la
  píldora tapaba el nombre; la meta además arrancaba con «·» sin rubro.
- El checkout mostraba «Falta $8.160» antes de escribir el monto, como si
  fuera un error del comprador. Ahora el recuadro aparece al escribir.
- En móvil el resumen iba primero y dejaba «Confirmar pedido» **antes** del
  formulario; ahora el formulario va primero.
- El héroe de Inicio prometía «3 km a la redonda» aunque la tienda más cercana
  estuviera a 108 km. Ahora muestra la distancia real («107,9 km · la más
  cercana») o el radio sólo si hay tiendas dentro.

**Verificación**: las 19 suites de `tests/web/` pasan (`node tests/web/<archivo>.js`).
`panel.js` cubre estructura de los 10 módulos, rutas y assets, imports
relativos, API absoluta, carrito/sesión compatibles, checkout, seguimiento,
mapa, ayuda, términos, redirecciones y que ningún módulo dependa del CSS de
otro. Deploy de producción `dpl_87hzsedyh…`; `/panel/` y `/panel/cliente/`
responden **307** al inicio y los 10 módulos, `/terminos.html` y los assets
responden **200**.

**Pendiente**: C09–C12 del Cliente y luego el panel Negocio (N01–N17). El
canje real de un código de recuperación sigue sin probarse de punta a punta:
el correo de prueba no está registrado en `core_usuarios`.

## Sesión 2026-11-18 · Login real con InsForge y recuperación por código

Pedido: que el login deje de vivir solo en el SQLite del navegador y pase a
InsForge Auth, sin romper `/app/`, `forge-core-stock.vercel.app` ni las 27
acciones de `mercado.ts`; y que quien olvide su contraseña pueda recuperarla con
un código de 6 dígitos al correo.

**Decisión: patrón BFF.** InsForge valida la contraseña; `fabri-api` sigue
emitiendo la sesión de 30 días contra `core_sesiones`. El JWT de InsForge no
entra a la app porque todas las acciones de `mercado.ts` autorizan contra
`core_sesiones` y `mercado_locales.dueno_id` es FK a `core_usuarios.id`
(BIGSERIAL). Migración **perezosa**: cada cuenta pasa a InsForge en su primer
login; ni reset masivo ni correos.

| Pieza | Dónde |
|---|---|
| Proyecto `Fabricore` + política (`requireEmailVerification:false`, `resetPasswordMethod:"code"`) | InsForge Cloud, `b9c9206a-…-b8cec3774e90` |
| Helper HTTP (registro, login, listar, borrar, reset) | `api-telefono/api/_auth_insforge.js` |
| Hooks externos, `abrirSesion`, compensación de huérfano en 23505 | `api-telefono/api/_auth.js` |
| Columnas `insforge_id`/`auth_origen`/`migrado_ts`, `crearPuente`, `recuperar`, `recuperar_codigo` | `api-telefono/api/auth.ts` |
| `CoreAuth.recuperar` / `recuperarCodigo` | `web/app/core-sec.js` |
| Botón «Olvidé mi contraseña» y flujo de dos pasos | `web/app/core-pro.js` |
| Plan, contrato verificado y fases | `docs/AUTH-INSFORGE-MIGRACION.md` |
| Especificación de los 31 módulos de los paneles | `docs/PANELES-MODULOS.md` |

**Interruptor `AUTH_MODO`**: `legacy` → `dual` → `insforge`. Cualquier valor
raro cae en `legacy` (el código nuevo nunca se activa por un typo). Producción
quedó en **`dual`**: InsForge manda, el hash PBKDF2 respalda si la nube no
responde. Rollback = `AUTH_MODO=legacy` y redesplegar.

**Recuperación**: `recuperar` → `send-reset-password` (202 genérico, anti
enumeración) → `recuperar_codigo` → `exchange-reset-password-token` → `reset-password`
con `{ otp, newPassword }`. Después se guarda el PBKDF2 nuevo, se revocan
**todas** las sesiones anteriores y se emite una nueva. Las cuentas legacy se
crean en InsForge con una clave aleatoria de 32 bytes para poder mandarles el
código.

**`pass_hash` se conserva también en cuentas InsForge** (cambio sobre el plan
original): es lo que hace que el rollback a `legacy` no deje a nadie afuera.

**Hallazgos**:

- **InsForge Cloud pausa el proyecto por inactividad.** Medido:
  `paused_reason:"inactivity"`; durante la pausa todo responde 503 y Postgres
  cierra el SSL. Se restaura con `POST /projects/v1/{id}/restore` (~2 min). Por
  eso `dual` es el modo estable y los crons 2/día no sirven de keepalive.
- `INSFORGE_DATABASE_URL` es `[SENSITIVE]` en Vercel y la API de metadatos
  devuelve la contraseña enmascarada (`********`): la integración se prueba
  contra el deploy, no desde el teléfono.
- El registro de InsForge devuelve **200** (no 201) y el duplicado **409**
  `AUTH_EMAIL_EXISTS`; código de reset inválido **400** `INVALID_INPUT`.
- `_auth_insforge.js` empieza con `_`: no cuenta como función. Se sigue en 12.

**Pruebas**: 19 escenarios unitarios de `_auth.js` con repo en memoria (todos
ok) y verificación real contra producción: registro legacy → sesión → login →
401 → token válido en `mercado.local_mio` → sesión rechazada desde otro
dispositivo → borrar; y en `dual`: cuenta legacy migra en el primer login
(aparece en `auth.users`), segundo login por InsForge, registro nuevo nace
vinculado, borrado desaparece de ambos lados.

**Pendiente**: canjear un código real de 6 dígitos (requiere el correo del
dueño) y construir los paneles Cliente y Negocio de `docs/PANELES-MODULOS.md`.

## Sesión 2026-11-17 · Marketplace Fase 4: búsqueda global de productos

Pedido: buscar **en todas las tiendas a la vez**, no dentro de una sola. Texto,
categoría y precio máximo; ordenar por cercanía, precio o nombre; y saltar a la
ficha de la tienda que tiene el producto. Sin salir del límite de 12 funciones:
una acción pública más de `mercado.ts`, sin tablas ni columnas nuevas.

**Decisión**: el servidor filtra y ordena; la web sólo pinta. La tienda viaja
liviana (sin catálogo ni teléfono) y la distancia se calcula en SQL
(haversine, km con un decimal). Los chips de categoría se calculan **antes** del
filtro de categoría, para poder cambiar de rubro sin perder el texto ni el
precio. Las tiendas cerradas existen y se muestran, pero al final y marcadas:
`pedido_crear` no acepta pedidos a un local cerrado.

| Pieza | Dónde |
|---|---|
| `type Busqueda`, `plano()`, `SQL_PLANO`, `coordenada()`, `leerBusqueda()`, `buscarProductos()` | `api-telefono/api/mercado.ts` |
| `productos_buscar` público por GET y por POST (mismo contrato para la APK) | `api-telefono/api/mercado.ts` |
| GET con `lat`/`lon` ausentes ya no cae en `0,0` | `api-telefono/api/mercado.ts` |
| Chips de categoría ordenados por `p.categoria` (no `nombre`, ambiguo) | `api-telefono/api/mercado.ts` |
| Las cerradas van al final en los cuatro órdenes | `api-telefono/api/mercado.ts` |
| Botón «Buscar productos» en el menú del mapa (`mpBuscarProdBtn`) | `web/app/index.html` |
| Hoja `mpBuscarProd` con `mpBusForm`, `mpBusQ`, `mpBusPrecio`, orden, chips y resultados | `web/app/index.html` |
| Estado `ESTADO.bus`, debounce 420 ms, sello anti-respuestas-viejas, salto a la tienda | `web/app/placer.js` |
| Catálogo vacío ofrece «Buscar en todas las tiendas» con el texto ya escrito | `web/app/placer.js` |
| Estilos `.mp-bus-*`, `.mp-chips`, `.mp-vacio-btn` y marca «cerrada» | `web/app/placer.css` |
| `sw.js` v97 | `web/app/sw.js` |
| Prueba estática nueva | `tests/web/busqueda.js` |

**Contrato**:

- `GET /api/mercado?accion=productos_buscar` (y POST). Público, sin cuenta.
- `q` (o `buscar`) 2–60; `categoria`; `precio_max` (o `precio`); `lat` + `lon`;
  `orden` (`cercania`, `precio`, `precio-desc`, `nombre`); `limite` 1–60.
- Sin texto, categoría ni precio → **400 `BUSQUEDA_CORTA`**.
- `total` y `tiendas` se cuentan antes del `LIMIT`; `resultados` lleva
  `{ tienda, producto, dist }` y `categorias:[{nombre,n}]`.
- El texto busca nombre, categoría, SKU, código de barras, tienda y marca;
  ignora mayúsculas y acentos y escapa `%`, `_` y `\`.
- Sin coordenadas no hay distancia ni orden por cercanía: cae a `precio`.

**Bugs reales corregidos en el camino**:

- `ORDER BY nombre COLLATE "C"` era ambiguo entre producto y local:
  PostgreSQL devolvía «column reference "nombre" is ambiguous» y la búsqueda
  entera fallaba. Ahora ordena por `p.categoria COLLATE "C"`.
- En GET, `lat`/`lon` ausentes llegan como `null` y `Number(null)` es `0`: el
  servidor creía que el comprador estaba en el Golfo de Guinea. `coordenada()`
  distingue «sin ubicación» (`null`, `''`, fuera de rango) de una coordenada
  real.
- Las tiendas cerradas podían tapar a las abiertas en el orden por cercanía o
  precio, aunque no pueden recibir pedidos. Ahora van al final y la tarjeta las
  marca «cerrada».

**Pruebas ejecutadas**:

- `node tests/web/busqueda.js` → **83 OK** (nuevo: contrato, filtros, precio
  efectivo, comodines, chips, haversine, órdenes, cerradas al final, tienda
  liviana, hoja, estado, debounce, sello, salto, catálogo vacío, estilos, `sw`).
- Batería completa verde: **18/18** archivos (`codigos.js` se adaptó a
  `camposProducto(k)`; `efectivo.js` tolera `sw` ≥ 95).
- TypeScript limpio con el `tsc` de Vercel (mismo comando que la fase 3).
- API real en producción con **dos** locales desechables (`f4-alfa-<sello>` y
  `f4-beta-<sello>`) y 8 productos: texto entre tiendas sin cuenta,
  mayúsculas/acentos, tienda/SKU/código, `%%` y `__` → 0, `100%` → jugo,
  categoría con chips de otros rubros, precio efectivo con descuento, órdenes
  cercanía/precio/precio-desc/nombre, caída a precio sin GPS, límite con total
  completo, `BUSQUEDA_CORTA`, cerrada al final y marcada, `local_ver` y
  `codigo_buscar` intactos, y borrado de ambos locales. **39/39**.
- Deploy API `dpl_4UbMVBeUtjnwjUjBkBmLgiUDegiL` (12 funciones `.ts`) y web
  `dpl_EgDeoCA3W341ZRiAqZj3RgPxq5cx` (`sw` v97); alias
  `fabri-api.vercel.app`, `forge-core-stock.vercel.app` y
  `fabri-core-web.vercel.app` en 200, con `placer.js` que trae
  `productos_buscar`, la hoja y la marca «cerrada».
- Commit `a2f168f` (`feat(marketplace): búsqueda global de productos entre
  tiendas`), empujado a `origin/master`.

**Pendiente**: la cuenta root sigue en 0 (`F.eduardomicolta@gmail.com` debe
registrarse una vez en `/app/` y queda `owner`); el pago con tarjeta sigue
simulado; la tienda «Solución» sigue sin productos cargados.

## Sesión 2026-11-17 · Marketplace Fase 3: dirección, efectivo con vuelto y código de entrega

Pedido: que el pedido se pueda pagar **de verdad en efectivo** (con vuelto),
que el delivery lleve dirección completa y que la entrega se confirme con un
código que sólo tiene el comprador. Sin salir del límite de 12 funciones: todo
dentro de `mercado.ts`.

**Decisión**: el vuelto y el código de entrega los manda el servidor. El
navegador sólo muestra una vista previa; al crear el pedido, la API recalcula
el total con el catálogo, el vuelto con `efectivoDe(total, con)` y genera un
PIN de 4 dígitos (`clave_entrega`) para todo pedido nuevo. El local no recibe
el PIN en el listado: sólo `requiere_clave`, y al marcar «entregado» debe
escribir el código que le dicta el comprador.

| Pieza | Dónde |
|---|---|
| Columnas `comuna_entrega`, `referencia_entrega`, `metodo_pago`, `pago_con`, `vuelto`, `clave_entrega` + `ALTER` idempotente | `api-telefono/api/mercado.ts` |
| `PAGOS`, `claveDeEntrega()` y `efectivoDe()` | `api-telefono/api/mercado.ts` |
| `SIN_DIRECCION`, `SIN_COMUNA` y `PAGO_CORTO` (400 con `faltan` y `total`) | `api-telefono/api/mercado.ts` |
| `pedido_crear` guarda y devuelve pago, vuelto y PIN en sus tres salidas | `api-telefono/api/mercado.ts` |
| `pedido_seguir` devuelve pago, dirección completa y PIN | `api-telefono/api/mercado.ts` |
| `pedidos_listar` devuelve pago y dirección, más `requiere_clave` (nunca el PIN) | `api-telefono/api/mercado.ts` |
| `pedido_estado` a `entregado` exige el PIN; 409 `CLAVE_ENTREGA` | `api-telefono/api/mercado.ts` |
| Checkout: efectivo por defecto, `mpPagoCon`, atajos de monto, vuelto vivo, comuna, referencia y teléfono obligatorio | `web/app/placer.js` + `index.html` + `placer.css` |
| Pantalla de éxito con vuelto del servidor y bloque `mp-clave` con el PIN | `web/app/placer.js` + `placer.css` |
| Panel: línea de pago, dirección completa y caja `neg-verif` para el código | `web/app/negocio.js` + `styles.css` |
| Seguimiento: `pagoTexto()`, comuna, referencia y bloque `sg-clave` | `web/tienda-seguir.js` + `tienda.css` |
| `sw.js` v95 | `web/app/sw.js` |

**Reglas que quedaron**:

- Delivery: calle y número ≥ 5 (`SIN_DIRECCION`) y comuna ≥ 2 (`SIN_COMUNA`).
- `metodo_pago` acepta `efectivo`, `transferencia` y `tarjeta`; ausente o
  desconocido queda `''` (los clientes viejos siguen funcionando). La tarjeta
  sigue simulada.
- `pago_con = 0` significa monto justo; `vuelto` siempre lo calcula el servidor.
- Todo pedido nuevo nace con PIN; los pedidos viejos con `clave_entrega = ''`
  se pueden entregar sin código.
- `pedidos_listar` expone `requiere_clave` (booleano) y nunca el PIN;
  `pedido_seguir` sí lo expone porque el enlace es del comprador.
- El evento de la entrega verificado anota «código de entrega verificado».

**Bugs reales corregidos en el camino**:

- `pagar()` usaba `total` sin declararlo: `ReferenceError` a los 1,6 s, justo
  cuando se cerraba el pago. Ahora hay una sola `totalPago()` y un guard
  `if (!ESTADO.pago) return` si la hoja se cerró mientras confirmaba.
- El mensaje de WhatsApp se armaba con `itemsDe(m)` después de vaciar el
  carrito: salía sin productos. Ahora usa `ESTADO.pago.items`, guardados al
  abrir la hoja.
- `enganchar()` corría después de `pintarPanel()` y pisaba el `onchange` del
  selector de estado, saltándose la verificación. Los handlers de pedidos
  quedaron en `engancharPedidos()`, única fuente para lista y panel.

**Pruebas ejecutadas**:

- `node tests/web/efectivo.js` → **51 OK** (nuevo: esquema, reglas, quién ve
  el PIN, checkout, panel y seguimiento).
- `node tests/web/pedidos.js` → **40 OK** (contrato del INSERT de 21 columnas).
- Batería completa verde: **17/17** archivos.
- TypeScript limpio con el `tsc` de Vercel:
  `node …/vercel/node_modules/typescript/bin/tsc --noEmit --skipLibCheck
  --target es2022 --module esnext --moduleResolution bundler api/mercado.ts`.
- API real con el local desechable `f3-<sello>` (creado y borrado):
  `SIN_DIRECCION`, `SIN_COMUNA`, `PAGO_CORTO`, vuelto real, PIN de 4 dígitos,
  comuna y referencia, idempotencia con el mismo PIN y vuelto, seguimiento con
  PIN, listado sin PIN y con `requiere_clave`, entrega sin PIN y con PIN malo
  → 409, con PIN bueno → entregado y evento verificado, cliente viejo sin
  `metodo_pago`, cancelación sin PIN y limpieza. **34/34**.
- Deploy API `dpl_7hhjNkwekTVzkuJB2rmxZptSypMZ` (12 funciones `.ts`) y web
  `dpl_Ea7KfWdAkZpdKTcmzDDXVWfRj3rV` (`sw` v95); alias
  `fabri-api.vercel.app`, `forge-core-stock.vercel.app` y
  `fabri-core-web.vercel.app` en 200, con el JS desplegado que trae efectivo,
  PIN y `requiere_clave`.
- Commit `1728741` (`feat(marketplace): dirección completa, efectivo con
  vuelto y código de entrega`), empujado a `origin/master`.

**Pendiente**: la cuenta root sigue en 0 (`F.eduardomicolta@gmail.com` debe
registrarse una vez en `/app/` y queda `owner`); el pago con tarjeta sigue
simulado; la tienda «Solución» sigue sin productos cargados.

## Sesión 2026-11-17 · Marketplace Fase 1: fotos de producto

Pedido: que el catálogo deje de verse como demo (gradientes y letras) y que
cada producto tenga su foto real, sin salir del límite Hobby de 12 funciones.

**Decisión**: la foto se guarda como data URL comprimida en `mercado_productos`
(`imagen`, `imagen_hash`) y se publica por `imagen_ver`; no se usa Cloudinary
ni se crea una función nueva. El catálogo devuelve una URL corta y versionada,
no el data URL, para no inflar el JSON del mapa.

| Pieza | Dónde |
|---|---|
| Columnas `imagen` / `imagen_hash` + `normalizarImagen` | `api-telefono/api/mercado.ts` |
| `GET ?accion=imagen_ver` (binario, inmutable, CORS) | `api-telefono/api/mercado.ts` |
| `productos_subir` conserva/borra según `imagen` | `api-telefono/api/mercado.ts` |
| `pedido_crear` guarda la foto en el snapshot | `api-telefono/api/mercado.ts` |
| `achicarFoto` 640 px JPEG 0.7, preview y quitar | `web/app/negocio.js` + `index.html` + `styles.css` |
| Miniatura en catálogo, carrito y pedido del panel | `negocio.js`, `placer.js`, `styles.css`, `placer.css` |
| Foto en la ficha 3D con respaldo de etiqueta | `tienda3d.js` + `index.html` |
| `sw.js` v93 | `web/app/sw.js` |

**Pruebas ejecutadas**:

- `node tests/web/fotos.js` → **61 OK** (nuevo).
- Batería completa verde: `auth-nube`, `boleta`, `descuentos`, `diseno`,
  `escaneo`, `fotos`, `marca`, `negocio`, `pedidos`, `plataforma`, `push`,
  `resenas`, `seguimiento`, `trafico`, `visor`.
- API real con `t-f1-fotos`: alta → foto → `Content-Type image/jpeg` y bytes
  idénticos → re-subida sin `imagen` conserva URL y cambia stock → `imagen: ""`
  borra y 404 sin caché → baja. 21 comprobaciones.
- Navegador real (Chrome headless 390×844): la hoja de marca pinta 2 fotos y
  deja la letra al producto sin foto; la compresión convirtió 1200×1200
  (84.696 B) en 640×640 (20.376 B).
- Deploy API `dpl_FixPUD6FaSJkCgDt6XMqkHYPdDrB` (12 funciones `.ts`) y web
  `dpl_4T3fgWyWSKQzF4jyYwzXt6abzEiE` (`sw` v93); alias
  `fabri-api.vercel.app`, `forge-core-stock.vercel.app` y
  `fabri-core-web.vercel.app` en 200.
- Commit `b358e07` (`feat(marketplace): fotos de producto en catálogo,
  carrito y pedido`), empujado a `origin/master`.

**Pendiente**: que el vendedor cargue las fotos de sus 6 productos de
«Solución» (la app ya está lista); después Fase 2 (código de barras real +
buscar entre marcas) y Fase 3 (dirección + efectivo + verificación).

## Sesión 2026-11-17 · Marketplace Fase 2: código de barras real

Pedido: que cada producto tenga su código de barras de verdad (no uno
inventado) y que el comprador pueda escanearlo una vez para encontrar el mismo
producto en todas las marcas, comparando precio y stock. Sin salir del límite
de 12 funciones: todo va dentro de `mercado.ts`.

**Decisión**: el código vive en `mercado_productos.codigo` (`TEXT NOT NULL
DEFAULT ''`, índice parcial `WHERE codigo <> ''`) y se valida en el servidor
con GS1 (EAN-8/UPC-A/EAN-13/GTIN-14) o Code 128/39 alfanumérico. La búsqueda
entre marcas es una acción pública más de `mercado.ts`, no una función nueva.

| Pieza | Dónde |
|---|---|
| Columna `codigo`, `ALTER`, índice parcial y `digitoGS1Ok` | `api-telefono/api/mercado.ts` |
| `productos_subir` conserva/borra e informa `codigos_invalidos` | `api-telefono/api/mercado.ts` |
| `codigo_buscar` público GET/POST (activos, precio efectivo, tope 50) | `api-telefono/api/mercado.ts` |
| `codigo` en el ítem normalizado y en el snapshot JSONB del pedido | `api-telefono/api/mercado.ts` |
| Campo, escaneo, validación y miniatura del código | `web/app/index.html`, `negocio.js`, `styles.css` |
| CSV: `codigo_barras`/`barcode`/`ean`/`upc`/`gtin`/`barra` ≠ `codigo` (SKU) | `web/app/negocio.js` |
| Búsqueda real, hoja `mpCodigos` y apertura de marca filtrada | `web/app/placer.js`, `index.html`, `placer.css` |
| Ficha 3D con `p.codigo` real; EAN-13 dibujado, el resto textual | `web/app/tienda3d.js`, `styles.css` |
| `sw.js` v94 | `web/app/sw.js` |
| Pruebas (67 comprobaciones nuevas) | `tests/web/codigos.js` |

- **Conservar no es borrar**: si el lote no trae `codigo`, se conserva el
  anterior; `codigo: ""` lo borra. Un código inválido guarda vacío en
  `EXCLUDED` pero el `CASE` conserva el bueno (`cod.ok`) y se informa en
  `codigos_invalidos` + `detalle_codigos_invalidos`: el panel lo muestra con
  el ejemplo y el producto no pierde su código.
- **Buscar no crea tablas**: el GET de `codigo_buscar` no llama `asegurar`
  (una lectura pública no ejecuta DDL) y tolera que `mercado_resenas` no
  exista. Devuelve `resultados: [{ tienda, producto }]` con
  `tienda.catalogo: []`; el comprador pide `local_ver` al abrir una marca.
- **Una marca o varias**: si el código está en una sola, se abre directo su
  ficha con el catálogo filtrado; si está en varias, se muestra la hoja
  `mpCodigos` (logo, comuna, stock, precio y −%) ordenada por precio. El
  buscador del catálogo también entiende nombre, SKU y código.
- **El código no se inventa**: la ficha 3D usa `p.codigo`; sólo dibuja barras
  EAN-13 si tiene 13 dígitos. Un EAN-8, UPC, Code 128 o SKU se muestran como
  texto. `Mercado.codigoDe` queda para el catálogo legacy.
- **Bug real encontrado y corregido**: `items.push` llevaba `codigo`, pero el
  `JSON.stringify` del snapshot en `pedido_crear` lo omitía. La prueba real lo
  detectó (el pedido se creaba y cobraba, pero el seguimiento no mostraba el
  código). Se agregó al `map`, se sumó una comprobación a `codigos.js` y se
  redesplegó la API.

**Pruebas ejecutadas**:

- `node tests/web/codigos.js` → **67 OK** (nuevo).
- Batería completa verde: **16/16** archivos (`auth-nube`, `boleta`,
  `codigos`, `descuentos`, `diseno`, `escaneo`, `fotos`, `marca`, `negocio`,
  `pedidos`, `plataforma`, `push`, `resenas`, `seguimiento`, `trafico`,
  `visor`).
- TypeScript limpio con el `tsc` de Vercel:
  `node …/vercel/node_modules/typescript/bin/tsc --noEmit --skipLibCheck
  --target es2022 --module esnext --moduleResolution bundler api/mercado.ts`.
- API real con `t-f2-marca-a` y `t-f2-marca-b`: mismo EAN en dos marcas,
  orden por precio efectivo, EAN-8 en una sola, código libre en 0, checksum
  roto y código corto en 400, lote sin columna que conserva, inválido que no
  borra e informa, vacío que borra, restaurar, pedido con el código en el
  snapshot y baja de marca que la saca de la búsqueda. **32/32**; las dos
  marcas quedaron borradas.
- Deploy API final `dpl_GcrNw2SpWoHPAzEqpzYYiNA4foNi` (12 funciones `.ts`) y
  web `dpl_GRcF44AknsMcA7oP8ecvhs4umrNm` (`sw` v94); alias
  `fabri-api.vercel.app`, `forge-core-stock.vercel.app` y
  `fabri-core-web.vercel.app` en 200; `/api/mercado?diag=1` lista
  `codigo_buscar`.
- Commit `875490b` (`feat(marketplace): código de barras real y búsqueda
  entre marcas`), empujado a `origin/master`.

**Pendiente**: que el vendedor cargue fotos y códigos reales en «Solución»
(hoy la tienda está publicada pero sin productos); después Fase 3 (dirección
+ efectivo + verificación).

## Sesión 2026-11-16 · Fase 10: el visor 3D es del local y compra en su carrito

Pedido: que cada dueño tenga su panel, publique su local en el mapa con
catálogo, y que el comprador pueda recorrer **su** tienda en 3D y comprar desde
el estante o el catálogo, para cerrar por WhatsApp.

**La brecha real**: había dos tiendas en paralelo. El visor 3D
(`tienda3d.js`) usaba el escaparate legacy (`window.Mercado`,
`/api/catalogo`, carrito `fcore.mercado.carrito`), mientras MercadoPlacer
(`placer.js`) usaba `/api/mercado` y el carrito `fcore.placer.carrito` por
local. Si el comprador tocaba un producto en el estante, caía en un carrito que
el checkout de MercadoPlacer no veía. Además el dueño no podía abrir su propia
tienda en 3D desde el panel.

| Pieza | Dónde |
|---|---|
| `ponerTienda(catalogo, local, origen)` guarda el local y de dónde se abrió | `web/app/tienda3d.js` |
| Rótulo del muro con la marca y el nombre del local (se achica si es largo) | `web/app/tienda3d.js` |
| `agregar()` delega en `Placer.agregarDesdeVisor` cuando hay local | `web/app/tienda3d.js` |
| Contador del visor con `Placer.resumenDeLocal(id)` | `web/app/tienda3d.js` |
| `agregarDesdeVisor(p, m)` resuelve sku → id → nombre y cobra el catálogo | `web/app/placer.js` |
| `resumenDeLocal(id)` y `abrirCarrito` exportados | `web/app/placer.js` |
| La ficha pública entra con `ponerTienda(productos(m), m, "mapa")` | `web/app/placer.js` |
| Botón **Ver en 3D** en la cabecera del panel del dueño | `web/app/negocio.js`, `web/app/index.html` |
| Atrás vuelve al panel del dueño, a la ficha o al escaparate según el origen | `web/app/mercado.js` |
| El carrito del visor con local abre el de MercadoPlacer | `web/app/mercado.js` |
| CORS: `X-Dispositivo` declarado en `Access-Control-Allow-Headers` | `api-telefono/api/mercado.ts`, `api-telefono/api/auth.ts` |
| Pruebas (67 comprobaciones nuevas) | `tests/web/visor.js` |

- **Un solo carrito con local**: el producto tocado en el estante se resuelve
  contra `productos(m)` por `sku`, luego por `id`, luego por nombre; se guarda
  con el `sku`, el precio efectivo y el descuento **del servidor**, y el tope
  de stock del catálogo. Sin local abierto, el visor sigue usando el carrito
  del escaparate de la casa: no se rompió el recorrido público de FORGE.
- **La marca manda**: con local, el wordmark del muro dice su `marca` (o su
  `nombre`) y debajo el nombre del negocio; sin local sigue diciendo FORGE
  CORE STOCK. El rótulo mide el texto y baja el cuerpo para que un nombre largo
  no se salga.
- **El dueño lo abre desde su panel**: **Ver en 3D** aparece en la cabecera
  del panel cuando hay una tienda seleccionada; avisa «sin productos» si el
  catálogo está vacío. La escena se abre a pantalla completa, nunca embebida.
- **Atrás y carrito saben de dónde vinieron**: `origenDe()` devuelve `mapa` o
  `negocio`; `localActivo()` devuelve el local. Con local, el botón del carrito
  sale del visor y abre la hoja de MercadoPlacer (el pedido real).
- **Fallo de producción encontrado y corregido**: el panel del dueño manda
  `X-Dispositivo` en cada llamada, pero la API sólo declaraba
  `Content-Type, Authorization` en CORS. El navegador bloqueaba el preflight y
  el panel no podía conectar por clave ni por cuenta. Se agregó el encabezado
  en `mercado.ts` y `auth.ts`; la API se redesplegó.

**Verificado de verdad**:

- `node tests/web/visor.js` → **67 comprobaciones OK** (contrato de
  `ponerTienda` con local y origen, rótulo dinámico, carrito compartido,
  resolución por SKU/nombre, tope de stock, `resumenDeLocal`, botón del panel,
  salidas y fallback legacy). Batería completa en verde: `descuentos` 61,
  `pedidos` 40, `negocio` 118, `plataforma` 57, `push` 92, `resenas` 83,
  `seguimiento` 70, más `auth-nube`, `boleta`, `diseno`, `escaneo`, `trafico`.
- **Web**: `dpl_36mopHcrywFvDYNDvd3ffNNDd6R2` READY; los seis archivos
  publicados (`tienda3d.js`, `placer.js`, `negocio.js`, `mercado.js`, `sw.js`,
  `index.html`) son byte a byte idénticos al repo; `sw.js` en `fcore-v85`;
  `forge-core-stock.vercel.app` y `fabri-core-web.vercel.app` en 200.
- **API**: `dpl_EyF1aDkjUkND9yxzaNv3heVkKcv9` READY; el preflight de
  `/api/mercado` y `/api/auth` ya devuelve `X-Dispositivo`; el catálogo
  público sigue en 200.
- **Prueba funcional en producción** (tienda desechable `t-f10-visor`,
  navegador headless): panel del dueño conectado por clave → **Ver en 3D** →
  visor con `localActivo().id = t-f10-visor`, marca `F10`, origen `negocio` y
  escena construida → ficha del estante («Café de grano 250 g», $5.990, 8
  disp.) → añadir → el carrito `fcore.placer.carrito` queda con `VIS-001` a
  $5.990 y el carrito legacy intacto → la hoja de MercadoPlacer muestra el
  mismo producto y total → `pedido_crear` devuelve **MP-87A4D**, total $5.990,
  con seguimiento → el pedido aparece en **Negocio → Pedidos** con sus
  acciones. La tienda se borró al final: la base quedó con las 2 tiendas demo
  y el pedido de prueba ya no existe.
- **Límite honesto de la prueba**: el navegador headless usa SwiftShader y el
  canvas 3D salió negro por errores de shader del entorno; la escena, la ficha
  y todo el flujo lógico sí se construyeron y verificaron. La validación
  visual del render 3D queda para un teléfono real.

**Lo que sigue (punto 4, fuera de esta fase)**: «Cobrar por WhatsApp» en el
pedido del dueño (monto + código + enlace de seguimiento y evento
`pago_avisado`). El cobro real con link de pago exigiría Mercado Pago o
Transbank, fuera de las 12 funciones actuales.


## Sesión 2026-11-16 · Fase 11: cada marca tiene su link y su visor

Pedido: un marketplace donde cada vendedor tenga login real, catálogo
independiente y **un link único de marca** para mostrar su visor 3D; el
comprador agrega desde el mapa o el catálogo al carrito de esa marca y compra
en ella.

**La brecha real**: el visor 3D ya era del local (Fase 10), pero sólo se abría
desde el mapa o desde el panel del dueño. No existía un enlace estable para
compartir una marca, y un comprador que llegara directo no tenía el local en
`ESTADO.mercados`: el carrito guardaba nombre y precio, pero el pago no conocía
mínimo, envío, entrega ni cierre. La cuenta del vendedor tampoco tenía una
tarjeta que dijera qué está protegido y qué es público.

| Pieza | Dónde |
|---|---|
| `GET/POST /api/mercado?accion=local_ver&id=<local_id>` (público, sólo activos) | `api-telefono/api/mercado.ts` |
| `traerLocal()` con catálogo + calificación; inexistente → 404 `NO_ENCONTRADO` | `api-telefono/api/mercado.ts` |
| `aTienda()` devuelve `forge: true` para todo local de la base | `api-telefono/api/mercado.ts` |
| `cargarMarca(id)` y arranque con `?marca=<id>#tienda` sin cuenta | `web/app/app.js` |
| `Placer.registrarLocal(m)` deja el local disponible aunque no venga del mapa | `web/app/placer.js` |
| El carrito guarda `forge`, `minimo`, `envio`, `entrega`, `telefono`, `abierto`, `lat`, `lon` | `web/app/placer.js` |
| `Placer.productosDe(m)` normaliza precio efectivo y descuento vigente | `web/app/placer.js` |
| Link de marca en el panel (cabecera + Ajustes con copiar/WhatsApp/abrir) | `web/app/negocio.js`, `web/app/index.html` |
| Tarjeta «Cuenta y seguridad» con nombre, correo, rol y marca | `web/app/negocio.js`, `web/app/index.html` |
| Salida del visor: limpia `?marca`, vuelve al mapa y abre la ficha del local | `web/app/mercado.js` |
| Marca sin catálogo → estantes vacíos, nunca el escaparate legacy | `web/app/tienda3d.js` |
| Pruebas (61 comprobaciones) | `tests/web/marca.js` |

- **El link**: `https://forge-core-stock.vercel.app/app/?marca=<local_id>#tienda`.
  No arrastra `lat`, `lon` ni `demo` de una visita anterior. Se lee antes de
  retirar el cargador, pide `local_ver`, registra el local y abre el visor con
  origen `marca`. Sin cuenta. Si la marca no existe, limpia el parámetro y
  sigue por el mapa; nunca deja al comprador en una pantalla muerta.
- **La marca manda en el carrito**: `registrarLocal()` deja el local en
  `ESTADO.mercados` y `cambiar()` copia sus reglas al carrito. Así el pago
  respeta mínimo, envío, entrega y cierre aunque el comprador nunca haya
  abierto el mapa. El pedido se arma y se cobra contra ese local.
- **Precio honesto**: el visor recibe `Placer.productosDe(m)`, no el catálogo
  crudo; muestra el precio efectivo y el descuento vigente que calcula el
  servidor. Una marca sin productos usa `SIN_PRODUCTOS` y muestra estantes
  vacíos: no cae en los productos del escaparate de la casa.
- **Salida**: «atrás» limpia `?marca`, cierra el visor y vuelve al mapa global
  con la ficha del local abierta. Recargar ya no reabre la marca. El carrito
  del visor sigue abriendo el de MercadoPlacer.
- **Cuenta y seguridad**: la tarjeta muestra nombre, correo, rol y marca. Con
  sesión de nube dice «token de 256 bits · atada a este dispositivo»; con una
  cuenta sólo local dice «cuenta de este dispositivo · sin nube». Copy honesto:
  contraseña PBKDF2-SHA256 120k, token SHA-256 en InsForge; no promete cifrado
  de datos que no existe. También se lee `Fabri.user`, así el nombre y el correo
  aparecen aunque la cuenta no tenga nube.
- **Compatibilidad**: el escaparate legacy sigue igual sin local; el mapa
  global no cambió; el catálogo de la ficha suma al carrito de esa marca.

**Verificado de verdad**:

- `node tests/web/marca.js` → **61 comprobaciones OK**. Batería completa en
  verde: `visor` 67, `negocio` 118, `descuentos` 61, `pedidos` 40,
  `plataforma` 57, `push` 92, `resenas` 83, `seguimiento` 70, más `auth-nube`,
  `boleta`, `diseno`, `escaneo`, `trafico`.
- **API**: `dpl_87zR1dEg9b5sFJgcBH8xeqXadXn7` READY con `local_ver`; el
  comentario del contrato subió a `dpl_2GHgX4NwVnZrjLWvvPeMrG4KwHoy` READY,
  alias `https://fabri-api.vercel.app`. Preflight de `/api/auth` y
  `/api/mercado` devuelve 204 con `Access-Control-Allow-Headers: Content-Type,
  Authorization, X-Dispositivo`. El build compiló las 12 funciones con
  TypeScript 5.9.3.
- **Web**: `dpl_BBXgm4tQvQaGHKaRdeg9SfNBN4aj` READY con `fcore-v86`; el
  arreglo de la tarjeta de cuenta subió a `v87`, el copy honesto para cuentas
  sin nube a `v88`, `productosDe(null)` defensivo a `v89`, el link muerto al
  mapa a `v90` y la relectura del hash limpio a `v91` →
  `dpl_54z3yNdh5XNsXHMyEz1Wsd4MHKoR` READY. Los ocho archivos publicados
  (`app.js`, `negocio.js`, `placer.js`, `mercado.js`, `tienda3d.js`,
  `styles.css`, `index.html`, `sw.js`) son byte a byte idénticos al repo;
  `forge-core-stock.vercel.app/app/` y `fabri-core-web.vercel.app/app/` en 200.
- **`local_ver` real**: tienda desechable `t-f11-marca` con `MAR-001` $5.990 y
  `MAR-002` $3.490 con 20 % → $2.792. Devuelve 200 con `forge: true`, mínimo
  $3.000, envío $1.500, retiro + delivery; inexistente → 404 `NO_ENCONTRADO`.
- **Prueba funcional en producción** (navegador headless, sin cuenta):
  `?marca=t-f11-marca#tienda` → visor con `localActivo().id = t-f11-marca`,
  marca `F11`, origen `marca`, catálogo con precio efectivo $2.792 → dos
  unidades al carrito con `forge`, mínimo, envío, entrega, teléfono, cierre y
  coordenadas → hoja «Mi pedido» con «Almacén Fase 11» y total $5.584 → pago
  «Pagar pedido Almacén Fase 11» con retiro/delivery y total $5.584 → atrás
  limpia `?marca`, vuelve a `#panel` y abre la ficha del local («F11 · Almacén ·
  Abierto») → panel conectado por ID y clave muestra el link exacto, chip
  `F11`, WhatsApp y la tarjeta de cuenta. El canvas 3D del headless sigue
  saliendo negro por SwiftShader; la escena y el flujo lógico se verificaron.
- **Limpieza**: `t-f11-marca` se borra con `local_borrar` al cerrar la fase y
  `local_ver` vuelve a 404.
- **Link muerto en el deploy final**: `?marca=t-f11-marca#tienda` con la tienda
  ya borrada → limpia `?marca`, termina en `#panel`, `enTienda: false`,
  `marcaEnUrl: false` y sin visor. El 404 de `local_ver` queda como error de
  consola esperado.

**Límite honesto**: no hay recuperación de contraseña, verificación de correo
ni página pública `/vender`. La primera cuenta real de `core_usuarios` debe ser
`F.eduardomicolta@gmail.com` (queda `owner` por `CORE_ROOT_EMAIL`); hasta que
esa cuenta se registre una vez, el login real contra producción no se puede
probar y no se crean cuentas de prueba en la nube.


## Sesión 2026-11-15 · Fase 9: el descuento lo cobra el servidor y el admin lo ve

Pedido: «continúa y robustece más la lógica del descuento de productos y stock,
la del vendedor y la conexión con el admin».

**El problema real**: el descuento no existía en la base. `placer.js` lo
inventaba en el navegador (`azar(semilla + i)` sobre `[10, 15, 20, 25] %`) para
~20 % de los productos, el comprador veía una oferta que el local nunca dio y
`pedido_crear` cobraba el precio de lista. No había forma de que el vendedor
fijara una oferta ni de que el admin supiera cuánto se había rebajado.

| Pieza | Dónde |
|---|---|
| Columnas `descuento` (0–90) y `oferta_hasta` (unix s) + `CHECK` | `api-telefono/api/mercado.ts` |
| Columna `ahorro` en el pedido | `api-telefono/api/mercado.ts` |
| `dctoVigente()` / `precioEfectivo()` / `CAMPOS_PRODUCTO` / `productoDeFila()` | `api-telefono/api/mercado.ts` |
| `productos_subir` con `tocaOferta` y conteo `ofertas` | `api-telefono/api/mercado.ts` |
| `pedido_crear` cobra el efectivo y guarda `precio_lista`/`descuento`/`ahorro` | `api-telefono/api/mercado.ts` |
| `resumen` con ofertas, stock crítico, inventario y descuentos | `api-telefono/api/mercado.ts` |
| Comprador sin ofertas inventadas y con tope de stock | `web/app/placer.js`, `web/app/placer.css` |
| Formulario, importación, catálogo y pedidos del dueño | `web/app/negocio.js`, `web/app/index.html` |
| Tarjetas **Ofertas vigentes**, **Stock por reponer** e **Inventario y descuentos** | `web/app/plataforma.js`, `web/app/index.html`, `web/app/styles.css` |
| Pruebas (61 comprobaciones nuevas) | `tests/web/descuentos.js` |
| Documentación | `docs/TIENDAS-MULTI.md` |

- **Un solo precio**: catálogo público, `local_mio`, pedido y panel usan la
  misma expresión SQL. `precioEfectivo()` = `GREATEST(1, round(precio × (100 −
  dcto) / 100))`; nunca queda en $0. `dctoVigente()` devuelve 0 si la oferta
  venció, sin borrar el porcentaje guardado.
- **Oferta que sobrevive a la planilla**: importar un lote sin columna
  `descuento` **conserva** la oferta existente (`tocaOferta`). Enviar
  `descuento: 0` la apaga y limpia la fecha. Una fecha suelta (`YYYY-MM-DD`)
  vale hasta el final de ese día en Chile (`T23:59:59-04:00`).
- **El pedido guarda el ahorro**: cada ítem lleva `precio_lista` y `descuento`;
  el pedido lleva `ahorro`. El admin lo ve como «Descuentos entregados» y el
  dueño como «ahorró $… con ofertas». `ventas_serie` suma `descuento` por
  periodo (sólo pedidos no cancelados).
- **El carrito topa con el stock**: el `+` se apaga al llegar y un agotado no
  deja agregar; el servidor sigue siendo la última palabra (`SIN_STOCK` con
  `disponible`). Cancelar devuelve el stock (Fase 7 intacta).
- **En el pago el ahorro es informativo** («Ahorro por ofertas $400», sin signo
  menos): el subtotal ya viene rebajado; restarlo otra vez mentiría el total.
- **Orden del panel admin**: estado vivo → KPIs → periodo → visitas por día
  (gráfico protagonista) → canales/rutas → ofertas y stock → inventario →
  cuentas → salud. Las tarjetas nuevas salen del mismo `resumen`; no hay
  endpoint extra (la API sigue en 12 funciones).
- **Se dejó intacto el escaparate legacy** `web/tienda-nucleo.js`
  (`window.FORGE_OFERTA` fijo): es otra tienda, la de `/api/catalogo`, no el
  marketplace multi-local.

**Verificado de verdad**:

- `node tests/web/descuentos.js` → **61 comprobaciones OK**; `pedidos.js` → 40;
  `negocio.js` → 118; `plataforma.js` → 57; `push.js` → 92; `resenas.js` → 83;
  `seguimiento.js` → 70. Batería completa local en verde (`auth-nube`,
  `boleta`, `diseno`, `escaneo`, `trafico` incluidos).
- Typecheck con TS 5.9.3 y `strict` sobre `mercado.ts`: **0 errores reales**
  (sólo el TS7016 preexistente de `pg` sin `@types`; Vercel usa esbuild y no
  type-checkea).
- **Producción, 43 comprobaciones** (`/tmp/opencode/f9-prod.mjs`, cuenta y
  tienda desechables borradas al final): catálogo con `precio_efectivo`,
  importación que conserva la oferta, oferta vencida que no rebaja, pedido con
  `ahorro` y `precio_lista`, `SIN_STOCK` con `disponible`, cancelar devuelve
  stock, `ventas_serie.descuento`, `resumen` con ofertas/stock/inventario,
  `sw.js` ≥ v84 y `placer.js` publicado sin `azar`. Base limpia después:
  0 cuentas y las 2 tiendas demo.
- Captura a 390 px del panel admin con las tres tarjetas nuevas y el orden
  completo.

**Deploy**: API `dpl_ErTEw2hPV3otPXmDJi9hgpEBFHhi` READY (alias
`https://fabri-api.vercel.app`); web `dpl_7DXJouZnw5p33CVSSfiKRRZ8cYYw` READY
(alias `https://fabri-core-web.vercel.app`); `sw.js` en `fcore-v84`.
`forge-core-stock.vercel.app`, `fabri-core-web.vercel.app` y `/app/` en 200.

**Sigue pendiente** (igual que en Fase 8): no hay cuenta root porque
`core_usuarios` está vacía — hay que registrar `F.eduardomicolta@gmail.com` una
vez en `/app/` para que quede `owner` por `CORE_ROOT_EMAIL`. El aviso por
Telegram sigue inactivo: falta `TELEGRAM_BOT_TOKEN` en el proyecto `fabri-api`.

## Sesión 2026-11-15 · Fase 8: el dueño recibe el pedido nuevo

Pedido: «continúa». Cierra el círculo del aviso: el comprador ya sabía cuándo
cambiaba su pedido; ahora el local sabe cuándo entra uno, con el panel cerrado.

| Pieza | Dónde |
|---|---|
| Tabla `mercado_push_local` + `push_local_suscribir` / `push_local_baja` | `api-telefono/api/mercado.ts` |
| Aviso al dueño al crear el pedido (`avisarLocal`, después del commit) | `api-telefono/api/mercado.ts` |
| Clave pública en el resumen del panel (`ventas_serie.push`) | `api-telefono/api/mercado.ts` |
| Despachador común comprador/dueño (`despachar`) | `api-telefono/api/mercado.ts` |
| Push y clic del aviso en el service worker de la app | `web/app/sw.js` |
| Tarjeta «Avisos del local» en Ajustes | `web/app/index.html`, `web/app/negocio.js`, `web/app/styles.css` |
| Pruebas (92 en la suite de push) | `tests/web/push.js` |
| Documentación | `docs/TIENDAS-MULTI.md` |

- **Se separa del aviso del comprador**: otra tabla y otra autorización (dueño o
  clave, hasta 5 dispositivos por tienda). El comprador sigue con su token.
- **El aviso no frena al comprador**: sale después del commit, con tope de 1 s
  por dispositivo y 3 dispositivos; si tarda o falla, el pedido ya está
  guardado. Se blindó con `try/catch` para que ningún fallo convierta un pedido
  válido en error 500.
- **Texto**: «Nuevo pedido MP-XXXXX» + «$3.980 · Ana · retiro»; al tocarlo abre
  `/app/#negocio`.
- **El service worker de la app** (`/app/sw.js`) es el que recibe el aviso del
  dueño; el del comprador (`/sw-push.js`, raíz) no se toca.
- **Bug encontrado y corregido**: `[hidden]` no ocultaba `.btn` ni `.badge`
  porque sus clases traen `display`; se agregó la regla semántica
  `[hidden] { display: none !important; }` (había parches sueltos por todo el
  CSS).
- **Bug encontrado en producción y corregido**: el reemplazo de funciones se
  había llevado `nombreClave` y `ESTADOS_FINALES`, y `pedido_crear` respondía
  `ERROR_BASE`. Se restauraron, se añadió la prueba que los exige y se blindaron
  las llamadas de aviso.
- **Verificado**: 92 comprobaciones locales de push (incluye al dueño y los dos
  service workers), 17 contra la API real (clave en el resumen, suscripción y
  baja del local, 401 sin autorización, pedido que entra con el push caído, y
  pedido sin dispositivos), más las regresiones de Fase 6 (25) y Fase 7 (32).
  Batería completa y arranque en verde. Captura a 390 px de la tarjeta en
  Ajustes y del Resumen intacto.
- **Deploy**: API `fabri-2b2enf404…` READY; web `forge-core-stock-q6z3r1y4f…`
  READY; `sw.js` en `fcore-v83`.

## Sesión 2026-11-15 · Fase 7: pedido endurecido y contador con rastro

Pedido: «endurece el pedido y contador de pedidos en admin del vendedor con
rastreo de acciones en el flujo de compra».

| Pieza | Dónde |
|---|---|
| Precio y stock desde el catálogo, idempotencia, transacción | `api-telefono/api/mercado.ts` |
| Estados terminales bloqueados y stock devuelto al cancelar | `api-telefono/api/mercado.ts` |
| Eventos con `actor` y `nota` | `api-telefono/api/mercado.ts` |
| Total real, nuevos y por atender en `pedidos_listar` | `api-telefono/api/mercado.ts` |
| Contador honesto y chip «por atender» | `web/app/negocio.js`, `web/app/index.html` |
| Historial desplegable por pedido | `web/app/negocio.js`, `web/app/styles.css` |
| Clave de idempotencia, reintento y total del servidor | `web/app/placer.js` |
| Pruebas (36 comprobaciones) | `tests/web/pedidos.js` |
| Documentación | `docs/TIENDAS-MULTI.md` |

- **El servidor no cree precios ni stock del cliente**: cada línea se resuelve
  contra `mercado_productos` (por `sku` o nombre comparable) y el precio sale de
  ahí. Fuera del catálogo → `NO_CATALOGO`; más que el stock → `SIN_STOCK`.
- **Todo o nada**: descontar stock, insertar el pedido y anotar el primer evento
  van en una transacción. Si el stock se agota en el medio, se revierte.
- **Idempotencia**: `pedido_crear` acepta una clave del cliente; repetir el
  envío devuelve el mismo pedido (`repetido: true`). Índice único por local.
  El checkout la genera una vez al abrir el pago y reintenta con la misma.
- **Estados terminales**: `entregado` y `cancelado` ya no se mueven
  (`409 TERMINADO`), con `FOR UPDATE` para dos toques seguidos. Cancelar
  devuelve el stock descontado, una sola vez.
- **Rastro**: `mercado_pedido_eventos` guarda `actor` (`comprador` · `dueño` ·
  `sistema`) y `nota` («pedido creado (retiro)», «marcado como listo»,
  «… · stock devuelto»). El panel lo muestra por pedido y `pedidos_listar` lo
  entrega junto al pedido.
- **Contador**: `pedidos_listar` devuelve `total`, `nuevos` y `abiertos`
  contados en la base (no el tamaño de la página). El panel muestra ese total en
  la pestaña y en la tarjeta, más un chip «N por atender»; sin conexión cuenta
  lo del teléfono y lo dice («5 · local»).
- **Código único**: índice único en `codigo` (protegido con try/catch por si una
  base vieja trae repetidos) y reintento de hasta 5 códigos al crear.
- **Verificado**: 36 comprobaciones locales y 32 contra la API real (precio de
  catálogo ignorando el del cliente, idempotencia con mismo id, stock descontado
  y rechazo por exceso, producto inventado, nombre/teléfono, cancelación con
  stock devuelto, bloqueo de terminales, repetición de estado, historial con
  actor y nota). Batería completa y arranque en verde.
- **Deploy**: API `fabri-iut3zsz77…` READY; web `forge-core-stock-rc3qr5s3d…`
  READY; `sw.js` en `fcore-v82`.

## Sesión 2026-11-15 · Fase 6: avisos push del pedido

Pedido: «continúa» con la Fase 6: que el comprador reciba el aviso solo, sin
que el dueño tenga que apretar «Avisar» por WhatsApp.

| Pieza | Dónde |
|---|---|
| VAPID (ES256) + cifrado `aes128gcm` sin dependencias | `api-telefono/api/_push.js` |
| Tabla `mercado_push` + `push_suscribir` / `push_baja` | `api-telefono/api/mercado.ts` |
| Envío al cambiar estado (`avisarCambio`) | `api-telefono/api/mercado.ts` |
| Service worker de avisos en la raíz, sin caché | `web/sw-push.js` |
| Bloque «Avisarme cuando cambie» | `web/tienda-seguir.js`, `web/tienda.css` |
| Pruebas (68 comprobaciones) | `tests/web/push.js` |
| Documentación | `docs/TIENDAS-MULTI.md` |

- **Cero dependencias nuevas**: `node:crypto` firma el JWT de VAPID
  (`dsaEncoding: 'ieee-p1363'`) y hace el cifrado RFC 8291 (ECDH + HKDF-SHA256
  + AES-128-GCM). `_push.js` queda como dependencia de `mercado.ts`, no como
  función: `vercel.json` sólo compila `api/*.ts`, así que la API sigue en 12.
- **El service worker va en la raíz** (`/sw-push.js`) porque `seguir.html` está
  fuera del alcance de `/app/sw.js`. No tiene `fetch`: no cachea ni intercepta,
  así que no hay que subir versión del service worker de la app.
- **Suscripción atada al pedido** con el token del enlace o con código +
  últimos 4 del teléfono; máximo 5 dispositivos y el mismo navegador se
  actualiza en vez de duplicarse. El `endpoint` nunca se devuelve: en la base
  se guarda su `sha256` para el índice único.
- **El permiso se pide al tocar el botón**, nunca al cargar; si el navegador no
  soporta push o el permiso está bloqueado, el bloque lo explica.
- **Mejor esfuerzo**: el aviso sale después de guardar el cambio, con tope de
  2 s por dispositivo y 3 por pedido; una suscripción muerta (404/410) se borra.
  `pedido_estado` devuelve `avisados`. Si no hay claves VAPID, el seguimiento
  publica `push.disponible: false` y no muestra el bloque.
- **Sin datos de más en el aviso**: local, estado en palabras, código y enlace.
  Ni teléfono ni nombre completo.
- **Verificado**: 68 comprobaciones sin red (ida y vuelta del cifrado, JWT
  verificado, envío real a un servidor falso con descifrado, contrato,
  service worker y página) y 25 contra la API real (publica la clave, guarda y
  no duplica, token y código, rechazos, cambio de estado sin romperse, baja
  única, pedido terminado). Batería completa y arranque en verde. Captura a
  390 px del bloque en sus dos estados.
- **Deploy**: API `fabri-i62b71kaz…` READY (con `VAPID_PUBLIC`, `VAPID_PRIVATE`
  y `VAPID_SUBJECT` cargadas); web `forge-core-stock-hzp8izwvu…` READY.
  `sw-push.js` se sirve con `max-age=0, must-revalidate`.

## Sesión 2026-11-14 · Fase 5: reseñas y calificación de la tienda

Pedido: «continúa donde quedaste la última vez, revisa que no haya archivos
cortados y continúa». Después de los reinicios del servidor se verificó primero
la integridad del repo y luego se construyó la Fase 5.

| Pieza | Dónde |
|---|---|
| Tabla `mercado_resenas` + índice único por pedido | `api-telefono/api/mercado.ts` |
| `resenas_listar`, `resena_crear`, `resenas_panel`, `resena_moderar` | `api-telefono/api/mercado.ts` |
| Promedio en `locales`, `resenas_listar` y `ventas_serie` | `api-telefono/api/mercado.ts` |
| Estrellas y bloque de reseñas en la ficha pública | `web/app/placer.js`, `web/app/placer.css` |
| Formulario de reseña en el seguimiento | `web/tienda-seguir.js`, `web/tienda.css` |
| Pestaña Reseñas con moderación | `web/app/index.html`, `web/app/negocio.js`, `web/app/styles.css` |
| Pruebas (83 comprobaciones) | `tests/web/resenas.js` |
| Documentación | `docs/TIENDAS-MULTI.md` |

- **Sólo opina quien compró**: `resena_crear` exige el `token` del pedido o el
  `codigo` + últimos 4 del teléfono, y que el local lo haya marcado como
  `entregado`. Una reseña por pedido (índice único en `pedido_id`); el segundo
  intento responde `409 YA_OPINO`.
- **Privacidad**: el autor se guarda abreviado (`autorPublico` → «Ana P.») al
  crear la reseña; la respuesta pública no lleva el nombre completo, el
  teléfono, el token ni el `pedido_id`.
- **Moderar es reversible**: `oculta = true` deja de mostrarse y deja de contar
  en el promedio, pero no borra. Al borrar la tienda sí se borran sus reseñas.
- **Sin llamadas extra**: el promedio viaja en `locales` (chip + subtítulo de la
  ficha), en `resenas_listar` (bloque completo) y en `ventas_serie` (contador de
  la pestaña), así el panel no pide nada solo para mostrar un número.
- **Un formulario donde el comprador ya está**: calificar vive en `seguir.html`,
  donde el token (o la prueba código+teléfono) ya existe. Aparece sólo con el
  pedido entregado; después agradece y no lo vuelve a pedir en ese equipo.
- **La API sigue en 12 funciones**: las cuatro acciones nuevas viven dentro de
  `mercado.ts`.
- **Verificado**: 83 comprobaciones locales; la API en producción, **39**;
  la cadena completa con navegador real sobre la página publicada, **18**;
  batería completa y arranque en verde. Capturas a 390 px de la ficha con y sin
  reseñas, del formulario y de la pestaña Reseñas.
- **Bugs encontrados al capturar**: el formulario pintaba 5 estrellas por botón
  (25 en total) y desbordaba la tarjeta; el encabezado y los autores dependían
  del color heredado; las cinco pestañas no cabían con el contador en píldora.
- **Deploy**: API `fabri-fopl31n7q…` READY; web `forge-core-stock-eieo8tpmo…`
  READY; `sw.js` en `fcore-v81`.

## Sesión 2026-11-11 · Fase 4: avisar al cliente por WhatsApp desde el panel

Pedido: «avisar al cliente por WhatsApp» como Fase 4.

| Pieza | Dónde |
|---|---|
| `numeroWa`, `fraseEstado`, `mensajePedido`, `enlaceWa`, `abrirWa` | `web/app/negocio.js` |
| Botón **Avisar** + selector de estado en cada pedido | `web/app/negocio.js`, `web/app/styles.css` |
| Pruebas (118 en total, 30 nuevas) | `tests/web/negocio.js` |
| Documentación | `docs/TIENDAS-MULTI.md` |

- **Sin API nueva**: usa el `telefono` y el `seguimiento` que `pedidos_listar` ya
  devolvía, y la acción `pedido_estado` que ya existía. La API sigue en 12
  funciones y no hubo que redesplegarla.
- **El mensaje cuenta el estado real del pedido** (`lo recibimos`, `está en
  preparación`, `está listo para retirar` / `va en camino`, `fue entregado`, `fue
  cancelado`) y lleva el enlace de seguimiento de la Fase 3.
- **Se agregó el selector de estado**: antes el panel sólo podía saltar a
  «entregado», así que no había forma de llegar a «listo» y avisar. Ahora el
  dueño mueve el pedido por los cinco estados, y cada cambio queda en el
  historial que ve el comprador.
- **Teléfono normalizado**: `+56 9 1234 5678`, `9 1234 5678` y `09 1234 5678`
  terminan en `56912345678`. Sin teléfono usable no hay botón; no se inventa
  número.
- **No se envía nada solo**: `wa.me` abre en otra pestaña con el texto escrito y
  el dueño aprieta enviar.
- **Diseño**: el selector va en secundario y «Avisar» en verde, para que haya una
  sola acción protagonista; el orden de la fila es estado → avisar → enlace.
- **Verificado**: 17 comprobaciones contra producción con pedido real (teléfono →
  `wa.me` → texto con código, local y enlace → pasar a «listo» → el mensaje y el
  enlace del comprador reflejan el estado nuevo → limpieza); batería local
  completa en verde; captura a 390 px de la pestaña Pedidos.
- **Deploy**: sólo web, `sw.js` a `fcore-v80`.

## Sesión 2026-11-11 · Fase 3: seguimiento del pedido por código

Pedido: «seguimiento de pedido por código» como Fase 3 del plan global.

| Pieza | Dónde |
|---|---|
| Acción pública `pedido_seguir` + token al crear + historial | `api-telefono/api/mercado.ts` |
| Página de seguimiento | `web/seguir.html`, `web/tienda-seguir.js`, `.sg-*` en `web/tienda.css` |
| Enlace «Seguir mi pedido» en la pantalla de pago | `web/app/placer.js`, `web/app/placer.css` |
| Botón «Enlace» en la pestaña Pedidos del dueño | `web/app/negocio.js`, `web/app/styles.css` |
| Pruebas (70 + 3 en negocio) | `tests/web/seguimiento.js`, `tests/web/negocio.js` |
| Documentación | `docs/TIENDAS-MULTI.md` |

- **Dos caminos al mismo pedido**: el enlace con `token` (20 hex que devuelve
  `pedido_crear`) y, si se perdió, el código `MP-XXXXX` + los últimos 4 dígitos
  del teléfono. Sin token, el código corto no alcanza; hay tope de 30 intentos
  **fallidos** por IP cada 10 minutos (los aciertos no gastan cupo: un comprador
  puede mirar su pedido las veces que quiera).
- **Historial real de estados** en `mercado_pedido_eventos`: se anota al crear y
  en cada cambio; repetir el mismo estado no duplica el evento. Los pedidos
  anteriores (sin historial) se dibujan con la fecha de creación en el primer
  paso.
- **Privacidad**: la respuesta pública no trae el teléfono completo, ni el token,
  ni el id interno. El listado del dueño sí trae el teléfono (es su pedido) y el
  `seguimiento` para reenviar el enlace.
- **Encontrado al probar contra la API real**: (1) `ts` llega como texto ISO y la
  línea de tiempo salía sin horas; (2) la API exigía el prefijo `MP-` y un
  cliente externo podía mandar solo las 5 letras. Los dos corregidos.
- **Detalle de diseño**: `.ds-btn` del sistema mide con `content-box`, así que un
  botón a ancho completo desborda la tarjeta; se corrige sólo en `seguir.html`
  con `box-sizing: border-box`.
- **Verificado**: 33 comprobaciones contra producción con cuenta y tienda
  desechables (pedido → token → código+teléfono → 404 con datos malos → cambio
  de estado → evento nuevo → limpieza); batería local completa en verde.
- **Deploy**: API `fabri-…` READY; web `forge-core-stock-…` READY; `sw.js` en
  `fcore-v79`.

## Sesión 2026-11-11 · Fase 2: panel de plataforma con token admin

Pedido: «continúa» con la Fase 2 del plan por fases: la vista de **toda** la
plataforma para el dueño de la app, no para el dueño de una tienda.

| Pieza | Dónde |
|---|---|
| Módulo del panel: candado, KPIs, barras, canales, cuentas, salud | `web/app/plataforma.js` |
| Pantalla `s-plataforma` con candado de token y panel | `web/app/index.html` |
| Estilos `plat-*` + alias compartidos `.kpi-grid`/`.kpi` y `.barras*` | `web/app/styles.css` |
| Entrada en Cuenta (sólo `rol === 'owner'`) y hook en `go()` | `web/app/core-pro.js`, `web/app/app.js` |
| Pruebas (57 comprobaciones) | `tests/web/plataforma.js` |
| Documentación | `docs/TIENDAS-MULTI.md` |

- **Sin endpoint nuevo**: la API queda en las mismas 12 funciones. Se reusan
  `GET /api/auth?diag=1`, `POST /api/mercado {resumen}`, `POST /api/auth {usuarios}`
  y `GET /api/visitas?dias=N` en paralelo con `Promise.allSettled`.
- **El token no vive en el sitio**: se pega una vez en el candado, va a
  `sessionStorage` y sólo pasa a `localStorage` con «Recordar en este equipo». El
  campo se vacía al entrar y el token no se vuelve a pintar. Un 401 en cualquiera
  de las tres llamadas protegidas se trata como token inválido.
- **Orden de diseño**: estado vivo → periodo 7/30 días → 6 KPIs → visitas por día
  (gráfico protagonista) → canales y rutas/países → cuentas con búsqueda sin
  acentos → salud de la base (tablas, último latido, plan, token).
- **`tope_plan` es un objeto** (`{ gratis: 300, pro: 3000 }` = productos por plan),
  no un número: se muestra como «productos: 300 gratis · 3.000 pro». Se detectó
  al probar contra la API real, donde antes salía `[object Object]`.
- **Verificado**: contra la API real con el token admin (diagnóstico, `resumen`,
  `usuarios`, `visitas?dias=7`, y 401 con token falso) → 15 comprobaciones;
  batería local completa en verde; capturado a 390 px en candado cerrado, panel
  abierto, 7 y 30 días con un banco que carga la sección, el CSS y el JS reales.
  Ahí se corrigieron el campo del token pegado al botón y la fila «Tablas».
- **Deploy**: web `forge-core-stock-55ews9i29…` READY; `sw.js` en `fcore-v78`;
  md5 de los seis archivos idénticos a local; `/app/`, la raíz y `fabri-core-web`
  en 200.

## Sesión 2026-11-11 · Fase 1: panel del dueño con pestañas y números reales

Pedido: «vamos con la fase 1» del plan por fases que salió de la auditoría
«dibujo → estado real».

| Pieza | Dónde |
|---|---|
| Acción `ventas_serie` (serie, top, estados, visitas, conversión) | `api-telefono/api/mercado.ts` |
| Panel en 4 pestañas: Resumen · Pedidos · Catálogo · Ajustes | `web/app/index.html` |
| Estado vivo, pestañas, periodo, gráfico de barras, chips, tráfico | `web/app/styles.css` |
| Lógica del panel: serie, top, estados, visitas, filtros, CSV | `web/app/negocio.js` |
| Pruebas (85 comprobaciones) | `tests/web/negocio.js` |
| Documentación | `docs/TIENDAS-MULTI.md` |

- **Una sola llamada** `ventas_serie` (dueño · clave · admin) en vez de cuatro:
  la serie diaria, los totales, el top de 8 productos, el conteo por estado y las
  visitas llegan juntos. `dias` va de 1 a 90 y por defecto 7.
- **Serie en `America/Santiago`**, rellenada con `generate_series`: los días sin
  ventas aparecen en cero y la noche no cae en el día siguiente (UTC).
- **Cancelados fuera** de la serie, del top y de los totales; el monto se
  recalcula con el `items` guardado.
- **Visitas**: la tabla es global (no tiene `local_id`), así que el panel dice
  «de toda la app» y la conversión es pedidos ÷ visitas de la app. Si la tabla no
  existe, `visitas: null` en vez de error.
- **Pedidos**: búsqueda sin acentos por código/cliente/producto, filtro por
  estado y exportación CSV (`;` + BOM para Excel chileno).
- **Diseño**: cabecera con estado vivo (sólo dice «en vivo» si la última lectura
  es de hace <1 min) → KPIs → periodo → gráfico protagonista → detalle. La
  tarjeta de cuenta se esconde cuando hay tienda abierta (el estado vivo ya dice
  con qué cuenta estás) y la tienda abierta no se repite como cabecera aparte:
  su tarjeta ofrece «Ver mapa».
- **Verificado**: `ventas_serie` en producción con cuenta + tienda + 2 pedidos
  (7 y 30 días, 401 sin sesión y con otra cuenta, limpieza) → 24 comprobaciones;
  batería local completa en verde; panel capturado a 390 px en las 4 pestañas y
  en 7/30 días con un banco que carga la sección, el CSS y el JS reales.
- **Deploys**: API `fabri-ldouc46zk…` READY; web `forge-core-stock-68h2oq7tf…`
  READY; `sw.js` en `fcore-v77`; `/app/` y `fabri-core-web` en 200.

## Sesión 2026-11-11 · Latido diario de la base + comprobación de continuidad

Pedido: «que revise la base de datos cada 24 horas para que no se bloquee o se
pause» y «confirmar que guarda el correo y que al entrar desde otro equipo
aparece todo».

| Pieza | Dónde |
|---|---|
| `GET /api/latido` (ruta nueva mapeada a `auth.ts`) | `api-telefono/vercel.json` |
| Tabla `core_latido` + `latidoDiario()` + aviso Telegram opcional | `api-telefono/api/auth.ts` |
| `ultimo_latido` en `?diag=1` y estado en la pantalla Cuenta | `api-telefono/api/auth.ts`, `web/app/core-pro.js` |
| Crons 07:00 y 19:00 UTC | `api-telefono/vercel.json` |
| Documentación | `docs/INSFORGE.md`, `docs/TIENDAS-MULTI.md` |

- **Por qué dos crons**: el plan Hobby permite 2 cron jobs y cada uno una vez
  al día. Dos horarios distintos dan dos latidos diarios y cubren una corrida
  perdida (la entrega de cron es *best effort*).
- **Latido** = `asegurar` (auto-reparación) + comprobar las 3 tablas + borrar
  sesiones vencidas hace >7 días + podar la bitácora a 90 días + insertar en
  `core_latido`. Idempotente; nunca lanza.
- **Aviso**: si algún día se agrega `TELEGRAM_BOT_TOKEN` a `fabri-api`, un
  fallo se avisa solo al chat. Hoy no hay token en el entorno, así que el
  aviso queda inactivo (no falla).
- **Verificado en producción**: `/api/latido` → `ok:true`, 366 ms, las 3
  tablas; `vercel crons ls` lista los 2 jobs; `?diag=1` devuelve el último
  latido.
- **Continuidad entre dispositivos** (prueba real, cuenta desechable creada y
  borrada): A crea tienda + 2 productos → B entra con el mismo correo y
  contraseña → ve la misma tienda, el mismo catálogo y precio/stock reales; el
  token de B no sirve desde A (`DISPOSITIVO`). 17 comprobaciones en verde.
- **Hallazgo**: `core_usuarios` estaba **vacía** (0 cuentas) al momento de
  revisar; las cuentas de prueba anteriores se borraron. La cuenta root existe
  recién cuando se registra `F.eduardomicolta@gmail.com` en la app.
- `sw.js` sube a **fcore-v75**.

## Sesión 2026-11-11 · Sesión atada al dispositivo + términos + root fijo

Pedido textual: «F.eduardomicolta@gmail.com para mi usuario root y haz más
robusto y seguro el que se guarde un token único criptográfico por login de
usuario en mi base de datos con los usuarios su token único entrelazado entre
su login y su dispositivo; acepta términos y condiciones».

| Pieza | Dónde |
|---|---|
| Token único + huella + tope de 12 sesiones + términos | `api-telefono/api/_auth.js` |
| DDL/migración (`terminos_version`, `terminos_ts`, `dispositivo_hash`), repositorio y `aceptar_terminos` | `api-telefono/api/auth.ts` |
| `cuentaDe()` valida `X-Dispositivo` y devuelve `{ usuario, motivo }` | `api-telefono/api/mercado.ts` |
| ID aleatorio del dispositivo (`fcore.dispositivo`) | `web/app/core-nube.js` |
| Envío de dispositivo/términos, `aceptarTerminos()`, `DISPOSITIVO` → limpiar token | `web/app/core-sec.js` |
| Checkbox de términos, paso de aceptación y estado en «Cuenta» | `web/app/core-pro.js` |
| Cabecera `X-Dispositivo` y aviso `DISPOSITIVO` | `web/app/negocio.js` |
| Página de términos | `web/app/terminos.html` |
| Pruebas nuevas | `tests/web/auth-nube.js` |
| Documentación | `docs/TIENDAS-MULTI.md`, `docs/INSFORGE.md` |

Decisiones:

- **Token**: 256 bits único por login. En la base sólo `token_hash` (SHA-256) y
  `dispositivo_hash = sha256(dispositivo | usuario_id | token_hash)`; se
  recalcula en cada validación y se compara con `timingSafeEqual`.
- **Dispositivo**: ID aleatorio persistido en `localStorage`; se envía en el
  login y en `X-Dispositivo` para `/api/mercado`. Si falta, se usa
  `'navegador'` (compatibilidad). Copiar el token a otro equipo → `401
  DISPOSITIVO`; la app borra el token de nube y el espejo local sigue.
- **Tope**: 12 sesiones activas por cuenta; las más viejas se revocan solas.
  Las sesiones anteriores (sin huella) se revocan una vez en la migración.
- **Términos**: `TERMINOS_VERSION = '2026-11-11'`. El alta exige
  `acepta_terminos`; se guarda versión + fecha. Si la versión cambia, la app
  pide aceptar con `aceptar_terminos` **sin bloquear la entrada**.
- **Root**: `CORE_ROOT_EMAIL=F.eduardomicolta@gmail.com` en `fabri-api`. Esa
  cuenta entra/promociona a `owner`; el rol no da acceso a datos ajenos.
- `sw.js` sube a **fcore-v74** (precache de `terminos.html`).

## Sesión 2026-11-11 · Tiendas multi-negocio: cuenta → tienda → catálogo → mapa

El login ya estaba conectado a InsForge (`/api/auth`). Esta sesión cierra el
flujo que faltaba: **cada cuenta crea y administra su propia tienda** y el mapa
la muestra con nombre, marca, logo y catálogo.

| Pieza | Dónde |
|---|---|
| Columnas `marca`, `logo`, `descripcion`, `dueno_id` + `local_mio` | `api-telefono/api/mercado.ts` |
| `CORE_ROOT_EMAIL` (root explícito) y promoción a `owner` | `api-telefono/api/_auth.js`, `api/auth.ts` |
| Panel: cuenta, crear tienda, ficha, catálogo/stock, importación | `web/app/negocio.js`, `web/app/index.html`, `styles.css` |
| Mapa: logo en el pin, marca en lista/ficha, `irATienda` | `web/app/placer.js`, `placer.css` |
| Pruebas | `tests/web/negocio.js` (56) + `tests/web/auth-nube.js` |
| Documento | `docs/TIENDAS-MULTI.md` |

Decisiones:

- **Root**: no hay clave root en Vercel. Es la primera cuenta (`owner`) o el
  correo de `CORE_ROOT_EMAIL`; si ya existía como `member`, se promueve al
  entrar o al validar la sesión. `FABRI_API_TOKEN` sigue siendo el admin Bearer.
- **Autorización de tiendas**: admin → cuenta dueña (`dueno_id`) → clave de 8
  caracteres. La clave no desaparece: es el respaldo de la APK.
- **Logo sin bucket**: data URI redimensionado en el navegador (192 px, JPEG,
  ≤120 KB, fondo blanco). Se guarda en la fila del local.
- **Importación**: CSV/JSON con sinónimos y precios chilenos (`$1.690`), en
  lotes de 400; «Traer de mi Stock» usa `Fabri.q` sobre el SQLite local.
- La migración es idempotente y el esquema se comprueba una vez por instancia.
- `sw.js` subió a **fcore-v73** (el logo del pin se ancla en absoluto: dentro de
  un grid, `width:100%` resolvía contra la pista que el propio logo estiraba).
- Las tiendas registradas **no se agrupan** en el mapa: el dueño siempre ve su
  local con su logo, no un globo con un número. El nombre admite dos líneas.
- Desplegado: API `dpl_5SAn3VD1ucM5QsPYyAkP4bNR21Sh` y web
  `forge-core-stock` (alias `forge-core-stock.vercel.app` y
  `fabri-core-web.vercel.app`), ambas `READY`.
- Probado contra producción con cuenta desechable: **36 comprobaciones** (cuenta,
  tienda, catálogo, pedido, ficha, seguridad y limpieza) y luego borrada. El
  panel y el mapa se verificaron con capturas reales.

## Sesión 2026-11-11 · Tráfico en el mapa: autos sobre las calles reales

`MercadoPlacer` estrena una capa de **autos que circulan por las calles que
OpenStreetMap tiene mapeadas, en los dos sentidos**. No es tráfico real (no hay
velocidades ni congestión): es el flujo de la vía, dibujado.

| Pieza | Dónde |
|---|---|
| Módulo: Overpass → geometría → autos | `web/app/mapa-trafico.js` |
| Enganche, botón y avisos | `web/app/placer.js` (`montarTrafico`, `#mpTraficoBtn`) |
| Canvas propio (no pelea con el radar) | `web/app/index.html` (`#mpTrafico`), `placer.css` (`z-index 401`) |
| Prueba | `tests/web/trafico.js` (69 comprobaciones) |
| Documento | `docs/TRAFICO-MAPA.md` |

Decisiones:

- Las vías se piden a Overpass con `out geom` (los **cuatro espejos en paralelo**,
  gana el primero que contesta: en serie, un espejo caído se comía el
  presupuesto de los demás). Solo con zoom ≥ 14 y vista ≤ 8 km (el mapa abre en 14 al encuadrar los locales: con el umbral 15 la capa no se veía nunca); caché de 15 min
  y 10 zonas; 3.500 puntos de vía y 60 autos como techo.
- **Si no hay calles o no hay red, no se inventan calles**: el estado queda en
  `#mpTrafico.dataset.trafico` (`muy-lejos`, `sin-calles`, `sin-red`) y la app
  avisa una sola vez. El mapa y la lista siguen funcionando.
- Cada calle se vuelve una polilínea con longitud acumulada; los autos se
  reparten alternando el sentido, avanzan a 25–50 km/h, **vuelven a entrar** al
  llegar al final y se dibujan en el carril de su derecha con el rumbo de su
  marcha (el que va al oeste apunta al oeste).
- Autos de 6–15 px: a escala real serían invisibles; el tamaño está exagerado a
  propósito y así se dice en el código.
- Botón «Tráfico en vivo» en el menú `⋯`, recordado en
  `fcore.placer.trafico`. Se pausa con la pestaña oculta y con
  `prefers-reduced-motion` (autos quietos, sin bucle de `requestAnimationFrame`).
- **No se lee `oneway` todavía**: en una calle de un solo sentido se ven autos
  en los dos. Queda anotado como mejora barata (el dato ya viene en OSM).

Bugs que encontró la prueba antes de desplegar:

- `map.getBounds()` de Leaflet devuelve `.lng` y el módulo leía `.lon`: la
  consulta salía con `NaN` y el tráfico **nunca** cargaba. Se normaliza en
  `bboxDe()`.
- El botón del menú y el canvas compartían `id="mpTrafico"`; el botón pasó a
  `mpTraficoBtn` (si no, `getElementById` devolvía el canvas).

Pruebas ejecutadas: `tests/web/trafico.js` (69), `auth-nube`, `boleta`,
`diseno`, `escaneo`, `arranque`, `inventario` y `seguridad` (23/23), todo en
verde.

Service worker **v67**. Deploy `vercel --prod` → `dpl_3F5Nx1djKNd7PG5Y7ET6bXNJi94m`
(los anteriores: `dpl_7Upzo1…` v66, `dpl_3dbwLA8…` v65, `dpl_2G4btte…` v64). Las dos URLs
(`forge-core-stock.vercel.app`, `fabri-core-web.vercel.app`) y
`/app/mapa-trafico.js` responden 200.

Hallazgo de la verificación en vivo: al cargar los locales, el `fitBounds` del
mapa deja la vista en **zoom 14**, así que el umbral 15 con que nació la capa la
dejaba apagada siempre. Se bajó a 14 (vista de hasta 8 km) y a ese zoom se
reparten hasta **90 autos** en vez de 60.

Capturas: en producción (`#panel` en Santiago centro) la capa queda en
`sin-red` —esta red bloquea Overpass: **406** en `overpass-api.de`, CORS sin
cabecera y 0 bytes en los demás espejos— y lo dice en pantalla en vez de
inventar calles. Para verla dibujada se capturó **en local con geometría
inyectada por CDP** (12 vías del centro de Santiago): a zoom 16 y a zoom 14 se
ven los autos en los dos carriles, con borde oscuro para que se lean sobre
teselas claras y sobre satélite.

## Sesión 2026-11-10 · El login pasa a InsForge (cuentas en la nube)

La cuenta de la web deja de vivir sólo en el navegador. Ahora se crea y se
valida en **InsForge** a través de `fabri-api /api/auth`, y el navegador guarda
un **espejo local** para poder entrar sin red. Entrar desde otro dispositivo
con el mismo correo y contraseña ya funciona.

| Pieza | Dónde |
|---|---|
| Núcleo de reglas (sin HTTP ni SQL) | `api-telefono/api/_auth.js` |
| Endpoint `/api/auth` + repositorio Postgres | `api-telefono/api/auth.ts` |
| Cliente de red y token | `web/app/core-nube.js` |
| Espejo local + PBKDF2 | `web/app/core-sec.js` (`_espejo`, `_sesionLocal`) |
| Puerta de acceso (nube/local) | `web/app/core-pro.js` (`gate`) |
| Tablas | `core_usuarios`, `core_sesiones` (se crean con `asegurar`) |
| Prueba | `tests/web/auth-nube.js` (38 comprobaciones, con SQLite real) |

Decisiones:

- **No hay migración forzada**: las cuentas locales que ya existían siguen
  entrando. El espejo sólo se crea al registrar o al entrar por la nube.
- **Nunca deja al usuario afuera**: si la nube no responde, el alta sigue en
  local y el aviso aparece al cerrar la puerta. La casilla «sólo en este
  dispositivo» fuerza ese camino.
- **La cuenta no da datos**: inventario y mercado siguen con `local_id` +
  `clave`. Son credenciales distintas.
- **Registro abierto por defecto** en `/api/auth`; se cierra con `CORE_INVITE`
  y se acota con `CORE_MAX_CUENTAS` (200 por defecto). 8 fallos bloquean 10
  minutos.
- El `/api/auth` del proyecto web (`web/api/auth/index.go`, Vercel Blob) queda
  **sin uso**; el real es el de `fabri-api`.

Pendiente detectado al cerrar: **InsForge respondía `Connection terminated
unexpectedly`** desde Vercel en `/api/mercado` y `/api/inventario` (también en
`?diag=1`). El código de cuentas quedó desplegado y degrada a local, pero las
cuentas no se guardarán en la nube hasta reactivar el proyecto en InsForge o
recopiar `INSFORGE_DATABASE_URL`.

Notas de despliegue:

- El plan Hobby de Vercel limita a **12 funciones**. Para sumar `/api/auth` se
  mudó `/api/stats` a `agente.ts` (misma ruta y mismo contrato; Vercel conserva
  `req.url`). Se borró `stats.ts`.
- El núcleo `_auth` va en **CommonJS** (`api/_auth.js`): `@vercel/node` compila
  `auth.ts` a CJS y `require()` de un `.mjs` falla con `ERR_REQUIRE_ESM` (el
  primer deploy de `/api/auth` murió con `FUNCTION_INVOCATION_FAILED` por eso).

## Sesión 2026-11-10 · El proyecto de producción pasa a llamarse forge-core-stock

El proyecto de Vercel `fabri-core-web` se renombró a **`forge-core-stock`** y se
agregó `forge-core-stock.vercel.app` como dominio del proyecto. La app queda en
`https://forge-core-stock.vercel.app/app/` y la URL vieja
(`fabri-core-web.vercel.app`) sigue respondiendo 200 para no romper enlaces
compartidos.

- Se actualizaron los 82 enlaces internos (og, canonical, sitemap, robots, docs,
  pruebas) a la marca nueva.
- **La API no se migra**: sigue en `fabri-api.vercel.app`; el catálogo la usa
  igual que antes.
- El repo de GitHub sigue siendo `thinkfashz/fabri-core` y el paquete Android
  `cl.fabrick.core`: son identificadores técnicos, no marca visible.
- El proyecto Vercel `fabri-core` (creado por error, responde 404) sigue
  pendiente de borrar.

## Sesión 2026-11-05 · Multi-inquilino: cada dueño con su espacio, su ID y su clave

La plataforma deja de repartir el **token global**. Root (dueño de la
plataforma) conserva la llave total; cada cliente recibe **su `local_id` + su
clave** y queda en un espacio **aislado, gratuito y conectado** al mismo
InsForge. Nada cambia para el admin; todo cambia para el cliente.

### Modelo (doble llave)

| Credencial | Cómo viaja | Qué alcanza |
|---|---|---|
| **ADMIN** (root) | `Authorization: Bearer FABRI_API_TOKEN` | todos los espacios; si manda `local_id`, se acota |
| **DUEÑO** (cliente) | `local_id` + `clave` en el cuerpo | **sólo** su espacio; clave validada contra SHA-256 |

La clave del dueño se genera una vez (8 caracteres) y se guarda **sólo** como
SHA-256 (`sha256('mercado:' + clave)`) en `mercado_locales.clave_hash`; nunca se
devuelve en lecturas. Una sola clave sirve para el mercado y para el inventario.

### Qué se hizo

| Qué | Dónde |
|---|---|
| **Inventario multi-inquilino**: `local_id` en cada fila; PK compuesta `(local_id, codigo)` y `(local_id, folio)`; migración idempotente (`ADD COLUMN IF NOT EXISTS` + `DROP CONSTRAINT IF EXISTS ..._pkey` + `ADD PRIMARY KEY`) | `api-telefono/api/inventario.ts` |
| **Alcance por credencial** en todas las acciones (`subir`, `bajar`, `buscar`, `borrar`, `subir_boletas`, `resumen`): admin ve todo, dueño sólo lo suyo | `api/inventario.ts` (`resolverAlcance`, `acotado`) |
| **APK guarda la credencial de dueño** (`fabrick.nube.local` + `fabrick.nube.clave`) y la manda en cada sync | `android/assets/www/inventario.js`, `datos.js` |
| **Integración → Nube** con campos *ID del local* y *Clave del local* (además del token admin) | `android/assets/www/index.html`, `app.js` (`integracionGuardar`) |
| **Estado honesto** de la nube: distingue «token de admin» de «dueño: t-xxx» | `android/assets/www/insforge.js` |
| **Doc** §3.b multi-inquilino + §4 sin token global repartido | `docs/MERCADO-NUBE.md` |
| **Versión APK** 0.9.62 → **0.9.63** (versionCode 77 → 78) | `android/AndroidManifest.xml`, `scripts/compilar.sh` |

### La APK siempre por fuera del repo

`dist/` está en `.gitignore`, así que ahí no quedaba nada instalable a mano y
la que servía el sitio era **de Nov 2, sin multi-inquilino**. Desde esta sesión
el build termina con un paso 8/8 que llama a `scripts/apk-fuera.sh` (nuevo) y
deja la APK en **dos rutas fijas**, con nombre estable (sin versión):

| Ruta | Para qué |
|---|---|
| `/storage/emulated/0/Download/FORGE-CORE-STOCK.apk` | instalar desde el gestor de archivos; **fuera del repo** |
| `web/descargas/FORGE-CORE-STOCK.apk` | botón «Descargar APK» del sitio (versionada en git a propósito) |

La copia se verifica con `cmp` (byte a byte); si el sistema de archivos no
deja escribir, **avisa y no rompe el build**. Refrescar sin recompilar:
`bash scripts/apk-fuera.sh` (usa la más reciente de `dist/`).
Detalle en `docs/APK.md` § 4.2.

### Verificación en producción (2026-11-05)

`fabri-api.vercel.app` (11 funciones, `READY`):

- `GET /api/inventario` → `multi_inquilino:true`; `asegurar` migró sin error.
- Sin credenciales → **401** `SIN_CREDENCIALES`; clave mala → **401** `clave_mala`.
- `t-ree-01` sube 2 productos y los ve (`total:2`); `t-ree-02` ve `total:0`.
- `t-ree-02` busca el código de `t-ree-01` → `encontrado:false`; `t-ree-01` → `true`.
- Borrado cruzado: `t-ree-02` → `borrados:0`; `t-ree-01` borra el suyo → `borrados:1`.
- Boletas por local; **admin** ve el total global y puede acotarse con `local_id`.

### Decisiones

- **El cliente nunca lleva el token global.** Aunque extraiga el `localStorage`
  de su teléfono sólo obtiene su propio local. El aislamiento lo garantiza el
  servidor (PK compuesta + filtro por `local_id`), no la app.
- **Misma base para todos**: los espacios viven en el InsForge del root, así que
  el dueño de la plataforma los ve y administra todos desde un solo lugar.
- **Una sola credencial por local** (mercado + inventario): menos piezas que
  explicar y que rotar.

### Pendiente

- **Rate limit** de borde para `pedido_crear` / `asegurar` / fuerza bruta de claves.
- **Sesiones firmadas** para el panel del dueño (hoy la clave viaja en el cuerpo).
- Rotar los secretos que se pegaron en claro durante el desarrollo.
- Probar el flujo dueño completo en un **teléfono real** (sin adb en este entorno).

### Además en esta sesión: el sitio acepta la credencial de dueño y 6 pruebas muertas

**a) La pantalla de Inventario del sitio sólo admitía el token admin.** `web/app`
guardaba `fabri.invKey` y lo mandaba como `Bearer`; un cliente con su
`local_id`+`clave` no podría sincronizar desde el navegador sin recibir la
llave global (justo lo que no se quiere repartir).

| Qué | Dónde |
|---|---|
| Campos **ID del local** y **Clave del local** junto al token admin | `web/app/index.html` (`#invLocal`, `#invLocalClave`) |
| `invConCredencial()` + envío de `local_id`/`clave` en el cuerpo y `Authorization` sólo si hay token admin | `web/app/core-pro.js` (`invApi`) |
| Errores distinguidos: `clave_mala`, `local_inexistente` | `core-pro.js` |
| Estado que dice si er «admin» o «dueño t-xxx» | `core-pro.js` (`invPintarEstado`) |

**b) Seis pruebas estaban rojas desde antes de esta sesión** (comprobado con
`git stash` contra `ebe97ed`: mismos fallos, 0 regresiones mías). Código y
pruebas habían divergido, no hacía falta romper nada:

| Prueba | Qué pasaba | Reparación |
|---|---|---|
| `diseno.js` · clases del HTML | MercadoPlacer movió sus estilos a `placer.css` y la prueba sólo leía `styles.css` | lee las dos hojas (`cssTodo`) |
| `diseno.js` · tema por defecto | el código dice `'lima'` (marca FORGE) desde `b023fba`, la prueba esperaba `'aurora'` | la prueba sigue al código |
| `diseno.js` · nada remoto | castigaba `rel="canonical"`/`hreflang`, que **tienen** que ir absolutos | sólo se miran los `<link>` que cargan recursos |
| `diseno.js` · iconos | el manifest trae `logo-f.svg` con `sizes:"any"` y la prueba exigía PNG con medidas | acepta SVG y exige que sea SVG real |
| `diseno.js` · `.mm-cab-txt` | **faltaba la regla**: columna de texto sin `flex:1;min-width:0`, podía empujar las flechas fuera del encabezado | regla nueva en `styles.css` |
| `inicio.js` (portada) | 9 fallos: `Nodo` del harness no tenía `removeAttribute` y el test aún usaba `INICIO.datos`, renombrado a `INICIO.panel` en `53bd551` | `removeAttribute`/`hasAttribute`/`toggleAttribute` + datos con la forma real de `inventario/panel` |
| `inicio.js` · aserciones | el rediseño 0.9.60 pasó de `d3-barra`/anillo a `in-barra`/listas, y renombró los KPI | aserciones al diseño vigente; `!/d3-barra"` (que ya no existe) pasó a `!/class="in-barra"` |
| `carga-sin-bloqueo.js` | `chatPreconectar()` corría dentro de la carga síncrona de la página | diferida con `setTimeout(…, 0)` en `app.js` |
| `nube.js` | esperaba `motivo: "sin token"` tras el cambio multi-inquilino | ahora cubre también el dueño: `local_id`+`clave` en el cuerpo y **sin** `Authorization` |

Resultado: `tests/arranque/correr.sh` **9/9**, `tests/inventario/correr.sh`
**6/6** (con 3 comprobaciones nuevas del dueño), `tests/seguridad/correr.sh`
**23/23**, `tests/web/diseno.js` y `boleta.js` **en verde**.

**Nota**: los KPIs, los gráficos y la nota de la portada **no estaban rotos en
la app** — la portada real lee `INICIO.panel` correctamente; lo roto era la
prueba, que por eso dejó de cubrirlos en 0.9.60.

## Sesión 2026-10-27 (20) · Nube: escáner con cámara y wiki de productos

La consola web ya no pide el código a mano: lo lee con la cámara y trae la
ficha del producto. **La APK no cambia en esta sesión.**

### Qué se hizo
| Qué | Dónde |
|---|---|
| **Escáner** con `BarcodeDetector` nativo, respaldo **ZXing** (336 KB, Apache-2.0, carga diferida), linterna, cambio de cámara, recorte central y entrada manual | `web/app/core-scan.js`, `web/app/vendor/zxing.min.js` |
| **Verificación GS1** antes de aceptar (EAN-8/UPC-A/EAN-13/EAN-14) | `core-scan.js` (`digitoGS1`, `pareceCodigo`) |
| **Wiki de productos**: cascada Open Food → Open Beauty → Open Products Facts, normalización y caché en `product_wiki` | `web/app/core-wiki.js` |
| **Ficha manual** para códigos que las bases no conocen (catálogo chileno) | `core-wiki.js` |
| **Pantalla Wiki** `#s-wiki` + destino en el nav (hoja «Más» en móvil) | `index.html`, `styles.css` |
| **Franja de escaneo** en el alta de inventario, con relleno de campos vacíos | `index.html`, `core-pro.js` |
| **Overlay** de cámara con marco, láser y confirmación | `styles.css` |
| Prueba `tests/web/escaneo.js` | checksums, categorías, NOVA, XSS |

### Verificación
- `node tests/web/diseno.js` **en verde** (11 pantallas, 106 clases del HTML,
  71 de plantillas, 25 archivos del precache, 9 scripts).
- `node tests/web/escaneo.js` **en verde** (41 comprobaciones), incluida una
  decodificación real: se genera un EAN-13 y lo pasa por el ZXing vendorizado.
- `node tests/web/boleta.js` **en verde**.
- SQL real contra el `sql.js` del proyecto: insertar, leer, **upsert**,
  filtrar y `save()`; sin `Fabri` no revienta.
- API real de Open Food Facts (Nutella 3017620422003): nombre, marca,
  cantidad, categoría `dulces`, NOVA 3, alérgenos e ingredientes correctos.

### Decisiones
- **Tres capas de lectura**: nativo → ZXing → manual. El respaldo no se
  precachea: se descarga sólo si el navegador no trae detector, así el
  arranque offline sigue liviano.
- **Checksum antes de la red**: un EAN mal tecleado no gasta una consulta ni
  inventa un producto. `7801610001015`, que parecía válido, falla GS1.
- **La wiki es local primero**: lo consultado se guarda en SQLite; el segundo
  escaneo funciona sin conexión y el catálogo chileno se completa a mano.
- **`Permissions-Policy: camera=(self)`**: con `camera=()` la cámara queda
  bloqueada en producción aunque el código sea correcto.

### Pendiente
- Revisión visual en dispositivo real (sin navegador headless en el entorno).
- Probar la cámara en el teléfono: permisos, linterna y enfoque continuo.

## Sesión 2026-10-27 (19) · Nube v2.0 — «Aurora», Lottie y d3

La PWA deja de ser «la APK sin base local»: tiene su propio contexto visual.
Publicada en `https://forge-core-stock.vercel.app/` (landing) y `/app/` (consola).
Deployment `dpl_7p9B4n1bZKboQc52qu9tNWVhM3vx`, estado `READY`, alias de producción
`forge-core-stock.vercel.app`. **La APK no cambia en esta sesión.**

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
| **Imagen social 1200×630** con el titular de la landing | `scripts/og-nube.py` → `web/og.png` |
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
| Web con loader/login/inventario | `https://forge-core-stock.vercel.app/app/` |
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

## Sesión 2026-10-28 · Agente 2 — módulo de inventario (editor, lector fijo, cálculos y mercado)

Alcance: `android/assets/www/inventario.js`, `inventario.css`, `index.html` (no se tocó `app.js`).

### Qué se hizo
- **Lector fijo en pasos 1-4 (no boleta)**: recuadro con cámara + mira animada y detector EAN propio (BarcodeDetector o lector propio) en cada paso; una sola cámara a la vez; al leer se muestra la ficha con botón «Editar en el editor» o se ofrece crear el producto.
- **Editor de productos**: se reparó el bloque HTML malformado que ocultaba/rompía los campos; se agregaron precio proveedor, precio de mercado y nombre del proveedor (todos editables, guardados en SQLite); ficha viva con 8 celdas (margen, ganancia, costo, stock valorizado, precio proveedor, diferencia vs mercado, precio óptimo, utilidad real).
- **Cálculos**: `invEdRecalcular` usa `analizarPreciosYGanancia()` de app.js; precio óptimo = mercado + 30 %; utilidad real vs precio de proveedor.
- **Validaciones**: `invEdGuardar` e invGuardar rechazan stock negativo y alertan stock bajo (stock ≤ stock_mínimo).
- **Búsqueda**: `invBuscarCodigo` busca también por nombre/marca además de código.
- **Mercado**: `invEdMercadoConsultar` confirma el producto en bases libres (Open Food/Beauty/Products Facts) y el usuario ingresa el precio de mercado de referencia; se muestra diferencia % y precio óptimo sugerido.
- **Diseño**: foco con anillo lima en inputs del editor; filete ámbar en tarjetas de stock bajo; micro-transición scale 0.95 al tocar; sin scroll horizontal; reduced motion respetado.

### Verificación
- `node --check inventario.js` ✔
- `bash tests/inventario/correr.sh` **6/6** ✔
- `bash tests/arranque/correr.sh` **8/8** ✔
- IDs HTML/JS verificadas: todas las nuevas existen en ambos lados.

### Pendiente
- Revisión visual en dispositivo real (cámaras y ficha de mercado).

## Sesión 2026-10-29 · APK 0.9.37 (52) — «Mi identidad» premium, Code128 real y acceso

Alcance: `android/assets/www/identidad.js`, `identidad.css`, `index.html`, `app.js`, `android/java/cl/fabrick/core/{Huella,NativeBridge,MainActivity}.java`, `src-tauri/src/lib.rs` y `tests/arranque/barcode.js`.

### Qué se hizo
- **«Mi identidad» reescrita**: credencial premium del operador (foto cuadrada, iniciales, nombre a 2 líneas, indicativo/CALL SIGN, RUT, ID de cliente y código de barras real). Foto desde galería/Archivos (FileReader + canvas → data URL, recorte cuadrado 360 px, JPEG ~0.84) y logo 256 px sobre fondo blanco. Todo se guarda en SQLite (`perfil`), sin nube.
- **Reflejo en el login**: `perfilCargar()` distingue negocio (`perfil.nombre`) de operador (`datos.operador`); prefiere `perfil.foto`, limpia la foto si se quitó (`logo-f.svg`) y pinta marca/TITLE/CALL SIGN/barcode.
- **Code128-B real (ISO/IEC 15417)**: `FABRICK_CODE128` (107 símbolos, validada contra la tabla de Wikipedia), `fabrickCode128()` con start B + verificador módulo 103 + stop, y `fabrickBarcodePintar()` con zona de silencio de 10 módulos. Compartido entre login e ID.
- **Seguridad y acceso desde ID**: crear/cambiar PIN (con verificador PBKDF2 respaldado en `usuarios`), activar/desactivar huella. `Huella.desactivar(Context)` borra solo la huella/Keystore y conserva el PIN; `Huella.estado` expone `tokenGuardado`; `NativeBridge.huellaDesactivar()`.
- **Núcleo**: `op_perfil.guardar` y `op_usuarios.actualizar` aceptan `borrar_foto` (limpiar foto de verdad); `guardar` extrae el operador de `datos` para no pisar `usuarios.nombre` con el nombre del negocio.
- **Fix crítico**: `idConectarEventos()` ahora se invoca al cierre de `identidad.js`: antes `app.js` intentaba enganchar los listeners durante su arranque, antes de que `identidad.js` se evaluara, dejando la página inerte (ningún botón respondía).

### Verificación
- `node --check identidad.js` y `app.js` ✔.
- `bash tests/arranque/correr.sh` **9/9** ✔ (nuevo `barcode.js`: «1234»→88, «PJJ123C»→55, 79/112 módulos, SVG con 10 módulos de silencio).
- `tests/web/escaneo.js`, `boleta.js`, `diseno.js` ✔.
- Render visual (`/tmp/opencode/id-top.png` y `id-full.png`): credencial, bloques y seguridad con inputs en bloque y nombre a 2 líneas.
- APK: versionCode 52 / versionName 0.9.37, zipalign 4 ✔, apksigner V2+V3 ✔, `identidad.css/js`, `app.js` e `index.html` dentro del APK ✔.
- SHA-256: `11b88a8f9d7830706442227bc30cb550064a8f0baea8d0642e944d7863337d33` · 4.329.267 B.
- Copiada a `/tmp/opencode/FABRI-CORE-0.9.37.apk` y `/storage/emulated/0/Download/FABRI-CORE-0.9.37.apk`.

### Pendiente
- Prueba de punta a punta en dispositivo real: foto, Code128 escaneable, enrolamiento de huella y login con huella (sin dispositivo/adb en esta sesión).
- `Restablecer acceso` (borrar) aún no limpia el verificador de `usuarios.hash` en SQLite; falta una acción `usuarios.limpiar_pin` (documentado en auditoría).
- `tests/seguridad/validar-manifiestos.sh` sigue fallando por `tools/validador/Cargo.toml` ausente.

## Sesión 2026-10-29 · APK 0.9.36 (51) — IA rápida, catálogo y negocio

Alcance: `app.js`, `inventario.js`, `app.css`, `inventario.css`, `index.html`, `lib.rs`, shim C, manifiestos y presentación.

### Qué se hizo
- **Catálogo de modelos**: Llama 3.2 1B/3B, Qwen 2.5 1.5B/3B y SmolLM2 1.7B con SHA-256 y tamaños reales; `modelos_recomendados` devuelve RAM total/libre, núcleos, presupuesto, perfil, nivel y modelo «estrella» (el mejor que cabe en el 55 % de la RAM).
- **Chat**: plantilla por familia (ChatML, Llama 3, Gemma, Phi-3) y preset de muestreo automático al cargar el modelo (Llama 3.2: temp 0.6 / top_p 0.9 / top_k 40 / rep 1.1 / 384).
- **Respuestas instantáneas**: las consultas claras de inventario (stock, margen, ventas, categorías, resumen) se responden desde SQLite sin tocar el modelo, con tope de 5 s; el contexto SQL/RAG va en paralelo con topes de 1,2–6 s.
- **Ajustes de IA**: pestañas Modelo / IA / Datos, cada parámetro con explicación tocable; los sliders solo pintan la etiqueta y el modelo recibe los valores al pulsar «Aplicar al modelo». Se respeta temperatura 0 (antes `||` la convertía en 0.7).
- **Inventario**: una sola llamada `inventario.panel` alimenta KPIs, categorías, stock bajo, top margen, ventas 24 h/30 d, ticket promedio y el panel del chat; sincronización de productos y boletas (`subir_boletas`), con las boletas pendientes si la nube aún no las acepta.
- **Escáner on/off**: el botón principal ahora es un toggle real («Abrir cámara» ↔ «Detener cámara»); un contador de generación descarta aperturas viejas, así tocar OFF durante el permiso ya no vuelve a encender la cámara. El lector fijo de los pasos 1–4 usa el mismo guardia y no abre dos streams. La cámara ya no se abre sola al entrar al paso 1 ni al activar el apilador.
- **Shim**: `<end_of_turn>` agregado a los marcadores de fin (Gemma).

### Verificación
- `cargo check --target aarch64-linux-android --release` ✔ (solo warning preexistente de `token`).
- `tests/inventario` 6/6, `tests/arranque` 8/8, `tests/web/escaneo.js` y `tests/web/boleta.js` ✔.
- APK: versionCode 51 / versionName 0.9.36, zipalign 4 ✔, apksigner V3 ✔, assets nuevos dentro del APK ✔.
- SHA-256: `79d538a2b974c057b968c61945180a0d7bde54b27aa30d607e404ce3cc4ef503` · 4.321.005 B.

### Pendiente
- Prueba en dispositivo real (cámara, micrófono, descarga de Llama 3.2 3B con ~1,9 GB libres).
- `tests/seguridad/validar-manifiestos.sh` sigue fallando por `tools/validador/Cargo.toml` ausente.

## Sesión 2026-10-29 · Rebrand: FABRI-CORE -> FORGE CORE STOCK

- Marca visible renombrada (92 archivos): `FABRI-CORE` → `FORGE CORE STOCK` y `FABRI-CORE PRO` → `FORGE CORE STOCK PRO` en la APK (HTML/JS/CSS/SVG/Java/strings.xml), la PWA/landing/web (`web/`, `presentacion/`), el proyecto Gradle `app/` y `fast/` (títulos, prompts del asistente, directorio de descargas `FORGE CORE STOCK`, manifests y `Cargo.toml` description).
- Identificadores técnicos NO tocados: package `cl.fabri.core` / `cl.fabrick.core`, crate `fabrick-core`, proyecto Vercel `forge-core-stock.vercel.app`, indexedDB `'fabri-core'`, nombre de descarga `.sqlite` y `thinkfashz/fabri-core` (remoto).
- Se conserva el copy diferenciador: «Sin nube / Local / Local-first / 100% Offline».
- Commit `8f23efc` pusheado a `origin/master` (`thinkfashz/fabri-core`).
- El deploy de Vercel no se tocó; el dominio `forge-core-stock.vercel.app` sigue activo.

## Sesión 2026-10-30 · APK 0.9.38 (53) — rebrand FORGE CORE STOCK

- Rebrand aplicado a la APK: `FABRI-CORE` → `FORGE CORE STOCK` y `FABRI-CORE PRO` → `FORGE CORE STOCK PRO` en `android/assets/www/*` (HTML/JS/CSS/SVG), Java y `strings.xml`.
- `NOMBRE` del build ahora es `FORGE-CORE-STOCK-0.9.38`.
- Package Android se mantiene `cl.fabrick.core` (instalación encima sin borrar datos).
- APK: versionCode 53 / versionName 0.9.38, zipalign 4 ✔, apksigner V2+V3 ✔, assets con marca FORGE dentro (17×, 0 FABRI) ✔.
- SHA-256: `f36cbaeb8c277aab8610b18bea1315c4c3768dbd78436e64ae23770c2aff00df` · 4.329.267 B.
- Copiada a `/tmp/opencode/FORGE-CORE-STOCK-0.9.38.apk` y `/storage/emulated/0/Download/FORGE-CORE-STOCK-0.9.38.apk`.

## Sesión 2026-10-31 · Marketplace en la nube (catálogo con filtros)

- **API**: `web/api/catalogo/index.go` → `GET /api/catalogo` sirve el catálogo de la tienda (12 productos con categoría, clasificación, descripción, precio CLP, stock y tinte). Filtros por query: `q`, `categoria`, `clasificacion`, `max_precio`; devuelve también las categorías/clasificaciones disponibles. Lee una sobreescritura de Blob (`fabri/catalogo.json`) si existe `BLOB_READ_WRITE_TOKEN`; si no, usa el seed. Registrado en `web/vercel.json`. Probado localmente con `go build` + servidor de prueba (todos los filtros OK).
- **PWA**: nueva pantalla «Mercado» (`s-mercado`) en `web/app/index.html`, botón de nav (bajo Operación, con `data-mas`), integrada en `go()` de `app.js`. Catálogo tipo marketplace con filtros (búsqueda, chips de categoría, chips de clasificación, rango de precio máx) y grilla de tarjetas con tinte por categoría + cubo isométrico CSS. `web/app/mercado.js` consulta `/api/catalogo` y cae a un seed local espejo si no hay red. Estilos fusionados en `web/app/styles.css` (herencia de tokens: navy, acento, lima).
- **Service worker**: `SHELL` incluye `mercado.js`; versión de caché `fcore-v7`.
- **Verificación**: `tests/web/diseno.js` ✔ (contrato, sistema visual, offline); render Chromium headless: 12 tarjetas, chips poblados, badge de conteo. Detector impeccable: sin hallazgos propios en la superficie nueva (solo patrones preexistentes de la app, que se conservan por brief).
- Nota: la conexión APK→catálogo requiere cablear `op_nube` (hoy valida/guarda config) para llamar `/api/catalogo`; documentado como paso siguiente.

## Sesión 2026-10-31 · Deploy en vivo del marketplace (fabri-api)

- El endpoint público del catálogo vive en **`api-telefono/`** (proyecto Vercel `fabri-api`, Node/TS), NO en `web/` (que es `forge-core-stock`). Se creó `api-telefono/api/catalogo.ts` (catálogo + filtros `q`/`categoria`/`clasificacion`/`max_precio` + CORS) y se registró la ruta `/api/catalogo` en `api-telefono/vercel.json`.
- Se retiró el handler Go equivalente de `web/api/catalogo/` y su entrada en `web/vercel.json` para evitar dos fuentes de verdad.
- Desplegado con `vercel --prod` (CLI autenticado): deployment `dpl_EjzLsy2fza2zAsctB8aZBHUmXBag` → aliased `https://fabri-api.vercel.app`.
- Verificado en vivo: `GET /api/catalogo` → `{ok:true,total:12}`, filtros OK, `/api/health` sigue 200. La PWA (mercado.js) ahora carga desde la nube (origen "nube").

## Sesión 2026-10-31 · Tienda pública (web/tienda.html) con pago de demostración

- Nueva página pública `web/tienda.html` (+ `tienda.css` + `tienda.js`), consumiendo `/api/catalogo` en vivo (con seed de respaldo offline).
- Flujo: catálogo con filtros (búsqueda, chips de categoría, rango de precio) → detalle de producto → carrito → checkout con formulario (nombre, email, teléfono, dirección) → forma de pago **Tarjeta / Efectivo** → pasarela **simulada** (valida tarjeta con Luhn + expiración + CVV; `4242 4242 4242 4242` aprueba) → estados **aprobado** (pantalla de éxito + botón) y **rechazado** (pantalla de error con motivo) → confirmación por **WhatsApp** con pedido preconfigurado (productos, total, pago, nombre, teléfono, ref).
- Número de WhatsApp configurable en `tienda.js` → `WA_NUMERO` (default `56912345678`, placeholder) o `window.FORGE_WA`.
- Verificado con Chromium headless: catálogo (12 productos, 5 chips), detalle, carrito, checkout, pago aprobado (WhatsApp presente) y rechazado (tarjeta inválida). `node --check` OK.
- Pago de DEMOSTRACIÓN: no mueve dinero real.

## Sesión 2026-10-31 · Tienda 2.0: reloj canvas, promoción d3 y temporizador

- Mejora de presentación del catálogo: hero con **reloj analógico en canvas** (#tiReloj, marca lima, fecha local), banner de **promoción d3 por tiempo limitado** (gauge de anillo con `d3s.arc` + `scaleLinear`, via `app/vendor/d3-mini.js`), **temporizador de oferta** (días/h/min/s hasta medianoche) y badge «OFERTA −20%» en las tarjetas de la categoría en promo (Equipos).
- El descuento se aplica de verdad en toda la cadena: tarjetas (precio tachado + efectivo), detalle, carrito, resumen de checkout, total y mensaje de WhatsApp.
- Verificado headless: 12 tarjetas, 4 badges de oferta, reloj pintando fecha, gauge d3 con 2 paths, temporizador corriendo, pct 20%. `node --check` OK.
- Desplegado: `dpl_6Bi3tUVfjQrrWdwaFfhfjroFxy18` → aliased `https://forge-core-stock.vercel.app/tienda.html` (HTTP 200; `app/vendor/d3-mini.js` sirve 200).

## Sesión 2026-10-31 · Tienda multipágina 3.0 (Fabrick Design System + QR + recorrido)

- **Arquitectura**: la tienda pasó de una sola página a **7 páginas** enlazadas:
  `tienda.html` (catálogo), `producto.html?id=`, `promociones.html`, `carrito.html`,
  `checkout.html`, `pago.html` y `escaner.html`, con núcleo compartido
  `web/tienda-nucleo.js` (`window.FCS`) y un JS por página (`tienda-*.js`).
- **Sistema de diseño**: `web/components.css` es ahora una copia del **Fabrick Design
  System** (tokens `--ds-*`, 23 componentes `.ds-*`); `tienda.css` quedó solo con los
  componentes propios de la tienda (prefijo `ti-`). Cada página declara su identidad
  con `<body data-pg="...">` → `--pg` (catálogo lima, producto cian, promos ámbar,
  carrito azul, checkout violeta, pago verde, escáner rosa), así se personaliza una
  pantalla sin tocar a las demás.
- **Navegación de recorrido**: topbar `.ds-topbar` + barra de pasos 1→5 (marca
  `is-hecho` los ya visitados) + `.ds-bottom-nav` móvil con ítem central de escáner;
  overlay de **recorrido guiado** de 5 pasos (`#fcsTour`, auto-ofrecido la 1.ª visita,
  `localStorage fcs_recorrido_visto`) y botón «Recorrido» siempre accesible.
- **Escáner QR real**: `app/vendor/zxing.min.js` (vendoreado) genera el QR del producto
  (`FORGE:<id>`) y lee con la cámara; fallbacks de código **manual** e **imagen** si no
  hay cámara. Lo leído se busca en el catálogo (local → API) y **agrega al carrito**;
  historial en `localStorage fcs_escaneos`.
- **Bug corregido (importante)**: ZXing lanza `TypeError: Cannot read properties of
  undefined (reading 'get')` si `MultiFormatWriter.encode` recibe 4 argumentos — hay
  que pasar **`null` explícito como 5.º parámetro** (hints). Mismo detalle en
  `d3.arc()`: dibuja centrado en `(0,0)`, exige `translate(cx,cy)` al centro del
  viewBox. Y `.ds-progress` necesita su `<i>` interno para pintar relleno.
- **Verificación**: banco de pruebas headless en `/tmp/opencode/fcs-pruebas.js`
  → **8/8** (catálogo, producto con `?id=`, promos, carrito, checkout, pago, escáner y
  **ida y vuelta QR** `FORGE:eq-001`). Capturas 390 px + escritorio en
  `/tmp/opencode/fcs-fotos/`. Corregidos en el camino: filas del carrito solapadas en
  móvil, título de marca sin espacio, `[hidden]` anulado por el `display` de las
  componentes, input de archivo nativo en inglés.
- **Deploy + git**: `vercel --prod` → `dpl_GbWGVmM6MD86dZf2Cbun9zBYdYqm` (10 URLs en
  200 en `https://forge-core-stock.vercel.app/`), commit `e28b4c4` push a
  `thinkfashz/fabri-core`.
- **Pendiente**: número real de WhatsApp (`window.FORGE_WA`, hoy placeholder
  `56912345678`) y prueba de cámara real en el teléfono (sin adb).

## Sesión 2026-10-31 · App móvil FORGE CORE STOCK (8 pantallas, 100% offline)

- **Nueva app** en `web/forge-app/`: 8 pantallas, **cada una en su carpeta** con su
  `index.html` + `style.css` propios (sin CSS compartido ni frameworks). Identidad
  FORGE: `--bg:#0A0A0A`, `--neon:#C8FF00`, `--card:#151515`, `--text:#fff`; textura de
  carbono (tramas diagonales), HUD mono espaciado, glow `0 0 20px rgba(200,255,0,.4)`.
  Mobile first: app centrada, `max-width:430px`, `min-height:100dvh`, safe-areas.
- **Pantallas**: `01-home-catalogo` (banner PRICE SAVER, buscador, grid CSS Grid 2×2,
  bottom nav fija con cart 0), `02-scanner-busqueda` (visor HUD, marco neon con
  esquinas y láser animado, overlay «PRODUCTO ENCONTRADO», Buscar/Añadir),
  `03-detalle-producto` (ficha Aceite Oliva −25%, stock 12, Valle Central, tabla
  nutricional, 4,8 estrellas, selector de cantidad en barra fija),
  `04-add-to-cart` (popup +1 con anillo, confeti neón, toast, carrito 0→1),
  `05-carrito` (2 líneas, cupón PRICE SAVER, subtotal $10.570 / envío $3.990 /
  descuento −$1.747 / total $10.570, Pagar ahora), `06-checkout-form` (RUT, teléfono,
  Región Metropolitana / Comuna Providencia, Despacho 24H $3.990 vs Retiro Gratis),
  `07-pasarela-pago` (WebPay Plus con check, MercadoPago, Transferencia, Mach; tarjeta
  •••• 4242; Total CLP $10.570), `08-pago-exitoso` (check gigante + confeti, orden
  #FCS-8821-CHILE, tracking 60% con pasos, factura PDF).
- **Cada pantalla** lleva cabecera FORGE + «NÚCLEO ACTIVO» pulsante + carrito, y barra
  de progreso **1/8 … 8/8** (12,5% por paso, `.p1`…`.p8`) con `role="progressbar"`.
  Iconos SVG inline (cero emoji), foco visible neón, `prefers-reduced-motion`,
  `tabular-nums` en todos los precios.
- **Bugs corregidos en la revisión visual**: `overflow-x:hidden` en `.app` rompía el
  `position:sticky` del bottom nav (pasó a `fixed` como las barras de compra/pago);
  «Región Metropolitana» se truncaba en el `select` (fila `.row--geo` 1.45fr/1fr con
  fuente 13px); iconos de arroz y leche ilegibles → redibujados como saco y cartón.
- **Verificación**: las 8 pantallas + `style.css` capturadas con headless shell a
  430×932 (confeti fotografiado a 0,9 s), cero `style=` inline, 8/8 con «PASO n/8»,
  precios solo en CLP.
- **Deploy + git**: `vercel --prod` → `fabri-core-7ogr8ywg8` (9 URLs en 200:
  sitio + 8 pantallas + CSS) en `https://forge-core-stock.vercel.app/forge-app/`.
- **Pendiente**: probar en dispositivo real (sin adb), `window.FORGE_WA` sigue con
  placeholder `56912345678`.

### Rotación de FABRI_API_TOKEN (fabri-api) — 2026-10-31

- El token anterior estaba creado como variable **sensitive** en Vercel (solo-escritura):
  irrecuperable, ni siquiera por `vercel env pull` (devolvía `[SENSITIVE]`).
- Rotado: valor nuevo generado con `openssl rand -hex 24`, instalado en Vercel por pipe
  (no pasó por el chat), y guardado en
  `~/.config/opencode/secrets/fabri-api-token.txt` (**chmod 600**, no commitear).
- Deploy `dpl_9Uap5FNHiJJYWxzgheyyWZ9qhwG3` (fabri-api). Verificado end-to-end:
  POST `/api/inventario` → 401 sin token, 401 con token inválido, 200 con el nuevo.
- Aclaración de contratos: la APK consume **fabri-api** con `Bearer FABRI_API_TOKEN`;
  **forge-core-stock** no usa token fijo (`/api/health` y `/api/estado` son públicos,
  `/api/auth` emite sesiones — hoy 501 por falta de `BLOB_READ_WRITE_TOKEN`).

### Bug crítico de la APK: invAnimarEnvioModal — 2026-10-31 (commit c5a2428)

- El log del usuario mostró `ReferenceError: invAnimarEnvioModal is not defined`
  (id 1981, severidad crítico): el HTML/CSS del modal `#modalEnvioAnimado` existían
  pero ningún JS lo implementaba; `datos.js` lo llamaba en `hojaSincronizarNube`.
- Implementada en `inventario.js` (espacio de nombres `inv`): canvas de partículas,
  cronómetro, barra de progreso (`progreso(texto, pct)`), check SVG, cierre auto,
  contador `INV.envioGen` para invalidar animaciones viejas, `prefers-reduced-motion`.
- Segundo bug corregido en `hojaSincronizarNube`: ahora valida 401/`resp.ok`/
  `salida.ok===false` ANTES de `sync_marcar` (antes un token rechazado marcaba
  pendientes como enviados).
- `inventario.css`: añadido `@keyframes check-fill` (la animación ya lo referenciaba).
- Verificado con headless shell: éxito (modal+check+cierre) y fallo 401 (cierre+toast).

## Sesión 2026-10-31 · APK 0.9.39 (54) — fix del modal de sincronización

- Build de `scripts/compilar.sh` (sin Gradle) con los assets corregidos del commit `c5a2428`:
  `invAnimarEnvioModal` implementada, validación 401/`resp.ok` antes de `sync_marcar`,
  keyframes `check-fill` añadidos a `inventario.css`.
- versionCode 54 / versionName 0.9.39 → se instala encima de la 0.9.x sin borrar datos
  (mismo package `cl.fabrick.core`).
- Verificado dentro del APK: `invAnimarEnvioModal` 1×, validación 401 1×, `check-fill` 1×,
  marca FORGE 17×. `apksigner verify`: v2 ✔ v3 ✔ (exit 0).
- SHA-256: `d0f2d7a3d4bf12e39698142c05b6adb03c4e4c16fe3c7f5c3ae9cc2567bbafb0` · 4.333.363 B.
- Entregada en `/storage/emulated/0/Download/FORGE-CORE-STOCK-0.9.39.apk` y `/tmp/opencode/`.

## Sesión 2026-10-31 · APK 0.9.40 (55) — módulo Catálogo + refinamiento del Inventario

- Commit `0ddcd9d` (push `0ccbd86..0ddcd9d`): rediseño y módulo nuevo, todo aditivo.
- **Nuevo módulo «Catálogo» (`#v-catalogo`, `catalogo.js` + `catalogo.css`)**:
  - KPIs y chips de categorías con conteos **reales** del panel del núcleo.
  - Búsqueda server-side (el núcleo resuelve `texto`/`categoria` con LIKE sobre
    toda la base; `limite` clamp 1-500 + `offset`, paginación por «Ver más»).
  - Escáner de código de barras propio con `BarcodeDetector` (mismos formatos
    que el lector de inventario); **reutiliza `INV.lec.camara`** si ya está
    encendida → nunca dos cámaras. Al leer: búsqueda exacta + tarjeta destacada.
  - Sección «Tienda FORGE»: las 8 pantallas de `web/forge-app/01..08` copiadas
    a `assets/www/catalogo-web/` y embebidas por iframe lazy con pestañas 01-08.
  - Registrado en `RAMAS_VISTA.catalogo`; `catSalir()` apaga la cámara al salir.
- **Luz piloto de conexión global** (`pilotoConexion`, `catPiloto`,
  `invPilotoConexion`): `navigator.onLine` + ping a
  `https://fabri-api.vercel.app/api/health` cada 45 s (AbortController, 6 s).
  Estados ok/aviso/error **siempre con texto y hora** (nunca color solo).
- **Refinamiento del Inventario (los 5 pasos)**: sección «Refinamiento 0.9.40»
  al final de `inventario.css` — hero con glow y eyebrow pulsante, KPIs con
  gradiente, pasos con glow activo, paneles como card, foco acento en inputs,
  botones con glow, ticket con sombra, `.inv-vacio`, `prefers-reduced-motion`.
  **No se eliminó ninguna regla ni comportamiento.**
- Verificación visual con headless shell (arnés temporal en `www/`, borrado antes
  del build): catálogo con datos fake, chips, tarjetas, «Ver más», tienda con
  iframe 01 cargado, piloto verde con hora. Fix derivado: `.cat-vacio:empty { display:none }`.
- Build `scripts/compilar.sh` EXIT=0 · 4.281 KB · VC 55 / 0.9.40.
  Verificado dentro del APK: las 8 pantallas de `catalogo-web/`, `catalogo.js`
  (21.908 B), `catalogo.css` (15.865 B), `v-catalogo`+`pilotoConexion` en
  `index.html`, marca FORGE 18× en el módulo. `apksigner verify`: v2 ✔ v3 ✔.
- SHA-256: `5a4c3236d63773bde1de9fddce49c899be574e70e899f749ad735e0660b115d5` · 4.384.190 B.
- Entregada en `/storage/emulated/0/Download/FORGE-CORE-STOCK-0.9.40.apk` y `/tmp/opencode/`.
- Sin probar en dispositivo: cámara/escáner real (no hay adb). Pendiente del usuario:
  pegar el token en Integración → Nube (Integración → Nube, `fabrick.nube.url`/`fabrick.nube.token`).

## Sesión 2026-10-31 · APK 0.9.41 (56) — tienda real, lector propio y pantalla completa

- Commit `2066409` (push `703a08d..2066409`). Motivo: capturas del usuario mostraban
  topbar partido, tarjetas con el código fuera del borde, la tienda por iframes
  guiados y zoom/bordes en todas las pantallas.
- **Pantalla completa y sin zoom** (nativo): `MainActivity` ahora usa
  `setUseWideViewPort(true)` + `setLoadWithOverviewMode(true)` + `setTextZoom(100)`.
  Antes la WebView maquetaba a 980 px y encogía la página → bordes negros y pinch
  zoom. Meta viewport con `maximum-scale=1, user-scalable=no`. Manifiesto con
  `android:windowSoftInputMode="adjustResize"` para que el teclado no deforme.
- **Topbar**: marca en una línea (elipsis), píldoras acotadas y el piloto de
  conexión reducido a luz (punto + tooltip) en pantallas ≤400 px.
- **Tienda real**: se eliminó el recorrido guiado por iframes 01-08 (`cat-tienda*`,
  `catTiendaTab`, `cat-esc-*`). El módulo tiene 6 páginas con navegación libre:
  `catEscenaCatalogo → Producto → Carrito → Checkout → Pago → Éxito`.
  Carrito persistente (`forge.tienda.carrito`), totales con envío gratis ≥ $20.000,
  checkout con entrega/pago, pago simulado con anillo de progreso y éxito con
  seguimiento (60%).
- **Lector propio** (`catLector*`) con el mismo lenguaje del inventario: ON/OFF,
  mira con láser, ficha del producto leído, `BarcodeDetector` y
  `invLectorParar()` antes de abrir cámara (nunca dos cámaras).
- **Detalle con wiki**: imagen/descripción/etiquetas/Nutri-Score/NOVA/alérgenos
  desde `ficha`, datos del producto y relacionados por categoría.
- **Banners SVG en español** generados en la app (OFERTA FLASH / PRECIO BAJÓ /
  LLEVA 3 PAGA 2), 3 temas, producto y precio reales, rotación variada por categoría.
- **Tarjetas**: imagen si la ficha la trae, si no motivo por categoría; promo
  determinista por código; stock con color; código con elipsis (ya no se sale).
- **Inventario**: id duplicado `invEdPrecio` (el campo del formulario quedaba
  muerto porque `getElementById` devuelve el primero). Segundo campo renombrado a
  `invEdPrecio2` + espejo bidireccional y `window.invEdSyncPrecio()` al cargar.
- Verificado con arnés headless a 393×852 (iPhone 17): catálogo, producto, carrito,
  checkout, pago y éxito; topbar en una línea. Arneses borrados antes del build.
- Build EXIT=0 · 4.289 KB · VC 56 / 0.9.41 · `apksigner` v2 ✔ v3 ✔.
  Dentro del APK: `catalogo.js` 42.803 B, `catalogo.css` 32.382 B, las 6 escenas en
  `index.html`, `windowSoftInputMode` en el manifiesto binario.
- SHA-256: `f5f44a41cc217762602fba787669c9aebe7211ebd0a67316cf6a1e0912a3a4c3` · 4.392.382 B.
- Entregada en `/storage/emulated/0/Download/FORGE-CORE-STOCK-0.9.41.apk` y `/tmp/opencode/`.
- Pendiente: prueba en dispositivo (cámara real, teclado) — no hay adb. El token de
  nube sigue pendiente de pegar en Integración → Nube.

## Sesión 2026-10-31 · APK 0.9.42 (57) — escáner con canvas + carrito en vivo

- Commit `e011a17` (push `7cfddb0..e011a17`).
- **Bug «cargar más» corregido**: `catMas()` descargaba otra página de 500 pero
  `catRender()` seguía cortando en `CAT.lote` (24), así que el usuario pulsaba y no
  veía nada. Ahora expande primero lo descargado y sólo pide páginas cuando se
  agota el búfer (`CAT.recargarLote` sube el lote al llegar la página). El contador
  muestra «Mostrando N de M cargados» y el botón distingue «Ver N más» de
  «Cargar N más».
- **Escáner a pantalla completa** (`catEscenaEscaner`, `ESC.*`): vídeo + `<canvas>`
  que dibuja máscara, esquinas, línea de barrido y destello verde. Lectura sobre
  canvas fuera de pantalla (720×540, recorte central) en vez del `<video>`, con
  respaldo `invEscanearCuadro`, linterna (`track.getCapabilities().torch`), pitido
  WebAudio y vibración (`navigator.vibrate`).
- **Base completa**: `catPorCodigo()` busca en la página cargada y, si no está,
  en el núcleo (`listar` con texto=código) con caché `CAT.cacheCodigo`.
- **Carrito en vivo**: cada lectura hace `catCarroAgregar` y apila la fila en el
  panel inferior (`esc-fila`), que sube al primer producto. Precio con animación
  de contador (`catAnimarNumero`) + destello (`@keyframes esc-precio`) y total
  animado. Acciones: seguir viendo / ir a pagar / limpiar.
- Se eliminó el lector inline (el botón del buscador ahora abre el escáner).
- Build EXIT=0 · 4.296 KB · VC 57 / 0.9.42 · `apksigner` v2 ✔ v3 ✔.
  Dentro del APK: `catEscDibujar`/`catEscLeido`/`catPorCodigo` (7 referencias) y
  `escCanvas`/`escPanel` en `index.html`.
- SHA-256: `7f47daf3ac94e3ef5e71ecc4cd70b4ab89a322adad5a6edfcc7017a93c0d12eb` · 4.396.478 B.
- Entregada en `/storage/emulated/0/Download/FORGE-CORE-STOCK-0.9.42.apk` y `/tmp/opencode/`.

## Sesión 2026-10-31 · APK 0.9.43 (58) — rediseño del Inventario + lector en boleta

- Commit `9d199c7` (push `a9cbaca..9d199c7`).
- **Rediseño completo** (capa nueva al final de `inventario.css`, sin quitar nada):
  hero con jerarquía, KPIs de 3 columnas, panel del negocio con 6 datos (unidades,
  margen, ventas 24 h y 30 d, IVA estimado, sin sincronizar), pasos como barra
  segmentada con el activo centrado, paneles tarjeta, campos de 48 px, catálogo en
  tarjetas y boleta a dos columnas.
- **IVA estimado** = valor_venta × 19/119 (precio con IVA incluido). Precios
  compactos `$12,3 M` para que no se trunquen.
- **Lector en el paso 5 (boleta)**: `invLecCaja5` + guards de 1..5; al leer, el
  producto entra al carrito de la boleta con «Otra unidad» y «Emitir boleta».
- **Teclado**: bloque `tecladoVisible()` en `app.js` con `visualViewport`; al
  enfocar un campo la página se desplaza lo justo (dos pasadas 260/620 ms).
- Bugs reales corregidos: «undefined%» en márgenes si el núcleo no devuelve un
  campo; campos del paso 4 cortados (`.inv-calc` a 1 columna); tabla de márgenes
  con scroll; `scrollIntoView` que descuadraba la página en horizontal (ahora
  sólo mueve `scrollLeft` de la barra de pasos).
- Verificado con arnés headless (393×852) en los 5 pasos; arnés borrado.
- Build EXIT=0 · 4.300 KB · VC 58 / 0.9.43 · `apksigner` v2 ✔ v3 ✔.
- SHA-256: `d143bf23af7359cbb6aa44deb91a9f2fc64743d65132fbd794282f912a2169ac` · 4.400.574 B.
- Entregada en `/storage/emulated/0/Download/FORGE-CORE-STOCK-0.9.43.apk` y `/tmp/opencode/`.

## Sesión 2026-11-01 · APK 0.9.44 (59) — editor con scroll, QR y pulido

- Commit `6c5f3ef` (push `1fe494b..6c5f3ef`).
- **Bug del editor**: `.inv-editor` es una capa fija; sólo `.inv-ed-campos` tenía
  scroll (~248 px visibles). Al deslizar sobre la ficha del margen no pasaba nada
  y el formulario parecía cortado. Ahora scroll único del editor (`overflow-y:auto`
  + `.inv-ed-campos` sin scroll propio), cabecera y pie sticky, y ficha del margen
  más compacta (precio 32 px, celdas 9 px/13,5 px).
- **Teclado**: `tecladoVisible()` busca el contenedor con scroll propio y desplaza
  ese (el editor), no sólo la ventana.
- **QR**: `invCodigoDeTexto()` extrae el código de un QR con URL (`?codigo=`),
  JSON o número con separadores; aplicado en `invLecBucle` (pasos 1-5) y en
  `catEscLeido()` del catálogo. `invNotaLector(paso)` muestra «código o QR» en la
  boleta.
- **Pulido**: KPIs con acento superior por estado; tablas con cabecera sticky,
  filas alternas y hover; `.inv-tabla-scroll` con scroll horizontal; tarjetas de
  producto con código de barras discreto.
- Verificado con arnés headless: editor desplaza 1035 px sobre 722 visibles y
  muestra todos los campos; paso 5 con lector y carrito.
- Build EXIT=0 · 4.300 KB · VC 59 / 0.9.44 · `apksigner` v2 ✔ v3 ✔.
- SHA-256: `c8ea73d7819184e11dfeb5fbfcb2661f330c31ad5f9b51959c58823d94ada691` · 4.404.670 B.
- Entregada en `/storage/emulated/0/Download/FORGE-CORE-STOCK-0.9.44.apk` y `/tmp/opencode/`.

## Sesión 2026-11-01 · APK 0.9.45 (60) — wiki por código y precios de mercado

- Commit `c450094` (push `ea0cd34..c450094`).
- **Wiki**: `catWikiCargar()` reutiliza `invConsultarApiLibre()` (Open Food/Beauty/
  Products Facts, libres y sin clave) y cachea 30 días en
  `forge.wiki.<codigo>` de localStorage. `catPintarWikiApi()` pinta imagen,
  descripción, ingredientes, Nutri-Score, NOVA, alérgenos y etiquetas.
- **Precios de mercado** (`catPreciosMercado`): «Tu precio», promedio/mín/máx de
  la misma categoría en la base local con % vs promedio, y observaciones de
  Open Prices (`prices.openfoodfacts.org/api/v1/prices?product_code=`), con
  filtro Chile y aviso cuando sólo hay datos de otros países. Verificado: la API
  responde (`{"items":[]}` para códigos sin datos; OFF tiene 6.939 productos CL).
  No existe API pública gratuita de precios de retail chileno, así que la
  referencia local es la fuente fiable y Open Prices el extra colaborativo.
- **Banners**: 6 temas con 6 paletas, carrusel automático 5,2 s y puntos
  sincronizados. Corregido el avance (se medía por ancho de contenedor y
  desalineaba; ahora por `offsetLeft` del primer hijo).
- Animaciones escalonadas en banners y tarjetas, con `prefers-reduced-motion`.
- Build EXIT=0 · 4.309 KB · VC 60 / 0.9.45 · `apksigner` v2 ✔ v3 ✔.
- SHA-256: `e4d2edc2aaf81569479c4a5f7594b592198d6eca7d61333b69399b1cf3532769` · 4.408.766 B.
- Entregada en `/storage/emulated/0/Download/FORGE-CORE-STOCK-0.9.45.apk` y `/tmp/opencode/`.

## Sesión 2026-11-01 · APK 0.9.46 (61) — chat con streaming y 17 proveedores

- Commit `c201561` (push `fb58ad5..c201561`).
- **Causa del «se queda pegado»**: `chatRemoto` esperaba la respuesta completa
  (timeout de lectura 180 s), sin primer token y sin cancelación posible para
  remoto (`chatDetener` sólo actuaba en local). El botón quedaba bloqueado.
- **NativeBridge**: nuevo `chatRemoto(prompt, maxTokens, ajustesJson)` con
  `stream:true`, emisión por `FabriChat.token(...)`, historial, temperatura y
  top_p; `chatRemotoCancelar()` desconecta la conexión; timeouts 15 s/90 s;
  adaptador de Anthropic (`x-api-key`, `anthropic-version`, SSE
  `content_block_delta`) y catálogo fijo de modelos (no publica `/models`).
- **JS**: burbuja parcial también en remoto, `chatPintarTokens()` con freno de
  70 ms, `FabriChat.remoto()` finaliza la burbuja existente (antes duplicaba),
  `chatHistorialParaApi()` (últimos 8 turnos), `detenida` visible.
- **Proveedores**: 17 entradas con URL, modelos sugeridos y nota de clave:
  OpenAI, Anthropic, Google Gemini, DeepSeek, Groq, xAI, Mistral, OpenRouter,
  Together, Perplexity, Fireworks, Cerebras, Hugging Face, OmniRoute, Ollama,
  LM Studio y personalizado.
- **Velocidad**: Rápido (320 tok, 0.4, sin RAG), Equilibrado (640, 0.7) y
  Preciso (1200, 0.5, con RAG); se guarda en `forge.chat.velocidad`. Chip con
  el modelo activo en la cabecera.
- Build EXIT=0 · 4.309 KB · VC 61 / 0.9.46 · `apksigner` v2 ✔ v3 ✔.
- SHA-256: `befc2d027bb340ea2b6e7d3a240d327bcd1dd3ba454831c476fe89233999b656` · 4.412.862 B.
- Entregada en `/storage/emulated/0/Download/FORGE-CORE-STOCK-0.9.46.apk` y `/tmp/opencode/`.

## Sesión 2026-11-01 · APK 0.9.47 (62) — chat más natural y rápido

- Commit `f42d14e` (push `5c8aa35..f42d14e`).
- **Bug de duplicación**: `chatPromptRemoto` incluía toda la conversación en el
  texto y el puente la mandaba además como `historial` → cada turno viajaba dos
  veces. Corregido: el prompt lleva sólo el mensaje actual + contexto.
- **Estilos** (`CHAT_ESTILOS`): Natural (0.70, 2-4 frases), Conciso (0.45, 1-2
  frases), Técnico (0.30, cifras y pasos). El `sistema` viaja al nativo y se
  usa también en el prompt local; se guarda en `forge.chat.estilo`.
- **Precalentamiento**: `chatPreconectar()` (HEAD keep-alive en hilo propio)
  deja DNS+TLS listos para el primer turno.
- **Métrica**: la burbuja muestra «1er token X ms · total Y s».
- Nota de rendimiento para el usuario: el modelo manda. Groq (llama-3.3-70b) y
  Gemini 2.5 Flash dan primer token de 200-400 ms; un GGUF de 0.5B en el
  teléfono ronda 8-15 tok/s y es menos coherente.
- Build EXIT=0 · 4.309 KB · VC 62 / 0.9.47 · `apksigner` v2 ✔ v3 ✔.
- SHA-256: `2662ef6919831685fa74cdea656955fa2104aa28df2a3f47b5388a9562baec0d` · 4.412.862 B.
- Entregada en `/storage/emulated/0/Download/FORGE-CORE-STOCK-0.9.47.apk` y `/tmp/opencode/`.

## Sesión 2026-11-01 · APK 0.9.48 (63) — chat: scroll, logos y flujo de modelos

- Commit `1da1869` (push `f24ced2..1da1869`).
- **Scroll de ajustes**: `#v-chat` es fija con `overflow:hidden` y `.chat-config`
  era `flex:0 0 auto` → el panel se recortaba sin scroll. Ahora
  `flex:0 1 auto; max-height:64vh; overflow-y:auto; overscroll-behavior:contain`.
- **Logos reales**: `marcas-ia.js` (23.721 B) con 20 SVG de LobeHub icons
  incrustados y normalizados a currentColor. Se carga antes de `app.js`.
- **Selectores**: botones `.chat-selector` con logo + nombre + tipo, hoja
  inferior `.chat-hoja` con lista ilustrada; `chatHojaProveedores()` y
  `chatHojaModelos()`. Los `<select>`/`<datalist>` quedan ocultos por
  compatibilidad con `chatGuardarRemoto`.
- **Flujo**: al guardar la clave sin modelo se pone `CHAT_MODELOS_AUTO` y
  `chatTraerModelos()` abre la hoja al recibir el catálogo.
- **Render**: JSON crudo → bloque de código tabulado; `overflow-wrap:anywhere`
  en burbujas para URLs/números largos.
- Verificado con captura 393×900: hoja de proveedores con logos y panel de
  ajustes (velocidad y estilo) correctos.
- Build EXIT=0 · 4.325 KB · VC 63 / 0.9.48 · `apksigner` v2 ✔ v3 ✔.
- SHA-256: `ae73a14d574f972808c5c0e0933481a14266663084e02761d184df00fed8f954` · 4.425.219 B.
- Entregada en `/storage/emulated/0/Download/FORGE-CORE-STOCK-0.9.48.apk` y `/tmp/opencode/`.

## Sesión 2026-11-01 · APK 0.9.49 (64) — módulo Impuestos F29

- Commit `7fb3122` (push `c2c6df0..7fb3122`).
- **Motor** (`impuestos.js`): `impCalcular()` con IVA 19 %, débito = ventas ×
  19/119, crédito = costo × 19/119, determinado = débito − crédito − remanente,
  remanente arrastrable, PPM = ventas × tasa (0,2 % por defecto) y total.
  Datos desde `panel` del núcleo (`valor_venta`, `valor_costo`); admite ventas
  reales manuales.
- **UI**: hero con semáforo y plazo referencial (día 20), parámetros (período,
  tasa PPM, remanente, ventas), 5 KPIs, barra SVG animada de beneficios
  tributarios, resumen, formulario de pago con comprobante imprimible,
  hoja de ruta de 6 pasos y fuentes oficiales con `abrirUrl`.
- Verificado con captura 393×2700 y datos de prueba: débito $1.971.159,
  crédito $1.421.008, determinado $550.151, PPM $24.691, total $574.842.
- Aviso de estimación referencial y dependencia del régimen (14 D N°8 / N°3).
- Build EXIT=0 · 4.334 KB · VC 64 / 0.9.49 · `apksigner` v2 ✔ v3 ✔.
- SHA-256: `2cb9b6c566cb54539862dc124ec118ac71057d455beb2ab90a83fcaf178df965` · 4.437.646 B.
- Entregada en `/storage/emulated/0/Download/FORGE-CORE-STOCK-0.9.49.apk` y `/tmp/opencode/`.

## Sesión 2026-11-01 · APK 0.9.50 (65) — F29 con cierres, ayudas y descarga

- Commit `d6f5500` (push `f97ba23..d6f5500`).
- **Modos de ventas**: `auto` (cierres de caja), `stock` (proyección) y
  `manual`. `impCargarBoletas()` usa la acción `boletas` (límite 200) y agrupa
  por período con `impMesDe()`; tabla con fecha/folio/neto/IVA/total + totales.
- **Autocompletado** desde «Mi identidad» (`fabrick.identidad` + acción
  `perfil`): razón social, RUT, giro y domicilio.
- **Ayudas** en los 10 campos, con ejemplo y explicación simple.
- **Borrador F29** en pantalla y `impDescargarFormulario()` para el diálogo de
  impresión (Guardar como PDF); `impImprimir()` para el comprobante.
- **Acciones** reordenadas: «Ir a pagar en el SII» principal + Descargar,
  Comprobante, TGR y Actualizar.
- **FIX**: `.cat-btn.lima` no se pintaba en este módulo porque `--cat-*` sólo
  existía en `#v-catalogo`; ahora se declaran en `#v-impuestos`.
- **FIX**: desborde horizontal por la tabla de cierres (`min-width: 0`).
- Verificado con captura 393×3100: modos, ayudas, cierres con totales,
  datos autocompletados, borrador y botones.
- Build EXIT=0 · 4.338 KB · VC 65 / 0.9.50 · `apksigner` v2 ✔ v3 ✔.
- SHA-256: `bf2299205e2184bdcb06a671da72ea035e87f7fe6baaf00624e6884d84b1fa58` · 4.437.646 B.
- Entregada en `/storage/emulated/0/Download/FORGE-CORE-STOCK-0.9.50.apk` y `/tmp/opencode/`.

## Sesión 2026-11-01 · APK 0.9.53 (68) — API del SII integrada al registro local

- Commit `1c38b63` (push `b2357bd..1c38b63`).
- **Contrato real** (obtenido del OpenAPI embebido en api.baseapi.cl):
  `POST /api/v1/sii/contribuyente/situacion-tributaria`, cabecera `X-API-Key`,
  cuerpo `{"rut":"12345678-9"}`. Respuesta: nombre, inicioActividades,
  fechaInicioActividades, terminoGiro, empresaMenorTamano,
  obligadoFacturaElectronica, primeraCategoria, monedaExtranjera,
  cumpleObligacionTributaria, actividadesEconomicas[], documentosAutorizados[],
  documentosElectronicos y alertas[] (con `grave`).
- **NativeBridge**: `siiGuardarClave`, `siiEstadoClave`, `siiConsultar`.
  Clave en la configuración del núcleo; consulta en hilo con timeout 15 s/45 s;
  respuesta por `FabriSii.resultado`.
- **UI**: tarjeta «Consulta al SII (opcional)» con clave, RUT, resultado con
  chips y alertas, y «Guardar en el registro».
- **Mapeo** (`ctbMapearSii`): nombre→razón social, primera actividad→giro,
  cumplimiento→situación, fecha→inicio de actividades y la respuesta completa
  en `extra`; entra al historial y a la auditoría como cualquier cambio.
- Sin clave, el módulo funciona 100 % local.
- Build EXIT=0 · 4.340 KB · VC 68 / 0.9.53 · `apksigner` v2 ✔ v3 ✔.
- SHA-256: `1882f300f0aebdede0fc66d213e4b6a059986c2cd63b21b37ce053711539ab65` · 4.466.463 B.
- Entregada en `/storage/emulated/0/Download/FORGE-CORE-STOCK-0.9.53.apk` y `/tmp/opencode/`.

## Sesión 2026-11-01 · APK 0.9.54 (69) — modo demo y guía de claves

- Commit `d9ce3b7` (push `2959fd9..d9ce3b7`).
- **Modo demo**: interruptor Demo/Real. `ctbDemoSii()` genera una respuesta con
  la misma forma que la API (actividades, documentos autorizados y alertas con
  `grave`) sin red ni claves; origen `api-sii-demo`.
- **Ejemplos**: «Cargar ejemplos» inserta 4 fichas (nombres por índice) y
  «Borrar ejemplos» las elimina con borrado lógico.
- **Guía**: tarjeta con 3 pasos y enlaces reales (api.baseapi.cl, docs, clave
  tributaria del SII y Mi SII). Aclara que situación tributaria solo necesita
  API Key y que la ficha completa requiere clave del representante legal.
- Verificado con captura 393×3400: 4 ejemplos, consulta demo y tarjeta de
  resultado con chips y alertas.
- Build EXIT=0 · 4.344 KB · VC 69 / 0.9.54 · `apksigner` v2 ✔ v3 ✔.
- SHA-256: `346ca92c61f1d450ec9a02d19373d69535231ec5e09ab92b31129fc8f1db4744` · 4.470.559 B.
- Entregada en `/storage/emulated/0/Download/FORGE-CORE-STOCK-0.9.54.apk` y `/tmp/opencode/`.

## Sesión 2026-11-01 · APK 0.9.55 (70) — consultas SII automatizadas

- Commit `b003bd8` (push `66da1ea..b003bd8`).
- **«Actualizar todos»**: cola secuencial sobre los RUT guardados (pausa de
  450-500 ms entre cada uno), actualiza y versiona; si un RUT falla, sigue.
- **«Auto cada 7 días»**: al abrir el módulo, si hay clave y pasaron 7 días,
  lanza la cola en segundo plano (`ctb.auto.on` + marca de tiempo).
- **Progreso** visible con RUT en curso y contador.
- **Demo**: el refresco conserva la identidad del ejemplo (busca por nombre en
  `CTB_DEMO_NEGOCIOS`) para no duplicar fichas.
- Arquitectura: JS → `FabrickNative.siiConsultar` (Java, hilo, HTTPS con
  X-API-Key) → `FabriSii.resultado` → núcleo Rust (SQLite con historial y
  auditoría). **Sin Termux ni servidor**.
- Verificado con captura: 4 fichas pasan de 1 a 2 versiones (8 totales).
- Build EXIT=0 · 4.344 KB · VC 70 / 0.9.55 · `apksigner` v2 ✔ v3 ✔.
- SHA-256: `4f81ac665ffd180eca9c8d93234d88f5d68a4cb2fb775b8b14850d825d30b324` · 4.470.559 B.
- Entregada en `/storage/emulated/0/Download/FORGE-CORE-STOCK-0.9.55.apk` y `/tmp/opencode/`.

## Sesión 2026-11-01 · APK 0.9.56 (71) — sesión SII propia (sin terceros)

- Commit `ab34cd6` (push `f900c25..ab34cd6`).
- **Login nativo**: `siiLogin` hace el POST real a
  `zeusr.sii.cl/cgi_AUT2000/CAutInicio.cgi` con rut/dv/rutcntr/clave/code=411
  (el formulario no tiene captcha). Verificado leyendo el HTML del login.
- **Sesión persistente**: CookieManager + serialización de cookies en SQLite
  (`sii.cookies`), restauradas al iniciar. `siiCerrarSesion` las borra.
- **Clave cifrada opcional** con AndroidKeyStore (AES/GCM, llave en el TEE);
  `siiReconectar` permite volver a entrar sin escribirla.
- **Consulta autenticada** `siiGet` (sólo dominios sii.cl, https) con URL
  editable desde la interfaz y parseo tolerante del HTML (RUT, razón social,
  inicio, actividades, estado) + visor del HTML recibido.
- Limitación conocida: varias páginas del SII son apps JS y no se pueden leer
  con un GET simple; por eso la URL es configurable y la API queda como
  alternativa opcional.
- FIX: `android.util.Base64` (no java.util) y try/catch en `siiCerrarSesion`.
- Build EXIT=0 · 4.345 KB · VC 71 / 0.9.56 · `apksigner` v2 ✔ v3 ✔.
- SHA-256: `171a8d14adab3d6230136ac3b84fff77e9c4b59a780dae4c287ae902d0117fae` · 4.474.655 B.
- Entregada en `/storage/emulated/0/Download/FORGE-CORE-STOCK-0.9.56.apk` y `/tmp/opencode/`.

## Sesión 2026-11-01 · APK 0.9.57 (72) — navegador interno para páginas con JS

- Commit `2b601be` (push `6ea452c..2b601be`).
- **WebView oculto** (`siiWebConsultar`): carga la página del SII con las cookies
  de la sesión, espera el render (1,8 s por defecto, hasta 8 s) y extrae
  `document.body.innerText` con `evaluateJavascript`. Todo dentro del APK.
- Siembra cookies de la sesión en `CookieManager` y al terminar las vuelca de
  vuelta al almacén persistente (`sii.cookies`).
- Optimizado: 1×1 px, invisible, imágenes y red de imágenes bloqueadas, UA de
  Chrome móvil; `siiWebCerrar` libera el WebView.
- UI: botón «Leer con navegador interno (JS)»; el resultado indica el método
  (GET simple o navegador interno) y los segundos de render.
- Verificado con captura: página simulada parseada con método «navegador
  interno (2.4 s)» y actividades detectadas.
- Build EXIT=0 · 4.345 KB · VC 72 / 0.9.57 · `apksigner` v2 ✔ v3 ✔.
- SHA-256: `65cce3de18d57fdf5793a39ee3317f06813c9cdea923c9435b528a8d9daa343e` · 4.478.751 B.
- Entregada en `/storage/emulated/0/Download/FORGE-CORE-STOCK-0.9.57.apk` y `/tmp/opencode/`.

## Sesión 2026-11-01 · APK 0.9.58 (73) — F29 oficial, PDF y barra de pago

- Commit `b197425` (push `83a3ea1..b197425`).
- **Formulario**: F29 compacto con códigos de referencia (501/510/537/90),
  remanente anterior y siguiente, TOTAL destacado; mismo HTML para pantalla,
  vista previa y PDF (`impFormularioHtml()`).
- **Vista previa**: hoja con iframe + Descargar PDF + Compartir.
- **Compartir**: `NativeBridge.compartir` (ACTION_SEND), respaldo con
  `navigator.share` y portapapeles.
- **Botones**: declarar (1042-3264), consultar folio (1042-3266), pagar giro
  (pagogiro-ui), comprobante y actualizar; todos con URL oficial verificada.
- **Barra fija** de pago con período, monto y CTA, con blur y safe-area.
- **Inventario robusto**: fallback a `listar` cuando el panel falla.
- FIX: estructura HTML reparada (sección duplicada al insertar barra/modal).
- Build EXIT=0 · 4.346 KB · VC 73 / 0.9.58 · `apksigner` v2 ✔ v3 ✔.
- SHA-256: `b832c89df6ff626c490907dd7d4a28ec7d721fa2ea49fcdd7ea6fbbdb4399e3e` · 4.482.847 B.
- Entregada en `/storage/emulated/0/Download/FORGE-CORE-STOCK-0.9.58.apk` y `/tmp/opencode/`.

## Sesión 2026-11-02 · APK 0.9.59 (74) — inventario (edición/creación) y biometría

- Commit `f863b89` (push `e292e63..f863b89`).
- **Bug de edición**: `invEdGuardar` enviaba `ficha:"{}"`, `stock_minimo:0`,
  `unidad:"unidad"` y `notas:""`, borrando foto/descripción y mínimo en cada
  edición. Ahora se guarda `INV_ED.original` al abrir y se conservan esos campos.
- **Crear producto**: `invPintarScanInfo2` añade «Crear este producto» con el
  código precargado cuando no existe; botón ✕ y ocultado al cambiar de paso.
- **Comparador**: `invRefMercado()` compara sólo precios del mismo orden de
  magnitud; si no hay 2 comparables devuelve `sinComparables` y no inventa %.
- **Márgenes**: selector `#invMproducto` (carga costo/precio) + bloque
  `#invMargenRef` con la referencia de mercado.
- **Huella**: faltaban `USE_FINGERPRINT` y `USE_BIOMETRIC` en el manifiesto.
  Se integra `Biometria.java` (BiometricPrompt API 28+, FingerprintManager 24-27)
  con `bioEstado`/`bioPedir`/`bioCancelar` y «Probar lector de huella».
- Build EXIT=0 · 4.347 KB · VC 74 / 0.9.59 · `apksigner` v2 ✔ v3 ✔.
  Verificado dentro del APK: permisos biométricos y clase `Biometria` en el dex.
- SHA-256: `d3da36d7287ac39d5f1fcf637e7224d2faa60493c13211e7a6ff2eba23c38a75` · 4.491.039 B.
- Entregada en `/storage/emulated/0/Download/FORGE-CORE-STOCK-0.9.59.apk` y `/tmp/opencode/`.

## Sesión 2026-11-02 · Unificación de marca FABRI-CORE → FORGE CORE STOCK

- Commit `b2bfa3c` (push `d673683..b2bfa3c`), 54 archivos.
- El rebrand oficial (`8f23efc`, 29 oct) había quedado **a medio camino**: la APK
  y la web ya decían FORGE CORE STOCK, pero docs, branding, CI y scripts seguían
  con el nombre anterior, y los tests de credencial estaban en rojo por eso.
- **Tests**: `tests/arranque/barcode.js` esperaba `FABRI-CORE` (2 aserciones) →
  bloque 9/9 vuelve a verde. Baterías: arranque 1 fallo preexistente del puente
  (no relacionado con marca), inventario ✔, seguridad 23/23 ✔, ean ✔, boleta ✔,
  diseno ✔.
- **CI (fix real)**: `apk-rust.yml` hacía `ls dist/FABRI-CORE-*.apk` cuando
  `scripts/compilar.sh` ya emite `FORGE-CORE-STOCK-*.apk` → el paso «Resumen y
  hash» fallaba en cada corrida. Artefactos renombrados a `FORGE-CORE-STOCK-apk`
  y `forge-core-stock-lite.apk` (ambos lados: `build-fast.sh` + `apk.yml`).
- **Docs por fuente**: `generar-sitio.py`, `generar-docs.py` y el `spec` se
  editaron y se regeneraron (`docs/index.html`, SCREENS/SCHEMA/ACCEPTANCE);
  7 `.md` a mano. `generar-sitio.py` ganó fallback de logo (el original vive
  fuera del repo, en `/root/video-engine/assets/`).
- **branding/**: guías, `SKILL`, `tokens.json` (`brand`) y `tokens.css` →
  `FORGE CORE STOCK PRO`; el `CHANGELOG` sólo cambió de título.
- **Superficie visible**: wordmark de la imagen social (`scripts/og-nube.py` +
  `web/og.png` regenerado y verificado), títulos del puente Termux (scripts/ y
  `android/assets/`), etiqueta `componente` de `/api/diagnostico`, títulos de
  `diagrams/`, cabeceras de scripts y tests.
- **No tocado, a propósito**: package `cl.fabrick.core`, crate `fabrick-core`,
  dominios `forge-core-stock.vercel.app` / `fabri-api.vercel.app`, rutas
  `fabri_core_*`, repo `thinkfashz/fabri-core`, `rootProject.name`,
  certificado `CN=FABRI-CORE Debug` (rompería instalar encima), nombres de
  respaldo/DB, y los registros históricos (sesiones de STATE.md, entradas del
  CHANGELOG, APKs `0.9.x`).
- Deploy: `vercel --prod` desde `web/`; `og.png` en vivo idéntica a la local.

## Sesión 2026-11-02 · APK 0.9.60 (75) — UI: menú neón, dock flotante e Inicio nuevo

- Commit `53bd551` (push `2c82c11..53bd551`).
- **Menú lateral**: glass (`rgba(18,18,18,.78)` + `blur(20px)`), 85vw, texto
  opaco, iconos SVG reales de `ui-icons.js` (20 glifos Lucide), ítem activo con
  pastilla verde y punto. Borde luminoso `#00FF88` con gradiente cónico rotando
  dentro de un anillo enmascarado; el elemento vive fuera del drawer porque su
  `overflow` lo recortaba. Se descartó `@property` (no anima en esta WebView).
- **Barra inferior**: dock flotante (92%, 72px, radio 28, glass), 5 posiciones,
  pastilla activa, FAB central 56px con degradado y glow; al abrir el menú se
  difumina y se retira (`body.menu-abierto`).
- **Inicio (agente en paralelo)**: portada con fondo SVG animado, chip de estado,
  6 KPIs con contador y tendencias, gráfico de 14 días con las boletas reales
  (`ts` en segundos → `*1000`), salud del inventario, top categorías/margen y
  estados vacíos honestos.
- `navegar()` marca también el ítem activo del menú lateral.
- Verificado con capturas: menú con luz, dock con FAB, Inicio con datos.
- Build EXIT=0 · 4.357 KB · VC 75 / 0.9.60 · `apksigner` v2 ✔ v3 ✔.
  Sin archivos de arnés dentro del APK.
- SHA-256: `16c886a3591f66d0eecd8523af862d6e6362c6b4b4af7873bfdbc3fb78573598` · 4.503.395 B.
- Entregada en `/storage/emulated/0/Download/FORGE-CORE-STOCK-0.9.60.apk` y `/tmp/opencode/`.

## Sesión 2026-11-02 · APK 0.9.61 (76) — inventario premium y marca Forge

- Commit `ea6fada` (push `5c35412..ea6fada`).
- **Marca**: `<span class="in-hero-nombre">FABRI-CORE</span>` → `FORGE CORE STOCK`
  (logo intacto).
- **Tarjetas widget**: halo verde, miniatura con iniciales, precio grande,
  chip de margen, micro-interacción.
- **Escáner**: marco neón con esquinas y láser animado (`.inv-lector-video`).
- **Gauge**: `invPintarGauge()` dibuja un semicírculo SVG con el % de margen
  (verde ≥35, ámbar ≥20, rojo <20) en el paso 4.
- **Paginación**: dock flotante `‹ n/m ›` (`INV._catPagina`), reemplaza el
  botón «Ver más».
- **Catálogo demo**: `INV_DEMO` con 18 productos chilenos y `invDemoCatalogo()`
  (origen "demo", borrables). No se autoinserta.
- **Inputs/botones**: foco verde, primario con degradado.
- Verificado con capturas (tarjetas, gauge 25 %, botones).
- Build EXIT=0 · 4.359 KB · VC 76 / 0.9.61 · `apksigner` v2 ✔ v3 ✔.
- SHA-256: `7f628671df52f9f0706120615d17ed624b69145e9f576209bfc856e5349fb3b6` · 4.507.491 B.
- Entregada en `/storage/emulated/0/Download/FORGE-CORE-STOCK-0.9.61.apk` y `/tmp/opencode/`.

## Sesión 2026-11-02 · APK 0.9.62 (77) — motor DTE y firma de release

- Commit `74a0c55` (push `79736be..74a0c55`). Dos agentes en paralelo (Java y Rust).
- **Rust**: `dte_documentos`, `dte_caf`, `dte_eventos` + `op_dte` con 9 acciones
  (guardar upsert, registrar_caf, siguiente_folio transaccional, listar, estado,
  marcar, caf_listar, resumen, borrar). 683 líneas, solo inserciones.
- **Java**: `Dte.java` (53 KB) → PKCS12, CAF (XXE bloqueado), XML DTE, firma
  RSA-SHA1 del documento y del TED, Base64 propia.
- **Puente**: `dteEstado`, `dteCertificado`, `dteCaf`, `dteEmitir` (hilo +
  `FabriDte.documento`), `dteFirmar`.
- **UI**: módulo «Boletas electrónicas» con certificado en memoria, CAF, emisión
  y lista de documentos.
- **Firma**: keystore release 4096 bits en `~/.config/opencode/secrets/`,
  `scripts/firma-release.sh`, `compilar.sh` con `FORGE_FIRMA=release` (por
  defecto depuración para no romper updates).
- Verificado dentro del APK: clase `Dte`, `dteEmitir`, `certificadoInfo` y las
  tablas DTE en el .so. Build EXIT=0 · 4.434 KB · VC 77.
- SHA-256: `e33e32661dad8c45b5498c3c76171a22011489d856475358326519c7bf1a959a` · 4.540.386 B.
- Entregada en `/storage/emulated/0/Download/FORGE-CORE-STOCK-0.9.62.apk` y `/tmp/opencode/`.
- Pendiente real: certificado del contribuyente, CAF autorizado, certificación
  SII y PDF417 del TED.

## Sesión 2026-11-02 · landing de promoción (web) — commit `a26b43e`

- `web/index.html`: barra glass con logo centrado (CTA izquierda, enlaces en
  escritorio, hamburguesa en móvil), menú lateral translúcido con anillo de luz
  animado y bloque de versiones.
- Secciones nuevas `#beneficios` (6) y `#modulos` (8) + `#descargar` con QR
  vectorial (`qr-descarga.svg`, generado con segno) a las releases de GitHub.
- Iconos Lucide incrustados (sin CDN) en pastillas tipo iOS; barrido de luz en
  el borde de cada sección, destello en tarjetas y barra de progreso.
- Aparición con tres redes: pase inicial en viewport, IntersectionObserver y
  barrido por scroll con temporizador de 2,5 s (nunca queda contenido oculto).
- Arreglos: `section{padding:… 0}` anulaba el padding de `.wrap`; punto final
  del titular suelto en otra línea; `<nav>` interno heredaba el sticky del nav.
- Desplegado en producción: `https://forge-core-stock.vercel.app` (READY,
  verificado en vivo) y push a `master`.

## Sesión 2026-11-02 · landing 2.1 (paleta lima/oro, APK directa, SEO) — `654e333`

- Paleta: lima `#C8FF00`, oro/crema `#E8C87A`, negro `#050604`. Ambiente con
  focos en las esquinas (el halo ya no tiñe toda la página) y texto en crema.
- APK servida desde `web/descargas/FORGE-CORE-STOCK.apk` (4,5 MB, 0.9.62).
  `.gitignore` tiene `*.apk`, así que se añadió la excepción `web/descargas/*.apk`.
  Vercel la entrega con `Content-Type: application/vnd.android.package-archive`
  y `Content-Disposition: attachment`; verificado con `curl -I` (200, 4.540.386 B).
- Los 7 enlaces de descarga y el QR apuntan al archivo (antes a GitHub Releases).
- SEO: `lang="es-CL"`, title/description con intención de búsqueda, keywords,
  canonical, hreflang, robots/googlebot/bingbot, Open Graph y Twitter completos,
  JSON-LD `@graph` (WebSite, Organization, SoftwareApplication, FAQPage con 4
  preguntas), `robots.txt` y `sitemap.xml` (4 URLs). `og.png` regenerada
  1200x630 con la paleta nueva.
- Pendiente de indexación: enviar `sitemap.xml` en Search Console / Bing Webmaster.

## Sesión 2026-11-02 · MercadoPlacer en `/app/#panel` — commits `b023fba`, `c495f34`, `3e7b09d`

- La entrada de la consola pasa a ser **MercadoPlacer**: mapa Leaflet 1.9.4
  vendorizado con teselas OSM oscurecidas por CSS y satélite de Esri, pines
  agrupados por celda, halo en vivo de la posición y lista ordenada por
  distancia con filtros por rubro y radio (500 m → 5 km).
- **Ubicación real**: `getCurrentPosition` + `watchPosition`; si se niega el
  permiso cae a Santiago centro y lo dice en pantalla.
- **Datos**: nuevo `/api/mercados` (Go). Overpass y **Nominatim** corren en
  paralelo, gana la primera fuente con datos y se suma la otra en 1,2 s.
  Carrera de 4 espejos de Overpass, `unir()` descarta duplicados por nombre +
  60 m, caché de 5 min y `s-maxage=300`. Medido: 6,4 s en frío, 0,45 s en caché,
  41 mercados reales en Santiago centro.
- **Catálogo**: al tocar un local se abre su ficha con productos por rubro,
  precios CLP referenciales (rotulados «referencial»), carrito por local en
  `localStorage`, total y pedido por WhatsApp / compartir, más «Abrir ruta».
- El panel técnico anterior sigue intacto en `#s-nucleo` (menú «Panel», dentro
  de «más» en móvil). Tema por defecto pasa a **lima**.
- Service worker **v10** con Leaflet y los archivos nuevos.
- Limitación real: las instancias de Overpass se saturan (502) y kumi/private
  coffee solo resuelven por IPv6 (agujero negro en esta red). Por eso Nominatim
  es la fuente que responde; si ambas fallan se muestran locales de referencia
  marcados como «muestra».

## Sesión 2026-11-02 · MercadoPlacer 2.0 (catálogo + mapa) — `54ba054`

- **Catálogo**: categoría por palabra clave, formato (kg/L/u), precio de lista y
  ~20 % de productos con oferta determinista (precio tachado + %), buscador
  interno, chips por categoría con conteo y orden por precio. Tarjeta con
  pastilla de color por rubro y contador.
- **Pedido**: hoja «Mi pedido» con cliente (nombre, teléfono), retiro/delivery,
  nota, grupos por local con subtotales y total; el carrito guarda nombre e
  ícono del local para sobrevivir a una recarga. Botón con contador en la
  cabecera. El mensaje de WhatsApp lleva cliente, entrega, nota y total.
- **Mapa**: círculo del radio, pin activo resaltado, fallback entre dos
  proveedores de teselas, mensaje si ninguna carga (o si falta Leaflet offline),
  memoria de la última ubicación y GPS apagado en segundo plano.
- Service worker **v11**. Verificado en producción: `/api/mercados` 41 locales
  (6,5 s en frío, luego caché) y `placer.js` 55 KB servido.

## Sesión 2026-11-02 · MercadoPlacer 3.0 (GPS real + búsqueda) — `4b5f780`..`01ae7fb`

- **GPS vs centro de búsqueda**: `ESTADO.yo` es la lectura real y `ESTADO.pos`
  el centro que se está mirando. Buscar una dirección ya no pisa el punto azul,
  y el GPS no arrastra el mapa si el usuario está mirando otra comuna.
- **Siempre se pide GPS**, incluso si hay ubicación recordada en localStorage
  (antes se abría con la de ayer y nunca se consultaba). El punto «estás aquí»
  solo se dibuja con lectura real; ni la recordada ni el respaldo lo fingen.
- **Buscador de direcciones**: nuevo `/api/lugares` (Nominatim con proxy,
  caché 10 min, turnos de 1,1 s, sesgo por proximidad, `countrycodes=cl`) y
  fallback directo del cliente. Al elegir una sugerencia el mapa vuela ahí,
  recarga mercados y muestra un anillo de objetivo distinto del punto propio.
  Botón «Volver a mi ubicación» y chip «lugar buscado».
- **Permiso bloqueado**: mensaje con instrucciones (candado de la barra) y la
  búsqueda como salida, en vez de un «sin ubicación» mudo.
- Botón de ubicación con estados (girando / activo), escala en el mapa y el
  círculo del radio sigue al centro de búsqueda (antes se iba al GPS).
- Verificado en producción: `/api/lugares?q=Providencia 1234` → 200 en 2,1 s
  con nombre y dirección; `placer.js` 63 KB servido.

## Sesión 2026-11-03 · GPS desbloqueado + rediseño neon-lime — `0a4cd63`, `433652c`

- **CAUSA RAÍZ del «GPS bloqueado»**: `vercel.json` enviaba
  `Permissions-Policy: geolocation=()`, o sea el propio sitio le prohibía al
  navegador entregar la ubicación. Se veía como permiso denegado aunque el
  teléfono lo tuviera dado. Corregido a `geolocation=(self), camera=(self)`.
  Verificado con `curl -I`: la cabecera ya sale bien en producción.
- **GPS con diagnóstico**: se consulta `navigator.permissions` antes de pedir
  la posición y el mensaje distingue bloqueado / sin señal / sin API /
  sin HTTPS. Si falla por señal (códigos 2 y 3) se reintenta con precisión de
  red antes de rendirse.
- **Zona por red**: sin GPS se ubica la ciudad con geojs.io (y ipwho.is de
  respaldo, sin clave) y el mapa arranca ahí, rotulado «aprox. por red»; nunca
  se dibuja como posición exacta.
- **Rediseño** con el sistema Fabrick (neon lime): fondo #08090A, superficies
  #101215/#171A1E, un acento lima y el dinero en oro, radios 10-24, sombras en
  capas. Marco del mapa con halo e inclinación de 1,6° en escritorio.
- Arreglos: tokens movidos a `:root` (las hojas viven fuera de `.mp` y perdían
  las variables), aviso de ubicación fuera del mapa, inputs con
  `width:0 + flex:1` (el placeholder empujaba el segundo campo fuera de la
  hoja), service worker v13.

## Sesión 2026-11-03 · MercadoPlacer 4 (mapa completo, 3D, QR y pago) — `bc14500`

- **Mapa a pantalla completa** con HUD flotante; vista **3D** (inclinación +
  escala + horizonte con bruma) que se apaga con el botón 3D; calles/satélite
  pasan a un botón lateral. Carrusel horizontal de mercados.
- **Catálogo en dos columnas** con portada de color por categoría, formato,
  stock, precio, descuento y contador; buscador y chips dentro de la ficha.
- **Escáner QR** con `window.Scan` (BarcodeDetector/ZXing): busca el código en
  la tabla `products` del inventario propio; si no está, agrega el producto de
  referencia del rubro y lo advierte.
- **Barra inferior** con total y «Ir al carrito»; el carrito agrupa por local.
- **Pago**: entrega retiro/delivery (envío $1.990), tarjeta con Luhn +
  vencimiento + CVV, o transferencia con datos; simulación con pantalla de
  aprobado, código de pedido y confirmación por WhatsApp.
- Arreglos: coma en vez de llaves abría el pago solo; el snapshot de la tienda
  evita que la confirmación se cierre al vaciar el carrito; `montar()` ya no
  queda marcado como hecho si falla. SW v14.

## Sesión 2026-11-03 · Identidad de la APK en la web, dock iOS, canvas y pago — `5ceaa0e`

- **Marca real**: se copian `android/assets/www/logo-f.svg` y `logo-loader.svg`
  a `web/app/icons/` y se usan en topbar, login y cargador (anillo + latido).
  Paleta idéntica a la APK v2.4.1: `#050505`, `#0B0B0B`, acento `#C8FF00`,
  textos `#FFFFFF/#C9C9C9/#8A8A8A`. Tema por defecto «FORGE».
- **Dock iOS**: barra flotante de vidrio (radio 26, blur 26, borde capilar) en
  móvil; rail intacto en escritorio. Iconos rellenos estilo SF Symbols.
- **Canvas del mapa**: radio punteado, anillos de radar y líneas a los 6 locales
  más cercanos a ~24 fps; zoom propio (+/−) y `flyTo` al GPS.
- **Logos**: cadenas conocidas (Tottus, Líder, Santa Isabel, Unimarc, Jumbo…)
  con el icono público de su dominio y la pastilla de categoría de respaldo.
- **Pago**: datos del cliente dentro del pago, marca de tarjeta detectada,
  validación por marca, errores en línea y foco en el primer campo con problema.
- Service worker v15.

## Cómo conectar la APK a la nube (referencia)

- URL: `https://fabri-api.vercel.app` · se guarda en `fabrick.nube.url`.
- Token: `fabrick.nube.token` (Bearer) = `FABRI_API_TOKEN` de Vercel (fabri-api).
- Endpoint: `POST /api/inventario` con `accion: subir | subir_boletas | buscar |
  listar | resumen`.
- En la app: Inventario → «Mi nube», o Integración → Nube.

## Sesión 2026-11-03 · Panel de negocio, pedidos y portada — `21616d2`

- **Panel de negocio** (`#s-negocio`): KPIs del día (ventas, por entregar,
  ticket promedio, productos), pedidos de MercadoPlacer con estado y acciones,
  y catálogo real desde `products` con alta rápida.
- **Pedidos persistentes**: `pagar()` guarda en `fcore.placer.pedidos` (código,
  ítems, cliente, medio, entrega, estado) y el panel se refresca solo; historial
  limitado a 300.
- **Dock**: «Memoria» al grupo «más» para que las etiquetas no se corten; más
  aire inferior en `main` para que el dock flotante no tape la última tarjeta.
- **Portada**: sección MercadoPlacer con vista de mapa, 4 capacidades y CTA a
  `/app/#panel`; enlaces en la barra, el menú lateral y el CTA principal.
- Service worker v17.

## Sesión 2026-11-03 · Mapa ordenado, clima y fichas 2.0 — `1a3b052`

- **HUD compacto**: dos filas (buscador + «Filtros»; estado con ubicación,
  fuente y clima). Radio y rubros pasan a un panel plegable. El mapa gana
  ~130 px de alto útil en un teléfono de 844.
- **Columna derecha** con zoom, ubicar, carrito y menú «⋯» (escáner,
  calles/satélite, 3D, «Modo mapa» que esconde todo el chrome).
- **3D apagado por defecto**; la textura pasó de scanlines a retícula de
  puntos y halos.
- **Ficha de local 2.0**: descripción por rubro, dirección/horario, acciones
  (ruta, llamar, sitio) y cifras de productos, categorías y ofertas.
- **Clima** con Open-Meteo (sin clave) en un chip del estado, con icono propio.
- **Vuelo al carrito** al agregar un producto.
- Service worker v18.

## Sesión 2026-11-03 · Mercado FORGE (tarjetas, EAN-13, metadatos) — `fc1c3f8`

- **#mercado rediseñado**: tarjetas con portada por categoría, inicial grande,
  stock (ámbar si queda poco), nombre a dos líneas, descripción, código y
  clasificación, precio en oro y contador − n + en la propia tarjeta.
- **Buscador por código**, chips de categoría/clasificación y precio máximo;
  barra inferior con total y acceso al mapa.
- **Ficha del producto**: descripción, tres cifras, **EAN-13 real en SVG**
  (95 módulos, prefijo 780 de Chile, dígito verificador) y barra de cantidad.
- **Marca y metadatos**: `logo-f.svg` como favicon del sitio y de la app, icono
  del manifest, `logo` de la organización en JSON-LD y entidad `Store`
  (MercadoPlacer) con `OfferCatalog`, CLP, medios de pago y área Chile; en la
  app `WebApplication` + `Store` enlazados.
- Service worker v19.

## Sesión 2026-11-03 · Minimarket con estantes — `229ca60`

- **#mercado** gana dos vistas: **Estantes** (por defecto) y **Lista**.
- **Pasillos**: scroll horizontal con snap, flechas, puntos y cabecera
  «Pasillo N de M» con categoría y detalle.
- **Estantes de 4 filas**: cada pasillo agrupa hasta 16 productos mezclando
  categorías cuando hace falta, para que no queden estantes vacíos.
- **Cajas**: tapa, inicial, nombre, precio y stock; los productos con más stock
  ocupan más frentes (copias sin texto), como en un supermercado.
- La fila es una tabla con canto, sombra y guía lima; los filtros secundarios
  se pliegan en la vista de estantes.
- **Licencia**: la inspiración del proyecto halcyon-video es conceptual; es
  GPL-3.0 y **no se copió código**. Implementación propia en CSS 3D sin WebGL.
- Service worker v20.

## Sesión 2026-11-03 · Tienda 3D caminable — `8b438cd`

- Nueva pantalla `#s-tienda` con **three.js r149 (MIT, vendorizado)** cargado
  sólo al entrar: sala 12×18, 3 góndolas de 4 niveles, piso con textura de
  canvas, tiras de luz, carteles y ~600 productos en un `InstancedMesh`.
- **Cámara en primera persona**: joystick táctil, arrastre para mirar, WASD y
  flechas, balanceo al caminar, colisiones AABB y niebla; sin sombras y DPR 1.25.
- Tocar un producto hace raycast y abre la ficha con EAN-13 y cantidad.
- Si no hay WebGL: mensaje claro y botón «Ver los estantes» (no pantalla blanca).
- **No se copió código de halcyon-video** (GPL-3.0): implementación propia.
- Service worker v21.
- Pendiente: **verificar en un teléfono real**. El navegador headless de esta
  máquina no puede crear contexto WebGL (el proceso GPU muere), así que la
  escena no se pudo capturar; sólo se validó el camino de error.

## Sesión 2026-11-03 · Dock con pastilla, buscador con escáner, carrito y riel — `23d94c3`

- **Dock**: pastilla deslizante que sigue al ítem activo (280 ms) en móvil y en
  el rail de escritorio; los botones ya no pintan su propio fondo.
- **Buscador del mercado**: lupa, botón de borrar y **escáner integrado**; al
  leer un EAN-13 abre la ficha del producto o filtra por el código.
- **Carrito**: hoja «Tu pedido» con líneas, contador, subtotal, total, pedido
  por WhatsApp/compartir y vaciar.
- **Estantes**: cartel de pasillo con número y categoría, riel dorado en el
  canto y etiqueta de precio bajo cada caja.
- Service worker v22.

## Sesión 2026-11-03 · Tienda 3D luminosa + pancarta de precio — `d6326f8`, `343e5f2`

- **Local claro**: paredes y piso blancos, zócalos, techo con paneles de luz,
  piso con especular y niebla clara; iluminación con ambiente alta, hemisférica,
  direccional con **sombras PCF** y puntos cálidos.
- **Góndolas por categoría** con cartel colgante, riel dorado y productos de
  tamaño variable; **TV colgada** con ofertas rotativas (textura canvas, 4 s) que
  se agregan al tocarla.
- **Congeladores** con puerta de vidrio translúcida que **se corre con el dedo**
  (arrastre horizontal sobre el cristal).
- Los productos se **agregan al carrito al tocarlos**, con aviso flotante.
- **Pancarta de precio** translúcida arriba a la izquierda que sigue a la **mira
  central** (raycast 5/s contra productos y TV) con categoría, nombre, precio,
  stock y acción.
- Service worker v24.
- Pendiente: verificación visual en un teléfono real (el headless de esta
  máquina no crea contexto WebGL).

## Sesión 2026-11-03 · Tienda 3D: luz corregida y doble stick — `86d5f95`

- **La escena salía quemada** (todo blanco): las luces sumaban ~3.0. Se baja a
  ambiente 0.32 + hemisférica 0.42 + direccional 0.62 + puntos 0.22 y se activa
  **ACES filmic tone mapping** (exposición 1.05).
- Fondo/paredes/techo/piso pasan de blanco puro a perla y las góndolas a gris
  medio: el pasillo se lee contra el piso.
- **Segundo joystick a la derecha** para mirar; el izquierdo camina.
- La pancarta de precio aparece **al apuntar de cerca (<6,5 m)** o al tocar, y
  se oculta a los 2,6 s. La TV ya no dispara la pancarta desde lejos.
- Etiquetas de góndola (2D) más chicas: crema con número oscuro.
- Service worker v25.
- Confirmado por el usuario: **la tienda 3D renderiza en su teléfono**.

## Sesión 2026-11-03 · Tienda 3D: TV en esquina, CCTV, luz y controles — `ec61cfe`, `5906691`

- **TV en la esquina** del fondo con brazo y placa metálica (antes estorbaba en
  el pasillo). **Cámaras CCTV** pequeñas en tres esquinas (la del TV libre).
- **Panel de cámaras**: 4 vistas en vivo en el mismo canvas (scissor+viewport
  2×2), etiquetas CAM 1–4 alineadas a los viewports.
- **Pasillo de congeladores** contra la pared izquierda (4 muebles, puerta
  corrediza, colisión `x < -5,25`).
- **Menú de iluminación**: presets Cálido/Neutro/Frío/**Cine** (cinematográfico),
  slider de intensidad (40–140 %) y de **órbita** (0–360°) con línea explicativa.
- **Controles**: sticks de 124 px con zona de agarre expandida, zona muerta 15 %,
  suavizado por cuadro, velocidad 3,0 m/s y **botón «Correr»** (mantener, o Shift)
  a 4,8 m/s; cámara más sensible.
- **Carrito 3D** que camina un metro al frente, frena ante muebles, gira suave,
  ruedas que giran y salto al agregar producto.
- **Tiras de precios** en el filo de cada estante (4 niveles × 2 lados) y en el
  canto de los congeladores: crema, borde lima, nombre + precio grande.
- Pancarta de precio solo al apuntar/tocar (v25) y mira central.
- Service worker **v27**.

## Sesión 2026-11-04 · Tienda 3D: 6 pasillos, congeladores al fondo, CCTV full — `e46d249`

- **Tienda de 14 a 18 m** con **6 góndolas** (pasillo interior 1,2 m).
- **Congeladores**: fila de 7 en la pared del fondo con bebidas/yogures
  (botellas y vasitos) y tira de precios propia; colisión `z < -8,5`.
  Se liberó la pared izquierda (antes el pasillo de congeladores era
  inacaminable por la colisión `x < -5,25` + bloque de la góndola 1).
- **Tiras de precio**: el texto salía estirado porque el lienzo era 16:1 y el
  tablero 63:1. Ahora lienzo 4096×128 sobre tablero de 0,27 m (proporción
  igual), precio 34 px y anisotropía 8.
- **Cámaras a pantalla completa**: 4 cuadrantes + barra con ← volver +
  barrido lento de vigilancia; al entrar se apaga todo lo demás.
- **Tirita lateral** (oculta/muestra HUD, Luz, Cámaras, Correr) y **pancita «?»**
  que explica el menú.
- **Luz de arranque más suave**: amb 0,24 / hemi 0,28 / dir 0,50 / puntos 0,14,
  exposición 0,92; presets recalibrados.
- **Carrito a 1,5 m** → se ve solo la mitad de arriba (primera persona).
- Pancarta de precio: 164 px y fondo 82 % (no tapa la vista).
- Service worker **v28**.

## Sesión 2026-11-04 · Mercado: segunda pasada de diseño — `4dcc3bc`

- **Tarjeta de producto**: caja 3D (tapa + letra + glow de la categoría) en
  el media, **precio héroe** en oro abajo a la izquierda, descripción de
  3 líneas, botón ancho "Agregar al pedido" o stepper "N en el pedido".
- **Filas del carrito**: cabecera nombre + subtotal, descripción 2 líneas,
  "$c/u", stepper y botón ✕ quitar.
- **Sumador `.mp-resumen`**: subtotal, unidades · productos · envío se
  coordina, **Total en oro a 25 px** y nota "Pedido de referencia · el
  comercio confirma stock y entrega". El total se anima con
  `animarNumero()` (420 ms, count-up) — también en la barra flotante.
- **Ficha**: precio héroe en la imagen + sumador `n × precio = subtotal`.
- Validado: `node --check mercado.js`, HTML balanceado, smoke headless
  (`BARRA=$0 ANIM=ok ERR=ninguno`); diagnósticos borrados antes del commit.
- Service worker **v29**.

## Sesión 2026-11-04 · Tienda 3D: iluminación profesional + neveras — `be0de5e`

- **Iluminación de 3 puntos**: key cálida con sombra suave (PCFSoft,
  `normalBias`), relleno frío y **contra-luz lima**. Muros **negros
  FORGE** con franja lima, techo oscuro con paneles cálidos, piso
  luminoso → local cálido y confortable.
- **Panel "Escena"** organizado en secciones: Ambiente (6 presets),
  Luz (intensidad, **temperatura 2.700–6.500 K**, órbita, **sombra**),
  Cámara (sensibilidad + volver a la entrada) y **Calidad**
  (Auto/Alta/Media/Baja con fps en vivo). Se guarda en
  `fcore.tienda3d.calidad` y `fcore.tienda3d.sens`.
- **Calidad automática**: `detectarPerfil()` lee `deviceMemory`,
  `hardwareConcurrency` y `WEBGL_debug_renderer_info` → píxeles 1,0–1,45,
  sombra 512–2048, puntos de techo on/off.
- **Neveras**: de 1,9 a **2,45 m**, carcasa hueca (antes era un bloque
  sólido que escondía el interior), **vidrio traslúcido** con brillo,
  **4 estantes con gama distinta** (congelados, helados, bebidas/yogures,
  postres), 12 productos por estante instanciados, **tira de precios por
  estante** detrás del vidrio, LED de techo, franja lima y **sombra de
  contacto** en el piso. Dos puertas corredizas por nevera (14).
- **Estantes**: un rótulo distinto por nivel (lienzo 2048×64 con la
  proporción exacta del tablero) y los productos alineados con su
  rótulo; filo de repisa en lima; productos con sombra.
- **Bug encontrado en la prueba**: con catálogo vacío el código viejo
  leía `undefined.nombre` y ni siquiera renderizaba (FRAMES=0). Ya tiene
  respaldo.
- Validación: `node --check`, HTML balanceado, cruce de 40 ids JS↔HTML,
  smoke DOM (6 presets, 4 calidades, 0 errores). **WebGL no verificable
  aquí**: SwiftShader en este entorno pinta en blanco y pierde el
  contexto — queda para el teléfono del usuario.
- Service worker **v30**.

## Sesión 2026-11-04 · Tienda 3D: controles sin desvío + logo centrado — `fa6e763`

- **Bug del "desvío" al girar**: el stick izquierdo sumaba `joyS.x` a
  `giro` además del stick derecho → **dos fuentes de rotación** peleando.
  Ahora el izquierdo solo mueve (relativo a cámara + strafe) y el
  derecho solo mira.
- **Lag del giro**: suavizado lineal `dt*11` (llegaba tarde y seguía
  girando al soltar) → exponencial `1 - e^(-dt·20)` en la mirada y
  `·9` en el paso, independiente del frame.
- **Driver del stick**: bandera `activo` + `setPointerCapture` en vez de
  `e.buttons` (en móvil llega en 0 → el stick se cortaba), zona muerta
  con rampa (0,12 sin salto) y curva `^1,35` (fino al centro, tope al
  borde); la perilla sigue al dedo.
- **Inercia del cuerpo**: velocidad objetivo con exponencial (arranca y
  frena suave), normalizada en diagonal. Reales: **caminar 1,6 ·
  correr 3,2 m/s** (antes 3,0 / 4,8).
- **Primera persona**: ojos **1,66 m**, **FOV 68** (antes 72), balanceo
  proporcional a la velocidad (vertical + lateral + roll de 0,006 rad)
  y +5° de FOV al correr con transición.
- **Rendimiento**: fuera `preserveDrawingBuffer`; `antialias` solo en
  perfil "alta".
- **Navbar oculta en la tienda**: `body.en-tienda` (añadido en
  `abrir()`, quitado en `cerrar()`) → `.nav` y `.topbar` ocultos,
  `main{padding:0}` y `.t3d{height:100dvh}`. En el centro superior
  queda **solo el logo** (`.t3d-marca` con `icons/logo-f.svg` exacto).
- **Viñeta cálida** (`.t3d-vineta`, radial-gradient, `pointer-events:none`).
- Teclado: **WASD mueve** (como el stick izq.) y **← → giran** (antes
  A/D giraban).
- Validación: `node --check`, HTML balanceado, cruce 40 ids, smoke DOM
  (`MARCA=si VINETA=si AYUDA=7 ERR=ninguno`) y ciclo navbar
  (`DENTRO=true NAV_OC=true TOP_OC=true FUERA=true NAV_VUELVE=true`).
- Service worker **v31**.

## Sesión 2026-11-04 · Tienda 3D: letreros, muros/techo, TV HD y texturas CC0 — `e285fd9`

- **Letreros de pasillo** (nuevo `texturaCartel(texto, nro)`): lienzo
  1024×256, fondo degradado oscuro, franjas lima, cuadro lima con el
  número, categoría blanca auto-ajustada, sub-label `PASILLO n · OFERTAS`
  y chevrona. Se cuelgan en **los dos extremos** de cada góndola
  (`z = ±(G_LARGO/2 + 1)`), con dos varillas de 0,026 m hasta el techo.
  El `+1` (y no `+0,5`) es a propósito: en `z = ±5` viven las carcasas de
  luz y las varillas las atravesaban.
- **Muros y wordmark**: cada plano tiene su propio `MeshLambert` clonado
  (`refs.muro` con rep `largo/3.4`) para llevar su textura; en el muro del
  fondo, plano 6×1,5 con `texturaMarca()` — **FORGE** lima, línea y CORE
  STOCK blanco, en `(0, 1.85, LARGO/2 − 0.02)` bajo la franja (2.66). El
  logo (la F) no se toca.
- **Techo**: carcasas `1.26×0.12×0.5` (`0x1b1f23`) en `ALTO−0.06` con la
  placa luminosa debajo en `ALTO−0.125` (antes a `ALTO−0.01`, dentro de la
  carcasa), y **5 vigas** `ANCHO×0.16×0.3` en `z = −8,−4,0,4,8`
  (`ALTO−0.08`), sin choccar con los luminarios de `z = ±5, ±1,7`.
- **TV 1280×720** (antes 640×360, plano 2.0×1.125): degradado, franja
  lima, punto "EN VIVO" + `FORGE · OFERTA DEL DÍA` + reloj `HH:MM`,
  chip de categoría, nombre auto-fit 96→44 px, precio lima 150 px + `c/u`,
  barra de promo (`promoT0`/4000), CTA, ticker de avisos legales,
  scanlines cada 4 px y brillo diagonal. Guard de "sin promos" →
  standby `SIN OFERTAS`. `siguientePromo()` unifica intervalo y toque;
  `tvReloj` (1 s) se limpia en `cerrar()`. **`luzTV`** PointLight
  `0xd9ffa8` en `(−8.04, 2.4, −7.02)`, modulada en `aplicarLuz()`
  (×1.45 en preset Cine).
- **Estantes ordenados**: `if (c % 7 === 6) continue;` → bloques de 6 con
  un hueco de fila cada 7 (24 de 28 casillas por fila; la capacidad del
  `InstancedMesh` no cambia).
- **Muros separados de estantes**: `GONDOLAS = [−7.1, −4.26, −1.42, 1.42,
  4.26, 7.1]` → **1,78 m de pasillo** y **1,37 m al muro lateral** (antes
  0,82 m: con el margen de colisión de 0,4 el perímetro era
  impracticable). La colisión (`choca`) usa `GONDOLAS`, así que se
  actualiza sola.
- **Texturas HD CC0** (3 MB, `web/app/texturas/`): piso `floor_tiles_08`,
  muro `white_plaster_02`, techo `concrete_wall_001` (Poly Haven) y metal
  `Metal006` (ambientCG), 1k diffuse + normal. `aplicarTexturasHD()` las
  clona por material con su repetición, `encoding` sRGB en el diffuse,
  anisotropía `min(8, max)` y **fallback silencioso** a la textura de
  canvas si algo falla. Repeticiones: piso `[10,11]` (nor 0.65), techo
  `[3,3.3]` (0.5), metal góndola `[2,2]` (0.4), marco/repisa neveras
  `[1.5,1.5]` (0.5), malla carrito `[1,1]`. Créditos en
  `texturas/CREDITS.md`.
- Diagnóstico: `__t3d()` ahora expone **`texHD`** (materiales con mapa:
  11 esperados).
- Validación: `node --check` (JS y sw), HTML balanceado, cruce **40 ids**,
  smoke DOM (`HIJOS=81 TV=si PUERTAS=14 TEX200=8/8 TEXHD=11/11
  CERRADO=si ERR=ninguno`) y captura de revisión de letrero/wordmark/TV.
  `HIJOS=81` = 58 + 16 carcasas + 5 vigas + wordmark + luz del TV.
- Service worker **v32** (precacha las 8 texturas). Deploy `EXIT=0`
  verificado en vivo: `tienda3d.js` 71003 B, `fcore-v32`, texturas 200.
- **Pendiente**: pedir capturas al usuario (letreros, muros/techo, TV,
  orden de estantes y pasillo a 1,37 m del muro) para ajustar.

## Sesión 2026-11-04 · Tienda 3D v33: portadas, ficha con EAN y carrito mapa→visor — `fc08bf2`

- **Portadas propias** (`dibuPortada`/`texturaPortada`): lienzo con
  gradiente del tinte de marca, banda `CORE STOCK` (el wordmark en texto;
  la F no se toca), pictograma sobre disco y placa inferior con categoría
  en lima y nombre auto-ajustado a 2 líneas. **Pictograma por categoría**:
  `equipo` (terminal), `audio` (parlante), `rollo` (etiquetas), `candado`
  (vitrina), `cable` (cargador) y los formatos de supermercado de antes
  (botella/bolsa/lata/tubo/pan). Antes los 12 productos del catálogo caían
  todos en `caja`.
- **Un producto por nivel de góndola** (planograma real): 24 `InstancedMesh`
  (6 góndolas × 4 niveles) con su `userData.mapa` y portada 256²; tira de
  precio de un solo producto en grande (`texturaTira([p], 3072, 96)`).
- **Neveras con portada**: caja/bolsa por nivel (título Cocina/Helados/
  Bebidas/Postres) con `matCajaCong` compartido; los cilindros conservan
  color. Items sintéticos `cong-{nevera}-{k}` en `userData.mapa` (28 mallas).
- **Ficha al tocar** (`#t3dFicha`): portada canvas, chip de categoría,
  nombre, precio CLP, stock, **EAN-13** (`Mercado.codigoDe`/`ean13Svg`) en
  píldora blanca y botón **Añadir al carrito**; al añadir, caja con la
  portada vuela al carrito (0,6 s, arco + giro). TV mantiene toque directo.
- **Iluminación**: 6 `PointLight` en `x ∈ {−6,0,6}, z ∈ ±3,35` (base 0,36)
  sobre los halos; halo radial aditivo + cono α 0,045 bajo cada uno de los
  16 luminarios. `toneMapping` ACES y exposición 0,92.
- **Legibilidad**: `texturaCartel` a 1536×384 con `setTransform(1.5)`
  (sub-label 26→30); `sRGBEncoding` + anisotropía máxima en marca, tiras y
  portadas. Texturas HD cacheadas por repetición → 5 pares, 8 materiales
  con mapa (`texHD`), para no inflar la RAM.
- **Controles**: umbral de toque 8→10 px; `pointercancel`/
  `lostpointercapture` limpian `mirar`/`puerta`; toque sobre el vidrio
  (`puerta.movido < 10`) atraviesa e interactúa.
- **Mapa → visor**: `#mpVerTienda` en la hoja del local llama
  `Tienda3D.ponerTienda(productos(m), m)` y `Fabri.go("tienda")`; `abrir()`
  reconstruye solo si cambió el catálogo (`destruirEscena` + `construir`).
  "Atrás" devuelve al mapa si se vino del mapa, si no al marketplace.
- **Carrito compartido**: `mercado.js` guarda productos de fuera del
  catálogo en `fcore.mercado.extra` y los totaliza con `buscar()`.
- **Bugs encontrados en la prueba y corregidos**:
  1. El contador del carrito no subía al añadir desde el 3D: `Mercado.agregar`
     llamaba a `filtrados()`, que hacía `datos.productos` con `datos = null`
     cuando la vista de Mercado aún no había corrido `render()` → `TypeError`
     que abortaba antes de `actualizarContador()`. Ahora hay `catalogo()`
     con respaldo `SEED` en todas las consultas y `agregar()` del visor
     envuelve la llamada en `try/catch`.
  2. El primer añadido desde el 3D podía pisar el carrito guardado:
     `carrito` en memoria arrancaba vacío. Ahora `hidratar()` lee
     `localStorage` la primera vez (`cambiar`, `total`, `unidades`, `lineas`).
- Validación: `node --check` (5 JS), smoke DOM con hook de `console.error`
  → `cnt 0→1→2`, `carrito {"eq-001":1,"loc#0":1}`, rebuild del local
  (`nom2:"Pan integral"`), sin errores propios; galería 2D de las 12
  portadas revisada (pictogramas por categoría, nombres a 1–2 líneas).
  **WebGL sigue sin verificarse aquí**: SwiftShader pierde el contexto
  (`Shader Error 1282`), artefacto del entorno, no del código.
- Service worker **v33**. Deploy `EXIT=0` verificado en vivo.
- **Pendiente**: capturas del usuario en el teléfono (ficha, portadas en
  estante, tiras de precio de cerca y carrito tras añadir) para el ajuste
  fino visual.

## Sesión 2026-11-05 · MercadoPlacer en la NUBE: site + APK sobre InsForge

El marketplace deja de ser un JSON estático: locales, catálogos y pedidos viven
en InsForge y se sirven por `fabri-api`. El sitio y la APK comparten la misma
base. Detalle completo en `docs/MERCADO-NUBE.md`.

- **Backend** `/api/mercado` (`api-telefono/api/mercado.ts`, 12 acciones): tres
  tablas `mercado_locales` / `mercado_productos` / `mercado_pedidos`. Dos llaves:
  ADMIN (`Bearer FABRI_API_TOKEN`) da de alta/borra locales; el DUEÑO usa su
  `clave` de 8 caracteres (guardada como **SHA-256**). Lecturas y `pedido_crear`
  son públicas. El servidor recalcula precios y **rechaza** `CERRADO` /
  `BAJO_MINIMO`; el tope del plan (gratis 300 / pro 3000) se aplica en
  transacción (`ROLLBACK` → 409 `TOPE_PLAN`).
- **Tope de Vercel Hobby = 12 funciones** (nos topamos al desplegar). Solución:
  fusionar los stubs `memoria`+`modelos`+`skills` en **`/api/agente`** (misma
  ruta, se elige por camino). Quedan **11 funciones**.
- **Sitio**: `placer.js` lee los locales de `https://fabri-api.vercel.app/api/mercado`
  y cae al `/datos/tiendas.json` si la API no responde; `pagar()` sube el pedido
  a la nube (mejor esfuerzo, nunca frena la compra). `negocio.js` ahora es el
  **panel del dueño**: se conecta con ID + clave, lista pedidos reales, prende/apaga
  el local y avanza estados. Barra «Nube del local» + estilos en `index.html`/`styles.css`.
  SW `fcore-v36`.
- **Alta de clientes**: `scripts/nueva-tienda.mjs --api alta|listar|borrar`
  publica en la nube y **devuelve la clave del dueño una sola vez**.
- **Verificación en producción**: tablas creadas (`asegurar`), 2 locales demo
  sembrados (23 productos), `locales` público OK, `CERRADO`, `BAJO_MINIMO`,
  `pedido_crear` válido, `pedidos_listar` (clave buena/mala), `pedido_estado`,
  `resumen` admin. `web/app/negocio.js` ejecutado en Node contra la API real:
  conecta, lista el pedido y refleja abierto/cerrado. Todo el sitio en vivo
  (`forge-core-stock.vercel.app`, `sw` v36). Un bug real encontrado y corregido:
  faltaba `tarjeta()` en `negocio.js`.
- **Seguridad**: MVP razonable (token admin, clave SHA-256, parámetros de `pg`,
  CORS `*` sin cookies). **Falta** rate limit, sesiones firmadas y rotar los
  secretos pegados en claro. **Hobby de Vercel es solo uso no comercial**: para
  facturar hace falta Pro. Límites en `docs/MERCADO-NUBE.md` §5.
- **Pendiente**: rate limit de borde, sesiones del dueño, Vercel Pro antes de
  facturar, prueba en teléfono real. Por rotar: API key de InsForge y contraseña
  de Postgres.

## Sesión 2026-11-05 · MercadoPlacer v35: registro real de locales + abierto/mínimo/entrega

Pivote de «demo» a «postulable»: el catálogo deja de ser sintético y pasa a ser
el que cargó el negocio, visible en cualquier teléfono.

- **El puente (backend del piloto)**: `web/datos/tiendas.json` es el registro de
  locales, servido por CDN. `placer.js` lo trae (`API_TIENDAS = "/datos/tiendas.json"`),
  lo normaliza a la misma forma que los locales de OSM y los une antes de pintar
  (`cargarTiendas()` + `unirTiendas()`). Un local `forge` trae catálogo REAL
  (`productos(m)` devuelve `m.catalogo` tal cual; `stock` puede ser `null` = «disponible»).
  Sin base de datos y sin servidor propio: publicar un local = editar el JSON.
- **Las 3 funciones pedidas** (verificadas end-to-end en headless shell):
  1. **ABIERTO/CERRADO**: `m.abierto`; el pin cerrado se apaga (gris) y dice
     «cerrado», la ficha muestra «Abierto/Cerrado ahora» y bloquea el pedido.
  2. **Pedido mínimo**: `m.minimo` en la ficha, en la lista (tag «mín $…»), en el
     carrito (aviso «Faltan $X para el mínimo») y en el pago (botón deshabilitado).
  3. **Retiro o despacho**: `m.entrega` limita los modos del checkout; el envío lo
     fija cada local (`m.envio`), no un valor global.
- **Alta de locales**: `scripts/nueva-tienda.mjs` (plantilla | alta | listar |
  borrar) valida coords en Chile, teléfono, catálogo con precio>0, avisa duplicados
  y evita ids repetidos.
- **Service worker v35**: `/datos/` va **network-first** (el registro cambia sin
  subir versión) y `../datos/tiendas.json` entra al precache como respaldo offline.
- **Validación**: `node --check` OK; `tests/web/diseno.js` sin regresiones (los 4
  fallos que quedan son previos: tocan `index.html`, `app.js`, `manifest`, landing).
  Smoke mismo-origen (iframe + clics reales): «Cerrado ahora»/$5.000/Solo retiro en
  el cerrado; «Abierto ahora»/$10.000/Retiro o delivery (+$1.990)/catálogo real en
  el abierto; carrito con Tomate $1.390 → «Faltan $8.610…» y botón
  «Mínimo $10.000» `disabled=true`. WebGL sigue sin verificarse aquí.
- **Pendiente**: alta de local in-app (form → JSON + WhatsApp) y probar en teléfono real.
- **Postulación**: `POSTULACION-SUP.md` — one-pager + guion del formulario de
  Start-Up Chile BIG 13 (cierra 24-nov-2026 13:00), con tracción dicha sin inflar
  (los «32 locales» son de OpenStreetMap, no clientes) y ruta paralela CORFO.

## Sesión 2026-11-04 · Tienda 3D v34: arregla el signo del stick (movimiento) — `7a84b24`

Reporte del usuario: «los controles de movimiento me llevan hacia atrás y no
hacia adelante ni a los lados». Reparado y endurecido para uso en celular.

- **Causa raíz**: `desdeCentro()` calculaba `Math.abs(v)` y aplicaba la curva
  **sin recuperar el signo**, así que `joy.x`/`joy.y` salían siempre positivos
  (+X = derecha, +Y = atrás). Por eso el visor solo retrocedía y solo se iba a
  la derecha. Ahora devuelve `Math.sign(v) * curva(...)`.
- **Stick por ANCLA**: el `pointerdown` fija el origen (`ax`,`ay`) y el valor es
  el **desplazamiento** desde ahí. Apoyar el pulgar no mueve; el dedo maneja
  desde donde cayó. Antes se medía desde el centro del aro y el pulgar, que
  casi nunca cae centrado, mandaba «atrás» sin querer.
- **Seguimiento robusto**: el `pointermove`/`pointerup` va en `window` y se
  filtra por `pointerId`; no se corta si el dedo sale del aro y los dos sticks
  (mover + mirar) funcionan a la vez con dos dedos. Radio `R` se mide al tocar.
- **Arrastre de cámara y de puerta** filtrado por `pointerId`: un segundo dedo
  no secuestra el gesto.
- **Limpieza**: `cerrar()` y `#t3dReset` resetean `joy`, `joyCam` y su versión
  suavizada; el stick expone `_resetStick` para soltar un dedo que quedó activo
  al salir de la tienda. Aro con estado `.activo`; ayuda = «arrastra para
  moverte (adelante/atrás/lados)».
- **Diagnóstico**: `__t3d()` publica `joy`, `jcam` y `pose` (x, z, yaw).
- **Validación sintética** (`_mov.html`, gestos `PointerEvent`): `up` →
  `joy.y=-1` y `pose.z` baja (avanza); `down` → `joy.y=+1`; `right` →
  `joy.x=+1`, `pose.x` sube; `left` → `joy.x=-1`, `pose.x` baja; apoyar/soltar
  → `0`; stick de cámara gira (`yaw`). WebGL no verificable aquí (SwiftShader
  pierde el contexto, `Shader Error 1282`).
- Service worker **v34**. Deploy `vercel --prod` y verificación en vivo.
