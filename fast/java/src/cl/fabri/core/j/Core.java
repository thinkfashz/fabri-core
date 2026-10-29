package cl.fabri.core.j;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import android.util.Base64;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

/** Núcleo nativo en Java: base SQLite, cripto, shell y XLSX. Sin Kotlin, sin librerías. */
public final class Core {

    public static final String DB = "fabri-core.db";

    /* ── base de datos ─────────────────────────────────────────────────── */
    public static final class Db extends SQLiteOpenHelper {
        private static Db inst;

        public static synchronized Db get(Context c) {
            if (inst == null) inst = new Db(c.getApplicationContext());
            return inst;
        }

        private Db(Context c) { super(c, DB, null, 1); }

        @Override public void onCreate(SQLiteDatabase d) {
            d.execSQL("CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL," +
                    " name TEXT, pass_hash TEXT NOT NULL, salt TEXT NOT NULL, iter INTEGER NOT NULL DEFAULT 120000," +
                    " role TEXT NOT NULL DEFAULT 'owner', created_at INTEGER, last_login INTEGER)");
            d.execSQL("CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL," +
                    " token_hash TEXT NOT NULL, device TEXT, created_at INTEGER, expires_at INTEGER, revoked INTEGER DEFAULT 0)");
            d.execSQL("CREATE TABLE IF NOT EXISTS api_keys(id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL," +
                    " label TEXT, model TEXT, base_url TEXT, cipher TEXT NOT NULL, iv TEXT NOT NULL, masked TEXT," +
                    " active INTEGER DEFAULT 1, created_at INTEGER)");
            d.execSQL("CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT, tag TEXT," +
                    " message TEXT, at INTEGER)");
            d.execSQL("CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT," +
                    " detail TEXT, at INTEGER)");
            d.execSQL("CREATE TABLE IF NOT EXISTS metrics(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, value REAL, at INTEGER)");
            d.execSQL("CREATE TABLE IF NOT EXISTS consents(perm TEXT PRIMARY KEY, granted INTEGER, at INTEGER)");
            d.execSQL("CREATE TABLE IF NOT EXISTS files(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, size INTEGER," +
                    " mime TEXT, kind TEXT, at INTEGER)");
            d.execSQL("CREATE TABLE IF NOT EXISTS commands(id INTEGER PRIMARY KEY AUTOINCREMENT, cmd TEXT, out TEXT," +
                    " ms INTEGER, at INTEGER)");
            d.execSQL("CREATE TABLE IF NOT EXISTS sheets(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, created_at INTEGER," +
                    " updated_at INTEGER)");
            d.execSQL("CREATE TABLE IF NOT EXISTS cells(sheet_id INTEGER NOT NULL, ref TEXT NOT NULL, raw TEXT NOT NULL," +
                    " PRIMARY KEY(sheet_id, ref))");
            d.execSQL("CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash)");
        }

        @Override public void onUpgrade(SQLiteDatabase d, int a, int b) { onCreate(d); }

        public void log(String level, String tag, String msg) {
            try {
                ContentValues v = new ContentValues();
                v.put("level", level); v.put("tag", tag);
                v.put("message", msg == null ? "" : msg.substring(0, Math.min(2000, msg.length())));
                v.put("at", System.currentTimeMillis());
                getWritableDatabase().insert("logs", null, v);
            } catch (Throwable ignored) { }
        }

        public void audit(String action, String detail) {
            try {
                ContentValues v = new ContentValues();
                v.put("action", action); v.put("detail", detail); v.put("at", System.currentTimeMillis());
                getWritableDatabase().insert("audit", null, v);
            } catch (Throwable ignored) { }
        }

        public long scalar(String sql, String... args) {
            Cursor c = null;
            try {
                c = getReadableDatabase().rawQuery(sql, args);
                return c.moveToFirst() ? c.getLong(0) : 0;
            } catch (Throwable t) { return -1; } finally { if (c != null) c.close(); }
        }

        public List<String> tableNames() {
            List<String> out = new ArrayList<>();
            Cursor c = null;
            try {
                c = getReadableDatabase().rawQuery("SELECT name FROM sqlite_master WHERE type='table'" +
                        " AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'android_%' ORDER BY name", null);
                while (c.moveToNext()) out.add(c.getString(0));
            } catch (Throwable ignored) { } finally { if (c != null) c.close(); }
            return out;
        }
    }

    /* ── cripto ────────────────────────────────────────────────────────── */
    public static final class Sec {
        private static final String KS = "AndroidKeyStore";
        private static final String ALIAS = "fabri_core_master";

