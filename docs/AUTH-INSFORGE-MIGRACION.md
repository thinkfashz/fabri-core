# Migración del login a InsForge Auth

**Estado:** fases A y B ejecutadas · fase C (`dual`) en curso
**Fecha:** 18 de noviembre de 2026 · repo `thinkfashz/fabri-core`
**Proyecto InsForge:** `Fabricore` · `b9c9206a-aa7b-4a8c-9dbe-b8cec3774e90`
**URL:** `https://g5b9can6.us-east.insforge.app`

---

## 0. Decisión de arquitectura

**InsForge autentica; `fabri-api` sigue emitiendo la sesión de la app.**

```
Panel / PWA
   │  POST /api/auth { accion:"entrar", email, pass, dispositivo }
   ▼
fabri-api  ──►  POST https://<proj>.insforge.app/api/auth/sessions?client_type=server
   │                                    │
   │                                    └─ InsForge valida la contraseña
   │                                       (hash y usuarios en auth.users)
   │◄── { user:{ id, email, emailVerified }, accessToken, refreshToken }
   │
   ├─ busca/crea core_usuarios por insforge_id
   ├─ emite SU PROPIO token de 30 días (SHA-256 + huella de dispositivo)
   └─ guarda en core_sesiones (igual que hoy)

   ▼
{ ok:true, token:"…", usuario:{ id, email, nombre, rol } }
```

### Por qué no se usa el JWT de InsForge en el resto de la app

Las 27 acciones de `mercado.ts` autorizan contra `core_sesiones` y
`mercado_locales.dueno_id` es FK a `core_usuarios.id` (BIGSERIAL). Cambiar la
autoridad de sesión obligaría a reescribir todas esas consultas y a migrar las
FK. El JWT de InsForge se usa **solo** como prueba de identidad dentro del
login; no entra a la app.

### Qué NO se migra

| Pieza | Se queda como está | Motivo |
|---|---|---|
| `core_usuarios.id` (BIGSERIAL) | sí | es la FK de `mercado_locales.dueno_id`, pedidos y reseñas |
| `core_sesiones` | sí | sesión de 30 días, atada al dispositivo |
| Contrato `/api/auth` | sí | la PWA y los paneles ya lo consumen |
| `core-nube.js` | sí | cero cambios en el cliente |
| Roles (`owner` / `member`) | sí | viven en `core_usuarios.rol` |
| Tope de 200 cuentas | sí | regla de negocio (`CORE_MAX_CUENTAS`) |

---

## 1. Contrato InsForge verificado en vivo

Base: `https://<proyecto>.insforge.app` · siempre `client_type=server` (sin
cookies; el `refreshToken` viene en el body y **no se guarda**).

| Nuestra acción | Llamada a InsForge | Respuesta verificada |
|---|---|---|
| `registrar` | `POST /api/auth/users?client_type=server` | **200** `{ user, accessToken, refreshToken, requireEmailVerification }` |
| `entrar` | `POST /api/auth/sessions?client_type=server` | **200** con `{ method:"password", email, password }` |
| `borrar` | `DELETE /api/auth/users` + admin | **200** `{ deletedCount }` con `{ userIds:[uuid] }` |
| `usuarios` | `GET /api/auth/users?offset&limit&search` + admin | **200** `{ data, pagination }` |
| `diag` | `GET /api/auth/public-config` | **200** política pública |
| `recuperar` (paso 1) | `POST /api/auth/email/send-reset-password` | **202** mensaje genérico |
| `recuperar_codigo` (paso 2a) | `POST /api/auth/email/exchange-reset-password-token` | **200** `{ token }`; código malo **400** `INVALID_INPUT` |
| `recuperar_codigo` (paso 2b) | `POST /api/auth/email/reset-password` | **200** con `{ otp, newPassword }` |
| plataforma | `PUT /api/auth/config` + admin | política aplicada |

Códigos de error observados:

| HTTP | Cuerpo | Se traduce a |
|---|---|---|
| 401 | `AUTH_UNAUTHORIZED` · «Invalid credentials» | `CREDENCIALES` |
| 409 | `AUTH_EMAIL_EXISTS` · «User already exists» | `YA_EXISTE` |
| 400 | `INVALID_INPUT` · «Invalid or expired verification code» | `CODIGO` |
| 403 | según política de verificación | `SIN_VERIFICAR` |
| 429 | límite de la plataforma | `LIMITE` |
| 5xx | error interno / proyecto pausado | `NUBE` |

Cabeceras:

```http
Authorization: Bearer <anon key>        # registro / login / public-config / reset
Authorization: Bearer <admin key>       # listar, borrar y configurar
Content-Type: application/json
```

**Ninguna clave viaja al navegador**: todas las llamadas salen de `fabri-api`.

### 1.1 Política aplicada al proyecto

`PUT /api/auth/config` (admin). Respuesta real de `public-config`:

```json
{
  "oAuthProviders": ["github", "google"],
  "customOAuthProviders": [],
  "requireEmailVerification": false,
  "passwordMinLength": 8,
  "requireNumber": false,
  "requireLowercase": false,
  "requireUppercase": false,
  "requireSpecialChar": false,
  "verifyEmailMethod": "code",
  "resetPasswordMethod": "code",
  "disableSignup": false
}
```

- `requireEmailVerification: false` es **obligatorio** para la migración: con
  `true`, el login de una cuenta sin verificar devuelve 403 y la cuenta legacy
  quedaría afuera en su primer login.
- `passwordMinLength: 8` coincide con `validarPass()` de `_auth.js`.
- `resetPasswordMethod: "code"` habilita el flujo de código de 6 dígitos sin
  enlaces ni redirects (no hace falta registrar URLs).
- `disableSignup: false` es necesario: la migración perezosa crea la cuenta en
  InsForge en el primer login, sin invitación previa.

---

## 2. Migración perezosa: nadie cambia su contraseña

InsForge **no importa hashes PBKDF2**. La única forma de conservar las
contraseñas es migrar a cada usuario en su primer login.

Lo implementado en `_auth.js` + `crearPuente()` de `auth.ts`:

```
entrar(email, pass)
  │
  ├─ 0. InsForge configurado y cuenta con insforge_id
  │      ├─ 200            → contraseña correcta. Seguir.
  │      ├─ 401 + origen   → 'clave': se responde 401 sin probar el hash local
  │      │   'insforge'       (InsForge es la autoridad de esa cuenta)
  │      └─ 5xx/timeout    → 'nube': en `dual` manda el hash local;
  │                          en `insforge` se responde 503 explícito
  │
  ├─ 1. Verificar contra core_usuarios (PBKDF2, 120.000 iteraciones)
  │      └─ falla → 401 CREDENCIALES (mismo mensaje de siempre)
  │
  ├─ 2. sincronizar(): POST InsForge /users con la MISMA contraseña
  │      ├─ 200 → vincular insforge_id, auth_origen='insforge', migrado_ts
  │      ├─ 409 → la cuenta existe en InsForge con otra clave
  │      │        (p. ej. la aleatoria de un reset que no se completó)
  │      │        → se borra y se recrea con la contraseña demostrada
  │      └─ red  → no se vincula; se reintenta en el próximo login
  │
  └─ 3. Emitir el token propio de siempre (core_sesiones)
```

Consecuencias:

- El usuario no ve ningún cambio: escribe su correo y su contraseña como siempre.
- Si nunca vuelve a entrar, su cuenta sigue en `core_usuarios` y puede entrar
  mientras `AUTH_MODO` sea `dual` o `legacy`.
- No se envía ningún correo durante la migración.
- El sync nunca bloquea la entrada: cualquier error se traga y se reintenta.

### Máquina de estados de una cuenta

| `auth_origen` | `insforge_id` | Significado |
|---|---|---|
| `legacy` | `''` | aún no migrada; entra por PBKDF2 y migra en ese login |
| `legacy` | `<uuid>` | tiene cuenta en InsForge pero el login usó el respaldo (nube caída o reset pedido) |
| `insforge` | `<uuid>` | migrada y activa en InsForge |
| `insforge` | `''` | inconsistencia: se trata como legacy y se reintenta |

