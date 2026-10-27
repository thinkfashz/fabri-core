# FABRI-CORE · la APK

Qué es, por qué está hecha así, con qué tecnologías y cómo se compila —en el
teléfono y en la nube—. Este documento es la referencia única de la app; el
detalle del arranque está en [ARRANQUE-Y-ACCESO.md](ARRANQUE-Y-ACCESO.md) y el
de la seguridad y la visión, en [SEGURIDAD-Y-VISION.md](SEGURIDAD-Y-VISION.md).

---

## 1 · Qué es

Una app Android ARM64 que funciona **sin internet** y sin cuenta en la nube:

| Pieza | Qué hace |
|---|---|
| **Base local** | SQLite real (Rust + `rusqlite`) con las tablas de inventario, boletas, perfiles, registros y revisiones. Es la fuente de verdad. |
| **Inventario guiado** | Escanear → Productos → Precios → Márgenes → Boleta, en cinco pasos. |
| **Lector de códigos** | EAN-13, EAN-8 y UPC-A con la cámara, decodificador propio (sin `BarcodeDetector`, que el WebView no trae). |
| **Ficha del producto** | Nombre, marca, categoría, etiquetas «free» (sin gluten, sin azúcar, vegano…), alérgenos, Nutri-Score, NOVA e imagen, traídos de bases libres. |
| **Boletas** | Cálculo de neto/IVA/total, folio correlativo, historial y reimpresión. |
| **Impresión** | `PrintManager` de Android con hoja fuera de pantalla: rollo de 80 mm, 58 mm o A4 (también sirve «Guardar como PDF»). |
| **Sincronización** | Opcional y manual: sube los productos pendientes a InsForge por `POST /api/inventario` (upsert por código). |
| **IA** | Apagada por defecto. Se enciende desde la app (runtime llama.cpp empaquetado). El arranque y el login **no dependen** de ella. |

Instalación: `adb install -r FABRI-CORE-x.y.z.apk` o abrir el archivo desde
Descargas. Firma de depuración; minSdk 24, target 34.

---

## 2 · Por qué

### 2.1 · Por qué la base primero y la IA después

Una app de inventario tiene que abrir en menos de un segundo y funcionar en una
bodega sin señal. Cargar un modelo de lenguaje en el arranque hacía lo
contrario: el hilo de JavaScript esperaba al núcleo, la barra se quedaba en 0 %
y el login aparecía sin responder. La regla quedó escrita como invariante:

> El núcleo abre SQLite y sirve la interfaz. La IA es un módulo que el usuario
> enciende cuando lo necesita y que nunca está en la ruta crítica del arranque.

### 2.2 · Por qué WebView y no Compose

La interfaz completa (cinco pasos, tablas, formularios, impresión) ya existía
como HTML y se puede iterar sin recompilar la APK: se cambia `assets/www` y se
recompila en un minuto. Además permite tener **la misma interfaz en la web**
(ver § 5), con los mismos tokens de diseño. El costo —un WebView— se paga con
un puente nativo pequeño y auditado (`NativeBridge`).

### 2.3 · Por qué sin Gradle

El pipeline es `cargo → javac → d8 → aapt2 → zip → zipalign → apksigner`, todo
con herramientas que ya existen en el SDK. Evita descargar AGP y Kotlin
(cientos de MB), funciona sin red y es el mismo comando en el teléfono y en
GitHub Actions. La app no usa ninguna dependencia de AndroidX.

### 2.4 · Por qué la ficha del producto se guarda

Las bases libres (Open Food Facts y hermanas) devuelven etiquetas, alérgenos,
Nutri-Score y NOVA en cada consulta. Si no se guardan, cada búsqueda vuelve a
depender de internet y el filtro «sin gluten» deja de funcionar sin señal. Por
eso la ficha viaja como columna `ficha TEXT` (JSON) con migración idempotente
(`PRAGMA table_info` + `ALTER TABLE`).

---

## 3 · Tecnologías