        public static byte[] random(int n) {
            byte[] b = new byte[n];
            new SecureRandom().nextBytes(b);
            return b;
        }

        public static String b64(byte[] b) {
            return Base64.encodeToString(b, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        }

        public static byte[] unb64(String s) {
            return Base64.decode(s, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        }

        public static String sha256(String s) {
            try {
                return b64(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
            } catch (Exception e) { return ""; }
        }

        /** PBKDF2-HMAC-SHA256 propio: no depende de proveedores que cambian entre versiones. */
        public static byte[] pbkdf2(char[] pass, byte[] salt, int iter, int len) {
            try {
                SecretKeySpec key = new SecretKeySpec(new String(pass).getBytes(StandardCharsets.UTF_8), "HmacSHA256");
                Mac mac = Mac.getInstance("HmacSHA256");
                mac.init(key);
                int hLen = mac.getMacLength();
                int blocks = (int) Math.ceil((double) len / hLen);
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                for (int i = 1; i <= blocks; i++) {
                    mac.update(salt);
                    byte[] bc = {(byte) (i >>> 24), (byte) (i >>> 16), (byte) (i >>> 8), (byte) i};
                    mac.update(bc);
                    byte[] u = mac.doFinal();
                    byte[] t = u.clone();
                    for (int n = 2; n <= iter; n++) {
                        u = mac.doFinal(u);
                        for (int k = 0; k < t.length; k++) t[k] ^= u[k];
                    }
                    out.write(t, 0, t.length);
                }
                byte[] all = out.toByteArray();
                byte[] res = new byte[len];
                System.arraycopy(all, 0, res, 0, len);
                return res;
            } catch (Exception e) { return new byte[0]; }
        }

        private static SecretKey master() throws Exception {
            KeyStore ks = KeyStore.getInstance(KS);
            ks.load(null);
            if (!ks.containsAlias(ALIAS)) {
                KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KS);
                kg.init(new KeyGenParameterSpec.Builder(ALIAS,
                        KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256).build());
                kg.generateKey();
            }
            return (SecretKey) ks.getKey(ALIAS, null);
        }

        /** Devuelve {cipher, iv} en base64url. */
        public static String[] encrypt(String plain) throws Exception {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, master());
            byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            return new String[]{b64(ct), b64(c.getIV())};
        }

        public static String decrypt(String cipherB64, String ivB64) {
            try {
                Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
                c.init(Cipher.DECRYPT_MODE, master(), new GCMParameterSpec(128, unb64(ivB64)));
                return new String(c.doFinal(unb64(cipherB64)), StandardCharsets.UTF_8);
            } catch (Exception e) { return null; }
        }

        public static String mask(String s) {
            if (s == null) return "";
            if (s.length() <= 8) return "••••";
            return s.substring(0, 4) + "••••" + s.substring(s.length() - 4);
        }
    }

    /* ── terminal ──────────────────────────────────────────────────────── */
    public static final class Term {
        public static String run(String cmd, int timeoutMs) {
            Process p = null;
            try {
                p = new ProcessBuilder("/system/bin/sh", "-c", cmd).redirectErrorStream(true).start();
                p.getOutputStream().close();
                final Process fp = p;
                final ByteArrayOutputStream buf = new ByteArrayOutputStream();
                Thread reader = new Thread(() -> {
                    try (InputStream in = fp.getInputStream()) {
                        byte[] b = new byte[4096];
                        int n;
                        while ((n = in.read(b)) > 0) {
                            synchronized (buf) { buf.write(b, 0, n); }
                            if (buf.size() > 400_000) break;
                        }
                    } catch (Throwable ignored) { }
                });
                reader.start();
                // waitFor(timeout, unit) es API 26: se usa un hilo + join para bajar a API 23.
                Thread waiter = new Thread(() -> {
                    try { fp.waitFor(); } catch (Throwable ignored) { }
                });
                waiter.start();
                waiter.join(timeoutMs);
                if (waiter.isAlive()) {
                    p.destroy();
                    synchronized (buf) { buf.write("\n[tiempo agotado]".getBytes()); }
                }
                reader.join(800);
                String out;
                synchronized (buf) { out = buf.toString("UTF-8"); }
                return out.isEmpty() ? "(sin salida)" : out;
            } catch (Throwable t) {
                return "No pude ejecutar: " + t;
            } finally {
                if (p != null) try { p.destroy(); } catch (Throwable ignored) { }
            }
        }
    }

