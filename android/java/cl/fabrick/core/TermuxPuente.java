package cl.fabrick.core;

import android.content.Context;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;

/**
 * FORGE CORE STOCK · puente indirecto hacia Termux.
 *
 * Por qué NO se usa `com.termux.RUN_COMMAND`:
 *   Termux 0.119 declara `com.termux.permission.RUN_COMMAND` con
 *   protectionLevel="signature". Sólo las apps firmadas con la clave de Termux
 *   (Termux:Tasker, Termux:Widget) pueden obtenerlo. Esta APK va firmada con
 *   otra clave, así que Android jamás le concede ese permiso: el Intent falla
 *   en silencio. No es un bug de FORGE CORE STOCK, es el modelo de seguridad de Termux.
 *
 * La vía que sí funciona es loopback: un proceso Python en Termux escucha en
 * 127.0.0.1:8787 y ejecuta SÓLO una lista blanca de comandos. La APK no manda
 * shell: manda un id. El servidor no acepta texto libre.
 */
final class TermuxPuente {

    static final String HOST = "http://127.0.0.1:8787";
    static final String TOKEN = "fabrick-local";
    static final String ASSET = "termux-puente.py";

    private TermuxPuente() {
    }

    /** GET /estado con timeout corto: sirve para saber si el puente está vivo. */
    static String estado(Context ctx) {
        try {
            HttpURLConnection c = abrir("/estado", 1500, 2500);
            int codigo = c.getResponseCode();
            String cuerpo = leer(codigo >= 400 ? c.getErrorStream() : c.getInputStream());
            c.disconnect();
            if (codigo != 200) {
                return error("el puente respondió HTTP " + codigo + ": " + recortar(cuerpo, 300), "HTTP");
            }
            JSONObject o = new JSONObject(cuerpo);
            o.put("ok", true);
            o.put("puente", "activo");
            return o.toString();
        } catch (Throwable t) {
            return error("el puente no responde en 127.0.0.1:8787 (" + tipo(t) + "). "
                    + "Ábrelo una vez desde Termux con el comando de instalación.", "SIN_PUENTE");
        }
    }

    /** POST /ejecutar en segundo plano; el resultado llega a FabriTermux.recibir. */
    static String ejecutar(final Context ctx, final String id, final NativeBridge.Notificador notificador) {
        if (id == null || id.trim().isEmpty()) {
            return error("falta el id del comando", "ARGUMENTO");
        }
        Thread hilo = new Thread(new Runnable() {
            @Override
            public void run() {
                String json;
                long t0 = System.currentTimeMillis();
                try {
                    HttpURLConnection c = abrir("/ejecutar", 1500, 45000);
                    c.setRequestMethod("POST");
                    c.setDoOutput(true);
                    c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    JSONObject cuerpo = new JSONObject();
                    cuerpo.put("id", id);
                    byte[] datos = cuerpo.toString().getBytes(Charset.forName("UTF-8"));
                    c.setFixedLengthStreamingMode(datos.length);
                    OutputStream salida = c.getOutputStream();
                    salida.write(datos);
                    salida.close();

                    int codigo = c.getResponseCode();
                    String texto = leer(codigo >= 400 ? c.getErrorStream() : c.getInputStream());
                    c.disconnect();

                    if (codigo != 200) {
                        json = error("HTTP " + codigo + ": " + recortar(texto, 400), "HTTP");
                    } else {
                        JSONObject r = new JSONObject(texto);
                        r.put("via", "loopback");
                        json = r.toString();
                    }
                } catch (Throwable t) {
                    json = error("no se pudo hablar con Termux: " + tipo(t)
                            + ". Revisa que el puente esté activo (botón «Estado del puente»).",
                            "SIN_PUENTE");
                }
                try {
                    JSONObject r = new JSONObject(json);
                    r.put("total_ms", System.currentTimeMillis() - t0);
                    json = r.toString();
                } catch (Throwable ignorado) {
                    // el JSON ya viene armado por error(); no hay nada que añadir.
                }
                if (notificador != null) {
                    notificador.js("window.FabriTermux && FabriTermux.recibir(" + json + ");");
                }
            }
        }, "termux-puente");
        hilo.setDaemon(true);
        hilo.start();
        return "{\"ok\":true,\"estado\":\"EJECUTANDO\"}";
    }

