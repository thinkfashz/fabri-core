package cl.fabrick.core;

import android.net.Uri;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.Charset;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.LinkedHashMap;
import java.util.Map;

import org.json.JSONObject;

/**
 * Conexiones reales con proveedores remotos.
 *
 * Todo lo de acá es HTTPS contra endpoints públicos y documentados. No hay
 * endpoints inventados: cada prueba pega contra la API oficial del proveedor
 * usando el token que el usuario pegó (o el que se obtuvo por OAuth).
 *
 * Qué NO hace:
 *   · no descarga ni ejecuta binarios;
 *   · no guarda tokens en texto plano (los cifra Boveda);
 *   · no inventa credenciales: si falta el client ID de OAuth, lo dice.
 */
final class Conexiones {

    private static final int CONECTAR_MS = 15000;
    private static final int LEER_MS = 20000;
    private static final int MAX_CUERPO = 512 * 1024;

    private Conexiones() {
    }

    // ------------------------------------------------------------- proveedores

    /**
     * Ficha de cada proveedor: cómo se prueba y dónde se saca el token.
     * `prueba` es la URL real que se consulta; `campoUrl` indica si además
     * hace falta una URL propia (proyecto, base, etc.).
     */
    static JSONObject catalogo() {
        String[][] datos = {
                // id, nombre, grupo, url de prueba, pide URL, dónde sacar el token
                {"github", "GitHub", "Código", "https://api.github.com/user", "0",
                        "https://github.com/settings/tokens"},
                {"vercel", "Vercel", "Despliegue", "https://api.vercel.com/v2/user", "0",
                        "https://vercel.com/account/tokens"},
                {"cloudflare", "Cloudflare", "Red", "https://api.cloudflare.com/client/v4/user/tokens/verify", "0",
                        "https://dash.cloudflare.com/profile/api-tokens"},
                {"supabase", "Supabase", "Base de datos", "https://api.supabase.com/v1/projects", "1",
                        "https://supabase.com/dashboard/account/tokens"},
                {"firebase", "Firebase RTDB", "Base de datos", "", "1",
                        "https://console.firebase.google.com/project/_/settings/database"},
                {"meta", "Meta (Facebook/Instagram)", "Social", "https://graph.facebook.com/v21.0/me?fields=id,name", "0",
                        "https://developers.facebook.com/tools/explorer/"},
                {"google", "Google", "Cuenta", "https://www.googleapis.com/oauth2/v3/userinfo", "0",
                        "https://developers.google.com/oauthplayground"},
                {"neon", "Neon (PostgreSQL)", "Base de datos", "https://console.neon.tech/api/v2/projects", "0",
                        "https://console.neon.tech/app/settings/api-keys"},
                {"insforge", "InsForge", "Base de datos", "", "1",
                        "https://insforge.dev"},
                {"mcp", "Servidor MCP (HTTP)", "Agentes", "", "1",
                        "https://modelcontextprotocol.io"},
                {"custom", "Otro servicio HTTPS", "Genérico", "", "1", ""}
        };
        org.json.JSONArray lista = new org.json.JSONArray();
        for (String[] d : datos) {
            JSONObject o = new JSONObject();
            try {
                o.put("id", d[0]);
                o.put("nombre", d[1]);
                o.put("grupo", d[2]);
                o.put("prueba", d[3]);
                o.put("pideUrl", "1".equals(d[4]));
                o.put("tokenEn", d[5]);
                o.put("oauth", soportaOauth(d[0]));
            } catch (Throwable ignorado) {
                // Si no se puede armar la ficha se omite.
            }
            lista.put(o);
        }
        JSONObject salida = new JSONObject();
        try {
            salida.put("proveedores", lista);
        } catch (Throwable ignorado) {
            // JSONObject.put no falla con estas claves.
        }
        return salida;
    }

    static boolean soportaOauth(String proveedor) {
        return "github".equals(proveedor) || "google".equals(proveedor) || "meta".equals(proveedor);
    }

    // ------------------------------------------------------------------ pruebas

