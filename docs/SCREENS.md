# FABRI-CORE · Contrato de pantallas (FABRI-CORE Autonomous Sandbox v1.0.0-spec)

> Generado desde `spec/fabri_core_android_screen_spec.json` el 2026-10-22 04:24 UTC. No editar a mano: se regenera con `python3 docs/generar-docs.py`.

- **Plataforma**: Android-first native APK
- **Idioma / zona**: es-CL · America/Santiago
- **Propósito**: Aplicación Android con sandbox privado, terminal, entorno Linux opcional, agente IA, memoria híbrida SQL/FTS5/embeddings, catálogos, facturación/documentos, exportaciones y visualización de flujos en vivo.

## Índice de navegación

| # | Pantalla | Ruta | Estados |
|---|----------|------|---------|
| 1 | Panel principal | `/home` | loading, ready, partial, error, offline |
| 2 | Chat IA / OpenCode | `/chat` | idle, retrieving_context, thinking, tool_running, completed, cancelled, error, offline |
| 3 | Terminal integrada | `/terminal` | disconnected, connecting, ready, running, exit, error |
| 4 | Instalador y componentes | `/installer` | checking, queued, downloading, verifying, installing, testing, completed, failed, cancelled |
| 5 | Proyectos | `/projects` | empty, loading, ready, error |
| 6 | Base de datos | `/database` | healthy, migrating, degraded, error |
| 7 | Memoria RAG / vectorial | `/memory` | indexed, indexing, partial, no_embeddings, error |
| 8 | Documentos indexados | `/documents` | empty, indexing, ready, unsupported, error |
| 9 | Facturas guardadas | `/invoices` | processing, needs_review, verified, exporting, error |
| 10 | Análisis de datos | `/analytics` | loading, ready, no_data, partial, error |
| 11 | Sistema y recursos | `/system` | ready, partial_permissions, unavailable, error |
| 12 | Catálogo de productos | `/catalog/products` | empty, loading, ready, error |
| 13 | Catálogo de documentos | `/catalog/documents` | empty, loading, ready, unsupported_preview, error |
| 14 | Marca y configuración de documentos | `/settings/brand-invoice` | editing, preview, saved, validation_error |
| 15 | Exportación e impresión | `/exports` | configuring, generating, ready, failed |
| 16 | Flujos en vivo / cerebro de IA | `/workflow/live` | connected, connecting, idle, degraded, offline |
| 17 | Configuración | `/settings` | ready, saving, error |

## Panel principal

- **id**: `dashboard`  ·  **ruta**: `/home`
- **Propósito**: Vista general del estado de FABRI-CORE.

### Layout
- Header with logo and theme accent
- Particle wave visual
- System status cards
- Agent status card
- Ubuntu status
- Database/RAG status
- Recent activity feed
- Quick actions

### Fuentes de datos
- `system_metrics`
- `services`
- `tasks`
- `projects`
- `activity_log`

### Acciones
- Open chat
- Open terminal
- Resume installer
- Open RAG
- Open recent task

### Lógica
- Refresh visible metrics at a conservative interval while foregrounded
- Show unavailable metrics as unavailable, never fabricate values
- Persist last selected project

### Estados

| Estado | Qué muestra la UI |
|---|---|
| `loading` | Esqueleto/spinner; sin datos inventados. |
| `ready` | Datos reales, acciones habilitadas. |
| `partial` | Parte de las fuentes respondió: se marca qué falta y se ofrece reintento. |
| `error` | Mensaje con causa real y acción de reintento; nunca un error genérico. |
| `offline` | Sin conexión con el backend: estado explícito, no valores obsoletos. |

## Chat IA / OpenCode

- **id**: `ai_chat`  ·  **ruta**: `/chat`
- **Propósito**: Conversación con agente real y contexto recuperado.

### Layout
- Agent/provider selector
- Session/project selector
- Message timeline
- Source citations/context chips
- Composer
- Attachment and stop controls

### Fuentes de datos
- `conversations`
- `messages`
- `agent_sessions`
- `rag_results`
- `tasks`

