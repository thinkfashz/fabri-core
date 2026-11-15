# Tiendas multi-negocio · cuenta, catálogo y mapa

> Estado: implementado y probado el 2026-11-11. Aplica a la web
> (`forge-core-stock.vercel.app/app/`) y a la API (`fabri-api.vercel.app`).

## Qué hace ahora

Una persona crea su cuenta en **Cuenta**, entra a **Negocio** y desde ahí:

1. crea **su tienda** con nombre, marca, logo, rubro, dirección, comuna y GPS;
2. publica el **catálogo** (producto, precio CLP, SKU, stock, categoría);
3. importa productos desde **CSV/JSON** o desde el **Stock local** del teléfono;
4. ve y avanza los **pedidos** que llegan desde MercadoPlacer;
5. edita la **ficha pública** (marca, logo, descripción, horario, mínimo, envío,
   retiro/delivery) y abre o cierra el local;
6. la tienda aparece en el **mapa** con su nombre, marca, logo y catálogo por
   categorías, y el botón **Ver en el mapa** la enfoca.

El panel viejo por **ID + clave** sigue disponible en «Conectar con ID y clave
(respaldo para la APK)». No se rompió nada de lo anterior.

## Cómo quedar como usuario root

No hay una contraseña root en Vercel. El root es una **cuenta con rol
`owner`**. Hay dos caminos:

| Camino | Qué hacer |
|---|---|
| Primera cuenta | Si `core_usuarios` está vacía, la primera cuenta que se registre queda `owner` automáticamente |
| Correo explícito | Definir `CORE_ROOT_EMAIL=tu@correo.cl` en el proyecto Vercel `fabri-api` y entrar con ese correo. Si la cuenta ya existía como `member`, se promueve al entrar o al validar la sesión |

`FABRI_API_TOKEN` es otra cosa: es el **token de administración** (Bearer) que
sirve para `usuarios` y `resumen`. No se escribe en la web ni se comparte.

## Variables de Vercel

### `fabri-api` (obligatorias y opcionales)

| Variable | Obligatoria | Para qué |
|---|---|---|
| `INSFORGE_DATABASE_URL` | sí | cadena de Postgres de InsForge (marcada *Sensitive*) |
| `FABRI_API_TOKEN` | recomendada | admin Bearer para listar cuentas y ver el resumen |
| `CORE_INVITE` | opcional | si existe, el registro exige ese código |
| `CORE_MAX_CUENTAS` | opcional | tope de cuentas (200 por defecto) |
| `CORE_ROOT_EMAIL` | opcional | correo que siempre tiene rol `owner` (en producción: `F.eduardomicolta@gmail.com`) |
| `VISITAS_SAL` | opcional | sal del contador de visitas |
| `VAPID_PUBLIC` | para avisos push | clave pública P-256 (87 chars) que el navegador usa para suscribirse |
| `VAPID_PRIVATE` | para avisos push | clave privada (43 chars). Nunca sale del servidor |
| `VAPID_SUBJECT` | opcional | contacto del emisor (`https://…` o `mailto:…`); por defecto el sitio |
| `PUBLIC_SITE` | opcional | origen para armar el enlace del aviso; por defecto `https://forge-core-stock.vercel.app` |

### `forge-core-stock` (web)

No necesita secretos para este flujo. La web llama a la API pública; el token
de sesión vive en `localStorage` (`fcore.nube`) y viaja como `Bearer`.

## Sesión atada al dispositivo

Cada login emite un **token único de 256 bits**. En la base queda:

| Columna | Contenido |
|---|---|
| `token_hash` | `SHA-256` del token (nunca el token en claro) |
| `dispositivo` | etiqueta legible (user agent acotado) |
| `dispositivo_hash` | `sha256(dispositivo \| usuario_id \| token_hash)` |

La huella se **recalcula en cada validación** y se compara en tiempo constante
(`timingSafeEqual`). El ID del dispositivo es aleatorio (`fcore.dispositivo` en
`localStorage`) y viaja en el cuerpo del login y en la cabecera
`X-Dispositivo` de `/api/mercado`. Un token copiado a otro equipo responde
`401 DISPOSITIVO` y la app borra el token de nube (el espejo local sigue).

Otros topes: **12 sesiones activas** por cuenta (las más viejas se revocan),
30 días de vigencia y revocación real al cerrar sesión. Las sesiones anteriores
a esta versión (sin huella) se revocan una vez en la migración: hay que volver
a entrar.

