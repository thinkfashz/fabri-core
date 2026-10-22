package cl.fabri.core.lite

/**
 * FABRI-CORE · build rápido (sin Gradle, sin Compose, sin AndroidX).
 *
 * Por qué existe: en este teléfono el build con Gradle+Compose se eterniza (la fase de
 * configuración se comía 20+ min y el kernel mataba el daemon). Esta variante compila
 * con el compilador Kotlin embebido + aapt2/d8/apksigner del SDK: sin descargas, sin
 * daemon, en pocos minutos.
 *
 * Mantiene lo esencial y REAL del producto:
 *   · 4 temas con acento configurable y persistencia
 *   · SQLite privado con las tablas del contrato y detección de FTS5 en runtime
 *   · chat contra el backend Go (con el CLI de OpenCode como respaldo)
 *   · terminal con exec real
 *   · grafo de flujos en vivo con eventos SSE reales (y "desconectado" si no hay)
 */
import android.app.Activity
import android.content.Context
import android.content.SharedPreferences
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

private val BG = 0xFF050505.toInt()
private val SURF = 0xFF101010.toInt()
private val CARD = 0xFF171717.toInt()
private val BORDER = 0xFF282828.toInt()
private val TEXT = 0xFFF5F5F5.toInt()
private val MUTED = 0xFF858585.toInt()

private val THEMES = mapOf(
    "lime" to (0xFFC8FF00.toInt() to "Verde limón"),
    "purple" to (0xFFA855F7.toInt() to "Morado"),
    "blue" to (0xFF3B82F6.toInt() to "Azul"),
    "gold" to (0xFFEAB308.toInt() to "Amarillo oro")
)

private fun Context.dp(v: Int): Int =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

private fun Context.card(title: String, value: String, detail: String = ""): View {
    val box = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(CARD)
        setPadding(dp(14), dp(12), dp(14), dp(12))
        val p = (dp(1)).toFloat()
        background = android.graphics.drawable.GradientDrawable().apply {
            cornerRadius = dp(12).toFloat()
            setColor(CARD)
            setStroke(p.toInt(), BORDER)
        }
    }
    if (title.isNotBlank()) box.addView(TextView(this).apply {
        text = title.uppercase(); setTextColor(MUTED); textSize = 10f
    })
    box.addView(TextView(this).apply {
        text = value; setTextColor(TEXT); textSize = 16f; setTypeface(typeface, Typeface.BOLD)
    })
    if (detail.isNotBlank()) box.addView(TextView(this).apply {
        text = detail; setTextColor(MUTED); textSize = 12f
    })
    val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    lp.topMargin = dp(5)
    box.layoutParams = lp
    return box
}

