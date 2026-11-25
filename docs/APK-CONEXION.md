# Conexión de la APK con la tienda

La APK **FORGE CORE STOCK 1.2.0** (`fast/lite/`) se conecta a una tienda con la
**misma clave de 8 caracteres** que genera el panel del negocio. No hay token de plataforma ni una
segunda llave: el puente es `/api/inventario`, multi-inquilino por `local_id`.

## 1 · Dónde se obtiene la clave

1. El dueño crea la tienda en `/app/` (pestaña **Negocio**) o en el panel.
2. En `/panel/negocio/conexion/` ve el estado, prueba la clave y puede **generar
   una nueva** (se muestra una sola vez).
3. La clave se guarda sólo como `SHA-256` en `mercado_locales.clave_hash`.

## 2 · Aviso legal y de datos (primera vez)

Al abrir la app, si no se aceptó la versión vigente, aparece un aviso que no se
puede cerrar sin aceptar (`legal.js` + `legal.css`). Explica, en lenguaje claro:

- qué datos del vendedor y del cliente se tratan;
- que el teléfono guarda base local, catálogo, bóveda y modelos (no se suben);
- que la nube guarda tienda, catálogo, pedidos, reseñas y clientes;
- cookies y almacenamiento local (sin cookies publicitarias);
- permisos de internet, cámara y notificaciones;
- responsabilidad del uso y límites del fundador/desarrolladores;
- derechos de acceso, exportación y eliminación.

La aceptación se guarda con versión (`2026-11-24`) y fecha. Se puede releer desde
Integración → «Aviso de datos y responsabilidad». La versión web está en
`/privacidad.html` y `/terminos.html`.

## 3 · Integración rediseñada (0.9.69)

Interfaz nueva, móvil primero, con cards y una miniatura animada del flujo:

1. **Flujo (canvas Matrix):** APK ↔ nube, paquetes de ida y vuelta, latencia y
   estado. Se detiene si la nube no responde.
2. **Tu cuenta y la APK — vínculo real:** el panel genera un código de 8
   caracteres de un solo uso (`vinculo_crear`); la APK lo canjea
   (`vinculo_canjear`) y recibe tienda + clave, que quedan guardadas. El código
   caduca en 10 minutos y rota la clave. Botón «Abrir mi cuenta en la nube».
3. **Nube de tu tienda:** URL, ID, clave, token admin; guardar, probar y estado.
4. **Base de datos:** local y nube con tamaño, filas y tablas reales.
5. **Proveedores y conectores:** tarjetas para guardar claves de InsForge, Neon,
   Supabase, Cloudflare, OpenAI… con probar y quitar; botón «+ Añadir».
6. **Respaldo externo** e **IA remota**, cada una con su estado y latencia.

Los estados se guardan en `fcore.int`; no se muestra «conectado» sin prueba.

## 4 · Vista «Tienda y CRM» en el menú lateral

La 0.9.69 no cambia las pantallas existentes: añade **una vista** al menú
lateral (`data-vista="tienda"`), con tres pestañas internas.

- **Conexión:** identificador + clave, probar, estado de la nube (publicada,
  plan, productos, dispositivos), **asegurar tablas**, subir/bajar catálogo y
  desconectar. Muestra conectado/revisar y los últimos fallos con su motivo.
- **Productos:** lee el catálogo publicado (`local_ver`) y permite editar
  nombre, precio y stock de cada producto; guarda con `productos_subir` + clave.
- **Clientes:** CRM real con `clientes_listar` (teléfono enmascarado).

El resto de la app (inventario, catálogo, DTE, impuestos, contabilidad, flujo,
identidad, consola, diagnóstico) queda **igual**. No se tocó Java ni Rust: se
reutilizaron las 7 bibliotecas nativas de la 0.9.63.

Archivos: `android/assets/www/tienda.js`, `tienda.css` y tres líneas de
integración en `index.html` (menú, sección, script) y `app.js` (router).

## 4-quinquies · Inventario, mapa y visor sin conexión (0.9.73)

**Inventario**
- Buscador avanzado (`inv-buscar.js`): chips (todos, stock bajo, sin stock,
  margen bajo, oferta), orden, paginación de 20 en 20 y estado vacío explicativo.
- Lector único (`inv-lector.js`): un solo `getUserMedia` y un solo rAF,
  idempotente; reutiliza el EAN del repo y `BarcodeDetector` si existe.
