package cl.fabrick.merca

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast

/**
 * MercaFabrick · marketplace de barrio.
 *
 * Una sola actividad con una WebView a pantalla completa. La interfaz vive en
 * `assets/merca/www/index.html` y se sirve desde `https://merca.local` con un
 * `WebViewAssetLoader` propio (sin levantar un puerto), para que `fetch`,
 * `localStorage` y los módulos funcionen con un origen https real.
 *
 * La sesión se guarda en localStorage (misma clave que el panel web), así que
 * entrar en la APK sirve para el panel y al revés.
 */
class MercaActivity : Activity() {

    private lateinit var web: WebView
    private var pendingCamera: PermissionRequest? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.parseColor("#070A08")
        window.navigationBarColor = Color.parseColor("#070A08")

        val raiz = FrameLayout(this).apply { setBackgroundColor(Color.parseColor("#070A08")) }

        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#070A08"))
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                allowFileAccess = false
                allowContentAccess = true
                mediaPlaybackRequiresUserGesture = false
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                cacheMode = WebSettings.LOAD_DEFAULT
                useWideViewPort = true
                loadWithOverviewMode = true
                if (Build.VERSION.SDK_INT >= 26) safeBrowsingEnabled = true
            }
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        /* La app es de un solo origen: se bloquea cualquier navegación externa
           y se abre el navegador del sistema para los enlaces de la nube. */
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, req: WebResourceRequest): Boolean {
                val url = req.url.toString()
                if (ActivosMerca.esPropio(url)) return false
                if (url.startsWith("https://forge-core-stock.vercel.app") ||
                    url.startsWith("https://fabri-api.vercel.app") ||
                    url.startsWith("https://wa.me/") || url.startsWith("https://api.whatsapp.com/")
                ) {
                    try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (_: Throwable) {}
                    return true
                }
                Toast.makeText(this@MercaActivity, "Enlace externo bloqueado", Toast.LENGTH_SHORT).show()
                return true
            }

            override fun shouldInterceptRequest(v: WebView, req: WebResourceRequest): WebResourceResponse? {
                return ActivosMerca.responder(this@MercaActivity, req.url.toString())
            }

            override fun onReceivedError(v: WebView, req: WebResourceRequest, err: android.webkit.WebResourceError) {
                if (req.isForMainFrame) pintarError("No se pudo cargar la interfaz. Revisa tu conexión.")
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                    android.util.Log.e("merca", m.message() + " @ " + m.sourceId() + ":" + m.lineNumber())
                }
                return true
            }

            /* Cámara para el escáner de código de barras: se pide al WebView,
               que a su vez pide permiso a Android. */
            override fun onPermissionRequest(req: PermissionRequest) {
                if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(android.Manifest.permission.CAMERA)
                    != android.content.pm.PackageManager.PERMISSION_GRANTED
                ) {
                    pendingCamera = req
                    requestPermissions(arrayOf(android.Manifest.permission.CAMERA), 7)
                    return
                }
                req.grant(req.resources)
            }
        }

        raiz.addView(web)
        setContentView(raiz)

        if (savedInstanceState == null) web.loadUrl("https://merca.local/index.html")
    }

    private fun pintarError(texto: String) {
        web.loadDataWithBaseURL("https://merca.local/", "<!doctype html><meta charset=utf-8>" +
            "<meta name=viewport content='width=device-width,initial-scale=1'>" +
            "<body style='background:#070A08;color:#F2F5F0;font-family:system-ui;padding:28px'>" +
            "<h1 style='font-size:22px'>MercaFabrick</h1><p style='color:#A7ABA2'>" + texto + "</p>" +
            "<button onclick='location.reload()' style='margin-top:12px;padding:10px 16px;border-radius:12px;" +
            "border:1px solid #C8FF00;background:#C8FF00;color:#070A08;font-weight:700'>Reintentar</button>" +
            "</body>", "text/html", "utf-8", null)
    }

    /** Si el WebView pidió cámara y el usuario la concede, se responde la
     *  petición; si la niega, se deniega sin dejar la promesa colgada. */
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, results)
        val req = pendingCamera ?: return
        pendingCamera = null
        if (requestCode == 7 && results.isNotEmpty() &&
            results[0] == android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            req.grant(req.resources)
        } else {
            req.deny()
        }
    }

    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        try { web.destroy() } catch (_: Throwable) {}
        super.onDestroy()
    }
}