### Acciones
- Send prompt
- Cancel supported task
- Attach document
- Switch project
- Open cited source
- Save correction

### Lógica
- Retrieve relevant context via FTS5 and optional embeddings before agent call
- Label answer provenance: OpenCode, configured LLM, local retrieval, or system result
- Store message and source references transactionally
- If agent unavailable, clearly state unavailable

### Estados

| Estado | Qué muestra la UI |
|---|---|
| `idle` | Estado definido en el spec. |
| `retrieving_context` | Estado definido en el spec. |
| `thinking` | Estado definido en el spec. |
| `tool_running` | Estado definido en el spec. |
| `completed` | Estado definido en el spec. |
| `cancelled` | Estado definido en el spec. |
| `error` | Mensaje con causa real y acción de reintento; nunca un error genérico. |
| `offline` | Sin conexión con el backend: estado explícito, no valores obsoletos. |

## Terminal integrada

- **id**: `terminal`  ·  **ruta**: `/terminal`
- **Propósito**: Consola real para procesos autorizados.

### Layout
- Environment tabs: Android/runtime, Ubuntu, Build, Logs
- Terminal viewport
- Input/command bar
- Keyboard toolbar
- Process status and exit code

### Fuentes de datos
- `terminal_sessions`
- `processes`
- `logs`
- `installed_components`

### Acciones
- Execute allowed command
- Copy output
- Search logs
- Clear view without deleting audit log
- Switch environment

### Lógica
- Bind UI to real process stdin/stdout/stderr
- Show working directory and execution environment
- Do not present logs-only mode as interactive shell
- Require confirmation for destructive actions

### Estados

| Estado | Qué muestra la UI |
|---|---|
| `disconnected` | Estado definido en el spec. |
| `connecting` | Estado definido en el spec. |
| `ready` | Datos reales, acciones habilitadas. |
| `running` | Estado definido en el spec. |
| `exit` | Estado definido en el spec. |
| `error` | Mensaje con causa real y acción de reintento; nunca un error genérico. |

## Instalador y componentes

- **id**: `installer`  ·  **ruta**: `/installer`
- **Propósito**: Descarga e instalación verificable de módulos.

### Layout
- Prerequisite diagnostics
- Component list
- Per-component progress
- Download size/speed if available
- Live logs
- Pause/cancel/retry controls

### Fuentes de datos
- `installer_jobs`
- `component_registry`
- `download_events`
- `logs`

### Acciones
- Install
- Retry
- Cancel safely
- Open logs
- Verify installation

### Lógica
- Use resumable downloads when supported
- Verify checksums/signatures where available
- Persist progress
- Never execute unverified scripts
- Indeterminate progress if total size unknown

### Estados

| Estado | Qué muestra la UI |
|---|---|
| `checking` | Estado definido en el spec. |
| `queued` | Estado definido en el spec. |
| `downloading` | Estado definido en el spec. |
| `verifying` | Estado definido en el spec. |
| `installing` | Estado definido en el spec. |
| `testing` | Estado definido en el spec. |
| `completed` | Estado definido en el spec. |
| `failed` | Estado definido en el spec. |
| `cancelled` | Estado definido en el spec. |

## Proyectos

- **id**: `projects`  ·  **ruta**: `/projects`
- **Propósito**: Administrar espacios de trabajo locales.

### Layout
- Search and filters
- Project cards
- Language/runtime tags
- Git branch/status when available
- Recent activity
- Create/import project

### Fuentes de datos
- `projects`
- `repositories`
- `tasks`
- `activity_log`

### Acciones
- Open project
- Index project
- Run checks
- Create backup
- Import via document picker

### Lógica
- Use app-private project roots by default
- Ask permission for imported external content
- Never overwrite existing project without confirmation

### Estados

| Estado | Qué muestra la UI |
|---|---|
| `empty` | Estado vacío real con acción para crear. |
| `loading` | Esqueleto/spinner; sin datos inventados. |
| `ready` | Datos reales, acciones habilitadas. |
| `error` | Mensaje con causa real y acción de reintento; nunca un error genérico. |

## Base de datos

