package cl.fabri.core

import android.app.ActivityManager
import android.content.Context
import android.content.SharedPreferences
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.graphics.Color
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/* ─────────────────────────── TEMA ─────────────────────────── */

enum class FabTheme(val key: String, val label: String, val accent: Long) {
    LIME("lime", "Verde limón", 0xFFC8FF00),
    PURPLE("purple", "Morado", 0xFFA855F7),
    BLUE("blue", "Azul", 0xFF3B82F6),
    GOLD("gold", "Amarillo oro", 0xFFEAB308);

    companion object {
        fun of(key: String?): FabTheme = entries.firstOrNull { it.key == key } ?: LIME
    }
}

class ThemeStore(private val ctx: Context) {
    private val prefs: SharedPreferences =
        ctx.getSharedPreferences("fabri_settings", Context.MODE_PRIVATE)
    var theme by mutableStateOf(FabTheme.of(prefs.getString("theme", "lime")))
        private set

    fun set(t: FabTheme) {
        theme = t
        prefs.edit().putString("theme", t.key).apply()
    }

    var agentEndpoint: String
        get() = prefs.getString("agent_endpoint", "http://127.0.0.1:8787")!!
        set(v) = prefs.edit().putString("agent_endpoint", v).apply()

    var lastProject: String
        get() = prefs.getString("last_project", "")!!
        set(v) = prefs.edit().putString("last_project", v).apply()
}

/* ─────────────────────────── BASE DE DATOS ─────────────────────────── */

object Db {
    const val NAME = "fabri_core.db"
    const val VERSION = 1
}

