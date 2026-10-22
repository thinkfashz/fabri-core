# FABRI-CORE · Documento de ejecución

> Cómo se construye FABRI-CORE de verdad: fases, dependencias, puntos de control y
> artefactos verificables. Pensado para ejecutarse **desde el propio teléfono** y para que
> cualquier persona (o agente) pueda retomar el trabajo sin leer todo el código.

Estado: **documentación y arquitectura listas; la app todavía no está escrita.**
Lo que sí existe hoy: el contrato funcional (spec), el sistema de diseño, los diagramas y
esta documentación.

---

## 0. Reglas de la casa (no negociables)

1. **No se afirma una función terminada hasta comprobarla.** Cada fase termina con un
   artefacto verificable, no con "debería funcionar".
2. **Nunca** se matan ni reinician los procesos de OpenCode ni del sistema desde un agente.
3. **RAM antes que velocidad**: si no hay memoria, se espera (guardián) en vez de renderizar.
4. **El spec manda**: si el JSON cambia, se regenera la documentación (`docs/generar-docs.py`).
5. **Nada de datos inventados**: si una fuente no respondió, la UI dice *no disponible*.

---

## 1. Fases y puntos de control

| # | Fase | Artefacto verificable | Checkpoint |
|---|---|---|---|
| 1 | Entorno y spec | `docs/SCREENS.md`, `docs/SCHEMA.md` generados | El JSON se lee completo; 17 pantallas inventariadas |
| 2 | Arquitectura + esquema SQL | `docs/ARCHITECTURE.md` + `migrations/001_init.sql` | Revisar el esquema antes de escribir Kotlin |
| 3 | APK + navegación | APK debuggable con las 17 rutas | Abrir cada ruta: sin crash, con estados declarados |
| 4 | Temas | 4 temas aplicados a **todos** los componentes | Captura por tema + persistencia tras reiniciar |
| 5 | SQLite + FTS5 | `SQLiteOpenHelper` con migraciones | `ENABLE_FTS5` comprobado en runtime; test de búsqueda |
| 6 | Catálogos / facturas / documentos | CRUD + búsqueda + filtros +Abrir relacionados | Test con datos de prueba; factura conserva original + OCR + revisión |
| 7 | PDF / XLSX / CSV | Exportaciones reales con progreso | Abrir el archivo generado: **no vacío** |
| 8 | RAG + embeddings | Índice con procedencia por fragmento | Búsqueda híbrida con cita al origen |
| 9 | Agente (OpenCode) | Chat con historial y referencias | Sesión real contra el CLI; sin Connection refused mudo |
| 10 | Terminal + instalador | Terminal con I/O real + instalador con pasos | `echo` real; instalar un componente y verificarlo |
| 11 | Grafo en vivo | `/workflow/live` con eventos reales | Con backend caído → "desconectado", nunca cifras inventadas |
| 12 | Ubuntu (opcional) | Test de compatibilidad | Si falla, queda **deshabilitado** con el motivo visible |
| 13 | Pruebas | Suite de persistencia, seguridad, consumo | Reinicio de app → datos intactos; RAM medida |
| 14 | APK final | Artefacto firmado + `sha256` | `apksigner verify` OK |

### Orden de ataque recomendado (si hay que elegir)

```
3 (APK + navegación) → 4 (temas) → 5 (SQLite) → 9 (agente) → 11 (grafo en vivo) → 6 → 7 → 8 → 10 → 12 → 13 → 14
```

**Por qué ese orden**: lo primero que define si el producto es vendible es *que abra, que se
vea bien y que el agente responda*. Las exportaciones y el RAG vienen después: son valor,
pero no son la prueba de que la app funciona.

---

## 2. Dependencias para compilar desde el teléfono

Nada de esto viene con Ubuntu o PRoot: hay que bajarlo (y el disco del teléfono va al 93 %,
así que se planifica por fases).

### 2.1 Toolchain base

| Qué | Versión | Tamaño aprox. | Notas |
|---|---|---|---|
| JDK | 17 (LTS) | ~300 MB | `apt install openjdk-17-jdk` (en proot) o descarga directa de Temurin. |
| Android SDK (cmdline-tools + platform-tools + build-tools 34 + platform 34) | — | ~1,2 GB | Descargar por paquetes: `cmdline-tools`, `platform-tools`, `build-tools;34.0.0`, `platforms;android-34`. |
| Gradle | 8.x (wrapper) | ~200 MB con su distro | El wrapper baja solo: mejor dejar el `.zip` local y usar `--offline`. |
| Android NDK (solo si PRoot/SQLite propio) | r26 | ~1 GB | Opcional: no hacerlo salvo que D1/D3 lo exija. |