| Capa | Tecnología | Por qué |
|---|---|---|
| Núcleo | **Rust** (`cdylib`), `rusqlite` (SQLite embebido), `serde_json`, `jni` | Binario único, sin runtime, sin GC; SQLite compilado dentro. |
| Puente | **Java** (`@JavascriptInterface`) | Es la única superficie que la web puede tocar: lista cerrada de operaciones. |
| Interfaz | **HTML + CSS + JavaScript** sin framework, en `assets/www` | Iteración rápida, sin descargas, misma UI que la web. |
| Cámara | `getUserMedia` del WebView + decodificador **EAN propio** sobre `canvas` | `BarcodeDetector` no existe en el WebView de Android. |
| Visión (opcional) | llama.cpp b11835 empaquetado (`runtime/llama-b11835`) | Inferencia local; no se usa en el arranque. |
| Impresión | `android.print.PrintManager` + `WebView` fuera de pantalla | Funciona con impresoras térmicas por el plugin del sistema y con «PDF». |
| Nube | **InsForge** (Postgres + PostgREST) detrás de `fabri-api` (Vercel) | La app nunca ve credenciales de base: sólo un Bearer. |
| Compilación | `cargo`, `javac`, `d8`, `aapt2`, `zipalign`, `apksigner` | Sin Gradle. |

### Estructura del proyecto

```
android/
  AndroidManifest.xml          minSdk 24 · target 34 · versionCode/Name
  java/cl/fabrick/core/
    MainActivity.java          arranca el núcleo ANTES de loadUrl()
    NativeBridge.java          call(op) con topes, cola de registros, imprimir()
    Bitacora.java              bitácora de arranque en archivo
    ColaConsola.java           consola del WebView en hilo de fondo
  res/                         recursos y logos
  assets/www/                  index.html · app.js · inventario.js · app.css
src-tauri/
  src/lib.rs                   operaciones (op_init, op_inventario, op_mantenimiento…)
  Cargo.toml                   versión del núcleo
runtime/llama-b11835/          llama.cpp + shim JNI (runtime nativo A1)
scripts/
  compilar.sh                  pipeline completo
  cc-android24.sh              wrapper de clang con triple versionado
tests/
  arranque/correr.sh           6 pruebas del arranque
  arranque/puente.js           vía síncrona, carril asíncrono, cola acotada
  arranque/identidad.js        ID de cliente, RUT, caché de la ficha
  inventario/ean.js            13 casos del lector EAN
  inventario/lector.js         404/500 de las bases libres, sin red, presupuesto
```

---

## 4 · Compilar

### 4.1 · En el teléfono (Termux + proot Ubuntu)

Requisitos ya presentes: `android-sdk` en `~/android-sdk` (build-tools 34.0.0,
platform 34, `debug.keystore`), Rust con el target `aarch64-linux-android` y
clang del NDK o de Termux.

```sh
cd ~/fabrick-core
CARGO_BUILD_JOBS=2 bash scripts/compilar.sh
# → dist/FABRI-CORE-<versión>.apk
```

Tarda ~3 min (el núcleo Rust es casi todo). El script:

1. comprueba herramientas, `android.jar` y keystore, y exige ≥ 1 GB libre;
2. compila el núcleo y copia `libfabrick_core.so`;
3. empaqueta el runtime llama.cpp y compila el shim JNI;
4. compila el Java, lo pasa a DEX;
5. compila recursos con `aapt2` (la versión se **lee del manifiesto**);
6. inserta DEX y `.so`, alinea y firma;
7. verifica firma y **comprueba que el `versionCode` dentro de la APK coincide**
   con el del manifiesto (si no, Android no instala encima).

### 4.2 · En la nube (GitHub Actions)

`.github/workflows/apk-rust.yml` hace lo mismo en `ubuntu-latest`:

- JDK 17 + `android-actions/setup-android` + `platforms;android-34`,
  `build-tools;34.0.0`, `ndk;26.1.10909125`;
- Rust estable con target `aarch64-linux-android` y caché de Cargo;
- genera el `debug.keystore` si no existe;
- corre las pruebas (`tests/arranque/correr.sh`, `tests/inventario/ean.js`);
- compila y publica el APK como artefacto `FABRI-CORE-apk` (30 días), con
  tamaño y SHA-256 en el resumen del job.

Se dispara con cambios en `android/`, `src-tauri/`, `runtime/`, `scripts/`,
`tests/` o el propio workflow, y a mano con *Run workflow*.

> El workflow `apk.yml` que ya existía compila el proyecto Kotlin/Gradle legacy
> y **no** produce esta APK. Los dos conviven sin pisarse.

### 4.3 · Publicar

1. Subir versión en tres sitios: `src-tauri/Cargo.toml`, `AndroidManifest.xml`
   (`versionCode` + `versionName`) y `NOMBRE` de `scripts/compilar.sh`.
