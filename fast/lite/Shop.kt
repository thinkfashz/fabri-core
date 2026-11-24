package cl.fabri.core.lite

import android.content.Context
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * Puente entre la APK y la tienda.
 *
 * La credencial es la MISMA clave de 8 caracteres que genera la tienda en la
 * nube (`mercado_locales.clave_hash`): no hay una segunda llave ni un token de
 * plataforma. El endpoint es `/api/inventario`, multi-inquilino por `local_id`.
 *
 * Reglas:
 *  · La clave se cifra con el Keystore (`Sec`) antes de tocar la base; nunca se
 *    escribe en claro ni se registra en los logs.
 *  · Subir manda el catálogo de la tabla local `products`; bajar hace upsert
 *    por `sku`. Nada se borra: el catálogo local es la copia de respaldo.
 *  · Cada llamada declara la huella del equipo para que el panel del dueño vea
 *    qué dispositivo sincronizó y cuándo. Si falla, se reporta el fallo.
 */
object Shop {

    private const val API = "https://fabri-api.vercel.app/api/inventario"
    private const val LOTE = 200

    data class Cfg(val local: String, val clave: String)

    data class Resp(
        val ok: Boolean,
        val ms: Long,
        val texto: String,
        val json: JSONObject? = null,
    )

    /* ── credenciales en la base, cifradas ─────────────────────────────── */

    fun guardar(db: Db, cfg: Cfg) {
        val (cipher, iv) = Sec.encrypt(cfg.clave)
        db.kvPut("shop.local", cfg.local)
        db.kvPut("shop.cipher", cipher)
        db.kvPut("shop.iv", iv)
        db.kvPut("shop.desde", System.currentTimeMillis().toString())
    }

    fun leer(db: Db): Cfg? {
        val local = db.kvGet("shop.local")
        val cipher = db.kvGet("shop.cipher")
        val iv = db.kvGet("shop.iv")
        if (local.isBlank() || cipher.isBlank() || iv.isBlank()) return null
        val clave = Sec.decrypt(cipher, iv) ?: return null
        return Cfg(local, clave)
    }

    fun olvidar(db: Db) {
        listOf("shop.local", "shop.cipher", "shop.iv", "shop.desde").forEach { db.kvDel(it) }
    }

    /** Clave enmascarada para la pantalla: nunca se muestra completa. */
    fun pista(clave: String): String =
        if (clave.length <= 2) "••••" else clave.take(1) + "••••" + clave.takeLast(1)

    /* ── identidad del equipo ─────────────────────────────────────────── */