---

## 3. Cambios de datos

Todo idempotente, dentro de `asegurar()`:

```sql
ALTER TABLE core_usuarios ADD COLUMN IF NOT EXISTS insforge_id TEXT NOT NULL DEFAULT '';
ALTER TABLE core_usuarios ADD COLUMN IF NOT EXISTS auth_origen TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE core_usuarios ADD COLUMN IF NOT EXISTS migrado_ts TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_core_usuarios_insforge
  ON core_usuarios (insforge_id) WHERE insforge_id <> '';
```

### `pass_hash` se conserva también en cuentas InsForge

Decisión tomada durante la implementación, contra el plan original:

- El plan preveía `pass_hash=''` para las cuentas que nacen en InsForge.
- Se conserva el hash PBKDF2 en **todos** los caminos: registro, login migrado
  y recuperación por código. `guardarClave()` lo reescribe en cada reset.
- Motivo: el rollback a `legacy` tiene que ser instantáneo y sin dejar a nadie
  afuera. Si el hash se borrara, volver a `legacy` exigiría un reset masivo por
  correo.
- Las cuentas que sólo existen en InsForge (creadas por un reset sin fila
  local) se insertan con `pass_hash=''`, `pass_salt=''`, `iter=0`, y
  `buscarPorEmail()` convierte `iter 0` en 120.000 para que el cálculo no
  explote. Esas cuentas no pueden entrar por PBKDF2 (`hashPass` de `''` nunca
  coincide) y eso es correcto.

No se toca `core_sesiones` ni se escribe en el esquema `auth` de InsForge: lo
administra la plataforma, y el acceso es solo por API.

---

## 4. Variables de entorno (`fabri-api` en Vercel)

| Variable | Valor actual | Secreta | Para qué |
|---|---|---|---|
| `INSFORGE_URL` | `https://g5b9can6.us-east.insforge.app` | no | base de las llamadas de auth |
| `INSFORGE_ANON_KEY` | `anon_…` (69 chars) | no (= pública) | registro, login, public-config, reset |
| `INSFORGE_ADMIN_KEY` | `ik_…` (35 chars) | **sí** | listar, borrar y configurar |
| `AUTH_MODO` | `legacy` → `dual` | no | interruptor de despliegue |

Reglas:

- `AUTH_MODO` ausente o con typo = `legacy`. El código nuevo queda inerte: un
  error de tipeo nunca activa la migración por accidente.
- `dual`: InsForge primero, respaldo PBKDF2. Es el modo de la migración.
- `insforge`: solo InsForge. Si la nube no responde, el login falla con 503
  claro (nunca finge un login).
- Ninguna de estas variables se agrega a `web/`, a la APK ni a `opencode.jsonc`.

---

## 5. Recuperación de contraseña por código

Flujo nativo de InsForge (`resetPasswordMethod: "code"`), en dos pasos, sin
enlaces ni redirects: nada que registrar en la app de InsForge.

```
POST /api/auth { accion:"recuperar", email }
  │
  ├─ tope propio: 5 pedidos por IP por hora (además del límite de InsForge)
  ├─ si la cuenta es legacy: se crea en InsForge con una clave aleatoria de
  │  32 bytes (sin eso no hay a quién mandarle el código) y se vincula con
  │  auth_origen='legacy'
  └─ send-reset-password → 202 SIEMPRE, exista o no la cuenta
     (anti-enumeración: la respuesta es idéntica)

POST /api/auth { accion:"recuperar_codigo", email, codigo, pass, dispositivo }
  │
  ├─ exchange-reset-password-token { email, code } → { token } (un solo uso)
  ├─ reset-password { otp: <token>, newPassword: <pass> }
  ├─ login de confirmación con la clave nueva → de ahí sale el insforge_id
  ├─ guardarClave(): nuevo PBKDF2 local (respaldo del rollback)
  ├─ revocarSesionesDe(): TODAS las sesiones anteriores dejan de valer
  └─ abrirSesion(): token nuevo de 30 días, atado a este dispositivo
```

Detalles que importan:

- **La contraseña nueva también se guarda como PBKDF2 local.** Si mañana se
  vuelve a `legacy`, la contraseña que el usuario recordó sigue sirviendo.
- **Se revocan todas las sesiones** antes de emitir la nueva: si alguien había
  robado un token, el reset lo deja fuera.
- El código vence a los 5 minutos. Un código inválido o vencido devuelve 401
  `CODIGO` con el texto «El código no sirve o venció: pide uno nuevo».
- El paso 1 responde 200 aunque el correo no tenga cuenta. No se puede usar
  para averiguar quién está registrado.
- En la UI: botón «Olvidé mi contraseña» en la puerta de acceso, dos pantallas
  (`core-pro.js`) y `CoreAuth.recuperar` / `CoreAuth.recuperarCodigo` en
  `core-sec.js`. Al terminar, la cuenta queda espejada en el equipo y la
  sesión abierta.

---

## 6. Cambios de código

| Archivo | Cambio |
|---|---|
| `api-telefono/api/_auth_insforge.js` | **nuevo helper HTTP**: `modo`, `configurado`, `host`, `claveRandom`, `usuarioDe`, `publicConfig`, `configurar`, `registrar`, `entrar`, `listar`, `buscarPorEmail`, `borrar`, `solicitarReset`, `canjearCodigo`, `resetConClave`. Timeout 8 s, errores normalizados, nunca toca SQL ni `res`. |
| `api-telefono/api/_auth.js` | hooks opcionales (`modo`, `externo.verificar/sincronizar/crear/borrar`), `revisarExterno`, `sincronizarExterno`, `abrirSesion`, compensación de usuario huérfano en carrera 23505. Sin `externo` se comporta exactamente como antes. |
| `api-telefono/api/auth.ts` | `asegurar()` agrega columnas e índice; repo con `vincularInsforge`, `guardarClave`, `revocarSesionesDe`; `crearPuente(repo)`; acciones `recuperar` y `recuperar_codigo`; `permitirRecuperacion` (5/hora por IP); `diag` con `auth` y `public_config`. |
| `web/app/core-sec.js` | `CoreAuth.recuperar` y `CoreAuth.recuperarCodigo` (espeja la cuenta al terminar). |
| `web/app/core-pro.js` | botón «Olvidé mi contraseña» y flujo de dos pasos. |
| `web/app/core-nube.js` | **sin cambios**. |
| `web/panel/comun/sesion.js` | **sin cambios**: recibe el mismo `{ token, usuario }`. |

Se respeta el límite de **12 funciones** en `api/`: no se crea ningún endpoint
nuevo. `_auth_insforge.js` empieza con `_`, así que Vercel no lo cuenta como
función (queda en 12).

### Forma de la respuesta (idéntica a hoy)

```json
{
  "ok": true,
  "accion": "entrar",
  "nube": "insforge",
  "usuario": { "id": "12", "email": "ana@ejemplo.cl", "nombre": "Ana", "rol": "member" },
  "token": "…",
  "expira": "2026-12-18T00:00:00.000Z"
}
```

---

## 7. Fases de despliegue

### Fase A · Credenciales y diagnóstico ✅

- Proyecto `Fabricore` creado y política aplicada (§1.1).
- Claves cargadas en `fabri-api` (Production), `INSFORGE_ADMIN_KEY` como
  *sensitive*.
- Contrato completo verificado en vivo contra el proyecto real.

### Fase B · Código inerte ✅

- Helper + columnas + ramas por `AUTH_MODO`, desplegado con `AUTH_MODO=legacy`.
- Producción responde:
  `auth: { modo:"legacy", insforge_configurado:true, recuperacion:true }` y las
  10 acciones.
- Smoke test real: registrar → sesión → entrar → clave mala (401) → token
  válido en `mercado.local_mio` → sesión rechazada desde otro dispositivo →
  borrar. Todo como antes.

### Fase C · Modo dual (en curso)

- `AUTH_MODO=dual` desplegado.
- Prueba con una cuenta creada en `legacy`: migra en el primer login (aparece
  en `auth.users` de InsForge) y el segundo login entra por InsForge.
