package cl.fabrick.core;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.provider.OpenableColumns;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * FORGE CORE STOCK · importación de bases desde la SD.
 *
 * <p>El selector de archivos de Android entrega una URI, no una ruta. Para
 * poder abrir SQLite y ZIP hace falta un archivo real, así que se copia a la
 * caché de la app (máximo 80 MB) y se trabaja sobre la copia. El original no
 * se toca nunca.
 *
 * <p>Formatos:
 * <ul>
 *   <li>SQLite (.db/.sqlite/.sqlite3): se listan las tablas, se elige una y se
 *       leen las filas con su nombre de columna original.</li>
 *   <li>Excel .xlsx: se leen las hojas con {@link LectorXlsx}.</li>
 *   <li>CSV/TSV/TXT/JSON: se devuelve el texto ya decodificado (UTF-8 o
 *       Windows-1252) y la interfaz reutiliza su parser.</li>
 * </ul>
 */
final class ImportadorBase {

    private static final long MAX_BYTES = 80L * 1024L * 1024L;
    private static final int MAX_TEXTO = 12 * 1024 * 1024;
    private static final int MAX_TABLAS = 80;
    private static final int MAX_FILAS_JSON = 20000;
    private static final int MAX_BYTES_JSON = 8 * 1024 * 1024;

    private static File ultimoArchivo;
    private static String ultimoNombre = "";
    private static SQLiteDatabase ultimaBase;
    private static List<String> ultimasTablas = new ArrayList<String>();

    private ImportadorBase() {
    }

    /** Copia la URI elegida y devuelve qué contiene. */
    static synchronized JSONObject inspeccionar(Context contexto, Uri uri) throws Exception {
        cerrar();
        String nombre = nombreDe(contexto, uri);
        String ext = extension(nombre);
        File copia = copiar(contexto, uri, ext);
        ultimoArchivo = copia;
        ultimoNombre = nombre;

        JSONObject r;
        if (esSqlite(copia)) {
            r = inspeccionarSqlite(copia, nombre);
        } else if ("xlsx".equals(ext) || esZip(copia)) {
            r = inspeccionarXlsx(copia, nombre);
        } else if ("xls".equals(ext)) {
            throw new IllegalArgumentException(
                    "El formato .xls antiguo no se puede leer. Abrí el archivo en Excel "
                            + "y guardalo como .xlsx o CSV.");
        } else {
            r = inspeccionarTexto(copia, nombre, ext);
        }
        r.put("archivo", nombre);
        r.put("bytes", copia.length());
        return r;
    }

    /** Lee una tabla SQLite ya inspeccionada. */
    static synchronized JSONObject leerTabla(String tabla, int limite, int offset) {
        JSONObject r = new JSONObject();
        try {
            if (ultimoArchivo == null || !ultimoArchivo.isFile()) {
                throw new IllegalStateException("elegí un archivo primero");
            }
            if (!ultimasTablas.contains(tabla)) {
                throw new IllegalArgumentException("la tabla no pertenece al archivo elegido");
            }
            int tope = Math.min(Math.max(limite, 1), MAX_FILAS_JSON);
            int desde = Math.max(offset, 0);
            SQLiteDatabase db = base();
            int total = contar(db, tabla);

            JSONArray filas = new JSONArray();
            Cursor c = null;
            try {
                c = db.rawQuery("SELECT * FROM " + citar(tabla) + " LIMIT " + tope
                        + " OFFSET " + desde, null);
                String[] columnas = c.getColumnNames();
                while (c.moveToNext() && filas.length() < tope) {
                    JSONObject fila = new JSONObject();
                    for (int i = 0; i < columnas.length; i++) {
                        fila.put(columnas[i], valor(c, i));
                    }
                    filas.put(fila);
                }
            } finally {
                if (c != null) {
                    c.close();
                }
            }
            r.put("ok", true);
            r.put("tabla", tabla);
            r.put("filas", filas);
            r.put("total", total);
            r.put("limite", tope);
            r.put("offset", desde);
            r.put("truncado", desde + filas.length() < total);
        } catch (Throwable t) {
            try {
                r.put("ok", false);
                r.put("error", mensaje(t));
            } catch (Throwable ignorado) {
                // sin más.
            }
        }
        return r;
    }

