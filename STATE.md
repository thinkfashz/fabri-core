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
| Release con la APK | https://github.com/thinkfashz/fabri-core/releases/tag/v1.0.0 |
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
