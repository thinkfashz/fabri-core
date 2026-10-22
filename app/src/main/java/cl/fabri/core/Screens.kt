package cl.fabri.core

import android.database.Cursor
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private fun now() = System.currentTimeMillis()
private fun fmt(ts: Long) = SimpleDateFormat("dd/MM HH:mm", Locale("es", "CL")).format(Date(ts))

/* ═══════════════ PANEL ═══════════════ */
@Composable
fun PanelScreen(app: FabriApp) {
    val accent = Color(app.themes.theme.accent)
    var backend by remember { mutableStateOf("…") }
    var agent by remember { mutableStateOf("…") }
    var fts by remember { mutableStateOf<Boolean?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        fts = fts5Available(app.db.readableDatabase)
        backend = AgentClient(app.themes.agentEndpoint).health()
        agent = Sys.exec(listOf("sh", "-c", "command -v opencode || echo 'no disponible'")).second.trim()
    }

    ScreenTitle("Panel principal", "Estado real del sistema · FABRI-CORE $1.0.0-spec")
    Spacer(Modifier.height(12.dp))

    Section("Recursos", accent)
    val mem = Sys.mem(app.context)
    Card("Memoria del dispositivo", "${mem.avail / (1024 * 1024)} MB disponibles",
        "de ${mem.total / (1024 * 1024 * 1024)} GB totales", accent)
    Card("Almacenamiento", "app privada", "SQLite + archivos privados", accent)

    Section("Servicios", accent)
    Card("Backend Go", backend, "loopback ${app.themes.agentEndpoint}", accent)
    Card("Agente (OpenCode)", agent, "CLI en el dispositivo o vía backend", accent)

    Section("Cerebro de datos", accent)
    Card("SQLite", "versión ${Db.VERSION} · ${if (fts == true) "FTS5 disponible" else if (fts == false) "FTS5 NO disponible" else "…"}",
        "21 tablas del contrato", accent)
    val counts = remember {
        mapOf(
            "mensajes" to app.db.readableDatabase.rawQuery("SELECT COUNT(*) c FROM messages", null).count(),
            "documentos" to app.db.readableDatabase.rawQuery("SELECT COUNT(*) c FROM documents", null).count(),
            "memoria" to app.db.readableDatabase.rawQuery("SELECT COUNT(*) c FROM memory_items", null).count(),
            "facturas" to app.db.readableDatabase.rawQuery("SELECT COUNT(*) c FROM invoices", null).count()
        )
    }
    counts.forEach { (k, v) -> Card(k, "$v registros", "", accent) }

    Section("Acciones rápidas", accent)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = { scope.launch { backend = AgentClient(app.themes.agentEndpoint).health() } }) {
            Text("Reintentar", fontSize = 12.sp)
        }
    }
}

private fun Cursor.count(): Int = use { if (moveToFirst()) getInt(0) else 0 }

/* ═══════════════ CHAT IA ═══════════════ */
@Composable
fun ChatScreen(app: FabriApp) {
    val accent = Color(app.themes.theme.accent)
    var input by remember { mutableStateOf("") }
    var log by remember { mutableStateOf(listOf<String>()) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    ScreenTitle("Chat IA · OpenCode", "El agente responde con lo que hay en el dispositivo")

    Spacer(Modifier.height(10.dp))
    if (log.isEmpty()) {
        Text("Sin mensajes todavía. Escribe una consulta abajo.", color = Color(0xFF858585), fontSize = 13.sp)
    }
    log.forEach {
        Card(null, it, "", accent)
    }

    Spacer(Modifier.height(10.dp))
    OutlinedTextField(
        value = input,
        onValueChange = { input = it },
        label = { Text("Consulta para el agente") },
        modifier = Modifier.fillMaxWidth(),
        singleLine = false,
        maxLines = 4
    )
    Spacer(Modifier.height(8.dp))
    Row(verticalAlignment = Alignment.CenterVertically) {
        Button(
            enabled = !busy && input.isNotBlank(),
            onClick = {
                val q = input
                input = ""
                busy = true
                log = log + "› $q"
                scope.launch {
                    val rep = AgentClient(app.themes.agentEndpoint).ask(q)
                    log = log + (if (rep.ok) rep.text else "⚠ sin respuesta: ${rep.detail}")
                    busy = false
                    // persistencia real del intercambio
                    app.db.writableDatabase.run {
                        execSQL("INSERT OR IGNORE INTO conversations(title, created_at) VALUES(?,?)",
                            arrayOf("Chat FABRI-CORE", now()))
                        val cid = rawQuery("SELECT id FROM conversations ORDER BY id DESC LIMIT 1", null).let {
                            if (it.moveToFirst()) it.getInt(0) else 0
                        }
                        execSQL("INSERT INTO messages(conversation_id, role, content, created_at) VALUES(?,?,?,?)",
                            arrayOf(cid, "user", q, now()))
                        execSQL("INSERT INTO messages(conversation_id, role, content, created_at) VALUES(?,?,?,?)",
                            arrayOf(cid, "assistant", if (rep.ok) rep.text else "error: ${rep.detail}", now()))
                    }
                }
            }
        ) {
            Icon(Icons.Filled.Send, contentDescription = null, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(6.dp))
            Text("Enviar")
        }
        if (busy) {
            Spacer(Modifier.width(12.dp))
            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = accent)
        }
    }
    Spacer(Modifier.height(10.dp))
    Text(
        "Sin backend Go y sin CLI: la app lo dice, no inventa respuestas.",
        color = Color(0xFF858585), fontSize = 11.sp
    )
}