    /* ── XLSX real (ZipOutputStream + OOXML mínimo) ────────────────────── */
    public static final class Xlsx {
        private static String esc(String s) {
            if (s == null) return "";
            return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                    .replace("\"", "&quot;").replace("\n", "&#10;");
        }

        public static byte[] build(String sheet, List<String> cols, List<List<String>> rows) {
            try {
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                ZipOutputStream z = new ZipOutputStream(bo);
                String CT = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                        "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
                        "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
                        "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
                        "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>" +
                        "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>" +
                        "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>" +
                        "</Types>";
                String REL = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>" +
                        "</Relationships>";
                String WBR = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>" +
                        "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>" +
                        "</Relationships>";
                String WB = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                        "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"" +
                        " xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets>" +
                        "<sheet name=\"" + esc(sheet).substring(0, Math.min(28, sheet.length())) + "\" sheetId=\"1\" r:id=\"rId1\"/>" +
                        "</sheets></workbook>";
                String STY = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                        "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">" +
                        "<fonts count=\"1\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts>" +
                        "<fills count=\"1\"><fill><patternFill patternType=\"none\"/></fill></fills>" +
                        "<borders count=\"1\"><border/></borders><cellStyleXfs count=\"1\"><xf/></cellStyleXfs>" +
                        "<cellXfs count=\"1\"><xf xfId=\"0\"/></cellXfs></styleSheet>";

                StringBuilder x = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                        "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>");
                x.append(rowXml(1, cols));
                for (int i = 0; i < rows.size(); i++) x.append(rowXml(i + 2, rows.get(i)));
                x.append("</sheetData></worksheet>");

                put(z, "[Content_Types].xml", CT);
                put(z, "_rels/.rels", REL);
                put(z, "xl/workbook.xml", WB);
                put(z, "xl/_rels/workbook.xml.rels", WBR);
                put(z, "xl/styles.xml", STY);
                put(z, "xl/worksheets/sheet1.xml", x.toString());
                z.finish();
                z.close();
                return bo.toByteArray();
            } catch (Throwable t) {
                return new byte[0];
            }
        }

        private static String rowXml(int r, List<String> vals) {
            if (vals == null) return "";
            StringBuilder s = new StringBuilder("<row r=\"" + r + "\">");
            for (int i = 0; i < vals.size(); i++) {
                String ref = col(i) + r;
                String v = vals.get(i);
                boolean num = v != null && v.matches("-?\\d+(\\.\\d+)?") && v.length() < 15;
                if (num) s.append("<c r=\"").append(ref).append("\"><v>").append(v).append("</v></c>");
                else s.append("<c r=\"").append(ref)
                        .append("\" t=\"inlineStr\"><is><t xml:space=\"preserve\">")
                        .append(esc(v)).append("</t></is></c>");
            }
            return s.append("</row>").toString();
        }

        private static String col(int i) {
            StringBuilder s = new StringBuilder();
            int n = i;
            do { s.insert(0, (char) ('A' + (n % 26))); n = n / 26 - 1; } while (n >= 0);
            return s.toString();
        }

        private static void put(ZipOutputStream z, String name, String data) throws Exception {
            z.putNextEntry(new ZipEntry(name));
            z.write(data.getBytes(StandardCharsets.UTF_8));
            z.closeEntry();
        }
    }

    /* ── diagnóstico: deja rastro en un archivo que el usuario puede ver ── */
    public static void diag(Context c, String line) {
        String stamp = new java.text.SimpleDateFormat("HH:mm:ss.SSS", java.util.Locale.US)
                .format(new java.util.Date());
        String msg = stamp + " · " + line + "\n";
        File f = new File(c.getExternalFilesDir(null), "boot.log");
        try {
            FileOutputStream o = new FileOutputStream(f, true);
            o.write(msg.getBytes(StandardCharsets.UTF_8));
            o.close();
        } catch (Throwable ignored) { }
        android.util.Log.i("FORGE CORE STOCK", line);
    }

    public static String readDiag(Context c) {
        try {
            File f = new File(c.getExternalFilesDir(null), "boot.log");
            if (!f.exists()) return "(sin registro)";
            byte[] b = new byte[(int) Math.min(f.length(), 20000)];
            java.io.FileInputStream in = new java.io.FileInputStream(f);
            int n = in.read(b);
            in.close();
            return n > 0 ? new String(b, 0, n, StandardCharsets.UTF_8) : "(vacío)";
        } catch (Throwable t) { return "no pude leer: " + t; }
    }
}
