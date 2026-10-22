# STATE · FABRI-CORE

Actualizado: 22-10-2026

## Qué es

Consola autónoma en dos envases con el mismo núcleo: **APK Kotlin** (Android) y
**PWA** (navegador). Base SQLite real, memoria con procedencia, consola SQL,
chat contra un agente y grafo de flujos.

| Pieza | URL |
|---|---|
| Landing | https://fabri-core-web.vercel.app/ |
| PWA | https://fabri-core-web.vercel.app/app/ |
| API Go (salud) | https://fabri-core-web.vercel.app/api/health |
| Repo (público) | https://github.com/thinkfashz/fabri-core |
| Release con la APK | https://github.com/thinkfashz/fabri-core/releases/tag/v1.1.0 |
| Descarga directa | https://github.com/thinkfashz/fabri-core/releases/latest/download/fabri-core-lite.apk |

## Hecho

- **APK lite** compilada y firmada (33 KB, firma v2) con `build-fast.sh`, pipeline
  sin Gradle: aapt2 → kotlinc → d8 → zipalign → apksigner. ~236 s en el teléfono.
- **Release v1.0.0** publicada con el asset `fabri-core-lite.apk` (HTTP 200,
  `application/vnd.android.package-archive`).
- **PWA** en producción con SQLite vía sql.js WASM + IndexedDB. Índice detectado en
  runtime: **FTS5 → FTS4 → LIKE**, y la UI muestra cuál quedó. sql.js 1.10.3 solo
  trae FTS3/4, así que en la práctica queda FTS4 (probado: búsqueda con resaltado).
- **Funciones Go** en Vercel (`api/health.go`, `api/agent.go`, `package handler`).
  `/api/health` responde `{"runtime":"go go1.22.12"}`. `/api/agent` devuelve 503 con
  instrucciones mientras no existan `FABRI_LLM_URL` y `FABRI_LLM_KEY`.
- **Prueba funcional real** (Playwright + headless shell) contra producción:
  `ver: web · v1.0 · FTS4`, 3 memorias, 96 KB, consola SQL 3 filas en 5.7 ms,
  búsqueda «navegador» → 1 resultado con 1 resaltado, **0 errores de consola**.

## Bloqueado

- **GitHub Actions no ejecuta** ningún workflow en esta cuenta:
  `The job was not started because your account is locked due to a billing issue.`
  No es el YAML (un workflow mínimo falla igual). Se arregla en
  <https://github.com/settings/billing>. Mientras tanto vale el build local.
- `/api/agent` sin claves → definir `FABRI_LLM_URL` + `FABRI_LLM_KEY` en Vercel y
  redesplegar.
- Instalar la APK en el teléfono: hay que tocar el archivo (equipo sin root).

## Cómo se toca

```sh
bash build-fast.sh                     # APK (detecta Termux o Linux/CI)
bash build-fast.sh && VERIFY=1 ...     # + verificación de firma

cd web
VERCEL_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 NODE_OPTIONS=--dns-result-order=ipv4first \
  vercel deploy --prod --yes
```

El CLI de Vercel necesita esas tres variables: sin `NODE_OPTIONS` cae en el IPv6
roto de esta red (`fetch failed` / `EAI_AGAIN sentry.io`).

## Trampas aprendidas

- **No asumir FTS5**: `sqlite_compileoption_used('ENABLE_FTS5')` puede mentir y el
  módulo faltar. Se crea la tabla virtual y se lee el DDL real de `sqlite_master`.
- **No consultar `memory_fts` sin comprobar que existe**: tumbaba todo el arranque.
- El índice se reconstruye por código (`DELETE` + `INSERT … SELECT`), sin triggers:
  igual en FTS3, 4 y 5.
- `snippet()` con marcadores `[[H]]/[[/H]]` y escape posterior: así el resaltado no
  inyecta HTML.

## 22-10-2026 · v1.1 (APK + PWA) y capa de nube

### APK 1.1.0-lite (88 KB, firmada v2+v3) — publicada
Reescritura completa en `fast/lite/` (Db, Sec, Ui, Agent, MainActivity):

- Login local real: PBKDF2-HMAC-SHA256 120k + token de sesión guardado **solo como SHA-256**, con vencimiento.
- Consola que ejecuta `/system/bin/sh` de verdad (20 s de tope) + comandos propios: `sql`, `tables`, `fts`, `logs`, `files`, `export`.
- Base v3 con usuarios, sesiones, claves, logs, auditoría, métricas, permisos, archivos, comandos, hojas.
- Integraciones de 9 proveedores; claves cifradas con **AES-256-GCM del Android Keystore**.
- Permisos con estado real (INTERNET, red, notificaciones, almacenamiento) y explicación del sandbox.
- Export `.xlsx` real con `java.util.zip` a Descargas/FABRI-CORE.
- Guarda anti-crash: pantalla de error con la traza + `crash.txt`.
- Manifiesto ampliado; `build-fast.sh` compila `fast/lite/*.kt`.

