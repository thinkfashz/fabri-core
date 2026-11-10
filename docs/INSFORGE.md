# Conectar la base de InsForge

Guía para dejar la nube del inventario operativa y entender qué toca cada pieza.
La app **no** habla con Postgres: habla con `fabri-api`, un proxy delgado en
Vercel que guarda la cadena de conexión. Así el teléfono nunca lleva
credenciales de base y se puede rotar la clave sin reinstalar la APK.

```
APK (SQLite local)                Vercel                    InsForge
┌──────────────────┐   Bearer   ┌──────────────┐   SQL    ┌──────────────┐
│ inv_productos    │ ─────────► │  fabri-api   │ ───────► │  PostgreSQL  │
│ sync_ts = 0      │  JSON      │ /api/        │  pg      │ inv_productos│
│ (pendientes)     │ ◄───────── │ inventario   │ ◄─────── │              │
└──────────────────┘            └──────────────┘          └──────────────┘
                                       ▲
                                       │ mismas acciones
                                  web / panel
```

| Pieza | Dónde vive | Qué guarda |
|---|---|---|
| Base local | SQLite dentro de la APK | Todo el inventario, aunque no haya red |
| `fabri-api` | Vercel (Node) | `INSFORGE_DATABASE_URL` y `FABRI_API_TOKEN` |
| InsForge | Postgres administrado | La copia en la nube de `inv_productos` |

La sincronización es **manual y por lotes**: la app marca cada cambio con
`sync_ts`; al tocar *Sincronizar* sube sólo los pendientes. Si falla la red, el
lote queda pendiente y se reintenta en la próxima.

---

## 1 · Crear el proyecto en InsForge

1. Entrá a <https://insforge.app> y creá un proyecto.
2. En el panel del proyecto: **Connect → Connection string**.
3. Copiá la cadena completa, con esta forma:

```
postgresql://usuario:clave@host:5432/insforge
```

> La cadena es un secreto. No va en la APK, ni en `opencode.jsonc`, ni en el
> repositorio. Sólo en las variables de entorno de Vercel.

---

## 2 · Crear la tabla

Hay dos caminos y hacen lo mismo.

### Automático (recomendado)

La primera llamada con `accion: "asegurar"` crea la tabla y los índices. Es la
única acción que no exige token, porque sólo ejecuta `CREATE TABLE IF NOT EXISTS`
con columnas fijas (sin datos del cliente y sin `DROP`):

```sh
curl -s -X POST "https://fabri-api.vercel.app/api/inventario" \
  -H "Content-Type: application/json" \
  -d '{"accion":"asegurar"}'
```

Respuesta esperada:

```json
{ "ok": true, "accion": "asegurar", "tabla": "inv_productos", "columnas": ["codigo", "..."] }
```

### Manual (editor SQL de InsForge)

```sql
CREATE TABLE IF NOT EXISTS inv_productos (
  codigo       TEXT PRIMARY KEY,
  nombre       TEXT NOT NULL DEFAULT '',
  marca        TEXT NOT NULL DEFAULT '',
  categoria    TEXT NOT NULL DEFAULT 'abarrotes',
  unidad       TEXT NOT NULL DEFAULT 'unidad',
  costo        NUMERIC NOT NULL DEFAULT 0,
  precio       NUMERIC NOT NULL DEFAULT 0,
  stock        INTEGER NOT NULL DEFAULT 0,
  stock_minimo INTEGER NOT NULL DEFAULT 0,
  iva          INTEGER NOT NULL DEFAULT 19,
  proveedor    TEXT NOT NULL DEFAULT '',
  origen       TEXT NOT NULL DEFAULT 'manual',
  notas        TEXT NOT NULL DEFAULT '',
  ficha        JSONB NOT NULL DEFAULT '{}'::jsonb,
  actualizado  BIGINT NOT NULL DEFAULT 0,
  nube_ts      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_productos_categoria
  ON inv_productos (categoria);
CREATE INDEX IF NOT EXISTS idx_inv_productos_actualizado
  ON inv_productos (actualizado);
```