- **id**: `database`  ·  **ruta**: `/database`
- **Propósito**: Explorador y diagnóstico de SQLite.

### Layout
- Database health summary
- Table list and row counts
- Schema viewer
- Read-only query console by default
- Backup/restore

### Fuentes de datos
- `sqlite_schema`
- `table_stats`
- `migration_history`
- `backup_jobs`

### Acciones
- Inspect table
- Run read-only query
- Export selected table
- Backup
- Validate integrity

### Lógica
- Use parameterized queries
- Require explicit confirmation for writes
- Paginate large tables
- Never expose secret columns by default

### Estados

| Estado | Qué muestra la UI |
|---|---|
| `healthy` | Estado definido en el spec. |
| `migrating` | Estado definido en el spec. |
| `degraded` | Estado definido en el spec. |
| `error` | Mensaje con causa real y acción de reintento; nunca un error genérico. |

## Memoria RAG / vectorial

- **id**: `rag_memory`  ·  **ruta**: `/memory`
- **Propósito**: Consultar y administrar memoria indexada.

### Layout
- Search input
- Mode selector: hybrid, FTS5, semantic
- Filters by source/project/date
- Ranked results
- Similarity and source metadata
- Index status

### Fuentes de datos
- `documents`
- `chunks`
- `embeddings`
- `fts_index`
- `memory_items`

### Acciones
- Search
- Open source
- Reindex
- Delete memory item
- Promote verified correction

### Lógica
- Hybrid retrieval only if both text and vectors are available
- Show provenance and score meaning
- Never label raw keyword match as semantic result
- Embeddings generated on demand and in batches

### Estados

| Estado | Qué muestra la UI |
|---|---|
| `indexed` | Estado definido en el spec. |
| `indexing` | Estado definido en el spec. |
| `partial` | Parte de las fuentes respondió: se marca qué falta y se ofrece reintento. |
| `no_embeddings` | Estado definido en el spec. |
| `error` | Mensaje con causa real y acción de reintento; nunca un error genérico. |

## Documentos indexados

- **id**: `documents`  ·  **ruta**: `/documents`
- **Propósito**: Catálogo de archivos y fuentes de conocimiento.

### Layout
- Search
- Type/date/project filters
- Document cards
- Indexing status
- Preview and metadata

### Fuentes de datos
- `documents`
- `document_versions`
- `chunks`
- `index_jobs`

### Acciones
- Import
- Preview
- Index/reindex
- Export
- Delete index or source with separate confirmations

### Lógica
- Track checksum and source URI
- Avoid duplicate ingestion by checksum
- Keep index deletion separate from source-file deletion

### Estados

| Estado | Qué muestra la UI |
|---|---|
| `empty` | Estado vacío real con acción para crear. |
| `indexing` | Estado definido en el spec. |
| `ready` | Datos reales, acciones habilitadas. |
| `unsupported` | Estado definido en el spec. |
| `error` | Mensaje con causa real y acción de reintento; nunca un error genérico. |

## Facturas guardadas

- **id**: `invoices`  ·  **ruta**: `/invoices`
- **Propósito**: Buscar, revisar y exportar registros de facturas.

### Layout
- Search and date filters
- Invoice list
- Totals summary
- OCR/extraction status
- Invoice detail and attachment preview

### Fuentes de datos
- `invoices`
- `invoice_lines`
- `suppliers`
- `attachments`
- `ocr_jobs`

### Acciones
- Import/scan
- Review extracted fields
- Correct fields
- Export PDF
- Export CSV/XLSX
- Send to RAG

### Lógica
- Keep original document separate from extracted metadata
- Mark OCR confidence and require review for uncertain fields
- Do not represent calculated tax data as official tax filing
- Audit edits

### Estados

| Estado | Qué muestra la UI |
|---|---|
| `processing` | Estado definido en el spec. |
| `needs_review` | Estado definido en el spec. |
| `verified` | Estado definido en el spec. |
| `exporting` | Estado definido en el spec. |
| `error` | Mensaje con causa real y acción de reintento; nunca un error genérico. |

## Análisis de datos

