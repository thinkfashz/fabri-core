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
| `CORE_ROOT_EMAIL` | opcional | correo que siempre tiene rol `owner` |
| `VISITAS_SAL` | opcional | sal del contador de visitas |

### `forge-core-stock` (web)

No necesita secretos para este flujo. La web llama a la API pública; el token
de sesión vive en `localStorage` (`fcore.nube`) y viaja como `Bearer`.

## Contrato de la API (`/api/mercado`)

Autorización, en este orden:

1. **Admin**: `Authorization: Bearer $FABRI_API_TOKEN`.
2. **Cuenta dueña**: `Authorization: Bearer <token de /api/auth>` y
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
| `pedido_crear` | público | pedido del comprador (el servidor recalcula totales) |

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

## Pruebas

```sh
node tests/web/negocio.js     # 56 comprobaciones: parsers, contrato HTML/API/mapa
node tests/web/auth-nube.js   # incluye CORE_ROOT_EMAIL y promoción a owner
node tests/web/diseno.js      # shell, sistema visual y offline
node tests/web/trafico.js     # capa de tráfico del mapa
bash tests/arranque/correr.sh
```

La prueba de API contra producción se hace con una cuenta desechable y se
borra al terminar (registrar → entrar → `local_crear` → `local_mio` →
`productos_subir` → `pedidos_listar` → `local_borrar` → borrar cuenta).
