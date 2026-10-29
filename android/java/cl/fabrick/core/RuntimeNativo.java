package cl.fabrick.core;

import org.json.JSONObject;

import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;

/**
 * FORGE CORE STOCK · runtime nativo llama.cpp (A1 + A2 + A3).
 *
 * Android 10+ bloquea `execve()` sobre el directorio privado de la app (W^X),
 * pero sí permite cargar bibliotecas `.so` empaquetadas en la APK. Esta clase:
 *
 *   A1 · carga libggml-base, libggml, libllama y el shim JNI;
 *   A2 · registra los backends CPU desde nativeLibraryDir y carga un GGUF;
 *   A3 · genera texto con ese modelo y libera la memoria al terminar.
 *
 * No ejecuta binarios descargados ni acepta comandos de shell. La ruta del
 * modelo la valida NativeBridge y debe estar dentro de filesDir.
 */
public final class RuntimeNativo {

    private static final boolean CARGADO;
    private static final String ERROR;

    /**
     * Un único candado para las operaciones nativas (cargar, generar, liberar).
     * Es un ReentrantLock y no `synchronized` porque `liberar` necesita poder
     * rendirse con timeout: si una carga se cuelga dentro de llama.cpp, el
     * monitor de `synchronized` quedaba tomado para siempre y la interfaz se
     * quedaba en "Cargando…" sin forma de salir. Ese era el fallo real.
     */
    private static final ReentrantLock CANDADO = new ReentrantLock();

    // Estado leído por la interfaz: volatile para poder consultarlo SIN candado.
    private static volatile long handle = 0L;
    private static volatile String rutaModelo = "";
    private static volatile String infoModelo = "";
    private static volatile int nCtx = 0;
    private static volatile boolean cargando = false;
    private static volatile long cargandoDesde = 0L;
    private static volatile boolean abandonada = false;

    /** A partir de este tiempo la interfaz avisa que la carga quedó colgada. */
    private static final long COLGADA_MS = 45000L;

    static {
        boolean ok = false;
        String error = null;
        try {
            // El orden respeta las dependencias DT_NEEDED de las bibliotecas.
            System.loadLibrary("ggml-base");
            System.loadLibrary("ggml");
            System.loadLibrary("llama");
            System.loadLibrary("fabrick_llama");
            ok = true;
        } catch (Throwable t) {
            error = t.getClass().getSimpleName()
                    + (t.getMessage() == null ? "" : ": " + t.getMessage());
        }
        CARGADO = ok;
        ERROR = error;
    }

    private RuntimeNativo() {
        // Sólo métodos estáticos.
    }

    private static native String versionNativa();
    private static native String iniciarNativo(String dir);
    private static native String cargarNativo(String ruta, int nCtx, int nThreads, String dir);
    private static native String infoNativo(long handle);
    private static native String generarNativo(long handle, String prompt, int maxTokens);
    private static native String generarStreamNativo(long handle, String prompt, int maxTokens,
                                                     Progreso progreso);
    private static native String configurarNativo(long handle, float temp, float topP,
                                                  int topK, float repetir, long semilla);
    private static native String detenerNativo(long handle);
    private static native String estadoCtxNativo(long handle);
    private static native void liberarNativo(long handle);

    /** Recibe cada trozo de texto generado como UTF-8 crudo. */
    public interface Progreso {
        void pieza(byte[] utf8, int tokens);
    }

