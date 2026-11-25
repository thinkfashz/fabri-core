# MercaFabrick · la app de compra del barrio

> App Android **aparte** de FORGE CORE STOCK. Package `cl.fabrick.merca`.
> Compra el cliente final: mira los locales publicados, arma el carrito, paga
> en efectivo o por transferencia y avisa el pedido al local por WhatsApp con
> una boleta PDF. No reemplaza ni toca `cl.fabrick.core`.

Estado: **1.2.0** (`versionCode` 5). Fuente en `fast/merca/`.

## 1. Qué hace (y qué no)

| Sí | No |
|---|---|
| Login real contra `/api/auth` (la misma cuenta del panel web) | No administra el local: eso es FORGE CORE STOCK |
| Catálogo real de `/api/mercado` (precios y stock los manda la nube) | No inventa tiendas ni productos si la nube no responde |
| Carrito de **una sola tienda** (la nube crea un pedido por local) | No permite mezclar locales en un pedido |
| Registro del pedido con `pedido_crear` **antes** de avisar | No cobra en línea: el pago se cierra con el local |
| WhatsApp con cliente, productos, total, código y clave de entrega | No abre WhatsApp solo: se muestra la confirmación y el botón |
| Boleta PDF (lista de pedido) guardada en Descargas y compartible | No emite boleta ni factura fiscal (lo dice el documento) |

## 2. Piezas

| Archivo | Qué es |
|---|---|
| `fast/merca/www/index.html` | Cascarón: topbar, pestañas, `#mfMain`, `#mfAuth`, `#mfAuthCanvas` y captura global de errores JS |
| `fast/merca/www/merca.css` | Sistema visual (tokens `--mf-*`), capas de login y app |
| `fast/merca/www/merca.js` | `window.MercaUI`: `esc`, `clp`, iconos SVG, tarjetas de tienda y producto, estados, toast |
| `fast/merca/www/mapa.js` | `window.MercaMapa`: mapa interactivo en canvas (teselas OSM, pines, arrastre, pinch) |
| `fast/merca/www/mercado3d.js` | `window.Merca3D`: supermercado en 3D con Three.js (góndolas, productos, caja) |
| `fast/merca/www/vendor/three.min.js` | Three.js r149 (608 KB) servido desde el APK |
| `fast/merca/www/merca-app.js` | Estado, API, carrito por tienda, catálogo, checkout, éxito, WhatsApp y generador PDF |
| `fast/merca/www/auth.js` | Login/registro real, sesión `fcore.nube`, canvas de fondo, `mostrarPantalla`/`cerrarPantalla` |
| `fast/merca/java/cl/fabrick/merca/MercaActivity.kt` | WebView a pantalla completa, manejador de crash, geolocalización, puente |
| `fast/merca/java/cl/fabrick/merca/ActivosMerca.kt` | Sirve `assets/merca/www` en `https://merca.local/` |
| `fast/merca/java/cl/fabrick/merca/Puente.kt` | `MercaPuente.compartirPdf`: guarda en Descargas y abre el menú de compartir |
| `fast/merca/AndroidManifest.xml` | Package, versión, permisos y meta-data (`canal`, `api`, `panel`, `esquema`) |
| `build-merca.sh` | Pipeline aapt2 → kotlinc → d8 → zip → zipalign → apksigner (mismo de `build-fast.sh`) |

## 3. Sesión compartida con el panel

- La sesión vive en `localStorage["fcore.nube"]` = `{token, exp, usuario}`.
- El dispositivo en `localStorage["fcore.dispositivo"]`.
- Cada llamada a `/api/mercado` manda `Authorization: Bearer <token>` y
  `x-dispositivo: <id>`. Con eso `mis_pedidos` y `pedido_crear` ligan el
  pedido a la cuenta (C09).
- **Ojo:** la sesión del panel **no** sirve como credencial del puente
  APK↔nube de FORGE (ese usa `local_id` + `clave`). Para Merca sí sirve.

## 4. Flujo del pedido

```
Inicio / Mapa ──► Catálogo (tienda) ──► Carrito ──► Compra
                                                      │
                          validaciones (nombre, teléfono,
                          delivery: dirección+comuna, mínimo,
                          efectivo alcanza)
                                                      ▼
                          POST /api/mercado {accion:"pedido_crear",
                            local_id, cliente, telefono, entrega,
                            direccion, comuna_entrega, metodo_pago,
                            pago_con, nota, idempotencia, items[]}
                                                      │
                     ┌────────────────────────────────┴───────────────┐
                     ▼                                                ▼
        ok:true → código, clave_entrega,                 error (SIN_RED)
        vuelto, ahorro, seguimiento                     → «Avisar por WhatsApp
        → pantalla «Pedido registrado»                    igual» (sin registrar)
        → botón WhatsApp + botón PDF
```

- **Idempotencia**: `S.idem` se genera por intento; repetir el envío (doble
  toque o corte de red) devuelve el pedido ya creado, no lo duplica.
- **El pedido se registra primero**: así descuenta stock, valida precios y el
  local lo ve en su panel. WhatsApp es el aviso, no el registro.
- **Ya no se abre WhatsApp automáticamente**: se muestra la confirmación (con
  código y clave) y el usuario toca «Enviar por WhatsApp». Evita cierres raros
  y deja ver la boleta antes de salir de la app.

## 5. Mapa interactivo

`mapa.js` dibuja un mapa "slippy" en canvas, sin Leaflet ni claves de API:

- Teselas de `tile.openstreetmap.org` (atribución visible), con caché en memoria.
- Pines de los locales con `lat/lon`: lima si está abierto, rojo si está cerrado.
- Punto azul de la ubicación del usuario (botón «Mi ubicación» de la topbar).
- Arrastre para desplazar, rueda/pinza para acercar, botones + / − / centrar.
- Toca un pin → ficha con nombre, rubro, dirección y botón «Ver productos».
- Debajo del mapa, la lista completa de locales.

## 6. Visor 3D del mercado

`mercado3d.js` arma un supermercado con Three.js (r149, incluido en el APK):

- Piso con cuadrícula, pared de fondo y letrero con el nombre del local.
- Cuatro góndolas con tres repisas; los productos son cajas con el color de su
  categoría (máximo 84 cajas, se reciclan si el catálogo es más grande).
- Caja de pago con lector luminoso.
- Giro con el dedo, pinch para acercar, y **toca un producto para agregarlo al
  carrito** (con aviso).
- Si el equipo no tiene WebGL o pierde el contexto, se explica y se ofrece
  volver a la vista Lista (nunca queda un rectángulo negro).

Se entra desde el catálogo, con el selector **Lista / 3D**.

## 7. Boleta PDF

Generador propio de **PDF 1.4** en JavaScript (Helvetica, multipágina, 46
líneas por página), sin librerías. Estructura válida verificada: cabecera
`%PDF-1.4`, tabla `xref` con offsets correctos, `trailer` y `%%EOF`.

- **Android** (`MercaPuente.compartirPdf`): guarda en `Descargas` vía
  MediaStore (API ≥ 29) o archivo directo, y abre `ACTION_SEND` para compartir.
- **Navegador**: descarga con `Blob`.
- El documento dice «Documento de pedido. No es boleta ni factura fiscal».

## 8. Pantalla negra: qué pasaba (y la causa real)

Hubo dos cosas, y la segunda tapaba a la primera:

1. `auth.js` inyectaba `#mfAuthCanvas { position:fixed; inset:0; background:#050505; z-index:0 }`
   y `merca.css` traía `#mfAuth { display:none }`. Al entrar, el canvas quedaba
   **encima** de la app y la dejaba en negro; el login nunca se retiraba.
2. **La app no arrancaba**: el build compilaba Kotlin con `-no-stdlib` y no
   dexaba `kotlin-stdlib`, así que el `classes.dex` referenciaba
   `kotlin/jvm/internal/Intrinsics` sin tenerlo. La Activity moría al cargar con
   `Failed resolution of: Lkotlin/jvm/internal/Intrinsics;` (pasaba desde la
   1.0.0). El panel de arranque de 1.1.1 fue lo que dejó ver el mensaje.

Arreglo de (1):

- El login es una **capa propia**: `#mfAuth` (panel, `z-index: 901`) y
  `#mfAuthCanvas` (fondo, `z-index: 900`), ambos `display:none` hasta que
  `MercaAuth.mostrarPantalla()` agrega `.mf-auth--visible`.
- `body.mf-auth-bloqueado` oculta topbar, pestañas y `#mfMain` mientras el
  login está abierto.
- Al autenticar: `detenerCanvas()` → `cerrarPantalla()` (quita clases, limpia
  el canvas y vacía el formulario) → recién entonces `alEntrar()` pinta la app.
- `MercaAuth.salir()` vuelve al login, no a una app sin cuenta.

Arreglo de (2): `build-merca.sh` pasa `$KSTD` (kotlin-stdlib) a `d8`, así que
el stdlib queda **dentro** del APK. El archivo pasó de 60 KB a 732 KB.

## 9. Arranque a prueba de pantalla negra

El WebView puede quedar en negro sin dar un solo mensaje (por ejemplo, si la
página principal responde 404, `onReceivedError` no se dispara). Para que eso
no vuelva a pasar:

1. **Panel nativo de arranque**: se pinta antes que la WebView con la versión
   (`v1.1.1 · iniciando interfaz…`). Nunca se ve negro.
2. **La página avisa**: al terminar de pintar, `index.html` llama
   `MercaPuente.listo("ok")` y el panel se retira.
3. **Segundo intento**: si en 12 s no avisó, se recarga la misma interfaz desde
   `file:///android_asset/merca/www/index.html`.
4. **Diagnóstico nativo**: si tampoco así, se muestra un panel con la versión de
   la app, la versión de la WebView, Android/SDK, si la interfaz avisó y los
   últimos mensajes de consola. Botón «Reintentar».
5. **HTTP**: `onReceivedHttpError` captura el 404 del origen propio (antes
   quedaba en blanco).

La versión también se ve en el login (`MercaFabrick v1.1.1`), para confirmar
que la APK instalada es la nueva.

## 10. Compilar y entregar

```sh
bash build-merca.sh            # ~2-4 min (d8 es lo más lento)
# salida: out/MercaFabrick-<versión>.apk
```

- La versión se lee **solo** del manifest (`versionCode`/`versionName`).
- El build verifica que `assets/merca/www/index.html` quedó dentro del APK.
- Entrega fuera de Termux: copiar a `/storage/emulated/0/Download/`.
- Prueba final en el teléfono del usuario: aquí no hay Android para ejecutar.

## 11. Pendiente / límites

- La boleta PDF y el permiso de ubicación solo se validan en dispositivo.
- El pago es efectivo o transferencia; no hay pasarela.
- Un pedido por local: el carrito se vacía si se cambia de tienda (con aviso).