## Qué viaja con la cuenta y qué no

Entrar con el **mismo correo y la misma contraseña** en otro teléfono o
navegador devuelve la cuenta y todo lo que vive en la nube. Esto es lo que se
comprobó contra producción (dispositivo A crea, dispositivo B entra y ve lo
mismo):

| Dato | ¿Viaja? | Dónde vive |
|---|---|---|
| Correo, nombre, rol, términos aceptados | **Sí** | `core_usuarios` |
| Tiendas: nombre, marca, logo, descripción, rubro, dirección, comuna, teléfono, coordenadas, horario, mínimo, entrega, envío | **Sí** | `mercado_locales` |
| Catálogo de la tienda: SKU, nombre, precio CLP, stock, categoría, unidad | **Sí** | `mercado_productos` |
| Pedidos y su estado | **Sí** | `mercado_pedidos` |
| Inventario de la app (`inv_productos`) | **Con credencial aparte**: `local_id` + clave de 8 caracteres | `inv_productos` |
| Boletas, planilla, métricas, claves de IA | **No** | SQLite de cada navegador |
| Tema y disposición de la interfaz | No aplica: es la misma app para todos | — |

La **clave de 8 caracteres** del local se muestra en el panel de la tienda y
sirve para conectar el inventario de la APK o de otro equipo. No es el token de
la cuenta: son dos credenciales distintas a propósito.

## Términos y condiciones

`TERMINOS_VERSION = '2026-11-11'`. El alta exige `acepta_terminos: true`; se
guarda la versión y la fecha (`core_usuarios.terminos_version`, `terminos_ts`).
La respuesta de `registrar`/`entrar`/`sesion` trae
`usuario.terminos: { version, aceptada, vigente, ts }`. Si la versión cambia,
la app pide aceptar con la acción `aceptar_terminos` **sin bloquear la
entrada**. La página es `web/app/terminos.html` (en el precache del SW).

## Contrato de la API (`/api/mercado`)

Autorización, en este orden:

1. **Admin**: `Authorization: Bearer $FABRI_API_TOKEN`.
2. **Cuenta dueña**: `Authorization: Bearer <token de /api/auth>` **con la
   cabecera `X-Dispositivo` del mismo equipo que abrió la sesión**, y
   `mercado_locales.dueno_id = core_usuarios.id`.
3. **Clave del local**: `clave` de 8 caracteres (SHA-256 en la base), respaldo.

| Acción | Quién | Qué hace |
|---|---|---|
| `locales` (GET/POST) | público | lista activa con `marca`, `logo`, `descripcion` y catálogo |
| `local_crear` | cuenta · admin | crea la tienda, guarda `dueno_id` y devuelve la clave de respaldo |
| `local_mio` | cuenta | devuelve mis tiendas con catálogo y pedidos pendientes |
| `local_actualizar` | dueño · admin | edita ficha, marca, logo, descripción, mínimo, envío, entrega |
| `local_estado` | dueño · admin | abre o cierra el local |
| `local_borrar` | dueño · admin | borra tienda, catálogo y pedidos |
| `productos_subir` | dueño · admin | upsert de hasta 500 productos por lote (tope por plan) |
| `producto_borrar` | dueño · admin | borra hasta 200 SKUs |
| `pedidos_listar` | dueño · admin | pedidos del local |
| `pedido_estado` | dueño · admin | avanza el pedido (`nuevo`, `visto`, `listo`, `entregado`, `cancelado`) |
| `pedido_crear` | público | pedido del comprador (el servidor recalcula totales) y devuelve el `seguimiento` |
| `resenas_listar` | público | reseñas visibles, promedio y reparto |
| `resena_crear` | público | califica un pedido entregado (token o código + teléfono) |
| `resenas_panel` | dueño · clave · admin | todas las reseñas, con las ocultas |
| `resena_moderar` | dueño · clave · admin | oculta o muestra una reseña |
| `push_suscribir` | público | suscribe un navegador a los avisos de un pedido (token o código + teléfono) |
| `push_baja` | público | quita ese navegador de los avisos |
| `push_local_suscribir` | dueño · clave · admin | suscribe el navegador del local a los pedidos nuevos |
| `push_local_baja` | dueño · clave · admin | quita ese navegador de los avisos del local |
| `pedido_seguir` | público | estado del pedido por `token` o por `codigo` + `contacto` (últimos 4 del teléfono) |
| `ventas_serie` | dueño · clave · admin | resumen del panel: serie diaria, top de productos, conteo por estado, visitas y conversión (`dias` 1–90, por defecto 7) |