    static synchronized void cerrar() {
        if (ultimaBase != null) {
            try {
                ultimaBase.close();
            } catch (Throwable ignorado) {
                // sin más.
            }
            ultimaBase = null;
        }
        ultimasTablas = new ArrayList<String>();
        if (ultimoArchivo != null) {
            try {
                ultimoArchivo.delete();
            } catch (Throwable ignorado) {
                // sin más.
            }
            ultimoArchivo = null;
        }
    }

    // ------------------------------------------------------------------ SQLite

    private static JSONObject inspeccionarSqlite(File archivo, String nombre) throws Exception {
        SQLiteDatabase db = abrir(archivo);
        ultimaBase = db;

        List<String> tablas = new ArrayList<String>();
        Cursor c = null;
        try {
            c = db.rawQuery("SELECT name FROM sqlite_master WHERE type='table' "
                    + "AND name NOT LIKE 'sqlite_%' ORDER BY name", null);
            while (c.moveToNext() && tablas.size() < MAX_TABLAS) {
                tablas.add(c.getString(0));
            }
        } finally {
            if (c != null) {
                c.close();
            }
        }
        ultimasTablas = tablas;

        JSONArray lista = new JSONArray();
        String recomendada = "";
        int mejorPuntaje = 0;
        for (String tabla : tablas) {
            JSONObject o = new JSONObject();
            o.put("nombre", tabla);
            o.put("filas", contar(db, tabla));
            JSONArray columnas = columnas(db, tabla);
            o.put("columnas", columnas);
            o.put("muestra", muestra(db, tabla, 5));
            int puntaje = puntaje(columnas);
            o.put("puntaje", puntaje);
            if (puntaje > mejorPuntaje) {
                mejorPuntaje = puntaje;
                recomendada = tabla;
            }
            lista.put(o);
        }
        if (recomendada.isEmpty() && tablas.size() > 0) {
            recomendada = tablas.get(0);
        }

        JSONObject r = new JSONObject();
        r.put("ok", true);
        r.put("tipo", "sqlite");
        r.put("archivo", nombre);
        r.put("tablas", lista);
        r.put("recomendada", recomendada);
        r.put("aviso", lista.length() == 0
                ? "La base no tiene tablas visibles."
                : "");
        return r;
    }

    private static SQLiteDatabase abrir(File archivo) {
        try {
            return SQLiteDatabase.openDatabase(archivo.getAbsolutePath(), null,
                    SQLiteDatabase.OPEN_READONLY);
        } catch (Throwable t) {
            throw new IllegalStateException("no se pudo abrir la base SQLite: " + mensaje(t));
        }
    }

    private static SQLiteDatabase base() {
        if (ultimaBase != null && ultimaBase.isOpen()) {
            return ultimaBase;
        }
        if (ultimoArchivo == null) {
            throw new IllegalStateException("elegí un archivo primero");
        }
        ultimaBase = abrir(ultimoArchivo);
        return ultimaBase;
    }

    private static int contar(SQLiteDatabase db, String tabla) {
        Cursor c = null;
        try {
            c = db.rawQuery("SELECT COUNT(*) FROM " + citar(tabla), null);
            return c.moveToFirst() ? c.getInt(0) : 0;
        } catch (Throwable t) {
            return 0;
        } finally {
            if (c != null) {
                c.close();
            }
        }
    }

    private static JSONArray columnas(SQLiteDatabase db, String tabla) {
        JSONArray salida = new JSONArray();
        Cursor c = null;
        try {
            c = db.rawQuery("PRAGMA table_info(" + citar(tabla) + ")", null);
            while (c.moveToNext()) {
                // name en la columna 1, type en la 2.
                salida.put(c.getString(1));
            }
        } catch (Throwable t) {
            // sin columnas: la tabla se muestra igual.
        } finally {
            if (c != null) {
                c.close();
            }
        }
        return salida;
    }

    private static JSONArray muestra(SQLiteDatabase db, String tabla, int limite) {
        JSONArray salida = new JSONArray();
        Cursor c = null;
        try {
            c = db.rawQuery("SELECT * FROM " + citar(tabla) + " LIMIT " + limite, null);
            String[] columnas = c.getColumnNames();
            while (c.moveToNext()) {
                JSONObject fila = new JSONObject();
                for (int i = 0; i < columnas.length; i++) {
                    fila.put(columnas[i], valor(c, i));
                }
                salida.put(fila);
            }
        } catch (Throwable t) {
            // la muestra es opcional.
        } finally {
            if (c != null) {
                c.close();
            }
        }
        return salida;
    }

