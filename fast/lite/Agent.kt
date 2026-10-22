package cl.fabri.core.lite

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/**
 * Cliente de proveedores de IA.
 *
 * Se habla con cada API real según su forma:
 *   · openai    → POST {base}/chat/completions con Bearer
 *   · anthropic → POST {base}/messages con x-api-key + anthropic-version
 *   · google    → POST {base}/models/{model}:generateContent?key=
 *
 * La clave se recibe descifrada en memoria y no se registra en ningún log.
 */
object Agent {

    data class Reply(val ok: Boolean, val text: String, val ms: Long, val provider: String)

    private fun conn(url: String, ms: Int = 45000): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 20000
            readTimeout = ms
            requestMethod = "POST"
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Accept", "application/json")
        }

    private fun body(c: HttpURLConnection, json: String): String {
        c.doOutput = true
        c.outputStream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
        val code = c.responseCode
        val stream = if (code in 200..299) c.inputStream else (c.errorStream ?: c.inputStream)
        return BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { r -> r.readText() }
    }

    fun ask(providerId: String, baseUrl: String, model: String, key: String, prompt: String): Reply {
        val t0 = System.currentTimeMillis()
        val p = Vault.provider(providerId)
        val kind = p?.kind ?: "openai"
        val base = baseUrl.trimEnd('/')
        return try {
            when (kind) {
                "anthropic" -> {
                    val c = conn("$base/messages")
                    c.setRequestProperty("x-api-key", key)
                    c.setRequestProperty("anthropic-version", "2023-06-01")
                    val payload = JSONObject()
                        .put("model", model.ifBlank { "claude-3-5-haiku-latest" })
                        .put("max_tokens", 1024)
                        .put("system", SYSTEM)
                        .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", prompt)))
                    val raw = body(c, payload.toString())
                    val j = JSONObject(raw)
                    val text = j.optJSONArray("content")?.optJSONObject(0)?.optString("text").orEmpty()
                    if (text.isBlank()) Reply(false, "Respuesta sin texto: " + raw.take(300), System.currentTimeMillis() - t0, providerId)
                    else Reply(true, text, System.currentTimeMillis() - t0, providerId)
                }

                "google" -> {
                    val m = model.ifBlank { "gemini-2.0-flash" }
                    val c = conn("$base/models/$m:generateContent?key=" + key)
                    val payload = JSONObject()
                        .put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", SYSTEM))))
                        .put("contents", JSONArray().put(JSONObject().put("parts", JSONArray().put(JSONObject().put("text", prompt)))))
                    val raw = body(c, payload.toString())
                    val j = JSONObject(raw)
                    val text = j.optJSONArray("candidates")?.optJSONObject(0)
                        ?.optJSONObject("content")?.optJSONArray("parts")?.optJSONObject(0)?.optString("text").orEmpty()
                    if (text.isBlank()) Reply(false, "Respuesta sin texto: " + raw.take(300), System.currentTimeMillis() - t0, providerId)
                    else Reply(true, text, System.currentTimeMillis() - t0, providerId)
                }

                else -> {
                    val c = conn("$base/chat/completions")
                    c.setRequestProperty("Authorization", "Bearer $key")
                    val payload = JSONObject()
                        .put("model", model.ifBlank { "gpt-4o-mini" })
                        .put("messages", JSONArray()
                            .put(JSONObject().put("role", "system").put("content", SYSTEM))
                            .put(JSONObject().put("role", "user").put("content", prompt)))
                        .put("temperature", 0.3)
                    val raw = body(c, payload.toString())
                    val j = JSONObject(raw)
                    val text = j.optJSONArray("choices")?.optJSONObject(0)
                        ?.optJSONObject("message")?.optString("content").orEmpty()
                    if (text.isBlank()) Reply(false, "Respuesta sin texto: " + raw.take(300), System.currentTimeMillis() - t0, providerId)
                    else Reply(true, text, System.currentTimeMillis() - t0, providerId)
                }
            }
        } catch (e: Throwable) {
            val hint = when {
                e.message?.contains("401") == true -> "La clave fue rechazada (401). Revísala."
                e.message?.contains("429") == true -> "Sin cuota ahora mismo (429). Prueba otro proveedor o espera."
                e.message?.contains("ENETUNREACH") == true || e.message?.contains("UnknownHost") == true ->
                    "Sin red o el host no resuelve. Revisa la conexión."
                else -> e.message ?: e.javaClass.simpleName
            }
            Reply(false, hint, System.currentTimeMillis() - t0, providerId)
        }
    }

    /** Verificación barata: lista modelos (o un mensaje mínimo) para ver si la clave sirve. */
    fun ping(providerId: String, baseUrl: String, key: String): Pair<Boolean, String> {
        val base = baseUrl.trimEnd('/')
        return try {
            when (Vault.provider(providerId)?.kind ?: "openai") {
                "anthropic" -> {
                    val c = (URL("$base/messages").openConnection() as HttpURLConnection).apply {
                        requestMethod = "POST"; connectTimeout = 15000; readTimeout = 25000
                        setRequestProperty("x-api-key", key)
                        setRequestProperty("anthropic-version", "2023-06-01")
                        setRequestProperty("Content-Type", "application/json")
                        doOutput = true
                    }
                    c.outputStream.use {
                        it.write("""{"model":"claude-3-5-haiku-latest","max_tokens":1,"messages":[{"role":"user","content":"hola"}]}""".toByteArray())
                    }
                    val code = c.responseCode
                    if (code in 200..299) true to "Clave válida (HTTP $code)"
                    else false to "HTTP $code · ${(c.errorStream?.bufferedReader()?.readText() ?: "").take(180)}"
                }
                "google" -> {
                    val c = (URL("$base/models?key=$key").openConnection() as HttpURLConnection).apply {
                        connectTimeout = 15000; readTimeout = 25000
                    }
                    val code = c.responseCode
                    if (code in 200..299) true to "Clave válida (HTTP $code)"
                    else false to "HTTP $code · ${(c.errorStream?.bufferedReader()?.readText() ?: "").take(180)}"
                }
                else -> {
                    val c = (URL("$base/models").openConnection() as HttpURLConnection).apply {
                        connectTimeout = 15000; readTimeout = 25000
                        setRequestProperty("Authorization", "Bearer $key")
                    }
                    val code = c.responseCode
                    if (code in 200..299) {
                        val txt = c.inputStream.bufferedReader().readText()
                        val n = try { JSONObject(txt).optJSONArray("data")?.length() ?: 0 } catch (_: Throwable) { 0 }
                        true to "Clave válida · $n modelo(s) visibles"
                    } else false to "HTTP $code · ${(c.errorStream?.bufferedReader()?.readText() ?: "").take(180)}"
                }
            }
        } catch (e: Throwable) { false to (e.message ?: e.javaClass.simpleName) }
    }

    private const val SYSTEM =
        "Eres FABRI-CORE, consola que corre en el dispositivo del usuario. Respondes en español, breve y concreto. " +
        "No inventas datos: si algo requiere la base local, dices qué consulta SQL haría falta. No pides credenciales."
}