**Lección de build**: d8 pasó de ~50 s a **631 s** con dos builds compitiendo en paralelo.
Nunca lanzar dos `build-fast.sh` a la vez; esperar a que muera el `K2JVMCompiler`.

### PWA v1.1 — en producción y verificada
Nuevos módulos en `web/app/`:

| Archivo | Qué aporta |
|---|---|
| `core-sec.js` | `CoreAuth` (PBKDF2 120k, sesiones con token hasheado) + `CoreVault` (AES-256-GCM con clave del dispositivo en IndexedDB, catálogo de 9 proveedores, `ping` y `ask` directos al proveedor) |
| `core-xlsx.js` | `.xlsx` OOXML real escrito a mano (ZIP store + CRC32) y CSV |
| `core-pro.js` | Pantallas Datos (analítica real, barras, export), IA (bóveda + chat), Cuenta (planes, cuota, sesiones, permisos, nube) y la puerta de login |
| `app.js` | `window.Fabri` (API para los módulos), `log/audit/metric`, navegación por hash **después** de abrir la base |
| `index.html` | 8 pestañas, overlay de login, scripts |
| `sw.js` | caché `fcore-v2` con los módulos nuevos |

Prueba Playwright en producción (`/tmp/opencode/test-pro.mjs`), **0 errores de consola**:
login `dueno@fabri.cl` → 20 tablas / 11 filas / FTS4 → descarga `fabri-api_keys-*.xlsx`
→ 9 proveedores → planes Local/Prueba/Pro → cuota `148 KB / 5 MB` → sesión persiste tras recargar.

### Nube: código listo, almacenamiento bloqueado por facturación
- `api/auth/index.go` y `api/sync/index.go` (Go stdlib, PBKDF2 propio). Guardan en
  Vercel Blob un sobre **ya cifrado** en el navegador: el servidor nunca ve texto plano.
- `/api/health` ahora informa `cloud`.
- **Trampa de Vercel Go**: todos los `api/*.go` se compilan como **un solo paquete**;
  cuatro `func Handler` = `Handler redeclared`. Cada función va en **su carpeta**:
  `api/auth/index.go` → `/api/auth`, `api/sync/index.go` → `/api/sync`.
- Bloqueo real: el plan free ya usó su único Blob store (`fabrick-panel-state`, **suspended**)
  y `vercel blob create-store` responde `usage threshold limit is reached (400)`.
  Los endpoints devuelven **501 con instrucciones**, nunca simulan cuentas.