**Presupuesto de disco**: el build completo (SDK + NDK + Gradle + builds) pide **~6 GB
libres**. Con 14 GB disponibles y 207 GB usados, hay que:
- borrar builds antiguos (`rm -rf app/build`) entre pruebas,
- `GRADLE_USER_HOME` dentro de `/root` pero vigilado,
- y no instalar el NDK si se puede evitar.

### 2.2 Compilar la APK desde el dispositivo

```bash
# 1) toolchain
export ANDROID_SDK_ROOT=/root/android-sdk
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-arm64

# 2) proyecto
cd /root/fabri-core
./gradlew --offline assembleDebug        #首 primera vez: sin --offline (descarga deps)

# 3) instalar
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Si `gradlew` no puede con la RAM del teléfono: `GRADLE_OPTS="-Xmx1g -XX:MaxMetaspaceSize=512m"`
y `--no-daemon --max-workers=1`.

### 2.3 Firmar (release)

```bash
keytool -genkeypair -v -keystore ~/fabri-core.keystore -alias fabri \
        -keyalg RSA -keysize 4096 -validity 10000
# luego gradle con la config de release, y:
apksigner verify --verbose app/build/outputs/apk/release/app-release.apk
```

La clave **no** se versiona: vive en el dispositivo y en el backup del usuario.

---

## 3. Ejecutar el backend Go (dentro o fuera del APK)

| Opción | Cómo | Cuándo |
|---|---|---|
| **A. Proceso local en el teléfono** | Binario Go compilado con `GOOS=android GOARCH=arm64` y ejecutado por la app vía `app_process`/exec | Si D3 pasa la prueba. |
| **B. Proceso en Termux/proot** | El servicio corre en el proot y la app habla por **loopback** (`127.0.0.1:8787`) con un token de sesión en almacenamiento privado | **Recomendada** mientras D3 no esté resuelto: reutiliza lo que ya funciona en el equipo. |
| **C. Sin backend** | La app habla directo con el CLI de OpenCode | Si el resto no necesita el grafo en vivo; se declara el límite. |

**Regla de seguridad**: el canal va por loopback con un token aleatorio por instalación,
guardado en `EncryptedSharedPreferences`, y se valida en cada request.

---

## 4. Eventos reales para el grafo en vivo

```
[Go backend]  --SSE-->  [WebView /workflow/live]
      |
      +-- emite: task_started, stage_progress, retrieval_hit, agent_token,
                 tool_invoked, write_committed, memory_updated
```

- Los eventos llevan **conteo real** (bytes, filas, fragmentos) porque el backend los mide.
- Si el backend no está o se cae → estado `offline`/`degraded` con la hora del último evento.
- El grafo se anima con **HTML/SVG/Canvas** dentro de la app; el movimiento refleja el
  estado real (nodo activo = hay un evento en curso).

---

## 5. Qué se entrega (checklist de producto)

- [ ] APK debuggable y release firmado, con `sha256` publicado.
- [ ] Código fuente completo y documentado (Kotlin + Go + SQL + assets).
- [ ] Migraciones SQL versionadas (`migrations/NNN_*.sql`) y su política de rollback.
- [ ] `docs/` al día: `SCREENS.md`, `SCHEMA.md`, `ARCHITECTURE.md`, `EXECUTION.md`,
      `ERRORES-Y-MEJORAS.md`, `ACCEPTANCE.md`, `MASTER-PROMPT.md`.
- [ ] Diagramas: arquitectura, flujo de datos y flujo en vivo (HTML autocontenido + PNG).
- [ ] Pruebas: unitarias (SQL, temas, sanitizado de SVG), instrumentadas (persistencia,
      tema, recuperación de tareas) y de consumo (RAM).
- [ ] **Limitaciones conocidas** escritas (las de `ERRORES-Y-MEJORAS.md` §D, con su estado real).
- [ ] Ficha de producto: para qué sirve, en qué dispositivo, qué no hace y cuánto pesa.

---

## 6. Riesgos de venta (honestidad comercial)

| Riesgo | Cómo se comunica |
|---|---|
| "Funciona en un teléfono" | Sí, pero con límites medidos: RAM, background de Android, sin root. |
| "Terminal real" | Depende de D4: si el PTY no es real, se declara como cliente de shell. |
| "Ubuntu en la APK" | Opcional y con test; puede quedar deshabilitado en.release. |
| "RAG local" | Depende de D6: con embeddings descargables, no，余 si no, textual con aviso. |
| "Facturas" | Escaneo + OCR + revisión humana; **no** es declaración tributaria. |
