# MercadoPlacer en la nube · contrato, seguridad y límites

> Cómo quedó el marketplace conectado a InsForge, qué nivel de seguridad da hoy
> y qué permite el plan gratis de Vercel e InsForge. Verificado en producción
> el 2026-11-05.

## 1. Qué se conectó

Antes el registro de locales era un JSON estático (`web/datos/tiendas.json`): el
catálogo no viajaba entre teléfonos. Ahora los locales, sus catálogos y sus
pedidos viven en **InsForge (Postgres)** y se sirven por **`fabri-api`**.

```
  Sitio (PWA)  ─┐
  APK Android  ─┼──►  fabri-api /api/mercado  ──►  InsForge (Postgres)
  Panel dueño  ─┘         (Vercel, Node)            mercado_locales
                                                    mercado_productos
                                                    mercado_pedidos
```

- **El sitio** (`fabri-core-web`) no toca Postgres: llama a `fabri-api` por HTTPS.
  `placer.js` lee los locales de la nube y, si la API no responde, cae al JSON
  del CDN (respaldo offline). Al pagar, sube el pedido (`pedido_crear`).
- **La APK** usa la **misma base**: ya sube su inventario por `/api/inventario`
  (tabla `inv_productos`) y puede usar `/api/mercado` con las mismas llaves para
  publicar su catálogo y leer pedidos. Una sola base, varias superficies.
- **El dueño** entra a *Negocio* en el sitio, escribe el **ID de su local** y su
  **clave** de 8 caracteres, y desde ahí ve pedidos reales, prende/apaga el local
  y avanza el estado de cada pedido. Funciona desde cualquier teléfono.

## 2. Las tres tablas

| Tabla | Clave | Qué guarda |
|---|---|---|
| `mercado_locales` | `id` | local: nombre, rubro, ícono, teléfono, dirección, comuna, lat/lon, `abierto`, horario, `minimo`, `entrega` (jsonb), `envio`, `demo`, `activo`, `plan`, `clave_hash` |
| `mercado_productos` | `(local_id, sku)` | catálogo: nombre, precio, stock, categoría, unidad |
| `mercado_pedidos` | `id` | pedido: código, cliente, teléfono, items (jsonb), subtotal, envío, total, entrega, dirección, nota, estado |

Se crean solas con `POST { "accion": "asegurar" }` (solo `CREATE TABLE IF NOT
EXISTS`, sin datos del cliente y sin `DROP`). Índices por local y por fecha.

## 3. Contrato de `/api/mercado`

| Acción | Quién | Qué hace |
|---|---|---|
| `GET /api/mercado` | público | estado del puente (nunca devuelve filas ni secretos) |
| `GET ?accion=locales` / `POST {accion:"locales"}` | público | locales activos con catálogo |
| `asegurar` | público | crea las tablas |
| `local_crear` | ADMIN | alta de local · **devuelve la clave una sola vez** |
| `local_actualizar` | DUEÑO/ADMIN | edita datos del local |
| `local_estado` | DUEÑO/ADMIN | ABIERTO/CERRADO |
| `local_activo` | DUEÑO/ADMIN | oculta/muestra el local |
| `local_borrar` | ADMIN | da de baja el local y sus datos |
| `productos_subir` | DUEÑO/ADMIN | upsert de catálogo (con tope por plan, en transacción) |
| `producto_borrar` | DUEÑO/ADMIN | borra hasta 200 SKUs |
| `pedido_crear` | público | el comprador hace el pedido |
| `pedidos_listar` | DUEÑO/ADMIN | pedidos del local |
| `pedido_estado` | DUEÑO/ADMIN | avanza el pedido (nuevo→visto→listo→entregado/cancelado) |
| `resumen` | ADMIN | conteos globales |

**El servidor manda**: recalcula subtotal, envío y total (no confía en el
cliente) y **rechaza** el pedido si el local está cerrado (`CERRADO`) o si no
llega al mínimo (`BAJO_MINIMO`). El tope del plan se aplica **dentro de una
transacción**: si el lote de productos se pasa, se revierte entero.

## 4. Nivel de seguridad (honesto)

**Lo que está bien y se puede decir sin exagerar:**

| Aspecto | Estado |
|---|---|
| Autenticación de administración | Token Bearer (`FABRI_API_TOKEN`) por variable de entorno; no está en el repo |
| Clave del dueño | 8 caracteres aleatorios; se guarda **solo como SHA-256**; nunca se devuelve en lecturas |
| Autorización por local | El dueño solo puede tocar **su** `local_id`; la clave de otro no sirve |
| Inyección SQL | Sin SQL armado con texto del cliente: nombres de tabla/columna fijos y valores siempre como parámetros de `pg` |
| Validación | Coordenadas acotadas a Chile, textos y números acotados, estados y entregas en listas blancas, cuerpo ≤ 1 MB |
| HTTPS y transporte | Todo por TLS (Vercel + InsForge) |
| Secretos | `INSFORGE_DATABASE_URL` marcada **Sensible** en Vercel; ningún token en el navegador ni en el repo |

**Lo que todavía NO es nivel producción (hay que decirlo tal cual):**

