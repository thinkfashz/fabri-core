# FABRI-CORE · Errores encontrados y mejoras aplicadas

> Catálogo vivo: cada error que aparece en una etapa se documenta aquí con **síntoma →
> causa → arreglo → regla para que no se repita**. Es la bitácora técnica del proyecto y
> también el manual de traps para el equipo.

Leyenda: ✅ resuelto y verificado · 🟡 mitigado/pendiente de prueba · 📌 regla permanente

---

## A. Entorno Android/proot (la sección que más cuesta sangre)

### A1 · El Chromium completo mata al servidor de OpenCode ✅
- **Síntoma**: la sesión se cerraba sola; el kernel mataba el proceso con más RSS.
- **Causa**: `chromium-1243` (393 MB) levanta el proceso de **GPU y varios zygotes**.
- **Arreglo**: usar siempre el **headless shell** (`chromium_headless_shell-1243`, 266 MB,
  un proceso). Corregido en `env.sh`, `.bashrc`, el plugin `always-on.ts` y el motor de video.
- 📌 **Regla**: ningún navegador completo. Para capturas: `masterlib/bin/shot.sh`.

### A2 · pm2 como supervisor satura la CPU y la RAM ✅
- **Síntoma**: daemon de 145 MB al 20-37 % de CPU; `pm2 jlist` > 60 s; `pm2 resurrect`
  levanta 6 servicios de golpe (+350 MB) → el kernel mata al de OpenCode.
- **Arreglo**: supervisor propio de 2 MB (`masterlib/bin/supervisor.sh`) + arranque escalonado
  (`services-up.sh`, 8 s entre servicios) + watchdog de RAM.
- 📌 **Regla**: no llamar `pm2 jlist/resurrect/start` desde una sesión.

### A3 · IPv6 es un black hole en esta red ✅
- **Síntoma**: MCP de Vercel/GitHub con "Request timed out" de forma intermitente.
- **Causa**: `curl -6` → 000; undici prueba los AAAA primero y espera hasta el timeout.
- **Arreglo**: `--ipv4` en los wrappers, `NODE_OPTIONS=--dns-result-order=ipv4first` en Node,
  `--edge-ip-version 4` en el túnel de Cloudflare.
- 📌 **Regla**: en esta red, IPv4 forzado en todo lo que salga a internet.

### A4 · El contenedor se reinicia y se lleva los renders largos ✅
- **Síntoma**: el render moría al 40 % y había que empezar de cero.
- **Arreglo**: render **reanudable** (trozos con hash en el nombre), guion en `.bashrc` que
  reanuda solo, escritura atómica de los MP4.
- 📌 **Regla**: todo proceso largo va desacoplado, con log, lock y checkpoints en disco.

### A5 · Dos motores a la vez se pisan ✅
- **Síntoma**: `ffmpeg … Error opening output …/video-only.mp4: No such file or directory`.
- **Causa**: dos motores de HyperFrames limpiando/creando los mismos directorios de trabajo.
- **Arreglo**: `flock` **por spec** (no global: el lock global hacía que un test bloqueara al
  render real).
- 📌 **Regla**: un lock por unidad de trabajo, nunca uno global.

### A6 · El guardián de RAM miraba la columna equivocada ✅
- **Síntoma**: el motor esperaba "sin memoria" teniendo 2 GB disponibles.
- **Causa**: leía `free` en vez de `available` (la buff/cache es recuperable).
- **Arreglo**: usar `available`; umbral 700 MB; y si no hay, **esperar** (no renderizar).
- 📌 **Regla**: "no hay RAM" = no se renderiza. Mejor tardar que matar la sesión.

### A7 · `npm i -g` no dejó los symlinks de los binarios ✅
- **Síntoma**: `hyperframes: command not found` pese a estar instalado.
- **Arreglo**: crear el symlink a mano (`/usr/bin/hyperframes` → `node_modules/.../bin/…`).
- 📌 **Regla**: después de un `npm i -g`, verificar `command -v` y symlinkear si falta.

### A8 · `uv pip install` falló copiando un paquete ✅
- **Síntoma**: `Failed to copy … python-dotenv … No such file or directory`.
- **Arreglo**: `UV_LINK_MODE=copy` + `--cache-dir` alterno.
- 📌 **Regla**: en este FS, `uv` siempre con `UV_LINK_MODE=copy`.

---

## B. Motor de video (HyperFrames / Manim / Revideo / Three.js)

### B1 · El timeline de GSAP se generaba con sintaxis inválida ✅
- **Síntoma**: el render esperaba 45 s y moría con *"Sub-composition timelines not registered"*.
- **Causa**: generábamos `{"opacity":1}, {duration:.5}` (doble llave) → el `<script>` no
  parseaba → `window.__timelines["main"]` nunca se registraba.