- **id**: `analytics`  ·  **ruta**: `/analytics`
- **Propósito**: Explorar métricas reales del sistema, proyectos, facturas e indexación.

### Layout
- Date range selector
- KPI cards
- Charts
- Category breakdown
- Task/agent performance
- Export controls

### Fuentes de datos
- `invoices`
- `tasks`
- `agent_sessions`
- `index_jobs`
- `system_metrics`

### Acciones
- Change range
- Open source records
- Export report

### Lógica
- Derive KPIs from SQL queries with documented definitions
- Show empty states when data is absent
- Never use fabricated sample values in production

### Estados

| Estado | Qué muestra la UI |
|---|---|
| `loading` | Esqueleto/spinner; sin datos inventados. |
| `ready` | Datos reales, acciones habilitadas. |
| `no_data` | Estado definido en el spec. |
| `partial` | Parte de las fuentes respondió: se marca qué falta y se ofrece reintento. |
| `error` | Mensaje con causa real y acción de reintento; nunca un error genérico. |

## Sistema y recursos

- **id**: `system`  ·  **ruta**: `/system`
- **Propósito**: Monitorización real del dispositivo y los servicios.

### Layout
- CPU/RAM/storage/battery cards
- Process list
- Service health
- Resource profile
- Recent errors

### Fuentes de datos
- `android_metrics`
- `processes`
- `services`
- `logs`

### Acciones
- Refresh
- Change resource profile
- Open logs
- Stop managed process

### Lógica
- Only display metrics the app can access
- Distinguish app metrics from device-wide metrics
- Avoid frequent polling in background

### Estados

| Estado | Qué muestra la UI |
|---|---|
| `ready` | Datos reales, acciones habilitadas. |
| `partial_permissions` | Estado definido en el spec. |
| `unavailable` | Estado definido en el spec. |
| `error` | Mensaje con causa real y acción de reintento; nunca un error genérico. |

## Catálogo de productos

- **id**: `product_catalog`  ·  **ruta**: `/catalog/products`
- **Propósito**: Catálogo móvil independiente para buscar y consultar productos.

### Layout
- Search/filter bar
- Product grid/list toggle
- Product image
- Name/SKU/category/price/stock
- Detail screen
- Print/export actions

### Fuentes de datos
- `products`
- `product_categories`
- `stock_movements`
- `brand_settings`

### Acciones
- Search
- Filter
- Open detail
- Edit when authorized
- Print product sheet
- Export CSV/XLSX/PDF
- Open related invoice

### Lógica
- Use paginated queries
- Validate prices and stock
- Show unavailable image fallback
- Use configured brand identity in printable sheets

### Estados

| Estado | Qué muestra la UI |
|---|---|
| `empty` | Estado vacío real con acción para crear. |
| `loading` | Esqueleto/spinner; sin datos inventados. |
| `ready` | Datos reales, acciones habilitadas. |
| `error` | Mensaje con causa real y acción de reintento; nunca un error genérico. |

## Catálogo de documentos

- **id**: `catalog_documents`  ·  **ruta**: `/catalog/documents`
- **Propósito**: Catálogo independiente de facturas, manuales, contratos, fichas y documentos indexados.

### Layout
- Search/filter bar
- Document type chips
- Cards with thumbnail/type/date/status
- Document detail
- Preview/download/print controls

### Fuentes de datos
- `documents`
- `invoices`
- `attachments`
- `document_tags`

### Acciones
- Search
- Preview
- Open related record
- Print
- Export PDF
- Export metadata CSV/XLSX
- Query through RAG

### Lógica
- Respect document permissions
- Keep original and generated exports distinct
- Use Android share/document picker where appropriate

### Estados

| Estado | Qué muestra la UI |
|---|---|
| `empty` | Estado vacío real con acción para crear. |
| `loading` | Esqueleto/spinner; sin datos inventados. |
| `ready` | Datos reales, acciones habilitadas. |
| `unsupported_preview` | Estado definido en el spec. |
| `error` | Mensaje con causa real y acción de reintento; nunca un error genérico. |

## Marca y configuración de documentos