### Tablas del marketplace

| Tabla | Para qué |
|---|---|
| `mercado_locales` | tiendas, ficha pública, dueño y plan |
| `mercado_productos` | catálogo por local (SKU, precio, stock) |
| `mercado_pedidos` | pedidos, estado actual y `seguimiento` (token) |
| `mercado_pedido_eventos` | historial de estados (línea de tiempo del comprador) |
| `mercado_resenas` | calificación por pedido entregado, con `oculta` para moderar |
| `mercado_push` | suscripciones del comprador para avisar el cambio de estado |
| `mercado_push_local` | suscripciones del local para avisar el pedido nuevo |

### Esquema nuevo de `mercado_locales`

```sql
marca        TEXT NOT NULL DEFAULT ''
logo         TEXT NOT NULL DEFAULT ''   -- data URI (~192 px) o URL https
descripcion  TEXT NOT NULL DEFAULT ''
dueno_id     TEXT NOT NULL DEFAULT ''   -- id de core_usuarios (no el correo)
```

La migración es idempotente (`ADD COLUMN IF NOT EXISTS`) y corre una vez por
instancia de la función; una base con los locales del piloto sigue funcionando.

## Logo

Se redimensiona **en el navegador**: lado máximo 192 px, JPEG calidad 0.78
(0.52 si queda pesado), fondo blanco para que un PNG transparente no quede
negro, tope de 120 KB. Se guarda como `data:image/jpeg;base64,...` en la misma
fila del local: no hay servicio externo de archivos ni bucket.

## Importación de catálogo

Acepta `.csv` y `.json`. Encabezados con coma o punto y coma, comillas dobles y
sinónimos en español/inglés:

| Campo | Encabezados aceptados |
|---|---|
| nombre | `nombre`, `name`, `producto`, `descripcion`, `detalle` (y sufijos como `Nombre del producto`) |
| precio | `precio`, `price`, `valor`, `pvp`, `venta` (y `Precio CLP`) |
| sku | `sku`, `codigo`, `code`, `barcode`, `ean` |
| stock | `stock`, `cantidad`, `qty`, `existencias`, `inventario` |
| categoría | `categoria`, `category`, `rubro`, `tipo`, `familia` |
| unidad | `unidad`, `unit`, `medida`, `formato` |

Precios tolerantes al formato chileno: `$1.690` → 1690 y `1690,5` → 1691.
Los lotes se envían de 400 en 400 (el servidor acepta hasta 500).

**Traer de mi Stock** usa la base SQLite del navegador:
`Fabri.q("SELECT sku, name, price, unit FROM products")`.

## Mapa

`placer.js` lee `marca`, `logo` y `descripcion` de cada tienda:

- el pin muestra el logo propio (con marco blanco) o el icono del rubro;
- la lista muestra el logo, el nombre en hasta dos líneas y `marca · rubro ·
  dirección`, con las categorías del catálogo;
- la ficha muestra la marca junto al nombre y la descripción del negocio;
- el catálogo sigue agrupado por categorías y con búsqueda.

Las tiendas registradas **no se agrupan** con las de OpenStreetMap: el dueño
siempre ve su local con su logo, no un globo con un número.

`Placer.irATienda(id)` abre el mapa y enfoca la tienda; lo usa el botón
**Ver en el mapa** del panel.

## Seguimiento del pedido (público)

El comprador no tiene cuenta, así que el seguimiento no puede depender de una
sesión. Se resuelve con **dos caminos** hacia el mismo dato:

| Camino | Cómo | Cuándo |
|---|---|---|
| **Enlace** | `seguir.html?t=<token>` — el token de 20 hex que devuelve `pedido_crear` | es el que se guarda y se reenvía; el teléfono lo recuerda solo |
| **Código + teléfono** | `MP-XXXXX` y los últimos 4 dígitos del teléfono del pedido | si se perdió el enlace |

- `pedido_seguir` es **público**, pero el código corto solo no basta: sin token
  exige el teléfono, y hay un tope de **30 intentos fallidos por IP cada 10
  minutos** (`seguirBloqueado` / `anotarFallo`: los aciertos no gastan cupo, así
  que un comprador puede mirar su pedido las veces que quiera). El token no se
  puede adivinar: no se deriva del id ni del código.