    private static Object valor(Cursor c, int i) {
        try {
            switch (c.getType(i)) {
                case Cursor.FIELD_TYPE_NULL:
                    return JSONObject.NULL;
                case Cursor.FIELD_TYPE_INTEGER:
                    return c.getLong(i);
                case Cursor.FIELD_TYPE_FLOAT:
                    return c.getDouble(i);
                case Cursor.FIELD_TYPE_BLOB:
                    return "[binario]";
                case Cursor.FIELD_TYPE_STRING:
                default:
                    return c.getString(i) == null ? "" : c.getString(i);
            }
        } catch (Throwable t) {
            return "";
        }
    }

    /** Cuenta columnas que parecen de producto; sirve para recomendar tabla. */
    private static int puntaje(JSONArray columnas) {
        int puntos = 0;
        for (int i = 0; i < columnas.length(); i++) {
            String c = columnas.optString(i, "").toLowerCase();
            if (c.contains("nombre") || c.contains("producto") || c.contains("descrip")) {
                puntos += 4;
            } else if (c.contains("codigo") || c.contains("barras") || c.contains("ean")
                    || c.contains("sku")) {
                puntos += 3;
            } else if (c.contains("precio") || c.contains("venta")) {
                puntos += 2;
            } else if (c.contains("stock") || c.contains("existen") || c.contains("cantidad")) {
                puntos += 1;
            }
        }
        return puntos;
    }

    private static String citar(String tabla) {
        return "\"" + String.valueOf(tabla).replace("\"", "\"\"") + "\"";
    }

    // ------------------------------------------------------------------- XLSX

    private static JSONObject inspeccionarXlsx(File archivo, String nombre) throws Exception {
        List<LectorXlsx.Hoja> hojas;
        try {
            hojas = LectorXlsx.leer(archivo);
        } catch (Throwable t) {
            throw new IllegalStateException("no se pudo leer el Excel: " + mensaje(t));
        }

        JSONArray lista = new JSONArray();
        int presupuesto = MAX_BYTES_JSON;
        String recomendada = hojas.size() > 0 ? hojas.get(0).nombre : "";
        for (LectorXlsx.Hoja hoja : hojas) {
            JSONArray filas = new JSONArray();
            boolean truncada = hoja.truncada;
            for (List<String> fila : hoja.filas) {
                if (filas.length() >= MAX_FILAS_JSON) {
                    truncada = true;
                    break;
                }
                JSONArray valores = new JSONArray();
                for (String v : fila) {
                    valores.put(v == null ? "" : v);
                }
                presupuesto -= valores.toString().length() + 4;
                if (presupuesto <= 0) {
                    truncada = true;
                    break;
                }
                filas.put(valores);
            }
            JSONObject o = new JSONObject();
            o.put("nombre", hoja.nombre);
            o.put("filas", filas);
            o.put("total", hoja.filas.size());
            o.put("truncada", truncada);
            lista.put(o);
        }

        JSONObject r = new JSONObject();
        r.put("ok", true);
        r.put("tipo", "xlsx");
        r.put("archivo", nombre);
        r.put("hojas", lista);
        r.put("recomendada", recomendada);
        return r;
    }

    // ------------------------------------------------------------------ texto

    private static JSONObject inspeccionarTexto(File archivo, String nombre, String ext) throws Exception {
        byte[] bytes = leerBytes(archivo, MAX_TEXTO);
        String texto = decodificar(bytes);
        boolean truncado = archivo.length() > MAX_TEXTO;

        JSONObject r = new JSONObject();
        r.put("ok", true);
        r.put("tipo", "texto");
        r.put("archivo", nombre);
        r.put("extension", ext);
        r.put("texto", texto);
        r.put("truncado", truncado);
        return r;
    }