/**
 * Terminal real: ejecuta `/system/bin/sh` con el uid de la app.
 *
 * Honestidad: no es Termux. La app corre en su propio sandbox Linux; puede usar sh,
 * leer sus archivos y salir a la red (con INTERNET), pero no ve el PRoot de Termux
 * ni tiene root. Los comandos propios (sql, tables, fts, logs) consultan la base real.
 */
object Term {

    data class Out(val text: String, val code: Int, val ms: Long)

    private val own = listOf("help", "tables", "sql", "dbsize", "fts", "logs", "files", "kv", "user", "export")

    fun run(ctx: android.content.Context, line: String): Out {
        val t0 = System.currentTimeMillis()
        val cmd = line.trim()
        if (cmd.isEmpty()) return Out("", 0, 0)

        val parts = cmd.split(" ", limit = 2)
        val head = parts[0].lowercase()
        val rest = parts.getOrNull(1)?.trim().orEmpty()

        val out = if (head in own) builtin(ctx, head, rest) else shell(cmd)
        val res = Out(out, 0, System.currentTimeMillis() - t0)
        try {
            Db.get(ctx).writableDatabase.insert("commands", null, android.content.ContentValues().apply {
                put("cmd", cmd.take(1000)); put("out", res.text.take(6000))
                put("code", res.code); put("ms", res.ms); put("at", System.currentTimeMillis())
            })
        } catch (_: Throwable) { }
        return res
    }