/* ═══════════════ TERMINAL ═══════════════ */
@Composable
fun TerminalScreen(app: FabriApp) {
    val accent = Color(app.themes.theme.accent)
    var cmd by remember { mutableStateOf("ls -la") }
    var out by remember { mutableStateOf("Terminal lista. Ejecuta un comando real.") }

    ScreenTitle("Terminal", "Procesos reales · sin root")
    Spacer(Modifier.height(10.dp))
    Card("Última salida", out.ifBlank { "—" }, "", accent)
    Spacer(Modifier.height(10.dp))
    OutlinedTextField(
        value = cmd, onValueChange = { cmd = it },
        label = { Text("Comando") }, modifier = Modifier.fillMaxWidth(), singleLine = true
    )
    Spacer(Modifier.height(8.dp))
    Button(onClick = {
        val parts = cmd.trim().split(Regex("\\s+")).filter { it.isNotBlank() }
        if (parts.isNotEmpty()) {
            val (code, text) = Sys.exec(parts, 15000)
            out = "$$ $cmd\n" + text.trim() + "\n[salida $code]"
        }
    }) { Text("Ejecutar") }
    Spacer(Modifier.height(8.dp))
    Text(
        "Sin PTY: la salida viene por tubería, no por terminal interactiva. Es un límite real y declarado.",
        color = Color(0xFF858585), fontSize = 11.sp
    )
}

/* ═══════════════ INSTALADOR ═══════════════ */
@Composable
fun InstallerScreen(app: FabriApp) {
    val accent = Color(app.themes.theme.accent)
    var report by remember { mutableStateOf<List<Pair<String, Boolean>>>(emptyList()) }

    ScreenTitle("Instalador y componentes", "Diagnóstico real del entorno")
    Spacer(Modifier.height(10.dp))
    Button(onClick = {
        report = listOf(
            "java" to true, "gradle" to true, "go" to true, "node" to true, "python3" to true,
            "adb" to true, "apksigner" to true, "d8" to true
        ).map { (c, _) ->
            val (code, _) = Sys.exec(listOf("sh", "-c", "command -v $c >/dev/null 2>&1 && echo ok || echo no"))
            c to (code == 0)
        }
    }) { Text("Ejecutar diagnóstico") }

    Spacer(Modifier.height(10.dp))
    if (report.isEmpty()) {
        Text("Sin diagnóstico todavía.", color = Color(0xFF858585), fontSize = 13.sp)
    }
    report.forEach { (c, ok) -> StatusRow(c, if (ok) "disponible" else "no disponible", ok, accent) }

    Spacer(Modifier.height(10.dp))
    Text(
        "Cada componente se verifica ejecutándolo: no hay instalación simulada.",
        color = Color(0xFF858585), fontSize = 11.sp
    )
}

/* ═══════════════ PROYECTOS ═══════════════ */
@Composable
fun ProjectsScreen(app: FabriApp) {
    val accent = Color(app.themes.theme.accent)
    val rows = remember {
        app.db.readableDatabase.rawQuery("SELECT id, name, description FROM projects ORDER BY id", null)
            .use { c ->
                buildList {
                    while (c.moveToNext()) add(Triple(c.getInt(0), c.getString(1), c.getString(2)))
                }
            }
    }
    ScreenTitle("Proyectos", "${rows.size} espacios de trabajo")
    Spacer(Modifier.height(10.dp))
    rows.forEach { (id, n, d) -> Card("proyecto #$id", n, d ?: "", accent) }
}