- Medir: `SELECT auth_origen, COUNT(*) FROM core_usuarios GROUP BY 1;`
- Vigilar el porcentaje migrado durante 1–2 semanas.

### Fase D · Cierre (cuando el 100 % de las cuentas activas esté migrado)

- Cambiar `AUTH_MODO=insforge`.
- Mantener `core_usuarios.pass_hash` como respaldo **indefinidamente**: es la
  garantía del rollback y no cuesta nada.

### Rollback

- Instantáneo: `AUTH_MODO=legacy` en Vercel y redesplegar. Las cuentas migradas
  vuelven a entrar con su hash local, que nunca se borró.
- No se borra ninguna tabla ni columna en ninguna fase.

---

## 8. Pruebas de aceptación

Verificadas en local (19 escenarios unitarios sobre `_auth.js` con repo en
memoria) y en producción:

- [x] Registro nuevo en `dual` → fila en `auth.users` **y** en `core_usuarios`
      con `insforge_id`.
- [x] Login de cuenta legacy → migra una sola vez; el segundo login no vuelve a
      crear usuario.
- [x] Contraseña incorrecta → 401, sin revelar si el correo existe.
- [x] `dual` + InsForge caído → el login legacy funciona (respaldo PBKDF2).
- [x] `insforge` + InsForge caído → 503 explícito, nunca login falso.
- [x] Token devuelto → `POST /api/mercado {accion:"local_mio"}` responde 200
      con la cabecera `x-dispositivo` correcta.
- [x] Sesión usada desde otro dispositivo → 401 `DISPOSITIVO`.
- [x] `borrar` → elimina en InsForge (`deletedCount`) y en `core_usuarios`.
- [x] `recuperar` responde igual exista o no la cuenta (200 genérico).
- [x] `recuperar_codigo` con código inválido → 401 `CODIGO`.
- [x] `recuperar_codigo` valida formato del código y mínimo de contraseña.
- [x] `/api/auth?diag=1` informa `auth`, `insforge_configurado` y
      `public_config`.
- [ ] Canje de un código real de 6 dígitos (requiere el correo del usuario).
- [ ] Migración completa del parque de cuentas (fase C).

---

## 9. Riesgos y límites

| Riesgo | Mitigación |
|---|---|
| **InsForge Cloud pausa el proyecto por inactividad** | medido: `paused_reason:"inactivity"`. Durante la pausa todo responde 503 y Postgres cierra el SSL. `dual` cubre con el respaldo PBKDF2. Restaurar: `POST https://api.insforge.dev/projects/v1/{id}/restore` (tarda ~2 min). |
| Los crons de Vercel (2/día) no alcanzan como keepalive | no se depende de ellos: `dual` es el modo estable; `insforge` solo con tráfico real constante. |
| El plan free de InsForge tiene límites de usuarios/MAU | revisar `pricing.md`; el tope propio de 200 cuentas se mantiene. |
| InsForge no importa hashes | migración perezosa; nunca reset masivo. |
| `auth.users` vive en el mismo Postgres | no se accede por SQL: solo por API. |
| Proyecto pausado o borrado | rollback a `legacy`; el hash local sigue ahí. |
| Doble cuenta con el mismo correo | `core_usuarios.email` es `UNIQUE`; el 409 `AUTH_EMAIL_EXISTS` se traduce a `YA_EXISTE`, nunca a una cuenta nueva. |
| Cuenta en InsForge con otra contraseña | reconciliación: se borra y se recrea con la contraseña demostrada contra el hash local. |
| Reloj/expiración del JWT | irrelevante: el JWT de InsForge no se usa para autorizar. |
| `INSFORGE_DATABASE_URL` es `[SENSITIVE]` en Vercel y las claves que devuelve la API vienen enmascaradas | las pruebas de integración se hacen contra el deploy, no desde el teléfono. |

---

## 10. Lo que falta

1. Probar el canje de un código real (correo del usuario) de punta a punta.
2. Medir la migración durante la fase C y decidir el paso a `insforge`.
3. Implementar los paneles Cliente y Negocio (`docs/PANELES-MODULOS.md`);
   esta migración deja la puerta de acceso lista para ellos.
