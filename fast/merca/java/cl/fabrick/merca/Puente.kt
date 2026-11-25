package cl.fabrick.merca

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import java.io.File

/**
 * Puente mínimo entre la WebView y Android.
 *
 * Existe para lo que el navegador no puede hacer solo: guardar la boleta PDF
 * como archivo real en Descargas, abrir el menú de compartir y avisar que la
 * interfaz ya pintó (con eso el panel de arranque se retira).
 *
 * La web lo llama como:
 *   window.MercaPuente.compartirPdf(nombre, base64) -> "ok:<archivo>" | "error:<motivo>"
 *   window.MercaPuente.listo("ok" | "error:<motivo>")
 */
class Puente(
    private val act: Activity,
    private val alListo: (String) -> Unit = {}
) {

    /** La interfaz terminó de pintar. "ok" retira el panel de arranque. */
    @JavascriptInterface
    fun listo(estado: String) {
        val limpio = if (estado == "ok") "ok" else estado.take(200)
        act.runOnUiThread { alListo(limpio) }
    }

    @JavascriptInterface
    fun compartirPdf(nombre: String, base64: String): String {
        return try {
            val limpio = nombre.replace(Regex("[^A-Za-z0-9._-]"), "_").ifEmpty { "pedido.pdf" }
            val bytes = Base64.decode(base64, Base64.NO_WRAP)
            if (bytes.size < 100) return "error:pdf vacio"

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val valores = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, limpio)
                    put(MediaStore.MediaColumns.MIME_TYPE, "application/pdf")
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                }
                val uri = act.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, valores)
                    ?: return "error:sin destino"
                act.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }

                val enviar = Intent(Intent.ACTION_SEND).apply {
                    type = "application/pdf"
                    putExtra(Intent.EXTRA_STREAM, uri)
                    putExtra(Intent.EXTRA_SUBJECT, limpio)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                act.runOnUiThread {
                    try {
                        act.startActivity(Intent.createChooser(enviar, "Enviar la boleta"))
                    } catch (_: Throwable) { /* sin apps para compartir: queda en Descargas */ }
                }
            } else {
                @Suppress("DEPRECATION")
                val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                dir.mkdirs()
                File(dir, limpio).writeBytes(bytes)
            }
            "ok:$limpio"
        } catch (t: Throwable) {
            "error:" + (t.message ?: t.javaClass.simpleName)
        }
    }
}