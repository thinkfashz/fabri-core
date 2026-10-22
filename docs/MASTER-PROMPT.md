# FABRI-CORE · PROMPT MAESTRO (canónico)

> Este es el prompt rector del proyecto. Está escrito para que **cualquier agente** (OpenCode
> en el teléfono, Claude Code, Codex o un portátil) pueda tomar el proyecto y ejecutarlo sin
> inventar. La sección 12 añade las **restricciones reales medidas** en este equipo: sin ellas,
> el build "funciona" en un escritorio y se muere en el Android.

---

## 1. Rol

Actúa como **arquitecto de software sénior** especializado en Kotlin, Android, Go, SQLite,
FTS5, RAG, embeddings, agentes de IA, terminales Linux, generación de PDF/XLSX y visualización
de sistemas en tiempo real.

Implementa **FABRI-CORE** como una aplicación Android instalable, construible desde el propio
teléfono y con almacenamiento privado persistente.

## 2. Contrato funcional (obligatorio)

Lee y usa `spec/fabri_core_android_screen_spec.json` como contrato. Cada pantalla del JSON
tiene su ruta, componentes, acciones, estados de carga, manejo de errores y fuentes de datos.

- No reduzcas el proyecto a un dashboard genérico.
- No elimines módulos para simplificar sin **documentar la decisión** (queda en
  `docs/ERRORES-Y-MEJORAS.md` → "Decisiones y exclusiones").
- La documentación de pantallas se **genera** del spec: `python3 docs/generar-docs.py`.
  Si tocas el JSON, regenera; no edites `docs/SCREENS.md` a mano.

## 3. Aplicación Android

- Kotlin + Android SDK, navegación nativa, almacenamiento privado, permisos mínimos,
  gestión de tareas, notificaciones apropiadas y **recuperación de estado**.
- Prepara un entorno de build local con lo necesario para compilar y **firmar** la APK desde
  Android. **No presupongas** que Ubuntu o PRoot traen Android SDK, JDK o Gradle: documen
  exactamente qué hay que descargar (y cuánto pesa) en `docs/EXECUTION.md`.
- Dependencias declaradas, con su origen y su licencia.

## 4. Sistema visual multicolor

Cuatro temas, aplicados a **todo**: botones, navegación, indicadores, gráficas, terminal,
instalador y visualizaciones.

| Tema | Color | Nombre |
|---|---|---|
| Lime | `#C8FF00` | Verde limón |
| Purple | `#A855F7` | Morado |
| Blue | `#3B82F6` | Azul |
| Gold | `#EAB308` | Amarillo oro |

- Pantalla de vista previa, persistencia del tema y **contraste accesible**.
- Fondo negro, tarjetas oscuras, bordes discretos, estética tecnológica premium.
- Tokens y componentes: reusa el sistema de diseño de Fabrick
  (`~/.config/opencode/skills/meta-fabrick/design/tokens.json` + `components.css`, clases `.ds-*`)
  para que la app no invente un segundo lenguaje visual.

## 5. Base de datos y cerebro de IA

- SQLite como **fuente de verdad local**; comprobar la disponibilidad de **FTS5** en el
  dispositivo antes de prometerlo (y *degradar* con honestidad si no está).
- Recuperación **híbrida**: textual + embeddings cuando haya embeddings utilizables.
- Indexar documentos, código, proyectos, facturas y conversaciones autorizadas.
- **Cada resultado conserva su procedencia** (documento, fragmento, tabla, mensaje).
- No confundas coincidencia textual, similitud semántica y razonamiento del modelo: son
  tres cosas y la UI las distingue.
- El usuario puede **corregir, validar, eliminar y reconstruir** elementos de memoria.

## 6. Agente y flujo de comunicación

- Integra **OpenCode** por interfaces documentadas y compatibles con el entorno elegido
  (el teléfono: CLI por loopback o el puente de sesión; escritorio: servidor).
- Chat con sesiones, historial, estado de ejecución y **referencias al conocimiento recuperado**.
- Pantalla independiente **Cerebro IA / Flujos en vivo** con un grafo animado:
  `Android UI → Backend Go → SQLite → FTS5 → Embeddings → RAG → Agente IA → Resultados → Memoria`.
- También los flujos de documentos, facturas, catálogos y exportaciones.
- Animación en HTML/SVG/Canvas dentro de la app.
- **Eventos reales** por SSE/WebSocket/puente local. **No inventes** transferencias, contadores,
  velocidades ni procesos: si no hay eventos, muestra *inactivo* o *desconectado*.
- El mecanismo de eventos es parte de la app, no un mock: backend Go emitiendo sobre el
  mismo canal que usa el chat.

## 7. Catálogos y facturas (módulos independientes)

Catálogo de productos · catálogo de documentos · facturas guardadas · explorador de base de
datos · memoria vectorial · análisis de datos · exportación e impresión · generador de marca ·
configuración de documentos.

- Buscar, filtrar, ver detalles, abrir registros relacionados, imprimir/exportar lo autorizado.
- Facturas: conservar el **documento original**, sus metadatos, el resultado **OCR** y el
  estado de revisión.
- **No presentes cálculos internos como declaración tributaria oficial.**

## 8. Generador de marca y plantillas

Nombre comercial · logo SVG/PNG · posición (izquierda/centro/derecha) · escala y márgenes ·
colores · encabezado y pie · datos de contacto · campos de facturas y documentos · vista previa
de impresión.