    fun huella(ctx: Context): String = try {
        val id = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID)
        if (id.isNullOrBlank()) "android-sin-id" else id
    } catch (_: Throwable) { "android-sin-id" }

    fun etiqueta(): String {
        val marca = android.os.Build.MANUFACTURER ?: ""
        val modelo = android.os.Build.MODEL ?: "Android"
        return (marca + " " + modelo).trim().ifBlank { "Android" }
    }

    /* ── transporte ───────────────────────────────────────────────────── */

    private fun post(cuerpo: JSONObject): Resp {
        val t0 = System.currentTimeMillis()
        var c: HttpURLConnection? = null
        return try {
            c = (URL(API).openConnection() as HttpURLConnection).apply {
                connectTimeout = 15000
                readTimeout = 25000
                requestMethod = "POST"
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("Accept", "application/json")
            }
            c.outputStream.use { it.write(cuerpo.toString().toByteArray(Charsets.UTF_8)) }
            val code = c.responseCode
            val stream = if (code in 200..299) c.inputStream else (c.errorStream ?: c.inputStream)
            val raw = BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
            val j = try { JSONObject(raw) } catch (_: Throwable) { null }
            val ms = System.currentTimeMillis() - t0
            if (code in 200..299 && j?.optBoolean("ok") == true) {
                Resp(true, ms, "", j)
            } else {
                val motivo = j?.optString("codigo").orEmpty().ifBlank { "HTTP $code" }
                Resp(false, ms, mensaje(motivo, j?.optString("error").orEmpty()), j)
            }
        } catch (e: Throwable) {
            Resp(false, System.currentTimeMillis() - t0, "Sin conexión: ${e.message ?: "red"}", null)
        } finally {
            try { c?.disconnect() } catch (_: Throwable) { }
        }
    }

    private fun mensaje(codigo: String, error: String): String = when {
        codigo == "clave_mala" -> "La clave no abre esta tienda. Revísala o genera una nueva."
        codigo == "local_inexistente" -> "Esa tienda no existe en la nube."
        codigo == "SIN_CREDENCIALES" -> "Falta la tienda o la clave."
        codigo == "SIN_BASE" -> "La nube no tiene la base configurada."
        codigo.startsWith("HTTP 5") -> "La nube falló (${codigo}). Inténtalo más tarde."
        error.isNotBlank() -> error.take(200)
        else -> "No se pudo completar ($codigo)."
    }

    /** Datos del dispositivo que acompañan cada llamada. */
    private fun equipo(ctx: Context, cfg: Cfg, productos: Int, extra: JSONObject.() -> Unit = {}): JSONObject =
        JSONObject()
            .put("local_id", cfg.local)
            .put("clave", cfg.clave)
            .put("huella", huella(ctx))
            .put("etiqueta", etiqueta())
            .put("plataforma", "android")
            .put("version", "lite-1.1")
            .put("productos", productos)
            .apply(extra)

    /* ── acciones ─────────────────────────────────────────────────────── */

    fun verificar(ctx: Context, cfg: Cfg): Resp =
        post(equipo(ctx, cfg, 0) { put("accion", "verificar") })

    fun estado(ctx: Context, cfg: Cfg): Resp =
        post(equipo(ctx, cfg, 0) { put("accion", "estado") })

    /** Sube el catálogo local en lotes. Devuelve cuántos subieron. */
    fun subir(db: Db, ctx: Context, cfg: Cfg): Resp {
        val (_, filas) = db.raw("SELECT sku, name, price, unit, description FROM products ORDER BY sku")
        if (filas.isEmpty()) {
            return Resp(false, 0, "No hay productos en este equipo. Agrega uno o baja el catálogo de la tienda.")
        }
        var subidos = 0
        var ms = 0L
        val errores = ArrayList<String>()
        filas.chunked(LOTE).forEach { lote ->
            val arr = JSONArray()
            lote.forEach { f ->
                val sku = f.getOrNull(0)?.trim().orEmpty()
                val nombre = f.getOrNull(1)?.trim().orEmpty()
                if (sku.isBlank() || nombre.isBlank()) return@forEach
                arr.put(JSONObject()
                    .put("codigo", sku)
                    .put("nombre", nombre)
                    .put("precio", f.getOrNull(2)?.toDoubleOrNull() ?: 0.0)
                    .put("unidad", f.getOrNull(3)?.trim().orEmpty().ifBlank { "unidad" })
                    .put("notas", f.getOrNull(4)?.trim().orEmpty())
                    .put("origen", "apk"))
            }
            if (arr.length() == 0) return@forEach
            val r = post(equipo(ctx, cfg, arr.length()) {
                put("accion", "subir")
                put("productos", arr)
            })
            ms += r.ms
            if (r.ok) subidos += r.json?.optInt("subidos", 0) ?: 0
            else errores.add(r.texto)
        }
        if (subidos == 0 && errores.isNotEmpty()) {
            reportar(db, ctx, cfg, errores.first())
            return Resp(false, ms, errores.first())
        }
        return Resp(true, ms, "Subidos $subidos de ${filas.size} productos del equipo.")
    }

    /** Baja el catálogo de la nube y lo guarda en la base local (upsert). */
    fun bajar(db: Db, ctx: Context, cfg: Cfg, limite: Int = 500): Resp {
        val r = post(equipo(ctx, cfg, 0) {
            put("accion", "bajar")
            put("limite", limite)
        })
        if (!r.ok) {
            reportar(db, ctx, cfg, r.texto)
            return r
        }
        val lista = r.json?.optJSONArray("productos") ?: JSONArray()
        var guardados = 0
        for (i in 0 until lista.length()) {
            val p = lista.optJSONObject(i) ?: continue
            val sku = p.optString("codigo").trim()
            val nombre = p.optString("nombre").trim()
            if (sku.isBlank() || nombre.isBlank()) continue
            db.productUpsert(
                sku,
                nombre,
                p.optDouble("precio", 0.0),
                p.optString("unidad").ifBlank { "unidad" },
                p.optString("notas"),
            )
            guardados++
        }
        return Resp(true, r.ms, "Bajados y guardados $guardados productos.", r.json)
    }

    /** Reporta un fallo para que el panel del dueño lo vea. No bloquea. */
    fun reportar(db: Db, ctx: Context, cfg: Cfg, texto: String) {
        try {
            post(equipo(ctx, cfg, 0) {
                put("accion", "error")
                put("error", texto.take(300))
            })
            db.log("warn", "tienda", "fallo reportado: ${texto.take(200)}")
        } catch (_: Throwable) { }
    }

    /** Resumen legible del estado del puente. */
    fun resumen(r: Resp): String {
        val j = r.json ?: return r.texto
        val c = j.optJSONObject("conexion") ?: return r.texto
        val productos = c.optInt("productos", 0)
        val tienda = c.optString("tienda").ifBlank { c.optString("local_id") }
        val disps = j.optJSONArray("dispositivos")?.length() ?: 0
        val errores = j.optJSONArray("errores")?.length() ?: 0
        return buildString {
            append("$tienda · $productos productos en la nube")
            if (disps > 0) append(" · $disps dispositivo${if (disps == 1) "" else "s"}")
            if (errores > 0) append(" · $errores fallo${if (errores == 1) "" else "s"}")
        }
    }
}
