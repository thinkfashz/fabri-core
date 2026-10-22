# FABRI-CORE · Arquitectura

> Decisiones de diseño, módulos, flujo de datos y el mecanismo de eventos reales.
> El esquema de tablas está en `SCHEMA.md` (generado desde el spec) y el contrato de
> pantallas en `SCREENS.md`.

---

## 1. Forma general

```
┌──────────────────────────── ANDROID (Kotlin) ────────────────────────────┐
│  Compose UI (17 rutas)                                                     │
│    Panel · Chat IA · Terminal · Instalador · Proyectos · BD · Memoria      │
│    Documentos · Facturas · Análisis · Sistema · Catálogos · Marca         │
│    Exportación · Flujos en vivo · Ajustes                                 │
│                                                                          │
│  Navigation Compose (módulos)      SAF (exportar)      Print Framework    │
│  DataStore + Room/SQLiteHelper    WorkManager (tareas)  Notificaciones     │
└───────────────┬──────────────────────────────────────────┬───────────────┘
                │ loopback + token (o app-private IPC)      │ SAF / Print
                ▼                                          ▼
┌────────────────────────── BACKEND (Go, opcional) ───┐  PDF/XLSX/CSV
│  API: /projects /docs /facts /rag /agent /tasks      │  (AndroidX)
│  SSE: /events (progreso real)                        │
│  SQLite: documents, chunks, fts, embeddings, memory  │
└───────────────┬──────────────────────────────────────┘
                │ CLI/IPC documentado
                ▼
        OpenCode (agente)  →  skills  →  MCP (everos, notebooklm, …)
```

**Principio**: la app **no depende** del backend Go para funcionar. El Go aporta el grafo en
vivo, el escaneo masivo y la cola de tareas; la app degrada a modo local con aviso explícito.

---

## 2. Módulos (Kotlin)

| Módulo | Responsabilidad | Puede fallar sin romper la app |
|---|---|---|
| `core-data` | SQLite, migraciones, DAO, repositorios | No: es la fuente de verdad |
| `core-agent` | Cliente de OpenCode (CLI/IPC), streaming, citas | Sí: el chat pasa a "sin agente" |
| `core-search` | FTS5 + embeddings + fusión híbrida + procedencia | Sí: degrada a textual |
| `core-docs` | Importación, chunking, OCR (facturas), miniaturas | Sí: la vista de documentos queda sin OCR |
| `core-export` | PDF/XLSX/CSV, plantillas, impresión | Sí: el resto sigue vivo |
| `core-brand` | Logo SVG/PNG (sanitizado), temas, plantillas | Sí: usa el tema por defecto |
| `core-terminal` | PTY/proceso real, streaming de salida | Sí: la terminal muestra "no disponible" |
| `core-installer` | Descarga, verificación (hash), instalación, tests | Sí: el resto no depende |
| `core-live` | Cliente SSE, grafo animado | Sí: "desconectado" |
| `ui-*` | Compose por feature (una pantalla = una ruta) | — |

Cada módulo expone su estado (`available` / `degraded` / `unavailable`) para que la UI **diga
la verdad** en vez de fingir.

---

## 3. Datos y recuperación

- **SQLite** es la fuente de verdad. `PRAGMA journal_mode=WAL`, `foreign_keys=ON`.
- **FTS5**: se comprueba en runtime (`sqlite_compileoption_used('ENABLE_FTS5')`). Si no está,
  la app usa un índice inverso propio sobre `document_chunks` y **la UI lo declara**.
- **Embeddings**: tabla `embeddings` (modelo, dimensiones, vector) ligada a `document_chunks`.
  La búsqueda vectorial **solo aparece activa** si hay embeddings utilizables.
- **Fusión híbrida**: textual (BM25/FTS5) + vectorial (coseno) con pesos configurables y
  **procedencia obligatoria** en cada hit (`documento`, `fragmento`, `tabla`, `mensaje`).