- Motor de márgenes (`invMargenDe`): margen sobre venta y markup sobre costo,
  IVA, utilidad por stock, semáforo y explicación. Sin costo el markup es —.
- Escena 3D isométrica en canvas 2D (paso 1) con cajas según stock real y
  color según margen; destello al escanear.
- Cada paso tiene cabecera, propósito y pie «Anterior / Siguiente · Paso n de 5»;
  Productos, Precios y Márgenes van de 20 en 20.

**Mapa y visor offline**
- `offline-mapa.js` (`OfflineMapa`): cachea teselas de un rectángulo
  (Santiago centro, zooms 14–16) en Cache Storage, con tope de 400 teselas y
  40 MB, concurrencia 4. `cubierto()`, `estado()`, `limpiar()`.
- `offline-visor.js` (`OfflineVisor`): guarda las 4 texturas HD del visor y
  recursos por producto; `estado()`, `cubierto()`, `limpiar()`.
- `offline-panel.js`: tarjeta «Mapa y visor sin conexión» en Integración, con
  botones Guardar mapa / Guardar visor / Borrar caché, progreso y estado.
- Nada se descarga al abrir la app: sólo al pulsar.

 con API key y firma en la nube (0.9.69)

- La tarjeta de Cloudinary pide **cloud name, API key, API secret** y preset
  unsigned opcional. El secret **no se guarda en el teléfono**: se manda una
  vez a la nube (`imagen_config_guardar`) y queda en `mercado_cloudinary`.
- Al editar un producto, la APK pide `imagen_firmar`: el servidor devuelve
  `timestamp`, `folder`, `api_key` y `signature` (SHA-1 de los parámetros
  ordenados + el secret). La foto se sube directo a Cloudinary con esa firma.
- Si no hay API key, se usa el preset unsigned. Si no hay red para pedir firma
  pero hay preset, también funciona.
- `imagen_config_ver` devuelve cloud name y API key enmascarada; **nunca** el
  secret. Sin sesión de dueño responde 401.
- Interfaz nueva «Matrix» (`matrix.css`) para Integración y Base de datos:
  tarjetas de vidrio, retícula, píldoras de estado y el flujo animado.

## 4-ter · Sincronización del catálogo y fotos

- **Base de datos → Sincronizar Nube** ahora hace dos cosas: sube al
  inventario (`inv_productos`) y **publica en el catálogo de la tienda**
  (`mercado_productos`) con el ID y la clave. Antes solo subía al inventario,
  por eso la tienda seguía vacía. El mensaje dice cuántos fueron a cada uno.
- **Catálogo → ficha del producto → «Editar producto»**: nombre, precio, stock,
  proveedor, descripción y hasta **5 fotos** desde la galería. Al guardar se
  actualiza la base local y se sincroniza con la nube; la tienda cambia al
  instante.
- Las fotos se achican en el equipo (900 px, JPEG 0.72). Si Cloudinary está
  configurado, se suben allí y se guardan sus URL; si no, se guardan como data
  URL y el backend las publica por `imagen_ver`.
- El catálogo de la nube acepta `imagenes` (hasta 5) y usa la URL directa
  cuando la foto vive en Cloudinary.
- **Integración → Cloudinary**: cloud name + API key + API secret (o preset
  unsigned). Guardar, probar subida y quitar. El secret se guarda en la nube y
  la app usa la firma al editar productos.

## 4-bis · Base de datos en la app

La vista «Base de datos» mantiene su consola y su tabla, pero el banner de flujo
usa el mismo motor Matrix (`matrix.js`): SQLite local ⇄ nube, con paquetes y
estado real. Altura mayor y borde redondeado para que se vea en el teléfono.

## 5 · Qué hace la vista «Tienda»

| Acción | Llamada | Qué pasa |
|---|---|---|
| Conectar y probar | `POST /api/inventario { accion: "verificar" }` | valida `local_id` + `clave` y guarda la credencial **cifrada** con el Keystore |
| Probar | `verificar` | comprueba el enlace sin tocar el catálogo |
| Ver estado | `estado` | devuelve tienda, productos en la nube, dispositivos y fallos |
| Subir catálogo | `subir` | manda la tabla local `products` en lotes de 200 |
| Bajar catálogo | `bajar` | guarda el catálogo de la nube en SQLite (upsert por `sku`) |
| Asegurar tablas | `asegurar` (inventario + mercado) | crea las tablas que falten en la nube |
| Estado en la nube | `conexion_estado` | publicada, plan, productos, dispositivos y fallos |
| Desconectar | — | olvida la credencial y conserva el catálogo local |