- **id**: `brand_invoice_settings`  ·  **ruta**: `/settings/brand-invoice`
- **Propósito**: Generador de identidad visual y configuración de facturas/documentos imprimibles.

### Layout
- Brand name and contact form
- Logo uploader for SVG/PNG
- Logo positioning preview
- Theme and typography settings
- Invoice fields toggles
- Live A4/receipt preview
- PDF/export options

### Fuentes de datos
- `brand_settings`
- `document_templates`
- `export_profiles`

### Acciones
- Import SVG/PNG
- Crop/scale/align logo
- Set margins
- Configure header/footer
- Save template
- Preview
- Export sample

### Lógica
- Sanitize SVG and disallow scripts/external references
- Validate PNG dimensions and size
- Keep original asset
- Embed or rasterize SVG safely for PDF renderer
- Support left/center/right logo alignment
- Preserve legibility and aspect ratio

### Estados

| Estado | Qué muestra la UI |
|---|---|
| `editing` | Estado definido en el spec. |
| `preview` | Estado definido en el spec. |
| `saved` | Estado definido en el spec. |
| `validation_error` | Estado definido en el spec. |

## Exportación e impresión

- **id**: `exports`  ·  **ruta**: `/exports`
- **Propósito**: Exportar información a formatos interoperables.

### Layout
- Choose data source
- Column/field selector
- Date range
- Format selector
- Preview
- Progress and result

### Fuentes de datos

### Acciones
- Generate
- Save through Android document picker
- Print using Android print framework
- Share export

### Lógica
- PDF for reports and print-ready documents
- XLSX for spreadsheet analysis
- CSV for interchange
- Record export metadata without duplicating sensitive payloads in logs

### Estados

| Estado | Qué muestra la UI |
|---|---|
| `configuring` | Estado definido en el spec. |
| `generating` | Estado definido en el spec. |
| `ready` | Datos reales, acciones habilitadas. |
| `failed` | Estado definido en el spec. |

## Flujos en vivo / cerebro de IA

- **id**: `live_workflow`  ·  **ruta**: `/workflow/live`
- **Propósito**: Visualización animada de la comunicación entre UI, backend, SQL, FTS5, embeddings, RAG, agente y proveedores externos.

### Layout
- Animated node graph
- Live event stream
- Data source/status cards
- Selected node detail
- Pause/resume visual stream
- Legend

### Fuentes de datos
- `event_bus`
- `task_events`
- `agent_events`
- `database_events`
- `index_jobs`

### Acciones
- Inspect node
- Filter events
- Pause visual updates
- Open related task
- Export event log

### Lógica
- Render HTML/SVG/Canvas animation only from actual events
- Differentiate live events from illustrative animation
- Use WebSocket/SSE/local event bridge only if implemented
- Do not display fake packet counts or fake data transfers
- Reduce animation rate in battery saver

### Estados

| Estado | Qué muestra la UI |
|---|---|
| `connected` | Estado definido en el spec. |
| `connecting` | Estado definido en el spec. |
| `idle` | Estado definido en el spec. |
| `degraded` | Estado definido en el spec. |
| `offline` | Sin conexión con el backend: estado explícito, no valores obsoletos. |

## Configuración

- **id**: `settings`  ·  **ruta**: `/settings`
- **Propósito**: Preferencias, proveedores, recursos, seguridad y copias de seguridad.

### Layout
- Theme picker
- Resource profile
- Provider configuration
- Embedding model management
- Permissions
- Backup/restore
- Privacy controls

### Fuentes de datos

### Acciones
- Select lime/purple/blue/gold theme
- Preview/apply
- Configure provider
- Download/remove model
- Backup/restore
- Manage retention

### Lógica
- Persist settings locally
- Never expose API keys in logs
- Warn before deleting models or data
- Offer a full export before app removal

### Estados

| Estado | Qué muestra la UI |
|---|---|
| `ready` | Datos reales, acciones habilitadas. |
| `saving` | Estado definido en el spec. |
| `error` | Mensaje con causa real y acción de reintento; nunca un error genérico. |

