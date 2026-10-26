package cl.fabrick.core;

import android.content.Context;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Bitácora de arranque, independiente del núcleo Rust y de SQLite.
 *
 * <p>Por qué existe: cuando la app se quedaba en el loader no había forma de
 * saber <em>dónde</em> se había quedado. Todo lo que se registraba pasaba por
 * el núcleo (que era justamente la pieza sospechosa) y por lo tanto se perdía.
 *
 * <p>Esto escribe en {@code filesDir/arranque.log} desde el primer instante,
 * con milisegundos desde el inicio del proceso. Se lee desde la pestaña
 * Diagnóstico con {@code FabrickNative.arranqueBitacora()}. Rota sola a los
 * 256 KB para que no crezca sin límite.
 */
final class Bitacora {

    private static final long LIMITE_BYTES = 256L * 1024L;
    private static final int MAX_DETALLE = 500;
    private static final Object CANDADO = new Object();
    private static final long INICIO = System.currentTimeMillis();
    private static final SimpleDateFormat HORA =
            new SimpleDateFormat("HH:mm:ss.SSS", Locale.US);

    private static File archivo;

    private Bitacora() {
    }

    /** Debe llamarse una vez, al construir el puente. */
    static void iniciar(Context ctx) {
        if (archivo != null) return;
        try {
            archivo = new File(ctx.getFilesDir(), "arranque.log");
        } catch (Throwable t) {
            archivo = null;
        }
    }

    /** Anota un hito. Nunca lanza y nunca bloquea más de lo que tarda un append. */
    static void anotar(String etiqueta, String detalle) {
        File f = archivo;
        if (f == null) return;
        long ms = System.currentTimeMillis() - INICIO;
        String texto = String.format(Locale.US, "+%06d ms  %-14s  %s",
                ms,
                etiqueta == null ? "?" : etiqueta,
                recortar(detalle));
        synchronized (CANDADO) {
            try {
                if (f.length() > LIMITE_BYTES) {
                    File viejo = new File(f.getParentFile(), "arranque.log.1");
                    if (viejo.exists()) viejo.delete();
                    f.renameTo(viejo);
                }
                RandomAccessFile ra = new RandomAccessFile(f, "a");
                try {
                    ra.write((texto + "\n").getBytes(StandardCharsets.UTF_8));
                } finally {
                    ra.close();
                }
            } catch (Throwable ignorado) {
                // La bitácora jamás puede tumbar la app.
            }
        }
    }

    /** Anota también la hora del día, útil cuando se mezclan sesiones. */
    static void anotarConHora(String etiqueta, String detalle) {
        String hora;
        synchronized (HORA) {
            hora = HORA.format(new Date());
        }
        anotar(etiqueta, hora + " · " + detalle);
    }

    /** Devuelve las últimas líneas, de la más vieja a la más nueva. */
    static String leer(int maxLineas) {
        File f = archivo;
        if (f == null || !f.isFile()) {
            return "La bitácora de arranque todavía no tiene entradas.";
        }
        int tope = maxLineas <= 0 ? 200 : Math.min(maxLineas, 2000);
        StringBuilder sb = new StringBuilder();
        synchronized (CANDADO) {
            try {
                BufferedReader br = new BufferedReader(new InputStreamReader(
                        new FileInputStream(f), StandardCharsets.UTF_8));
                try {
                    String linea;
                    int total = 0;
                    while ((linea = br.readLine()) != null) {
                        total++;
                        if (total > tope) {
                            // Se conservan las últimas: se reinicia el búfer.
                            sb.setLength(0);
                            total = 1;
                        }
                        sb.append(linea).append('\n');
                    }
                } finally {
                    br.close();
                }
            } catch (Throwable t) {
                return "No se pudo leer la bitácora: " + t;
            }
        }
        return sb.toString();
    }

    /** Borra la bitácora (botón de la vista Diagnóstico). */
    static String limpiar() {
        File f = archivo;
        synchronized (CANDADO) {
            try {
                if (f != null && f.exists()) {
                    FileOutputStream salida = new FileOutputStream(f, false);
                    salida.close();
                }
                return "{\"ok\":true}";
            } catch (Throwable t) {
                return TermuxPuente.error(TermuxPuente.tipo(t), "BITACORA");
            }
        }
    }

    private static String recortar(String detalle) {
        String d = detalle == null ? "" : detalle.replace("\n", " ⏎ ");
        if (d.length() > MAX_DETALLE) {
            d = d.substring(0, MAX_DETALLE) + "…";
        }
        return d;
    }
}