- **Arreglo**: construir el objeto de destino **dentro** de las llaves y pasarle la duración.
- 📌 **Regla**: el JS generado se valida con `node --check` antes de renderizar.

### B2 · Revideo: `scene.add()` acepta UN nodo ✅
- **Síntoma**: en la animación faltaban el título y el subtítulo, y los textos se pisaban.
- **Causa**: `scene.add(a, b, c)` solo agregaba el primero.
- **Arreglo**: una llamada por nodo. Documentado en la escena.
- 📌 **Regla**: en Revideo 0.11 el runner es un **generador** (`function*`) y las animaciones
  van con `yield*`.

### B3 · Revideo: el eje Y va hacia ABAJO ✅
- **Síntoma**: el kicker "EL POTENCIAL" aparecía abajo.
- **Causa**: asumimos el convenio de Motion Canvas (Y arriba); en Revideo/canvas es Y abajo.
- **Arreglo**:Positions recalculadas; calibration con una escena de prueba.

### B4 · Los imports ES fallan por CORS con `file://` ✅
- **Síntoma**: `Access to script at 'file://…/three.module.js' … blocked by CORS`.
- **Arreglo**: Three.js como **script clásico** (UMD) y el módulo propio también clásico.
- 📌 **Regla**: nada de `<script type="module">` en composición servida por file://.

### B5 · El player de HyperFrames reemplaza el DOM ✅
- **Síntoma**: la escena 3D se veía negra: lo que el script creaba desaparecía.
- **Arreglo**: emitir el markup **en el HTML** de la composición (CSS 3D) y dejar el JS solo
  para animar.
- 📌 **Regla**: lo que se ve, va en el HTML; el JS solo mueve cosas que ya existen.

### B6 · Los shaders de Three.js no compilan en SwiftShader headless ✅
- **Síntoma**: `VALIDATE_STATUS false` / `WebGL context could not be created`.
- **Arreglo**: la ruta 3D del video es **CSS 3D** (`rotateY/translateZ`); Three.js queda para
  el navegador real (`masterlib/video/diorama.js`).
- 📌 **Regla**: en headless no hay GPU: diseñar el 3D para CSS.

### B7 · El hash no incluía el código del motor ✅
- **Síntoma**: se reusaban renders hechos con una versión anterior de `compose.mjs` (audio
  desalineado, imagen nueva con video viejo).
- **Arreglo**: el hash incluye la **mtime** de `lib/compose.mjs` y `lib/tts.mjs`.
- 📌 **Regla**: el hash de caché = contenido + versión del código que lo produce.

### B8 · La limpieza de trozos borraba los válidos ✅
- **Síntoma**: la biblioteca de escenas se vaciaba en cada pasada.
- **Causa**: el patrón de borrado coincidía con los nombres con hash.
- **Arreglo**: borrar solo los trozos cuyo hash **difiere** del actual.

### B9 · El pase de color dejaba MP4 corruptos ✅
- **Síntoma**: `moov atom not found` en un video entregado.
- **Arreglo**: escribir a `.tmp.mp4` y `rename` atómico al final.
- 📌 **Regla**: un artefacto a medias no se entrega nunca.

### B10 · `unsharp` en el grade se comía 1:42 de encode ✅
- **Arreglo**: grade solo con `eq` + `colorbalance`; el sharpen se hace en el HTML.

### B11 · libass ignora `PlayResX/PlayResY` en los SRT ✅
- **Síntoma**: subtítulos gigantes en vertical (×4,4).
- **Causa**: libass escala por `alto/288` (PlayRes por defecto) y el SRT no lo declara.
- **Arreglo**: `FontSize` **constante** (9 ≈ 3,1 % del alto) en cualquier formato.
- 📌 **Regla**: tamaño de subtítulo proporcional = número fijo, no "por alto".

### B12 · `ROOT is not defined` en `tts.mjs` ✅
- **Síntoma**: todas las escenas salían "sin voz" (5 s cada una).
- **Arreglo**: importar `ROOT` en el módulo.

### B13 · edge-tts 7.3.1 no da tiempos por palabra ✅
- **Síntoma**: los captions cinéticos no aparecían.
- **Causa**: por defecto emite `SentenceBoundary`; el CLI `--write-subtitles` escribe SRT.
- **Arreglo**: `Communicate(text, voice, boundary="WordBoundary")` y un helper propio
  (`lib/edge_words.py`) que guarda audio + JSON de tiempos por palabra.

### B14 · `continue` dentro de una arrow function ✅
- **Síntoma**: error de sintaxis al|Nationalizar el render por escenas.
- **Arreglo**: `return` en vez de `continue`.

### B15 · El SRT con cabecera `[Script Info]` rompía el parseo ✅
- **Arreglo**: SRT sin cabecera; el tamaño se resuelve con `FontSize` constante.

---

## C. MCP y agentes