- Se distingue explícitamente: **coincidencia textual** ≠ **similitud semántica** ≠
  **razonamiento del modelo**. La UI etiqueta el tipo de cada coincidencia.

---

## 4. Agente

- El agente es **OpenCode** invocado por una interfaz documentada (CLI por loopback en el
  teléfono, servidor en escritorio).
- Cada sesión persiste en `agent_sessions` + `messages` (con `provenance` y referencias).
- El chat muestra: estado de ejecución, herramientas invocadas, y **qué Knowledge se
  recuperó** antes de responder (para que se pueda auditar).
- Interrupción: cancelar la tarea deja la tarea en estado reanudable (`tasks` + `task_events`).

---

## 5. Grafo en vivo (Cerebro IA / Flujos)

Cadena real que se visualiza:

```
Android UI → Backend Go → SQLite → FTS5 → Embeddings → RAG → Agente IA → Resultados → Memoria
```

- Los eventos viajan por **SSE** (o WebSocket app-private) y son los mismos que usa el chat.
- El nodo "activo" es el que tiene un evento en curso; el grosor de la arista es tráfico
  **medido** en la ventana reciente.
- Sin backend → `offline` con la hora del último evento. **Nunca** hay cifras inventadas.

---

## 6. Temas

| Tema | Acento | Uso |
|---|---|---|
| Verde limón | `#C8FF00` | Por defecto (alineado con el sistema de diseño de Fabrick) |
| Morado | `#A855F7` | Alternativo |
| Azul | `#3B82F6` | Alternativo |
| Amarillo oro | `#EAB308` | Corporativo Fabrick |

- Un solo token (`--ds-accent` / `accent.primary`) gobierna todo: navegación, botones,
  indicadores, gráficas, terminal, instalador y visualizaciones.
- Persistencia en `app_settings`; vista previa antes de aplicar; contraste verificado
  (WCAG AA sobre fondo `#050505`).

---

## 7. Marca y plantillas

- Logo **SVG sanitizado**: se eliminan `<script>`, `on*`, `href="http…"`, `xlink:href`
  externo, `<foreignObject>` y entidades; se re-serializa con un parser XML.
- Proporción original conservada siempre; posición (izq/centro/der), escala y márgenes
  configurables; encabezado, pie y datos de contacto.
- La vista previa usa el **mismo** renderizador que la exportación (si no, la vista previa
  miente).

---

## 8. Exportación

- Fuentes: tablas de SQLite, catálogos, facturas, documentos, análisis.
- Columnas, filtros y rango de fechas seleccionables.
- Progreso **real** (el generador emite progreso; la UI no inventa porcentajes).
- Guardado con **SAF**; impresión con el **Print Framework**.
- Un export vacío es un **error**, no un éxito.

---

## 9. Persistencia, eficiencia y background

- Migraciones versionadas + `backup_jobs` (copia, verificación, restauración probada).
- Tareas reanudables: `tasks` (estado) + `task_events` (bitácora).
- Android: `WorkManager` para trabajo diferido, `ForegroundService` solo para lo que debe
  seguir vivo, y `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` solo cuando el usuario lo acepta.
- RAM: índice incremental, concurrencia limitada (1-2), cachés acotadas, embeddings
  descargables bajo demanda.

---

## 10. Decisiones tomadas (y por qué)

| Decisión | Motivo | Alternativa descartada |
|---|---|---|
| El backend Go es **opcional** | En el teléfono el límite es la RAM, no la lógica | Go embebido obligatorio (D3 sin verificar) |
| La app habla con OpenCode por **CLI/IPC** | Es lo que ya funciona en este equipo | SDK del agente (no existe para V2) |
| FTS5 con **fallback propio** | No está garantizado en el SQLite de Android | Asumir FTS5 y romper en runtime |
| El grafo en vivo usa **SSE** | Un solo canal para chat y eventos | WebSocket duplicando lógica |
| Estilos desde el **sistema de diseño de Fabrick** | Una sola lengua visual en todos los productos | Otro sistema de diseño en la app |