### Columnas

| Columna | Tipo | Para qué |
|---|---|---|
| `codigo` | `TEXT` PK | Código de barras o interno. Es la clave del upsert |
| `nombre` | `TEXT` | Nombre del producto (obligatorio para subir) |
| `marca`, `categoria`, `unidad` | `TEXT` | Clasificación y formato de venta |
| `costo`, `precio` | `NUMERIC` | Dinero. Se devuelve casteado a `float8` |
| `stock`, `stock_minimo` | `INTEGER` | Existencias y umbral de alerta |
| `iva` | `INTEGER` | Porcentaje (19 por defecto) |
| `proveedor`, `origen`, `notas` | `TEXT` | Trazabilidad |
| `ficha` | `JSONB` | Ficha ampliada (hasta 4 KB) |
| `actualizado` | `BIGINT` | Epoch en segundos del último cambio local |
| `nube_ts` | `TIMESTAMPTZ` | Sello de la nube; lo pone Postgres |

La base local tiene además `creado` y `sync_ts`; esos dos no viajan: son
contabilidad del teléfono.

---

## 3 · Configurar Vercel

Proyecto `fabri-api` → **Settings → Environment Variables**:

```
INSFORGE_DATABASE_URL=postgresql://usuario:clave@host:5432/insforge
FABRI_API_TOKEN=un-token-largo-y-propio
```

- `INSFORGE_DATABASE_URL`: la cadena del paso 1.
- `FABRI_API_TOKEN`: inventalo (32+ caracteres aleatorios). Es el mismo que se
  pega en la app. Sin él, toda acción salvo `asegurar` responde `401`.

Después: **Deployments → Redeploy**. Las variables no se aplican solas.

Verificación sin tocar datos:

```sh
curl -s "https://fabri-api.vercel.app/api/inventario?diag=1" | jq
```

```json
{
  "ok": true,
  "servicio": "fabri-api",
  "tabla": "inv_productos",
  "base_configurada": true,
  "token_configurado": true,
  "tabla_existe": true,
  "base_detalle": "tabla presente"
}
```

Si `tabla_existe` es `false`, corré `asegurar`. Si `base_configurada` es `false`,
faltó la variable o el redeploy.

---

## 4 · Configurar la app

En la APK: **Inventario → Integración → Nube**.

| Campo | Valor |
|---|---|
| URL | `https://fabri-api.vercel.app` (o tu dominio) |
| Token | el mismo `FABRI_API_TOKEN` |

Guardá y probá. La prueba real es `accion: "resumen"`: si InsForge responde,
el panel muestra el total de productos y cuántos están con stock bajo.

En la vista de inventario hay un bloque **«Conectar la base de InsForge»** con
los mismos pasos, los bloques para copiar y un botón *Probar mi nube*.

---

## 5 · Contrato de `fabri-api`

Endpoint: `POST https://fabri-api.vercel.app/api/inventario`
Cabeceras: `Content-Type: application/json` y `Authorization: Bearer <token>`.

| Acción | Cuerpo | Devuelve |
|---|---|---|
| `asegurar` | `{}` | Crea tabla e índices. No exige token |
| `subir` | `{ productos: [ … ] }` | Upsert por `codigo`; máx. 500 por lote |
| `bajar` | `{ limite?, offset? }` | Lista paginada (máx. 500) |
| `buscar` | `{ codigo }` o `{ q }` | Un producto exacto o búsqueda por texto |
| `borrar` | `{ codigos: [ … ] }` | Elimina por código; máx. 200 |
| `resumen` | `{}` | Totales, valor de venta, utilidad y stock bajo |

Ejemplos:

```sh
TOKEN="tu-token"

# Subir dos productos (upsert: repetir no duplica)
curl -s -X POST "https://fabri-api.vercel.app/api/inventario" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"accion":"subir","productos":[
        {"codigo":"7801234567890","nombre":"Arroz grado 1","precio":1490,"stock":24},
        {"codigo":"7809876543210","nombre":"Aceite 1 L","precio":3290,"stock":8,"stock_minimo":12}
      ]}'

# Buscar por código
curl -s -X POST "https://fabri-api.vercel.app/api/inventario" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"accion":"buscar","codigo":"7801234567890"}'

# Resumen
curl -s -X POST "https://fabri-api.vercel.app/api/inventario" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"accion":"resumen"}'
```

Detalles del contrato que importan:

- `subir` **omite** filas sin `codigo` o sin `nombre` y las cuenta en `omitidos`.
- `costo` y `precio` se acotan a ±1.000.000.000; `ficha` se descarta si supera
  4 KB o no es un objeto.
- `bajar` devuelve `costo` y `precio` como números (`::float8`), no como cadenas.
- `buscar` con `q` escapa `%` y `_` para que no alteren el `LIKE`.
- Cualquier error de base devuelve `500` con `codigo: "ERROR_BASE"`.

---

## 5 bis · Cuentas de la app (login)

Hasta la versión 56 el login vivía **sólo** en el SQLite del navegador: la
cuenta no viajaba entre dispositivos y se perdía al borrar los datos del sitio.
Ahora la cuenta vive en InsForge y el navegador guarda una copia para trabajar
sin red.

```
navegador (SQLite espejo)            Vercel                 InsForge
┌────────────────────┐  POST JSON  ┌────────────┐  SQL   ┌────────────────┐
│ users / sessions   │ ──────────► │  fabri-api │ ─────► │ core_usuarios  │
│ (token local)      │ ◄────────── │  /api/auth │ ◄───── │ core_sesiones  │
└────────────────────┘  token+exp  └────────────┘        └────────────────┘
```

### Tablas

```sql
CREATE TABLE IF NOT EXISTS core_usuarios (
  id              BIGSERIAL PRIMARY KEY,
  email           TEXT UNIQUE NOT NULL,
  nombre          TEXT NOT NULL DEFAULT '',
  pass_hash       TEXT NOT NULL,          -- PBKDF2-SHA256, 120.000 iteraciones
  pass_salt       TEXT NOT NULL,          -- sal única por cuenta
  iter            INTEGER NOT NULL DEFAULT 120000,
  rol             TEXT NOT NULL DEFAULT 'member',
  creado          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_login    TIMESTAMPTZ,
  intentos        INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS core_sesiones (
  id          BIGSERIAL PRIMARY KEY,
  usuario_id  BIGINT NOT NULL REFERENCES core_usuarios(id) ON DELETE CASCADE,
  token_hash  TEXT UNIQUE NOT NULL,       -- SHA-256; el token en claro NO se guarda
  dispositivo TEXT NOT NULL DEFAULT '',
  creado      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira      TIMESTAMPTZ NOT NULL,
  revocada    BOOLEAN NOT NULL DEFAULT false
);
```

Se crean con `POST {"accion":"asegurar"}` (público: sólo DDL con columnas fijas).

### Acciones

| Acción | Cuerpo | Devuelve |
|---|---|---|
| `asegurar` | `{}` | Crea las dos tablas y sus índices |
| `registrar` | `{ email, nombre?, pass, codigo?, dispositivo? }` | `usuario`, `token`, `expira` |
| `entrar` | `{ email, pass, dispositivo? }` | `usuario`, `token`, `expira` |
| `sesion` | Bearer del usuario | `usuario`, `expira` |
| `salir` | Bearer del usuario | Revoca esa sesión |
| `usuarios` | Bearer **admin** | Lista sin hashes |
| `borrar` | `{ email, pass }` | Borra la propia cuenta y sus sesiones |

### Cómo conviven nube y dispositivo

