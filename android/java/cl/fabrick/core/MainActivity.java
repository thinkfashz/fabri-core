package cl.fabrick.core;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

/**
 * Contenedor nativo mínimo de FABRI-CORE.
 *
 * Responsabilidad única: hospedar la WebView, cargar la interfaz desde los
 * assets internos y conectar el puente JNI. Toda la lógica vive en Rust.
 */
public class MainActivity extends Activity {

    private WebView web;
    private long ultimoPausa = 0L;
    private NativeBridge puente;
    /** Evita dos liberaciones de modelo simultáneas al recibir varios onTrimMemory. */
    private final java.util.concurrent.atomic.AtomicBoolean liberando =
            new java.util.concurrent.atomic.AtomicBoolean(false);
    private static final int PEDIR_ARCHIVO = 4711;
    private static final int PEDIR_CAMARA = 4712;
    private android.webkit.PermissionRequest permisoCamara;
    private android.webkit.ValueCallback<android.net.Uri[]> esperaArchivo;

    @Override
    protected void onCreate(Bundle estado) {
        super.onCreate(estado);
        Bitacora.iniciar(this);
        Bitacora.anotar("onCreate", "arranca la actividad");

        // IPv6 está roto en esta red: se fuerza IPv4 antes de cualquier socket.
        Red.forzarIPv4();

        puente = new NativeBridge(this);

        // 1) El núcleo (abrir SQLite, migrar el esquema) arranca en un hilo de
        //    fondo: no puede retrasar la primera pintura. Antes se hacía aquí
        //    de forma síncrona y, si tardaba, el usuario veía una ventana negra
        //    sin interfaz. La WebView se crea ya; cuando JavaScript llama al
        //    puente, éste espera al núcleo con un tope de 10 s.

        // 2) Configurar la WebView con criterio restrictivo.
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#08090A"));
        WebSettings cfg = web.getSettings();
        cfg.setJavaScriptEnabled(true);          // necesario para la interfaz
        cfg.setDomStorageEnabled(true);          // localStorage para preferencias de vista
        cfg.setAllowFileAccess(true);            // respaldo file:// si falla la interceptación
        // El selector de fotos del login entrega content:// y la WebView debe
        // poder leerlo: sin esto la foto elegida nunca llega a la página.
        cfg.setAllowContentAccess(true);
        cfg.setAllowFileAccessFromFileURLs(false);
        cfg.setAllowUniversalAccessFromFileURLs(false);
        cfg.setBuiltInZoomControls(false);
        cfg.setDisplayZoomControls(false);
        cfg.setSupportZoom(false);
        cfg.setMediaPlaybackRequiresUserGesture(true);
        // La interfaz vive en https://appassets.local y el usuario puede
        // apuntar la sincronización del inventario a un servidor propio por
        // http (LAN). Con NEVER_ALLOW esa sincronización quedaría bloqueada en
        // silencio. Antes la página era file:// y no había restricción de
        // contenido mixto, así que esto preserva el comportamiento: la página
        // es local y de confianza, y el tráfico en claro ya está acotado por
        // network_security_config + normalizarBase() en el núcleo.
        cfg.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        if (Build.VERSION.SDK_INT >= 26) {
            cfg.setSafeBrowsingEnabled(true);
        }

        // 3) Puente controlado: sólo el objeto "FabrickNative".
        //    Se registra la MISMA instancia que inicializó el núcleo, para que
        //    las descargas en curso y el diagnóstico compartan estado.
        web.addJavascriptInterface(puente, "FabrickNative");

        // 3b) Los eventos de descarga (progreso, fin) se devuelven a la página
        //     siempre en el hilo de interfaz: WebView no admite evaluateJavascript
        //     desde un hilo de fondo.
        puente.setNotificador(new NativeBridge.Notificador() {
            @Override
            public void js(final String script) {
                if (web == null) {
                    return;
                }
                web.post(new Runnable() {
                    @Override
                    public void run() {
                        WebView actual = web;
                        if (actual == null) {
                            return;
                        }
                        actual.evaluateJavascript(script, null);
                    }
                });
            }
        });

        // 4) Errores de consola de la página al log persistente del núcleo.
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView vista,
                                             android.webkit.ValueCallback<android.net.Uri[]> receptor,
                                             FileChooserParams parametros) {
                if (esperaArchivo != null) {
                    esperaArchivo.onReceiveValue(null);
                }
                esperaArchivo = receptor;
                try {
                    // El filtro por MIME del WebView deja archivos .json fuera de
                    // la vista en algunos gestores. Se abre con */* y el núcleo
                    // valida el contenido igual: nunca se ejecuta el archivo.
                    android.content.Intent intento = parametros.createIntent();
                    intento.setType("*/*");
                    intento.removeExtra("android.intent.extra.MIME_TYPES");
                    intento.addCategory(android.content.Intent.CATEGORY_OPENABLE);
                    startActivityForResult(intento, PEDIR_ARCHIVO);
                    return true;
                } catch (Throwable e) {
                    esperaArchivo = null;
                    Toast.makeText(MainActivity.this,
                            "No se pudo abrir el selector de archivos", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                // CRÍTICO: esto corre en el HILO DE INTERFAZ. Antes llamaba al
                // puente de forma síncrona y, si el núcleo estaba migrando,
                // cada mensaje de consola bloqueaba la interfaz hasta 10 s (y
                // la pantalla quedaba congelada). Ahora se encola y se escribe
                // en un hilo de fondo; la interfaz nunca espera.
                try {
                    String msj = "[" + m.messageLevel() + "] " + m.message() +
                            " (" + m.sourceId() + ":" + m.lineNumber() + ")";
                    // Ni archivo ni puente en este hilo: todo va a la cola.
                    ColaConsola.encolar(puente, msj);
                } catch (Throwable ignorado) {
                    // El log nunca debe tumbar la app.
                }
                return true;
            }

            /**
             * Cámara para el lector de códigos del inventario.
             * La página pide `getUserMedia`; el WebView delega aquí. Se concede
             * sólo vídeo y sólo si el usuario dio el permiso de Android. Nada
             * de audio ni de micrófono.
             */
            @Override
            public void onPermissionRequest(final android.webkit.PermissionRequest peticion) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            String[] recursos = peticion.getResources();
                            boolean soloVideo = recursos != null && recursos.length > 0;
                            if (recursos != null) {
                                for (String r : recursos) {
                                    if (r == null || !r.startsWith("android.webkit.resource.VIDEO_CAPTURE")) {
                                        soloVideo = false;
                                    }
                                }
                            }
                            if (!soloVideo) {
                                peticion.deny();
                                return;
                            }
                            if (checkSelfPermission(android.Manifest.permission.CAMERA)
                                    == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                                peticion.grant(recursos);
                            } else {
                                permisoCamara = peticion;
                                requestPermissions(
                                        new String[]{android.Manifest.permission.CAMERA}, PEDIR_CAMARA);
                            }
                        } catch (Throwable t) {
                            try { peticion.deny(); } catch (Throwable ignorado) { }
                        }
                    }
                });
            }

            @Override
            public void onPermissionRequestCanceled(android.webkit.PermissionRequest peticion) {
                permisoCamara = null;
            }
        });

        // 5) Navegación limitada a los assets locales.
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView vista, String url) {
                if (url.startsWith("file:///android_asset/") || ActivosWeb.esPropio(url)) {
                    return false;
                }
                Toast.makeText(MainActivity.this, "Enlace externo bloqueado", Toast.LENGTH_SHORT).show();
                return true;
            }

            /**
             * Sirve la interfaz desde https://appassets.local/ leyendo el APK o
             * filesDir. Es lo que da un origen https real sin abrir un puerto:
             * con ese origen funcionan fetch(), los módulos ES y WebAssembly.
             *
             * Se ejecuta en un hilo de fondo, así que aquí no se toca la
             * interfaz ni el puente.
             */
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView vista,
                                                              WebResourceRequest peticion) {
                try {
                    return ActivosWeb.responder(MainActivity.this,
                            peticion.getUrl().toString());
                } catch (Throwable e) {
                    // Ante cualquier fallo se devuelve null y la WebView lo
                    // intenta por su cuenta; nunca se cae la carga entera.
                    return null;
                }
            }

            /**
             * Red de seguridad: si el origen interceptado no respondiera, se
             * vuelve al asset directo. Se pierden fetch/WASM, pero la app abre
             * igual en vez de quedarse en blanco.
             */
            @Override
            public void onReceivedError(WebView vista, WebResourceRequest peticion,
                                        WebResourceError error) {
                if (peticion == null) {
                    return;
                }
                String url = peticion.getUrl() == null ? "" : peticion.getUrl().toString();
                // Un subrecurso que no carga (app.js, app.css) deja la
                // interfaz a medias sin decir nada. Se registra la URL exacta:
                // es la diferencia entre «no funciona» y «no cargó esto».
                if (!peticion.isForMainFrame()) {
                    try {
                        Bitacora.anotar("recurso", "no cargó: " + url);
                        ColaConsola.encolar(puente, "no cargó un recurso: " + url);
                    } catch (Throwable ignorado) {
                        // El log no puede empeorar el fallo.
                    }
                    return;
                }
                if (!ActivosWeb.esPropio(url)) {
                    return;
                }
                Bitacora.anotar("recurso", "falló el origen propio; se carga el asset directo");
                try {
                    ColaConsola.encolar(puente, "el origen propio falló; se carga el asset directo");
                } catch (Throwable ignorado) {
                    // El log no puede impedir la recuperación.
                }
                vista.loadUrl("file:///android_asset/www/index.html");
            }

            /**
             * Evidencia dura del arranque: después de cargar la página se le
             * pregunta a la propia WebView si app.js y diagnostico.js llegaron
             * a definir sus objetos. Sin esto, un fallo de carga se ve como
             * «Comprobando acceso…» y no hay forma de saber qué script faltó.
             */
            @Override
            public void onPageFinished(WebView vista, String url) {
                if (url == null || !ActivosWeb.esPropio(url)) {
                    return;
                }
                Bitacora.anotar("pagina", "onPageFinished " + url);
                try {
                    vista.evaluateJavascript(
                            "(function(){"
                            + "var d=(window.FabriDiag&&window.FabriDiag.ultimo)||'';"
                            + "return 'login='+(typeof window.FabriLogin)"
                            + "+';diag='+(typeof window.FabriDiag)"
                            + "+';error='+d;"
                            + "})()",
                            new android.webkit.ValueCallback<String>() {
                                @Override
                                public void onReceiveValue(String valor) {
                                    final String detalle = valor == null ? "" : valor;
                                    final boolean ok = detalle.contains("login=object");
                                    Bitacora.anotar("scripts", detalle);
                                    // El puente puede tardar: nunca en el hilo
                                    // de interfaz, que es donde corre esto.
                                    new Thread(new Runnable() {
                                        @Override
                                        public void run() {
                                            try {
                                                puente.call("revision.registrar",
                                                        "{\"tipo\":\"arranque\",\"severidad\":\""
                                                        + (ok ? "info" : "error")
                                                        + "\",\"origen\":\"webview\","
                                                        + "\"mensaje\":\"scripts de la interfaz\","
                                                        + "\"detalle\":\""
                                                        + detalle.replace("\\", "\\\\")
                                                                 .replace("\"", "\\\"")
                                                                 .replace("\n", " ")
                                                        + "\"}");
                                            } catch (Throwable ignorado) {
                                                // El registro no puede tumbar la app.
                                            }
                                        }
                                    }).start();
                                }
                            });
                } catch (Throwable ignorado) {
                    // Un WebView sin evaluateJavascript no impide la app.
                }

                // Evidencia a los 5 s: ¿quedó la pantalla de carga puesta o el
                // acceso respondió? Se escribe en la bitácora (archivo), que no
                // depende del núcleo. Es lo que permite diagnosticar sin cables.
                vista.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            vista.evaluateJavascript(
                                    "(function(){"
                                    + "var l=document.getElementById('loaderArranque');"
                                    + "var c=document.getElementById('loginFabrick');"
                                    + "return 'loader='+(l?(l.style.display==='none'?'oculto':getComputedStyle(l).opacity):'sin-nodo')"
                                    + "+';login='+(c?(c.hidden?'oculto':'visible'):'sin-nodo')"
                                    + "+';delegacion='+(window.__fabriDelegacion===true)"
                                    + "+';nucleo='+(window.FabriSalud?JSON.stringify(FabriSalud.estado()):'sin-vigilante');"
                                    + "})()",
                                    new android.webkit.ValueCallback<String>() {
                                        @Override
                                        public void onReceiveValue(String v) {
                                            Bitacora.anotar("estado-5s", v);
                                        }
                                    });
                        } catch (Throwable ignorado) {
                            // La comprobación es evidencia, no requisito.
                        }
                    }
                }, 5000);
            }

            /**
             * El renderer de Chromium es un proceso APARTE y es lo primero que
             * Android mata cuando falta memoria. En este teléfono se llega a
             * 90 MB libres, así que no es un caso teórico: sin este método la
             * WebView queda muerta y la app muestra una pantalla negra para
             * siempre, aunque el proceso siga vivo y respondiendo.
             *
             * Devolver true le dice al sistema que ya está atendido y que NO
             * mate la app; después se reconstruye la actividad y la interfaz
             * vuelve sola, con el estado que ya vive en SQLite.
             */
            @Override
            public boolean onRenderProcessGone(WebView vista,
                                               android.webkit.RenderProcessGoneDetail detalle) {
                boolean crasheo = false;
                try {
                    crasheo = detalle != null && detalle.didCrash();
                } catch (Throwable ignorado) {
                    // En Android viejos `detalle` puede no existir.
                }
                try {
                    puente.call("log.append", "{\"nivel\":\"AVISO\",\"origen\":\"webview\","
                            + "\"mensaje\":\"murió el renderer de la interfaz ("
                            + (crasheo ? "crashed" : "lo mató el sistema por memoria")
                            + "); se reconstruye la pantalla\"}");
                } catch (Throwable ignorado) {
                    // El log jamás puede impedir la recuperación.
                }
                Bitacora.anotar("renderer", crasheo
                        ? "el renderer de la WebView se cayó; se reconstruye"
                        : "Android mató el renderer por memoria; se reconstruye");
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            Toast.makeText(MainActivity.this,
                                    "La interfaz se reinició por falta de memoria",
                                    Toast.LENGTH_LONG).show();
                        } catch (Throwable ignorado) {
                            // La ventana pudo desaparecer mientras tanto.
                        }
                        recreate();
                    }
                });
                return true;
            }
        });

        setContentView(web);
        // 1a) El núcleo arranca ANTES de pedir la página: la base de datos se
        // abre y migra mientras la WebView todavía está cargando. Antes se
        // lanzaba después de `loadUrl`, así que la interfaz siempre llegaba
        // primero y cada llamada tenía que esperar la migración.
        new Thread(new Runnable() {
            @Override
            public void run() {
                String init;
                try {
                    init = puente.initNucleo();
                } catch (Throwable t) {
                    init = "{\"ok\":false,\"error\":\"" + String.valueOf(t)
                            .replace("\\", "\\\\").replace("\"", "\\\"") + "\"}";
                }
                if (init == null || !init.contains("\"ok\":true")) {
                    final String detalle = init;
                    Bitacora.anotar("nucleo", "init no quedó disponible: " + detalle);
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            Toast.makeText(MainActivity.this,
                                    "Núcleo no disponible: " + detalle, Toast.LENGTH_LONG).show();
                        }
                    });
                }
            }
        }, "nucleo-init").start();

        // Origen https propio, servido por ActivosWeb. Desde file:// el WebView
        // bloquea fetch(), los módulos ES y WebAssembly, que es justo lo que
        // necesita el módulo de visión.
        Bitacora.anotar("webview", "loadUrl " + ActivosWeb.BASE + "index.html");
        web.loadUrl(ActivosWeb.BASE + "index.html");

        // Si la app se abrió por el retorno de OAuth, se procesa el código.
        revisarOauth(getIntent());
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        revisarOauth(intent);
    }

    /**
     * El navegador vuelve a `fabrickcore://oauth?code=…&state=…`.
     * El canje lo hace el puente en segundo plano; acá sólo se enruta.
     */
    private void revisarOauth(android.content.Intent intent) {
        if (intent == null || intent.getData() == null || puente == null) {
            return;
        }
        android.net.Uri u = intent.getData();
        String esquema = u.getScheme() == null ? "" : u.getScheme().toLowerCase(java.util.Locale.US);
        String host = u.getHost() == null ? "" : u.getHost().toLowerCase(java.util.Locale.US);
        if ("fabrickcore".equals(esquema) && "oauth".equals(host)) {
            puente.conexionOauthCompletar(u.toString());
        }
    }

    @Override
    public boolean onKeyDown(int codigo, KeyEvent evento) {
        if (codigo == KeyEvent.KEYCODE_BACK && web != null) {
            // Se usa una clase anónima (no lambda) para poder compilar contra
            // android.jar sin la máquina de lambdas del JDK.
            web.evaluateJavascript("window.fabrickAtras && window.fabrickAtras()",
                    new android.webkit.ValueCallback<String>() {
                        @Override
                        public void onReceiveValue(String valor) {
                            if (!"true".equals(valor)) {
                                // Antes esto era finish(): al pulsar atrás desde
                                // el inicio la app se cerraba de golpe y el
                                // usuario lo vivía como un cierre inesperado.
                                // Ahora se manda la tarea al fondo: queda viva
                                // y al volver aparece en la misma vista.
                                moveTaskToBack(true);
                            }
                        }
                    });
            return true;
        }
        return super.onKeyDown(codigo, evento);
    }

    @Override
    public void onRequestPermissionsResult(int codigo, String[] permisos, int[] resultados) {
        if (codigo == PEDIR_CAMARA) {
            android.webkit.PermissionRequest peticion = permisoCamara;
            permisoCamara = null;
            if (peticion == null) {
                return;
            }
            boolean concedido = resultados != null && resultados.length > 0
                    && resultados[0] == android.content.pm.PackageManager.PERMISSION_GRANTED;
            try {
                if (concedido) {
                    peticion.grant(peticion.getResources());
                } else {
                    peticion.deny();
                    Toast.makeText(this, "Sin permiso de cámara no se puede escanear; usa el código manual.",
                            Toast.LENGTH_LONG).show();
                }
            } catch (Throwable ignorado) {
                // La petición pudo caducar mientras se mostraba el diálogo.
            }
            return;
        }
        super.onRequestPermissionsResult(codigo, permisos, resultados);
    }

    @Override
    protected void onActivityResult(int codigo, int resultado, android.content.Intent datos) {
        if (codigo == PEDIR_ARCHIVO) {
            android.net.Uri[] elegidos = null;
            if (resultado == RESULT_OK && datos != null) {
                if (datos.getClipData() != null) {
                    int n = datos.getClipData().getItemCount();
                    elegidos = new android.net.Uri[n];
                    for (int i = 0; i < n; i++) {
                        elegidos[i] = datos.getClipData().getItemAt(i).getUri();
                    }
                } else if (datos.getData() != null) {
                    elegidos = new android.net.Uri[]{datos.getData()};
                }
            }
            if (esperaArchivo != null) {
                esperaArchivo.onReceiveValue(elegidos);
                esperaArchivo = null;
            }
            return;
        }
        super.onActivityResult(codigo, resultado, datos);
    }

    @Override
    protected void onStop() {
        ultimoPausa = System.currentTimeMillis();
        super.onStop();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (ultimoPausa > 0L && System.currentTimeMillis() - ultimoPausa > 5L * 60L * 1000L) {
            Huella.bloquear();
            if (web != null) {
                web.evaluateJavascript("window.FabriLogin && FabriLogin.bloquear();", null);
            }
        }
    }

    @Override
    public void onTrimMemory(int nivel) {
        super.onTrimMemory(nivel);
        // El modelo GGUF es lo que más RAM ocupa. Si Android avisa que la
        // memoria está crítica, se libera ANTES de que el kernel mate el
        // proceso entero: es preferible perder el modelo a perder la app.
        //
        // OJO: onTrimMemory llega en el HILO DE INTERFAZ. Liberar 400 MB de
        // memoria nativa ahí bloquea el dibujado y produce un ANR, que es
        // justo la pantalla negra que se veía. Por eso el trabajo va a un hilo
        // aparte y sólo se permite una liberación a la vez.
        if (nivel != android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL
                && nivel != android.content.ComponentCallbacks2.TRIM_MEMORY_COMPLETE) {
            return;
        }
        if (!liberando.compareAndSet(false, true)) {
            return; // ya hay una liberación en curso
        }
        final int nivelAviso = nivel;
        Thread hilo = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    RuntimeNativo.liberar();
                    if (web != null) {
                        web.post(new Runnable() {
                            @Override
                            public void run() {
                                if (web == null) {
                                    return;
                                }
                                web.evaluateJavascript(
                                        "window.FabriChat && FabriChat.localCargado({ok:false,error:"
                                                + "'modelo liberado por falta de memoria'});", null);
                            }
                        });
                    }
                    puente.call("log.append",
                            "{\"nivel\":\"AVISO\",\"origen\":\"memoria\",\"mensaje\":"
                                    + "\"modelo local liberado por presión de memoria (nivel "
                                    + nivelAviso + ")\"}");
                } catch (Throwable ignorado) {
                    // Si ni siquiera se puede liberar, no hay nada más que hacer.
                } finally {
                    liberando.set(false);
                }
            }
        }, "trim-memoria");
        hilo.setDaemon(true);
        hilo.start();
    }

    @Override
    protected void onDestroy() {
        if (puente != null) {
            puente.cerrar();
        }
        if (web != null) {
            web.removeJavascriptInterface("FabrickNative");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
