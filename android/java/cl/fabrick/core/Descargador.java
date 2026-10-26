package cl.fabrick.core;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * FABRI-CORE · descargador verificable (Fase 3).
 *
 * Reglas que implementa:
 *   · sólo HTTPS, salvo http:// en 127.0.0.1/localhost para pruebas locales;
 *   · escribe primero en "<destino>.parcial" y sólo renombra si el SHA-256 y el
 *     tamaño coinciden exactamente con el manifiesto;
 *   · si algo falla, borra el parcial: nunca deja un archivo a medio bajar;
 *   · un artefacto de más de 50 MiB exige "autorizado" explícito;
 *   · cancelación cooperativa y reintentos acotados.
 *
 * No depende de Android: se compila con javac normal y se prueba con `java`,
 * y la misma clase se empaqueta en la APK.
 */
public final class Descargador {

    /** 50 MiB: por encima de esto hace falta autorización explícita. */
    public static final long LIMITE_SIN_AUTORIZACION = 50L * 1024 * 1024;

    private static final int BLOQUE = 64 * 1024;

    private Descargador() {
    }

    /** Control de cancelación compartido entre el hilo de descarga y la interfaz. */
    public static final class Control {
        private volatile boolean cancelado = false;

        public void cancelar() {
            cancelado = true;
        }

        public boolean cancelado() {
            return cancelado;
        }
    }

    /** Progreso opcional: se llama al menos una vez por bloque. */
    public interface Progreso {
        void avance(long hechos, long total);
    }

    /** Resultado de una descarga. Nunca se inventa: todo sale de la operación real. */
    public static final class Resultado {
        public final boolean ok;
        public final String estado;
        public final String motivo;
        public final long bytes;
        public final String sha256;
        public final String ruta;

        Resultado(boolean ok, String estado, String motivo, long bytes, String sha256, String ruta) {
            this.ok = ok;
            this.estado = estado;
            this.motivo = motivo;
            this.bytes = bytes;
            this.sha256 = sha256;
            this.ruta = ruta;
        }

        @Override
        public String toString() {
            return "{\"ok\":" + ok
                    + ",\"estado\":\"" + estado + "\""
                    + ",\"motivo\":" + (motivo == null ? "null" : "\"" + esc(motivo) + "\"")
                    + ",\"bytes\":" + bytes
                    + ",\"sha256\":" + (sha256 == null ? "null" : "\"" + sha256 + "\"")
                    + ",\"ruta\":" + (ruta == null ? "null" : "\"" + esc(ruta) + "\"") + "}";
        }
    }

    public static Resultado descargar(String url,
                                      String rutaDestino,
                                      long tamanoEsperado,
                                      String shaEsperado,
                                      boolean autorizado,
                                      int reintentos) {
        return descargar(url, rutaDestino, tamanoEsperado, shaEsperado, autorizado, reintentos, null, null);
    }