Cada llamada envía `huella` (Android ID), `etiqueta` (marca y modelo),
`plataforma: "android"` y `version`. Así el panel muestra **dispositivos reales**
con su última conexión, sin inventar una lista.

Si una llamada falla, la APK la reporta con `accion: "error"` y el panel la
muestra en «Fallos recientes». La clave nunca se escribe en claro ni se registra
en logs; se cifra con `Sec` (AES-256-GCM, clave del Android Keystore).

La credencial y el catálogo leído se guardan en `localStorage`
(`fcore.tienda.*`); los fallos también, con tope de 10. La base SQLite nativa y
las tablas de la app estable no se tocan (2,07 GB de datos intactos).

**Tablas en la nube:** `inv_productos`, `inv_conexiones` (creadas por
`/api/inventario`) y `mercado_locales`/`mercado_productos` (por `/api/mercado`).
La vista llama `asegurar` en ambos endpoints al conectar.

## 3 · Compilar rápido (sin Gradle)

El build lite no levanta daemon ni resuelve dependencias. En este equipo tarda
~4 minutos y deja la APK firmada:

```sh
FORGE_SALTAR_RUST=1 bash scripts/compilar.sh
# APK: dist/FORGE-CORE-STOCK-0.9.69.apk  (~1m 47s, firmada)
```

`FORGE_SALTAR_RUST=1` reutiliza las bibliotecas nativas del APK 0.9.63 (mismas,
ya probadas) y solo recompila Java, recursos y assets. Sin esa variable, el
script compila Rust y tarda bastante más.

Si el SDK no está en `/root/android-sdk`, el script lo busca en
`/data/data/com.termux/files/home/android-sdk` y en `$HOME/android-sdk`. Para
forzarlo:

```sh
ANDROID_SDK_ROOT=/ruta/al/sdk bash build-fast.sh
```

Pipeline: `aapt2` (recursos) → `kotlinc` embebido → `d8` → `zip/zipalign` →
`apksigner` con el keystore de debug. `fast/out/` y `fast/lib/` son artefactos:
están ignorados por git y se regeneran solos.

Verificación rápida de la APK:

```sh
unzip -l out/forge-core-stock-lite.apk | tail
$ANDROID_SDK_ROOT/build-tools/34.0.0/apksigner verify --print-certs out/forge-core-stock-lite.apk
```

## 6 · Entrega e instalación encima de la 0.9.63

- `/storage/emulated/0/Download/FORGE-CORE-STOCK.apk` (nombre estable)
- `/storage/emulated/0/Download/FORGE-CORE-STOCK-0.9.69.apk`
- `https://forge-core-stock.vercel.app/descargas/FORGE-CORE-STOCK.apk`

Misma firma de depuración (`SHA-256 959b85cc…`) y mismo package
`cl.fabrick.core`, con `versionCode 79 > 78`: Android la trata como
**actualización** y conserva los datos.

## 7 · Contrato del puente (resumen)

```http
POST https://fabri-api.vercel.app/api/inventario
{ "accion": "verificar", "local_id": "mi-tienda", "clave": "ABCD1234" }
→ { "ok": true, "conexion": { "tienda": "Mi tienda", "productos": 12, ... } }
```

Acciones: `verificar`, `estado`, `error`, `desconectar`, `subir`, `bajar`,
`buscar`, `borrar`, `subir_boletas`, `resumen`, `respaldo`.

- `subir` y `bajar` son idempotentes por `(local_id, codigo)`.
- `estado` y `subir` registran el dispositivo; `verificar` no.
- Nada devuelve la clave, su hash, el correo del dueño ni el teléfono completo.

## 8 · Pendiente de prueba en el teléfono

La vista compila y el APK conserva package, firma, icono e IDs de recursos de
la 0.9.63. Falta abrirla en el teléfono y probar con una tienda real:
conectar, asegurar tablas, subir/bajar y editar un producto. El panel
`/panel/negocio/conexion/` sirve para comprobar que el dispositivo aparece.

Si algo falla al abrir, el registro queda en la app (Diagnóstico → Revisión) y
en `Bitacora`; no se pierde nada porque la base local no se migra.
