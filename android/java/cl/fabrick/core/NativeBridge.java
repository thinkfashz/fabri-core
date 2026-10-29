package cl.fabrick.core;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.webkit.JavascriptInterface;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.Charset;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Puente entre la interfaz HTML y el núcleo Rust.
 *
 * La interfaz NO tiene acceso directo a archivos, red ni procesos:
 *   · `call(op, payloadJson)` despacha a una lista cerrada de operaciones Rust;
 *   · `descargar(...)` sólo acepta URLs HTTPS declaradas por un manifiesto ya
 *     validado, con SHA-256 y tamaño obligatorios;
 *   · `t0()` es una prueba diagnóstica de plataforma, con ruta y binario fijos.
 *   · `omni*()` sólo hablan HTTP con un OmniRoute que el usuario configuró
 *     (loopback en el teléfono o HTTPS remoto). No instalan ni ejecutan nada.
 *
 * Ninguna de estas funciones ejecuta comandos que vengan del catálogo.
 */
public final class NativeBridge {

    static {
        // Esta red tiene IPv6 roto: si Java intenta AAAA primero, todo cuelga.
        // Se fija antes de cualquier socket del proceso.
        Red.forzarIPv4();
        // Carga lib/arm64-v8a/libfabrick_core.so desde la APK.
        System.loadLibrary("fabrick_core");
    }

    /** Función JNI única exportada por Rust (ver src-tauri/src/lib.rs). */
    private static native String exec(String op, String payloadJson);

    /** Cómo se devuelven eventos a JavaScript (lo implementa MainActivity). */
    public interface Notificador {
        void js(String script);
    }

    private final Context contexto;
    private final Map<String, Descargador.Control> controles = new ConcurrentHashMap<String, Descargador.Control>();
    private volatile Notificador notificador;

    /** Una sola generación a la vez: el modelo tiene una KV y un sampler. */
    private static final java.util.concurrent.atomic.AtomicBoolean GENERANDO =
            new java.util.concurrent.atomic.AtomicBoolean(false);

    /** El núcleo arranca en segundo plano; esto avisa cuando terminó. */
    private final java.util.concurrent.CountDownLatch listo =
            new java.util.concurrent.CountDownLatch(1);

    /** Bóveda cifrada de conexiones (se crea al primer uso). */
    private Boveda boveda;

    /** Último resultado OAuth, para la página que abre después del redirect. */
    private volatile String ultimoOauth;

    /** Redirect URI registrada en las apps OAuth del usuario. */
    static final String REDIRECCION_OAUTH = "fabrickcore://oauth";

    /** TTS del sistema: no descarga binarios; usa el motor instalado en Android. */
    private TextToSpeech tts;
    private volatile boolean ttsListo = false;
    private volatile String ttsError = "motor TTS sin inicializar";

    NativeBridge(Context contexto) {
        this.contexto = contexto;
        Bitacora.iniciar(contexto);
        Bitacora.anotar("puente", "NativeBridge creado; clase nativa cargada");
        iniciarTts();
    }

    void setNotificador(Notificador n) {
        this.notificador = n;
    }