    /**
     * Descarga y verifica un artefacto.
     *
     * @param reintentos número de intentos adicionales tras un fallo de red (0 = uno solo)
     * @param progreso   callback opcional de avance
     * @param control    control opcional de cancelación
     */
    public static Resultado descargar(String url,
                                      String rutaDestino,
                                      long tamanoEsperado,
                                      String shaEsperado,
                                      boolean autorizado,
                                      int reintentos,
                                      Progreso progreso,
                                      Control control) {

        if (url == null || !urlPermitida(url)) {
            return new Resultado(false, "RECHAZADO",
                    "URL no permitida: se exige https:// (o http:// en loopback para pruebas)", 0, null, null);
        }
        if (shaEsperado == null || !sha256Valido(shaEsperado)) {
            return new Resultado(false, "RECHAZADO",
                    "sha256 inválido: se exigen 64 hex en minúscula", 0, null, null);
        }
        if (tamanoEsperado <= 0) {
            return new Resultado(false, "RECHAZADO", "tamaño esperado inválido", 0, null, null);
        }
        if (tamanoEsperado > LIMITE_SIN_AUTORIZACION && !autorizado) {
            return new Resultado(false, "RECHAZADO",
                    "el artefacto supera 50 MiB y no está autorizado", 0, null, null);
        }

        File destino;
        try {
            destino = new File(rutaDestino);
        } catch (Exception e) {
            return new Resultado(false, "RECHAZADO", "ruta de destino inválida", 0, null, null);
        }
        File parcial = new File(rutaDestino + ".parcial");

        int intentos = Math.max(0, reintentos) + 1;
        String ultimoError = null;

        for (int intento = 1; intento <= intentos; intento++) {
            if (control != null && control.cancelado()) {
                limpiar(parcial);
                return new Resultado(false, "CANCELADO", "cancelado antes de empezar", 0, null, null);
            }

            HttpURLConnection conexion = null;
            try {
                if (destino.getParentFile() != null) {
                    destino.getParentFile().mkdirs();
                }
                limpiar(parcial);

                URL u = new URL(url);
                conexion = (HttpURLConnection) u.openConnection();
                conexion.setInstanceFollowRedirects(true);
                conexion.setConnectTimeout(20000);
                conexion.setReadTimeout(60000);
                conexion.setRequestProperty("User-Agent", "FABRI-CORE/0.2 (+verificacion-sha256)");

                int codigo = conexion.getResponseCode();
                if (codigo != HttpURLConnection.HTTP_OK) {
                    ultimoError = "HTTP " + codigo;
                    if (codigo >= 400 && codigo < 500 && codigo != 429) {
                        // Error definitivo: reintentar no cambia nada.
                        return new Resultado(false, "ERROR", ultimoError, 0, null, null);
                    }
                    throw new IOException(ultimoError);
                }

                long declarado = conexion.getContentLength();
                if (declarado > 0 && declarado != tamanoEsperado) {
                    return new Resultado(false, "ERROR",
                            "tamaño del servidor (" + declarado + ") distinto del manifiesto (" + tamanoEsperado + ")",
                            0, null, null);
                }

                MessageDigest md = MessageDigest.getInstance("SHA-256");
                long hechos = 0;
                InputStream in = conexion.getInputStream();
                FileOutputStream out = new FileOutputStream(parcial);
                try {
                    byte[] buf = new byte[BLOQUE];
                    int leidos;
                    while ((leidos = in.read(buf)) != -1) {
                        if (control != null && control.cancelado()) {
                            throw new Cancelada();
                        }
                        out.write(buf, 0, leidos);
                        md.update(buf, 0, leidos);
                        hechos += leidos;
                        if (progreso != null) {
                            progreso.avance(hechos, tamanoEsperado);
                        }
                    }
                } finally {
                    try {
                        out.close();
                    } catch (Exception ignorado) {
                    }
                    try {
                        in.close();
                    } catch (Exception ignorado) {
                    }
                }

                if (hechos != tamanoEsperado) {
                    limpiar(parcial);
                    return new Resultado(false, "ERROR",
                            "tamaño descargado (" + hechos + ") distinto del manifiesto (" + tamanoEsperado + ")",
                            hechos, null, null);
                }

                String sha = hex(md.digest());
                if (!sha.equalsIgnoreCase(shaEsperado)) {
                    limpiar(parcial);
                    return new Resultado(false, "ERROR",
                            "SHA-256 no coincide: esperado " + shaEsperado + ", obtenido " + sha,
                            hechos, sha, null);
                }

                if (destino.exists() && !destino.delete()) {
                    limpiar(parcial);
                    return new Resultado(false, "ERROR", "no se pudo reemplazar el destino existente", hechos, sha, null);
                }
                if (!parcial.renameTo(destino)) {
                    limpiar(parcial);
                    return new Resultado(false, "ERROR", "no se pudo renombrar el archivo verificado", hechos, sha, null);
                }

                escribirRecibo(destino, url, tamanoEsperado, shaEsperado, sha);
                return new Resultado(true, "DESCARGADO", null, hechos, sha, destino.getAbsolutePath());

            } catch (Cancelada c) {
                limpiar(parcial);
                return new Resultado(false, "CANCELADO", "cancelado por el usuario", 0, null, null);
            } catch (Exception e) {
                limpiar(parcial);
                ultimoError = e.getClass().getSimpleName() + ": " + e.getMessage();
                if (intento < intentos) {
                    try {
                        Thread.sleep(300L * intento);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        return new Resultado(false, "CANCELADO", "hilo interrumpido", 0, null, null);
                    }
                }
            } finally {
                if (conexion != null) {
                    conexion.disconnect();
                }
            }
        }

        return new Resultado(false, "ERROR",
                "falló tras " + intentos + " intento(s): " + ultimoError, 0, null, null);
    }