| Situación | Qué pasa |
|---|---|
| Alta con red | La cuenta se crea en InsForge y se **espeja** en el SQLite local con la misma contraseña (hash propio) |
| Entrada con red | Primero prueba la copia local; si no existe o la clave no coincide, prueba la nube y espeja |
| Entrada sin red | Usa la copia local: se puede trabajar sin conexión |
| Alta sin red | Crea la cuenta **sólo en el dispositivo** y avisa al entrar |
| Casilla «sólo en este dispositivo» | No llama a la nube, aunque haya red |
| Cerrar sesión | Revoca la sesión local y la de InsForge |

El inventario, las boletas, las claves de IA y la planilla **siguen locales**.
La cuenta no da acceso a datos de nadie: el inventario y el mercado usan
`local_id` + `clave` de 8 caracteres, que es otra credencial.

### Seguridad y límites honestos

| Regla | Detalle |
|---|---|
| Contraseñas | PBKDF2-HMAC-SHA256, 120.000 iteraciones, sal única. Nunca se guarda la contraseña |
| Sesiones | Token de 256 bits; en la base sólo su SHA-256; vencen a los 30 días |
| Fuerza bruta | 8 fallos bloquean la cuenta 10 minutos (contador en la fila) |
| Enumeración | Correo inexistente y clave mala devuelven el mismo código y tardan lo mismo |
| Registro abierto | Por defecto cualquiera con la URL puede crear una cuenta. Para cerrarlo: `CORE_INVITE` (código obligatorio) y `CORE_MAX_CUENTAS` (tope) |
| Límite por IP | 8 registros por hora y por instancia; es *best effort* en serverless, no un WAF |
| Rol `owner` | Es la primera cuenta creada en la base. No es permiso sobre datos |

### Variables nuevas en Vercel (`fabri-api`)

| Nombre | Para qué |
|---|---|
| `CORE_INVITE` | opcional: si está, `registrar` exige ese código |
| `CORE_MAX_CUENTAS` | opcional: tope de cuentas (200 por defecto) |

### Probar

```sh
# Estado (público)
curl -4 -s "https://fabri-api.vercel.app/api/auth?diag=1" | jq '{base_configurada, tablas}'

# Crear tablas
curl -4 -s -X POST "https://fabri-api.vercel.app/api/auth" \
  -H "Content-Type: application/json" -d '{"accion":"asegurar"}'

# Crear una cuenta de prueba
curl -4 -s -X POST "https://fabri-api.vercel.app/api/auth" \
  -H "Content-Type: application/json" \
  -d '{"accion":"registrar","email":"prueba@local.cl","pass":"clave-de-prueba"}'
```

> El `/api/auth` del proyecto web (`web/api/auth/index.go`, cuentas en Vercel
> Blob) quedó **sin uso**: el login real es el de `fabri-api`. Se conserva como
> referencia y responde 501 mientras no exista `BLOB_READ_WRITE_TOKEN`.

---

## 6 · REST directo de InsForge (sin `fabri-api`)

InsForge expone PostgREST. Sirve para probar la base o para integrar otro
cliente, pero **no** para la APK: exigiría llevar una clave de base al teléfono.

```
GET    https://<app>.insforge.app/api/database/records/inv_productos
POST   https://<app>.insforge.app/api/database/records/inv_productos
PATCH  https://<app>.insforge.app/api/database/records/inv_productos?codigo=eq.7801234567890
DELETE https://<app>.insforge.app/api/database/records/inv_productos?codigo=eq.7801234567890
```

Cabeceras:

```
Authorization: Bearer <jwt-o-anon-key>
Content-Type: application/json
Prefer: return=representation
```

Ejemplos:

```sh
APP="https://tu-app.insforge.app"
KEY="tu-anon-key"

# Leer 5 productos
curl -s "$APP/api/database/records/inv_productos?limit=5&order=nombre.asc" \
  -H "Authorization: Bearer $KEY"

# Insertar (el POST va con un array)
curl -s -X POST "$APP/api/database/records/inv_productos" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '[{"codigo":"7801234567890","nombre":"Arroz grado 1","precio":1490,"stock":24}]'

# Actualizar por clave
curl -s -X PATCH "$APP/api/database/records/inv_productos?codigo=eq.7801234567890" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"stock":30}'
```