- Sigue bloqueado GitHub Actions: `account is locked due to a billing issue`
  (<https://github.com/settings/billing>).

### Pendiente
1. Resolver facturación de Vercel → crear Blob privado → redeploy: `/api/auth` y `/api/sync`
   pasan a 200 sin tocar código.
2. Con la nube activa: botón de sincronizar en Cuenta (el sobre cifrado ya está definido).
3. Instalar la APK: si había una versión previa con otra firma, **desinstalar primero**.

## 22-10-2026 · v1.2 web: planilla con cálculo real (modo local)

Decisión del dueño: **sin nube**. La app no depende de Vercel ni de un servidor;
los endpoints `/api/auth` y `/api/sync` quedan escritos pero no se usan.

### Nuevo: pestaña «Hoja»
`web/app/core-sheet.js` (~30 KB, sin dependencias):

- Rejilla 40×12 editable, barra de fórmulas, navegación Enter/Tab/flechas.
- **Motor propio**: tokenizador + parser descendente; `+ - * / ^ & %`,
  comparaciones, referencias `A1`, rangos `A1:B9`, **detección de ciclos**.
- ~35 funciones en español e inglés: SUMA, PROMEDIO, MIN, MAX, CONTAR, CONTARA,
  SI, SI.ERROR, Y, O, NO, REDONDEAR(+MAS/MENOS), ABS, RAIZ, POTENCIA, RESIDUO,
  HOY, AHORA, LARGO, MAYUSC, MINUSC, RECORTAR, CONCATENAR, IZQUIERDA, DERECHA,
  EXTRAE, TEXTO, SUMAR.SI, CONTAR.SI, BUSCARV, INDICE, COINCIDIR.
- Varias hojas por libro (crear, renombrar, borrar) y **persistencia en SQLite**
  (`sheets`, `cells`): lo escrito sobrevive a recargar.
- Importar CSV (detecta `;` o `,`), botón Ejemplo (gastos con IVA y totales).
- Exporta `.xlsx` de **todas las hojas con las fórmulas escritas** y su valor
  cacheado (Excel recalcula al abrir).

### Bug encontrado y corregido (importante)
El formateo mostraba `500.000`; al confirmar de nuevo la celda se re-leía como
**500 decimal** (`Number("500.000") === 500`). Doble arreglo: no se reinterpreta
el texto ya formateado, y `coerce` reconoce miles a la chilena (`500.000`,
`1.234.567`) y coma decimal (`3,5`).

### Verificación
- Motor aislado en Node: **31/31** casos (incluye ciclos, #DIV/0!, BUSCARV, miles).
- Navegador real en producción, **0 errores**: ejemplo B5 `512.990`, editar B2 a
  `500000` → B5 `562.990` y D5 `669.958,1`; export con 2 hojas y 13 fórmulas;
  tras recargar, B2 `500.000` y B5 `562.990` siguen ahí.
- Cuenta: bloque «Modo local» + **copia de seguridad `.sqlite`** descargable.
- `sw.js` → `fcore-v3`.

### Trampa de tooling
Los tests de Playwright se cortan cuando el servidor se reinicia; conviene que
impriman resultados al final y con `timeout` corto. Los 404 de `/api/health` en
local son ruido (no existe el servidor Go).

---

## 2026-10-22 · Por qué no abre la APK + build en Java (sin Kotlin)

### Diagnóstico de la v1.1.0-lite (con evidencia, sin adivinar)
- El paquete **sí está instalado**: `pm list packages` → `package:cl.fabri.core.lite`.
- Manifiesto del APK: `exported=true`, launcher OK, `targetSdk=34`; **no declaraba
  `minSdkVersion`** (quedaba en 1). Tema `Theme.FabriCore` válido
  (`parent=android:Theme.Material.NoActionBar`), así que el fallo no es de recursos.
- `showCrash()` no toca `lateinit`, así que un fallo dentro de `boot()` **sí** se vería
  en pantalla. Que no se vea nada apunta a un fallo **antes de `onCreate`** (carga de
  clase / instalación / Play Protect).
- **No se puede lanzar ni leer logs desde Termux**: `am start` →
  `SecurityException: package=com.android.shell does not belong to uid=10643`;
  `dumpsys` y `logcat` de otra app tampoco. Por eso el diagnóstico debe salir de la app.

### Salida: APK nativa en Java (release `v2.0-java`)
- Paquete **nuevo** `cl.fabri.core.j` → convive con la anterior, sin desinstalar.
- `minSdkVersion=23` / `targetSdk=34` **explícitos** (se verificó en el APK compilado).
- Arranque instrumentado: `diag()` escribe en `Android/data/cl.fabri.core.j/files/boot.log`
  desde la primera línea de `onCreate`, más `setDefaultUncaughtExceptionHandler`.
  El log se muestra y se copia desde **Ajustes**.
- Funciones reales: login PBKDF2-HMAC-SHA256 120k, sesión con token hasheado,
  SQLite 12 tablas, consola `/system/bin/sh` con timeout, export XLSX
  (`ZipOutputStream` + OOXML), claves de IA AES-256-GCM del Keystore, y pantalla de
  error si algo falla.
- Código: `fast/java/src/cl/fabri/core/j/{Core,MainActivity}.java` · build: `build-java.sh`.

### Tiempos medidos en el teléfono (build Java completo)
| Paso | Descargado | Cargado |
|---|---|---|
| aapt2 link | 8 s | 10 s |
| javac (6 clases) | 28 s | 40 s |
| d8 | 28 s | 94 s |
| zip + zipalign | 1 s | 3 s |
| apksigner | 22 s | 50 s |
| **Total** | **88 s** | **207 s** |

Kotlin medía 4-10 min en las mismas condiciones. Java es 2-5× más rápido y el APK pesa 33 KB.

### Trampas del build Java (repetirlas cuesta tiempo)
1. **`aapt2`/`d8` del SDK de `/root/android-sdk` son x86-64** y en el teléfono no corren
   (`cannot execute: required file not found`). Usar los de Termux:
   `/data/data/com.termux/files/usr/bin/`.
2. **`android.jar` no trae `java.lang.invoke.LambdaMetafactory`**: con
   `-source 8 -bootclasspath android.jar` javac falla. Compilar con
   `-source 11 -target 11 -cp android.jar`. d8 desazucara las lambdas.
3. **`java.util.Base64` es API 26** y `Process.waitFor(timeout, unit)` también.
   Con `minSdk 23` hay que usar `android.util.Base64` y un hilo + `join(timeout)`.
4. El icono se toma de `@android:drawable/sym_def_app_icon` y el tema de
   `@android:style/Theme.Material.NoActionBar`: así el build **no necesita `res/`**
   y se salta `aapt2 compile`.

### Pendiente
Que el usuario abra la 2.0-java y mande `boot.log` (o la captura de Ajustes).
Si la Java tampoco abre, el problema es del instalador/Play Protect, no del código.