- **Valida y sanitiza el SVG** antes de usarlo: sin scripts, sin referencias externas.
- Conserva la **proporción** del logo y permite exportar plantillas a PDF.

## 9. Exportación

PDF, XLSX y CSV: fuente de datos, columnas, filtros y rango de fechas; selector de archivos
de Android (SAF) para guardar; **progreso real**, errores, previsualización e impresión vía
Android. **No generes archivos vacíos** presentándolos como exportaciones exitosas.

## 10. Terminal, Ubuntu e instalador

- Terminal conectada a **procesos reales**.
- Instalador con diagnóstico, descarga, verificación, instalación, pruebas, registros y
  recuperación de errores.
- Ubuntu vía PRoot: **componente opcional** y solo tras validar compatibilidad. No supongas
  que `proot-distro` funciona en una APK independiente sin adaptar dependencias.
- **No requiere root.** No ejecutes scripts remotos sin verificar su procedencia.

## 11. Persistencia y eficiencia

- Conversaciones, configuración, tareas, documentos, proyectos, facturas y memoria en BD
  local + archivos privados.
- Migraciones, **copias de seguridad, restauración** y tareas reanudables.
- RAM y batería: indexación incremental, concurrencia limitada, cachés acotadas, modelos
  descargables bajo demanda, respeto de las restricciones de background de Android.

## 12. Protocolo de implementación

1. Inspeccionar el entorno y el JSON.
2. Diseñar arquitectura y esquema SQL.
3. Construir la APK y la navegación.
4. Implementar los temas.
5. Implementar SQLite y FTS5.
6. Implementar catálogos, facturas y documentos.
7. Implementar PDF, XLSX y CSV.
8. Implementar RAG y embeddings.
9. Integrar el agente.
10. Implementar terminal e instalador.
11. Construir el grafo animado con eventos reales.
12. Integrar Ubuntu si supera las pruebas de compatibilidad.
13. Ejecutar pruebas de persistencia, seguridad y consumo.
14. Generar la APK y **verificar el artefacto** cuando el entorno lo permita.

Entrega: código fuente, estructura del proyecto, migraciones SQL, instrucciones de compilación,
pruebas y **limitaciones conocidas**. No afirmes que una función está terminada hasta
comprobarla.

---

## 13. Realidad del equipo objetivo (medido, no supuesto)

Esto es lo que aprendimos construyendo y **renderizando video en un Android con proot**. Sin
esto, el prompt anterior produce un plan que funciona en un portátil y muere en el teléfono.

| Límite | Medido | Consecuencia para FABRI-CORE |
|---|---|---|
| RAM total del teléfono | 7,5 GB (con ~4 GB de swap) | El proceso con más RSS es el que mata el kernel. |
| Servicio de OpenCode | 450-630 MB | Todo lo demás tiene que caber en ~1,5 GB. |
| Chromium **completo** (393 MB) | levanta **GPU + zygotes** | Prohibido: mata el proceso mayor (el de OpenCode). Usar siempre el **headless shell** (266 MB, 1 proceso). |
| Un Chromium del render | ~400-650 MB | Un render de video + el resto del ecosistema = al límite. Render **uno a la vez** y con guardián de RAM. |
| `pm2` en proot | daemon de 145 MB a 20-37 % de CPU, `jlist` > 60 s | No usarlo como supervisor: **supervisor propio** (`masterlib/bin/supervisor.sh`) y arranque escalonado. |
| IPv6 | black hole (curl -6 → 000) | Forzar IPv4 en todo lo que hable con la red (`--ipv4`, `dns-result-order=ipv4first`). |
| SQLite FTS5 | depende del build de Android | **Comprobar en runtime** y degradar con honestidad (la spec ya lo pide). |
| Compilar la APK desde el teléfono | viable pero pesado (JDK + SDK + Gradle, GB) | Plan de build en fases, con "checklist de dependencias" y build incremental; el artefacto se firma en el dispositivo. |
| PRoot dentro de una APK | no es lo mismo que el proot de Termux | PRoot de la app: **opcional** y solo tras test de compatibilidad real. |

### Reglas de operación (heredadas de la sesión)

1. **Nunca** reiniciar OpenCode ni matar sus procesos desde un agente.
2. Todo trabajo largo: **desacoplado** (setsid/nohup), con log y lock.
3. Antes de algo pesado: mirar RAM (`masterlib/bin/guard.sh status`) y pausar lo no esencial.
4. Preferir el **headless shell** para cualquier navegador.
5. Verificar artefactos, no solo códigos de salida.

---

## 14. Glosario operativo

| Término | Significado en este proyecto |
|---|---|
| `masterlib` | `/root/masterlib`: librería compartida (UI, 3D, anatomía, utilidades seguras). |
| `motor` | `/root/video-engine/motor.mjs`: motor de video (guion → TTS → composición → MP4 → Telegram). |
| `supervisor` | `masterlib/bin/supervisor.sh`: reemplazo de pm2 (2 MB, sin daemon). |
| `guard` | `masterlib/bin/guard.sh`: pausa servicios no esenciales si falta RAM. |
| `everos` | Memoria local (Markdown + índice híbrido) vía MCP. |
| `state` | `~/.config/opencode/STATE.md`: bitácora de trabajo. |
