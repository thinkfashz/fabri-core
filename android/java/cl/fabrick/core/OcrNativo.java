package cl.fabrick.core;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.lang.reflect.Method;
import java.util.concurrent.TimeUnit;

/**
 * OCR del inventario, con detección honesta del motor disponible.
 *
 * <p>El proyecto compila sin Gradle (javac → d8), así que no puede declarar
 * dependencias de ML Kit: su framework arrastra decenas de AAR de androidx y
 * exigiría fusionar manifiestos y recursos a mano, que es justo lo que hace
 * AGP. En vez de fingir que hay OCR, esta clase mira si el motor está
 * realmente presente en el proceso y lo usa por reflexión:
 *
 * <ul>
 *   <li><b>mlkit</b> — ML Kit v2 con modelo empaquetado
 *       ({@code com.google.mlkit.vision.text.TextRecognition}).</li>
 *   <li><b>gms</b> — API de visión clásica de Google Play Services
 *       ({@code com.google.android.gms.vision.text.TextRecognizer}).</li>
 * </ul>
 *
 * <p>Si no hay ninguno, {@link #estado} lo dice con una razón legible y la
 * interfaz no muestra el botón. Cuando el build pase a Gradle y se empaquete
 * ML Kit, la función se enciende sola, sin tocar la interfaz ni el núcleo.
 *
 * <p>Nunca se sube nada: el texto se reconoce en el teléfono y la imagen no
 * sale del proceso.
 */
public final class OcrNativo {

    private static final int LADO_MAX = 1600;      // se reduce para no agotar RAM
    private static final int ESPERA_S = 20;

    private static boolean probado = false;
    private static String motor = "";              // "mlkit" | "gms" | ""
    private static String motivo = "sin comprobar";

    private OcrNativo() {
    }

    /** Busca el motor una sola vez y cachea el resultado. */
    private static synchronized void detectar() {
        if (probado) return;
        probado = true;

        try {
            Class.forName("com.google.mlkit.vision.text.TextRecognition");
            Class.forName("com.google.mlkit.vision.common.InputImage");
            Class.forName("com.google.android.gms.tasks.Tasks");
            motor = "mlkit";
            motivo = "ML Kit v2 (modelo local)";
            return;
        } catch (Throwable ignorado) {
            // Se prueba el siguiente motor.
        }

        try {
            Class.forName("com.google.android.gms.vision.text.TextRecognizer");
            Class.forName("com.google.android.gms.vision.Frame");
            motor = "gms";
            motivo = "Google Play Services (visión clásica)";
            return;
        } catch (Throwable ignorado) {
            // Ninguno disponible.
        }

        motor = "";
        motivo = "Este build no incluye un motor OCR sin conexión. "
                + "Se activará solo cuando la APK se compile con ML Kit (Gradle).";
    }

    /** JSON con la disponibilidad real del motor. */
    public static String estado() {
        detectar();
        JSONObject o = new JSONObject();
        try {
            o.put("ok", true);
            o.put("disponible", motor.length() > 0);
            o.put("motor", motor);
            o.put("motivo", motivo);
        } catch (Exception e) {
            return "{\"ok\":false,\"disponible\":false,\"motivo\":\"error interno\"}";
        }
        return o.toString();
    }

    /**
     * Reconoce el texto de una imagen entregada como data URL (o base64 puro).
     * Devuelve {@code {ok, texto, bloques[], motor}} o un error legible.
     * No toca la red ni escribe archivos.
     */
    public static String texto(Context ctx, String dataUrl) {
        detectar();
        if (motor.length() == 0) {
            return "{\"ok\":false,\"motivo\":" + JSONObject.quote(motivo) + "}";
        }
        Bitmap bmp = decodificar(dataUrl);
        if (bmp == null) {
            return "{\"ok\":false,\"error\":\"no se pudo leer la imagen\"}";
        }
        try {
            if ("mlkit".equals(motor)) return mlkit(bmp);
            return gms(ctx, bmp);
        } catch (Throwable e) {
            return "{\"ok\":false,\"error\":" + JSONObject.quote(String.valueOf(e)) + "}";
        } finally {
            try {
                bmp.recycle();
            } catch (Throwable ignorado) {
                // Reciclar es una cortesía: si falla, el GC lo recoge.
            }
        }
    }