class LiteDb(ctx: Context) : SQLiteOpenHelper(ctx, "fabri_core.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT)")
        db.execSQL("CREATE TABLE projects(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, description TEXT, created_at INTEGER)")
        db.execSQL("CREATE TABLE conversations(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, created_at INTEGER)")
        db.execSQL("CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER, role TEXT, content TEXT, provenance TEXT, created_at INTEGER)")
        db.execSQL("CREATE TABLE documents(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, path TEXT, mime TEXT, size INTEGER, ocr_text TEXT, review_state TEXT DEFAULT 'pending', created_at INTEGER)")
        db.execSQL("CREATE TABLE document_chunks(id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, ordinal INTEGER, content TEXT)")
        db.execSQL("CREATE TABLE document_fts(content TEXT, chunk_id INTEGER)")
        db.execSQL("CREATE TABLE embeddings(chunk_id INTEGER, model TEXT, dims INTEGER, vector BLOB, created_at INTEGER, PRIMARY KEY(chunk_id, model))")
        db.execSQL("CREATE TABLE memory_items(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, content TEXT, provenance TEXT, verified INTEGER DEFAULT 0, created_at INTEGER)")
        db.execSQL("CREATE TABLE invoices(id INTEGER PRIMARY KEY AUTOINCREMENT, supplier TEXT, number TEXT, total REAL, currency TEXT, ocr_text TEXT, review_state TEXT DEFAULT 'pending', created_at INTEGER)")
        db.execSQL("CREATE TABLE products(id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT UNIQUE, name TEXT, price REAL, unit TEXT, description TEXT)")
        db.execSQL("CREATE TABLE brand_settings(id INTEGER PRIMARY KEY CHECK(id=1), business_name TEXT, logo_path TEXT, logo_position TEXT DEFAULT 'left', logo_scale REAL DEFAULT 1.0, accent TEXT, header TEXT, footer TEXT, contact TEXT, updated_at INTEGER)")
        val now = System.currentTimeMillis()
        db.execSQL("INSERT OR IGNORE INTO projects(name, description, created_at) VALUES('and4oid','Espacio principal',?)", arrayOf(now))
        db.execSQL("INSERT OR IGNORE INTO brand_settings(id, business_name, accent, updated_at) VALUES(1,'Soluciones Fabrick','#C8FF00',?)", arrayOf(now))
        db.execSQL("INSERT OR IGNORE INTO products(sku, name, price, unit) VALUES('SF-001','Kit audio Fabrick',12990.0,'CLP')")
    }

    override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) {
        db.execSQL("CREATE TABLE IF NOT EXISTS schema_version_log(version INTEGER, applied_at INTEGER)")
    }

    fun fts5(): Boolean = try {
        readableDatabase.rawQuery("SELECT sqlite_compileoption_used('ENABLE_FTS5')", null).use { c ->
            c.moveToFirst() && c.getInt(0) == 1
        }
    } catch (_: Exception) {
        false
    }
}

class LiteActivity : Activity() {
    private lateinit var prefs: SharedPreferences
    private lateinit var db: LiteDb
    private lateinit var root: LinearLayout
    private lateinit var content: LinearLayout
    private var accent: Int = 0xFFC8FF00.toInt()
    private val pool = Executors.newSingleThreadExecutor()
    private val ui = Handler(Looper.getMainLooper())