    /**
     * POST /comando: shell libre en el propio teléfono, para la consola de la
     * APK. El puente exige token, escucha sólo en loopback, limita tiempo y
     * salida, y registra cada comando. El resultado llega a FabriTermux.recibir
     * igual que los comandos de la lista blanca.
     */
    static String comando(final Context ctx, final String texto,
                          final NativeBridge.Notificador notificador) {
        final String cmd = texto == null ? "" : texto.trim();
        if (cmd.isEmpty()) {
            return error("el comando está vacío", "ARGUMENTO");
        }
        if (cmd.length() > 4000) {
            return error("el comando supera los 4000 caracteres", "ARGUMENTO");
        }
        Thread hilo = new Thread(new Runnable() {
            @Override
            public void run() {
                String json;
                long t0 = System.currentTimeMillis();
                try {
                    HttpURLConnection c = abrir("/comando", 1500, 40000);
                    c.setRequestMethod("POST");
                    c.setDoOutput(true);
                    c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    JSONObject cuerpo = new JSONObject();
                    cuerpo.put("cmd", cmd);
                    byte[] datos = cuerpo.toString().getBytes(Charset.forName("UTF-8"));
                    c.setFixedLengthStreamingMode(datos.length);
                    OutputStream salida = c.getOutputStream();
                    salida.write(datos);
                    salida.close();

                    int codigo = c.getResponseCode();
                    String respuesta = leer(codigo >= 400 ? c.getErrorStream() : c.getInputStream());
                    c.disconnect();

                    if (codigo == 200) {
                        JSONObject r = new JSONObject(respuesta);
                        r.put("via", "loopback");
                        r.put("libre", true);
                        json = r.toString();
                    } else {
                        // El puente explica el motivo (token, denegado, etc.).
                        try {
                            JSONObject r = new JSONObject(respuesta);
                            r.put("ok", false);
                            r.put("libre", true);
                            json = r.toString();
                        } catch (Throwable sinJson) {
                            json = error("HTTP " + codigo + ": " + recortar(respuesta, 400), "HTTP");
                        }
                    }
                } catch (Throwable t) {
                    json = error("no se pudo hablar con Termux: " + tipo(t)
                            + ". Revisa que el puente esté activo (botón «Estado del puente»).",
                            "SIN_PUENTE");
                }
                try {
                    JSONObject r = new JSONObject(json);
                    r.put("total_ms", System.currentTimeMillis() - t0);
                    json = r.toString();
                } catch (Throwable ignorado) {
                    // ya viene armado.
                }
                if (notificador != null) {
                    notificador.js("window.FabriTermux && FabriTermux.recibir(" + json + ");");
                }
            }
        }, "termux-comando");
        hilo.setDaemon(true);
        hilo.start();
        return "{\"ok\":true,\"estado\":\"EJECUTANDO\"}";
    }

    /**
     * Prepara el instalador del puente. Devuelve dos comandos:
     *   · `comando`: instala o reemplaza el script y lo arranca (una línea).
     *   · `comandoCorto`: sólo reinicia el puente si el script ya existe.
     * También deja el comando largo en el portapapeles.
     */
    static String instalar(Context ctx) {
        try {
            String script = leerAsset(ctx, ASSET);
            if (script == null || script.length() < 200) {
                return error("no se pudo leer el instalador empaquetado", "ASSET");
            }
            String b64 = Base64.encodeToString(script.getBytes(Charset.forName("UTF-8")), Base64.NO_WRAP);
            String comando = "echo '" + b64 + "' | base64 -d > ~/termux-puente.py && "
                    + "chmod +x ~/termux-puente.py && "
                    + "pkill -f termux-puente.py; "
                    + "nohup python3 ~/termux-puente.py >~/termux-puente.log 2>&1 & "
                    + "sleep 2; curl -s -H 'X-Fabrick-Token: " + TOKEN + "' http://127.0.0.1:8787/estado";
            String corto = "pkill -f termux-puente.py; nohup python3 ~/termux-puente.py >~/termux-puente.log 2>&1 & sleep 1; echo listo";

            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("comando", comando);
            o.put("comandoCorto", corto);
            o.put("bytes", script.length());
            o.put("rutaTermux", "~/termux-puente.py");
            o.put("copiado", copiar(ctx, comando));
            return o.toString();
        } catch (Throwable t) {
            return error(tipo(t), "EXCEPCION");
        }
    }

