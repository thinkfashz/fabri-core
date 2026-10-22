package cl.fabri.core.lite

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * Núcleo de datos del dispositivo.
 *
 * Reglas:
 *  · Cada tabla existe para una función real de la app (no decorativas).
 *  · Las migraciones son aditivas (CREATE IF NOT EXISTS): nunca se pierde nada.
 *  · Todo lo que se muestra en pantalla sale de una consulta a esta base.
 */
class Db(ctx: Context) : SQLiteOpenHelper(ctx, NAME, null, VERSION) {

    companion object {
        const val NAME = "fabri_core.db"
        const val VERSION = 3

        @Volatile private var inst: Db? = null
        fun get(ctx: Context): Db = inst ?: synchronized(this) {
            inst ?: Db(ctx.applicationContext).also { inst = it }
        }
    }

    override fun onConfigure(db: SQLiteDatabase) {
        super.onConfigure(db)
        db.setForeignKeyConstraintsEnabled(true)
    }

    override fun onCreate(db: SQLiteDatabase) = migrate(db)

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = migrate(db)

    private fun migrate(db: SQLiteDatabase) {
        val ddl = listOf(
            // ── identidad ────────────────────────────────────────────────
            """CREATE TABLE IF NOT EXISTS users(
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 email TEXT UNIQUE NOT NULL,
                 name TEXT,
                 pass_hash TEXT NOT NULL,
                 pass_salt TEXT NOT NULL,
                 iterations INTEGER NOT NULL DEFAULT 120000,
                 role TEXT NOT NULL DEFAULT 'owner',
                 created_at INTEGER NOT NULL,
                 last_login INTEGER)""",
            """CREATE TABLE IF NOT EXISTS sessions(
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                 token_hash TEXT NOT NULL,
                 device TEXT,
                 created_at INTEGER NOT NULL,
                 expires_at INTEGER NOT NULL,
                 revoked INTEGER NOT NULL DEFAULT 0)""",
            """CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash)""",

            // ── bóveda de claves (cifradas con Keystore) ──────────────────
            """CREATE TABLE IF NOT EXISTS api_keys(
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 provider TEXT NOT NULL,
                 label TEXT,
                 base_url TEXT,
                 model TEXT,
                 cipher TEXT NOT NULL,
                 iv TEXT NOT NULL,
                 masked TEXT,
                 active INTEGER NOT NULL DEFAULT 1,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL)""",
            """CREATE INDEX IF NOT EXISTS idx_keys_provider ON api_keys(provider, active)""",

            // ── telemetría y auditoría ────────────────────────────────────
            """CREATE TABLE IF NOT EXISTS logs(
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 level TEXT NOT NULL DEFAULT 'info',
                 tag TEXT NOT NULL,
                 message TEXT NOT NULL,
                 at INTEGER NOT NULL)""",
            """CREATE INDEX IF NOT EXISTS idx_logs_at ON logs(at)""",
            """CREATE TABLE IF NOT EXISTS audit(
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 actor TEXT,
                 action TEXT NOT NULL,
                 detail TEXT,
                 at INTEGER NOT NULL)""",
            """CREATE TABLE IF NOT EXISTS metrics(
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 name TEXT NOT NULL,
                 value REAL NOT NULL,
                 at INTEGER NOT NULL)""",
            """CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(name, at)""",

            // ── permisos y archivos ───────────────────────────────────────
            """CREATE TABLE IF NOT EXISTS consents(
                 perm TEXT PRIMARY KEY,
                 granted INTEGER NOT NULL DEFAULT 0,
                 at INTEGER NOT NULL)""",
            """CREATE TABLE IF NOT EXISTS files(
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 name TEXT NOT NULL,
                 path TEXT,
                 size INTEGER NOT NULL DEFAULT 0,
                 mime TEXT,
                 kind TEXT,
                 at INTEGER NOT NULL)""",

            // ── consola / hojas / datos ───────────────────────────────────
            """CREATE TABLE IF NOT EXISTS commands(
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 cmd TEXT NOT NULL,
                 out TEXT,
                 code INTEGER NOT NULL DEFAULT 0,
                 ms INTEGER NOT NULL DEFAULT 0,
                 at INTEGER NOT NULL)""",
            """CREATE TABLE IF NOT EXISTS sheets(
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 title TEXT NOT NULL,
                 sql_text TEXT NOT NULL,
                 created_at INTEGER NOT NULL)""",
            """CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT)""",

            // ── dominio (heredado, se mantiene) ───────────────────────────
            """CREATE TABLE IF NOT EXISTS projects(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, description TEXT, created_at INTEGER)""",
            """CREATE TABLE IF NOT EXISTS conversations(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, created_at INTEGER)""",
            """CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER, role TEXT, content TEXT, provenance TEXT, created_at INTEGER)""",
            """CREATE TABLE IF NOT EXISTS memory_items(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, content TEXT, provenance TEXT, verified INTEGER DEFAULT 0, created_at INTEGER)""",
            """CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, path TEXT, mime TEXT, size INTEGER, ocr_text TEXT, review_state TEXT DEFAULT 'pending', created_at INTEGER)""",
            """CREATE TABLE IF NOT EXISTS invoices(id INTEGER PRIMARY KEY AUTOINCREMENT, supplier TEXT, number TEXT, total REAL, currency TEXT, ocr_text TEXT, review_state TEXT DEFAULT 'pending', created_at INTEGER)""",
            """CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT UNIQUE, name TEXT, price REAL, unit TEXT, description TEXT)""",
            """CREATE TABLE IF NOT EXISTS brand_settings(id INTEGER PRIMARY KEY CHECK(id=1), business_name TEXT, logo_path TEXT, logo_position TEXT DEFAULT 'left', logo_scale REAL DEFAULT 1.0, accent TEXT, header TEXT, footer TEXT, contact TEXT, updated_at INTEGER)""",

            // índice de texto completo: se intenta FTS4; si el motor no lo trae, queda LIKE
            """CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY, value TEXT)"""
        )
        ddl.forEach { db.execSQL(it) }

        // FTS: no se asume. Si el módulo no está, la búsqueda cae a LIKE (y se informa).
        try { db.execSQL("CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts4(content, rid, kind)") } catch (_: Throwable) { }
    }