class DbHelper(ctx: Context) : SQLiteOpenHelper(ctx, Db.NAME, null, Db.VERSION) {
    override fun onConfigure(db: SQLiteDatabase) {
        db.setForeignKeyConstraintsEnabled(true)
        db.execSQL("PRAGMA journal_mode=WAL")
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE app_settings(
                key TEXT PRIMARY KEY, value TEXT)"""
        )
        db.execSQL(
            """CREATE TABLE projects(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                created_at INTEGER NOT NULL)"""
        )
        db.execSQL(
            """CREATE TABLE conversations(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
                title TEXT, created_at INTEGER NOT NULL)"""
        )
        db.execSQL(
            """CREATE TABLE messages(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL, content TEXT NOT NULL,
                provenance TEXT, created_at INTEGER NOT NULL)"""
        )
        db.execSQL(
            """CREATE TABLE agent_sessions(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
                agent TEXT, model TEXT, status TEXT, started_at INTEGER NOT NULL)"""
        )
        db.execSQL(
            """CREATE TABLE tasks(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL, state TEXT NOT NULL,
                payload TEXT, progress REAL DEFAULT 0,
                resumable INTEGER DEFAULT 1, created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL)"""
        )
        db.execSQL(
            """CREATE TABLE task_events(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                kind TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL)"""
        )
        db.execSQL(
            """CREATE TABLE documents(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
                title TEXT NOT NULL, path TEXT, mime TEXT, size INTEGER,
                ocr_text TEXT, review_state TEXT DEFAULT 'pending',
                created_at INTEGER NOT NULL)"""
        )
        db.execSQL(
            """CREATE TABLE document_chunks(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                ordinal INTEGER NOT NULL, content TEXT NOT NULL)"""
        )
        db.execSQL(
            """CREATE TABLE document_fts(
                content TEXT, chunk_id INTEGER NOT NULL)"""
        )
        db.execSQL(
            """CREATE TABLE embeddings(
                chunk_id INTEGER NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
                model TEXT NOT NULL, dims INTEGER NOT NULL, vector BLOB NOT NULL,
                created_at INTEGER NOT NULL, PRIMARY KEY(chunk_id, model))"""
        )
        db.execSQL(
            """CREATE TABLE memory_items(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL, content TEXT NOT NULL,
                provenance TEXT, verified INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL)"""
        )
        db.execSQL(
            """CREATE TABLE invoices(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                supplier TEXT, number TEXT, issued_at TEXT, total REAL,
                currency TEXT, document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
                ocr_text TEXT, review_state TEXT DEFAULT 'pending',
                created_at INTEGER NOT NULL)"""
        )
        db.execSQL(
            """CREATE TABLE invoice_lines(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
                description TEXT, qty REAL, unit_price REAL, total REAL)"""
        )
        db.execSQL(
            """CREATE TABLE suppliers(
                id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, contact TEXT)"""
        )
        db.execSQL(
            """CREATE TABLE products(
                id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT UNIQUE, name TEXT NOT NULL,
                price REAL, unit TEXT, description TEXT)"""
        )
        db.execSQL(
            """CREATE TABLE product_categories(
                id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE)"""
        )
        db.execSQL(
            """CREATE TABLE brand_settings(
                id INTEGER PRIMARY KEY CHECK(id = 1),
                business_name TEXT, logo_path TEXT, logo_position TEXT DEFAULT 'left',
                logo_scale REAL DEFAULT 1.0, accent TEXT, header TEXT, footer TEXT,
                contact TEXT, updated_at INTEGER)"""
        )
        db.execSQL(
            """CREATE TABLE document_templates(
                id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, kind TEXT,
                body TEXT, updated_at INTEGER)"""
        )
        db.execSQL(
            """CREATE TABLE installed_components(
                id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE,
                version TEXT, status TEXT, checked_at INTEGER)"""
        )
        db.execSQL(
            """CREATE TABLE backup_jobs(
                id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, path TEXT,
                bytes INTEGER, status TEXT, created_at INTEGER NOT NULL)"""
        )
        seed(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) {
        // v1 inicial: la política de migraciones documenta no destruir datos.
        db.execSQL("CREATE TABLE IF NOT EXISTS schema_version_log(version INTEGER, applied_at INTEGER)")
        db.execSQL("INSERT INTO schema_version_log(version, applied_at) VALUES(?,?)", arrayOf(new, System.currentTimeMillis()))
    }

    private fun seed(db: SQLiteDatabase) {
        val now = System.currentTimeMillis()
        db.execSQL("INSERT OR IGNORE INTO projects(name, description, created_at) VALUES(?,?,?)",
            arrayOf("and4oid", "Espacio de trabajo principal", now))
        db.execSQL("INSERT OR IGNORE INTO app_settings(key, value) VALUES('schema_version','1')")
        db.execSQL("INSERT OR IGNORE INTO brand_settings(id, business_name, accent, updated_at) VALUES(1,?,?,?)",
            arrayOf("Soluciones Fabrick", "#C8FF00", now))
        db.execSQL("INSERT OR IGNORE INTO products(sku, name, price, unit) VALUES('SF-001','Kit audio Fabrick',12990.0,'CLP')")
        db.execSQL("INSERT OR IGNORE INTO suppliers(name, contact) VALUES('Proveedor demo','contacto@demo.cl')")
    }
}

/** ¿FTS5 está realmente disponible? (se comprueba, no se supone) */
fun fts5Available(db: SQLiteDatabase): Boolean = try {
    db.rawQuery("SELECT sqlite_compileoption_used('ENABLE_FTS5')", null).use {
        it.moveToFirst() && it.getInt(0) == 1
    }
} catch (_: Exception) {
    false
}

/* ─────────────────────────── AGENTE / BACKEND ─────────────────────────── */

data class AgentReply(val ok: Boolean, val text: String, val detail: String = "")

/**
 * Cliente del backend Go (loopback) y, si no está, del CLI de OpenCode.
 * Nunca inventa respuestas: si ambos fallan, lo dice.
 */
class AgentClient(private val endpoint: String) {

    suspend fun health(): String = withContext(Dispatchers.IO) {
        try {
            val c = URL("$endpoint/health").openConnection() as HttpURLConnection
            c.connectTimeout = 2500
            c.readTimeout = 2500
            c.requestMethod = "GET"
            val code = c.responseCode
            c.inputStream.bufferedReader().use { it.readText() }.take(400)
                .also { if (code != 200) "HTTP $code" }
        } catch (e: Exception) {
            "sin backend: ${e.javaClass.simpleName}"
        }
    }

    suspend fun ask(prompt: String, onPartial: (String) -> Unit = {}): AgentReply =
        withContext(Dispatchers.IO) {
            try {
                val c = URL("$endpoint/agent").openConnection() as HttpURLConnection
                c.requestMethod = "POST"
                c.doOutput = true
                c.connectTimeout = 4000
                c.readTimeout = 120_000
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(("""{"prompt":${quote(prompt)}}""").toByteArray()) }
                val code = c.responseCode
                val body = c.inputStream.bufferedReader().use { it.readText() }
                if (code != 200) return@withContext AgentReply(false, "", "HTTP $code")
                onPartial(body)
                AgentReply(true, body)
            } catch (e: Exception) {
                // Fallback: CLI local de OpenCode si existe en el dispositivo.
                val cli = listOf(
                    "/data/data/com.termux/files/usr/bin/opencode",
                    "/data/data/com.termux/files/home/.opencode/bin/opencode",
                    "/root/.opencode/bin/opencode"
                ).firstOrNull { java.io.File(it).canExecute() }
                if (cli == null) {
                    AgentReply(false, "", "sin backend y sin CLI de OpenCode en el dispositivo")
                } else {
                    try {
                        val p = ProcessBuilder(cli, "run", "--print-logs", prompt)
                            .redirectErrorStream(true).start()
                        val out = p.inputStream.bufferedReader().use { it.readText() }
                        p.waitFor(120, TimeUnit.SECONDS)
                        if (out.isBlank()) AgentReply(false, "", "el CLI no devolvió salida")
                        else AgentReply(true, out.take(4000))
                    } catch (e2: Exception) {
                        AgentReply(false, "", "CLI falló: ${e2.message}")
                    }
                }
            }
        }

    /** Conexión SSE al grafo en vivo. Cada evento es real o no hay evento. */
    fun events(
        onEvent: (String) -> Unit,
        onState: (String) -> Unit
    ): Thread = Thread {
        try {
            onState("connecting")
            val c = URL("$endpoint/events").openConnection() as HttpURLConnection
            c.connectTimeout = 4000
            c.readTimeout = 0
            c.setRequestProperty("Accept", "text/event-stream")
            c.connect()
            onState("connected")
            c.inputStream.bufferedReader().use { r ->
                val sb = StringBuilder()
                while (true) {
                    val line = r.readLine() ?: break
                    if (line.startsWith("data:")) {
                        sb.append(line.removePrefix("data:").trim()).append('\n')
                        if (sb.contains('\n')) {
                            onEvent(sb.toString().trim())
                            sb.clear()
                        }
                    }
                }
            }
            onState("offline")
        } catch (e: Exception) {
            onState("offline: ${e.message?.take(60)}")
        }
    }

    private fun quote(s: String) = buildString {
        append('"')
        for (c in s) when (c) {
            '"' -> append("\\\"")
            '\\' -> append("\\\\")
            '\n' -> append("\\n")
            else -> append(c)
        }
        append('"')
    }
}

/* ─────────────────────────── SISTEMA ─────────────────────────── */

object Sys {
    data class Mem(val total: Long, val avail: Long)

    fun mem(ctx: Context): Mem {
        val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val mi = ActivityManager.MemoryInfo()
        am.getMemoryInfo(mi)
        return Mem(mi.totalMem, mi.availMem)
    }

    /** Ejecuta un comando real y devuelve stdout+stderr. */
    fun exec(cmd: List<String>, timeoutMs: Long = 8000): Pair<Int, String> = try {
        val p = ProcessBuilder(cmd).redirectErrorStream(true).start()
        val out = p.inputStream.bufferedReader().use { it.readText() }
        val done = p.waitFor(timeoutMs, TimeUnit.MILLISECONDS)
        if (!done) {
            p.destroy()
            -1 to "timeout tras ${timeoutMs}ms"
        } else {
            p.exitValue() to out
        }
    } catch (e: Exception) {
        -1 to (e.message ?: e.javaClass.simpleName)
    }
}