    /** Devuelve el estado de A1 como JSON, sin lanzar excepciones. */
    public static String info() {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", CARGADO);
            o.put("cargado", CARGADO);
            o.put("fase", "A1");
            o.put("abi", "arm64-v8a");
            if (CARGADO) {
                String version = versionNativa();
                o.put("version", version == null || version.isEmpty() ? "desconocida" : version);
                o.put("detalle", "bibliotecas cargadas; A2/A3 disponibles");
            } else {
                o.put("error", ERROR == null ? "no se pudieron cargar las bibliotecas" : ERROR);
                o.put("detalle", "A1 no completado: A2/A3 siguen bloqueados");
            }
        } catch (Throwable t) {
            try {
                o.put("ok", false);
                o.put("cargado", false);
                o.put("fase", "A1");
                o.put("error", t.toString());
            } catch (Throwable ignorado) {
                // JSONObject sólo falla con claves nulas; no hay nada más que hacer.
            }
        }
        return o.toString();
    }

    /**
     * A2: inicializa los backends y carga el modelo. Debe llamarse desde un
     * hilo de fondo: el GGUF puede pesar cientos de MB y tarda varios segundos.
     */
    public static String cargar(String ruta, int contexto, int hilos, String nativeDir) {
        if (!CARGADO) {
            return "{\"ok\":false,\"error\":\"A1 no está cargado: " + escapar(ERROR) + "\"}";
        }
        if (ruta == null || ruta.trim().isEmpty()) {
            return "{\"ok\":false,\"error\":\"ruta de modelo vacía\"}";
        }
        // Falla rápido y con un motivo claro antes de tocar llama.cpp: un
        // archivo que no es GGUF tarda 30 s en fallar dentro del runtime.
        java.io.File archivo = new java.io.File(ruta);
        if (!archivo.isFile()) {
            return "{\"ok\":false,\"error\":\"no existe el archivo del modelo\"}";
        }
        if (archivo.length() < 1048576L) {
            return "{\"ok\":false,\"error\":\"el archivo es demasiado pequeño para un GGUF ("
                    + archivo.length() + " B)\"}";
        }
        try (java.io.FileInputStream entrada = new java.io.FileInputStream(archivo)) {
            byte[] cabecera = new byte[4];
            int leidos = entrada.read(cabecera);
            if (leidos != 4 || cabecera[0] != 'G' || cabecera[1] != 'G'
                    || cabecera[2] != 'U' || cabecera[3] != 'F') {
                return "{\"ok\":false,\"error\":\"el archivo no empieza con GGUF: no es un modelo válido\"}";
            }
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"no se pudo leer el modelo: " + escapar(t.toString()) + "\"}";
        }
        // Una carga anterior que quedó colgada no debe bloquear ésta: se marca
        // abandonada y se intenta tomar el candado con espera acotada.
        if (!tomarCandado(2000L)) {
            return "{\"ok\":false,\"error\":\"hay una carga anterior todavía en curso; "
                    + "pulsa Liberar y vuelve a intentarlo\"}";
        }
        try {
            if (handle != 0L) {
                liberarNativo(handle);
                handle = 0L;
            }
            rutaModelo = "";
            infoModelo = "";
            nCtx = 0;
            abandonada = false;
            cargando = true;
            cargandoDesde = System.currentTimeMillis();

            int ctx = contexto < 128 ? 512 : Math.min(contexto, 4096);
            int th = hilos < 1 ? 2 : Math.min(hilos, 8);
            String dir = nativeDir == null ? "" : nativeDir;

            // A2: el backend CPU se carga desde el directorio nativo de la APK.
            iniciarNativo(dir);
            String crudo = cargarNativo(ruta, ctx, th, dir);
            if (abandonada) {
                // El usuario ya se cansó de esperar: no se publica el modelo.
                return "{\"ok\":false,\"error\":\"carga abandonada por el usuario\",\"abandonada\":true}";
            }
            JSONObject r = new JSONObject(crudo);
            if (!r.optBoolean("ok", false)) {
                return "{\"ok\":false,\"error\":\"" + escapar(r.optString("error", "no se pudo cargar el modelo")) + "\"}";
            }
            long h = r.optLong("handle", 0L);
            if (h == 0L) {
                return "{\"ok\":false,\"error\":\"el runtime devolvió un handle nulo\"}";
            }
            handle = h;
            rutaModelo = ruta;
            nCtx = ctx;
            String infoCruda = infoNativo(h);
            infoModelo = infoCruda == null ? "{}" : infoCruda;

            JSONObject salida = new JSONObject(infoModelo);
            salida.put("ok", true);
            salida.put("cargado", true);
            salida.put("ruta", ruta);
            salida.put("n_ctx", ctx);
            salida.put("hilos", th);
            return salida.toString();
        } catch (Throwable t) {
            if (handle != 0L) {
                liberarNativo(handle);
                handle = 0L;
            }
            rutaModelo = "";
            infoModelo = "";
            return "{\"ok\":false,\"error\":\"" + escapar(t.toString()) + "\"}";
        } finally {
            cargando = false;
            cargandoDesde = 0L;
            CANDADO.unlock();
        }
    }

    /**
     * Toma el candado nativo con espera máxima. Devuelve false si otra
     * operación lo tiene tomado (carga colgada): así ninguna llamada de la
     * interfaz puede quedarse esperando indefinidamente.
     */
    private static boolean tomarCandado(long ms) {
        try {
            return CANDADO.tryLock(ms, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    /**
     * Abandona una carga en curso: la interfaz recupera el control aunque el
     * hilo nativo siga dentro de llama.cpp. El resultado se descarta.
     */
    public static String abandonarCarga() {
        boolean estaba = cargando;
        abandonada = true;
        cargando = false;
        cargandoDesde = 0L;
        return "{\"ok\":true,\"abandonada\":" + estaba + "}";
    }

    /** A3: genera texto sin streaming. Debe llamarse desde un hilo de fondo. */
    public static String generar(String prompt, int maxTokens) {
        return generarInterno(prompt, maxTokens, null);
    }

    /**
     * A4: genera con streaming. `progreso.pieza` se llama en el mismo hilo de
     * generación, así que puede tocar estado Java sin sincronización extra.
     * Devuelve el JSON final con el texto completo y las métricas.
     */
    public static String generarStream(String prompt, int maxTokens, Progreso progreso) {
        return generarInterno(prompt, maxTokens, progreso);
    }

    private static String generarInterno(String prompt, int maxTokens, final Progreso progreso) {
        if (!CARGADO) {
            return "{\"ok\":false,\"error\":\"A1 no está cargado\"}";
        }
        if (prompt == null || prompt.trim().isEmpty()) {
            return "{\"ok\":false,\"error\":\"prompt vacío\"}";
        }
        // Si hay una carga colgada, generar espera como máximo 3 s y avisa.
        if (!tomarCandado(3000L)) {
            return "{\"ok\":false,\"error\":\"el runtime está ocupado (¿carga colgada?); pulsa Liberar\"}";
        }
        try {
            if (handle == 0L) {
                return "{\"ok\":false,\"error\":\"no hay modelo cargado; pulsa Cargar modelo\"}";
            }
            int max = maxTokens < 1 ? 128 : Math.min(maxTokens, 1024);
            String crudo = progreso == null
                    ? generarNativo(handle, prompt, max)
                    : generarStreamNativo(handle, prompt, max, progreso);
            JSONObject r = new JSONObject(crudo);
            if (r.optBoolean("ok", false)) {
                String texto = r.optString("texto", "");
                // El modelo puede emitir el token de fin de turno como texto.
                // Sin trim: el texto tiene que coincidir token a token con lo
                // que quedó en la KV, o el turno siguiente pierde el prefijo.
                texto = texto.replace("<|im_end|>", "").replace("<|im_end|", "")
                        .replace("<|endoftext|>", "").replace("<|eot_id|>", "")
                        .replace("<|end|>", "");
                r.put("texto", texto);
                return r.toString();
            }
            return crudo;
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + escapar(t.toString()) + "\"}";
        } finally {
            CANDADO.unlock();
        }
    }

    /**
     * Ajusta el muestreo del próximo turno. No toma el candado: el shim lee
     * estos valores al empezar a generar. temp = 0 vuelve a greedy.
     */
    public static String configurar(float temp, float topP, int topK,
                                    float repetir, long semilla) {
        if (handle == 0L) {
            return "{\"ok\":false,\"error\":\"no hay modelo cargado\"}";
        }
        try {
            return configurarNativo(handle, temp, topP, topK, repetir, semilla);
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + escapar(t.toString()) + "\"}";
        }
    }

    /**
     * Corta la generación en el siguiente token. No espera al candado: si la
     * inferencia está en curso, el flag la hace salir sola.
     */
    public static String detener() {
        if (handle == 0L) {
            return "{\"ok\":false,\"error\":\"no hay modelo cargado\"}";
        }
        try {
            return detenerNativo(handle);
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + escapar(t.toString()) + "\"}";
        }
    }

    /** Cuántos tokens del contexto están ocupados (para la barra de contexto). */
    public static String contexto() {
        if (handle == 0L) {
            return "{\"ok\":false,\"error\":\"no hay modelo cargado\"}";
        }
        try {
            return estadoCtxNativo(handle);
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + escapar(t.toString()) + "\"}";
        }
    }

    /**
     * Libera el modelo y la memoria KV. Si una carga quedó colgada dentro de
     * llama.cpp, NO se queda esperando: marca la carga como abandonada y
     * devuelve el control para que la interfaz nunca se congele.
     */
    public static String liberar() {
        if (!tomarCandado(1500L)) {
            abandonada = true;
            cargando = false;
            cargandoDesde = 0L;
            return "{\"ok\":true,\"cargado\":false,\"aviso\":\"la carga seguía en curso; "
                    + "se descartará y la memoria se libera al cerrar la app\"}";
        }
        try {
            if (handle != 0L) {
                try {
                    liberarNativo(handle);
                } catch (Throwable ignorado) {
                    // La memoria se libera igual al salir del proceso.
                }
                handle = 0L;
            }
            rutaModelo = "";
            infoModelo = "";
            nCtx = 0;
            abandonada = false;
            cargando = false;
            cargandoDesde = 0L;
            return "{\"ok\":true,\"cargado\":false}";
        } finally {
            CANDADO.unlock();
        }
    }

    /**
     * Estado que consume la UI; no devuelve rutas fuera de filesDir.
     * NO toma el candado: si la carga está colgada, la interfaz tiene que
     * poder enterarse igual. Por eso todos los campos son volatile.
     */
    public static String estado() {
        JSONObject o = new JSONObject();
        try {
            long desde = cargandoDesde;
            long ms = (cargando && desde > 0L) ? (System.currentTimeMillis() - desde) : 0L;
            o.put("ok", CARGADO);
            o.put("cargado", handle != 0L);
            o.put("ruta", rutaModelo);
            o.put("n_ctx", nCtx);
            o.put("cargando", cargando);
            o.put("cargando_ms", ms);
            o.put("colgada", cargando && ms > COLGADA_MS);
            o.put("abandonada", abandonada);
            if (handle != 0L && !infoModelo.isEmpty()) {
                o.put("info", new JSONObject(infoModelo));
            }
            if (!CARGADO) {
                o.put("error", ERROR == null ? "bibliotecas no cargadas" : ERROR);
            }
        } catch (Throwable t) {
            try {
                o.put("ok", false);
                o.put("cargado", false);
                o.put("error", t.toString());
            } catch (Throwable ignorado) {
                // Nada más que hacer.
            }
        }
        return o.toString();
    }

    private static String escapar(String s) {
        if (s == null) {
            return "";
        }
        return s.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", " ").replace("\r", " ");
    }
}