### C1 · El banner del servidor ensucia stdout y rompe el MCP ✅
- **Síntoma**: `notebooklm failed: Request timed out` en `opencode mcp list`.
- **Causa**: el CLI imprimía el banner de rich **en stdout**, que es el canal JSON-RPC.
- **Arreglo**: `Console(stderr=True)`.
- 📌 **Regla**: en un MCP por stdio, **stdout es solo JSON-RPC**.

### C2 · El cliente de NotebookLM levantaba Chrome al arrancar ✅
- **Síntoma**: el handshake nunca terminaba; en GUI sin display, Chrome moría.
- **Arreglo**: cliente **lazy** (se inicializa en la primera tool) y `headless: true`.

### C3 · El paquete de TypeScript de NotebookLM está archivado ✅
- **Síntoma**: `notebooklm-mcp` (npm, PleasePrompto) sin mantenimiento desde 09-2026.
- **Arreglo**: usar el paquete **Python** `notebooklm-mcp` (FastMCP v2, v2.0.11).

### C4 · MCP duplicados por proyecto ✅
- **Síntoma**: dos juegos de MCP (~500-675 MB) porque cada *project root* abre su set.
- **Arreglo**: un solo project root; `.git` movido fuera de `~/.config/opencode`.

---

## D. Riesgos de FABRI-CORE por verificar (🟡 pendiente de prueba)

Cada uno tiene su método de verificación. **No se afirma nada hasta que la prueba pase.**

| # | Riesgo | Cómo se verifica | Mitigación si falla |
|---|---|---|---|
| D1 | **FTS5 no está en el SQLite de Android** | `SELECT sqlite_compileoption_used('ENABLE_FTS5')` en runtime | Índice inverso propio en `document_chunks` + fallback textual; la UI lo declara ("sin FTS5: búsqueda lineal"). |
| D2 | **SQLite del sistema no soporta FTS5 ni concurrencia** | Compilar SQLite propio (NDK) o usar `SQLiteDatabase` de Android | Usar el `SQLiteDatabase` del framework con FTS5 vía `setSQLiteMagic`/extensión, o empaquetar `sqlite3` con FTS5. |
| D3 | **Go en Android** | `GOOS=android GOARCH=arm64 go build` + prueba en dispositivo | El backend Go puede ser opcional: la app habla con el **OpenCode CLI** por loopback en lugar de un binario embebido. |
| D4 | **Terminal con PTY real** | Probar `forkpty`/libtermux en el dispositivo | Terminal como **cliente SSH** a un shell local en el teléfono (Termux) o usar `exec` sin PTY, declarando el límite. |
| D5 | **PRoot dentro de la APK** | Lanzar `proot` + rootfs en un directorio privado | PRoot queda **opcional**; la app ofrece "instalar userland" con verificación de arquitectura y declara la incompatibilidad si falla. |
| D6 | **Embeddings en el dispositivo** | Medir RAM/tiempo de un modelo chico (MiniLM cuantizado) | Embeddings **bajo demanda** (descarga) o solo en el servidor; si no hay, la búsqueda es textual y la UI lo dice. |
| D7 | **Compilar la APK desde el teléfono** | `gradle assembleDebug` en el dispositivo | Plan de build por fases (JDK 17, SDK por paquete, `gradle` offline) y alternativa "build en CI + APK instalada". |
| D8 | **Firmar la APK en el dispositivo** | `apksigner` con clave generada por `keytool` | Clave de depuración generada en el dispositivo; release con clave que el usuario保护 en su Keystore. |
| D9 | **OCR de facturas** | Probar motor OCR en ARM (Tesseract/ML Kit) | OCR **opcional** y descargable; sin él, la factura queda `needs_review`. |
| D10 | **SSE desde el backend Go al WebView** | Conectar y ver eventos reales | Alternativa: WebSocket app-private; si el proceso Go no corre, la pantalla muestra *desconectado* (nunca datos inventados). |

---

## E. Decisiones y exclusiones (documentadas, no silenciadas)

| Decisión | Motivo | Dónde se refleja |
|---|---|---|
| El grafo "en vivo" muestra estados **desconectado/idle** cuando no hay eventos | La spec lo exige: no inventar transferencias ni contadores | Pantalla `/workflow/live` |
| Ubuntu/PRoot es **opcional** y se valida antes | Un APK independiente no trae el userland de Termux | Instalador con test de compatibilidad |
| Los cálculos de facturas **no** son declaración tributaria | Riesgo legal | Módulo de facturas: etiqueta explícita |
| `pm2` no se usa como supervisor | Medición de CPU/RAM en proot | `masterlib/bin/supervisor.sh` |
| El motor de video usa **CSS 3D** y no WebGL en headless | SwiftShader no compila los shaders | `masterlib/video/diorama.js` (Three.js) queda para navegador real |