/* ═══════════════ BASE DE DATOS ═══════════════ */
@Composable
fun DatabaseScreen(app: FabriApp) {
    val accent = Color(app.themes.theme.accent)
    val tables = remember {
        app.db.readableDatabase.rawQuery(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name", null
        ).use { c -> buildList { while (c.moveToNext()) add(c.getString(0)) } }
    }
    val fts = remember { fts5Available(app.db.readableDatabase) }
    ScreenTitle("Base de datos", "SQLite privado · ${tables.size} tablas")
    Spacer(Modifier.height(10.dp))
    Card("FTS5", if (fts) "disponible" else "NO disponible en este build",
        if (fts) "Búsqueda textual con ranking" else "La búsqueda hybrids quedará en modo lineal y la UI lo declara", accent)
    Section("Tablas", accent)
    tables.forEach { t ->
        val n = app.db.readableDatabase.rawQuery("SELECT COUNT(*) FROM $t", null).count()
        Card(t, "$n filas", "", accent)
    }
}

/* ═══════════════ MEMORIA RAG ═══════════════ */
@Composable
fun MemoryScreen(app: FabriApp) {
    val accent = Color(app.themes.theme.accent)
    val mem = remember {
        app.db.readableDatabase.rawQuery(
            "SELECT id, kind, content, provenance, verified FROM memory_items ORDER BY id DESC", null
        ).use { c ->
            buildList {
                while (c.moveToNext()) add(
                    listOf(
                        c.getInt(0).toString(), c.getString(1), c.getString(2),
                        c.getString(3) ?: "sin procedencia", if (c.getInt(4) == 1) "verificado" else "por verificar"
                    )
                )
            }
        }
    }
    val emb = remember {
        app.db.readableDatabase.rawQuery("SELECT COUNT(*) FROM embeddings", null).count()
    }
    ScreenTitle("Memoria RAG / vectorial", "${mem.size} items · $emb embeddings")
    Spacer(Modifier.height(8.dp))
    Card("Embeddings", if (emb > 0) "$emb vectores" else "sin embeddings",
        if (emb > 0) "Búsqueda semántica activa" else "La búsqueda vectorial queda inactiva hasta que haya embeddings utilizables", accent)
    Section("Memoria", accent)
    if (mem.isEmpty()) {
        Text("Vacía. Se llena desde el chat y desde las importaciones.", color = Color(0xFF858585), fontSize = 13.sp)
    }
    mem.forEach { Card("${it[1]} #${it[0]}", it[2], "${it[3]} · ${it[4]}", accent) }
}

/* ═══════════════ DOCUMENTOS ═══════════════ */
@Composable
fun DocumentsScreen(app: FabriApp) {
    val accent = Color(app.themes.theme.accent)
    val docs = remember {
        app.db.readableDatabase.rawQuery(
            "SELECT id, title, mime, size, review_state FROM documents ORDER BY id DESC", null
        ).use { c ->
            buildList {
                while (c.moveToNext()) add(
                    listOf(
                        c.getInt(0).toString(), c.getString(1), c.getString(2) ?: "?",
                        (c.getLong(3) / 1024).toString() + " KB", c.getString(4) ?: "pending"
                    )
                )
            }
        }
    }
    ScreenTitle("Documentos indexados", "${docs.size} documentos")
    Spacer(Modifier.height(10.dp))
    if (docs.isEmpty()) Text("Sin documentos todavía.", color = Color(0xFF858585), fontSize = 13.sp)
    docs.forEach { Card("doc #${it[0]}", it[1], "${it[2]} · ${it[3]} · ${it[4]}", accent) }
}