    // --------------------------------------------------------------- utilidades

    private static HttpURLConnection abrir(String ruta, int conexionMs, int lecturaMs) throws Exception {
        URL url = new URL(HOST + ruta);
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        c.setConnectTimeout(conexionMs);
        c.setReadTimeout(lecturaMs);
        c.setRequestProperty("X-Fabrick-Token", TOKEN);
        c.setRequestProperty("Accept", "application/json");
        c.setUseCaches(false);
        return c;
    }

    private static String leer(InputStream in) throws Exception {
        if (in == null) {
            return "";
        }
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] bloque = new byte[8192];
        int leidos;
        while ((leidos = in.read(bloque)) != -1) {
            buffer.write(bloque, 0, leidos);
            if (buffer.size() > 512 * 1024) {
                break;
            }
        }
        in.close();
        return new String(buffer.toByteArray(), Charset.forName("UTF-8"));
    }

    private static String leerAsset(Context ctx, String nombre) {
        try {
            InputStream in = ctx.getAssets().open(nombre);
            String texto = leer(in);
            return texto;
        } catch (Throwable t) {
            return null;
        }
    }

    private static boolean copiar(Context ctx, String texto) {
        try {
            android.content.ClipboardManager cm =
                    (android.content.ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm == null) {
                return false;
            }
            cm.setPrimaryClip(android.content.ClipData.newPlainText("FORGE CORE STOCK · puente Termux", texto));
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    static String copiarTexto(Context ctx, String texto) {
        if (texto == null) {
            return error("no hay texto para copiar", "ARGUMENTO");
        }
        boolean ok = copiar(ctx, texto);
        return "{\"ok\":" + ok + ",\"copiado\":" + ok + "}";
    }

    static String recortar(String s, int max) {
        if (s == null) {
            return "";
        }
        String limpio = s.replace("\n", " ").trim();
        return limpio.length() <= max ? limpio : limpio.substring(0, max) + "…";
    }

    static String tipo(Throwable t) {
        String m = t.getMessage();
        return t.getClass().getSimpleName() + (m == null || m.isEmpty() ? "" : ": " + m);
    }

    static String error(String motivo, String codigo) {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", false);
            o.put("error", motivo == null ? "error desconocido" : motivo);
            o.put("codigo", codigo == null ? "ERROR" : codigo);
        } catch (Throwable ignorado) {
            return "{\"ok\":false,\"error\":\"error desconocido\",\"codigo\":\"ERROR\"}";
        }
        return o.toString();
    }

    /** Lista de comandos que la interfaz puede ofrecer (espejo del servidor). */
    static JSONArray catalogo() {
        JSONArray a = new JSONArray();
        String[][] filas = {
                {"ping", "Prueba mínima del puente"},
                {"estado", "Kernel, Android y Termux"},
                {"espacio", "Espacio libre en HOME y PREFIX"},
                {"ram", "Memoria RAM real"},
                {"red", "Prueba de red IPv4"},
                {"red6", "Prueba de red IPv6"},
                {"paquetes", "Paquetes instalados"},
                {"herramientas", "Versiones de node/python/git/cargo"},
                {"modelos", "Modelos GGUF en ~/modelos"},
                {"servicios", "Procesos por RAM"},
                {"pesados", "Carpetas más pesadas"},
                {"fabrick", "Estado de FORGE CORE STOCK en Termux"},
                {"probar-llm", "Runtime llama.cpp"},
        };
        for (String[] f : filas) {
            try {
                JSONObject o = new JSONObject();
                o.put("id", f[0]);
                o.put("descripcion", f[1]);
                a.put(o);
            } catch (Throwable ignorado) {
                // JSONObject sólo falla con claves nulas.
            }
        }
        return a;
    }
}
