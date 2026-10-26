# STATE — FABRI-CORE

Última actualización: 2026-10-26

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
| Workflow de compilación Rust | `.github/workflows/apk-rust.yml` (bloqueado por facturación de GitHub) |
| Escritura verificada de punta a punta | subir 2 → reenviar (upsert) → bajar → resumen → borrar → 401 sin token |

### Documentos nuevos

- `docs/APK.md` — qué es, por qué, tecnologías, compilación local y nube, contrato, versiones y límites.
- `docs/SEGURIDAD-Y-VISION.md` — evaluación de Authelia, FairScan y MediaPipe con decisiones.

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
