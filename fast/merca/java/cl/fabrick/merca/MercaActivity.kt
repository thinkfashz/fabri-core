package cl.fabrick.merca

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

/**
 * MercaFabrick · marketplace de barrio.
 *
 * Una actividad con una WebView a pantalla completa. La interfaz vive en
 * `assets/merca/www/index.html` y se sirve desde `https://merca.local` con
 * `ActivosMerca` (sin levantar puertos).
 *
 * Toda la creación va dentro de un try/catch: si algo falla, se muestra el
 * motivo en pantalla en vez de cerrarse. Es la diferencia entre un crash
 * silencioso y un diagnóstico que se puede leer.
 */
class MercaActivity : Activity() {

    private var web: WebView? = null
    private var pendingCamera: PermissionRequest? = null
    private var pendingGeo: GeolocationPermissions.Callback? = null
    private var pendingGeoOrigen: String? = null
    private var arranco = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            arrancar()
        } catch (t: Throwable) {
            Log.e("merca", "onCreate falló", t)
            pintarError("No se pudo iniciar la interfaz:\n" + (t.message ?: t.javaClass.simpleName))
        }
    }

    private fun arrancar() {
        /* Si la interfaz se cae, que se vea el motivo en pantalla: sin esto el
           proceso muere y el usuario sólo ve un parpadeo negro. */
        Thread.setDefaultUncaughtExceptionHandler { _, t ->
            Log.e("merca", "crash", t)
            pintarError("La app se detuvo:\n" + (t.message ?: t.javaClass.simpleName))
        }
        window.statusBarColor = Color.parseColor("#070A08")
        window.navigationBarColor = Color.parseColor("#070A08")

        val raiz = FrameLayout(this).apply { setBackgroundColor(Color.parseColor("#070A08")) }

        val vista = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#070A08"))
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = false
                allowContentAccess = true
                mediaPlaybackRequiresUserGesture = false
                useWideViewPort = true
                loadWithOverviewMode = true
                cacheMode = WebSettings.LOAD_DEFAULT
                saveFormData = false
            }
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }
        web = vista

        vista.webViewClient = object : WebViewClient() {
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
                return try {
                    ActivosMerca.responder(this@MercaActivity, req.url.toString())
                } catch (t: Throwable) {
                    Log.e("merca", "intercept falló", t)
                    null
                }
            }

            override fun onReceivedError(v: WebView, req: WebResourceRequest, err: android.webkit.WebResourceError) {
                if (req.isForMainFrame) {
                    Log.e("merca", "error de carga: " + err.description)
                    pintarError("No se pudo cargar la interfaz.\n" + (err.description ?: ""))
                }
            }
        }

        vista.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                Log.i("merca", "console " + m.messageLevel() + ": " + m.message() +
                    " @ " + m.sourceId() + ":" + m.lineNumber())
                return true
            }

            /* La WebView no pide ubicación sola: hay que autorizarla acá o el
               botón de "mi ubicación" falla en silencio. */
            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                if (Build.VERSION.SDK_INT >= 23 &&
                    checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) !=
                    android.content.pm.PackageManager.PERMISSION_GRANTED
                ) {
                    pendingGeo = callback
                    pendingGeoOrigen = origin
                    try {
                        requestPermissions(
                            arrayOf(
                                android.Manifest.permission.ACCESS_FINE_LOCATION,
                                android.Manifest.permission.ACCESS_COARSE_LOCATION
                            ), 8
                        )
                    } catch (_: Throwable) { callback.invoke(origin, false, false) }
                    return
                }
                callback.invoke(origin, true, false)
            }

            override fun onPermissionRequest(req: PermissionRequest) {
                if (Build.VERSION.SDK_INT >= 23 &&
                    checkSelfPermission(android.Manifest.permission.CAMERA) !=
                    android.content.pm.PackageManager.PERMISSION_GRANTED
                ) {
                    pendingCamera = req
                    try { requestPermissions(arrayOf(android.Manifest.permission.CAMERA), 7) } catch (_: Throwable) {}
                    return
                }
                try { req.grant(req.resources) } catch (_: Throwable) {}
            }
        }

        /* Puente para guardar la boleta PDF y compartirla. La web lo usa sólo
           para eso; si no existe (navegador), descarga el archivo. */
        try { vista.addJavascriptInterface(Puente(this), "MercaPuente") } catch (_: Throwable) {}

        raiz.addView(vista)
        setContentView(raiz)

        if (!arranco) {
            arranco = true
            vista.loadUrl(ActivosMerca.BASE + "index.html")
        }
    }

    /** Pantalla de error nativa: no depende de la WebView. */
    private fun pintarError(texto: String) {
        try {
            val caja = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(28, 40, 28, 40)
                setBackgroundColor(Color.parseColor("#070A08"))
            }
            caja.addView(TextView(this).apply {
                text = "MercaFabrick"
                setTextColor(Color.parseColor("#C8FF00"))
                textSize = 24f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            })
            caja.addView(TextView(this).apply {
                text = texto
                setTextColor(Color.parseColor("#F2F5F0"))
                textSize = 14f
                setPadding(0, 18, 0, 24)
            })
            caja.addView(TextView(this).apply {
                text = "Reintentar"
                setTextColor(Color.parseColor("#070A08"))
                setBackgroundColor(Color.parseColor("#C8FF00"))
                setPadding(28, 18, 28, 18)
                gravity = Gravity.CENTER
                setOnClickListener { recreate() }
            })
            setContentView(caja)
        } catch (_: Throwable) { /* si ni esto se puede, que se cierre */ }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, results)

        if (requestCode == 8) {
            val cb = pendingGeo
            val origen = pendingGeoOrigen ?: "https://merca.local/"
            pendingGeo = null
            pendingGeoOrigen = null
            val ok = results.isNotEmpty() && results[0] == android.content.pm.PackageManager.PERMISSION_GRANTED
            try { cb?.invoke(origen, ok, false) } catch (_: Throwable) {}
            return
        }

        val req = pendingCamera ?: return
        pendingCamera = null
        try {
            if (requestCode == 7 && results.isNotEmpty() &&
                results[0] == android.content.pm.PackageManager.PERMISSION_GRANTED
            ) req.grant(req.resources) else req.deny()
        } catch (_: Throwable) { /* la petición ya no existe */ }
    }

    override fun onBackPressed() {
        val w = web
        if (w != null && w.canGoBack()) w.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        try { web?.destroy() } catch (_: Throwable) {}
        web = null
        super.onDestroy()
    }
}