    override fun onOpen(db: SQLiteDatabase) {
        super.onOpen(db)
        // el FTS se reconstruye desde la tabla real: nunca queda desincronizado
        try {
            db.execSQL("DELETE FROM memory_fts")
            db.execSQL("INSERT INTO memory_fts(content, rid, kind) SELECT content, id, kind FROM memory_items")
        } catch (_: Throwable) { }
        log("info", "db", "base abierta (v$VERSION)")
    }

    // ── helpers ──────────────────────────────────────────────────────────
    fun log(level: String, tag: String, message: String) = try {
        writableDatabase.insert("logs", null, ContentValues().apply {
            put("level", level); put("tag", tag)
            put("message", message.take(4000)); put("at", System.currentTimeMillis())
        })
        Unit
    } catch (_: Throwable) { Unit }

    fun audit(actor: String?, action: String, detail: String?) = try {
        writableDatabase.insert("audit", null, ContentValues().apply {
            put("actor", actor); put("action", action); put("detail", detail)
            put("at", System.currentTimeMillis())
        })
        Unit
    } catch (_: Throwable) { Unit }

    fun metric(name: String, value: Double) = try {
        writableDatabase.insert("metrics", null, ContentValues().apply {
            put("name", name); put("value", value); put("at", System.currentTimeMillis())
        })
        Unit
    } catch (_: Throwable) { Unit }

    /** Devuelve columnas + filas. Toda lectura de la UI pasa por aquí. */
    fun raw(sql: String, args: Array<String> = emptyArray()): Pair<List<String>, List<List<String>>> {
        val cols = ArrayList<String>()
        val rows = ArrayList<List<String>>()
        val c: Cursor = try {
            writableDatabase.rawQuery(sql, args)
        } catch (e: Throwable) {
            log("error", "sql", e.message ?: "error")
            return listOf("error") to listOf(listOf(e.message ?: "error"))
        }
        c.use {
            cols.addAll(it.columnNames.toList())
            while (it.moveToNext()) {
                rows.add((0 until it.columnCount).map { i -> it.getString(i) ?: "" })
            }
        }
        return cols to rows
    }

    fun scalar(sql: String, args: Array<String> = emptyArray()): String =
        raw(sql, args).second.firstOrNull()?.firstOrNull() ?: ""

    fun exec(sql: String): Long = try {
        writableDatabase.execSQL(sql); 0L
    } catch (e: Throwable) {
        log("error", "sql", e.message ?: "error"); -1L
    }

    /** Tamaño real del archivo (páginas × tamaño de página). */
    fun sizeBytes(): Long = try {
        val p = scalar("PRAGMA page_count").toLongOrNull() ?: 0L
        val s = scalar("PRAGMA page_size").toLongOrNull() ?: 0L
        p * s
    } catch (_: Throwable) { 0L }

    fun tables(): List<Triple<String, Long, Long>> = try {
        val (_, rows) = raw("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' ORDER BY name")
        rows.mapNotNull { r ->
            val n = r.firstOrNull() ?: return@mapNotNull null
            val c = scalar("SELECT COUNT(*) FROM \"$n\"").toLongOrNull() ?: 0L
            val b = try {
                (scalar("SELECT SUM(pgsize) FROM dbstat WHERE name = ?", arrayOf(n)).toDoubleOrNull() ?: 0.0).toLong()
            } catch (_: Throwable) { 0L }
            Triple(n, c, b)
        }
    } catch (_: Throwable) { emptyList() }

    fun ftsMode(): String = try {
        val ddl = scalar("SELECT sql FROM sqlite_master WHERE name='memory_fts'")
        when {
            ddl.contains("fts5", true) -> "FTS5"
            ddl.contains("fts4", true) || ddl.contains("fts3", true) -> "FTS4"
            else -> "LIKE"
        }
    } catch (_: Throwable) { "LIKE" }
}