2. Compilar, verificar el SHA-256 y copiar a `Download/`.
3. Anotar versión, tamaño y hash en `STATE.md`.

---

## 5 · La web es la misma app, sin la base local

`https://fabri-core-web.vercel.app/app/` es la PWA: mismo cargador, mismo
login, mismos tokens de diseño y la misma pantalla de inventario. Cambia la
persistencia —SQLite WASM en IndexedDB— y la nube: la web sube productos
directo a InsForge.

| | APK | Web |
|---|---|---|
| Base | SQLite nativo (Rust) | SQLite WASM + IndexedDB |
| Acceso | PIN / contraseña local | PBKDF2-SHA256 120k, sesión con token |
| Escáner | cámara + decodificador EAN propio | formulario (cámara pendiente) |
| Impresión | `PrintManager` (80/58 mm, A4) | documento propio en iframe oculto (80/58 mm, A4) |
| Nube | sync manual a `/api/inventario` | subida directa a `/api/inventario` |
| IA | llama.cpp local, apagada por defecto | función en Vercel, opcional |

La web repite la guía de cinco pasos de la app, con margen por fila
((precio − costo) ÷ precio), carrito con cantidades y boleta imprimible: el
mismo documento de la APK generado en el navegador y enviado al diálogo del
sistema, que sirve tanto para una térmica como para «Guardar como PDF».

La clave de la nube se pega en el login y vive en `sessionStorage`: al cerrar
la pestaña se olvida. Nunca se escribe en el repositorio.

---

## 6 · Contrato con el núcleo

La interfaz no tiene acceso a archivos, red ni procesos. Llama
`FabrickNative.call(op, payloadJson)` y recibe JSON. Operaciones principales:

| `op` | Para qué |
|---|---|
| `ping` | prueba de vida, no espera |
| `init` | abre SQLite y migra (idempotente) |
| `sys` | estado del sistema |
| `mantenimiento` | poda + checkpoint, diferido 2,5 s por Java |
| `inventario` | `listar`, `guardar`, `borrar`, `resumen`, `sync_pendientes`, `sync_marcar`, `precio_*`, `boleta_crear`, `boletas`, `exportar` |
| `perfil`, `usuarios`, `revision`, `logs` | cuentas y bitácoras |
| `imprimir(html, formato)` | abre el diálogo del sistema (Java, no Rust) |

Reglas de tiempo (ver `ARRANQUE-Y-ACCESO.md`):

- **carril asíncrono** (`callAsync` / `apiTarde`): es la vía normal para las
  lecturas de pantalla; el resultado vuelve por `window.__fabriAsync` y **no
  bloquea el hilo de JavaScript**;
- **vía síncrona** (`call()`): sólo acciones puntuales (guardar, borrar,
  registrar), con tope de **600 ms**;
- **20 s** sólo en operaciones pesadas que el usuario pidió;
- `LENTO` y `NUCLEO_OCUPADO` **no son errores**: se reintentan;
- los registros se encolan y se confirman como diferidos.

---

## 7 · Inventario: qué se consulta y de dónde

| Fuente | Qué aporta |
|---|---|
| **Open Food Facts** (`world.openfoodfacts.org`) | alimentos y bebidas: nombre, marca, cantidad, etiquetas, alérgenos, Nutri-Score, NOVA, ingredientes |
| **Open Beauty Facts** | cosmética |
| **Open Products Facts** | otros productos |

Todas son libres, sin clave y con CORS abierto. La app consulta en ese orden y
se queda con la primera que reconoce el código.

Un **404** significa «no está en esa base» y un **500**, «esa base está caída»:
los dos se saltan en silencio y la app sigue con la siguiente. Si ninguna lo
tiene, el mensaje es «no está publicado en las bases libres» (no un HTTP suelto).
Un fallo de red se distingue de ese caso: «sin conexión». Hay presupuesto de
**4,5 s por host y 12 s en total**, para que tres bases caídas nunca dejen la
pantalla esperando medio minuto.

Categorías: `abarrotes` (Alimentos), `bebidas`, `alcohol`, `dulces`, `lacteos`,
`congelados`, `cosmetica`, `limpieza`, `mascotas`, `otros`.