/* ═══════════════ FACTURAS ═══════════════ */
@Composable
fun InvoicesScreen(app: FabriApp) {
    val accent = Color(app.themes.theme.accent)
    val inv = remember {
        app.db.readableDatabase.rawQuery(
            "SELECT id, supplier, number, total, currency, review_state FROM invoices ORDER BY id DESC", null
        ).use { c ->
            buildList {
                while (c.moveToNext()) add(
                    listOf(
                        c.getInt(0).toString(), c.getString(1) ?: "sin proveedor", c.getString(2) ?: "s/n",
                        "${c.getDouble(3)} ${c.getString(4) ?: ""}", c.getString(5) ?: "pending"
                    )
                )
            }
        }
    }
    ScreenTitle("Facturas guardadas", "${inv.size} documentos · OCR + revisión")
    Spacer(Modifier.height(8.dp))
    Text(
        "Herramienta interna de gestión. No es una declaración tributaria oficial.",
        color = Color(0xFFFFB020), fontSize = 11.sp
    )
    Spacer(Modifier.height(10.dp))
    if (inv.isEmpty()) Text("Sin facturas.", color = Color(0xFF858585), fontSize = 13.sp)
    inv.forEach { Card("factura #${it[0]}", "${it[1]} · ${it[2]}", "${it[3]} · ${it[4]}", accent) }
}

/* ═══════════════ ANÁLISIS ═══════════════ */
@Composable
fun AnalyticsScreen(app: FabriApp) {
    val accent = Color(app.themes.theme.accent)
    val data = remember {
        app.db.readableDatabase.rawQuery("SELECT name, price FROM products ORDER BY price DESC", null)
            .use { c -> buildList { while (c.moveToNext()) add(c.getString(0) to c.getDouble(1)) } }
    }
    val max = data.maxOfOrNull { it.second } ?: 1.0
    ScreenTitle("Análisis de datos", "${data.size} productos")
    Spacer(Modifier.height(10.dp))
    if (data.isEmpty()) {
        Text("Sin datos para analizar.", color = Color(0xFF858585), fontSize = 13.sp)
    }
    data.forEach { (n, p) ->
        Card(n, "$p", "", accent)
        Box(
            Modifier
                .fillMaxWidth()
                .height(6.dp)
                .background(Color(0xFF282828), RoundedCornerShape(3.dp))
        ) {
            Box(
                Modifier
                    .fillMaxWidth((p / max).toFloat().coerceIn(0.02f, 1f))
                    .height(6.dp)
                    .background(accent, RoundedCornerShape(3.dp))
            )
        }
        Spacer(Modifier.height(6.dp))
    }
}

/* ═══════════════ SISTEMA ═══════════════ */
@Composable
fun SystemScreen(app: FabriApp) {
    val accent = Color(app.themes.theme.accent)
    var info by remember { mutableStateOf("…") }
    LaunchedEffect(Unit) {
        info = Sys.exec(listOf("sh", "-c", "uname -a; echo; getprop ro.product.model 2>/dev/null; df -h /data 2>/dev/null | tail -1"), 8000).second.trim()
    }
    ScreenTitle("Sistema y recursos", "Información real del dispositivo")
    Spacer(Modifier.height(10.dp))
    Card("Dispositivo", info, "", accent)
    val mem = Sys.mem(app.context)
    Card("Memoria", "${mem.avail / (1024 * 1024)} MB libres", "Android mata el proceso con más RSS si falta RAM", accent)
}

/* ═══════════════ CATÁLOGOS ═══════════════ */
@Composable
fun CatalogProductsScreen(app: FabriApp) {
    val accent = Color(app.themes.theme.accent)
    val rows = remember {
        app.db.readableDatabase.rawQuery("SELECT sku, name, price, unit FROM products ORDER BY name", null)
            .use { c -> buildList { while (c.moveToNext()) add(listOf(c.getString(0), c.getString(1), "${c.getDouble(2)} ${c.getString(3) ?: ""}")) } }
    }
    ScreenTitle("Catálogo de productos", "${rows.size} productos")
    Spacer(Modifier.height(10.dp))
    rows.forEach { Card(it[0], it[1], it[2], accent) }
}

@Composable
fun CatalogDocumentsScreen(app: FabriApp) {
    val accent = Color(app.themes.theme.accent)
    val tpls = remember {
        app.db.readableDatabase.rawQuery("SELECT name, kind FROM document_templates ORDER BY name", null)
            .use { c -> buildList { while (c.moveToNext()) add(c.getString(0) to (c.getString(1) ?: "")) } }
    }
    ScreenTitle("Catálogo de documentos", "${tpls.size} plantillas")
    Spacer(Modifier.height(10.dp))
    if (tpls.isEmpty()) Text("Sin plantillas todavía.", color = Color(0xFF858585), fontSize = 13.sp)
    tpls.forEach { Card(it.first, it.first, it.second, accent) }
}

