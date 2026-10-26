package cl.fabrick.core;

import android.content.Context;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Sirve la interfaz a la WebView desde un origen https propio
 * (https://appassets.local/), sin abrir ningún puerto y sin dependencias.
 *
 * <p>Por qué existe: la app cargaba desde {@code file:///android_asset/}, y en
 * ese origen el WebView bloquea {@code fetch()}, los módulos ES y la
 * compilación de WebAssembly. El módulo de visión necesita las tres cosas para
 * cargar su runtime y sus modelos. {@code androidx.webkit.WebViewAssetLoader}
 * resuelve lo mismo, pero exige un AAR más en un pipeline que no usa Gradle;
 * esto es la misma idea en pocas líneas: se intercepta la petición y se
 * devuelve el contenido desde el APK o desde filesDir.
 *
 * <p>Lo que NO hace: no expone nada fuera del proceso. La interceptación vive
 * dentro de la WebView de esta app, así que ningún otro programa del teléfono
 * puede pedir estas rutas.
 */
final class ActivosWeb {

    static final String ESQUEMA = "https";
    static final String HOST = "appassets.local";
    static final String BASE = ESQUEMA + "://" + HOST + "/";

    /** Dentro del APK los archivos de la interfaz viven en assets/www/. */
    private static final String PREFIJO_ASSETS = "www/";
    /** Los módulos descargados viven en filesDir/componentes/. */
    private static final String PREFIJO_COMPONENTES = "componentes/";

    private ActivosWeb() {
    }

    /** ¿La URL pertenece al origen propio? */
    static boolean esPropio(String url) {
        return url != null && url.startsWith(BASE);
    }

    /**
     * Traduce una petición del origen propio a una respuesta.
     *
     * @return la respuesta, o {@code null} si la URL no es de este origen: en
     *         ese caso la WebView sigue su curso normal (API externas,
     *         {@code data:}, {@code blob:}).
     */
    static WebResourceResponse responder(Context ctx, String url) {
        if (!esPropio(url)) {
            return null;
        }

        String ruta = url.substring(BASE.length());
        int corte = ruta.indexOf('?');
        if (corte >= 0) {
            ruta = ruta.substring(0, corte);
        }
        corte = ruta.indexOf('#');
        if (corte >= 0) {
            ruta = ruta.substring(0, corte);
        }
        if (ruta.isEmpty()) {
            ruta = "index.html";
        }

        // Sin traversal: ni "..", ni barras invertidas, ni rutas absolutas.
        if (ruta.contains("..") || ruta.contains("\\") || ruta.startsWith("/")) {
            return error(400, "ruta inválida");
        }

        try {
            if (ruta.startsWith(PREFIJO_COMPONENTES)) {
                return componente(ctx, ruta.substring(PREFIJO_COMPONENTES.length()), ruta);
            }
            InputStream flujo = ctx.getAssets().open(PREFIJO_ASSETS + ruta);
            return respuesta(mime(ruta), flujo, esTexto(ruta));
        } catch (IOException e) {
            return error(404, "no encontrado");
        }
    }

    /** Archivos de módulos ya descargados y verificados. Sólo lectura. */
    private static WebResourceResponse componente(Context ctx, String resto, String ruta)
            throws IOException {
        File base = new File(ctx.getFilesDir(), "componentes");
        File destino = new File(base, resto);
        String raiz = base.getCanonicalPath() + File.separator;
        if (!destino.getCanonicalPath().startsWith(raiz)) {
            return error(403, "fuera del directorio de componentes");
        }
        if (!destino.isFile()) {
            return error(404, "no encontrado");
        }
        return respuesta(mime(ruta), new FileInputStream(destino), esTexto(ruta));
    }

    private static WebResourceResponse respuesta(String mime, InputStream datos, boolean texto) {
        WebResourceResponse r = new WebResourceResponse(mime, texto ? "utf-8" : null, datos);
        Map<String, String> cabeceras = new HashMap<>();
        // Sin caché: un update de la APK debe verse de inmediato, y los
        // archivos se leen del APK o del disco, no de la red.
        cabeceras.put("Cache-Control", "no-cache");
        cabeceras.put("X-Content-Type-Options", "nosniff");
        r.setResponseHeaders(cabeceras);
        return r;
    }

    private static WebResourceResponse error(int codigo, String mensaje) {
        byte[] cuerpo = (codigo + " " + mensaje).getBytes(StandardCharsets.UTF_8);
        WebResourceResponse r = new WebResourceResponse(
                "text/plain", "utf-8", new ByteArrayInputStream(cuerpo));
        try {
            r.setStatusCodeAndReasonPhrase(codigo, mensaje);
        } catch (IllegalArgumentException ignorado) {
            // Un motivo con caracteres raros no puede tumbar la respuesta.
        }
        return r;
    }

    private static boolean esTexto(String ruta) {
        String m = mime(ruta);
        return m.startsWith("text/")
                || m.equals("application/json")
                || m.equals("application/javascript")
                || m.equals("image/svg+xml");
    }

    private static String mime(String ruta) {
        String r = ruta.toLowerCase(Locale.US);
        int punto = r.lastIndexOf('.');
        String ext = punto >= 0 ? r.substring(punto + 1) : "";
        switch (ext) {
            case "html":
            case "htm":
                return "text/html";
            case "js":
            case "mjs":
                return "text/javascript";
            case "css":
                return "text/css";
            case "json":
                return "application/json";
            case "svg":
                return "image/svg+xml";
            case "png":
                return "image/png";
            case "jpg":
            case "jpeg":
                return "image/jpeg";
            case "webp":
                return "image/webp";
            case "gif":
                return "image/gif";
            case "ico":
                return "image/x-icon";
            case "woff":
                return "font/woff";
            case "woff2":
                return "font/woff2";
            case "ttf":
                return "font/ttf";
            case "wasm":
                // Crítico: con otro MIME el WebView rechaza la compilación
                // en streaming de WebAssembly.
                return "application/wasm";
            case "txt":
            case "md":
                return "text/plain";
            default:
                // .task, .tflite, .gguf, .bin: pesos de modelos.
                return "application/octet-stream";
        }
    }
}