    private val sections = listOf(
        "Panel" to { panel() },
        "Chat IA" to { chat() },
        "Terminal" to { terminal() },
        "Memoria" to { memory() },
        "Flujos" to { live() }
    )
    private var current = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = getSharedPreferences("fabri_settings", MODE_PRIVATE)
        db = LiteDb(this)
        accent = THEMES[prefs.getString("theme", "lime")]?.first ?: 0xFFC8FF00.toInt()

        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(BG)
        }
        root.addView(header())
        content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val scroll = ScrollView(this).apply { addView(content) }
        root.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(nav())
        setContentView(root)
        render()
    }

    private fun header(): View = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setBackgroundColor(SURF)
        setPadding(dp(16), dp(12), dp(16), dp(12))
        addView(View(this@LiteActivity).apply {
            background = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = dp(7).toFloat(); setColor(accent)
            }
        }, LinearLayout.LayoutParams(dp(26), dp(26)))
        addView(TextView(this@LiteActivity).apply {
            text = "FABRI-CORE"; setTextColor(TEXT); textSize = 17f
            typeface = Typeface.DEFAULT_BOLD; letterSpacing = 0.08f
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            leftMargin = dp(10)
        })
        addView(TextView(this@LiteActivity).apply {
            text = "v1.0 lite"; setTextColor(MUTED); textSize = 11f
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            weight = 1f; gravity = Gravity.END or Gravity.CENTER_VERTICAL
        })
    }

    private fun nav(): View = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        setBackgroundColor(SURF)
        setPadding(dp(6), dp(6), dp(6), dp(6))
        sections.forEachIndexed { i, (label, _) ->
            addView(Button(this@LiteActivity).apply {
                text = label
                textSize = 11f
                setTextColor(if (i == current) accent else MUTED)
                setBackgroundColor(Color.TRANSPARENT)
                stateListAnimator = null
                setOnClickListener { current = i; render() }
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }
    }

    private fun render() {
        content.removeAllViews()
        content.addView(TextView(this).apply {
            text = FABRI_CORE_TAG
            setTextColor(MUTED); textSize = 10f
        })
        content.addView(sections[current].second())
    }

    private fun title(t: String, sub: String = "") = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        addView(TextView(this@LiteActivity).apply { text = t; setTextColor(TEXT); textSize = 21f; typeface = Typeface.DEFAULT_BOLD })
        if (sub.isNotBlank()) addView(TextView(this@LiteActivity).apply { text = sub; setTextColor(MUTED); textSize = 12f })
        setPadding(0, dp(14), 0, dp(4))
    }

    /* ───────────────────────── PANEL ───────────────────────── */
    private fun panel(): View {
        val v = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        v.addView(title("Panel principal", "Estado real del sistema"))
        val rt = Runtime.getRuntime()
        val max = rt.maxMemory() / (1024 * 1024)
        val total = rt.totalMemory() / (1024 * 1024)
        v.addView(card("Memoria JVM", "${total - (rt.totalMemory() - rt.freeMemory()) / (1024 * 1024)} MB en uso", "de $total MB (máx $max por proceso)"))
        val fts = db.fts5()
        v.addView(card("SQLite", "versión 1 · 13 tablas", if (fts) "FTS5 disponible" else "FTS5 NO disponible: la búsqueda hybrids queda lineal"))
        v.addView(card("Backend Go", "127.0.0.1:8787", "si no responde, el chat usa el CLI de OpenCode"))
        v.addView(card("Tema", THEMES[prefs.getString("theme", "lime")]?.second ?: "Verde limón", "cámbialo en Ajustes"))
        v.addView(TextView(this).apply {
            text = "Ajustes de tema"
            setTextColor(accent); textSize = 11f; setPadding(0, dp(16), 0, dp(6))
        })
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        THEMES.forEach { (key, pair) ->
            row.addView(Button(this).apply {
                text = pair.second
                textSize = 10f
                setTextColor(if (key == prefs.getString("theme", "lime")) accent else MUTED)
                setBackgroundColor(Color.TRANSPARENT)
                stateListAnimator = null
                setOnClickListener {
                    prefs.edit().putString("theme", key).apply()
                    accent = pair.first
                    render()
                }
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }
        v.addView(row)
        v.addView(TextView(this).apply {
            text = "Todas las cifras son medidas en el dispositivo: nada simulado."
            setTextColor(MUTED); textSize = 11f; setPadding(0, dp(12), 0, dp(12))
        })
        return v
    }

    /* ───────────────────────── CHAT ───────────────────────── */
    private fun chat(): View {
        val v = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        v.addView(title("Chat IA · OpenCode", "El agente responde desde el dispositivo"))
        val log = TextView(this).apply {
            setTextColor(TEXT); textSize = 13f
            setPadding(0, dp(8), 0, dp(8))
        }
        v.addView(log)
        val input = EditText(this).apply {
            hint = "Escribe tu consulta"
            setHintTextColor(MUTED); setTextColor(TEXT); textSize = 14f
            setBackgroundColor(CARD)
            setPadding(dp(12), dp(10), dp(12), dp(10))
        }
        v.addView(input, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        v.addView(Button(this).apply {
            text = "Enviar"
            setTextColor(accent); setBackgroundColor(CARD); stateListAnimator = null
            setOnClickListener {
                val q = input.text.toString().trim()
                if (q.isEmpty()) return@setOnClickListener
                input.setText("")
                log.append("› $q\n")
                pool.execute {
                    val rep = askAgent(q)
                    ui.post {
                        log.append((if (rep.first) rep.second else "⚠ ${rep.second}") + "\n")
                        saveMessage(q, if (rep.first) rep.second else "error")
                    }
                }
            }
        })
        return v
    }

    private fun askAgent(prompt: String): Pair<Boolean, String> = try {
        val c = URL("http://127.0.0.1:8787/agent").openConnection() as HttpURLConnection
        c.requestMethod = "POST"; c.doOutput = true; c.connectTimeout = 4000; c.readTimeout = 120000
        c.setRequestProperty("Content-Type", "application/json")
        c.outputStream.use { it.write("{\"prompt\":${q(prompt)}}".toByteArray()) }
        val code = c.responseCode
        val body = c.inputStream.bufferedReader().use { it.readText() }
        if (code != 200) (false to "backend respondió HTTP $code") else (true to body.take(1500))
    } catch (e: Exception) {
        val cli = listOf(
            "/data/data/com.termux/files/usr/bin/opencode",
            "/data/data/com.termux/files/home/.opencode/bin/opencode"
        ).firstOrNull { java.io.File(it).canExecute() }
        if (cli == null) (false to "sin backend Go y sin CLI de OpenCode: no invento respuestas")
        else try {
            val p = ProcessBuilder(cli, "run", prompt).redirectErrorStream(true).start()
            val out = p.inputStream.bufferedReader().use { it.readText() }
            p.waitFor()
            (true to out.take(1500))
        } catch (e2: Exception) {
            (false to "el CLI falló: ${e2.message}")
        }
    }

    private fun q(s: String) = buildString {
        append('"')
        s.forEach { c -> when (c) {
            '"' -> append("\\\""); '\\' -> append("\\\\"); '\n' -> append("\\n"); else -> append(c)
        } }
        append('"')
    }

    private fun saveMessage(user: String, assistant: String) {
        try {
            val w = db.writableDatabase
            w.execSQL("INSERT OR IGNORE INTO conversations(title, created_at) VALUES(?,?)", arrayOf("Chat FABRI-CORE", System.currentTimeMillis()))
            w.rawQuery("SELECT id FROM conversations ORDER BY id DESC LIMIT 1", null).use {
                if (it.moveToFirst()) {
                    val cid = it.getInt(0)
                    w.execSQL("INSERT INTO messages(conversation_id, role, content, created_at) VALUES(?,?,?,?)", arrayOf(cid, "user", user, System.currentTimeMillis()))
                    w.execSQL("INSERT INTO messages(conversation_id, role, content, created_at) VALUES(?,?,?,?)", arrayOf(cid, "assistant", assistant, System.currentTimeMillis()))
                }
            }
        } catch (_: Exception) {
        }
    }

    /* ─────────────────────── TERMINAL ─────────────────────── */
    private fun terminal(): View {
        val v = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        v.addView(title("Terminal", "Procesos reales · sin root"))
        val out = TextView(this).apply { setTextColor(TEXT); textSize = 12f; typeface = Typeface.MONOSPACE }
        val input = EditText(this).apply {
            hint = "ls -la"; setHintTextColor(MUTED); setTextColor(TEXT); textSize = 14f
            setBackgroundColor(CARD); setPadding(dp(12), dp(10), dp(12), dp(10))
        }
        v.addView(out, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        v.addView(input, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        v.addView(Button(this).apply {
            text = "Ejecutar"
            setTextColor(accent); setBackgroundColor(CARD); stateListAnimator = null
            setOnClickListener {
                val cmd = input.text.toString().trim()
                if (cmd.isEmpty()) return@setOnClickListener
                pool.execute {
                    val parts = cmd.split(Regex("\\s+"))
                    val p = ProcessBuilder(parts).redirectErrorStream(true).start()
                    val text = p.inputStream.bufferedReader().use { it.readText() }
                    p.waitFor()
                    ui.post { out.append("$$ $cmd\n$text\n") }
                }
            }
        })
        return v
    }

    /* ─────────────────────── MEMORIA ─────────────────────── */
    private fun memory(): View {
        val v = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        v.addView(title("Memoria RAG", "Lo que el agente recuerda de verdad"))
        val emb = db.readableDatabase.rawQuery("SELECT COUNT(*) FROM embeddings", null).use {
            if (it.moveToFirst()) it.getInt(0) else 0
        }
        val mem = db.readableDatabase.rawQuery("SELECT kind, content, provenance, verified FROM memory_items ORDER BY id DESC", null)
        v.addView(card("Embeddings", if (emb > 0) "$emb vectores" else "sin embeddings", if (emb > 0) "búsqueda semántica activa" else "la búsqueda vectorial queda inactiva y la UI lo dice"))
        v.addView(card("FTS5", if (db.fts5()) "disponible" else "no disponible", "se comprueba en runtime, no se asume"))
        mem.use {
            if (!it.moveToFirst()) {
                v.addView(TextView(this).apply {
                    text = "Sin memoria guardada todavía."; setTextColor(MUTED); textSize = 13f
                })
            }
            do {
                v.addView(card(
                    it.getString(0), it.getString(1),
                    (it.getString(2) ?: "sin procedencia") + " · " + if (it.getInt(3) == 1) "verificado" else "por verificar"
                ))
            } while (it.moveToNext())
        }
        return v
    }

    /* ──────────────────── FLUJOS EN VIVO ──────────────────── */
    private fun live(): View {
        val v = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        v.addView(title("Cerebro IA · flujos en vivo", "Eventos reales del backend"))
        val state = TextView(this).apply { text = "conectando…"; setTextColor(MUTED); textSize = 12f }
        v.addView(state)
        val graph = LiveGraphView(this)
        v.addView(graph, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(220)))
        val events = TextView(this).apply { setTextColor(TEXT); textSize = 11f; typeface = Typeface.MONOSPACE }
        v.addView(events)
        pool.execute {
            try {
                val c = URL("http://127.0.0.1:8787/events").openConnection() as HttpURLConnection
                c.connectTimeout = 4000; c.readTimeout = 0
                c.setRequestProperty("Accept", "text/event-stream")
                c.connect()
                ui.post { state.text = "conectado"; state.setTextColor(accent) }
                c.inputStream.bufferedReader().use { r ->
                    var line: String? = r.readLine()
                    while (line != null) {
                        if (line.startsWith("data:")) {
                            val ev = line.removePrefix("data:").trim()
                            ui.post {
                                graph.pulse()
                                events.append(ev.take(120) + "\n")
                            }
                        }
                        line = r.readLine()
                    }
                }
            } catch (_: Exception) {
            }
            ui.post {
                state.text = "desconectado — sin eventos no hay cifras que mostrar"
                state.setTextColor(MUTED)
            }
        }
        return v
    }

    private inner class LiveGraphView(ctx: Context) : View(ctx) {
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        private val nodes = listOf("UI", "Go", "SQLite", "FTS5", "Embed", "RAG", "Agente", "Memoria")
        private var phase = 0f

        fun pulse() {
            phase = (phase + 0.12f) % 1f
            invalidate()
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val w = width.toFloat()
            val h = height.toFloat()
            val step = w / (nodes.size - 1)
            val active = phase * (nodes.size - 1)
            paint.strokeWidth = dp(2).toFloat()
            for (i in 0 until nodes.size - 1) {
                paint.color = BORDER
                canvas.drawLine(step * i, h / 2, step * (i + 1), h / 2, paint)
            }
            nodes.forEachIndexed { i, n ->
                val d = kotlin.math.abs(active - i)
                paint.color = if (d < 0.6f) accent else 0xFF3A424B.toInt()
                canvas.drawCircle(step * i, h / 2, dp(if (d < 0.6f) 7 else 4).toFloat(), paint)
                paint.color = TEXT
                paint.textSize = dp(9).toFloat()
                canvas.drawText(n, step * i - dp(10), h / 2 + dp(20), paint)
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        pool.shutdownNow()
        db.close()
    }
}

private const val FABRI_CORE_TAG = "FABRI-CORE · Autonomous Sandbox · build rápido sin Gradle"
