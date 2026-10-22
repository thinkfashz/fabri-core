# FABRI-CORE · Arquitectura y datos (v1.0.0-spec)

> Sección de esquema generada desde el spec. El resto del documento (decisiones, IPC, grafo en vivo) está en `ARCHITECTURE.md`.

## Modelo de datos

| Tabla | Propósito |
|---|---|
| `app_settings` | Preferencias, tema, perfil de recursos y configuración no secreta |
| `projects` | Proyectos y espacios de trabajo |
| `conversations` | Sesiones de chat |
| `messages` | Mensajes, procedencia y referencias |
| `agent_sessions` | Sesiones del agente |
| `tasks` | Tareas ejecutables y estado recuperable |
| `task_events` | Eventos de progreso y auditoría |
| `documents` | Metadatos y ubicación de documentos |
| `document_chunks` | Fragmentos de documentos indexados |
| `document_fts` | Índice FTS5, sujeto a disponibilidad comprobada |
| `embeddings` | Vectores, modelo, dimensiones y vínculo al fragmento |
| `memory_items` | Memoria con procedencia, estado de verificación y retención |
| `invoices` | Metadatos estructurados de facturas |
| `invoice_lines` | Detalle de líneas |
| `suppliers` | Proveedores |
| `products` | Catálogo de productos y SKU |
| `product_categories` | Categorías de productos |
| `brand_settings` | Identidad visual y datos de emisión documental |
| `document_templates` | Plantillas de impresión/exportación |
| `installed_components` | Versiones y comprobaciones de componentes |
| `backup_jobs` | Historial de copias y restauraciones |