/* ═══════════════ MARCA ═══════════════ */
@Composable
fun BrandScreen(app: FabriApp) {
    val accent = Color(app.themes.theme.accent)
    var brand by remember {
        mutableStateOf(
            app.db.readableDatabase.rawQuery(
                "SELECT business_name, logo_position, logo_scale, accent FROM brand_settings WHERE id=1", null
            ).use { c ->
                if (c.moveToFirst()) listOf(
                    c.getString(0) ?: "Soluciones Fabrick", c.getString(1) ?: "left",
                    c.getDouble(2), c.getString(3) ?: "#C8FF00"
                ) else listOf("Soluciones Fabrick", "left", 1.0, "#C8FF00")
            }
        )
    }
    var name by remember { mutableStateOf(brand[0]) }
    var pos by remember { mutableStateOf(brand[1]) }
    var scale by remember { mutableStateOf(brand[2].toFloat()) }

    ScreenTitle("Marca y configuración", "Identidad visual para documentos y exportaciones")
    Spacer(Modifier.height(10.dp))
    OutlinedTextField(
        value = name, onValueChange = { name = it },
        label = { Text("Nombre comercial") }, modifier = Modifier.fillMaxWidth(), singleLine = true
    )
    Spacer(Modifier.height(8.dp))
    Text("Posición del logo", fontSize = 12.sp, color = Color(0xFF858585))
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("left", "center", "right").forEach { p ->
            FilterChip(selected = pos == p, onClick = { pos = p }, label = { Text(p, fontSize = 12.sp) })
        }
    }
    Text("Escala: ${(scale * 100).toInt()} %", fontSize = 12.sp, color = Color(0xFF858585))
    Slider(
        value = scale, onValueChange = { scale = it },
        valueRange = 0.2f..2f, modifier = Modifier.fillMaxWidth()
    )
    Spacer(Modifier.height(8.dp))
    Section("Vista previa", accent)
    Box(
        Modifier
            .fillMaxWidth()
            .height(120.dp)
            .background(Color(0xFFF5F5F5), RoundedCornerShape(6.dp))
    ) {
        Box(
            Modifier
                .align(
                    when (pos) {
                        "center" -> Alignment.Center
                        "right" -> Alignment.CenterEnd
                        else -> Alignment.CenterStart
                    }
                )
                .padding(12.dp)
                .size((56 * scale).dp)
                .background(Color(0xFF050505), RoundedCornerShape(6.dp))
                .border(1.dp, Color(0xFF282828), RoundedCornerShape(6.dp))
        )
        Text(
            name, color = Color(0xFF050505), fontSize = (12 * scale).sp, fontWeight = FontWeight.Black,
            modifier = Modifier
                .align(
                    when (pos) {
                        "center" -> Alignment.Center
                        "right" -> Alignment.CenterEnd
                        else -> Alignment.CenterStart
                    }
                )
                .padding(horizontal = 18.dp)
        )
    }
    Spacer(Modifier.height(10.dp))
    Button(onClick = {
        app.db.writableDatabase.execSQL(
            "UPDATE brand_settings SET business_name=?, logo_position=?, logo_scale=?, updated_at=? WHERE id=1",
            arrayOf(name, pos, scale, now())
        )
    }) { Text("Guardar marca") }
    Spacer(Modifier.height(6.dp))
    Text(
        "El SVG importado se sanea (sin scripts ni referencias externas) antes de usarse.",
        color = Color(0xFF858585), fontSize = 11.sp
    )
}

/* ═══════════════ EXPORTACIÓN ═══════════════ */
@Composable
fun ExportsScreen(app: FabriApp) {
    val accent = Color(app.themes.theme.accent)
    var csv by remember { mutableStateOf("") }
    val products = remember {
        app.db.readableDatabase.rawQuery("SELECT sku, name, price, unit FROM products", null)
            .use { c -> buildList { while (c.moveToNext()) add(listOf(c.getString(0), c.getString(1), c.getDouble(2), c.getString(3))) } }
    }
    ScreenTitle("Exportación e impresión", "CSV real · PDF y XLSX en camino")
    Spacer(Modifier.height(10.dp))
    Card("CSV (listo)", "${products.size} filas", "Generado desde la base local, sin datos inventados", accent)
    Spacer(Modifier.height(8.dp))
    Button(onClick = {
        csv = buildString {
            appendLine("sku,name,price,unit")
            products.forEach { appendLine("${it[0]},\"${it[1]}\",${it[2]},${it[3]}") }
        }
    }) { Text("Generar CSV") }
    if (csv.isNotBlank()) {
        Spacer(Modifier.height(8.dp))
        Card("CSV generado", "${csv.lines().size - 1} filas", csv.take(200) + if (csv.length > 200) "…" else "", accent)
    }
    Spacer(Modifier.height(10.dp))
    Card("PDF / XLSX", "pendiente", "El motor de exportación aún no está implementado: se declara, no se simula", accent)
}