1. **Sin límite de tasa (rate limit).** `pedido_crear` y `asegurar` son
   públicos: alguien podría generar pedidos basura o intentar fuerza bruta
   contra una clave. Mitigación pendiente: límite por IP en el borde.
2. **La clave del dueño viaja en el cuerpo del POST.** Va por HTTPS, pero no
   hay sesión ni caducidad: quien la vea, entra. Es una clave de 8 caracteres
   (≈40 bits): sirve para un panel de local, no para datos sensibles.
3. **CORS abierto (`*`).** Es deliberado y no debilita nada *mientras* no haya
   cookies ni sesiones de navegador: la autenticación es un token explícito. Si
   algún día se agregan cookies, hay que cerrar el CORS.
4. **`asegurar` es público.** Solo crea tablas con columnas fijas; no expone
   datos. Pero es superficie de abuso (crea índices si se llama en bucle).
5. **Un solo token de administración** para todos los locales. Si se filtra,
   hay que rotarlo y re-desplegar. Recomendado: rotar los secretos que se
   pegaron en claro durante el desarrollo (ver §7).

En una frase: **es un MVP con seguridad razonable para un piloto y para vender
integración a locales de barrio, pero todavía le falta el endurecimiento de
borde (rate limit, sesiones firmadas) para llamarlo "grado producción".**

## 5. Límites del plan gratis (verificado)

### Vercel — Hobby (plan actual del proyecto)

| Recurso | Incluido en Hobby |
|---|---|
| **Funciones por despliegue** | **12** (nos topamos con esto: por eso `memoria`+`modelos`+`skills` se fusionaron en `/api/agente`; quedamos en **11**) |
| Transferencia de datos | primeros **100 GB/mes** |
| Invocaciones de función | primeras **1.000.000/mes** |
| Origin transfer | primeros **10 GB/mes** |
| CPU activa | **4 horas/mes** |
| Memoria provisionada | **360 GB-hrs/mes** |
| Despliegues | 100/día, 100/hora |
| Build | 45 min por despliegue, 1 build en paralelo |

> ⚠️ **Hobby es solo para uso personal NO comercial** (las Condiciones de Vercel
> lo dicen expresamente): cobrar a clientes o "publicitar la venta de un
> producto o servicio" exige **Pro** (≈US$20/mes). Vender la integración con el
> plan Hobby tecnicamente funciona, pero **incumple los términos**. Es el punto
> más importante a resolver antes de facturar.

### InsForge — Free

| Recurso | Incluido en Free |
|---|---|
| Usuarios activos/mes | 50.000 |
| **Tamaño de base de datos** | **500 MB** |
| Ancho de banda | **5 GB/mes** |
| Almacenamiento de archivos | 1 GB |
| Llamadas a edge functions | 100.000/mes |
| Build de sitio | 600 min |
| Compute propio | 120 h/mes |
| Inactividad | el proyecto **se pausa tras 1 semana sin uso** |

### ¿Alcanza para ofrecer la integración hasta el tope?

Sí, en lo técnico, y con holgura para empezar:

- **Productos**: cada local tiene hasta **300 productos** (plan `gratis`) o 3000
  (`pro`). 500 MB de Postgres dan para **cientos de locales** con su catálogo.
- **Pedidos**: 1.000.000 de invocaciones/mes ≈ decenas de miles de pedidos.
- **Tráfico**: 100 GB/mes en Vercel y 5 GB/mes en InsForge sobran para un
  piloto de barrio.

Los dos techos reales, en orden de aparición, son: **(a)** el ToS no comercial
de Vercel Hobby y **(b)** los 5 GB/mes de InsForge. Para cobrar, el camino
limpio es Vercel Pro + InsForge Pro (≈US$40-45/mes de costo fijo), que además
sube el tope a funciones ilimitadas y 250 GB de banda.

## 6. Dar de alta un cliente

```sh
# 1) Crea alta.json (plantilla incluida)
node scripts/nueva-tienda.mjs plantilla > alta.json
$EDITOR alta.json

# 2) Alta en la NUBE: crea el local y su catálogo, y devuelve la clave del dueño
node scripts/nueva-tienda.mjs --api alta.json
#   ✓ t-xxx  Nombre del local  (12 productos, mín $5.000)
#     CLAVE DEL DUEÑO: XXXXYYYY   ← se muestra una sola vez

# 3) Le pasas al dueño: ID del local + clave → entra a  Negocio →  Conectar
node scripts/nueva-tienda.mjs --api listar      # ver los locales en la nube
node scripts/nueva-tienda.mjs --api borrar <id> # dar de baja
```

El token de administración se toma de `~/.config/opencode/secrets/fabri-api-token.txt`
o de la variable `FABRI_API_TOKEN`.

## 7. Pendientes

- **Rotar secretos** que se pegaron en claro durante el desarrollo (API key de
  InsForge y contraseña de Postgres): regenerarlos y actualizar
  `INSFORGE_DATABASE_URL` en Vercel.
- **Rate limit** en el borde para `pedido_crear` / `asegurar`.
- **Sesiones firmadas** para el panel del dueño (en vez de la clave en el cuerpo).
- Decidir Vercel Pro antes de facturar (ToS no comercial del plan Hobby).
- Probar el flujo completo en un **teléfono real** (aquí el WebGL no se puede
  verificar).