    /**
     * Prueba real: hace la llamada y devuelve cuenta + estado.
     * `url` sólo se usa en los proveedores que la piden.
     */
    static JSONObject probar(String proveedor, String token, String url) {
        JSONObject r = new JSONObject();
        long inicio = System.currentTimeMillis();
        try {
            r.put("proveedor", proveedor);
            if (token == null || token.trim().isEmpty()) {
                r.put("ok", false);
                r.put("estado", "falta token");
                r.put("detalle", "Pega el token del proveedor para probar la conexión.");
                return r;
            }
            String t = token.trim();

            Map<String, String> cabeceras = new LinkedHashMap<String, String>();
            String destino;
            String metodo = "GET";
            String cuerpo = null;

            if ("github".equals(proveedor)) {
                destino = "https://api.github.com/user";
                cabeceras.put("Authorization", "Bearer " + t);
                cabeceras.put("X-GitHub-Api-Version", "2022-11-28");
            } else if ("vercel".equals(proveedor)) {
                destino = "https://api.vercel.com/v2/user";
                cabeceras.put("Authorization", "Bearer " + t);
            } else if ("cloudflare".equals(proveedor)) {
                destino = "https://api.cloudflare.com/client/v4/user/tokens/verify";
                cabeceras.put("Authorization", "Bearer " + t);
            } else if ("supabase".equals(proveedor)) {
                if (url != null && !url.trim().isEmpty()) {
                    destino = recortar(url) + "/rest/v1/?select=1";
                    cabeceras.put("apikey", t);
                    cabeceras.put("Authorization", "Bearer " + t);
                } else {
                    destino = "https://api.supabase.com/v1/projects";
                    cabeceras.put("Authorization", "Bearer " + t);
                }
            } else if ("firebase".equals(proveedor)) {
                if (url == null || url.trim().isEmpty()) {
                    r.put("ok", false);
                    r.put("estado", "falta URL");
                    r.put("detalle", "Firebase necesita la URL de la Realtime Database (https://<proyecto>.firebaseio.com).");
                    return r;
                }
                destino = recortar(url) + "/.json?shallow=true&auth=" + URLEncoder.encode(t, "UTF-8");
            } else if ("meta".equals(proveedor)) {
                destino = "https://graph.facebook.com/v21.0/me?fields=id,name&access_token="
                        + URLEncoder.encode(t, "UTF-8");
            } else if ("google".equals(proveedor)) {
                destino = "https://www.googleapis.com/oauth2/v3/userinfo";
                cabeceras.put("Authorization", "Bearer " + t);
            } else if ("neon".equals(proveedor)) {
                destino = "https://console.neon.tech/api/v2/projects";
                cabeceras.put("Authorization", "Bearer " + t);
            } else if ("mcp".equals(proveedor)) {
                if (url == null || url.trim().isEmpty()) {
                    r.put("ok", false);
                    r.put("estado", "falta URL");
                    r.put("detalle", "Escribe la URL HTTPS del servidor MCP (normalmente termina en /mcp).");
                    return r;
                }
                destino = recortar(url);
                cabeceras.put("Authorization", "Bearer " + t);
                cabeceras.put("Accept", "application/json, text/event-stream");
                metodo = "POST";
                cuerpo = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{"
                        + "\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},"
                        + "\"clientInfo\":{\"name\":\"FABRI-CORE\",\"version\":\"0.9.0\"}}}";
            } else {
                if (url == null || url.trim().isEmpty()) {
                    r.put("ok", false);
                    r.put("estado", "falta URL");
                    r.put("detalle", "Escribe la URL HTTPS del servicio para poder probarlo.");
                    return r;
                }
                destino = recortar(url);
                cabeceras.put("Authorization", "Bearer " + t);
            }

            Respuesta resp = pedir(metodo, destino, cabeceras, cuerpo);
            long ms = System.currentTimeMillis() - inicio;
            r.put("ms", ms);
            r.put("http", resp.codigo);
            r.put("respuesta", recorte(resp.cuerpo, 400));

            if (resp.codigo >= 200 && resp.codigo < 300) {
                r.put("ok", true);
                r.put("estado", "conectado");
                r.put("cuenta", cuenta(proveedor, resp.cuerpo));
                r.put("detalle", "Respondió " + resp.codigo + " en " + ms + " ms.");
            } else {
                r.put("ok", false);
                r.put("estado", "rechazado");
                r.put("detalle", "HTTP " + resp.codigo + ": " + recorte(resp.cuerpo, 200));
            }
            return r;
        } catch (Throwable e) {
            try {
                r.put("ok", false);
                r.put("estado", "sin respuesta");
                r.put("detalle", e.getMessage() == null ? e.toString() : e.getMessage());
                r.put("ms", System.currentTimeMillis() - inicio);
            } catch (Throwable ignorado) {
                // Nada más que informar.
            }
            return r;
        }
    }

    /** Nombre legible de la cuenta, según lo que devolvió cada API. */
    private static String cuenta(String proveedor, String cuerpo) {
        try {
            if ("mcp".equals(proveedor)) {
                JSONObject o = new JSONObject(extraerJson(cuerpo));
                JSONObject res = o.optJSONObject("result");
                JSONObject info = res != null ? res.optJSONObject("serverInfo") : null;
                if (info != null) {
                    String nombre = info.optString("name", "servidor MCP");
                    String version = info.optString("version", "");
                    String protocolo = res.optString("protocolVersion", "");
                    return nombre + (version.isEmpty() ? "" : " " + version)
                            + (protocolo.isEmpty() ? "" : " · protocolo " + protocolo);
                }
                return "handshake MCP aceptado";
            }
            JSONObject o = new JSONObject(cuerpo);
            if ("github".equals(proveedor)) {
                return o.optString("login", "") + " · " + o.optString("name", "");
            }
            if ("vercel".equals(proveedor)) {
                JSONObject u = o.optJSONObject("user");
                if (u != null) {
                    return u.optString("username", u.optString("email", ""));
                }
                return o.optString("username", o.optString("email", ""));
            }
            if ("cloudflare".equals(proveedor)) {
                JSONObject res = o.optJSONObject("result");
                return res != null ? res.optString("status", "token válido") : "token válido";
            }
            if ("meta".equals(proveedor)) {
                return o.optString("name", o.optString("id", ""));
            }
            if ("google".equals(proveedor)) {
                return o.optString("email", o.optString("name", ""));
            }
            if ("supabase".equals(proveedor)) {
                if (o.has("id")) {
                    return o.optString("name", o.optString("id", "proyecto"));
                }
                return "REST respondió";
            }
            if ("neon".equals(proveedor)) {
                org.json.JSONArray p = o.optJSONArray("projects");
                return p != null ? (p.length() + " proyecto(s)") : "API key válida";
            }
        } catch (Throwable ignorado) {
            // Respuesta no JSON: se usa el recorte como detalle.
        }
        return "";
    }

    // ------------------------------------------------------------ código listo

    /**
     * Genera el fragmento de llamada para el proveedor, con el token como
     * marcador. El token real no viaja a JavaScript: se inyecta al ejecutar.
     */
    static JSONObject codigo(String proveedor, String url) {
        JSONObject o = new JSONObject();
        try {
            String destino;
            String cabeceraJs;
            String cabeceraCurl;

            if ("github".equals(proveedor)) {
                destino = "https://api.github.com/user";
                cabeceraJs = "{ Authorization: `Bearer ${TOKEN}`, \"X-GitHub-Api-Version\": \"2022-11-28\" }";
                cabeceraCurl = "-H \"Authorization: Bearer $TOKEN\" -H \"X-GitHub-Api-Version: 2022-11-28\"";
            } else if ("vercel".equals(proveedor)) {
                destino = "https://api.vercel.com/v2/user";
                cabeceraJs = "{ Authorization: `Bearer ${TOKEN}` }";
                cabeceraCurl = "-H \"Authorization: Bearer $TOKEN\"";
            } else if ("cloudflare".equals(proveedor)) {
                destino = "https://api.cloudflare.com/client/v4/user/tokens/verify";
                cabeceraJs = "{ Authorization: `Bearer ${TOKEN}` }";
                cabeceraCurl = "-H \"Authorization: Bearer $TOKEN\"";
            } else if ("supabase".equals(proveedor)) {
                destino = (url == null || url.trim().isEmpty() ? "https://TU-PROYECTO.supabase.co" : recortar(url))
                        + "/rest/v1/tu_tabla?select=*";
                cabeceraJs = "{ apikey: TOKEN, Authorization: `Bearer ${TOKEN}` }";
                cabeceraCurl = "-H \"apikey: $TOKEN\" -H \"Authorization: Bearer $TOKEN\"";
            } else if ("firebase".equals(proveedor)) {
                destino = (url == null || url.trim().isEmpty() ? "https://TU-PROYECTO.firebaseio.com" : recortar(url))
                        + "/tu_ruta.json?auth=${TOKEN}";
                cabeceraJs = "";
                cabeceraCurl = "";
            } else if ("meta".equals(proveedor)) {
                destino = "https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${TOKEN}";
                cabeceraJs = "";
                cabeceraCurl = "";
            } else if ("google".equals(proveedor)) {
                destino = "https://www.googleapis.com/oauth2/v3/userinfo";
                cabeceraJs = "{ Authorization: `Bearer ${TOKEN}` }";
                cabeceraCurl = "-H \"Authorization: Bearer $TOKEN\"";
            } else if ("neon".equals(proveedor)) {
                destino = "https://console.neon.tech/api/v2/projects";
                cabeceraJs = "{ Authorization: `Bearer ${TOKEN}` }";
                cabeceraCurl = "-H \"Authorization: Bearer $TOKEN\"";
            } else if ("mcp".equals(proveedor)) {
                destino = (url == null || url.trim().isEmpty() ? "https://TU-SERVIDOR/mcp" : recortar(url));
                cabeceraJs = "{ Authorization: `Bearer ${TOKEN}`,\n      \"Content-Type\": \"application/json\",\n"
                        + "      Accept: \"application/json, text/event-stream\" }";
                cabeceraCurl = "-H \"Authorization: Bearer $TOKEN\" -H \"Content-Type: application/json\" "
                        + "-H \"Accept: application/json, text/event-stream\"";
            } else {
                destino = (url == null || url.trim().isEmpty() ? "https://TU-SERVICIO" : recortar(url));
                cabeceraJs = "{ Authorization: `Bearer ${TOKEN}` }";
                cabeceraCurl = "-H \"Authorization: Bearer $TOKEN\"";
            }

            String extraJs = "";
            if ("mcp".equals(proveedor)) {
                extraJs = ",\n    method: \"POST\",\n    body: JSON.stringify({\n"
                        + "      jsonrpc: \"2.0\", id: 1, method: \"initialize\",\n"
                        + "      params: { protocolVersion: \"2025-06-18\", capabilities: {},\n"
                        + "                clientInfo: { name: \"FABRI-CORE\", version: \"0.9.0\" } }\n"
                        + "    })";
            }
            String js = "// FABRI-CORE · llamada real a " + proveedor + "\n"
                    + "// El token NO se escribe acá: la app lo inyecta al ejecutar.\n"
                    + "const TOKEN = \"<TOKEN_DE_LA_BOVEDA>\";\n\n"
                    + "async function llamar() {\n"
                    + "  const r = await fetch(\"" + destino + "\""
                    + (cabeceraJs.isEmpty() ? "" : ",\n    headers: " + cabeceraJs)
                    + extraJs
                    + ");\n"
                    + "  if (!r.ok) throw new Error(\"HTTP \" + r.status);\n"
                    + "  return await r.json();\n"
                    + "}\n";

            String curl = "curl -sS \"" + destino + "\""
                    + (cabeceraCurl.isEmpty() ? "" : " \\\n  " + cabeceraCurl) + "\n";

            o.put("ok", true);
            o.put("javascript", js);
            o.put("curl", curl);
            o.put("endpoint", destino);
        } catch (Throwable e) {
            try {
                o.put("ok", false);
                o.put("error", e.getMessage() == null ? e.toString() : e.getMessage());
            } catch (Throwable ignorado) {
                // Nada más que informar.
            }
        }
        return o;
    }

    // -------------------------------------------------------------------- OAuth

    /** Inicia OAuth con PKCE. Sin client ID no hay magia: se avisa claro. */
    static JSONObject iniciarOauth(String proveedor, String clientId, String redireccion) {
        JSONObject r = new JSONObject();
        try {
            if (!soportaOauth(proveedor)) {
                r.put("ok", false);
                r.put("error", "Este proveedor no ofrece OAuth público para apps. Usa un token desde "
                        + "su panel de API (la app te deja el enlace).");
                return r;
            }
            if (clientId == null || clientId.trim().isEmpty()) {
                r.put("ok", false);
                r.put("error", "Falta el Client ID de la app registrada en " + proveedor + ".");
                return r;
            }
            String verifier = aleatorio(48);
            String reto = base64Url(sha256(verifier));
            String estado = aleatorio(16);

            String autorizar;
            String ambito;
            if ("github".equals(proveedor)) {
                autorizar = "https://github.com/login/oauth/authorize";
                ambito = "read:user repo";
            } else if ("google".equals(proveedor)) {
                autorizar = "https://accounts.google.com/o/oauth2/v2/auth";
                ambito = "openid email profile";
            } else {
                autorizar = "https://www.facebook.com/v21.0/dialog/oauth";
                ambito = "public_profile,email";
            }

            String url = autorizar
                    + "?client_id=" + URLEncoder.encode(clientId.trim(), "UTF-8")
                    + "&redirect_uri=" + URLEncoder.encode(redireccion, "UTF-8")
                    + "&response_type=code"
                    + "&scope=" + URLEncoder.encode(ambito, "UTF-8")
                    + "&state=" + estado
                    + "&code_challenge=" + reto
                    + "&code_challenge_method=S256";
            if ("google".equals(proveedor)) {
                url += "&access_type=offline&prompt=consent";
            }

            JSONObject pendiente = new JSONObject();
            pendiente.put("estado", estado);
            pendiente.put("proveedor", proveedor);
            pendiente.put("clientId", clientId.trim());
            pendiente.put("redireccion", redireccion);
            pendiente.put("verifier", verifier);
            pendiente.put("inicio", System.currentTimeMillis() / 1000L);

            r.put("ok", true);
            r.put("url", url);
            r.put("pendiente", pendiente);
            r.put("redireccion", redireccion);
            return r;
        } catch (Throwable e) {
            try {
                r.put("ok", false);
                r.put("error", e.getMessage() == null ? e.toString() : e.getMessage());
            } catch (Throwable ignorado) {
                // Nada más que informar.
            }
            return r;
        }
    }

    /** Canjea el `code` por un token. Devuelve el token o un error legible. */
    static JSONObject canjear(String proveedor, String clientId, String redireccion,
                              String code, String verifier) {
        JSONObject r = new JSONObject();
        try {
            String endpoint;
            if ("github".equals(proveedor)) {
                endpoint = "https://github.com/login/oauth/access_token";
            } else if ("google".equals(proveedor)) {
                endpoint = "https://oauth2.googleapis.com/token";
            } else {
                endpoint = "https://graph.facebook.com/v21.0/oauth/access_token";
            }

            StringBuilder form = new StringBuilder();
            form.append("grant_type=authorization_code");
            form.append("&code=").append(URLEncoder.encode(code, "UTF-8"));
            form.append("&client_id=").append(URLEncoder.encode(clientId, "UTF-8"));
            form.append("&redirect_uri=").append(URLEncoder.encode(redireccion, "UTF-8"));
            if (verifier != null && !verifier.isEmpty()) {
                form.append("&code_verifier=").append(URLEncoder.encode(verifier, "UTF-8"));
            }

            Map<String, String> cabeceras = new LinkedHashMap<String, String>();
            cabeceras.put("Accept", "application/json");
            Respuesta resp = pedir("POST", endpoint, cabeceras, form.toString(), true);
            r.put("http", resp.codigo);
            if (resp.codigo < 200 || resp.codigo >= 300) {
                r.put("ok", false);
                r.put("error", "El proveedor rechazó el canje (HTTP " + resp.codigo + "): "
                        + recorte(resp.cuerpo, 300));
                return r;
            }
            JSONObject o = new JSONObject(resp.cuerpo);
            String token = o.optString("access_token", "");
            if (token.isEmpty()) {
                r.put("ok", false);
                r.put("error", "La respuesta no trae access_token: " + recorte(resp.cuerpo, 300));
                return r;
            }
            r.put("ok", true);
            r.put("token", token);
            if (o.has("refresh_token")) {
                r.put("refresh", o.optString("refresh_token", ""));
            }
            if (o.has("expires_in")) {
                r.put("expira", System.currentTimeMillis() / 1000L + o.optLong("expires_in", 0));
            }
            return r;
        } catch (Throwable e) {
            try {
                r.put("ok", false);
                r.put("error", e.getMessage() == null ? e.toString() : e.getMessage());
            } catch (Throwable ignorado) {
                // Nada más que informar.
            }
            return r;
        }
    }

    // ------------------------------------------------- Google sin redirect

    /**
     * Google "TV and Limited Input devices": no necesita redirect URI.
     * Devuelve un código que el usuario escribe en google.com/device.
     * Es el único flujo de Google que funciona en una app sin SDK ni servidor.
     */
    static JSONObject googleDeviceIniciar(String clientId) {
        JSONObject r = new JSONObject();
        try {
            if (clientId == null || clientId.trim().isEmpty()) {
                r.put("ok", false);
                r.put("error", "Falta el Client ID de un cliente OAuth de tipo "
                        + "«TVs and Limited Input devices».");
                return r;
            }
            StringBuilder form = new StringBuilder();
            form.append("client_id=").append(URLEncoder.encode(clientId.trim(), "UTF-8"));
            form.append("&scope=").append(URLEncoder.encode("openid email profile", "UTF-8"));
            Map<String, String> cabeceras = new LinkedHashMap<String, String>();
            Respuesta resp = pedir("POST", "https://oauth2.googleapis.com/device/code",
                    cabeceras, form.toString(), true);
            if (resp.codigo < 200 || resp.codigo >= 300) {
                r.put("ok", false);
                r.put("error", "Google rechazó la solicitud (HTTP " + resp.codigo + "): "
                        + recorte(resp.cuerpo, 300));
                return r;
            }
            JSONObject o = new JSONObject(resp.cuerpo);
            r.put("ok", true);
            r.put("deviceCode", o.optString("device_code", ""));
            r.put("userCode", o.optString("user_code", ""));
            r.put("url", o.optString("verification_url",
                    "https://www.google.com/device"));
            r.put("intervalo", Math.max(5, o.optInt("interval", 5)));
            r.put("expira", o.optLong("expires_in", 1800));
            return r;
        } catch (Throwable e) {
            try {
                r.put("ok", false);
                r.put("error", e.getMessage() == null ? e.toString() : e.getMessage());
            } catch (Throwable ignorado) {
                // Nada más que informar.
            }
            return r;
        }
    }

    /** Una consulta del device flow. `pendiente` significa «todavía no autoriza». */
    static JSONObject googleDeviceConsultar(String clientId, String deviceCode) {
        JSONObject r = new JSONObject();
        try {
            StringBuilder form = new StringBuilder();
            form.append("client_id=").append(URLEncoder.encode(clientId, "UTF-8"));
            form.append("&device_code=").append(URLEncoder.encode(deviceCode, "UTF-8"));
            form.append("&grant_type=").append(URLEncoder.encode(
                    "urn:ietf:params:oauth:grant-type:device_code", "UTF-8"));
            Map<String, String> cabeceras = new LinkedHashMap<String, String>();
            Respuesta resp = pedir("POST", "https://oauth2.googleapis.com/token",
                    cabeceras, form.toString(), true);
            JSONObject o = new JSONObject(resp.cuerpo == null || resp.cuerpo.isEmpty()
                    ? "{}" : resp.cuerpo);
            String error = o.optString("error", "");
            if ("authorization_pending".equals(error) || "slow_down".equals(error)) {
                r.put("ok", false);
                r.put("pendiente", true);
                r.put("error", "Todavía no autorizaste en el navegador.");
                return r;
            }
            if ("access_denied".equals(error)) {
                r.put("ok", false);
                r.put("error", "Cancelaste la autorización en Google.");
                return r;
            }
            if ("expired_token".equals(error)) {
                r.put("ok", false);
                r.put("error", "El código venció. Genera uno nuevo.");
                return r;
            }
            String token = o.optString("access_token", "");
            if (token.isEmpty()) {
                r.put("ok", false);
                r.put("error", "Google no devolvió token: " + recorte(resp.cuerpo, 300));
                return r;
            }
            r.put("ok", true);
            r.put("token", token);
            if (o.has("refresh_token")) {
                r.put("refresh", o.optString("refresh_token", ""));
            }
            return r;
        } catch (Throwable e) {
            try {
                r.put("ok", false);
                r.put("error", e.getMessage() == null ? e.toString() : e.getMessage());
            } catch (Throwable ignorado) {
                // Nada más que informar.
            }
            return r;
        }
    }

    // ------------------------------------------------------------------- HTTP

    static final class Respuesta {
        int codigo;
        String cuerpo = "";
    }

    static Respuesta pedir(String metodo, String destino, Map<String, String> cabeceras, String cuerpo) {
        return pedir(metodo, destino, cabeceras, cuerpo, false);
    }

    /**
     * HTTPS obligatorio. `form` indica cuerpo application/x-www-form-urlencoded
     * (lo exigen los endpoints de token OAuth).
     */
    static Respuesta pedir(String metodo, String destino, Map<String, String> cabeceras,
                           String cuerpo, boolean form) {
        Respuesta r = new Respuesta();
        HttpURLConnection con = null;
        try {
            URL u = new URL(destino);
            if (!"https".equalsIgnoreCase(u.getProtocol())) {
                throw new IllegalArgumentException("sólo se permite HTTPS");
            }
            con = (HttpURLConnection) u.openConnection();
            con.setRequestMethod(metodo);
            con.setConnectTimeout(CONECTAR_MS);
            con.setReadTimeout(LEER_MS);
            con.setRequestProperty("Accept", "application/json");
            con.setRequestProperty("User-Agent", "FABRI-CORE/0.9.0 (Android)");
            if (cabeceras != null) {
                for (Map.Entry<String, String> e : cabeceras.entrySet()) {
                    if (e.getKey() != null && e.getValue() != null) {
                        con.setRequestProperty(e.getKey(), e.getValue());
                    }
                }
            }
            if (cuerpo != null) {
                byte[] bytes = cuerpo.getBytes(Charset.forName("UTF-8"));
                con.setDoOutput(true);
                con.setRequestProperty("Content-Type", form
                        ? "application/x-www-form-urlencoded; charset=utf-8"
                        : "application/json; charset=utf-8");
                con.setFixedLengthStreamingMode(bytes.length);
                OutputStream out = con.getOutputStream();
                out.write(bytes);
                out.flush();
                out.close();
            }
            r.codigo = con.getResponseCode();
            InputStream flujo = r.codigo >= 200 && r.codigo < 300 ? con.getInputStream() : con.getErrorStream();
            r.cuerpo = leer(flujo);
            return r;
        } catch (Throwable e) {
            r.codigo = 0;
            r.cuerpo = e.getMessage() == null ? e.toString() : e.getMessage();
            return r;
        } finally {
            if (con != null) {
                con.disconnect();
            }
        }
    }

    private static String leer(InputStream flujo) {
        if (flujo == null) {
            return "";
        }
        try {
            ByteArrayOutputStream acumulador = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int n;
            while ((n = flujo.read(buffer)) > 0) {
                acumulador.write(buffer, 0, n);
                if (acumulador.size() > MAX_CUERPO) {
                    break;
                }
            }
            flujo.close();
            return new String(acumulador.toByteArray(), Charset.forName("UTF-8"));
        } catch (Throwable e) {
            return "";
        }
    }

    // --------------------------------------------------------------- utilidades

    private static String recortar(String url) {
        String u = url == null ? "" : url.trim();
        while (u.endsWith("/")) {
            u = u.substring(0, u.length() - 1);
        }
        return u;
    }

    private static String recorte(String texto, int max) {
        if (texto == null) {
            return "";
        }
        String limpio = texto.replace('\n', ' ').replace('\r', ' ').trim();
        return limpio.length() <= max ? limpio : limpio.substring(0, max) + "…";
    }

    /** Los servidores MCP pueden responder JSON o SSE (`data: {...}`). */
    private static String extraerJson(String cuerpo) {
        if (cuerpo == null) {
            return "{}";
        }
        String t = cuerpo.trim();
        if (t.startsWith("{")) {
            return t;
        }
        String[] lineas = t.split("\n");
        for (String linea : lineas) {
            String l = linea.trim();
            if (l.startsWith("data:")) {
                String dato = l.substring(5).trim();
                if (dato.startsWith("{")) {
                    return dato;
                }
            }
        }
        return "{}";
    }

    private static String aleatorio(int bytes) {
        byte[] b = new byte[bytes];
        new SecureRandom().nextBytes(b);
        return base64Url(b);
    }

    private static byte[] sha256(String texto) throws Exception {
        return MessageDigest.getInstance("SHA-256").digest(texto.getBytes(Charset.forName("US-ASCII")));
    }

    private static String base64Url(byte[] datos) {
        return android.util.Base64.encodeToString(datos,
                android.util.Base64.URL_SAFE | android.util.Base64.NO_WRAP | android.util.Base64.NO_PADDING);
    }

    /** Extrae el `code` del redirect que vuelve del navegador. */
    static JSONObject parametros(Uri uri) {
        JSONObject o = new JSONObject();
        if (uri == null) {
            return o;
        }
        try {
            for (String clave : new String[]{"code", "state", "error", "error_description"}) {
                String v = uri.getQueryParameter(clave);
                if (v != null) {
                    o.put(clave, v);
                }
            }
        } catch (Throwable ignorado) {
            // Uri nula o sin query.
        }
        return o;
    }
}