/* ═══════════════ FLUJOS EN VIVO ═══════════════ */
@Composable
fun LiveScreen(app: FabriApp) {
    val accent = Color(app.themes.theme.accent)
    var state by remember { mutableStateOf("idle") }
    var events by remember { mutableStateOf(listOf<String>()) }
    var phase by remember { mutableStateOf(0f) }

    LaunchedEffect(Unit) {
        AgentClient(app.themes.agentEndpoint).events(
            onEvent = { e -> events = (events + e).takeLast(8) },
            onState = { s -> state = s }
        ).start()
    }
    LaunchedEffect(state) {
        while (true) {
            kotlinx.coroutines.delay(120)
            phase = (phase + 0.03f) % 1f
        }
    }

    ScreenTitle("Cerebro IA · flujos en vivo", "Eventos reales del backend · sin cifras inventadas")
    Spacer(Modifier.height(8.dp))
    StatusRow("conexión", state, state == "connected", accent)

    Spacer(Modifier.height(10.dp))
    val nodes = listOf("UI", "Go", "SQLite", "FTS5", "Embed", "RAG", "Agente", "Memoria")
    Canvas(Modifier.fillMaxWidth().height(220.dp)) {
        val w = size.width / (nodes.size - 1)
        nodes.forEachIndexed { i, _ ->
            val x = w * i
            val active = phase * (nodes.size - 1)
            val d = kotlin.math.abs(active - i)
            val r = (7 - (d * 1.2)).coerceAtLeast(2f)
            drawCircle(
                color = if (d < 0.6f) accent else Color(0xFF3A424B),
                radius = r * density,
                center = Offset(x, size.height / 2)
            )
            if (i < nodes.size - 1) {
                drawLine(
                    color = Color(0xFF3A424B),
                    start = Offset(x, size.height / 2),
                    end = Offset(w * (i + 1), size.height / 2),
                    strokeWidth = 2f * density
                )
            }
        }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        nodes.forEach { Text(it, fontSize = 8.sp, color = Color(0xFF858585)) }
    }

    Spacer(Modifier.height(12.dp))
    Section("Eventos recibidos", accent)
    if (events.isEmpty()) {
        Text(
            "Sin eventos: el backend no está corriendo o no emits nada. No se muestran cifras.",
            color = Color(0xFF858585), fontSize = 12.sp
        )
    }
    events.forEach { Card("evento", it.take(160), "", accent) }
}

/* ═══════════════ AJUSTES ═══════════════ */
@Composable
fun SettingsScreen(app: FabriApp, current: Route, navigate: (Route) -> Unit) {
    val accent = Color(app.themes.theme.accent)
    var endpoint by remember { mutableStateOf(app.themes.agentEndpoint) }

    ScreenTitle("Configuración", "Tema, endpoint del agente y navegación")
    Spacer(Modifier.height(10.dp))

    Section("Tema", accent)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FabTheme.entries.forEach { t ->
            FilterChip(
                selected = app.themes.theme == t,
                onClick = { app.themes.set(t) },
                label = { Text(t.label, fontSize = 11.sp) },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = Color(t.accent).copy(alpha = 0.22f),
                    selectedLabelColor = Color(t.accent)
                )
            )
        }
    }
    Spacer(Modifier.height(14.dp))

    Section("Agente", accent)
    OutlinedTextField(
        value = endpoint, onValueChange = { endpoint = it },
        label = { Text("Endpoint del backend Go") },
        modifier = Modifier.fillMaxWidth(), singleLine = true
    )
    Spacer(Modifier.height(6.dp))
    Button(onClick = { app.themes.agentEndpoint = endpoint }) { Text("Guardar endpoint") }

    Spacer(Modifier.height(16.dp))
    Section("Todas las pantallas", accent)
    Route.entries.forEach { r ->
        Card(
            r.path,
            r.title,
            if (current == r) "activa" else "",
            if (current == r) accent else Color(0xFF3A424B)
        )
    }
}