- La respuesta **nunca** trae el teléfono completo, el token ni el id interno.
  Sí trae los productos, los totales, la entrega, el local (nombre, dirección,
  horario, abierto) y el historial.
- **Historial de estados** en `mercado_pedido_eventos` (`pedido_id`, `estado`,
  `ts`): se anota al crear y en cada cambio real de estado. Si el dueño repite el
  mismo estado no se duplica el evento. Los pedidos viejos (sin historial) se
  dibujan con la fecha de creación en el primer paso.
- La página es `web/seguir.html` + `web/tienda-seguir.js`, sobre el sistema de
  diseño de la tienda (`components.css` + `tienda.css`, bloque `.sg-*`). No se
  indexa (`robots: noindex`).
- **En el checkout**, la pantalla de éxito muestra «Seguir mi pedido» con el
  código real del servidor y el enlace; si la nube no respondió, avisa que el
  seguimiento aparecerá cuando el local reciba el pedido.
- **En el panel del dueño**, cada pedido de la nube tiene un botón **Enlace**
  que copia la URL de seguimiento para reenviarla por WhatsApp.

## Reseñas y calificación (Fase 5)

Calificar no es un campo libre: **sólo puede opinar quien compró**, y sólo
cuando el local marcó el pedido como **entregado**. La prueba de compra viaja
con el pedido, igual que el seguimiento.

| Acción | Quién | Qué hace |
|---|---|---|
| `resenas_listar` | público | reseñas visibles + promedio + reparto 5→1 |
| `resena_crear` | público | califica con el `token` del pedido **o** con `codigo` + últimos 4 del teléfono |
| `resenas_panel` | dueño · clave · admin | todas las reseñas, incluidas las ocultas |
| `resena_moderar` | dueño · clave · admin | oculta o vuelve a mostrar (no borra) |

Reglas que importan:

- **Una reseña por pedido**: índice único en `mercado_resenas.pedido_id`. El
  segundo intento responde `409 YA_OPINO`.
- **El autor se guarda abreviado** (`autorPublico`: «Ana P.»). Ni el nombre ni
  el teléfono completos salen nunca de la base; la respuesta pública tampoco
  incluye `pedido_id` ni el token.
- **Ocultar es reversible**: `oculta = true` deja de mostrarse y deja de contar
  en el promedio, pero la reseña queda registrada.
- **Tope de 20 reseñas por IP por hora** (`permitirResena`), best effort en
  serverless, además de la barrera real: hace falta un pedido entregado.
- **El promedio viene redondeado a un decimal**, y viaja ya calculado en tres
  sitios para no pedir nada extra: `locales` (chip y ficha), `resenas_listar`
  (ficha completa) y `ventas_serie` (contador de la pestaña del panel).
- **Al borrar la tienda se borran sus reseñas**, para que no queden huérfanas
  ni reaparezcan si se reabre un local con el mismo id.

Dónde se ve:

| Dónde | Qué |
|---|---|
| **Ficha del local** (MercadoPlacer) | promedio con estrellas en el subtítulo, chip en la lista y bloque de reseñas con reparto 5→1 y las últimas 12 |
| **Enlace del pedido** (`seguir.html`) | con el pedido **entregado**, formulario de 5 estrellas + comentario opcional; después muestra «Gracias por calificar» y no vuelve a pedirlo en ese equipo |
| **Panel del dueño → Reseñas** | promedio, cuántos calificaron, lista con las ocultas marcadas y botón Ocultar/Mostrar |

El formulario aparece sólo cuando el pedido está entregado, y funciona igual si
el comprador entró por el enlace (`token`) o buscando por código + teléfono.

## Avisar al cliente por WhatsApp (panel del dueño)

El comprador no tiene que preguntar «¿ya está?»: el dueño lo avisa desde el
panel, con el mensaje ya escrito.

En la pestaña **Pedidos**, cada pedido de la nube tiene ahora:

| Acción | Qué hace |
|---|---|
| **selector de estado** | mueve el pedido a `Recibido → Preparando → Listo → Entregado → Cancelado` con `pedido_estado` (antes el panel sólo permitía saltar a «entregado») |
| **Avisar** | abre WhatsApp con el teléfono del comprador y un mensaje armado: «Hola Ana, tu pedido MP-7K2QX de Almacén Doña Rosa está listo para retirar. Puedes verlo acá: …/seguir.html?t=…» |
| **Enlace** | copia la URL de seguimiento, por si prefiere mandarla por otro medio |

- **Sin API nueva**: usa el `telefono` y el `seguimiento` que `pedidos_listar` ya
  devolvía y la acción `pedido_estado` que ya existía. La API sigue en 12 funciones.
- **El mensaje cuenta el estado real**: `lo recibimos`, `está en preparación`,
  `está listo para retirar` (o `va en camino` si es delivery), `fue entregado`,
  `fue cancelado`.
- **El teléfono se normaliza** (`numeroWa`): `+56 9 1234 5678`, `9 1234 5678` y
  `09 1234 5678` terminan en `56912345678`. Si el pedido no trae un teléfono
  usable, el botón no aparece; nunca se inventa un número.
- **Se abre en otra pestaña** (`wa.me`), así el panel queda abierto y el dueño
  puede volver. No se manda nada solo: el dueño revisa el texto y aprieta enviar.
- El historial de estados de la Fase 3 se llena solo con este flujo: cada cambio
  del selector deja un evento que el comprador ve en su línea de tiempo.

## Panel del dueño (pestañas y números reales)

La pantalla **Negocio** abre con la tienda elegida en cuatro pestañas, para que el
dueño no tenga que bajar por una lista larga:

| Pestaña | Qué muestra |
|---|---|
| **Resumen** | estado vivo, KPIs del periodo (ventas, ticket, por atender, visitas, conversión, productos), gráfico de ventas por día, más vendidos, pedidos por estado y tráfico de la app |
| **Pedidos** | lista con búsqueda por código/cliente/producto, filtro por estado y **Exportar CSV** |
| **Catálogo** | productos con stock y precio, alta manual, importación CSV/JSON y traída desde el Stock local |
| **Ajustes** | ficha pública (marca, logo, descripción, horario, mínimo, envío, retiro/delivery) y borrado de la tienda |

Todo sale de **una sola llamada**, `ventas_serie`, que exige dueño, clave de 8 o
admin:

```json
{ "accion": "ventas_serie", "local_id": "…", "dias": 7 }
```

- **Serie diaria en `America/Santiago`**, no en UTC: a las 21:00 de Chile ya es el
  día siguiente en UTC y las ventas de la noche caían en el día equivocado. Los
  días sin ventas se rellenan con `generate_series` y llegan en cero, para que el
  gráfico no mienta saltándose días.
- **Los pedidos cancelados no suman** ni en la serie, ni en el top, ni en los
  totales. El monto del top se recalcula con lo guardado en el pedido, nunca con
  lo que mandó el comprador.
- **Ticket promedio** = ventas ÷ pedidos del periodo (0 si no hay pedidos).
- **Visitas**: la tabla `visitas` **no distingue local**, así que el número es de
  toda la app y el panel lo dice en la tarjeta de tráfico (`alcance: 'app'`). La
  conversión es pedidos ÷ visitas de la app; queda en `null` si no hay visitas.
- **Top de productos**: máximo 8, por monto, desarmando el JSON `items` de los
  pedidos del periodo.
- Si la tabla `visitas` todavía no existe (nadie abrió el visor 3D), la acción
  devuelve `visitas: null` en vez de fallar.

El panel no depende de librerías: el gráfico son barras en CSS y el CSV se arma en
el navegador con separador `;` y BOM, para que Excel en Chile abra los acentos
bien. La lista de pedidos se filtra sin acentos (`normalizarBusqueda`).

## Panel de plataforma (administración)

La pantalla **Plataforma** (`#plataforma`) es la vista de todo el sistema, para el
dueño de la app y no para el dueño de una tienda. No se entra con la cuenta: se
entra con el **token de administración** (`FABRI_API_TOKEN`), que no viaja en el
código. Se pega una vez en el campo del candado; queda en `sessionStorage` (muere
al cerrar la pestaña) y sólo pasa a `localStorage` si se marca **«Recordar en este
equipo»**. El campo se vacía al entrar y el token nunca se vuelve a pintar.

**No hay endpoint nuevo.** Reusa cuatro llamadas que ya existían:

| Llamada | Para qué | Auth |
|---|---|---|
| `GET /api/auth?diag=1` | tablas presentes y último latido (`ts`, `ok`, `ms`) | público |
| `POST /api/mercado { accion: "resumen" }` | tiendas, tiendas abiertas, productos, pedidos, `tope_plan` | token admin |
| `POST /api/auth { accion: "usuarios" }` | cuentas sin hash (correo, nombre, rol, términos, último login) | token admin |
| `GET /api/visitas?dias=N` | total, únicos, hoy, ayer, canales con `pct`, por día, rutas, países | token admin |

Qué se ve, en el orden del sistema de diseño: estado vivo → periodo (7/30 días) →
seis KPIs → visitas por día (gráfico protagonista) → canales y rutas/países →
cuentas con búsqueda sin acentos → salud de la base. Si una de las cuatro
llamadas responde **401**, el panel lo trata como token inválido y lo dice; una
caída de una no tumba a las otras (`Promise.allSettled`).

Detalles que importan:

- `tope_plan` es un **objeto** (`{ gratis, pro }`, productos por plan), no un
  número: se muestra como «productos: 300 gratis · 3.000 pro».
- Las barras de visitas rellenan con cero los días sin datos y se cortan en UTC,
  porque `visitas` agrupa con `date_trunc('day', ts)` en UTC.
- La entrada al panel aparece en **Cuenta → Panel de plataforma**, sólo cuando la
  sesión de nube tiene `rol === 'owner'`. La pantalla igual queda protegida por el
  token: el rol sólo evita mostrar el botón a quien no lo necesita.

## Pedido endurecido (precio, stock y rastro)

El pedido no se cree lo que manda el teléfono. Lo que importa:

| Regla | Qué hace |
|---|---|
| **Precio del catálogo** | cada línea se busca en `mercado_productos` por `sku` o por nombre comparable; el precio lo pone el servidor. Una línea fuera del catálogo se rechaza con `NO_CATALOGO` |
| **Stock real** | si el producto tiene stock, no se puede pedir más; se descuenta dentro de la misma transacción, con `stock >= cantidad` como condición atómica |
| **Todo o nada** | descontar stock, crear el pedido y anotar el primer evento van en una transacción: si el stock no alcanza, no queda un pedido a medias |
| **Idempotencia** | el cliente manda `idempotencia`; repetir el envío (doble toque, red que se corta) devuelve el mismo pedido con `repetido: true` en vez de crear otro |
| **Datos usables** | exige nombre (≥2) y teléfono (≥8 dígitos): son la única forma de avisar y de recuperar el pedido sin enlace |
| **Topes** | 100 líneas por pedido y $5.000.000 de subtotal |
| **Estados terminales** | un pedido `entregado` o `cancelado` ya no se mueve (`409 TERMINADO`); la fila se bloquea con `FOR UPDATE` para que dos toques no se pisen |
| **Cancelar devuelve stock** | al cancelar se devuelven las unidades que el pedido había descontado, una sola vez |
| **Código único** | índice único en `codigo`; si choca, se genera otro (hasta 5 intentos) |

### Rastro de acciones

`mercado_pedido_eventos` guarda `estado`, `ts`, **`actor`** y **`nota`**:

- `comprador` → «pedido creado (retiro)» / «(delivery)».
- `dueño` → «marcado como en preparación», «marcado como listo», «marcado como entregado».
- `sistema` → lo mismo cuando lo hace el token admin.
- Al cancelar con stock devuelto, la nota lo dice: «… · stock devuelto».

El panel del dueño muestra ese historial en cada pedido (desplegable «Historial · N»), y `pedidos_listar` lo entrega junto con el pedido, sin una llamada por pedido.

### Avisos al dueño

El local también puede recibir el pedido sin tener el panel abierto:

- En **Ajustes → Avisos del local** se activa (permiso del navegador al tocar el
  botón). Se suscribe con `push_local_suscribir`, que exige dueño o clave; hasta
  5 dispositivos por tienda.
- Cada pedido nuevo manda «Nuevo pedido MP-XXXXX · $3.980 · Ana · retiro» y al
  tocarlo abre `/app/#negocio`.
- El aviso sale **después del commit** y con tope de 1 s por dispositivo: si el
  push tarda, el pedido ya está guardado y el comprador recibe su código igual.
  Un fallo del aviso nunca convierte un pedido bueno en error.