    private fun builtin(ctx: android.content.Context, head: String, rest: String): String {
        val db = Db.get(ctx)
        return when (head) {
            "help" -> """
                Comandos propios de FABRI-CORE:
                  help                  esta ayuda
                  tables                tablas con filas y tamaño
                  sql <consulta>        ejecuta SQL real sobre fabri_core.db
                  dbsize                tamaño de la base y ruta
                  fts                   motor de texto completo detectado
                  logs [n]              últimas n entradas de log (por defecto 10)
                  files                 archivos exportados
                  kv                    pares clave/valor guardados
                  user                  usuario de la sesión activa
                  export                exporta la tabla que indiques a .xlsx
                Y cualquier comando del shell Android: ls, cat, ps, df, id, echo, date…
            """.trimIndent()

            "tables" -> db.tables().joinToString("\n") { (n, c, b) ->
                String.format("%-28s %8d filas  %10s", n, c, Ui.human(b))
            }.ifBlank { "sin tablas" }

            "sql" -> {
                if (rest.isBlank()) "uso: sql SELECT * FROM logs LIMIT 5"
                else {
                    val (cols, rows) = db.raw(rest)
                    buildString {
                        appendLine(cols.joinToString(" | "))
                        appendLine("-".repeat(60))
                        rows.take(50).forEach { appendLine(it.joinToString(" | ")) }
                        appendLine("(${rows.size} fila/s)")
                    }
                }
            }

            "dbsize" -> {
                val f = ctx.getDatabasePath(Db.NAME)
                "archivo: ${f.absolutePath}\ntamaño lógico: ${Ui.human(db.sizeBytes())}\ntamaño en disco: ${if (f.exists()) Ui.human(f.length()) else "?"}"
            }

            "fts" -> "motor: ${db.ftsMode()}\nprueba: " + db.raw("SELECT COUNT(*) FROM memory_fts").second.firstOrNull()?.firstOrNull()

            "logs" -> {
                val n = rest.toIntOrNull()?.coerceIn(1, 200) ?: 10
                db.raw("SELECT at, level, tag, message FROM logs ORDER BY id DESC LIMIT $n").second
                    .joinToString("\n") { "${it[0].toLongOrNull()?.let(Ui::ago)} [${it[1]}] ${it[2]}: ${it[3]}" }
            }

            "files" -> Export.saved(ctx).joinToString("\n") { "${it[0]}  ${Ui.human(it[2].toLongOrNull() ?: 0)}  ${it[4].toLongOrNull()?.let(Ui::ago)}" }
                .ifBlank { "todavía no exportaste nada" }

            "kv" -> db.raw("SELECT key, value FROM kv ORDER BY key").second.joinToString("\n") { "${it[0]} = ${it[1]}" }.ifBlank { "kv vacío" }

            "user" -> Auth(ctx).current()?.let { "${it.email} · ${it.role} · uid #${it.id}" } ?: "sin sesión (entra desde Inicio)"

            "export" -> {
                val t = if (rest.isBlank()) "memory_items" else rest
                val (cols, rows) = db.raw("SELECT * FROM \"$t\" LIMIT 5000")
                val bytes = Export.xlsx(t, cols, rows)
                val name = "fabri-$t-${System.currentTimeMillis() / 1000}.xlsx"
                val path = Export.save(ctx, name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes)
                Export.register(ctx, name, path, bytes.size.toLong(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", t)
                if (path != null) "exportado: $path (${Ui.human(bytes.size.toLong())}, ${rows.size} filas)" else "no se pudo exportar (revisa permisos)"
            }

            else -> "?"
        }
    }

    private fun shell(cmd: String): String = try {
        val pb = ProcessBuilder("/system/bin/sh", "-c", cmd)
        pb.redirectErrorStream(true)
        val p = pb.start()
        val out = p.inputStream.bufferedReader().readText()
        val done = p.waitFor(20, TimeUnit.SECONDS)
        if (!done) { p.destroyForcibly(); out + "\n[tiempo agotado a los 20 s]" } else out.ifBlank { "(sin salida)" }
    } catch (e: Throwable) {
        "no se pudo ejecutar: ${e.message ?: e.javaClass.simpleName}"
    }
}