    /** Decodifica y reduce la imagen para que no reviente la memoria. */
    private static Bitmap decodificar(String datos) {
        if (datos == null) return null;
        String limpio = datos.trim();
        int coma = limpio.indexOf(',');
        if (limpio.startsWith("data:") && coma > 0) {
            limpio = limpio.substring(coma + 1);
        }
        try {
            byte[] bytes = Base64.decode(limpio, Base64.DEFAULT);
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, o);
            int lado = Math.max(o.outWidth, o.outHeight);
            int escala = 1;
            while (lado / escala > LADO_MAX) escala *= 2;
            BitmapFactory.Options o2 = new BitmapFactory.Options();
            o2.inSampleSize = escala;
            o2.inPreferredConfig = Bitmap.Config.ARGB_8888;
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, o2);
        } catch (Throwable e) {
            return null;
        }
    }

    /* ── ML Kit v2 (por reflexión) ─────────────────────────────────────── */

    private static String mlkit(Bitmap bmp) throws Exception {
        Class<?> inputClase = Class.forName("com.google.mlkit.vision.common.InputImage");
        Object imagen = inputClase.getMethod("fromBitmap", Bitmap.class, int.class)
                .invoke(null, bmp, 0);

        // Opciones: latino en 16.x, o el paquete base si cambia el nombre.
        Object opciones = null;
        String[] rutas = {
                "com.google.mlkit.vision.text.latin.TextRecognizerOptions",
                "com.google.mlkit.vision.text.TextRecognizerOptions"
        };
        for (String ruta : rutas) {
            try {
                Class<?> c = Class.forName(ruta);
                opciones = c.getField("DEFAULT_OPTIONS").get(null);
                break;
            } catch (Throwable ignorado) {
                // Se prueba la siguiente ruta.
            }
        }
        if (opciones == null) {
            return "{\"ok\":false,\"error\":\"ML Kit sin opciones de reconocimiento\"}";
        }

        Class<?> tr = Class.forName("com.google.mlkit.vision.text.TextRecognition");
        Method getClient = null;
        for (Method m : tr.getMethods()) {
            if (m.getName().equals("getClient") && m.getParameterTypes().length == 1) {
                getClient = m;
                break;
            }
        }
        if (getClient == null) {
            return "{\"ok\":false,\"error\":\"ML Kit sin getClient\"}";
        }
        Object cliente = getClient.invoke(null, opciones);

        Object tarea;
        try {
            tarea = cliente.getClass().getMethod("process", inputClase).invoke(cliente, imagen);
        } catch (NoSuchMethodException e) {
            // La firma declarada usa la interfaz InputImage; se busca por nombre.
            Method proc = null;
            for (Method m : cliente.getClass().getMethods()) {
                if (m.getName().equals("process") && m.getParameterTypes().length == 1) {
                    proc = m;
                    break;
                }
            }
            if (proc == null) throw e;
            tarea = proc.invoke(cliente, imagen);
        }

        Class<?> tasks = Class.forName("com.google.android.gms.tasks.Tasks");
        Class<?> tareaClase = Class.forName("com.google.android.gms.tasks.Task");
        Object resultado = tasks
                .getMethod("await", tareaClase, long.class, TimeUnit.class)
                .invoke(null, tarea, (long) ESPERA_S, TimeUnit.SECONDS);
        if (resultado == null) {
            return "{\"ok\":false,\"error\":\"sin resultado del OCR\"}";
        }

        String texto = String.valueOf(resultado.getClass().getMethod("getText").invoke(resultado));
        JSONArray bloques = new JSONArray();
        try {
            Object lista = resultado.getClass().getMethod("getTextBlocks").invoke(resultado);
            if (lista instanceof Iterable) {
                for (Object b : (Iterable<?>) lista) {
                    JSONObject o = new JSONObject();
                    o.put("texto", String.valueOf(b.getClass().getMethod("getText").invoke(b)));
                    bloques.put(o);
                }
            }
        } catch (Throwable ignorado) {
            // Los bloques son un extra: el texto completo ya está.
        }
        JSONObject salida = new JSONObject();
        salida.put("ok", true);
        salida.put("texto", texto == null ? "" : texto);
        salida.put("bloques", bloques);
        salida.put("motor", "mlkit");
        return salida.toString();
    }

    /* ── Google Play Services · visión clásica (por reflexión) ─────────── */

    private static String gms(Context ctx, Bitmap bmp) throws Exception {
        Class<?> trClase = Class.forName("com.google.android.gms.vision.text.TextRecognizer");
        Class<?> builderClase = null;
        for (Class<?> c : trClase.getDeclaredClasses()) {
            if (c.getSimpleName().equals("Builder")) {
                builderClase = c;
                break;
            }
        }
        if (builderClase == null) {
            return "{\"ok\":false,\"error\":\"TextRecognizer sin Builder\"}";
        }
        Object builder = builderClase.getConstructor(Context.class).newInstance(ctx);
        Object detector = builderClase.getMethod("build").invoke(builder);

        Object frame;
        try {
            Class<?> frameBuilder = Class.forName("com.google.android.gms.vision.Frame$Builder");
            Object fb = frameBuilder.getConstructor().newInstance();
            frameBuilder.getMethod("setBitmap", Bitmap.class).invoke(fb, bmp);
            frame = frameBuilder.getMethod("build").invoke(fb);
        } catch (Throwable e) {
            return "{\"ok\":false,\"error\":\"no se pudo preparar el frame\"}";
        }

        Object bloques = detector.getClass().getMethod("detect", frame.getClass()).invoke(detector, frame);
        StringBuilder texto = new StringBuilder();
        JSONArray lista = new JSONArray();
        if (bloques != null) {
            Method size = bloques.getClass().getMethod("size");
            Method valueAt = bloques.getClass().getMethod("valueAt", int.class);
            int n = ((Number) size.invoke(bloques)).intValue();
            for (int i = 0; i < n; i++) {
                Object b = valueAt.invoke(bloques, i);
                String t = String.valueOf(b.getClass().getMethod("getValue").invoke(b));
                if (texto.length() > 0) texto.append('\n');
                texto.append(t);
                JSONObject o = new JSONObject();
                o.put("texto", t);
                lista.put(o);
            }
        }
        try {
            detector.getClass().getMethod("release").invoke(detector);
        } catch (Throwable ignorado) {
            // Liberar es cortesía.
        }

        JSONObject salida = new JSONObject();
        salida.put("ok", true);
        salida.put("texto", texto.toString());
        salida.put("bloques", lista);
        salida.put("motor", "gms");
        return salida.toString();
    }
}