- El service worker de la app (`/app/sw.js`) es el que recibe el aviso; el del
  comprador (`/sw-push.js`, raíz) sigue siendo aparte.

### Contador del panel

- **Con nube**: el número sale de `pedidos_listar` (`total`, `nuevos`, `abiertos`), no del tamaño de la página. La pestaña y la tarjeta muestran el mismo total, y un chip aparte dice cuántos hay **por atender**.
- **Sin conexión**: cuenta lo que quedó en este teléfono y lo dice (`5 · local`), en vez de mostrar un número que no es.

## Avisos push del pedido

El comprador puede pedir que le avisen **sin instalar nada**: desde la página de
seguimiento, con el mismo enlace del pedido, activa las notificaciones y el
local le avisa solo cuando el estado cambia.

| Pieza | Dónde |
|---|---|
| VAPID (JWT ES256) y cifrado `aes128gcm` (RFC 8291) sin dependencias | `api-telefono/api/_push.js` |
| Tabla `mercado_push` y acciones `push_suscribir` / `push_baja` | `api-telefono/api/mercado.ts` |
| Envío al cambiar de estado (`pedido_estado`), en mejor esfuerzo | `api-telefono/api/mercado.ts` |
| Service worker de avisos, en la raíz y sin caché | `web/sw-push.js` |
| Bloque «Avisarme cuando cambie» | `web/tienda-seguir.js`, `.sg-avisos` en `web/tienda.css` |

Decisiones que importan:

- **No hay dependencias nuevas.** `node:crypto` firma el JWT de VAPID
  (`dsaEncoding: 'ieee-p1363'`, que es el formato de JWS) y hace el cifrado del
  contenido: ECDH con la clave del navegador, HKDF-SHA256 y AES-128-GCM. El
  servicio de push del navegador nunca ve el texto ni el enlace.
- **El permiso se pide al tocar el botón**, nunca al cargar la página. Si el
  navegador no soporta push (o el permiso está bloqueado), el bloque se explica
  y no se finge un botón que no va a funcionar.
- **El service worker de avisos va en la raíz** (`/sw-push.js`) porque
  `seguir.html` está fuera del alcance de `/app/sw.js`. No tiene `fetch`: no
  cachea ni intercepta nada, así que la app y el sitio siguen igual. El de
  `/app/` sigue mandando dentro de `/app/`.
- **La suscripción se ata al pedido**: se identifica con el token del enlace o
  con el código + últimos 4 del teléfono, igual que el seguimiento. Máximo 5
  dispositivos por pedido; el mismo navegador se actualiza en vez de duplicarse.
- **El `endpoint` nunca se devuelve.** Es una URL de capacidad: quien la tiene
  puede mandar avisos a ese navegador. En la base se guarda su `sha256` para el
  índice único.
- **El aviso no lleva datos de más**: título = local, cuerpo corto según el
  estado, código del pedido y el enlace de seguimiento. Nada de teléfono ni
  nombre completo.
- **Si el push falla, el pedido cambia igual.** El envío va después de guardar,
  con tope de 2 s por dispositivo y 3 dispositivos por aviso; una suscripción
  muerta (404/410) se borra sola. `pedido_estado` devuelve `avisados` con cuántos
  salieron.
- **Sin `VAPID_PUBLIC`/`VAPID_PRIVATE` el push se apaga solo**: el seguimiento
  responde `push.disponible: false` y no muestra el bloque. La API no falla.

## Pruebas

```sh
node tests/web/negocio.js     # 118 comprobaciones: parsers, filtros, CSV, gráfico, enlace de seguimiento, aviso por WhatsApp, contrato HTML/API/mapa
node tests/web/plataforma.js  # 57 comprobaciones: puras, ids, seguridad del token, endpoints, precache
node tests/web/seguimiento.js # 70 comprobaciones: código, teléfono, estados, línea de tiempo, contrato API/HTML
node tests/web/resenas.js     # 83 comprobaciones: contrato de reseñas, estrellas, reparto, privacidad, panel
node tests/web/push.js        # 92 comprobaciones: cifrado ida y vuelta, VAPID, comprador y dueño, service workers
node tests/web/pedidos.js     # 36 comprobaciones: precio/stock del servidor, idempotencia, estados, contador e historial
node tests/web/auth-nube.js   # incluye CORE_ROOT_EMAIL y promoción a owner
node tests/web/diseno.js      # shell, sistema visual y offline
node tests/web/trafico.js     # capa de tráfico del mapa
bash tests/arranque/correr.sh
```