    /** Inicializa el núcleo: abre SQLite, migra el esquema y siembra el catálogo. */
    String initNucleo() {
        String dataDir = contexto.getFilesDir().getAbsolutePath();
        long t0 = System.currentTimeMillis();
        Bitacora.anotar("nucleo", "init: comienza la migración de SQLite");
        try {
            final String datos = "{\"dataDir\":\"" + dataDir.replace("\\", "/") + "\"}";
            // `init` va por el mismo carril que el resto: así ninguna operación
            // de JavaScript puede entrar al núcleo mientras se migra (la
            // interfaz recibe NUCLEO_OCUPADO y reintenta, sin bloquearse).
            java.util.concurrent.Future<String> futuro = EJECUTOR.submit(
                    new java.util.concurrent.Callable<String>() {
                        @Override
                        public String call() {
                            return exec("init", datos);
                        }
                    });
            String r;
            try {
                r = futuro.get();
            } catch (java.util.concurrent.ExecutionException ee) {
                throw new RuntimeException(ee.getCause() == null ? ee : ee.getCause());
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                throw new RuntimeException(ie);
            }
            Bitacora.anotar("nucleo", "init terminó en "
                    + (System.currentTimeMillis() - t0) + " ms · " + recortarBitacora(r));
            return r;
        } catch (Throwable t) {
            Bitacora.anotar("nucleo", "init FALLÓ en "
                    + (System.currentTimeMillis() - t0) + " ms · " + t);
            throw t;
        } finally {
            // Pase lo que pase, las llamadas de JavaScript dejan de esperar:
            // si el núcleo falló, cada operación devolverá su error real.
            listo.countDown();
            // Mantenimiento (poda + checkpoint) fuera del arranque: se hace
            // cuando la interfaz ya está usable, nunca mientras se pinta.
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Thread.sleep(2500);
                        // Por la cola del núcleo: la poda y el checkpoint no
                        // pueden ejecutarse a la vez que una consulta de la
                        // interfaz (el mutex de Rust los serializa igual, pero
                        // así no aparece como «LENTO» sin motivo).
                        java.util.concurrent.Future<String> f = EJECUTOR.submit(
                                new java.util.concurrent.Callable<String>() {
                                    @Override
                                    public String call() {
                                        return exec("mantenimiento", "{}");
                                    }
                                });
                        Bitacora.anotar("mantenimiento", recortarBitacora(f.get()));
                    } catch (Throwable ignorado) {
                        // La poda es higiene, no requisito.
                    }
                }
            }, "nucleo-mantenimiento").start();
            // Y se avisa a la interfaz: si estaba mostrando «núcleo iniciando»,
            // se repinta sola sin que el usuario toque nada.
            avisarNucleoListo();
        }
    }

    private void avisarNucleoListo() {
        Notificador n = notificador;
        if (n == null) return;
        try {
            n.js("window.__fabriNucleoListo && window.__fabriNucleoListo();");
        } catch (Throwable ignorado) {
            // El aviso es una mejora, no un requisito.
        }
    }

    /**
     * Llamada ASÍNCRONA: devuelve el control a JavaScript al instante y entrega
     * el resultado cuando el núcleo termina.
     *
     * <p>Es la pieza que elimina el «se queda pegado». `call()` es síncrono
     * porque `@JavascriptInterface` lo es: JavaScript se queda esperando el
     * valor de retorno y, mientras espera, la página no repinta ni responde a
     * los toques. Con un tope de 900 ms por operación y 20 s para las pesadas,
     * abrir una pantalla que hace tres consultas podía congelar la interfaz
     * varios segundos. Aquí no se espera nada: se encola, se devuelve un token
     * y el resultado llega por `window.__fabriAsync(token, json)`.
     *
     * <p>La interfaz usa esta vía para todo lo que no sea una acción puntual
     * (ver `apiAsync` en app.js). Las operaciones ligeras siguen usando `call()`
     * para no complicar el código que espera un valor inmediato.
     */
    @JavascriptInterface
    public String callAsync(String op, String payloadJson) {
        final String token = "a" + ASYNC_SEQ.incrementAndGet();
        if (op == null || op.isEmpty()) {
            entregaAsync(token, "{\"ok\":false,\"error\":\"operación vacía\",\"codigo\":\"BAD_OP\"}");
            return acuse(token);
        }
        final String cuerpo = (payloadJson == null || payloadJson.isEmpty()) ? "{}" : payloadJson;

        // Registros: se encolan y se confirma el diferido, igual que en call().
        if (esRegistro(op)) {
            encolarRegistro(op, cuerpo);
            entregaAsync(token, "{\"ok\":true,\"registrado\":false,\"diferido\":true}");
            return acuse(token);
        }
        if ("ping".equals(op)) {
            entregaAsync(token, pingLocal());
            return acuse(token);
        }
        if (necesitaNucleo(op) && listo.getCount() > 0) {
            entregaAsync(token, ocupado("el núcleo todavía se está iniciando"));
            return acuse(token);
        }

        final String operacion = op;
        final String llave = op + "\u0000" + cuerpo;
        if (!EN_VUELO.add(llave)) {
            entregaAsync(token, lento(op, "ya hay una operación igual en curso"));
            return acuse(token);
        }
        try {
            EJECUTOR.execute(new Runnable() {
                @Override
                public void run() {
                    String salida;
                    long ini = System.currentTimeMillis();
                    try {
                        salida = exec(operacion, cuerpo);
                    } catch (Throwable t) {
                        salida = "{\"ok\":false,\"error\":\"" + escapar(String.valueOf(t))
                                + "\",\"codigo\":\"EXCEPTION\"}";
                    } finally {
                        EN_VUELO.remove(llave);
                        long ms = System.currentTimeMillis() - ini;
                        if (ms >= 700) {
                            ultimoLento = operacion + " " + ms + " ms";
                            Bitacora.anotar("lento", ultimoLento);
                        }
                    }
                    entregaAsync(token, salida != null ? salida
                            : "{\"ok\":false,\"error\":\"el núcleo devolvió vacío\",\"codigo\":\"NULL\"}");
                }
            });
        } catch (java.util.concurrent.RejectedExecutionException re) {
            EN_VUELO.remove(llave);
            entregaAsync(token, ocupado("la cola del núcleo está llena"));
        }
        return acuse(token);
    }

    /** Confirmación inmediata de una llamada asíncrona aceptada. */
    private String acuse(String token) {
        return "{\"ok\":true,\"asincrono\":true,\"token\":\"" + token + "\"}";
    }

    /**
     * Entrega el resultado a JavaScript. Se usa `JSONObject.quote` para que el
     * JSON viaje como literal de cadena: comillas, saltos de línea y acentos
     * quedan escapados y no pueden romper el script.
     */
    private void entregaAsync(String token, String json) {
        Notificador n = notificador;
        if (n == null) {
            return;
        }
        try {
            n.js("window.__fabriAsync&&window.__fabriAsync("
                    + JSONObject.quote(token) + "," + JSONObject.quote(json) + ");");
        } catch (Throwable ignorado) {
            // Si la página ya no está, el resultado se descarta en silencio.
        }
    }

    /**
     * Ya NO hay espera bloqueante. Antes `call()` retenía el hilo de JavaScript
     * hasta 1,2 s por operación mientras el núcleo migraba; con una pantalla que
     * hace tres o cuatro llamadas al abrirse, eso eran varios segundos de
     * interfaz congelada. Ahora se responde al instante con
     * `NUCLEO_OCUPADO` + `reintentar:true` y la interfaz reintenta con
     * `setTimeout`, sin bloquear el hilo que pinta.
     */

    /**
     * ¿Esta operación necesita el estado (SQLite) del núcleo?
     * `ping` no: responde desde la primera instrucción de Rust. Las de registro
     * tampoco bloquean: si el núcleo no está, se descartan en silencio para no
     * llenar la interfaz de errores en cadena.
     */
    private static boolean necesitaNucleo(String op) {
        return !("ping".equals(op)
                || "log.append".equals(op)
                || "revision.registrar".equals(op)
                || "runtime".equals(op));
    }

    /** ¿Esta operación puede descartarse sin ruido si el núcleo no está? */
    private static boolean esRegistro(String op) {
        return "log.append".equals(op) || "revision.registrar".equals(op);
    }

    /** Punto de entrada usado por JavaScript. Devuelve siempre JSON. */
    @JavascriptInterface
    public String call(String op, String payloadJson) {
        if (op == null || op.isEmpty()) {
            return "{\"ok\":false,\"error\":\"operación vacía\",\"codigo\":\"BAD_OP\"}";
        }
        if (payloadJson == null || payloadJson.isEmpty()) {
            payloadJson = "{}";
        }

        // 1) Los registros NUNCA se escriben en el hilo de JavaScript: se
        //    encolan y se confirman como diferidos. Antes, un fallo de cada
        //    operación disparaba `revision.registrar` de forma síncrona, que
        //    volvía a esperar la base: el error se realimentaba y el hilo de la
        //    interfaz quedaba atrapado en una cadena de escrituras.
        if (esRegistro(op)) {
            encolarRegistro(op, payloadJson);
            return "{\"ok\":true,\"registrado\":false,\"diferido\":true}";
        }

        // 2) `ping` lo contesta Java: no toca el núcleo ni entra en la cola.
        //    Así «Probar núcleo» responde siempre, incluso mientras una
        //    operación pesada tiene tomado el hilo del núcleo.
        if ("ping".equals(op)) {
            return pingLocal();
        }

        // 3) Si el núcleo todavía migra se responde YA. Bloquear aquí era lo
        //    que dejaba la interfaz sin responder al abrir una pantalla.
        if (necesitaNucleo(op) && listo.getCount() > 0) {
            return ocupado("el núcleo todavía se está iniciando");
        }

        // 3) TOPE DURO. Aunque el núcleo se quede atascado (base bloqueada,
        //    consulta lenta, migración), el hilo de JavaScript espera como
        //    máximo `TOPE_CALL_MS`. Es la garantía que faltaba: con la espera
        //    de 10 s por llamada, siete llamadas en el arranque congelaban la
        //    pantalla más de un minuto (los videos mostraban 1 %, 7 %, −1 % y
        //    los botones muertos).
        final String operacion = op;
        final String cuerpo = payloadJson;
        long tope = esPesada(op) ? TOPE_PESADA_MS : TOPE_CALL_MS;
        long t0 = System.currentTimeMillis();

        // 4) COALESCENCIA. Si ya hay una operación idéntica en curso (misma
        //    operación y mismo payload), no se encola otra: se responde LENTO
        //    para que la interfaz espere. Sin esto, cada reintento de la
        //    interfaz apilaba trabajo y la cola crecía sin límite.
        final String llave = op + "\u0000" + payloadJson;
        if (!EN_VUELO.add(llave)) {
            return lento(op, "ya hay una operación igual en curso");
        }

        java.util.concurrent.Future<String> futuro;
        try {
            futuro = EJECUTOR.submit(
                    new java.util.concurrent.Callable<String>() {
                        @Override
                        public String call() {
                            long ini = System.currentTimeMillis();
                            try {
                                return exec(operacion, cuerpo);
                            } finally {
                                EN_VUELO.remove(llave);
                                long ms = System.currentTimeMillis() - ini;
                                // Vigilancia: deja en la bitácora QUÉ operación
                                // se quedó con el hilo del núcleo y cuánto.
                                if (ms >= 700) {
                                    ultimoLento = operacion + " " + ms + " ms";
                                    Bitacora.anotar("lento", ultimoLento);
                                }
                            }
                        }
                    });
        } catch (java.util.concurrent.RejectedExecutionException re) {
            // La cola acotada está llena: se rechaza en vez de acumular.
            EN_VUELO.remove(llave);
            return ocupado("la cola del núcleo está llena");
        }
        try {
            String salida = futuro.get(tope, java.util.concurrent.TimeUnit.MILLISECONDS);
            long ms = System.currentTimeMillis() - t0;
            if (ms >= 700) {
                Bitacora.anotar("lento", op + " tardó " + ms + " ms");
            }
            return salida != null
                    ? salida
                    : "{\"ok\":false,\"error\":\"el núcleo devolvió vacío\",\"codigo\":\"NULL\"}";
        } catch (java.util.concurrent.TimeoutException te) {
            // La operación sigue en el hilo del núcleo y su resultado se
            // descarta: la interfaz ya recibió una respuesta clara y puede
            // reintentar o seguir. Nunca se queda esperando. NO se cancela:
            // interrumpir a mitad de una escritura SQLite deja la base peor.
            return lento(op, "superó " + tope + " ms");
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            return "{\"ok\":false,\"error\":\"llamada interrumpida\",\"codigo\":\"INTERRUMPIDO\"}";
        } catch (Throwable t) {
            Bitacora.anotar("excepcion", op + " · " + t);
            return "{\"ok\":false,\"error\":\"" + escapar(t.toString()) + "\",\"codigo\":\"EXCEPTION\"}";
        }
    }

    /**
     * El ÚNICO carril hacia el núcleo.
     *
     * <p>El núcleo Rust tiene un mutex global: dos hilos llamándolo a la vez no
     * van más rápido, sólo se pisan. Por eso todo —`init`, operaciones,
     * registros y mantenimiento— pasa por esta cola, y así se sabe con certeza
     * qué está ocupando el hilo.
     *
     * <p>La cola está ACOTADA (24). Antes era ilimitada: cada llamada que
     * expiraba dejaba su tarea corriendo y las siguientes se apilaban detrás,
     * de modo que un pico de trabajo se convertía en minutos de «LENTO» en
     * cascada. Con la cola llena se rechaza y la interfaz reintenta.
     */
    private static final java.util.concurrent.ThreadPoolExecutor EJECUTOR =
            new java.util.concurrent.ThreadPoolExecutor(
                    2, 2, 0L, java.util.concurrent.TimeUnit.MILLISECONDS,
                    new java.util.concurrent.ArrayBlockingQueue<Runnable>(24),
                    new java.util.concurrent.ThreadFactory() {
                        @Override
                        public Thread newThread(Runnable r) {
                            Thread t = new Thread(r, "nucleo-call");
                            t.setDaemon(true);
                            t.setPriority(Thread.NORM_PRIORITY + 1);
                            return t;
                        }
                    },
                    new java.util.concurrent.ThreadPoolExecutor.AbortPolicy());

    /**
     * Operaciones en curso, por `op + payload`. Sirve para no apilar la misma
     * consulta varias veces cuando la interfaz reintenta mientras el núcleo
     * todavía no ha terminado la anterior.
     */
    private static final java.util.Set<String> EN_VUELO =
            java.util.Collections.newSetFromMap(new java.util.concurrent.ConcurrentHashMap<String, Boolean>());

    /** Numerador de tokens de las llamadas asíncronas. */
    private static final java.util.concurrent.atomic.AtomicLong ASYNC_SEQ =
            new java.util.concurrent.atomic.AtomicLong(0);

    /** Última operación que se quedó con el hilo del núcleo (para diagnóstico). */
    private static volatile String ultimoLento = "";

    /** Profundidad actual de la cola (-1 si no se puede leer). */
    private static int cola() {
        try {
            return EJECUTOR.getQueue().size();
        } catch (Throwable t) {
            return -1;
        }
    }

    /** Respuesta inmediata de `ping`: la contesta Java, sin tocar el núcleo. */
    private String pingLocal() {
        boolean l = listo.getCount() == 0;
        return "{\"ok\":true,\"data\":{\"fuente\":\"java\",\"listo\":" + l
                + ",\"cola\":" + cola() + ",\"en_vuelo\":" + EN_VUELO.size()
                + ",\"ultimo_lento\":\"" + escapar(ultimoLento) + "\"},\"listo\":" + l + "}";
    }

    /** El núcleo todavía no está (o está saturado): reintentar sin bloquear. */
    private String ocupado(String motivo) {
        Bitacora.anotar("nucleo-ocupado", motivo + " · cola=" + cola());
        return "{\"ok\":false,\"error\":\"" + escapar(motivo) + "\","
                + "\"codigo\":\"NUCLEO_OCUPADO\",\"reintentar\":true,"
                + "\"cola\":" + cola() + "}";
    }

    /** La operación no terminó a tiempo: es un estado, no un error del usuario. */
    private String lento(String op, String motivo) {
        return "{\"ok\":false,\"error\":\"el núcleo está ocupado: " + escapar(motivo) + "\","
                + "\"codigo\":\"LENTO\",\"op\":\"" + escapar(op) + "\",\"reintentar\":true,"
                + "\"cola\":" + cola() + "}";
    }

    /** Tope de una llamada normal: por encima de esto la interfaz se libera. */
    /**
     * Tope de la vía SÍNCRONA, sólo para acciones puntuales (guardar, borrar,
     * registrar). Las lecturas de pantalla van por `callAsync`, que no bloquea.
     * 600 ms es un parón imperceptible frente a los 20 s de antes.
     */
    private static final long TOPE_CALL_MS = 600L;

    /** Tope de operaciones pesadas, siempre iniciadas por el usuario. */
    private static final long TOPE_PESADA_MS = 20000L;

    /** ¿Es una operación que puede tardar de verdad (búsqueda, exportación)? */
    private static boolean esPesada(String op) {
        return "rag".equals(op)
                || "graphrag_buscar".equals(op)
                || "aprendizaje_buscar".equals(op)
                || "aprendizaje_guardar".equals(op)
                || "sqlite".equals(op)
                || "nube".equals(op)
                || "estado_global".equals(op)
                || "dispositivo_detalles".equals(op)
                || "modelos_recomendados".equals(op)
                || "inventario".equals(op)
                || "perfil".equals(op)
                || "usuarios".equals(op)
                || "revision.resumen".equals(op)
                || "manifiestos".equals(op)
                || "modulos".equals(op)
                // Escanear modelos recorre varios directorios (incluido el
                // almacenamiento externo, que puede tardar segundos). Con el
                // tope de 600 ms se perdía siempre con «núcleo ocupado».
                || "modelos".equals(op)
                || "consultar_seguro".equals(op);
    }

    /**
     * Escribe un registro en segundo plano, por el MISMO carril del núcleo.
     *
     * <p>Antes tenía su propio hilo, que competía por el mutex de Rust con las
     * operaciones de la interfaz: un registro lento retrasaba una consulta y
     * aparecía como «LENTO» sin motivo visible. Ahora se serializa como todo lo
     * demás y, si la cola está saturada, el registro se descarta: un log no
     * vale un cuelgue.
     */
    private static void encolarRegistro(final String op, final String payload) {
        try {
            if (cola() > 16) return;
            EJECUTOR.execute(new Runnable() {
                @Override
                public void run() {
                    try {
                        exec(op, payload);
                    } catch (Throwable ignorado) {
                        // Un registro que no se pudo guardar no es un fallo del usuario.
                    }
                }
            });
        } catch (Throwable ignorado) {
            // La cola jamás puede romper la operación que se estaba haciendo.
        }
    }

    /** ¿El núcleo ya abrió SQLite? Consulta instantánea, sin esperar. */
    @JavascriptInterface
    public String nucleoListo() {
        return "{\"ok\":true,\"listo\":" + (listo.getCount() == 0) + "}";
    }

    /**
     * Radiografía del carril del núcleo: si está listo, cuántas operaciones
     * esperan, cuántas están en vuelo y cuál fue la última lenta. Es lo que
     * permite responder «¿por qué se quedó pegado?» sin adivinar.
     */
    @JavascriptInterface
    public String nucleoEstado() {
        return "{\"ok\":true,\"listo\":" + (listo.getCount() == 0)
                + ",\"cola\":" + cola()
                + ",\"en_vuelo\":" + EN_VUELO.size()
                + ",\"ultimo_lento\":\"" + escapar(ultimoLento) + "\"}";
    }

    /** Bitácora de arranque (independiente del núcleo). Para la vista Diagnóstico. */
    @JavascriptInterface
    public String arranqueBitacora(int maxLineas) {
        return Bitacora.leer(maxLineas);
    }

    @JavascriptInterface
    public String arranqueBitacoraLimpiar() {
        return Bitacora.limpiar();
    }

    private static String recortarBitacora(String s) {
        if (s == null) return "null";
        return s.length() > 160 ? s.substring(0, 160) + "…" : s;
    }

    /**
     * A1: estado de carga de las bibliotecas nativas de llama.cpp.
     * No carga modelos ni infiere; sólo comprueba que el `.so` empaquetado
     * en la APK se puede cargar y que `llama_version()` responde.
     */
    @JavascriptInterface
    public String runtimeInfo() {
        return RuntimeNativo.info();
    }

    /**
     * OCR del inventario. `ocrEstado` dice si hay motor de reconocimiento
     * realmente disponible en el proceso (y con qué motor); `ocr` recibe una
     * data URL y devuelve el texto. Se usa por reflexión (ver OcrNativo) para
     * no mentir cuando el build no lo incluye: la interfaz sólo muestra el
     * botón cuando `disponible` es verdadero.
     */
    @JavascriptInterface
    public String ocrEstado() {
        return OcrNativo.estado();
    }

    @JavascriptInterface
    public String ocr(String dataUrl) {
        return OcrNativo.texto(contexto, dataUrl);
    }

    // ---------------------------------------------------- chat local (A2/A3)

    /** Estado del modelo local; no carga nada por sí solo. */
    @JavascriptInterface
    public String localEstado() {
        return RuntimeNativo.estado();
    }

    @JavascriptInterface
    public String localInfo() {
        return RuntimeNativo.estado();
    }

    /**
     * A2: carga un GGUF que ya está dentro de filesDir. La ruta se canonicaliza
     * y se confina; no se acepta cualquier archivo del teléfono.
     * Devuelve de inmediato y avisa por `window.FabriChat.localCargado`.
     */
    @JavascriptInterface
    public String localCargar(final String ruta, final int nCtx, final int nThreads) {
        final String rutaSegura;
        try {
            rutaSegura = rutaModeloValida(ruta);
        } catch (Throwable t) {
            return error(t.getMessage() == null ? t.toString() : t.getMessage());
        }

        Thread hilo = new Thread(new Runnable() {
            @Override
            public void run() {
                String json;
                try {
                    String dir = contexto.getApplicationInfo().nativeLibraryDir;
                    json = RuntimeNativo.cargar(rutaSegura, nCtx, nThreads, dir);
                } catch (Throwable t) {
                    json = "{\"ok\":false,\"error\":\"" + escapar(t.toString()) + "\"}";
                }
                notificar("window.FabriChat && FabriChat.localCargado(" + json + ");");
            }
        }, "llama-cargar");
        hilo.setDaemon(true);
        hilo.start();

        JSONObject o = new JSONObject();
        try {
            o.put("ok", true);
            o.put("estado", "CARGANDO");
            o.put("ruta", rutaSegura);
        } catch (Throwable t) {
            return error(t.toString());
        }
        return o.toString();
    }

    /**
     * A3: genera una respuesta en segundo plano. El WebView sigue respondiendo
     * mientras llama.cpp trabaja; el resultado llega a `FabriChat.localFin`.
     */
    @JavascriptInterface
    public String localChat(final String prompt, final int maxTokens) {
        if (prompt == null || prompt.trim().isEmpty()) {
            return error("el mensaje está vacío");
        }
        if (prompt.length() > 16000) {
            return error("mensaje demasiado largo (máximo 16000 caracteres)");
        }
        if (!GENERANDO.compareAndSet(false, true)) {
            return error("ya hay una respuesta en curso; deténla antes de enviar otra");
        }
        Thread hilo = new Thread(new Runnable() {
            @Override
            public void run() {
                String json;
                final StringBuilder acumulado = new StringBuilder();
                final long[] ultimo = {0L};
                try {
                    // El texto se entrega token a token; la interfaz lo pinta
                    // mientras llega. Se avisa cada pieza, pero se agrupa hasta 3 tokens
                    // o 20 ms para no saturar el WebView con evaluateJavascript seguidos.
                    json = RuntimeNativo.generarStream(prompt, maxTokens, new RuntimeNativo.Progreso() {
                        @Override
                        public void pieza(byte[] utf8, int tokens) {
                            if (utf8 != null && utf8.length > 0) {
                                acumulado.append(new String(utf8, java.nio.charset.StandardCharsets.UTF_8));
                            }
                            long ahora = System.nanoTime();
                            // Avizar cada pieza, pero agrupar hasta 3 tokens o 20 ms.
                            if (tokens >= 3 || ahora - ultimo[0] >= 20000000L) {
                                ultimo[0] = ahora;
                                avisarPieza(acumulado.toString(), tokens);
                            }
                        }
                    });
                } catch (Throwable t) {
                    json = "{\"ok\":false,\"error\":\"" + escapar(t.toString()) + "\"}";
                } finally {
                    GENERANDO.set(false);
                }
                notificar("window.FabriChat && FabriChat.localFin(" + json + ");");
            }
        }, "llama-generar");
        hilo.setDaemon(true);
        hilo.start();
        return "{\"ok\":true,\"estado\":\"GENERANDO\"}";
    }

    /** Manda a la interfaz lo que va de la respuesta. */
    private void avisarPieza(String texto, int tokens) {
        try {
            JSONObject o = new JSONObject();
            o.put("texto", texto);
            o.put("tokens", tokens);
            notificar("window.FabriChat && FabriChat.localPieza(" + o.toString() + ");");
        } catch (Throwable ignorado) {
            // Un fallo al pintar el parcial no corta la generación.
        }
    }

    /** Corta la respuesta en el siguiente token y deja el texto parcial. */
    @JavascriptInterface
    public String localDetener() {
        return RuntimeNativo.detener();
    }

    /** Ajusta temperatura, top-p, top-k y penalización del próximo turno. */
    @JavascriptInterface
    public String localConfigurar(float temp, float topP, int topK, float repetir, long semilla) {
        return RuntimeNativo.configurar(temp, topP, topK, repetir, semilla);
    }

    /** Tokens ocupados del contexto, para la barra de la cabecera. */
    @JavascriptInterface
    public String localContexto() {
        return RuntimeNativo.contexto();
    }

    /**
     * Memoria disponible del proceso. Sirve para no lanzar una carga que el
     * kernel de Android va a terminar matando por falta de RAM.
     */
    @JavascriptInterface
    public String memoria() {
        try {
            android.app.ActivityManager am = (android.app.ActivityManager)
                    contexto.getSystemService(Context.ACTIVITY_SERVICE);
            android.app.ActivityManager.MemoryInfo mi = new android.app.ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("libre_mb", mi.availMem / (1024L * 1024L));
            o.put("total_mb", mi.totalMem / (1024L * 1024L));
            o.put("bajo", mi.lowMemory);
            return o.toString();
        } catch (Throwable t) {
            return error(t.toString());
        }
    }

    @JavascriptInterface
    public String localLiberar() {
        return RuntimeNativo.liberar();
    }

    /**
     * Lista las descargas que ya están en disco con su recibo verificado.
     * Sirve para que la app no vuelva a pedir algo que ya se bajó: si el
     * recibo existe y el archivo conserva el tamaño, se muestra "verificado".
     * La verdad la da el disco, no la base: así sobrevive a un reinicio o a
     * una base recreada.
     */
    @JavascriptInterface
    public String descargasEstado() {
        JSONArray lista = new JSONArray();
        try {
            File raiz = new File(contexto.getFilesDir(), "componentes");
            File[] carpetas = raiz.listFiles();
            if (carpetas == null) {
                return "{\"ok\":true,\"descargas\":[]}";
            }
            int tope = 0;
            for (File carpeta : carpetas) {
                if (tope++ > 200) {
                    break;
                }
                if (!carpeta.isDirectory()) {
                    continue;
                }
                File[] archivos = carpeta.listFiles();
                if (archivos == null) {
                    continue;
                }
                for (File recibo : archivos) {
                    if (!recibo.isFile() || !recibo.getName().endsWith(".recibo.json")) {
                        continue;
                    }
                    try {
                        String texto = leerArchivo(recibo, 64 * 1024);
                        JSONObject r = new JSONObject(texto);
                        String ruta = r.optString("ruta", "");
                        File destino = new File(ruta);
                        if (!destino.isFile()) {
                            continue;
                        }
                        long bytes = r.optLong("bytes", 0L);
                        if (bytes > 0 && destino.length() != bytes) {
                            // El archivo cambió de tamaño: el recibo ya no vale.
                            continue;
                        }
                        JSONObject o = new JSONObject();
                        o.put("id", carpeta.getName());
                        o.put("archivo", r.optString("archivo", destino.getName()));
                        o.put("ruta", destino.getAbsolutePath());
                        o.put("bytes", destino.length());
                        o.put("sha256", r.optString("sha256_obtenido", ""));
                        o.put("verificado", r.optBoolean("verificado", false));
                        o.put("fecha", destino.lastModified());
                        lista.put(o);
                    } catch (Throwable ignorado) {
                        // Un recibo corrupto no invalida los demás.
                    }
                }
            }
            JSONObject salida = new JSONObject();
            salida.put("ok", true);
            salida.put("descargas", lista);
            return salida.toString();
        } catch (Throwable t) {
            return error(t.toString());
        }
    }

    /** Lee un archivo de texto pequeño con tope de tamaño. */
    private static String leerArchivo(File archivo, int maximo) throws Exception {
        InputStream in = new FileInputStream(archivo);
        try {
            java.io.ByteArrayOutputStream acumulador = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int n;
            while ((n = in.read(buffer)) > 0) {
                acumulador.write(buffer, 0, n);
                if (acumulador.size() > maximo) {
                    break;
                }
            }
            return new String(acumulador.toByteArray(), Charset.forName("UTF-8"));
        } finally {
            try {
                in.close();
            } catch (Throwable ignorado) {
                // Nada que hacer.
            }
        }
    }

    /**
     * Suelta una carga que se quedó colgada dentro de llama.cpp: la interfaz
     * recupera el control de inmediato y el modelo no se publica.
     */
    @JavascriptInterface
    public String localAbandonarCarga() {
        return RuntimeNativo.abandonarCarga();
    }

    // ------------------------------------------- chat remoto OpenAI-compatible

    /** Configuración activa sin devolver la clave a JavaScript. */
    @JavascriptInterface
    public String chatEstado() {
        String url = leerConfig("chat.url");
        String modelo = leerConfig("chat.model");
        String clave = leerConfig("chat.key");
        String proveedor = leerConfig("chat.provider");
        JSONObject o = new JSONObject();
        try {
            o.put("ok", true);
            o.put("url", url);
            o.put("modelo", modelo);
            o.put("proveedor", proveedor);
            o.put("configurado", !url.isEmpty());
            o.put("tieneClave", !clave.isEmpty());
        } catch (Throwable t) {
            return error(t.toString());
        }
        return o.toString();
    }

    @JavascriptInterface
    public String chatGuardar(String url, String clave, String modelo, String proveedor) {
        try {
            String base = normalizarBase(url);
            guardarConfig("chat.url", base);
            if (clave != null && !clave.trim().isEmpty()) {
                guardarConfig("chat.key", clave.trim());
            }
            guardarConfig("chat.model", modelo == null ? "" : modelo.trim());
            guardarConfig("chat.provider", proveedor == null ? "OpenAI-compatible" : proveedor.trim());
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("url", base);
            o.put("modelo", modelo == null ? "" : modelo.trim());
            o.put("proveedor", proveedor == null ? "" : proveedor.trim());
            return o.toString();
        } catch (Throwable t) {
            return error(t.getMessage() == null ? t.toString() : t.getMessage());
        }
    }

    /** Trae /v1/models del proveedor activo en segundo plano. */
    @JavascriptInterface
    public String chatModelos() {
        final String url = leerConfig("chat.url");
        final String clave = leerConfig("chat.key");
        if (url.isEmpty()) {
            return error("configura primero la URL del proveedor y pulsa Guardar");
        }
        Thread hilo = new Thread(new Runnable() {
            @Override
            public void run() {
                JSONObject r = new JSONObject();
                try {
                    String cuerpo = http("GET", url + "/models", clave, null, 10000, 20000);
                    JSONObject o = new JSONObject(cuerpo);
                    JSONArray datos = o.optJSONArray("data");
                    JSONArray salida = new JSONArray();
                    if (datos != null) {
                        for (int i = 0; i < datos.length() && i < 500; i++) {
                            JSONObject m = datos.optJSONObject(i);
                            if (m != null && !m.optString("id", "").isEmpty()) {
                                salida.put(m.optString("id", ""));
                            }
                        }
                    }
                    r.put("ok", true);
                    r.put("modelos", salida);
                    r.put("total", salida.length());
                } catch (Throwable t) {
                    try {
                        r.put("ok", false);
                        r.put("error", t.getMessage() == null ? t.toString() : t.getMessage());
                    } catch (Throwable ignorado) {
                        // sin más.
                    }
                }
                notificar("window.FabriChat && FabriChat.modelos(" + r.toString() + ");");
            }
        }, "chat-modelos");
        hilo.setDaemon(true);
        hilo.start();
        return "{\"ok\":true,\"estado\":\"CONSULTANDO\"}";
    }

    /** Envía un turno al proveedor activo en segundo plano. */
    @JavascriptInterface
    public String chatRemoto(final String prompt, final int maxTokens) {
        final String url = leerConfig("chat.url");
        final String clave = leerConfig("chat.key");
        final String modelo = leerConfig("chat.model");
        if (url.isEmpty()) {
            return error("configura primero la URL del proveedor y pulsa Guardar");
        }
        if (modelo.isEmpty()) {
            return error("falta el modelo; pulsa «Traer modelos» o escríbelo");
        }
        if (prompt == null || prompt.trim().isEmpty()) {
            return error("el mensaje está vacío");
        }
        if (prompt.length() > 12000) {
            return error("mensaje demasiado largo (máximo 12000 caracteres)");
        }
        final int max = maxTokens < 1 ? 384 : Math.min(maxTokens, 1024);

        Thread hilo = new Thread(new Runnable() {
            @Override
            public void run() {
                JSONObject r = new JSONObject();
                try {
                    JSONObject req = new JSONObject();
                    req.put("model", modelo);
                    req.put("max_tokens", max);
                    req.put("temperature", 0.7);
                    JSONArray mensajes = new JSONArray();
                    JSONObject m = new JSONObject();
                    m.put("role", "user");
                    m.put("content", prompt);
                    mensajes.put(m);
                    req.put("messages", mensajes);

                    long t0 = System.currentTimeMillis();
                    String cuerpo = http("POST", url + "/chat/completions", clave, req.toString(), 10000, 180000);
                    long ms = System.currentTimeMillis() - t0;
                    JSONObject o = new JSONObject(cuerpo);
                    JSONArray opciones = o.optJSONArray("choices");
                    if (opciones == null || opciones.length() == 0) {
                        throw new IllegalStateException("respuesta sin 'choices'");
                    }
                    String texto = opciones.getJSONObject(0).getJSONObject("message").optString("content", "");
                    r.put("ok", true);
                    r.put("texto", texto);
                    r.put("modelo", o.optString("model", modelo));
                    r.put("ms", ms);
                    JSONObject uso = o.optJSONObject("usage");
                    if (uso != null) {
                        r.put("uso", uso);
                    }
                } catch (Throwable t) {
                    try {
                        r.put("ok", false);
                        r.put("error", t.getMessage() == null ? t.toString() : t.getMessage());
                    } catch (Throwable ignorado) {
                        // sin más.
                    }
                }
                notificar("window.FabriChat && FabriChat.remoto(" + r.toString() + ");");
            }
        }, "chat-remoto");
        hilo.setDaemon(true);
        hilo.start();
        return "{\"ok\":true,\"estado\":\"ENVIANDO\"}";
    }

    // ---------------------------------------------------------- Termux / enlaces

    /** Abre la app Termux si está instalada. No ejecuta nada por sí sola. */
    @JavascriptInterface
    public String abrirTermux() {
        try {
            Intent i = contexto.getPackageManager().getLaunchIntentForPackage("com.termux");
            if (i == null) {
                return error("Termux no está instalado. Instálalo desde F-Droid: https://f-droid.org/packages/com.termux/");
            }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            contexto.startActivity(i);
            return "{\"ok\":true,\"estado\":\"ABIERTO\"}";
        } catch (Throwable t) {
            return error(t.getMessage() == null ? t.toString() : t.getMessage());
        }
    }

    // ------------------------------------------------ puente real a Termux (loopback)

    /** Comprueba si el puente Python de Termux responde en 127.0.0.1:8787. */
    @JavascriptInterface
    public String termuxEstado() {
        return TermuxPuente.estado(contexto);
    }

    /** Ejecuta un id de la lista blanca del puente. Nunca recibe shell libre. */
    @JavascriptInterface
    public String termuxEjecutar(String id) {
        return TermuxPuente.ejecutar(contexto, id, notificador);
    }

    /**
     * Shell libre para la consola de la app. Va al puente de loopback, que
     * exige token, limita tiempo y salida, y registra el comando. Es el
     * teléfono del propio usuario: la consola es su terminal.
     */
    @JavascriptInterface
    public String termuxComando(String texto) {
        return TermuxPuente.comando(contexto, texto, notificador);
    }

    /** Devuelve el instalador de una línea (base64) y lo copia al portapapeles. */
    @JavascriptInterface
    public String termuxInstalar() {
        return TermuxPuente.instalar(contexto);
    }

    /** Catálogo de comandos que la interfaz puede ofrecer. */
    @JavascriptInterface
    public String termuxCatalogo() {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", true);
            o.put("comandos", TermuxPuente.catalogo());
        } catch (Throwable t) {
            return error(t.toString());
        }
        return o.toString();
    }

    /** Copia texto al portapapeles (WebView en file:// no tiene clipboard API). */
    @JavascriptInterface
    public String copiar(String texto) {
        return TermuxPuente.copiarTexto(contexto, texto);
    }

    // ------------------------------------------------- impresión de documentos

    /**
     * Abre el diálogo de impresión del sistema con un HTML ya renderizado.
     *
     * <p>Se usa para boletas y facturas: el documento se compone en JavaScript
     * (mismos datos que ve el usuario) y aquí sólo se manda a imprimir. El
     * WebView que imprime es uno aparte, fuera de pantalla, para no arrastrar
     * la interfaz de la app al papel.
     *
     * @param html    documento completo (con su propio CSS de impresión)
     * @param formato "80mm" (rollo térmico, por defecto), "58mm" o "a4"
     */
    @JavascriptInterface
    public String imprimir(String html, String formato) {
        final Activity act = actividad();
        if (act == null) {
            return error("la impresión necesita la app abierta");
        }
        if (html == null || html.trim().isEmpty()) {
            return error("no hay contenido para imprimir");
        }
        final String doc = html;
        final String cual = formato == null ? "80mm" : formato.trim().toLowerCase(Locale.US);
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    final android.webkit.WebView hoja = new android.webkit.WebView(act);
                    hoja.getSettings().setJavaScriptEnabled(false);
                    hoja.getSettings().setBlockNetworkLoads(true);
                    hoja.setWebViewClient(new android.webkit.WebViewClient() {
                        @Override
                        public void onPageFinished(android.webkit.WebView vista, String url) {
                            try {
                                android.print.PrintManager pm = (android.print.PrintManager)
                                        act.getSystemService(Context.PRINT_SERVICE);
                                if (pm == null) {
                                    Bitacora.anotar("impresion", "el sistema no tiene servicio de impresión");
                                    return;
                                }
                                android.print.PrintAttributes attrs = atributosImpresion(cual);
                                String trabajo = "FORGE CORE STOCK boleta";
                                android.print.PrintDocumentAdapter adaptador =
                                        vista.createPrintDocumentAdapter(trabajo);
                                pm.print(trabajo, adaptador, attrs);
                                Bitacora.anotar("impresion", "diálogo abierto · " + cual);
                            } catch (Throwable t) {
                                Bitacora.anotar("impresion", "no se pudo abrir el diálogo: " + t);
                            }
                        }
                    });
                    hoja.loadDataWithBaseURL("https://fabrick.local/",
                            doc, "text/html", "utf-8", null);
                } catch (Throwable t) {
                    Bitacora.anotar("impresion", "no se pudo preparar la hoja: " + t);
                }
            }
        });
        return "{\"ok\":true,\"estado\":\"ABRIENDO\",\"formato\":\"" + escapar(cual) + "\"}";
    }

    /** Tamaño de papel: rollo térmico de 80/58 mm o A4. */
    private static android.print.PrintAttributes atributosImpresion(String formato) {
        android.print.PrintAttributes.Builder b = new android.print.PrintAttributes.Builder();
        if ("a4".equals(formato)) {
            b.setMediaSize(android.print.PrintAttributes.MediaSize.ISO_A4);
        } else {
            // 1 pulgada = 1000 milésimas. El alto es un rollo largo: el
            // controlador recorta al final del contenido.
            int ancho = "58mm".equals(formato) ? 2283 : 3150;
            b.setMediaSize(new android.print.PrintAttributes.MediaSize(
                    "rollo-" + ancho, formato, ancho, 11000));
            b.setMinMargins(android.print.PrintAttributes.Margins.NO_MARGINS);
        }
        return b.build();
    }

    // ------------------------------------------------- impresora térmica WiFi

    /** IP local del teléfono, para configurar impresora y lector. */
    @JavascriptInterface
    public String ipLocal() {
        try {
            JSONObject r = new JSONObject();
            r.put("ok", true);
            r.put("ip", Red.ipLocal());
            r.put("impresora_puerto", ImpresoraWifi.PUERTO_ESTANDAR);
            r.put("lector_puerto", 9101);
            return r.toString();
        } catch (Throwable t) {
            return error(mensaje(t));
        }
    }

    /**
     * Manda un ticket ESC/POS ya armado (base64) a la impresora por TCP.
     * Es síncrono a propósito: el trabajo pesa pocos KB y así la interfaz
     * recibe el resultado real (bytes, milisegundos o el error de red).
     */
    @JavascriptInterface
    public String imprimirWifi(String host, int puerto, String base64, int timeoutMs) {
        try {
            if (base64 == null || base64.trim().isEmpty()) {
                return error("el ticket está vacío");
            }
            if (base64.length() > 700000) {
                return error("el ticket es demasiado grande");
            }
            byte[] datos = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
            JSONObject r = ImpresoraWifi.enviar(host, puerto, datos, timeoutMs);
            return r.toString();
        } catch (Throwable t) {
            return error("no se pudo preparar el ticket: " + mensaje(t));
        }
    }

    /** Prueba de conexión real contra la impresora (sin imprimir). */
    @JavascriptInterface
    public String probarImpresora(String host, int puerto, int timeoutMs) {
        try {
            return ImpresoraWifi.probar(host, puerto, timeoutMs).toString();
        } catch (Throwable t) {
            return error(mensaje(t));
        }
    }

    /** Barrido de la /24 en segundo plano; avisa por FabriImpresora.descubiertas. */
    @JavascriptInterface
    public String buscarImpresoras(final int timeoutMs) {
        Thread hilo = new Thread(new Runnable() {
            @Override
            public void run() {
                JSONObject r = ImpresoraWifi.descubrir(timeoutMs);
                notificar("window.FabriImpresora && FabriImpresora.descubiertas("
                        + r.toString() + ");");
            }
        }, "buscar-impresoras");
        hilo.setDaemon(true);
        hilo.start();
        return "{\"ok\":true,\"estado\":\"BUSCANDO\"}";
    }

    // --------------------------------------------------- lector de red (HBAPO)

    private LectorRed.Oyente oyenteLector() {
        return new LectorRed.Oyente() {
            @Override
            public void linea(String codigo, String origen, String ip, int puerto,
                              int bytes, String hex) {
                try {
                    JSONObject o = new JSONObject();
                    o.put("codigo", codigo);
                    o.put("origen", origen);
                    o.put("ip", ip == null ? "" : ip);
                    o.put("puerto", puerto);
                    o.put("bytes", bytes);
                    o.put("hex", hex == null ? "" : hex);
                    o.put("ts", System.currentTimeMillis());
                    notificar("window.FabriLector && FabriLector.linea(" + o.toString() + ");");
                } catch (Throwable t) {
                    Bitacora.anotar("lector", "no se pudo emitir a JS: " + mensaje(t));
                }
            }
        };
    }

    @JavascriptInterface
    public String lectorIniciar(String modo, String host, int puerto) {
        try {
            String m = modo == null ? "servidor" : modo.trim().toLowerCase(Locale.US);
            if ("cliente".equals(m)) {
                return LectorRed.conectar(host, puerto, oyenteLector()).toString();
            }
            return LectorRed.iniciarServidor(puerto, oyenteLector()).toString();
        } catch (Throwable t) {
            return error(mensaje(t));
        }
    }

    @JavascriptInterface
    public String lectorDetener(String modo) {
        try {
            String m = modo == null ? "" : modo.trim().toLowerCase(Locale.US);
            if ("cliente".equals(m)) {
                return LectorRed.desconectar().toString();
            }
            if ("todo".equals(m)) {
                LectorRed.desconectar();
            }
            return LectorRed.detenerServidor().toString();
        } catch (Throwable t) {
            return error(mensaje(t));
        }
    }

    @JavascriptInterface
    public String lectorEstado() {
        try {
            return LectorRed.estado().toString();
        } catch (Throwable t) {
            return error(mensaje(t));
        }
    }

    // ------------------------------------------- importación desde la SD/Excel

    /** Abre el selector nativo (SAF) para elegir .db/.sqlite/.xlsx/.csv/.json. */
    @JavascriptInterface
    public String elegirBase() {
        Activity act = actividad();
        if (!(act instanceof MainActivity)) {
            return error("el selector necesita la app abierta");
        }
        ((MainActivity) act).pedirBaseDatos();
        return "{\"ok\":true,\"estado\":\"ESPERANDO\"}";
    }

    /** MainActivity entrega la URI elegida; se inspecciona fuera del hilo de UI. */
    void importarDesdeUri(final Uri uri) {
        Thread hilo = new Thread(new Runnable() {
            @Override
            public void run() {
                JSONObject r;
                try {
                    r = ImportadorBase.inspeccionar(contexto, uri);
                } catch (Throwable t) {
                    r = new JSONObject();
                    try {
                        r.put("ok", false);
                        r.put("error", mensaje(t));
                    } catch (Throwable ignorado) {
                        // sin más.
                    }
                }
                notificar("window.FabriImportar && FabriImportar.base(" + r.toString() + ");");
            }
        }, "importar-base");
        hilo.setDaemon(true);
        hilo.start();
    }

    void importarCancelado() {
        notificar("window.FabriImportar && FabriImportar.cancelado();");
    }

    @JavascriptInterface
    public String leerTablaBase(String tabla, int limite, int offset) {
        try {
            return ImportadorBase.leerTabla(tabla, limite, offset).toString();
        } catch (Throwable t) {
            return error(mensaje(t));
        }
    }

    @JavascriptInterface
    public String cerrarBase() {
        try {
            ImportadorBase.cerrar();
            return "{\"ok\":true}";
        } catch (Throwable t) {
            return error(mensaje(t));
        }
    }


    // ------------------------------------------------------ diagnóstico de red

    /** Prueba IPv4/IPv6 reales contra Hugging Face, OpenAI y GitHub. */
    @JavascriptInterface
    public String redDiagnostico() {
        return Red.diagnostico(notificador);
    }

    // -------------------------------------------------------- acceso con huella

    @JavascriptInterface
    public String huellaEstado() {
        return Huella.estado(contexto);
    }

    @JavascriptInterface
    public String huellaConfigurarPin(String pin) {
        return Huella.configurarPin(contexto, pin);
    }

    @JavascriptInterface
    public String huellaVerificarPin(String pin) {
        return Huella.verificarPin(contexto, pin);
    }

    /**
     * Verifica el PIN contra el verificador guardado en la tabla `usuarios`
     * (PBKDF2, sal y algoritmo incluidos). Mantiene el mismo bloqueo por
     * intentos que el PIN de las preferencias.
     */
    @JavascriptInterface
    public String huellaVerificarPinExterno(String pin, String algoritmo, String sal, String hash) {
        return Huella.verificarPinExterno(contexto, pin, algoritmo, sal, hash);
    }

    @JavascriptInterface
    public String huellaActivar() {
        Activity a = actividad();
        if (a == null) {
            return error("la huella necesita una actividad en primer plano");
        }
        return Huella.activar(a, notificador);
    }

    @JavascriptInterface
    public String huellaAutenticar() {
        Activity a = actividad();
        if (a == null) {
            return error("la huella necesita una actividad en primer plano");
        }
        return Huella.autenticar(a, notificador);
    }

    @JavascriptInterface
    public String huellaBloquear() {
        return Huella.bloquear();
    }

    @JavascriptInterface
    public String huellaBorrar() {
        return Huella.borrar(contexto);
    }

    /** Desactiva la huella y conserva el PIN (a diferencia de huellaBorrar). */
    @JavascriptInterface
    public String huellaDesactivar() {
        return Huella.desactivar(contexto);
    }

    @JavascriptInterface
    public String huellaSesion() {
        return Huella.sesion();
    }

    private Activity actividad() {
        return contexto instanceof Activity ? (Activity) contexto : null;
    }

    /** Abre un enlace externo en el navegador; sólo http(s). */
    @JavascriptInterface
    public String abrirUrl(String url) {
        try {
            URI uri = URI.create(url == null ? "" : url.trim());
            String esquema = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
            if (!"https".equals(esquema) && !"http".equals(esquema)) {
                return error("sólo se abren enlaces http(s)");
            }
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(uri.toString()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            contexto.startActivity(i);
            return "{\"ok\":true,\"estado\":\"ABIERTO\"}";
        } catch (Throwable t) {
            return error("no se pudo abrir el enlace: " + (t.getMessage() == null ? t.toString() : t.getMessage()));
        }
    }

    @JavascriptInterface
    public String repoEstado() {
        String url = leerConfig("repo.url");
        JSONObject o = new JSONObject();
        try {
            o.put("ok", true);
            o.put("url", url);
            o.put("configurado", !url.isEmpty());
        } catch (Throwable t) {
            return error(t.toString());
        }
        return o.toString();
    }

    @JavascriptInterface
    public String repoGuardar(String url) {
        try {
            String limpia = url == null ? "" : url.trim();
            URI uri = URI.create(limpia);
            String esquema = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
            if (!"https".equals(esquema)) {
                return error("el repositorio debe ser una URL https://");
            }
            guardarConfig("repo.url", limpia);
            return "{\"ok\":true,\"url\":\"" + escapar(limpia) + "\"}";
        } catch (Throwable t) {
            return error("URL de repositorio inválida");
        }
    }

    @JavascriptInterface
    public String repoAbrir() {
        String url = leerConfig("repo.url");
        if (url.isEmpty()) {
            return error("todavía no hay URL de repositorio configurada");
        }
        return abrirUrl(url);
    }

    /**
     * Abre el instalador del sistema para una APK ya descargada y verificada.
     * No instala en silencio: Android muestra su propia confirmación y verifica
     * la firma. El archivo se copia a una ruta fija que expone ApkProvider.
     */
    @JavascriptInterface
    public String instalarApk(String ruta) {
        try {
            File origen = new File(ruta == null ? "" : ruta).getCanonicalFile();
            File base = contexto.getFilesDir().getCanonicalFile();
            String prefijo = base.getAbsolutePath() + File.separator;
            if (!origen.getAbsolutePath().startsWith(prefijo)) {
                return error("la APK debe estar dentro de filesDir");
            }
            if (!origen.isFile() || !origen.getName().toLowerCase(Locale.US).endsWith(".apk")) {
                return error("no hay una APK válida en esa ruta");
            }
            if (origen.length() < 1024L * 1024L) {
                return error("la APK es demasiado pequeña");
            }

            File dir = new File(contexto.getFilesDir(), "actualizaciones");
            if (!dir.exists() && !dir.mkdirs()) {
                return error("no se pudo crear el directorio de actualizaciones");
            }
            File destino = new File(dir, "update.apk");
            if (!origen.getAbsolutePath().equals(destino.getAbsolutePath())) {
                copiarArchivo(origen, destino);
            }

            Uri uri = Uri.parse("content://" + ApkProvider.AUTHORITY + "/update.apk");
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            contexto.startActivity(i);

            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("estado", "INSTALADOR_ABIERTO");
            o.put("ruta", destino.getAbsolutePath());
            return o.toString();
        } catch (Throwable t) {
            return error("no se pudo abrir el instalador: "
                    + (t.getMessage() == null ? t.toString() : t.getMessage()));
        }
    }

    // ------------------------------------------------------------------- TTS

    private void iniciarTts() {
        try {
            tts = new TextToSpeech(contexto, new TextToSpeech.OnInitListener() {
                @Override
                public void onInit(int estado) {
                    if (estado != TextToSpeech.SUCCESS) {
                        ttsListo = false;
                        ttsError = "el motor TTS del sistema no inicializó (código " + estado + ")";
                        return;
                    }
                    try {
                        int lang = tts.setLanguage(new Locale("es", "CL"));
                        if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
                            lang = tts.setLanguage(Locale.getDefault());
                        }
                        if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
                            ttsListo = false;
                            ttsError = "no hay una voz instalada para español; instala una voz en Ajustes de Android";
                        } else {
                            // Ritmo chileno: un poco más rápido y con el tono apenas
                            // más grave para quitarle el aire metálico al TTS.
                            tts.setSpeechRate(1.2f);
                            tts.setPitch(0.95f);
                            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                                @Override
                                public void onStart(String id) {
                                    notificar("window.FabriTts && window.FabriTts.estado('talking')");
                                }

                                @Override
                                public void onDone(String id) {
                                    notificar("window.FabriTts && window.FabriTts.estado('idle')");
                                }

                                @Override
                                public void onError(String id) {
                                    notificar("window.FabriTts && window.FabriTts.estado('idle')");
                                }
                            });
                            ttsListo = true;
                            ttsError = "";
                        }
                    } catch (Throwable t) {
                        ttsListo = false;
                        ttsError = t.toString();
                    }
                }
            });
        } catch (Throwable t) {
            tts = null;
            ttsListo = false;
            ttsError = t.toString();
        }
    }

    @JavascriptInterface
    public String ttsEstado() {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", ttsListo);
            o.put("listo", ttsListo);
            o.put("error", ttsError);
        } catch (Throwable t) {
            return error(t.toString());
        }
        return o.toString();
    }

    @JavascriptInterface
    public String ttsHablar(String texto) {
        if (texto == null || texto.trim().isEmpty()) {
            return error("no hay texto para leer");
        }
        if (!ttsListo || tts == null) {
            return error(ttsError.isEmpty() ? "TTS no está listo" : ttsError);
        }
        try {
            String recorte = texto.length() > 4000 ? texto.substring(0, 4000) : texto;
            int rc = tts.speak(recorte, TextToSpeech.QUEUE_FLUSH, null, "fabrick-tts");
            return rc == TextToSpeech.SUCCESS
                    ? "{\"ok\":true,\"estado\":\"HABLANDO\"}"
                    : error("el motor TTS rechazó el texto (código " + rc + ")");
        } catch (Throwable t) {
            return error(t.toString());
        }
    }

    @JavascriptInterface
    public String ttsDetener() {
        try {
            if (tts != null) {
                tts.stop();
            }
            notificar("window.FabriTts && window.FabriTts.estado('idle')");
            return "{\"ok\":true,\"estado\":\"DETENIDO\"}";
        } catch (Throwable t) {
            return error(t.toString());
        }
    }

    /**
     * Abre los ajustes de voz del sistema para instalar o cambiar el motor TTS.
     * No descarga nada por sí sola: Android muestra las voces disponibles.
     */
    @JavascriptInterface
    public String abrirAjustesTts() {
        try {
            Intent i = new Intent("com.android.settings.TTS_SETTINGS");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            contexto.startActivity(i);
            return "{\"ok\":true,\"estado\":\"AJUSTES_TTS\"}";
        } catch (Throwable t) {
            try {
                Intent i = new Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                contexto.startActivity(i);
                return "{\"ok\":true,\"estado\":\"AJUSTES_ACCESIBILIDAD\"}";
            } catch (Throwable t2) {
                return error("no se pudieron abrir los ajustes de voz: "
                        + (t2.getMessage() == null ? t2.toString() : t2.getMessage()));
            }
        }
    }

    /** Valida que el GGUF esté dentro de filesDir y tenga un tamaño plausible. */
    private String rutaModeloValida(String ruta) throws Exception {
        if (ruta == null || ruta.trim().isEmpty()) {
            throw new IllegalArgumentException("ruta de modelo vacía");
        }
        File f = new File(ruta).getCanonicalFile();
        File base = contexto.getFilesDir().getCanonicalFile();
        String prefijo = base.getAbsolutePath() + File.separator;
        if (!f.getAbsolutePath().startsWith(prefijo)) {
            throw new IllegalArgumentException("el modelo debe estar dentro de filesDir");
        }
        if (!f.isFile()) {
            throw new IllegalArgumentException("el archivo del modelo no existe");
        }
        if (!f.getName().toLowerCase(Locale.US).endsWith(".gguf")) {
            throw new IllegalArgumentException("el modelo debe ser un archivo .gguf");
        }
        if (f.length() < 1024L * 1024L) {
            throw new IllegalArgumentException("el archivo es demasiado pequeño para ser un GGUF");
        }
        if (esEmbeddings(f.getAbsolutePath())) {
            // Un GGUF de embeddings no genera texto: llama.cpp devolvería 0
            // tokens y la app parecería colgada. Se rechaza en el origen.
            throw new IllegalArgumentException("MODELO_EMBEDDINGS: ese GGUF vectoriza "
                    + "texto y no conversa; elige un modelo de chat (SmolLM2, Qwen)");
        }
        return f.getAbsolutePath();
    }

    /** Modelos de embeddings por nombre o por la carpeta donde los guarda la app. */
    private static boolean esEmbeddings(String ruta) {
        String r = ruta.toLowerCase(Locale.US).replace('\\', '/');
        if (r.contains("/embeddings/")) return true;
        String base = r.substring(r.lastIndexOf('/') + 1);
        String[] marcas = {"embed", "bge", "minilm", "e5-", "gte-", "arctic", "nomic", "jina", "voyage", "sentence"};
        for (int i = 0; i < marcas.length; i++) {
            if (base.contains(marcas[i])) return true;
        }
        return false;
    }

    // ------------------------------------------------------------- descargas

    /**
     * Inicia una descarga verificada en segundo plano.
     * Devuelve de inmediato; el resultado llega a `window.FabriDescarga.fin`.
     */
    @JavascriptInterface
    public String descargar(final String id, final String url, final String sha256,
                            final long tamano, final boolean autorizado) {
        if (!idValido(id)) {
            return error("id inválido: sólo minúsculas, dígitos, '-', '_' y '.'");
        }
        if (!Descargador.urlPermitida(url == null ? "" : url)) {
            return error("URL no permitida: se exige https://");
        }
        if (!Descargador.sha256Valido(sha256)) {
            return error("sha256 inválido");
        }
        if (tamano <= 0) {
            return error("tamaño inválido");
        }
        if (tamano > Descargador.LIMITE_SIN_AUTORIZACION && !autorizado) {
            return error("el archivo supera 50 MiB y falta autorización explícita");
        }
        if (controles.containsKey(id)) {
            return error("ya hay una descarga en curso para " + id);
        }

        String nombre = nombreDeArchivo(url);
        if (nombre == null) {
            return error("no se pudo derivar el nombre del archivo desde la URL");
        }

        final File directorio = new File(contexto.getFilesDir(), "componentes/" + id);
        final File destino = new File(directorio, nombre);
        final Descargador.Control control = new Descargador.Control();
        controles.put(id, control);

        notificar("window.FabriDescarga && FabriDescarga.inicio(" + cadena(id) + ")");

        Thread hilo = new Thread(new Runnable() {
            @Override
            public void run() {
                Descargador.Progreso progreso = new Descargador.Progreso() {
                    @Override
                    public void avance(long hechos, long total) {
                        notificar("window.FabriDescarga && FabriDescarga.avance("
                                + cadena(id) + "," + hechos + "," + total + ")");
                    }
                };
                Descargador.Resultado r = Descargador.descargar(
                        url, destino.getAbsolutePath(), tamano, sha256, autorizado, 2, progreso, control);
                controles.remove(id);
                notificar("window.FabriDescarga && FabriDescarga.fin(" + cadena(id) + "," + r.toString() + ")");
            }
        }, "descarga-" + id);
        hilo.setDaemon(true);
        hilo.start();

        return "{\"ok\":true,\"estado\":\"INICIADO\",\"id\":\"" + escapar(id)
                + "\",\"destino\":\"" + escapar(destino.getAbsolutePath()) + "\"}";
    }

    /** Cancela una descarga en curso. */
    @JavascriptInterface
    public String cancelar(String id) {
        Descargador.Control c = controles.get(id);
        if (c == null) {
            return "{\"ok\":false,\"error\":\"no hay descarga en curso para ese id\"}";
        }
        c.cancelar();
        return "{\"ok\":true,\"estado\":\"CANCELANDO\"}";
    }

    // --------------------------------------------------------------- T0 / W^X

    /**
     * T0: comprueba si Android permite ejecutar un binario copiado al directorio
     * privado de la app. Ruta y binario son fijos: no acepta entrada del usuario.
     * No es una función de producto; es una sonda de diagnóstico.
     */
    @JavascriptInterface
    public String t0() {
        File dir = new File(contexto.getFilesDir(), "prueba");
        File copia = new File(dir, "echo");
        String origen = "/system/bin/echo";
        try {
            if (!dir.exists() && !dir.mkdirs()) {
                return "{\"ok\":false,\"error\":\"no se pudo crear " + escapar(dir.getAbsolutePath()) + "\"}";
            }
            copiarArchivo(new File(origen), copia);
            boolean marcado = copia.setExecutable(true, true);
            Process p = new ProcessBuilder(copia.getAbsolutePath(), "t0-ok")
                    .redirectErrorStream(true).start();
            BufferedReader lector = new BufferedReader(new InputStreamReader(p.getInputStream()));
            String salida = lector.readLine();
            int codigo = p.waitFor();
            lector.close();
            copia.delete();
            return "{\"ok\":true,\"prueba\":\"filesDir\",\"ruta\":\"" + escapar(copia.getAbsolutePath())
                    + "\",\"chmod\":true,\"exec_ok\":true,\"salida\":\"" + escapar(salida == null ? "" : salida)
                    + "\",\"codigoSalida\":" + codigo
                    + ",\"conclusion\":\"Android 16 permite ejecutar binarios desde filesDir en esta app\"}";
        } catch (Throwable t) {
            copia.delete();
            return "{\"ok\":false,\"prueba\":\"filesDir\",\"ruta\":\"" + escapar(copia.getAbsolutePath())
                    + "\",\"exec_ok\":false,\"error\":\"" + escapar(t.toString())
                    + "\",\"conclusion\":\"exec bloqueado o fallido: por esto la instalación de binarios queda pendiente\"}";
        }
    }

    // ------------------------------------------------------------- OmniRoute
    //
    // OmniRoute es un gateway OpenAI-compatible escrito en Node/Next. NO se
    // ejecuta dentro de la APK (pesa cientos de MB y necesita un servidor
    // Node); se auto-aloja en Termux o en un servidor remoto. La app sólo es
    // cliente: guarda URL/clave/modelo, comprueba /v1/models y envía un chat.

    /** Devuelve la configuración SIN la clave (nunca vuelve a JavaScript). */
    @JavascriptInterface
    public String omniEstado() {
        String url = leerConfig("omniroute.url");
        String modelo = leerConfig("omniroute.model");
        String clave = leerConfig("omniroute.key");
        JSONObject o = new JSONObject();
        try {
            o.put("ok", true);
            o.put("url", url);
            o.put("modelo", modelo.isEmpty() ? "auto" : modelo);
            o.put("configurado", !url.isEmpty());
            o.put("tieneClave", !clave.isEmpty());
        } catch (Throwable t) {
            return error(t.toString());
        }
        return o.toString();
    }

    @JavascriptInterface
    public String omniGuardar(String url, String clave, String modelo) {
        try {
            String base = normalizarBase(url);
            guardarConfig("omniroute.url", base);
            if (clave != null && !clave.trim().isEmpty()) {
                guardarConfig("omniroute.key", clave.trim());
            }
            guardarConfig("omniroute.model", modelo == null || modelo.trim().isEmpty() ? "auto" : modelo.trim());
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("url", base);
            return o.toString();
        } catch (Throwable t) {
            return error(t.getMessage() == null ? t.toString() : t.getMessage());
        }
    }

    @JavascriptInterface
    public String omniProbar() {
        return omniLanzar("probar", null);
    }

    @JavascriptInterface
    public String omniChat(String prompt) {
        return omniLanzar("chat", prompt);
    }

    /** Lanza la llamada en segundo plano y responde por `window.FabriOmni`. */
    private String omniLanzar(final String modo, final String prompt) {
        final String url = leerConfig("omniroute.url");
        if (url.isEmpty()) {
            return error("configura primero la URL de OmniRoute y pulsa Guardar");
        }
        if ("chat".equals(modo) && (prompt == null || prompt.trim().isEmpty())) {
            return error("el prompt está vacío");
        }
        if ("chat".equals(modo) && prompt.length() > 4000) {
            return error("prompt demasiado largo (máximo 4000 caracteres)");
        }
        final String clave = leerConfig("omniroute.key");
        final String modelo = leerConfig("omniroute.model").isEmpty() ? "auto" : leerConfig("omniroute.model");

        Thread hilo = new Thread(new Runnable() {
            @Override
            public void run() {
                JSONObject r = new JSONObject();
                try {
                    if ("probar".equals(modo)) {
                        String cuerpo = http("GET", url + "/models", clave, null, 8000, 15000);
                        JSONObject o = new JSONObject(cuerpo);
                        JSONArray datos = o.optJSONArray("data");
                        int n = datos == null ? 0 : datos.length();
                        StringBuilder muestra = new StringBuilder();
                        for (int i = 0; i < n && i < 5; i++) {
                            JSONObject m = datos.optJSONObject(i);
                            if (m != null && m.optString("id", "").length() > 0) {
                                if (muestra.length() > 0) {
                                    muestra.append(", ");
                                }
                                muestra.append(m.optString("id", ""));
                            }
                        }
                        r.put("ok", true);
                        r.put("modelos", n);
                        r.put("muestra", muestra.toString());
                    } else {
                        JSONObject req = new JSONObject();
                        req.put("model", modelo);
                        req.put("max_tokens", 256);
                        req.put("temperature", 0.7);
                        JSONArray mensajes = new JSONArray();
                        JSONObject m = new JSONObject();
                        m.put("role", "user");
                        m.put("content", prompt);
                        mensajes.put(m);
                        req.put("messages", mensajes);

                        long t0 = System.currentTimeMillis();
                        String cuerpo = http("POST", url + "/chat/completions", clave, req.toString(), 8000, 120000);
                        long ms = System.currentTimeMillis() - t0;
                        JSONObject o = new JSONObject(cuerpo);
                        JSONArray opciones = o.optJSONArray("choices");
                        if (opciones == null || opciones.length() == 0) {
                            throw new IllegalStateException("respuesta sin 'choices'");
                        }
                        String texto = opciones.getJSONObject(0).getJSONObject("message").optString("content", "");
                        r.put("ok", true);
                        r.put("texto", texto);
                        r.put("modelo", o.optString("model", modelo));
                        r.put("ms", ms);
                    }
                } catch (Throwable t) {
                    try {
                        r.put("ok", false);
                        r.put("error", t.getMessage() == null ? t.toString() : t.getMessage());
                    } catch (Throwable ignorado) {
                        // si ni siquiera se puede armar el error, se avisa abajo
                    }
                }
                eventoOmni(modo, r);
            }
        }, "omni-" + modo);
        hilo.start();

        JSONObject o = new JSONObject();
        try {
            o.put("ok", true);
            o.put("iniciado", true);
        } catch (Throwable t) {
            return error(t.toString());
        }
        return o.toString();
    }

    private void eventoOmni(String modo, JSONObject datos) {
        notificar("window.FabriOmni && window.FabriOmni.evento(\""
                + escapar(modo) + "\"," + datos.toString() + ");");
    }

    private String leerConfig(String clave) {
        // Si el núcleo todavía no abrió SQLite, no se espera: devolver vacío es
        // instantáneo y la interfaz se repinta cuando el núcleo avisa que está
        // listo. Antes cada lectura esperaba hasta 10 s y `chatEstado()` hace
        // cuatro seguidas: medio minuto de pantalla congelada en el arranque.
        if (listo.getCount() != 0) {
            return "";
        }
        try {
            String crudo = call("config", "{\"accion\":\"leer\",\"clave\":\"" + escapar(clave) + "\"}");
            JSONObject o = new JSONObject(crudo);
            if (!o.optBoolean("ok", false)) {
                return "";
            }
            JSONObject d = o.optJSONObject("data");
            if (d == null) {
                return "";
            }
            Object v = d.opt("valor");
            return v == null || v == JSONObject.NULL ? "" : String.valueOf(v);
        } catch (Throwable t) {
            return "";
        }
    }

    private void guardarConfig(String clave, String valor) throws Exception {
        String crudo = call("config", "{\"accion\":\"escribir\",\"clave\":\"" + escapar(clave)
                + "\",\"valor\":\"" + escapar(valor) + "\"}");
        JSONObject o = new JSONObject(crudo);
        if (!o.optBoolean("ok", false)) {
            throw new IllegalStateException(o.optString("error", "no se pudo guardar la configuración"));
        }
    }

    /**
     * https:// en cualquier host; http:// sólo en loopback o en una IPv4
     * privada (LAN: 10/8, 172.16/12, 192.168/16). El código restringe el
     * cleartext aunque el manifiesto de red lo permita: no se acepta HTTP a
     * Internet abierto.
     */
    private static String normalizarBase(String crudo) {
        if (crudo == null || crudo.trim().isEmpty()) {
            throw new IllegalArgumentException("URL vacía");
        }
        String u = crudo.trim();
        while (u.endsWith("/")) {
            u = u.substring(0, u.length() - 1);
        }
        if (u.endsWith("/chat/completions")) {
            u = u.substring(0, u.length() - "/chat/completions".length());
        }
        if (u.endsWith("/models")) {
            u = u.substring(0, u.length() - "/models".length());
        }
        if (!u.endsWith("/v1")) {
            u = u + "/v1";
        }

        URI uri;
        try {
            uri = URI.create(u);
        } catch (Throwable t) {
            throw new IllegalArgumentException("URL inválida");
        }
        String esquema = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
        boolean loopback = "127.0.0.1".equals(host) || "localhost".equals(host)
                || "[::1]".equals(host) || "::1".equals(host);
        if ("https".equals(esquema)) {
            return u;
        }
        if ("http".equals(esquema) && (loopback || esIpPrivada(host))) {
            return u;
        }
        throw new IllegalArgumentException(
                "sólo https:// o http:// en localhost o una IP privada (10.x, 172.16-31.x, 192.168.x)");
    }

    /** IPv4 privada según RFC 1918; también acepta el host del emulador. */
    private static boolean esIpPrivada(String host) {
        if (host == null || host.isEmpty()) {
            return false;
        }
        if ("10.0.2.2".equals(host)) {
            return true;
        }
        String[] partes = host.split("\\.");
        if (partes.length != 4) {
            return false;
        }
        int a, b;
        try {
            a = Integer.parseInt(partes[0]);
            b = Integer.parseInt(partes[1]);
        } catch (Throwable t) {
            return false;
        }
        if (a == 10) return true;
        if (a == 192 && b == 168) return true;
        return a == 172 && b >= 16 && b <= 31;
    }

    private static String http(String metodo, String endpoint, String clave,
                               String cuerpo, int conectarMs, int leerMs) throws Exception {
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL(endpoint).openConnection();
            con.setRequestMethod(metodo);
            con.setConnectTimeout(conectarMs);
            con.setReadTimeout(leerMs);
            con.setRequestProperty("Accept", "application/json");
            con.setRequestProperty("User-Agent", "FORGE CORE STOCK/0.9.0 (Android)");
            if (clave != null && !clave.isEmpty()) {
                con.setRequestProperty("Authorization", "Bearer " + clave);
            }
            if (cuerpo != null) {
                byte[] bytes = cuerpo.getBytes(Charset.forName("UTF-8"));
                con.setDoOutput(true);
                con.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                con.setFixedLengthStreamingMode(bytes.length);
                OutputStream salida = con.getOutputStream();
                salida.write(bytes);
                salida.flush();
                salida.close();
            }

            int codigo = con.getResponseCode();
            InputStream flujo = codigo >= 200 && codigo < 300 ? con.getInputStream() : con.getErrorStream();
            String texto = leerFlujo(flujo);
            if (codigo < 200 || codigo >= 300) {
                String recorte = texto.length() > 300 ? texto.substring(0, 300) : texto;
                throw new IllegalStateException("HTTP " + codigo + ": " + recorte);
            }
            return texto;
        } finally {
            if (con != null) {
                con.disconnect();
            }
        }
    }

    private static String leerFlujo(InputStream flujo) throws Exception {
        if (flujo == null) {
            return "";
        }
        BufferedReader lector = new BufferedReader(new InputStreamReader(flujo, Charset.forName("UTF-8")));
        StringBuilder sb = new StringBuilder();
        String linea;
        while ((linea = lector.readLine()) != null) {
            sb.append(linea).append('\n');
        }
        lector.close();
        return sb.toString();
    }

    // ---------------------------------------------------------------- utilidades

    // ------------------------------------------------- conexiones (Criotokey)

    /** Bóveda cifrada con Android Keystore; se crea al primer uso. */
    private Boveda boveda() {
        if (boveda == null) {
            boveda = new Boveda(contexto);
        }
        return boveda;
    }

    @JavascriptInterface
    public String conexionesCatalogo() {
        return Conexiones.catalogo().toString();
    }

    @JavascriptInterface
    public String conexionesEstado() {
        JSONObject o = boveda().estado();
        try {
            o.put("ok", true);
            o.put("redireccion", REDIRECCION_OAUTH);
        } catch (Throwable ignorado) {
            // Nada más que agregar.
        }
        return o.toString();
    }

    @JavascriptInterface
    public String conexionesListar() {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", true);
            o.put("conexiones", boveda().listarEnmascarado());
        } catch (Throwable t) {
            return error(t.getMessage() == null ? t.toString() : t.getMessage());
        }
        return o.toString();
    }

    /**
     * Guarda (o actualiza) una conexión. El token viaja desde el formulario y
     * queda cifrado; a JavaScript sólo vuelve la versión enmascarada.
     */
    @JavascriptInterface
    public String conexionGuardar(String proveedor, String nombre, String token, String url) {
        try {
            if (proveedor == null || proveedor.trim().isEmpty()) {
                return error("falta el proveedor");
            }
            JSONObject datos = new JSONObject();
            datos.put("proveedor", proveedor.trim());
            datos.put("nombre", nombre == null ? "" : nombre.trim());
            datos.put("token", token == null ? "" : token.trim());
            datos.put("url", url == null ? "" : url.trim());

            // Se guarda sin probar: la prueba real va aparte, en segundo plano
            // (`conexionProbar`), para que la interfaz nunca se quede esperando
            // a la red.
            JSONObject guardado = boveda().guardar(datos);
            JSONObject salida = new JSONObject();
            salida.put("ok", true);
            salida.put("id", guardado.optString("id", ""));
            salida.put("cuenta", guardado.optString("cuenta", ""));
            return salida.toString();
        } catch (Throwable t) {
            return error(t.getMessage() == null ? t.toString() : t.getMessage());
        }
    }

    @JavascriptInterface
    public String conexionBorrar(String id) {
        try {
            boolean quitado = boveda().borrar(id);
            JSONObject o = new JSONObject();
            o.put("ok", quitado);
            if (!quitado) {
                o.put("error", "no se encontró la conexión");
            }
            return o.toString();
        } catch (Throwable t) {
            return error(t.getMessage() == null ? t.toString() : t.getMessage());
        }
    }

    /** Prueba en segundo plano: la red nunca corre en el hilo de interfaz. */
    @JavascriptInterface
    public String conexionProbar(String id) {
        final JSONObject conexion = boveda().buscar(id);
        if (conexion == null) {
            return error("no se encontró la conexión");
        }
        final String proveedor = conexion.optString("proveedor", "custom");
        final String token = conexion.optString("token", "");
        final String url = conexion.optString("url", "");
        if (token.isEmpty()) {
            return error("esa conexión no tiene token guardado");
        }
        notificar("window.FabriConexiones && window.FabriConexiones.pruebaInicio("
                + JSONObject.quote(id) + ")");
        new Thread(new Runnable() {
            @Override
            public void run() {
                JSONObject r = Conexiones.probar(proveedor, token, url);
                try {
                    r.put("id", id);
                } catch (Throwable ignorado) {
                    // Se informa igual.
                }
                notificar("window.FabriConexiones && window.FabriConexiones.prueba("
                        + JSONObject.quote(r.toString()) + ")");
            }
        }, "fabrick-prueba").start();
        return "{\"ok\":true,\"estado\":\"probando\"}";
    }

    /** Código listo para pegar en un proyecto, sin exponer el token. */
    @JavascriptInterface
    public String conexionCodigo(String id) {
        JSONObject conexion = boveda().buscar(id);
        if (conexion == null) {
            return error("no se encontró la conexión");
        }
        JSONObject r = Conexiones.codigo(conexion.optString("proveedor", "custom"),
                conexion.optString("url", ""));
        try {
            r.put("nombre", conexion.optString("nombre", ""));
            r.put("proveedor", conexion.optString("proveedor", ""));
            r.put("tokenEnmascarado", Boveda.enmascarar(conexion.optString("token", "")));
        } catch (Throwable ignorado) {
            // Se devuelve el código igual.
        }
        return r.toString();
    }

    /** Respaldo cifrado: el usuario autoriza explícitamente antes de esto. */
    @JavascriptInterface
    public String conexionesRespaldo(String incluirTokens) {
        try {
            JSONObject doc = new JSONObject();
            doc.put("tipo", "fabrick-conexiones");
            doc.put("version", 1);
            doc.put("generado", System.currentTimeMillis() / 1000L);
            doc.put("incluyeTokens", "1".equals(incluirTokens));
            if ("1".equals(incluirTokens)) {
                doc.put("conexiones", boveda().crudo());
            } else {
                doc.put("conexiones", boveda().listarEnmascarado());
            }
            return doc.toString(2);
        } catch (Throwable t) {
            return error(t.getMessage() == null ? t.toString() : t.getMessage());
        }
    }

    @JavascriptInterface
    public String conexionesRestaurar(String json) {
        try {
            JSONObject doc = new JSONObject(json);
            if (!"fabrick-conexiones".equals(doc.optString("tipo", ""))) {
                return error("ese archivo no es un respaldo de FORGE CORE STOCK");
            }
            JSONArray lista = doc.optJSONArray("conexiones");
            int n = boveda().importar(lista);
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("importadas", n);
            return o.toString();
        } catch (Throwable t) {
            return error(t.getMessage() == null ? t.toString() : t.getMessage());
        }
    }

    // ------------------------------------------------------------------- OAuth

    /**
     * OAuth con PKCE. Necesita el Client ID de una app registrada por el
     * usuario: la app no inventa credenciales ni las trae embebidas.
     */
    @JavascriptInterface
    public String conexionOauthIniciar(String proveedor, String clientId) {
        try {
            JSONObject r = Conexiones.iniciarOauth(proveedor, clientId, REDIRECCION_OAUTH);
            if (!r.optBoolean("ok", false)) {
                return r.toString();
            }
            JSONObject pendiente = r.optJSONObject("pendiente");
            boveda().guardarPendiente(pendiente);
            String url = r.optString("url", "");
            abrirNavegador(url);
            JSONObject salida = new JSONObject();
            salida.put("ok", true);
            salida.put("url", url);
            salida.put("redireccion", REDIRECCION_OAUTH);
            salida.put("proveedor", proveedor);
            return salida.toString();
        } catch (Throwable t) {
            return error(t.getMessage() == null ? t.toString() : t.getMessage());
        }
    }

    /** Estado del OAuth pendiente, sin el verificador (eso no sale del teléfono). */
    @JavascriptInterface
    public String conexionOauthPendiente() {
        JSONObject p = boveda().leerPendiente();
        JSONObject o = new JSONObject();
        try {
            o.put("ok", true);
            o.put("proveedor", p.optString("proveedor", ""));
            o.put("clientId", p.optString("clientId", ""));
            o.put("redireccion", p.optString("redireccion", REDIRECCION_OAUTH));
            o.put("inicio", p.optLong("inicio", 0));
            o.put("activo", p.optString("estado", "").length() > 0);
        } catch (Throwable ignorado) {
            // Nada más que informar.
        }
        return o.toString();
    }

    @JavascriptInterface
    public String conexionOauthCancelar() {
        try {
            boveda().limpiarPendiente();
            return "{\"ok\":true}";
        } catch (Throwable t) {
            return error(t.getMessage() == null ? t.toString() : t.getMessage());
        }
    }

    /**
     * Llega desde MainActivity cuando el navegador vuelve a `fabrickcore://oauth`.
     * El canje corre en segundo plano y responde por `window.FabriConexiones.oauth`.
     */
    void conexionOauthCompletar(String uriCrudo) {
        final JSONObject pendiente = boveda().leerPendiente();
        final String esperado = pendiente.optString("estado", "");
        if (esperado.isEmpty()) {
            notificar("window.FabriConexiones && window.FabriConexiones.oauth("
                    + JSONObject.quote("{\"ok\":false,\"error\":\"no hay una conexión OAuth en curso\"}") + ")");
            return;
        }
        final JSONObject params = Conexiones.parametros(uriCrudo == null ? null : Uri.parse(uriCrudo));
        new Thread(new Runnable() {
            @Override
            public void run() {
                JSONObject salida = new JSONObject();
                try {
                    if (params.has("error")) {
                        salida.put("ok", false);
                        salida.put("error", params.optString("error_description",
                                params.optString("error", "el proveedor canceló")));
                    } else if (!esperado.equals(params.optString("state", ""))) {
                        salida.put("ok", false);
                        salida.put("error", "el state no coincide: se descartó la respuesta por seguridad");
                    } else {
                        String proveedor = pendiente.optString("proveedor", "");
                        String clientId = pendiente.optString("clientId", "");
                        String redireccion = pendiente.optString("redireccion", REDIRECCION_OAUTH);
                        String verifier = pendiente.optString("verifier", "");
                        String code = params.optString("code", "");
                        if (code.isEmpty()) {
                            salida.put("ok", false);
                            salida.put("error", "el proveedor no devolvió el código");
                        } else {
                            JSONObject canje = Conexiones.canjear(proveedor, clientId, redireccion, code, verifier);
                            if (!canje.optBoolean("ok", false)) {
                                salida = canje;
                            } else {
                                String token = canje.optString("token", "");
                                JSONObject prueba = Conexiones.probar(proveedor, token, "");
                                JSONObject datos = new JSONObject();
                                datos.put("proveedor", proveedor);
                                datos.put("nombre", proveedor + " (OAuth)");
                                datos.put("token", token);
                                datos.put("url", "");
                                datos.put("cuenta", prueba.optString("cuenta", ""));
                                JSONObject guardado = boveda().guardar(datos);
                                boveda().limpiarPendiente();
                                salida.put("ok", true);
                                salida.put("id", guardado.optString("id", ""));
                                salida.put("proveedor", proveedor);
                                salida.put("cuenta", guardado.optString("cuenta", ""));
                                salida.put("prueba", prueba);
                            }
                        }
                    }
                } catch (Throwable t) {
                    try {
                        salida.put("ok", false);
                        salida.put("error", t.getMessage() == null ? t.toString() : t.getMessage());
                    } catch (Throwable ignorado) {
                        // Se informa el fallo genérico.
                    }
                }
                notificar("window.FabriConexiones && window.FabriConexiones.oauth("
                        + JSONObject.quote(salida.toString()) + ")");
                ultimoOauth = salida.toString();
            }
        }, "fabrick-oauth").start();
    }

    /** Último resultado OAuth, para cuando la página abre después del redirect. */
    @JavascriptInterface
    public String conexionOauthUltimo() {
        return ultimoOauth == null ? "{\"ok\":false,\"vacio\":true}" : ultimoOauth;
    }

    // ------------------------------------------------- Google sin redirect

    /**
     * Google device flow: no hay redirect URI que registrar. Devuelve un código
     * corto que el usuario escribe en google.com/device.
     */
    @JavascriptInterface
    public String conexionGoogleDeviceIniciar(String clientId) {
        try {
            JSONObject r = Conexiones.googleDeviceIniciar(clientId);
            if (!r.optBoolean("ok", false)) {
                return r.toString();
            }
            JSONObject pendiente = new JSONObject();
            pendiente.put("estado", "google-device");
            pendiente.put("proveedor", "google");
            pendiente.put("clientId", clientId == null ? "" : clientId.trim());
            pendiente.put("deviceCode", r.optString("deviceCode", ""));
            pendiente.put("inicio", System.currentTimeMillis() / 1000L);
            boveda().guardarPendiente(pendiente);

            String url = r.optString("url", "https://www.google.com/device");
            abrirNavegador(url);

            JSONObject salida = new JSONObject();
            salida.put("ok", true);
            salida.put("userCode", r.optString("userCode", ""));
            salida.put("url", url);
            salida.put("intervalo", r.optInt("intervalo", 5));
            salida.put("expira", r.optLong("expira", 1800));
            return salida.toString();
        } catch (Throwable t) {
            return error(t.getMessage() == null ? t.toString() : t.getMessage());
        }
    }

    /** Una consulta del device flow; la página la repite cada pocos segundos. */
    @JavascriptInterface
    public String conexionGoogleDeviceConsultar() {
        try {
            JSONObject pendiente = boveda().leerPendiente();
            if (!"google-device".equals(pendiente.optString("estado", ""))) {
                return error("no hay una autorización de Google en curso");
            }
            String clientId = pendiente.optString("clientId", "");
            String deviceCode = pendiente.optString("deviceCode", "");
            JSONObject r = Conexiones.googleDeviceConsultar(clientId, deviceCode);
            if (r.optBoolean("pendiente", false)) {
                return r.toString();
            }
            if (!r.optBoolean("ok", false)) {
                return r.toString();
            }
            String token = r.optString("token", "");
            JSONObject prueba = Conexiones.probar("google", token, "");
            JSONObject datos = new JSONObject();
            datos.put("proveedor", "google");
            datos.put("nombre", "Google (device)");
            datos.put("token", token);
            datos.put("url", "");
            datos.put("cuenta", prueba.optString("cuenta", ""));
            JSONObject guardado = boveda().guardar(datos);
            boveda().limpiarPendiente();

            JSONObject salida = new JSONObject();
            salida.put("ok", true);
            salida.put("id", guardado.optString("id", ""));
            salida.put("proveedor", "google");
            salida.put("cuenta", guardado.optString("cuenta", ""));
            return salida.toString();
        } catch (Throwable t) {
            return error(t.getMessage() == null ? t.toString() : t.getMessage());
        }
    }

    @JavascriptInterface
    public String conexionGoogleDeviceCancelar() {
        try {
            boveda().limpiarPendiente();
            return "{\"ok\":true}";
        } catch (Throwable t) {
            return error(t.getMessage() == null ? t.toString() : t.getMessage());
        }
    }

    /** Abre una URL HTTPS en el navegador del teléfono. */
    @JavascriptInterface
    public String abrirNavegadorSeguro(String url) {
        try {
            if (!abrirNavegador(url)) {
                return error("sólo se abren enlaces HTTPS");
            }
            return "{\"ok\":true}";
        } catch (Throwable t) {
            return error(t.getMessage() == null ? t.toString() : t.getMessage());
        }
    }

    private boolean abrirNavegador(String url) {
        if (url == null) {
            return false;
        }
        String u = url.trim();
        if (!u.toLowerCase(Locale.US).startsWith("https://")) {
            return false;
        }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(u));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            contexto.startActivity(i);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    // ------------------------------------------------------------- archivos

    /**
     * Guarda un texto (CSV, JSON, respaldo) en la carpeta de Descargas privada
     * de la app: `Android/data/cl.fabrick.core/files/Download`. No pide permisos
     * y queda visible desde el administrador de archivos.
     */
    /**
     * Impresión / PDF de un documento HTML (boleta del inventario).
     * Usa el PrintManager del sistema con una WebView aislada: no ejecuta JS
     * externo ni abre enlaces. El documento lo construye la app.
     */
    @JavascriptInterface
    public String imprimir(final String html) {
        if (html == null || html.trim().isEmpty()) {
            return error("no hay documento para imprimir");
        }
        if (html.length() > 4 * 1024 * 1024) {
            return error("el documento supera los 4 MB");
        }
        Activity actividad = (contexto instanceof Activity) ? (Activity) contexto : null;
        if (actividad == null) {
            return error("no hay actividad para abrir la impresión");
        }
        final android.print.PrintManager gestor =
                (android.print.PrintManager) actividad.getSystemService(Context.PRINT_SERVICE);
        if (gestor == null) {
            return error("este Android no tiene servicio de impresión");
        }
        actividad.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    final android.webkit.WebView hoja = new android.webkit.WebView(actividad);
                    hoja.getSettings().setJavaScriptEnabled(false);
                    hoja.setWebViewClient(new android.webkit.WebViewClient() {
                        @Override
                        public boolean shouldOverrideUrlLoading(android.webkit.WebView v, String url) {
                            return true;
                        }

                        @Override
                        public void onPageFinished(android.webkit.WebView v, String url) {
                            try {
                                String titulo = "FORGE CORE STOCK " + System.currentTimeMillis();
                                android.print.PrintDocumentAdapter adaptador =
                                        v.createPrintDocumentAdapter(titulo);
                                gestor.print(titulo, adaptador, null);
                                ultimaHojaImpresion = v;
                            } catch (Throwable t) {
                                // Sin impresora el sistema muestra su propio aviso.
                            }
                        }
                    });
                    hoja.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                } catch (Throwable t) {
                    // Se ignora: la app sigue viva y el usuario puede copiar el HTML.
                }
            }
        });
        return "{\"ok\":true,\"estado\":\"abriendo impresión\"}";
    }

    /** Referencia viva mientras el sistema imprime (evita que el GC se la lleve). */
    private android.webkit.WebView ultimaHojaImpresion;

    @JavascriptInterface
    public String guardarArchivo(String nombre, String contenido) {        try {
            if (contenido == null) {
                return error("no hay contenido para guardar");
            }
            if (contenido.length() > 20 * 1024 * 1024) {
                return error("el archivo supera los 20 MB");
            }
            String limpio = nombre == null ? "" : nombre.replaceAll("[^A-Za-z0-9._-]", "_");
            if (limpio.isEmpty() || limpio.startsWith(".")) {
                limpio = "fabrick-datos.txt";
            }
            if (limpio.length() > 80) {
                limpio = limpio.substring(limpio.length() - 80);
            }
            File carpeta = contexto.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS);
            if (carpeta == null) {
                carpeta = new File(contexto.getFilesDir(), "descargas");
            }
            if (!carpeta.exists() && !carpeta.mkdirs()) {
                return error("no se pudo crear la carpeta de descargas");
            }
            File destino = new File(carpeta, limpio);
            FileOutputStream out = new FileOutputStream(destino, false);
            try {
                out.write(contenido.getBytes(Charset.forName("UTF-8")));
                out.flush();
                out.getFD().sync();
            } finally {
                out.close();
            }
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("archivo", destino.getName());
            o.put("ruta", destino.getAbsolutePath());
            o.put("bytes", destino.length());
            return o.toString();
        } catch (Throwable t) {
            return error(t.getMessage() == null ? t.toString() : t.getMessage());
        }
    }

    /** Lee un archivo elegido por el usuario con el selector del sistema. */
    @JavascriptInterface
    public String leerArchivoUri(String uriTexto) {
        InputStream in = null;
        try {
            if (uriTexto == null || uriTexto.trim().isEmpty()) {
                return error("no se recibió ningún archivo");
            }
            Uri uri = Uri.parse(uriTexto);
            String esquema = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.US);
            if (!"content".equals(esquema) && !"file".equals(esquema)) {
                return error("origen de archivo no permitido");
            }
            in = contexto.getContentResolver().openInputStream(uri);
            if (in == null) {
                return error("no se pudo abrir el archivo");
            }
            java.io.ByteArrayOutputStream acumulador = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int n;
            while ((n = in.read(buffer)) > 0) {
                acumulador.write(buffer, 0, n);
                if (acumulador.size() > 10 * 1024 * 1024) {
                    return error("el archivo supera los 10 MB");
                }
            }
            String texto = new String(acumulador.toByteArray(), Charset.forName("UTF-8"));
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("texto", texto);
            o.put("bytes", acumulador.size());
            return o.toString();
        } catch (Throwable t) {
            return error(t.getMessage() == null ? t.toString() : t.getMessage());
        } finally {
            if (in != null) {
                try { in.close(); } catch (Throwable ignorado) { /* nada */ }
            }
        }
    }

    private void notificar(String script) {
        Notificador n = notificador;
        if (n != null) {
            try {
                n.js(script);
            } catch (Throwable ignorado) {
                // Un fallo al pintar progreso no debe romper la descarga.
            }
        }
    }

    private static String error(String motivo) {
        return "{\"ok\":false,\"error\":\"" + escapar(motivo) + "\"}";
    }

    private static String mensaje(Throwable t) {
        if (t == null) {
            return "error desconocido";
        }
        String m = t.getMessage();
        if (m == null || m.trim().isEmpty()) {
            m = t.getClass().getSimpleName();
        }
        return m;
    }

    /** Libera TTS y el modelo nativo cuando se cierra la actividad. */
    void cerrar() {
        try {
            if (tts != null) {
                tts.stop();
                tts.shutdown();
                tts = null;
            }
        } catch (Throwable ignorado) {
            // El proceso termina igual.
        }
        ttsListo = false;
        try {
            RuntimeNativo.liberar();
        } catch (Throwable ignorado) {
            // Sin modelo cargado no hay nada que liberar.
        }
    }

    private static boolean idValido(String id) {
        if (id == null || id.isEmpty() || id.length() > 64) {
            return false;
        }
        char primero = id.charAt(0);
        if (!((primero >= 'a' && primero <= 'z') || (primero >= '0' && primero <= '9'))) {
            return false;
        }
        for (int i = 0; i < id.length(); i++) {
            char c = id.charAt(i);
            boolean ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
                    || c == '-' || c == '_' || c == '.';
            if (!ok) {
                return false;
            }
        }
        return !id.contains("..");
    }

    /** Toma el último segmento de la URL y lo deja apto para el sistema de archivos. */
    private static String nombreDeArchivo(String url) {
        if (url == null) {
            return null;
        }
        int corte = url.indexOf('?');
        String limpia = corte >= 0 ? url.substring(0, corte) : url;
        int barra = limpia.lastIndexOf('/');
        String nombre = barra >= 0 ? limpia.substring(barra + 1) : limpia;
        if (nombre.isEmpty() || nombre.contains("..")) {
            return null;
        }
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < nombre.length(); i++) {
            char c = nombre.charAt(i);
            boolean ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
                    || (c >= '0' && c <= '9') || c == '.' || c == '-' || c == '_';
            b.append(ok ? c : '_');
        }
        String salida = b.toString();
        return salida.isEmpty() ? null : salida;
    }

    private static void copiarArchivo(File origen, File destino) throws Exception {
        InputStream in = new FileInputStream(origen);
        FileOutputStream out = new FileOutputStream(destino);
        try {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
            }
        } finally {
            try { out.close(); } catch (Exception ignorado) { }
            try { in.close(); } catch (Exception ignorado) { }
        }
    }

    /** Cadena literal segura para inyectar en JavaScript (los ids son ASCII). */
    private static String cadena(String s) {
        return "\"" + escapar(s) + "\"";
    }

    /** Escapa comillas y saltos para poder construir JSON a mano sin sorpresas. */
    private static String escapar(String s) {
        if (s == null) {
            return "";
        }
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ").replace("\r", " ");
    }

    // ------------------------------------------------ API Nube (Vercel / InsForge)

    @JavascriptInterface
    public String apiNubeConfigurar(String url, String token) {
        try {
            if (url == null || url.trim().isEmpty()) {
                return error("URL de API nube requerida");
            }
            if (token == null || token.trim().isEmpty()) {
                return error("Token de API requerido");
            }
            String base = url.trim();
            while (base.endsWith("/")) {
                base = base.substring(0, base.length() - 1);
            }
            guardarConfig("api_nube_url", base);
            guardarConfig("api_nube_token", token.trim());

            // Probar conexión a /api/stats
            JSONObject prueba = probarApiNube();
            return prueba.toString();
        } catch (Throwable t) {
            return error(t.getMessage() == null ? t.toString() : t.getMessage());
        }
    }

    @JavascriptInterface
    public String apiNubeEstado() {
        String url = leerConfig("api_nube_url");
        String token = leerConfig("api_nube_token");
        try {
            JSONObject o = new JSONObject();
            o.put("configurada", !url.isEmpty() && !token.isEmpty());
            o.put("url", url.isEmpty() ? "no configurada" : url);
            o.put("token_presente", !token.isEmpty());
            return o.toString();
        } catch (Exception e) {
            return error("Error construyendo estado de API nube: " + e.getMessage());
        }
    }

    @JavascriptInterface
    public String apiNubePensar(final String texto, final String contexto) {
        final String url = leerConfig("api_nube_url");
        final String token = leerConfig("api_nube_token");
        if (url.isEmpty() || token.isEmpty()) {
            return error("API nube no configurada. Ve a Conexiones y configura primero.");
        }
        if (texto == null || texto.trim().isEmpty()) {
            return error("falta el texto a pensar");
        }

        Thread hilo = new Thread(new Runnable() {
            @Override
            public void run() {
                JSONObject r = new JSONObject();
                try {
                    JSONObject payload = new JSONObject();
                    payload.put("texto", texto);
                    payload.put("contexto", contexto == null ? "" : contexto);
                    payload.put("usuario_id", "apk_local_" + android.os.Build.SERIAL);

                    String cuerpo = http("POST", url + "/api/think", token,
                            payload.toString(), 10000, 180000);
                    r = new JSONObject(cuerpo);
                    if (!r.has("ok")) {
                        r.put("ok", true);
                    }
                    r.put("origen", "nube");
                } catch (Throwable t) {
                    try {
                        r.put("ok", false);
                        r.put("error", t.getMessage() == null ? t.toString() : t.getMessage());
                        r.put("origen", "nube");
                    } catch (Throwable ignorado) {
                        // sin más.
                    }
                }
                notificar("window.FabriNube && FabriNube.pensar(" + r.toString() + ");");
            }
        }, "nube-pensar");
        hilo.setDaemon(true);
        hilo.start();
        return "{\"ok\":true,\"estado\":\"ENVIANDO_A_NUBE\"}";
    }

    @JavascriptInterface
    public String apiNubeSincronizar(final String tabla, final String filasJson,
                                     final String operacion) {
        final String url = leerConfig("api_nube_url");
        final String token = leerConfig("api_nube_token");
        if (url.isEmpty() || token.isEmpty()) {
            return error("API nube no configurada");
        }

        Thread hilo = new Thread(new Runnable() {
            @Override
            public void run() {
                JSONObject r = new JSONObject();
                try {
                    JSONObject payload = new JSONObject();
                    payload.put("tabla", tabla);
                    payload.put("filas", filasJson == null ? new JSONArray() : new JSONArray(filasJson));
                    payload.put("operacion", operacion == null ? "sincronizar" : operacion);

                    String cuerpo = http("POST", url + "/api/sync", token,
                            payload.toString(), 10000, 180000);
                    r = new JSONObject(cuerpo);
                    if (!r.has("ok")) {
                        r.put("ok", true);
                    }
                    r.put("origen", "nube");
                } catch (Throwable t) {
                    try {
                        r.put("ok", false);
                        r.put("error", t.getMessage() == null ? t.toString() : t.getMessage());
                        r.put("origen", "nube");
                    } catch (Throwable ignorado) {
                        // sin más.
                    }
                }
                notificar("window.FabriNube && FabriNube.sincronizar(" + r.toString() + ");");
            }
        }, "nube-sync");
        hilo.setDaemon(true);
        hilo.start();
        return "{\"ok\":true,\"estado\":\"SINCRONIZANDO\"}";
    }

    @JavascriptInterface
    public String webhookNotificar(final String tipo, final String mensaje,
                                   final String origen) {
        final String url = leerConfig("api_nube_url");
        final String token = leerConfig("api_nube_token");
        if (url.isEmpty() || token.isEmpty()) {
            return error("API nube no configurada");
        }

        Thread hilo = new Thread(new Runnable() {
            @Override
            public void run() {
                JSONObject r = new JSONObject();
                try {
                    JSONObject payload = new JSONObject();
                    payload.put("tipo", tipo == null ? "evento" : tipo);
                    payload.put("mensaje", mensaje == null ? "" : mensaje);
                    payload.put("origen", origen == null ? "apk_local" : origen);
                    payload.put("timestamp", String.valueOf(System.currentTimeMillis()));

                    String cuerpo = http("POST", url + "/api/webhook", token,
                            payload.toString(), 5000, 30000);
                    r = new JSONObject(cuerpo);
                    if (!r.has("ok")) {
                        r.put("ok", true);
                    }
                } catch (Throwable t) {
                    try {
                        r.put("ok", false);
                        r.put("error", t.getMessage() == null ? t.toString() : t.getMessage());
                    } catch (Throwable ignorado) {
                        // sin más.
                    }
                }
                notificar("window.FabriNube && FabriNube.webhook(" + r.toString() + ");");
            }
        }, "nube-webhook");
        hilo.setDaemon(true);
        hilo.start();
        return "{\"ok\":true,\"estado\":\"WEBHOOK_ENVIADO\"}";
    }

    /** Prueba silenciosa de conexión a /api/stats. Usada tras configurar. */
    private JSONObject probarApiNube() throws Exception {
        JSONObject r = new JSONObject();
        String url = leerConfig("api_nube_url");
        String token = leerConfig("api_nube_token");
        if (url.isEmpty() || token.isEmpty()) {
            r.put("ok", false);
            r.put("error", "API nube no configurada");
            return r;
        }
        String cuerpo = http("GET", url + "/api/stats", token, null, 10000, 30000);
        r = new JSONObject(cuerpo);
        if (!r.has("ok")) {
            r.put("ok", true);
        }
        r.put("origen", "nube");
        return r;
    }
}
