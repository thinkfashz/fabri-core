package cl.fabrick.merca

import android.content.Context
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import java.nio.charset.StandardCharsets
import java.util.HashMap

/**
 * Sirve la interfaz de MercaFabrick desde un origen https propio
 * (https://merca.local/), sin abrir puertos.
 *
 * Mismo enfoque que ActivosWeb de FORGE CORE STOCK, pero los archivos viven en
 * `assets/merca/www/`. Se intercepta la petición y se responde desde el APK,
 * así `fetch`, `localStorage` y los módulos funcionan con un origen real.
 */
object ActivosMerca {

    const val BASE = "https://merca.local/"
    private const val PREFIJO = "merca/www/"

    fun esPropio(url: String?): Boolean = url != null && url.startsWith(BASE)

    fun responder(ctx: Context, url: String): WebResourceResponse? {
        if (!esPropio(url)) return null
        var ruta = url.substring(BASE.length)
        var c = ruta.indexOf('?')
        if (c >= 0) ruta = ruta.substring(0, c)
        c = ruta.indexOf('#')
        if (c >= 0) ruta = ruta.substring(0, c)
        if (ruta.isEmpty()) ruta = "index.html"
        if (ruta.contains("..") || ruta.contains("\\") || ruta.startsWith("/")) {
            return error(400, "ruta invalida")
        }
        return try {
            val flujo = ctx.assets.open(PREFIJO + ruta)
            respuesta(mime(ruta), flujo, esTexto(ruta))
        } catch (e: IOException) {
            error(404, "no encontrado")
        }
    }

    private fun respuesta(mime: String, datos: InputStream, texto: Boolean): WebResourceResponse {
        val r = WebResourceResponse(mime, if (texto) "utf-8" else null, datos)
        val cab = HashMap<String, String>()
        cab["Cache-Control"] = "no-cache"
        cab["X-Content-Type-Options"] = "nosniff"
        r.responseHeaders = cab
        return r
    }

    private fun error(codigo: Int, mensaje: String): WebResourceResponse {
        val cuerpo = "$codigo $mensaje".toByteArray(StandardCharsets.UTF_8)
        val r = WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(cuerpo))
        val cab = HashMap<String, String>()
        cab["Cache-Control"] = "no-store"
        r.responseHeaders = cab
        return r
    }

    private fun esTexto(ruta: String): Boolean =
        ruta.endsWith(".html") || ruta.endsWith(".js") || ruta.endsWith(".css") ||
            ruta.endsWith(".json") || ruta.endsWith(".svg") || ruta.endsWith(".webmanifest")

    private fun mime(ruta: String): String = when {
        ruta.endsWith(".html") -> "text/html"
        ruta.endsWith(".js") -> "application/javascript"
        ruta.endsWith(".css") -> "text/css"
        ruta.endsWith(".json") -> "application/json"
        ruta.endsWith(".svg") -> "image/svg+xml"
        ruta.endsWith(".png") -> "image/png"
        ruta.endsWith(".jpg") || ruta.endsWith(".jpeg") -> "image/jpeg"
        ruta.endsWith(".webp") -> "image/webp"
        ruta.endsWith(".webmanifest") -> "application/manifest+json"
        else -> "application/octet-stream"
    }
}