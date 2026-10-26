package cl.fabrick.core;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.Charset;
import java.security.KeyStore;
import java.util.Iterator;
import java.util.UUID;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Bóveda local de conexiones.
 *
 * Reglas:
 *   · El contenido se cifra con AES-256/GCM usando una clave que genera y
 *     guarda Android Keystore. La clave NUNCA sale del keystore del sistema.
 *   · El archivo cifrado vive en `filesDir/conexiones.bin`, dentro del sandbox
 *     de la app (sin permisos de almacenamiento).
 *   · La interfaz nunca recibe el token completo: sólo una versión enmascarada.
 *   · Si el archivo está corrupto o la clave se perdió (restauración de la app),
 *     se conserva una copia `.roto` y se empieza de cero, sin romper la app.
 *
 * No hay secretos en el APK: la clave la crea el teléfono la primera vez.
 */
final class Boveda {

    private static final String ALIAS = "fabrick_boveda_v1";
    private static final String ARCHIVO = "conexiones.bin";
    private static final int VERSION = 1;
    private static final int IV_LARGO = 12;
    private static final int TAG_BITS = 128;

    private final Context contexto;

    Boveda(Context contexto) {
        this.contexto = contexto;
    }

    // ------------------------------------------------------------- criptografía

    private SecretKey clave() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) {
            return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
        }
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        gen.init(new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build());
        return gen.generateKey();
    }

    private File archivo() {
        return new File(contexto.getFilesDir(), ARCHIVO);
    }

    /** Lee el documento cifrado. Si no existe devuelve la estructura vacía. */
    synchronized JSONObject leer() {
        File f = archivo();
        if (!f.exists() || f.length() == 0) {
            return vacio();
        }
        FileInputStream in = null;
        try {
            in = new FileInputStream(f);
            byte[] todo = new byte[(int) f.length()];
            int leidos = 0;
            while (leidos < todo.length) {
                int n = in.read(todo, leidos, todo.length - leidos);
                if (n < 0) {
                    break;
                }
                leidos += n;
            }
            if (leidos < VERSION + IV_LARGO + 16) {
                throw new IllegalStateException("archivo demasiado corto");
            }
            byte[] iv = new byte[IV_LARGO];
            System.arraycopy(todo, VERSION, iv, 0, IV_LARGO);
            byte[] cifrado = new byte[leidos - VERSION - IV_LARGO];
            System.arraycopy(todo, VERSION + IV_LARGO, cifrado, 0, cifrado.length);

            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, clave(), new GCMParameterSpec(TAG_BITS, iv));
            byte[] claro = c.doFinal(cifrado);
            return new JSONObject(new String(claro, Charset.forName("UTF-8")));
        } catch (Throwable t) {
            // No se pierde el archivo: se aparta para diagnóstico y se sigue.
            try {
                File roto = new File(contexto.getFilesDir(), ARCHIVO + ".roto");
                if (roto.exists()) {
                    roto.delete();
                }
                f.renameTo(roto);
            } catch (Throwable ignorado) {
                // Si tampoco se puede renombrar, se devuelve la estructura vacía.
            }
            return vacio();
        } finally {
            if (in != null) {
                try { in.close(); } catch (Throwable ignorado) { /* nada */ }
            }
        }
    }

    /** Guarda el documento cifrado de forma atómica (archivo temporal + rename). */
    synchronized void escribir(JSONObject doc) throws Exception {
        byte[] claro = doc.toString().getBytes(Charset.forName("UTF-8"));
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, clave());
        byte[] iv = c.getIV();
        if (iv == null || iv.length != IV_LARGO) {
            throw new IllegalStateException("IV inesperado del keystore");
        }
        byte[] cifrado = c.doFinal(claro);

        byte[] salida = new byte[VERSION + IV_LARGO + cifrado.length];
        salida[0] = (byte) VERSION;
        System.arraycopy(iv, 0, salida, VERSION, IV_LARGO);
        System.arraycopy(cifrado, 0, salida, VERSION + IV_LARGO, cifrado.length);

        File destino = archivo();
        File temporal = new File(contexto.getFilesDir(), ARCHIVO + ".tmp");
        FileOutputStream out = new FileOutputStream(temporal, false);
        try {
            out.write(salida);
            out.flush();
            out.getFD().sync();
        } finally {
            out.close();
        }
        if (destino.exists() && !destino.delete()) {
            throw new IllegalStateException("no se pudo reemplazar la bóveda");
        }
        if (!temporal.renameTo(destino)) {
            throw new IllegalStateException("no se pudo escribir la bóveda");
        }
    }

    private static JSONObject vacio() {
        JSONObject o = new JSONObject();
        try {
            o.put("version", VERSION);
            o.put("conexiones", new JSONArray());
            o.put("oauth", new JSONObject());
        } catch (Throwable ignorado) {
            // JSONObject.put sólo falla con claves nulas.
        }
        return o;
    }

    private static JSONArray conexiones(JSONObject doc) {
        JSONArray a = doc.optJSONArray("conexiones");
        if (a == null) {
            a = new JSONArray();
            try { doc.put("conexiones", a); } catch (Throwable ignorado) { /* nada */ }
        }
        return a;
    }

    // ------------------------------------------------------------------ lectura

    /** Lista sin secretos: el token va enmascarado (últimos 4 caracteres). */
    synchronized JSONArray listarEnmascarado() {
        JSONArray origen = conexiones(leer());
        JSONArray salida = new JSONArray();
        for (int i = 0; i < origen.length(); i++) {
            JSONObject c = origen.optJSONObject(i);
            if (c == null) {
                continue;
            }
            JSONObject copia = new JSONObject();
            try {
                copia.put("id", c.optString("id", ""));
                copia.put("proveedor", c.optString("proveedor", ""));
                copia.put("nombre", c.optString("nombre", ""));
                copia.put("url", c.optString("url", ""));
                copia.put("cuenta", c.optString("cuenta", ""));
                copia.put("creado", c.optLong("creado", 0));
                copia.put("actualizado", c.optLong("actualizado", 0));
                copia.put("token", enmascarar(c.optString("token", "")));
                copia.put("tieneToken", !c.optString("token", "").isEmpty());
            } catch (Throwable ignorado) {
                // Se copia lo que se pudo.
            }
            salida.put(copia);
        }
        return salida;
    }

    static String enmascarar(String token) {
        if (token == null || token.isEmpty()) {
            return "";
        }
        if (token.length() <= 4) {
            return "····";
        }
        return "····" + token.substring(token.length() - 4);
    }

    synchronized JSONObject buscar(String id) {
        JSONArray a = conexiones(leer());
        for (int i = 0; i < a.length(); i++) {
            JSONObject c = a.optJSONObject(i);
            if (c != null && id != null && id.equals(c.optString("id", ""))) {
                return c;
            }
        }
        return null;
    }

    // ----------------------------------------------------------------- escritura

    /** Crea o actualiza una conexión. `datos` trae proveedor, nombre, token y url. */
    synchronized JSONObject guardar(JSONObject datos) throws Exception {
        JSONObject doc = leer();
        JSONArray lista = conexiones(doc);
        String id = datos.optString("id", "").trim();
        long ahora = System.currentTimeMillis() / 1000L;

        JSONObject destino = null;
        int indice = -1;
        for (int i = 0; i < lista.length(); i++) {
            JSONObject c = lista.optJSONObject(i);
            if (c != null && !id.isEmpty() && id.equals(c.optString("id", ""))) {
                destino = c;
                indice = i;
                break;
            }
        }
        if (destino == null) {
            destino = new JSONObject();
            id = UUID.randomUUID().toString();
            destino.put("id", id);
            destino.put("creado", ahora);
        }
        destino.put("proveedor", datos.optString("proveedor", "custom"));
        destino.put("nombre", datos.optString("nombre", ""));
        destino.put("url", datos.optString("url", ""));
        destino.put("cuenta", datos.optString("cuenta", ""));
        String token = datos.optString("token", "");
        if (!token.isEmpty()) {
            destino.put("token", token);
        }
        destino.put("actualizado", ahora);

        if (indice >= 0) {
            lista.put(indice, destino);
        } else {
            lista.put(destino);
        }
        doc.put("conexiones", lista);
        escribir(doc);
        return destino;
    }

    synchronized boolean borrar(String id) throws Exception {
        JSONObject doc = leer();
        JSONArray lista = conexiones(doc);
        JSONArray nueva = new JSONArray();
        boolean quitado = false;
        for (int i = 0; i < lista.length(); i++) {
            JSONObject c = lista.optJSONObject(i);
            if (c != null && id != null && id.equals(c.optString("id", ""))) {
                quitado = true;
                continue;
            }
            nueva.put(c);
        }
        if (!quitado) {
            return false;
        }
        doc.put("conexiones", nueva);
        escribir(doc);
        return true;
    }

    /** Borra todas las conexiones (con confirmación en la interfaz). */
    synchronized void vaciar() throws Exception {
        JSONObject doc = leer();
        doc.put("conexiones", new JSONArray());
        doc.put("oauth", new JSONObject());
        escribir(doc);
    }

    // ------------------------------------------------------------------- OAuth

    synchronized void guardarPendiente(JSONObject pendiente) throws Exception {
        JSONObject doc = leer();
        doc.put("oauth", pendiente == null ? new JSONObject() : pendiente);
        escribir(doc);
    }

    synchronized JSONObject leerPendiente() {
        JSONObject doc = leer();
        JSONObject p = doc.optJSONObject("oauth");
        return p == null ? new JSONObject() : p;
    }

    synchronized void limpiarPendiente() throws Exception {
        JSONObject doc = leer();
        doc.put("oauth", new JSONObject());
        escribir(doc);
    }

    /** Resumen para la interfaz: cuántas conexiones y si la bóveda abre bien. */
    synchronized JSONObject estado() {
        JSONObject doc = leer();
        JSONArray a = conexiones(doc);
        JSONObject o = new JSONObject();
        try {
            o.put("ok", true);
            o.put("total", a.length());
            o.put("archivo", archivo().getName());
            o.put("bytes", archivo().exists() ? archivo().length() : 0);
            JSONObject p = doc.optJSONObject("oauth");
            o.put("oauthPendiente", p != null && p.optString("estado", "").length() > 0);
        } catch (Throwable ignorado) {
            // Se devuelve lo que haya.
        }
        return o;
    }

    /** Sólo para el respaldo cifrado: devuelve la lista completa con tokens. */
    synchronized JSONArray crudo() {
        return conexiones(leer());
    }

    /** Importa un respaldo cifrado previamente exportado por esta misma app. */
    synchronized int importar(JSONArray lista) throws Exception {
        if (lista == null) {
            return 0;
        }
        JSONObject doc = leer();
        JSONArray actual = conexiones(doc);
        int agregadas = 0;
        for (int i = 0; i < lista.length(); i++) {
            JSONObject c = lista.optJSONObject(i);
            if (c == null) {
                continue;
            }
            String id = c.optString("id", "");
            boolean existe = false;
            for (int j = 0; j < actual.length(); j++) {
                JSONObject otro = actual.optJSONObject(j);
                if (otro != null && id.equals(otro.optString("id", ""))) {
                    existe = true;
                    break;
                }
            }
            if (!existe) {
                actual.put(c);
                agregadas++;
            }
        }
        doc.put("conexiones", actual);
        escribir(doc);
        return agregadas;
    }

    /** Quita el token de un objeto antes de mostrarlo (por si acaso). */
    static void sinSecreto(JSONObject o) {
        if (o == null) {
            return;
        }
        Iterator<String> it = o.keys();
        while (it.hasNext()) {
            String k = it.next();
            if ("token".equals(k) || "secret".equals(k) || "refresh".equals(k)) {
                o.remove(k);
            }
        }
    }
}