Etiquetas «free» reconocidas: sin gluten, sin azúcar, sin lactosa, sin grasa,
vegano, vegetariano, orgánico. Se guardan en `ficha.etiquetas` y se filtran sin
volver a consultar internet.

---

## 8 · Versiones

| Versión | versionCode | Qué cambió |
|---|---|---|
| 0.9.7 | 22 | última que «funcionaba normal» (sin espera al núcleo) |
| 0.9.10 | 25 | se introduce la espera al núcleo: aparecen el loader en 0 % y el login muerto |
| 0.9.11 | 26 | arranque sin bloqueo, loader CSS, bitácora, poda de registros |
| 0.9.12 | 27 | retirada del loader al volver del segundo plano, `LENTO` como estado normal, ficha del producto, lector EAN propio, impresión 80/58/A4, reimpresión, sync con `/api/inventario` |
| **0.9.13** | **28** | carril **asíncrono** del puente (las lecturas ya no bloquean el hilo), página «Mi identidad» con logo y ID de cliente, lector que salta 404/500 y dice la verdad |
| **0.9.14** | **29** | **corrección de dos fallos en el teléfono**: bloque de utilidades/estado restaurado (`toast`, `hora`, `esc`, `estadoApp`...), `datos` de `perfil` migrado en el arranque |
| 0.9.16 | 31 | UI pulida (doble-bezel, botones pill, motion físico) y avisos reales del lector y de la boleta |
| 0.9.18 | 33 | núcleo estabilizado, candado acotado, monitoreo de rendimiento y selector de módulo |
| 0.9.20 | 35 | el refresco del Flujo ya no espera: carril asíncrono con respaldo síncrono, Flujo a prueba de nulos |
| 0.9.21 | 36 | el token asíncrono no coincidía (dejaba SQL, Inventario y Flujo en blanco) |
| 0.9.22 | 37 | auto-bloqueo del carril (`con_estado` siempre ocupado) |
| 0.9.23 | 38 | SQLite afinado (`synchronous`, caché, mmap, `temp_store`) + op `panel` (todo el Flujo en un viaje) |
| 0.9.24 | 39 | escáner pro (malla en canvas), las 2 bases (local + tu nube) y más fuentes libres (Open Prices, Wikipedia) |
| 0.9.25 | 40 | el módulo de inventario completo: apilador continuo, importación masiva (Eleventa/CSV/TSV/JSON), catálogo en tarjetas con miniatura y código de barras SVG, boleta con efecto de impresión, iconos SVG en línea, verificación real del sistema y limpieza de errores por versión |
| **0.9.26** | **41** | **portada del producto**: estadísticas reales del negocio con tres gráficos d3 (ventas de 7 días, categorías, más vendidos), explicación de qué es FABRI-CORE y qué aporta a un minimarket, seis fichas con iconos animados (animateicons) y marcas retro-iluminadas (lobe-icons + simple-icons), héroe con canvas propio; el bloque técnico queda plegado en un `<details>` |

`dist/FABRI-CORE-0.9.26.apk` · **4.218.325 B** ·
sha256 `4ef65bea9d905593f4fecf2da43b8287fe08be86b66b5ca41f8f64268aaaebc1`
versionCode **41** · copiada a `/sdcard/FABRI-CORE-0.9.26.apk` y a
`/data/local/tmp/FABRI-CORE-0.9.26.apk`. Firma debug, minSdk 24, target 34.
Instalar **encima** de la 0.9.25 (no borra datos).

---

## 9 · Límites conocidos

- **Firma de depuración**: no sirve para Play Store; para distribuir hace falta
  un keystore propio y no perderlo.
- **Sólo ARM64** (`arm64-v8a`). Un teléfono ARMv7 o x86 no la instala.
- **El lector EAN** necesita contraste y el código dentro de la banda central de
  la mira. Con poca luz o código curvado conviene el campo manual; MediaPipe
  (ver `SEGURIDAD-Y-VISION.md`) es la mejora natural.
- **La IA local** no se integra en el arranque y su runtime depende del modelo
  que el usuario descargue; sin modelo, el chat queda inactivo y el resto de la
  app funciona igual.
- **La sincronización no resuelve conflictos**: gana la última escritura por
  `codigo`. Para dos vendedores sobre el mismo producto hace falta un campo de
  versión.
- **La boleta no es tributaria electrónica**: es un comprobante interno. Emitir
  DTE exige certificado del SII y un proveedor autorizado.
