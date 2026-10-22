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