    /** Verifica un archivo ya presente contra hash y tamaño. */
    public static Resultado verificar(File archivo, long tamanoEsperado, String shaEsperado) {
        if (archivo == null || !archivo.isFile()) {
            return new Resultado(false, "ERROR", "el archivo no existe", 0, null, null);
        }
        if (archivo.length() != tamanoEsperado) {
            return new Resultado(false, "ERROR",
                    "tamaño real (" + archivo.length() + ") distinto del manifiesto (" + tamanoEsperado + ")",
                    archivo.length(), null, archivo.getAbsolutePath());
        }
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            InputStream in = new java.io.FileInputStream(archivo);
            try {
                byte[] buf = new byte[BLOQUE];
                int n;
                while ((n = in.read(buf)) != -1) {
                    md.update(buf, 0, n);
                }
            } finally {
                in.close();
            }
            String sha = hex(md.digest());
            boolean ok = sha.equalsIgnoreCase(shaEsperado);
            return new Resultado(ok, ok ? "VERIFICADO" : "ERROR",
                    ok ? null : "SHA-256 no coincide: esperado " + shaEsperado + ", obtenido " + sha,
                    archivo.length(), sha, archivo.getAbsolutePath());
        } catch (Exception e) {
            return new Resultado(false, "ERROR", "no se pudo hashear: " + e.getMessage(), 0, null, null);
        }
    }

    // ------------------------------------------------------------------ utils

    private static final class Cancelada extends Exception {
    }

    static boolean sha256Valido(String s) {
        if (s == null || s.length() != 64) {
            return false;
        }
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            boolean ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
            if (!ok) {
                return false;
            }
        }
        return true;
    }

    static boolean urlPermitida(String url) {
        if (url.startsWith("https://")) {
            return true;
        }
        if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) {
            return true;
        }
        return false;
    }

    private static void limpiar(File f) {
        try {
            if (f != null && f.exists()) {
                f.delete();
            }
        } catch (Exception ignorado) {
        }
    }

    static String hex(byte[] datos) {
        char[] tabla = "0123456789abcdef".toCharArray();
        char[] salida = new char[datos.length * 2];
        for (int i = 0; i < datos.length; i++) {
            int b = datos[i] & 0xff;
            salida[i * 2] = tabla[b >>> 4];
            salida[i * 2 + 1] = tabla[b & 0x0f];
        }
        return new String(salida);
    }

    private static void escribirRecibo(File destino, String url, long tamano, String esperado, String obtenido) {
        String json = "{\"archivo\":\"" + esc(destino.getName()) + "\""
                + ",\"ruta\":\"" + esc(destino.getAbsolutePath()) + "\""
                + ",\"origen\":\"" + esc(url) + "\""
                + ",\"bytes\":" + tamano
                + ",\"sha256_esperado\":\"" + esperado + "\""
                + ",\"sha256_obtenido\":\"" + obtenido + "\""
                + ",\"verificado\":true}";
        FileOutputStream out = null;
        try {
            out = new FileOutputStream(new File(destino.getAbsolutePath() + ".recibo.json"));
            out.write(json.getBytes("UTF-8"));
        } catch (Exception ignorado) {
        } finally {
            if (out != null) {
                try {
                    out.close();
                } catch (Exception ignorado) {
                }
            }
        }
    }

    static String esc(String s) {
        if (s == null) {
            return "";
        }
        StringBuilder b = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') {
                b.append('\\').append(c);
            } else if (c == '\n') {
                b.append("\\n");
            } else if (c < 0x20) {
                b.append(' ');
            } else {
                b.append(c);
            }
        }
        return b.toString();
    }
}
