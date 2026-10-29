package cl.fabri.core.j;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.text.InputType;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.ArrayAdapter;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * FORGE CORE STOCK · app nativa en Java puro (sin Kotlin, sin librerías externas).
 * Compila con javac + d8 en segundos. Deja rastro de arranque en Android/data/.../files/boot.log
 */
public class MainActivity extends Activity {

    private static final int BG = 0xFF0B0D10, SURF = 0xFF14171B, SURF2 = 0xFF1B2026;
    private static final int TX = 0xFFE8EDF2, TX2 = 0xFF9AA6B2, ACC = 0xFFC8F542;
    private static final int ERR = 0xFFFF6B6B, BD = 0xFF232A31;

    private Core.Db db;
    private SharedPreferences prefs;
    private LinearLayout body;
    private final ExecutorService pool = Executors.newFixedThreadPool(2);
    private String screen = "home";

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
            try { Core.diag(this, "CRASH " + e.getClass().getSimpleName() + ": " + Log.getStackTraceString(e)); }
            catch (Throwable ignored) { }
        });
        Core.diag(this, "onCreate inicio · Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")");
        prefs = getSharedPreferences("fabri", MODE_PRIVATE);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        setContentView(root);
        Core.diag(this, "vista raíz puesta");

        try {
            db = Core.Db.get(this);
            Core.diag(this, "base abierta · tablas=" + db.tableNames().size());
        } catch (Throwable t) {
            Core.diag(this, "ERROR base: " + t);
            root.addView(fatal("No pude abrir la base: " + t));
            return;
        }

        body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        ScrollView sc = new ScrollView(this);
        sc.setFillViewport(true);
        sc.addView(body);
        root.addView(sc);

        Core.diag(this, "render inicial");
        try {
            if (authed()) home(); else auth();
            Core.diag(this, "pantalla lista: " + screen);
        } catch (Throwable t) {
            Core.diag(this, "ERROR render: " + Log.getStackTraceString(t));
            body.removeAllViews();
            body.addView(fatal("Error al dibujar: " + t));
        }
    }

    /* ── sesión ──────────────────────────────────────────────────────── */
    private boolean authed() {
        String tok = prefs.getString("token", null);
        if (tok == null) return false;
        long uid = prefs.getLong("uid", -1);
        if (uid < 0) return false;
        Cursor c = null;
        try {
            c = db.getReadableDatabase().rawQuery(
                    "SELECT id FROM sessions WHERE token_hash=? AND user_id=? AND revoked=0 AND expires_at>?",
                    new String[]{Core.Sec.sha256(tok), String.valueOf(uid), String.valueOf(System.currentTimeMillis())});
            boolean ok = c.moveToFirst();
            Core.diag(this, "sesión " + (ok ? "válida" : "expirada"));
            return ok;
        } catch (Throwable t) { return false; } finally { if (c != null) c.close(); }
    }

    private void saveSession(long uid) {
        String tok = Core.Sec.b64(Core.Sec.random(32));
        ContentValues v = new ContentValues();
        v.put("user_id", uid);
        v.put("token_hash", Core.Sec.sha256(tok));
        v.put("device", Build.MODEL);
        v.put("created_at", System.currentTimeMillis());
        v.put("expires_at", System.currentTimeMillis() + 30L * 24 * 3600 * 1000);
        db.getWritableDatabase().insert("sessions", null, v);
        prefs.edit().putString("token", tok).putLong("uid", uid).apply();
    }

    /* ── pantalla: entrar / crear cuenta ─────────────────────────────── */
    private void auth() {
        screen = "auth";
        body.removeAllViews();
        body.addView(top("FORGE CORE STOCK", "Núcleo local · sin nube"));
        body.addView(pad());

        boolean first = db.scalar("SELECT COUNT(*) FROM users") <= 0;
        LinearLayout c = card();
        c.addView(label(first ? "Crear cuenta local" : "Entrar", 18, TX));
        c.addView(note(first ? "Todo queda en este teléfono. No se envía nada." : "Tu clave nunca sale del dispositivo."));

        EditText email = input("correo@dominio.cl", false);
        EditText name = input("tu nombre", false);
        EditText pass = input("clave (mínimo 8)", true);
        c.addView(email);
        if (first) c.addView(name);
        c.addView(pass);

        final boolean f = first;
        c.addView(btn(first ? "Crear cuenta" : "Entrar", () -> {
            String em = email.getText().toString().trim().toLowerCase(Locale.ROOT);
            String nm = first ? name.getText().toString().trim() : "";
            String pw = pass.getText().toString();
            if (!em.contains("@") || pw.length() < 8) {
                toast("Correo válido y clave de 8+ caracteres");
                return;
            }
            pool.execute(() -> {
                try {
                    if (f) {
                        byte[] salt = Core.Sec.random(16);
                        String hash = Core.Sec.b64(Core.Sec.pbkdf2(pw.toCharArray(), salt, 120000, 32));
                        ContentValues v = new ContentValues();
                        v.put("email", em); v.put("name", nm.isEmpty() ? em : nm);
                        v.put("pass_hash", hash); v.put("salt", Core.Sec.b64(salt));
                        v.put("iter", 120000); v.put("created_at", System.currentTimeMillis());
                        long id = db.getWritableDatabase().insert("users", null, v);
                        db.audit("registro", em);
                        saveSession(id);
                        ui(this::home);
                    } else {
                        Cursor cur = db.getReadableDatabase().rawQuery(
                                "SELECT id, pass_hash, salt, iter FROM users WHERE email=?", new String[]{em});
                        if (!cur.moveToFirst()) { cur.close(); ui(() -> toast("Ese correo no existe")); return; }
                        String expect = cur.getString(1);
                        byte[] salt = Core.Sec.unb64(cur.getString(2));
                        int iter = cur.getInt(3);
                        long id = cur.getLong(0);
                        cur.close();
                        String got = Core.Sec.b64(Core.Sec.pbkdf2(pw.toCharArray(), salt, iter, 32));
                        if (!got.equals(expect)) { ui(() -> toast("Clave incorrecta")); return; }
                        ContentValues up = new ContentValues();
                        up.put("last_login", System.currentTimeMillis());
                        db.getWritableDatabase().update("users", up, "id=?", new String[]{String.valueOf(id)});
                        saveSession(id);
                        db.audit("login", em);
                        ui(this::home);
                    }
                } catch (Throwable t) {
                    Core.diag(this, "ERROR auth: " + Log.getStackTraceString(t));
                    ui(() -> toast("Falló: " + t));
                }
            });
        }, true));
        body.addView(c);
        body.addView(pad());
    }

    /* ── pantalla: inicio ────────────────────────────────────────────── */
    private void home() {
        screen = "home";
        body.removeAllViews();
        String email = prefsEmail();
        body.addView(top("FORGE CORE STOCK", email.isEmpty() ? "local" : email));

        long users = db.scalar("SELECT COUNT(*) FROM users");
        long logs = db.scalar("SELECT COUNT(*) FROM logs");
        long cmds = db.scalar("SELECT COUNT(*) FROM commands");
        long keys = db.scalar("SELECT COUNT(*) FROM api_keys WHERE active=1");

        LinearLayout kpis = new LinearLayout(this);
        kpis.setOrientation(LinearLayout.HORIZONTAL);
        kpis.setPadding(0, dp(4), 0, dp(10));
        kpis.addView(kpi("usuarios", String.valueOf(users)));
        kpis.addView(kpi("claves IA", String.valueOf(keys)));
        kpis.addView(kpi("comandos", String.valueOf(cmds)));
        body.addView(kpis);

        LinearLayout c = card();
        c.addView(label("Qué puedes hacer", 16, TX));
        c.addView(note("Consola real del sistema, base SQLite, export XLSX y claves de IA cifradas con el Keystore."));
        c.addView(btn("Consola del sistema", this::term, true));
        c.addView(btn("Datos y export", this::data));
        c.addView(btn("Inteligencia artificial", this::ai));
        c.addView(btn("Ajustes y diagnóstico", this::settings));
        body.addView(c);

        body.addView(pad());
        body.addView(nav("home"));
    }

    private View kpi(String label, String value) {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setBackground(round(SURF, 14));
        l.setPadding(dp(12), dp(10), dp(12), dp(10));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        p.setMargins(dp(3), 0, dp(3), 0);
        l.setLayoutParams(p);
        l.addView(tv(value, 22, ACC, true));
        l.addView(tv(label, 11, TX2, false));
        return l;
    }

    /* ── pantalla: consola ───────────────────────────────────────────── */
    private void term() {
        screen = "term";
        body.removeAllViews();
        body.addView(top("Consola", "shell real del teléfono"));
        LinearLayout c = card();
        c.addView(note("Ejecuta con /system/bin/sh y límite de 20 s. Los comandos quedan auditados en la base."));
        EditText cmd = input("getprop ro.build.version.release", false);
        cmd.setText("id; uname -a; getprop ro.product.model");
        TextView out = tv("", 12, TX2, false);
        out.setTypeface(Typeface.MONOSPACE);
        out.setTextIsSelectable(true);
        c.addView(cmd);
        c.addView(btn("Ejecutar", () -> {
            String s = cmd.getText().toString().trim();
            if (s.isEmpty()) return;
            out.setText("ejecutando…");
            pool.execute(() -> {
                long t0 = System.currentTimeMillis();
                String r = Core.Term.run(s, 20000);
                long ms = System.currentTimeMillis() - t0;
                ContentValues v = new ContentValues();
                v.put("cmd", s);
                v.put("out", r.length() > 4000 ? r.substring(0, 4000) : r);
                v.put("ms", ms);
                v.put("at", System.currentTimeMillis());
                try { db.getWritableDatabase().insert("commands", null, v); } catch (Throwable ignored) { }
                ui(() -> out.setText("$ " + s + "\n" + r + "\n[" + ms + " ms]"));
            });
        }, true));
        c.addView(out);
        body.addView(c);
        body.addView(pad());
        body.addView(nav("term"));
    }

    /* ── pantalla: datos + export ────────────────────────────────────── */
    private void data() {
        screen = "data";
        body.removeAllViews();
        body.addView(top("Datos", "SQLite en el dispositivo"));

        LinearLayout c = card();
        List<String> tables = db.tableNames();
        c.addView(label("Tablas · " + tables.size(), 16, TX));
        for (String t : tables) {
            long n = db.scalar("SELECT COUNT(*) FROM \"" + t + "\"");
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setPadding(0, dp(6), 0, dp(6));
            TextView tl = tv(t, 13, TX, true);
            tl.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            row.addView(tl);
            row.addView(tv(String.valueOf(n), 13, ACC, true));
            row.setOnClickListener(x -> exportTable(t));
            c.addView(row);
            View div = new View(this);
            div.setBackgroundColor(BD);
            div.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1));
            c.addView(div);
        }
        c.addView(note("Toca una tabla para exportarla a XLSX."));
        body.addView(c);

        LinearLayout c2 = card();
        c2.addView(label("Exportar todo", 16, TX));
        c2.addView(btn("Generar libro .xlsx", this::exportAll, true));
        body.addView(c2);
        body.addView(pad());
        body.addView(nav("data"));
    }

    private void exportTable(String table) {
        pool.execute(() -> {
            try {
                List<String> cols = new ArrayList<>();
                List<List<String>> rows = new ArrayList<>();
                Cursor cur = db.getReadableDatabase().rawQuery("SELECT * FROM \"" + table + "\" LIMIT 5000", null);
                for (String n : cur.getColumnNames()) cols.add(n);
                while (cur.moveToNext()) {
                    List<String> r = new ArrayList<>();
                    for (int i = 0; i < cur.getColumnCount(); i++) {
                        String v;
                        try { v = cur.getString(i); } catch (Throwable t) { v = ""; }
                        r.add(v == null ? "" : v);
                    }
                    rows.add(r);
                }
                cur.close();
                byte[] x = Core.Xlsx.build(table, cols, rows);
                File f = new File(getExternalFilesDir(null), table + "-" + System.currentTimeMillis() + ".xlsx");
                FileOutputStream o = new FileOutputStream(f);
                o.write(x);
                o.close();
                db.audit("export", table + " → " + f.getName());
                ui(() -> toast("Listo: " + f.getName() + " (" + (x.length / 1024) + " KB)"));
            } catch (Throwable t) {
                ui(() -> toast("No pude exportar: " + t));
            }
        });
    }

    private void exportAll() {
        pool.execute(() -> {
            try {
                List<String> cols = new ArrayList<>();
                cols.add("tabla"); cols.add("filas");
                List<List<String>> rows = new ArrayList<>();
                for (String t : db.tableNames()) {
                    List<String> r = new ArrayList<>();
                    r.add(t);
                    r.add(String.valueOf(db.scalar("SELECT COUNT(*) FROM \"" + t + "\"")));
                    rows.add(r);
                }
                byte[] x = Core.Xlsx.build("resumen", cols, rows);
                File f = new File(getExternalFilesDir(null), "fabri-core-resumen.xlsx");
                FileOutputStream o = new FileOutputStream(f);
                o.write(x);
                o.close();
                db.audit("export", "resumen → " + f.getName());
                ui(() -> toast("Resumen: " + f.getAbsolutePath()));
            } catch (Throwable t) { ui(() -> toast("Falló: " + t)); }
        });
    }

    /* ── pantalla: IA ────────────────────────────────────────────────── */
    private void ai() {
        screen = "ai";
        body.removeAllViews();
        body.addView(top("Inteligencia artificial", "claves cifradas · AES-256-GCM"));
        LinearLayout c = card();
        c.addView(note("La clave se guarda cifrada con una llave del Keystore del teléfono. Nunca se muestra completa."));

        Spinner sp = new Spinner(this);
        String[] provs = {"OpenAI", "Anthropic", "DeepSeek", "Google", "Groq", "Mistral", "OpenRouter", "xAI", "Otro"};
        ArrayAdapter<String> ad = new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, provs);
        sp.setAdapter(ad);
        c.addView(sp);

        EditText key = input("pega la API key", true);
        EditText base = input("https://api.openai.com/v1 (opcional)", false);
        c.addView(key);
        c.addView(base);
        c.addView(btn("Guardar cifrada", () -> {
            String k = key.getText().toString().trim();
            if (k.length() < 8) { toast("La clave parece incompleta"); return; }
            pool.execute(() -> {
                try {
                    String[] enc = Core.Sec.encrypt(k);
                    ContentValues v = new ContentValues();
                    v.put("provider", provs[sp.getSelectedItemPosition()]);
                    v.put("label", provs[sp.getSelectedItemPosition()]);
                    v.put("base_url", base.getText().toString().trim());
                    v.put("cipher", enc[0]); v.put("iv", enc[1]);
                    v.put("masked", Core.Sec.mask(k));
                    v.put("active", 1); v.put("created_at", System.currentTimeMillis());
                    db.getWritableDatabase().insert("api_keys", null, v);
                    db.audit("clave IA", "guardada");
                    ui(() -> { toast("Guardada y cifrada"); ai(); });
                } catch (Throwable t) { ui(() -> toast("No pude cifrar: " + t)); }
            });
        }, true));
        body.addView(c);

        LinearLayout c2 = card();
        c2.addView(label("Guardadas", 16, TX));
        Cursor cur = null;
        int n = 0;
        try {
            cur = db.getReadableDatabase().rawQuery(
                    "SELECT id, provider, masked, base_url FROM api_keys WHERE active=1 ORDER BY id DESC", null);
            while (cur.moveToNext()) {
                n++;
                final long id = cur.getLong(0);
                String prov = cur.getString(1);
                String mask = cur.getString(2);
                LinearLayout row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                row.setPadding(0, dp(8), 0, dp(8));
                LinearLayout col = new LinearLayout(this);
                col.setOrientation(LinearLayout.VERTICAL);
                col.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
                col.addView(tv(prov, 13, TX, true));
                col.addView(tv(mask == null ? "" : mask, 11, TX2, false));
                row.addView(col);
                row.addView(small("Probar", () -> testKey(id)));
                row.addView(small("Borrar", () -> {
                    ContentValues v = new ContentValues();
                    v.put("active", 0);
                    db.getWritableDatabase().update("api_keys", v, "id=?", new String[]{String.valueOf(id)});
                    ai();
                }));
                c2.addView(row);
            }
            cur.close();
        } catch (Throwable ignored) { } finally { if (cur != null) cur.close(); }
        if (n == 0) c2.addView(note("Todavía no hay claves."));
        body.addView(c2);
        body.addView(pad());
        body.addView(nav("ai"));
    }

    private void testKey(long id) {
        pool.execute(() -> {
            Cursor c = null;
            try {
                c = db.getReadableDatabase().rawQuery(
                        "SELECT cipher, iv, base_url FROM api_keys WHERE id=?", new String[]{String.valueOf(id)});
                if (!c.moveToFirst()) { c.close(); return; }
                String plain = Core.Sec.decrypt(c.getString(0), c.getString(1));
                String base = c.getString(2);
                c.close();
                c = null;
                if (plain == null) { ui(() -> toast("No pude descifrar (Keystore)")); return; }
                if (base == null || base.isEmpty()) { ui(() -> toast("Sin base_url para probar")); return; }
                if (!base.endsWith("/")) base += "/";
                HttpURLConnection h = (HttpURLConnection) new URL(base + "models").openConnection();
                h.setRequestProperty("Authorization", "Bearer " + plain);
                h.setConnectTimeout(12000);
                h.setReadTimeout(12000);
                int code = h.getResponseCode();
                String msg = "HTTP " + code;
                ui(() -> toast("Prueba: " + msg));
            } catch (Throwable t) {
                ui(() -> toast("Error de red: " + t.getMessage()));
            } finally { if (c != null) c.close(); }
        });
    }

    /* ── pantalla: ajustes ───────────────────────────────────────────── */
    private void settings() {
        screen = "settings";
        body.removeAllViews();
        body.addView(top("Ajustes", "diagnóstico y respaldo"));

        LinearLayout c = card();
        c.addView(label("Permisos", 16, TX));
        c.addView(note("INTERNET: " + (has("android.permission.INTERNET") ? "concedido" : "denegado")
                + "\nAlmacenamiento: " + (Build.VERSION.SDK_INT >= 30 ? "por app (sin permiso global)" : "legado")));
        c.addView(btn("Abrir ajustes del sistema", () -> {
            try { startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getPackageName()))); }
            catch (Throwable t) { toast("No pude abrir: " + t); }
        }));
        body.addView(c);

        LinearLayout c2 = card();
        c2.addView(label("Arranque (boot.log)", 16, TX));
        TextView log = tv(Core.readDiag(this), 11, TX2, false);
        log.setTypeface(Typeface.MONOSPACE);
        log.setTextIsSelectable(true);
        c2.addView(log);
        c2.addView(btn("Copiar diagnóstico", () -> {
            android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            cm.setPrimaryClip(android.content.ClipData.newPlainText("boot.log", Core.readDiag(this)));
            toast("Copiado");
        }));
        c2.addView(btn("Limpiar registro", () -> {
            try { new File(getExternalFilesDir(null), "boot.log").delete(); toast("Borrado"); settings(); }
            catch (Throwable t) { toast("No pude borrar"); }
        }));
        body.addView(c2);

        LinearLayout c3 = card();
        c3.addView(label("Cuenta", 16, TX));
        c3.addView(btn("Cerrar sesión", () -> {
            prefs.edit().remove("token").remove("uid").apply();
            auth();
        }, true));
        c3.addView(note("Versión " + version() + " · Java puro · sin nube"));
        body.addView(c3);

        body.addView(pad());
        body.addView(nav("settings"));
    }

    private boolean has(String perm) {
        return getPackageManager().checkPermission(perm, getPackageName()) == 0;
    }

    private String version() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Throwable t) { return "?"; }
    }

    private String prefsEmail() {
        long uid = prefs.getLong("uid", -1);
        if (uid < 0) return "";
        Cursor c = null;
        try {
            c = db.getReadableDatabase().rawQuery("SELECT email FROM users WHERE id=?", new String[]{String.valueOf(uid)});
            return c.moveToFirst() ? c.getString(0) : "";
        } catch (Throwable t) { return ""; } finally { if (c != null) c.close(); }
    }

    /* ── navegación ──────────────────────────────────────────────────── */
    private View nav(String cur) {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.HORIZONTAL);
        l.setPadding(0, dp(6), 0, dp(10));
        String[][] items = {{"home", "Inicio", "Inicio"}, {"term", "Consola", "Consola"},
                {"data", "Datos", "Datos"}, {"ai", "IA", "IA"}, {"settings", "Ajustes", "Ajustes"}};
        for (String[] it : items) {
            Button b = new Button(this);
            b.setText(it[1]);
            b.setTextSize(11);
            b.setAllCaps(false);
            b.setTextColor(it[0].equals(cur) ? 0xFF0B0D10 : TX2);
            b.setBackground(round(it[0].equals(cur) ? ACC : SURF, 12));
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, dp(40), 1f);
            p.setMargins(dp(2), 0, dp(2), 0);
            b.setLayoutParams(p);
            b.setOnClickListener(v -> {
                if (it[0].equals("home")) home();
                else if (it[0].equals("term")) term();
                else if (it[0].equals("data")) data();
                else if (it[0].equals("ai")) ai();
                else settings();
            });
            l.addView(b);
        }
        return l;
    }

    /* ── helpers de vista ────────────────────────────────────────────── */
    private View top(String title, String sub) {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setPadding(dp(18), dp(20), dp(18), dp(8));
        l.addView(tv(title, 24, TX, true));
        if (sub != null && !sub.isEmpty()) l.addView(tv(sub, 12, TX2, false));
        return l;
    }

    private LinearLayout card() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setBackground(round(SURF, 16));
        l.setPadding(dp(14), dp(14), dp(14), dp(14));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.setMargins(dp(12), dp(4), dp(12), dp(8));
        l.setLayoutParams(p);
        return l;
    }

    private TextView label(String s, int size, int color) { return tv(s, size, color, true); }

    private TextView note(String s) {
        TextView t = tv(s, 12, TX2, false);
        t.setPadding(0, dp(4), 0, dp(4));
        return t;
    }

    private TextView tv(String s, int size, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s == null ? "" : s);
        t.setTextSize(size);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, dp(2), 0, dp(2));
        return t;
    }

    private EditText input(String hint, boolean secret) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setTextSize(13);
        e.setTextColor(TX);
        e.setHintTextColor(0xFF6B7681);
        e.setBackground(round(SURF2, 10));
        e.setPadding(dp(12), dp(10), dp(12), dp(10));
        if (secret) e.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        else e.setInputType(InputType.TYPE_CLASS_TEXT);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.setMargins(0, dp(6), 0, dp(6));
        e.setLayoutParams(p);
        return e;
    }

    private Button btn(String text, Runnable action) { return btn(text, action, false); }

    private Button btn(String text, Runnable action, boolean accent) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextSize(13);
        b.setTextColor(accent ? 0xFF0B0D10 : TX);
        b.setBackground(round(accent ? ACC : SURF2, 12));
        b.setPadding(dp(12), dp(8), dp(12), dp(8));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.setMargins(0, dp(5), 0, dp(5));
        b.setLayoutParams(p);
        b.setOnClickListener(v -> action.run());
        return b;
    }

    private Button small(String text, Runnable action) {
        Button b = btn(text, action);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, dp(34));
        p.setMargins(dp(4), 0, dp(4), 0);
        b.setLayoutParams(p);
        b.setPadding(dp(10), 0, dp(10), 0);
        b.setTextSize(11);
        return b;
    }

    private View pad() {
        View v = new View(this);
        v.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(70)));
        return v;
    }

    private View fatal(String msg) {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setPadding(dp(20), dp(60), dp(20), dp(20));
        l.addView(tv("FORGE CORE STOCK no pudo arrancar", 18, ERR, true));
        TextView d = tv(msg, 12, TX2, false);
        d.setTextIsSelectable(true);
        l.addView(d);
        l.addView(tv("Detalle en Android/data/" + getPackageName() + "/files/boot.log", 11, TX2, false));
        return l;
    }

    private GradientDrawable round(int color, int radius) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(radius));
        return g;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void ui(Runnable r) { runOnUiThread(r); }

    private void toast(String s) {
        Toast.makeText(this, s, Toast.LENGTH_SHORT).show();
    }
}