Filtros útiles: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `in`,
`is`. Paginación con `limit` y `offset`; orden con `order=columna.asc|desc`.

> El REST directo **no hace upsert** por sí solo. Para no duplicar, usá
> `Prefer: resolution=merge-duplicates` o seguí usando `fabri-api`, que ya
> resuelve el `ON CONFLICT (codigo)`.

---

## 7 · Seguridad

| Regla | Por qué |
|---|---|
| La cadena de Postgres sólo vive en Vercel | Si se filtra la APK, no se filtra la base |
| El token de la app es propio y revocable | Se cambia en Vercel sin recompilar |
| `asegurar` no acepta datos del cliente | No puede usarse para inyectar SQL |
| Nombres de columna fijos en el servidor | El cliente no elige qué se escribe |
| Valores siempre parametrizados (`$1…$15`) | Sin concatenación de SQL |
| Contraseñas de la app | PBKDF2 120k con sal única; la base nunca ve la contraseña |
| Tokens de sesión | Sólo su SHA-256 en `core_sesiones`; vencen a los 30 días |
| `GET ?diag=1` no devuelve filas ni entorno | Diagnóstico público sin fuga |

El token viaja en el `Authorization` de cada request. Usá HTTPS (Vercel e
InsForge ya lo fuerzan) y no lo pegues en capturas ni en el log.

---

## 8 · Diagnóstico

| Síntoma | Causa probable | Arreglo |
|---|---|---|
| `401 SIN_TOKEN` | Token de la app ≠ `FABRI_API_TOKEN` | Copiarlo de nuevo en Integración → Nube |
| `503 SIN_BASE` | Falta `INSFORGE_DATABASE_URL` | Cargarla en Vercel y redeployar |
| `500 ERROR_BASE` + `ECONNREFUSED` | InsForge pausó el proyecto o la cadena está mal | Reactivar el proyecto / recopiar la cadena |
| `409 YA_EXISTE` | El correo ya tiene cuenta | Entrar con esa contraseña |
| `429 BLOQUEADO` | 8 intentos fallidos seguidos | Esperar 10 minutos |
| `relation "inv_productos" does not exist` | Nunca se corrió `asegurar` | `POST {"accion":"asegurar"}` |
| Se suben menos productos de los esperados | Filas sin `codigo` o sin `nombre` | Revisar `omitidos` en la respuesta |
| `bajar` tarda | Proyecto dormido | Reintentar; el segundo viaje es rápido |
| La app dice «sin nube» | Falta URL o token en el teléfono | Integración → Nube → Guardar |

Comandos de comprobación:

```sh
# Estado del puente (sin token)
curl -s "https://fabri-api.vercel.app/api/inventario?diag=1" | jq

# ¿Responde el endpoint?
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "https://fabri-api.vercel.app/api/inventario" \
  -H "Content-Type: application/json" -d '{"accion":"asegurar"}'

# Resumen con token
curl -s -X POST "https://fabri-api.vercel.app/api/inventario" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"accion":"resumen"}' | jq
```

---

## 9 · Flujo completo de una sincronización

1. La app guarda un producto en SQLite y pone `sync_ts = 0`.
2. *Sincronizar* lee los pendientes (`sync_ts = 0`) y manda `accion: "subir"`.
3. `fabri-api` valida el Bearer, normaliza cada fila y hace upsert por `codigo`.
4. Si InsForge acepta, la app marca esos productos con `sync_ts = ahora`.
5. Si falla, no marca nada: el lote sigue pendiente y se reintenta después.
6. El escáner consulta primero la base local; si no está, prueba `accion:
   "buscar"` en la nube y después las bases libres.

Con eso, dos teléfonos pueden trabajar sobre el mismo inventario sin pisarse:
el último `actualizado` gana en el upsert.