La prueba de API contra producción se hace con una cuenta desechable y se
borra al terminar (registrar → entrar → `local_crear` → `local_mio` →
`productos_subir` → `pedidos_listar` → `local_borrar` → borrar cuenta).

`ventas_serie` se probó igual contra producción (cuenta + tienda + 2 pedidos →
7 y 30 días → 401 sin sesión y con otra cuenta → limpieza): 24 comprobaciones en
verde. El panel se revisó con un banco de pruebas que carga la sección real de
`index.html`, el `styles.css` y el `negocio.js` reales con respuestas simuladas,
capturado a 390 px en las cuatro pestañas y en 7 y 30 días.

El panel de plataforma se probó contra la API real con el token de administración
(diagnóstico, `resumen`, `usuarios`, `visitas?dias=7` y 401 con un token falso):
15 comprobaciones en verde. Visualmente se revisó igual, con un banco que carga
`s-plataforma`, el CSS real y `plataforma.js` con respuestas simuladas, a 390 px:
candado cerrado, panel abierto, 7 días, 30 días y búsqueda de cuentas. Ahí se
corrigieron el campo del token pegado al botón y la fila «Tablas» de salud.

El seguimiento se probó contra producción con cuenta y tienda desechables:
pedido público → abrir por token → abrir por código + teléfono (con y sin
prefijo) → 404 con teléfono o código equivocados → 400 sin datos → avanzar a
`visto` → comprobar el evento nuevo → repetir el mismo estado (no duplica) →
borrar la tienda y comprobar que el enlace deja de abrir: **33 comprobaciones en
verde**. La página se revisó a 390 px con el HTML, el CSS y el JS reales y
respuestas simuladas: formulario vacío y pedido «en camino» con línea de tiempo.
Ahí salió que `ts` llega como texto ISO y la línea de tiempo quedaba sin horas.

El aviso por WhatsApp se probó contra producción: pedido real → teléfono
normalizado → enlace `wa.me` → mensaje con código, local y enlace → pasar a
«listo» → el mensaje y el enlace del comprador reflejan el estado nuevo:
**17 comprobaciones**. La app publicada se revisó aparte (**13**): el JS y el
CSS desplegados traen el botón y el selector, y el enlace del mensaje abre el
pedido.

Las reseñas se probaron contra producción en dos tandas. La API sola, con dos
pedidos y una tienda desechable: sin entregar → 409, entregar los dos,
calificar por enlace y por código, repetir el mismo pedido → `YA_OPINO`,
0/6 estrellas → 400, público con autor abreviado y sin teléfono ni token,
ocultar → el promedio cambia y el público ve una, volver a mostrar, 401 sin
autorización, y borrar la tienda se lleva sus reseñas (**39**). La cadena
completa con navegador real sobre la página publicada (**18**): el formulario
aparece con el pedido entregado, calificar por API publica la reseña, la ficha
y el `locales` la traen, el panel la ve y el resumen la cuenta, ocultar la saca
del público.

Los avisos push se probaron primero sin red: el cifrado ida y vuelta (el
servidor cifra, el "navegador" descifra con su clave), la firma del JWT de VAPID
verificada con la clave pública y un **envío real a un servidor de push falso**
que comprueba método, cabeceras `Authorization`/`Content-Encoding`/`TTL` y
descifra lo recibido (**68 comprobaciones**). Después contra la API real, con
cuenta y tienda desechables: el seguimiento publica la clave, la suscripción se
guarda y no duplica, funciona por token y por código, se rechazan endpoint
`http`, token inexistente y claves basura, el cambio de estado responde
`avisados: 0` sin romperse aunque el endpoint no exista, la baja borra una y sólo
una vez, y un pedido entregado ya no acepta suscripciones (**25**).

Visualmente, a 390 px: la ficha con reseñas y sin ellas, el formulario en
`seguir.html`, la pestaña Reseñas del panel y el bloque de avisos en sus dos
estados (activar / activado). Ahí salieron dos bugs reales: el
formulario pintaba cinco estrellas **por botón** (25 en total, y eso desbordaba
la tarjeta), y el encabezado y los autores dependían del color heredado del
contenedor. Las cinco pestañas del panel tampoco cabían con el contador en
píldora: el número pasó a ir sin fondo.