    private static String decodificar(byte[] bytes) {
        if (bytes.length >= 3 && (bytes[0] & 0xFF) == 0xEF
                && (bytes[1] & 0xFF) == 0xBB && (bytes[2] & 0xFF) == 0xBF) {
            return new String(bytes, 3, bytes.length - 3, Charset.forName("UTF-8"));
        }
        if (bytes.length >= 2 && (bytes[0] & 0xFF) == 0xFF && (bytes[1] & 0xFF) == 0xFE) {
            return new String(bytes, 2, bytes.length - 2, Charset.forName("UTF-16LE"));
        }
        if (bytes.length >= 2 && (bytes[0] & 0xFF) == 0xFE && (bytes[1] & 0xFF) == 0xFF) {
            return new String(bytes, 2, bytes.length - 2, Charset.forName("UTF-16BE"));
        }
        try {
            return Charset.forName("UTF-8").newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes)).toString();
        } catch (CharacterCodingException e) {
            // Los POS chilenos suelen exportar en Windows-1252.
            return new String(bytes, Charset.forName("windows-1252"));
        }
    }

    // ------------------------------------------------------------------ archivo

    private static String nombreDe(Context contexto, Uri uri) {
        String nombre = "";
        Cursor c = null;
        try {
            c = contexto.getContentResolver().query(uri,
                    new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null);
            if (c != null && c.moveToFirst()) {
                nombre = c.getString(0);
            }
        } catch (Throwable ignorado) {
            // se usa el último segmento de la URI.
        } finally {
            if (c != null) {
                c.close();
            }
        }
        if (nombre == null || nombre.trim().isEmpty()) {
            nombre = uri.getLastPathSegment();
        }
        if (nombre == null || nombre.trim().isEmpty()) {
            nombre = "archivo";
        }
        // Sin rutas: sólo el nombre visible.
        int barra = nombre.lastIndexOf('/');
        if (barra >= 0) {
            nombre = nombre.substring(barra + 1);
        }
        return nombre;
    }

    private static File copiar(Context contexto, Uri uri, String ext) throws Exception {
        File dir = new File(contexto.getCacheDir(), "importar");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IllegalStateException("no se pudo preparar la carpeta temporal");
        }
        File[] viejos = dir.listFiles();
        if (viejos != null) {
            for (File f : viejos) {
                try {
                    f.delete();
                } catch (Throwable ignorado) {
                    // sin más.
                }
            }
        }
        File destino = new File(dir, "base-" + System.currentTimeMillis()
                + (ext.isEmpty() ? "" : "." + ext));

        InputStream in = null;
        OutputStream out = null;
        long total = 0L;
        try {
            in = contexto.getContentResolver().openInputStream(uri);
            if (in == null) {
                throw new IllegalStateException("no se pudo abrir el archivo elegido");
            }
            out = new FileOutputStream(destino);
            byte[] buffer = new byte[64 * 1024];
            int leidos;
            while ((leidos = in.read(buffer)) > 0) {
                total += leidos;
                if (total > MAX_BYTES) {
                    throw new IllegalStateException("el archivo supera 80 MB; exportá sólo la tabla de productos");
                }
                out.write(buffer, 0, leidos);
            }
            out.flush();
        } finally {
            if (in != null) {
                try {
                    in.close();
                } catch (Throwable ignorado) {
                    // sin más.
                }
            }
            if (out != null) {
                try {
                    out.close();
                } catch (Throwable ignorado) {
                    // sin más.
                }
            }
        }
        if (total == 0L) {
            throw new IllegalStateException("el archivo está vacío");
        }
        return destino;
    }

    private static boolean esSqlite(File archivo) {
        byte[] cabecera = leerBytes(archivo, 16);
        if (cabecera.length < 16) {
            return false;
        }
        String firma = new String(cabecera, 0, 15, Charset.forName("US-ASCII"));
        return "SQLite format 3".equals(firma);
    }

    private static boolean esZip(File archivo) {
        byte[] cabecera = leerBytes(archivo, 4);
        return cabecera.length == 4 && (cabecera[0] & 0xFF) == 0x50
                && (cabecera[1] & 0xFF) == 0x4B
                && (cabecera[2] & 0xFF) == 0x03
                && (cabecera[3] & 0xFF) == 0x04;
    }

    private static byte[] leerBytes(File archivo, int maximo) {
        InputStream in = null;
        try {
            in = new FileInputStream(archivo);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int leidos;
            int total = 0;
            while ((leidos = in.read(buffer)) > 0 && total < maximo) {
                int usar = Math.min(leidos, maximo - total);
                out.write(buffer, 0, usar);
                total += usar;
            }
            return out.toByteArray();
        } catch (Throwable t) {
            return new byte[0];
        } finally {
            if (in != null) {
                try {
                    in.close();
                } catch (Throwable ignorado) {
                    // sin más.
                }
            }
        }
    }

    private static String extension(String nombre) {
        int punto = nombre == null ? -1 : nombre.lastIndexOf('.');
        if (punto < 0 || punto == nombre.length() - 1) {
            return "";
        }
        return nombre.substring(punto + 1).toLowerCase(java.util.Locale.US);
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
}
