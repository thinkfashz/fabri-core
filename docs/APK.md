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
  arranque/correr.sh           4 pruebas del arranque
  inventario/ean.js            13 casos del lector EAN
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
| Impresión | `PrintManager` (80/58 mm, A4) | impresión del navegador |
| Nube | sync manual a `/api/inventario` | subida directa a `/api/inventario` |
| IA | llama.cpp local, apagada por defecto | función en Vercel, opcional |

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

- tope duro de **900 ms** por llamada; **20 s** sólo en operaciones pesadas
  que el usuario pidió;
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
| **0.9.12** | **27** | retirada del loader al volver del segundo plano, `LENTO` como estado normal, ficha del producto, lector EAN propio, impresión 80/58/A4, reimpresión, sync con `/api/inventario` |

`dist/FABRI-CORE-0.9.12.apk` · **4.091.014 B** ·
sha256 `7e6e70d4f53027dde5351aaa69c1597864fb27435f9e5a67221396baf8bd3a5c`

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
