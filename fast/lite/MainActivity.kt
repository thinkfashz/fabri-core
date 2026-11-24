package cl.fabri.core.lite

import android.Manifest
import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/**
 * FORGE CORE STOCK · app Android (sin librerías externas).
 *
 * Todo lo que se ve sale de la base SQLite del dispositivo. Si algo falla, se muestra
 * el error en pantalla en vez de cerrar la app (y se guarda para diagnóstico).
 */
class LiteActivity : Activity() {

    private lateinit var db: Db
    private lateinit var auth: Auth
    private lateinit var vault: Vault
    private lateinit var prefs: android.content.SharedPreferences
    private lateinit var root: LinearLayout
    private lateinit var content: LinearLayout
    private lateinit var navBar: LinearLayout
    private var accent = C.ACC
    private var tab = 0
    private val pool = Executors.newSingleThreadExecutor()
    private val ui = Handler(Looper.getMainLooper())

    private val tabs = listOf("Inicio", "Tienda", "Productos", "Clientes", "Ajustes")
    private var tiendaMsg = ""
    private var tiendaOk = true
    private var tiendaOcupado = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            boot()
        } catch (t: Throwable) {
            showCrash(t)
        }
    }

    private fun boot() {
        db = Db.get(this)
        auth = Auth(this)
        vault = Vault(this)
        prefs = getSharedPreferences("fabri_settings", MODE_PRIVATE)
        accent = when (prefs.getString("accent", "lima")) {
            "cian" -> C.CYAN; "violeta" -> C.VIOLET; "ambar" -> C.WARN; else -> C.ACC
        }

        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(C.BG)
        }
        root.addView(header())
        content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(Ui.scroll(this, content), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        navBar = nav()
        root.addView(navBar)
        setContentView(root)

        if (auth.current() == null) renderAuth() else { showTabs(); render() }
    }

    // ── estructura ────────────────────────────────────────────────────────
    private fun header(): View = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setBackgroundColor(C.SURF)
        setPadding(dp(16), dp(12), dp(16), dp(12))
        addView(View(this@LiteActivity).apply {
            background = GradientDrawable().apply { cornerRadius = dp(7).toFloat(); setColor(accent) }
        }, LinearLayout.LayoutParams(dp(24), dp(24)))
        addView(Ui.text(this@LiteActivity, "FORGE CORE STOCK", 16f, C.TX, true).apply { letterSpacing = 0.08f }, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { leftMargin = dp(10) })
        addView(Ui.text(this@LiteActivity, "v1.2.0 · ${db.ftsMode()}", 11f, C.MUTED).apply { gravity = Gravity.END }, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { weight = 1f })
    }

    private fun nav(): LinearLayout {
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(C.SURF)
            setPadding(dp(4), dp(6), dp(4), dp(8))
        }
        tabs.forEachIndexed { i, label ->
            val b = TextView(this).apply {
                text = label
                textSize = 10.5f
                gravity = Gravity.CENTER
                setPadding(dp(4), dp(8), dp(4), dp(8))
                setTextColor(if (i == tab) accent else C.MUTED)
                typeface = if (i == tab) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
                setOnClickListener { tab = i; render() }
            }
            bar.addView(b, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }
        return bar
    }

    private fun showTabs() { navBar.visibility = View.VISIBLE }

    private fun render() {
        try {
            content.removeAllViews()
            content.addView(when (tab) {
                0 -> inicio(); 1 -> tienda(); 2 -> productos(); 3 -> clientes(); else -> ajustes()
            })
            navBar.removeAllViews()
            val fresh = nav()
            (navBar.parent as? LinearLayout)?.let { parent ->
                val idx = parent.indexOfChild(navBar)
                parent.removeView(navBar); parent.addView(fresh, idx)
                navBar = fresh
            }
        } catch (t: Throwable) {
            content.removeAllViews()
            content.addView(crashCard(t))
        }
    }

    // ── autenticación ─────────────────────────────────────────────────────
    private fun renderAuth() {
        navBar.visibility = View.GONE
        content.removeAllViews()
        val first = auth.userCount() == 0L
        val v = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(4), dp(30), dp(4), dp(20)) }

        v.addView(Ui.text(this, if (first) "Crea la cuenta del dispositivo" else "Entra a FORGE CORE STOCK", 24f, C.TX, true))
        v.addView(Ui.text(this,
            if (first) "Es la primera vez. La cuenta y sus tokens viven en esta base SQLite, no en un servidor."
            else "La sesión se guarda como token en la base del dispositivo.", 13f, C.TX2))

        val email = Ui.field(this, "correo@dominio.cl")
        val name = Ui.field(this, "tu nombre")
        val pass = Ui.field(this, "contraseña (mínimo 8)", password = true)
        val pass2 = Ui.field(this, if (first) "repite la contraseña" else "contraseña", password = true)
        email.inputType = android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS

        v.addView(email)
        if (first) v.addView(name)
        v.addView(pass)
        v.addView(pass2)

        val status = Ui.text(this, "", 12.5f, C.WARN)
        v.addView(status)

        val btn = Ui.button(this, if (first) "Crear cuenta" else "Entrar", true) {
            val e = email.text.toString().trim()
            val p = pass.text.toString()
            if (p != pass2.text.toString()) { status.text = "Las contraseñas no coinciden"; return@button }
            val r = if (first) auth.register(e, name.text.toString(), p).map { it to "" } else auth.login(e, p)
            r.onSuccess {
                db.metric("logins", 1.0)
                renderAuthAfterLogin(it.first.email)
            }.onFailure { status.text = it.message }
        }
        v.addView(Ui.row(this, btn))

        v.addView(Ui.card(this, "Cómo se guarda", "PBKDF2-HMAC-SHA256 · 120.000 iteraciones · sal única. El token de sesión se almacena hasheado (SHA-256) y vence a los 30 días.", "seguro"))
        content.addView(v)
    }

    private fun renderAuthAfterLogin(email: String) {
        tab = 0
        showTabs()
        navBar.removeAllViews()
        val fresh = nav(); (navBar.parent as? LinearLayout)?.let { p ->
            val i = p.indexOfChild(navBar); p.removeView(navBar); p.addView(fresh, i); navBar = fresh
        }
        render()
        toast("Sesión iniciada: $email")
    }

    // ── 0 · INICIO ────────────────────────────────────────────────────────
    private fun inicio(): View {
        val v = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val u = auth.current()
        val cfg = Shop.leer(db)
        v.addView(Ui.title(this, "Hola${u?.let { ", " + it.name } ?: ""}",
            "FORGE CORE STOCK · tu tienda, sus productos y sus clientes"))

        val sync = db.raw("SELECT at, ok, productos FROM shop_sync ORDER BY id DESC LIMIT 1").second.firstOrNull()
        val catalogo = db.scalar("SELECT COUNT(*) FROM shop_catalogo").toIntOrNull() ?: 0
        val clientes = db.scalar("SELECT COUNT(*) FROM shop_clientes").toIntOrNull() ?: 0
        val fallos = db.scalar("SELECT COUNT(*) FROM shop_fallos").toIntOrNull() ?: 0

        if (cfg == null) {
            v.addView(Ui.card(this, "Sin tienda conectada",
                "Conecta la app con tu tienda para sincronizar catálogo y ver tus clientes.", "desconectado", false))
            v.addView(Ui.button(this, "Conectar mi tienda", true) { tab = 1; render() })
        } else {
            val ok = sync?.getOrNull(1) == "1"
            val cuando = sync?.getOrNull(0)?.toLongOrNull()?.let { hace(it) } ?: "nunca"
            val productos = sync?.getOrNull(2) ?: "0"
            v.addView(Ui.card(this, cfg.local,
                "Sincronización: $cuando\nÚltimo lote: $productos productos\nCatálogo publicado: $catalogo",
                if (ok) "conectado" else "revisar", ok))
        }

        v.addView(kpiRow(
            listOf(Triple("Productos", catalogo.toString(), true), Triple("Clientes", clientes.toString(), clientes > 0)),
            listOf(Triple("Fallos", fallos.toString(), fallos == 0), Triple("Base", db.ftsMode(), true))
        ))

        v.addView(Ui.row(this,
            Ui.button(this, "Tienda", true) { tab = 1; render() },
            Ui.button(this, "Productos", false) { tab = 2; render() },
            Ui.button(this, "Clientes", false) { tab = 3; render() }
        ))

        v.addView(Ui.card(this, "Salud del núcleo",
            "SQLite ${db.scalar("SELECT sqlite_version()")} · ${db.tables().size} tablas · WAL ${db.scalar("PRAGMA journal_mode")}",
            "activo"))
        return v
    }

    private fun consola(): View {
        val v = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        v.addView(Ui.title(this, "Consola", "sh del dispositivo + comandos propios · escribe help"))

        val out = TextView(this).apply {
            setTextIsSelectable(true)
            typeface = Typeface.MONOSPACE
            textSize = 11.5f
            setTextColor(C.TX2)
            setBackgroundColor(0xFF050607.toInt())
            setPadding(dp(12), dp(10), dp(12), dp(10))
            text = welcome()
        }
        val outScroll = ScrollView(this).apply { addView(out); setBackgroundColor(0xFF050607.toInt()) }
        v.addView(outScroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(320)))

        val input = Ui.field(this, "ls /sdcard · sql SELECT * FROM logs LIMIT 5 · help")
        input.typeface = Typeface.MONOSPACE
        v.addView(input)

        var history = db.raw("SELECT cmd FROM commands ORDER BY id DESC LIMIT 6").second.map { it[0] }
        val chips = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        history.forEach { h ->
            chips.addView(Ui.pill(this, h.take(14), true, C.CYAN).apply {
                setOnClickListener { input.setText(h); input.setSelection(h.length) }
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { rightMargin = dp(6) })
        }
        v.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(chips) })

        v.addView(Ui.row(this,
            Ui.button(this, "Ejecutar", true) {
                val cmd = input.text.toString().trim()
                if (cmd.isEmpty()) return@button
                out.append("\n\n$ ${cmd}\n…")
                outScroll.post { outScroll.fullScroll(View.FOCUS_DOWN) }
                input.setText("")
                pool.execute {
                    val r = Term.run(this, cmd)
                    ui.post {
                        out.append(r.text + "\n[${r.ms} ms]")
                        outScroll.post { outScroll.fullScroll(View.FOCUS_DOWN) }
                        db.metric("comandos", 1.0)
                    }
                }
            },
            Ui.button(this, "Limpiar", false) { out.text = welcome() },
            Ui.button(this, "Exportar salida", false) { exportText("consola", out.text.toString()) }
        ))
        return v
    }

    private fun welcome() =
        "FORGE CORE STOCK · consola abierta\nusuario: ${auth.current()?.email ?: "invitado"} · uid app ${android.os.Process.myUid()}\nmotor de texto: ${db.ftsMode()} · base: ${Ui.human(db.sizeBytes())}\n\nEscribe 'help' para ver los comandos."

    // ── 2 · DATOS ─────────────────────────────────────────────────────────
    private fun datos(): View {
        val v = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        v.addView(Ui.title(this, "Datos", "Explora, consulta y exporta · todo real"))
        v.addView(Ui.card(this, "Archivo", "${getDatabasePath(Db.NAME).absolutePath}\n${Ui.human(db.sizeBytes())} lógicos · ${db.tables().size} tablas", "SQLite"))

        // tablas con filas y tamaño
        val tablas = db.tables()
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        col.addView(Ui.text(this, "Tablas", 13f, C.TX2, true))
        tablas.forEach { (n, c, b) ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(6), 0, dp(6)) }
            row.addView(Ui.text(this, n, 12.5f, C.TX, true), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            row.addView(Ui.text(this, "$c", 12f, C.TX2), LinearLayout.LayoutParams(dp(54), ViewGroup.LayoutParams.WRAP_CONTENT))
            row.addView(Ui.pill(this, Ui.human(b), true, C.CYAN).apply {
                setOnClickListener {
                    val (cols, rows) = db.raw("SELECT * FROM \"$n\" LIMIT 50")
                    content.removeAllViews()
                    content.addView(viewTable(n, cols, rows))
                }
            })
            col.addView(row)
        }
        v.addView(Ui.card(this, col))

        // analítica real
        v.addView(Ui.card(this, LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(Ui.text(this@LiteActivity, "Filas por tabla", 13f, C.TX2, true))
            addView(Ui.bars(this@LiteActivity, tablas.map { it.first to it.second.toDouble() }, accent))
        }))

        val porTag = db.raw("SELECT tag, COUNT(*) c FROM logs GROUP BY tag ORDER BY c DESC LIMIT 8").second
        if (porTag.isNotEmpty()) {
            v.addView(Ui.card(this, LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                addView(Ui.text(this@LiteActivity, "Eventos por módulo", 13f, C.TX2, true))
                addView(Ui.bars(this@LiteActivity, porTag.map { it[0] to (it[1].toDoubleOrNull() ?: 0.0) }, C.CYAN))
            }))
        }

        // consola SQL
        val sql = Ui.field(this, "SELECT * FROM memory_items ORDER BY id DESC LIMIT 20")
        sql.typeface = Typeface.MONOSPACE
        v.addView(sql)
        val resultHost = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        v.addView(Ui.row(this,
            Ui.button(this, "Ejecutar", true) {
                val q = sql.text.toString().trim()
                if (q.isEmpty()) return@button
                resultHost.removeAllViews()
                pool.execute {
                    val t0 = System.currentTimeMillis()
                    val (cols, rows) = db.raw(q)
                    val ms = System.currentTimeMillis() - t0
                    ui.post {
                        resultHost.addView(Ui.text(this, "${rows.size} fila(s) · $ms ms", 11.5f, C.MUTED))
                        resultHost.addView(Ui.table(this, cols, rows))
                        db.metric("consultas", 1.0)
                    }
                }
            },
            Ui.button(this, "Exportar XLSX", false) {
                val q = sql.text.toString().trim().ifEmpty { "SELECT * FROM logs LIMIT 100" }
                pool.execute {
                    val (cols, rows) = db.raw(q)
                    val name = "consulta-${System.currentTimeMillis() / 1000}.xlsx"
                    val bytes = Export.xlsx("consulta", cols, rows)
                    val path = Export.save(this, name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes)
                    Export.register(this, name, path, bytes.size.toLong(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "consulta")
                    ui.post { toast(if (path != null) "Guardado en $path" else "No se pudo guardar") }
                }
            }
        ))
        v.addView(resultHost)
        v.addView(Ui.card(this, "Cifras rápidas", "SELECT COUNT(*), SUM(x), AVG(x), MAX(x) funcionan igual que en Excel. Puedes guardar la consulta en Ajustes → Hojas.", "cálculo"))
        return v
    }

    private fun viewTable(name: String, cols: List<String>, rows: List<List<String>>): View =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(Ui.row(this@LiteActivity,
                Ui.button(this@LiteActivity, "← volver", false) { tab = 2; render() },
                Ui.button(this@LiteActivity, "XLSX", true) {
                    pool.execute {
                        val (c2, r2) = db.raw("SELECT * FROM \"$name\"")
                        val fname = "$name-${System.currentTimeMillis() / 1000}.xlsx"
                        val bytes = Export.xlsx(name, c2, r2)
                        val p = Export.save(this@LiteActivity, fname, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes)
                        Export.register(this@LiteActivity, fname, p, bytes.size.toLong(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name)
                        ui.post { toast(if (p != null) "Guardado en $p" else "No se pudo guardar") }
                    }
                }
            ))
            addView(Ui.title(this@LiteActivity, name, "${rows.size} fila(s) · ${cols.size} columna(s)"))
            addView(Ui.table(this@LiteActivity, cols, rows, 100))
        }

    // ── 3 · IA ────────────────────────────────────────────────────────────
    // ── tienda: puente con la nube ───────────────────────────────────────
    /**
     * Conecta la APK con una tienda usando su clave de 8 caracteres.
     *
     * Todo se ejecuta en el pool: la red nunca bloquea la interfaz. El estado
     * que se muestra sale de la respuesta real (`/api/inventario`), no de una
     * suposición. La clave se guarda cifrada con el Keystore.
     */
    private fun tienda(): View {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(6), dp(14), dp(18))
        }
        box.addView(Ui.title(this, "Tienda",
            "Conecta esta APK con tu tienda: sube el catálogo del equipo y baja el de la nube."))

        val cfg = Shop.leer(db)
        if (cfg == null) {
            box.addView(Ui.card(this, "Conectar con mi tienda",
                "El identificador y la clave están en el panel del negocio → Conexión.", "sin conectar", false))
            if (tiendaMsg.isNotBlank()) {
                box.addView(Ui.text(this, tiendaMsg, 12.5f, if (tiendaOk) C.OK else C.ERR))
            }

            val id = Ui.field(this, "Identificador (ej: mi-almacen)")
            val clave = Ui.field(this, "Clave de 8 caracteres", password = true)
            box.addView(id)
            box.addView(clave)
            box.addView(Ui.button(this, if (tiendaOcupado) "Conectando…" else "Conectar y probar", true) {
                if (tiendaOcupado) return@button
                val local = id.text.toString().trim().lowercase()
                val k = clave.text.toString().trim().uppercase()
                if (local.isBlank()) { tiendaOk = false; tiendaMsg = "Escribe el identificador de la tienda."; render(); return@button }
                if (k.length != 8) { tiendaOk = false; tiendaMsg = "La clave tiene 8 caracteres."; render(); return@button }
                trabajo("Probando la conexión…") {
                    val r = Shop.verificar(this@LiteActivity, Shop.Cfg(local, k))
                    if (r.ok) {
                        val cfgNueva = Shop.Cfg(local, k)
                        Shop.guardar(db, cfgNueva)
                        db.kvPut("shop.ultimo", System.currentTimeMillis().toString())
                        Shop.asegurar(db, this@LiteActivity, cfgNueva)
                    }
                    r
                }
            })
            box.addView(Ui.text(this,
                "La clave no se muestra completa ni se guarda en claro: queda cifrada con el Keystore del teléfono.",
                11.5f, C.MUTED))
            return box
        }

        /* Conectado: estado y acciones. */
        val ultimo = db.kvGet("shop.ultimo").toLongOrNull() ?: 0L
        val productos = db.scalar("SELECT COUNT(*) FROM products").toIntOrNull() ?: 0
        val detalle = buildString {
            append("Tienda: ").append(cfg.local)
            append("\nClave: ").append(Shop.pista(cfg.clave))
            append("\nProductos en este equipo: ").append(productos)
            if (ultimo > 0) append("\nÚltima sincronización: ").append(hace(ultimo))
        }
        box.addView(Ui.card(this, "Conectada", detalle, "enlace listo", true))

        if (tiendaMsg.isNotBlank()) {
            box.addView(Ui.text(this, tiendaMsg, 12.5f, if (tiendaOk) C.OK else C.ERR))
        }

        val fila1 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        fila1.addView(Ui.button(this, "Probar", false) {
            if (tiendaOcupado) return@button
            trabajo("Probando…") { Shop.verificar(this@LiteActivity, cfg) }
        })
        fila1.addView(Ui.button(this, "Ver estado", false) {
            if (tiendaOcupado) return@button
            trabajo("Consultando…") {
                val r = Shop.estado(this@LiteActivity, cfg)
                if (r.ok) Shop.Resp(true, r.ms, Shop.resumen(r), r.json) else r
            }
        })
        fila1.addView(Ui.button(this, "Asegurar tablas", false) {
            if (tiendaOcupado) return@button
            trabajo("Creando tablas en la nube…") { Shop.asegurar(db, this@LiteActivity, cfg) }
        })
        box.addView(fila1)

        val fila2 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        fila2.addView(Ui.button(this, if (tiendaOcupado) "Trabajando…" else "Subir catálogo", true) {
            if (tiendaOcupado) return@button
            trabajo("Subiendo el catálogo del equipo…") { Shop.subir(db, this@LiteActivity, cfg) }
        })
        fila2.addView(Ui.button(this, "Bajar catálogo", false) {
            if (tiendaOcupado) return@button
            trabajo("Bajando el catálogo de la nube…") { Shop.bajar(db, this@LiteActivity, cfg) }
        })
        box.addView(fila2)

        box.addView(Ui.button(this, "Cambiar de tienda", false) {
            if (tiendaOcupado) return@button
            android.app.AlertDialog.Builder(this)
                .setTitle("Cambiar de tienda")
                .setMessage("Se olvidará la tienda conectada en este equipo. El catálogo local se conserva como respaldo.")
                .setNegativeButton("Cancelar", null)
                .setPositiveButton("Cambiar") { _, _ ->
                    Shop.olvidar(db)
                    tiendaMsg = ""
                    render()
                }
                .show()
        })

        /* Estado del panel del dueño: publicación, dispositivos y fallos. */
        box.addView(Ui.button(this, "Estado en la nube", false) {
            if (tiendaOcupado) return@button
            trabajo("Leyendo el estado del panel…") {
                val r = Shop.estadoAdmin(cfg)
                if (r.ok) {
                    val c = r.json?.optJSONObject("conexion")
                    val disps = r.json?.optJSONArray("dispositivos")?.length() ?: 0
                    val errs = r.json?.optJSONArray("errores")?.length() ?: 0
                    val texto = buildString {
                        append("Publicada: ").append(if (c?.optBoolean("activo") == true) "sí" else "no")
                        append(" · plan ").append(c?.optString("plan") ?: "—")
                        append("\nProductos en la nube: ").append(c?.optInt("productos", 0) ?: 0)
                        append("\nDispositivos: ").append(disps)
                        append(" · fallos: ").append(errs)
                    }
                    Shop.Resp(true, r.ms, texto, r.json)
                } else r
            }
        })

        val fallos = db.raw("SELECT at, motivo FROM shop_fallos ORDER BY id DESC LIMIT 3").second
        if (fallos.isNotEmpty()) {
            val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            col.addView(Ui.text(this, "Últimos fallos", 13f, C.TX2, true))
            fallos.forEach { f ->
                col.addView(Ui.text(this, (f.getOrNull(0)?.toLongOrNull()?.let { hace(it) } ?: "") +
                    " · " + (f.getOrNull(1) ?: ""), 11.5f, C.ERR))
            }
            box.addView(Ui.card(this, col))
        }

        box.addView(Ui.text(this,
            "Subir manda el catálogo de este equipo a la tienda; bajar guarda el de la nube en la base local. " +
                "Nada se borra: el equipo conserva su copia.", 11.5f, C.MUTED))
        return box
    }

    /** Ejecuta una llamada del puente fuera del hilo de la interfaz. */
    private fun trabajo(texto: String, accion: () -> Shop.Resp) {
        tiendaOcupado = true
        tiendaMsg = texto
        render()
        pool.execute {
            val r = try { accion() } catch (t: Throwable) {
                Shop.Resp(false, 0, t.message ?: "error inesperado")
            }
            ui.post {
                tiendaOcupado = false
                tiendaOk = r.ok
                tiendaMsg = if (r.ok) r.texto.ifBlank { Shop.resumen(r) } else r.texto
                render()
            }
        }
    }

    private fun hace(ts: Long): String {
        val min = ((System.currentTimeMillis() - ts) / 60000L).coerceAtLeast(0)
        return when {
            min < 1 -> "ahora"
            min < 60 -> "hace $min min"
            min < 1440 -> "hace ${min / 60} h"
            else -> "hace ${min / 1440} d"
        }
    }

    /** Dos filas de dos cifras: el patrón visual de Inicio y Clientes. */
    private fun kpiRow(a: List<Triple<String, String, Boolean>>, b: List<Triple<String, String, Boolean>>): View {
        fun mini(t: Triple<String, String, Boolean>) = Ui.card(this, LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(Ui.text(this@LiteActivity, t.first.uppercase(), 10f, C.MUTED, true).apply { letterSpacing = 0.08f })
            addView(Ui.text(this@LiteActivity, t.second, 22f, if (t.third) accent else C.TX, true))
        })
        fun fila(x: Triple<String, String, Boolean>, y: Triple<String, String, Boolean>) = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(mini(x), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { rightMargin = dp(5) })
            addView(mini(y), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { leftMargin = dp(5) })
        }
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(fila(a[0], a[1]))
            addView(fila(b[0], b[1]))
        }
    }

    // ── productos publicados en la nube ─────────────────────────────────
    /**
     * Catálogo que ve el comprador. Se baja con `local_ver` (público) y se
     * edita con `productos_subir` + la clave de la tienda. La copia local
     * (`shop_catalogo`) permite editar sin red y ver qué quedó publicado.
     */
    private fun productos(): View {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(6), dp(14), dp(18))
        }
        box.addView(Ui.title(this, "Productos", "El catálogo que ve el comprador en tu tienda."))
        val cfg = Shop.leer(db)
        if (cfg == null) {
            box.addView(Ui.card(this, "Sin tienda conectada",
                "Conecta la tienda en la pestaña Tienda para ver y editar su catálogo.", "desconectado", false))
            box.addView(Ui.button(this, "Ir a Tienda", true) { tab = 1; render() })
            return box
        }

        if (tiendaMsg.isNotBlank()) {
            box.addView(Ui.text(this, tiendaMsg, 12.5f, if (tiendaOk) C.OK else C.ERR))
        }

        box.addView(Ui.row(this,
            Ui.button(this, "Actualizar", true) {
                if (tiendaOcupado) return@button
                trabajo("Bajando el catálogo publicado…") {
                    val r = Shop.catalogo(cfg)
                    if (r.ok) {
                        val lista = r.json?.optJSONObject("tienda")?.optJSONArray("catalogo")
                        db.catalogoLimpiar()
                        for (i in 0 until (lista?.length() ?: 0)) {
                            val p = lista?.optJSONObject(i) ?: continue
                            db.catalogoUpsert(
                                p.optString("sku").ifBlank { p.optString("codigo") },
                                p.optString("nombre"),
                                p.optDouble("precio", 0.0),
                                p.optInt("stock", 0),
                                p.optString("categoria"),
                                p.optString("unidad"),
                            )
                        }
                        db.syncGuardar(true, lista?.length() ?: 0, "catálogo publicado")
                    }
                    r
                }
            },
            Ui.button(this, "Nuevo producto", false) { nuevoProducto(cfg) }
        ))

        val filas = db.raw(
            "SELECT sku, nombre, precio, stock, unidad FROM shop_catalogo ORDER BY nombre COLLATE NOCASE"
        ).second
        if (filas.isEmpty()) {
            box.addView(Ui.card(this, "Sin productos en el equipo",
                "Pulsa Actualizar para bajar el catálogo de la nube, o crea el primero.", "vacío", false))
            return box
        }
        filas.forEach { f ->
            val sku = f.getOrNull(0).orEmpty()
            val nombre = f.getOrNull(1).orEmpty()
            val precio = f.getOrNull(2)?.toDoubleOrNull() ?: 0.0
            val stock = f.getOrNull(3)?.toIntOrNull() ?: 0
            val unidad = f.getOrNull(4).orEmpty()
            val cuerpo = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                addView(Ui.text(this@LiteActivity, nombre.ifBlank { sku }, 14.5f, C.TX, true))
                addView(Ui.text(this@LiteActivity,
                    clp(precio) + " · stock " + stock + (if (unidad.isNotBlank()) " · $unidad" else "") + " · $sku",
                    11.5f, C.MUTED))
                addView(Ui.button(this@LiteActivity, "Editar", false) {
                    editarProducto(cfg, sku, nombre, precio, stock, unidad)
                })
            }
            box.addView(Ui.card(this, cuerpo))
        }
        return box
    }

    /** Diálogo de edición: nombre, precio y stock. El SKU no se cambia. */
    private fun editarProducto(cfg: Shop.Cfg, sku: String, nombre: String, precio: Double, stock: Int, unidad: String) {
        val campos = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(8), dp(16), 0)
        }
        val n = Ui.field(this, "Nombre", value = nombre)
        val p = Ui.field(this, "Precio (CLP)", value = if (precio == 0.0) "" else precio.toLong().toString())
        val st = Ui.field(this, "Stock", value = stock.toString())
        campos.addView(n); campos.addView(p); campos.addView(st)
        android.app.AlertDialog.Builder(this)
            .setTitle("Editar $sku")
            .setView(campos)
            .setNegativeButton("Cancelar", null)
            .setPositiveButton("Guardar") { _, _ ->
                val nuevoNombre = n.text.toString().trim()
                val nuevoPrecio = p.text.toString().replace(",", ".").toDoubleOrNull() ?: 0.0
                val nuevoStock = st.text.toString().toIntOrNull() ?: 0
                if (nuevoNombre.length < 2) {
                    tiendaOk = false; tiendaMsg = "El nombre necesita al menos 2 caracteres."; render(); return@setPositiveButton
                }
                trabajo("Guardando $sku en la nube…") {
                    val prod = JSONObject()
                        .put("sku", sku)
                        .put("nombre", nuevoNombre)
                        .put("precio", nuevoPrecio)
                        .put("stock", nuevoStock)
                        .put("unidad", unidad.ifBlank { "unidad" })
                        .put("categoria", "general")
                    val r = Shop.guardarProducto(cfg, prod)
                    if (r.ok) {
                        db.catalogoUpsert(sku, nuevoNombre, nuevoPrecio, nuevoStock, "general", unidad)
                        db.syncGuardar(true, 1, "producto $sku")
                    } else {
                        db.falloGuardar(r.texto)
                        db.syncGuardar(false, 0, r.texto)
                    }
                    r
                }
            }
            .show()
    }

    /** Alta rápida de un producto nuevo en el catálogo publicado. */
    private fun nuevoProducto(cfg: Shop.Cfg) {
        val campos = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(8), dp(16), 0)
        }
        val sku = Ui.field(this, "SKU / código")
        val n = Ui.field(this, "Nombre")
        val p = Ui.field(this, "Precio (CLP)")
        val st = Ui.field(this, "Stock", value = "0")
        campos.addView(sku); campos.addView(n); campos.addView(p); campos.addView(st)
        android.app.AlertDialog.Builder(this)
            .setTitle("Nuevo producto")
            .setView(campos)
            .setNegativeButton("Cancelar", null)
            .setPositiveButton("Guardar") { _, _ ->
                val s1 = sku.text.toString().trim()
                val n1 = n.text.toString().trim()
                if (s1.isBlank() || n1.length < 2) {
                    tiendaOk = false; tiendaMsg = "El SKU y el nombre son obligatorios."; render(); return@setPositiveButton
                }
                trabajo("Creando $s1 en la nube…") {
                    val prod = JSONObject()
                        .put("sku", s1).put("nombre", n1)
                        .put("precio", p.text.toString().replace(",", ".").toDoubleOrNull() ?: 0.0)
                        .put("stock", st.text.toString().toIntOrNull() ?: 0)
                        .put("unidad", "unidad").put("categoria", "general")
                    val r = Shop.guardarProducto(cfg, prod)
                    if (r.ok) db.syncGuardar(true, 1, "producto $s1")
                    else { db.falloGuardar(r.texto); db.syncGuardar(false, 0, r.texto) }
                    r
                }
            }
            .show()
    }

    // ── clientes (CRM) ──────────────────────────────────────────────────
    /**
     * El CRM no inventa una agenda: son quienes compraron. La nube agrega los
     * pedidos y devuelve el teléfono enmascarado y un id opaco; aquí sólo se
     * listan y se guardan como espejo local.
     */
    private fun clientes(): View {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(6), dp(14), dp(18))
        }
        box.addView(Ui.title(this, "Clientes", "Quienes compraron en tu tienda, con lo que gastan."))
        val cfg = Shop.leer(db)
        if (cfg == null) {
            box.addView(Ui.card(this, "Sin tienda conectada",
                "Conecta la tienda para ver sus clientes.", "desconectado", false))
            box.addView(Ui.button(this, "Ir a Tienda", true) { tab = 1; render() })
            return box
        }
        if (tiendaMsg.isNotBlank()) {
            box.addView(Ui.text(this, tiendaMsg, 12.5f, if (tiendaOk) C.OK else C.ERR))
        }
        box.addView(Ui.button(this, "Actualizar clientes", true) {
            if (tiendaOcupado) return@button
            trabajo("Leyendo los clientes de la nube…") {
                val r = Shop.clientes(cfg)
                if (r.ok) {
                    val lista = r.json?.optJSONArray("clientes")
                    db.clientesLimpiar()
                    for (i in 0 until (lista?.length() ?: 0)) {
                        val c = lista?.optJSONObject(i) ?: continue
                        db.clienteUpsert(
                            c.optString("id"),
                            c.optString("nombre"),
                            c.optString("telefono"),
                            c.optInt("pedidos", 0),
                            c.optDouble("gastado", 0.0),
                            c.optDouble("ticket", 0.0),
                            c.optString("segmento"),
                            System.currentTimeMillis(),
                        )
                    }
                    db.syncGuardar(true, 0, "clientes")
                }
                r
            }
        })

        val filas = db.raw(
            "SELECT nombre, telefono, pedidos, gastado, segmento FROM shop_clientes ORDER BY gastado DESC"
        ).second
        if (filas.isEmpty()) {
            box.addView(Ui.card(this, "Todavía no hay clientes",
                "Aparecen cuando entra el primer pedido. Pulsa Actualizar.", "vacío", false))
            return box
        }
        val total = filas.size
        val recurrentes = filas.count { (it.getOrNull(4) ?: "") == "recurrente" }
        val gastado = filas.sumOf { it.getOrNull(3)?.toDoubleOrNull() ?: 0.0 }
        box.addView(kpiRow(
            listOf(Triple("Clientes", total.toString(), true), Triple("Recurrentes", recurrentes.toString(), recurrentes > 0)),
            listOf(Triple("Gasto", clp(gastado), true), Triple("Datos", "nube", true))
        ))
        filas.forEach { f ->
            val cuerpo = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                addView(Ui.text(this@LiteActivity, f.getOrNull(0).orEmpty(), 14.5f, C.TX, true))
                addView(Ui.text(this@LiteActivity,
                    (f.getOrNull(1) ?: "") + " · " + (f.getOrNull(2) ?: "0") + " pedidos · " +
                        clp(f.getOrNull(3)?.toDoubleOrNull() ?: 0.0),
                    11.5f, C.MUTED))
            }
            box.addView(Ui.card(this, cuerpo))
            box.addView(Ui.text(this,
                f.getOrNull(4).orEmpty().ifBlank { "—" }, 11f,
                if ((f.getOrNull(4) ?: "") == "inactivo") C.MUTED else C.ACC, true))
        }
        return box
    }

    private fun clp(v: Double): String {
        val n = v.toLong()
        return "$" + n.toString().reversed().chunked(3).joinToString(".").reversed()
    }

    private fun ia(): View {
        val v = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        v.addView(Ui.title(this, "Integraciones de IA", "Tu clave, cifrada con el Keystore. Nunca se muestra ni se registra."))

        val saved = vault.list()
        if (saved.isNotEmpty()) {
            val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            col.addView(Ui.text(this, "Claves guardadas", 13f, C.TX2, true))
            saved.forEach { k ->
                val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(6), 0, dp(6)) }
                row.addView(Ui.text(this, "${Vault.provider(k.provider)?.name ?: k.provider}\n${k.masked} · ${k.model}", 12f, if (k.active) C.TX else C.MUTED, true),
                    LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                row.addView(Ui.button(this, "Probar", false) { probar(k) })
                row.addView(Ui.button(this, "Borrar", false) { vault.remove(k.id); render(); toast("Clave revocada") })
                col.addView(row)
            }
            v.addView(Ui.card(this, col))
        }

        // formulario por proveedor
        val prov = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        prov.addView(Ui.text(this, "Agregar proveedor", 13f, C.TX2, true))
        var sel = Vault.PROVIDERS.first()
        val provRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val provChips = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        Vault.PROVIDERS.forEach { p ->
            provChips.addView(Ui.pill(this, p.name, p.free, if (p.free) C.OK else C.CYAN).apply {
                setOnClickListener {
                    sel = p
                    for (i in 0 until provChips.childCount) provChips.getChildAt(i).alpha = 0.45f
                    alpha = 1f
                    toast("${p.name}: ${p.models.first()}")
                }
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { rightMargin = dp(6) })
        }
        provRow.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(provChips) })
        prov.addView(provRow)

        val key = Ui.field(this, "pega aquí la API key", password = true)
        val model = Ui.field(this, "modelo (opcional)", value = Vault.PROVIDERS.first().models.first())
        val base = Ui.field(this, "base URL", value = Vault.PROVIDERS.first().baseUrl)
        prov.addView(key); prov.addView(model); prov.addView(base)

        prov.addView(Ui.row(this,
            Ui.button(this, "Guardar cifrada", true) {
                val r = vault.save(sel.id, key.text.toString(), base.text.toString(), model.text.toString(), sel.name)
                r.onSuccess { key.setText(""); render(); toast("Clave cifrada y guardada") }
                    .onFailure { toast(it.message ?: "error") }
            },
            Ui.button(this, "Probar sin guardar", false) {
                val k = key.text.toString()
                if (k.length < 8) { toast("Pega la clave primero"); return@button }
                pool.execute {
                    val (ok, m) = Agent.ping(sel.id, base.text.toString(), k)
                    ui.post { toast((if (ok) "✓ " else "✗ ") + m) }
                }
            }
        ))
        v.addView(Ui.card(this, prov))

        // chat
        val chat = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        chat.addView(Ui.text(this, "Preguntar", 13f, C.TX2, true))
        val prompt = Ui.field(this, "pregunta para el agente")
        val answer = Ui.text(this, "", 13f, C.TX)
        chat.addView(prompt)
        chat.addView(Ui.row(this,
            Ui.button(this, "Enviar", true) {
                val q = prompt.text.toString().trim()
                if (q.isEmpty()) return@button
                val active = vault.list().firstOrNull { it.active }
                if (active == null) { toast("Guarda una clave primero"); return@button }
                answer.text = "consultando ${Vault.provider(active.provider)?.name}…"
                pool.execute {
                    val secret = vault.secret(active.id)
                    if (secret == null) { ui.post { answer.text = "No pude descifrar la clave" }; return@execute }
                    val r = Agent.ask(active.provider, active.baseUrl, active.model, secret, q)
                    db.writableDatabase.insert("messages", null, ContentValues().apply {
                        put("role", "user"); put("content", q); put("created_at", System.currentTimeMillis())
                    })
                    db.writableDatabase.insert("messages", null, ContentValues().apply {
                        put("role", "assistant"); put("content", r.text)
                        put("provenance", "${r.provider} · ${r.ms} ms"); put("created_at", System.currentTimeMillis())
                    })
                    db.metric("consultas_ia", 1.0)
                    ui.post {
                        answer.text = r.text
                        answer.setTextColor(if (r.ok) C.TX else C.WARN)
                    }
                }
            },
            Ui.button(this, "Limpiar", false) { answer.text = "" }
        ))
        chat.addView(answer)
        v.addView(Ui.card(this, chat))
        return v
    }

    private fun probar(k: Vault.Key) {
        toast("probando ${k.provider}…")
        pool.execute {
            val s = vault.secret(k.id)
            if (s == null) { ui.post { toast("No pude descifrar la clave") }; return@execute }
            val (ok, m) = Agent.ping(k.provider, k.baseUrl, s)
            ui.post { toast((if (ok) "✓ " else "✗ ") + m) }
        }
    }

    // ── 4 · PERMISOS ──────────────────────────────────────────────────────
    private fun permisos(): View {
        val v = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        v.addView(Ui.title(this, "Permisos y sandbox", "Lo que la app puede y no puede hacer"))

        data class P(val perm: String, val label: String, val why: String)

        val list = mutableListOf(
            P(Manifest.permission.INTERNET, "Internet", "Llamar a los proveedores de IA y sincronizar. Es de instalación: no se pide."),
            P(Manifest.permission.ACCESS_NETWORK_STATE, "Estado de red", "Saber si hay conexión antes de fallar.")
        )
        if (Build.VERSION.SDK_INT >= 33) list.add(P(Manifest.permission.POST_NOTIFICATIONS, "Notificaciones", "Avisar cuando termina una exportación o responde el agente."))
        if (Build.VERSION.SDK_INT <= 28) list.add(P(Manifest.permission.WRITE_EXTERNAL_STORAGE, "Almacenamiento", "Escribir los .xlsx en Descargas."))

        list.forEach { p ->
            val granted = checkSelfPermission(p.perm) == PackageManager.PERMISSION_GRANTED
            val row = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, dp(8), 0, dp(8)) }
            val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            head.addView(Ui.text(this, p.label, 14f, C.TX, true), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            head.addView(Ui.pill(this, if (granted) "concedido" else "falta", granted))
            row.addView(head)
            row.addView(Ui.text(this, p.why, 12f, C.TX2))
            if (!granted) row.addView(Ui.row(this, Ui.button(this, "Solicitar", true) {
                requestPermissions(arrayOf(p.perm), 42)
            }))
            v.addView(Ui.card(this, row))
        }

        // acceso total opcional (API 30+)
        if (Build.VERSION.SDK_INT >= 30) {
            v.addView(Ui.card(this, LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                addView(Ui.row(this@LiteActivity,
                    Ui.text(this@LiteActivity, "Todos los archivos", 14f, C.TX, true).also { },
                    Ui.pill(this@LiteActivity, "avanzado", false, C.WARN)
                ))
                addView(Ui.text(this@LiteActivity,
                    "Opcional. Sin esto la app funciona igual: guarda en Descargas/FORGE CORE STOCK con MediaStore. " +
                    "Con esto podría leer otras carpetas, incluido lo que exporte Termux. Se concede en los ajustes del sistema.", 12f, C.TX2))
                addView(Ui.row(this@LiteActivity,
                    Ui.button(this@LiteActivity, "Abrir ajustes", false) {
                        startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:$packageName")))
                    },
                    Ui.button(this@LiteActivity, "Ajustes de la app", false) {
                        startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
                    }
                ))
            }))
        }

        // estado de red real
        val cm = getSystemService(ConnectivityManager::class.java)
        val net = cm?.activeNetwork
        val caps = net?.let { cm.getNetworkCapabilities(it) }
        val online = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
        v.addView(Ui.card(this, "Red ahora", if (online) "Con conexión · ${caps?.let { if (it.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) "wifi" else "móvil" } ?: ""}" else "Sin conexión: la app funciona igual, sin agente", if (online) "online" else "offline", online))

        v.addView(Ui.card(this, "El sandbox, claro", "Esta app corre como su propio usuario Linux (uid ${android.os.Process.myUid()}), en su carpeta privada. " +
                "No ve el PRoot de Termux ni tiene root: son dos sandbox distintos. Para pasar datos, exporta a Descargas y ábrelos desde el otro lado.", "límite real"))
        return v
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        permissions.forEachIndexed { i, p ->
            val ok = grantResults.getOrNull(i) == PackageManager.PERMISSION_GRANTED
            db.writableDatabase.insertWithOnConflict("consents", null, ContentValues().apply {
                put("perm", p); put("granted", if (ok) 1 else 0); put("at", System.currentTimeMillis())
            }, android.database.sqlite.SQLiteDatabase.CONFLICT_REPLACE)
        }
        tab = 4; render()
    }

    // ── 5 · AJUSTES ───────────────────────────────────────────────────────
    private fun ajustes(): View {
        val v = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        v.addView(Ui.title(this, "Ajustes", "Cuenta, sesiones, color y mantenimiento"))

        val u = auth.current()
        v.addView(Ui.card(this, "Cuenta", "${u?.email ?: "sin sesión"}\nrol: ${u?.role} · uid #${u?.id}", "local"))

        val colors = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        listOf("lima" to C.ACC, "cian" to C.CYAN, "violeta" to C.VIOLET, "ambar" to C.WARN).forEach { (n, c) ->
            colors.addView(View(this).apply {
                background = GradientDrawable().apply { cornerRadius = dp(10).toFloat(); setColor(c) }
                layoutParams = LinearLayout.LayoutParams(dp(38), dp(38)).apply { rightMargin = dp(8) }
                setOnClickListener {
                    prefs.edit().putString("accent", n).apply()
                    accent = c; toast("Color: $n"); render()
                }
            })
        }
        v.addView(Ui.card(this, LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(Ui.text(this@LiteActivity, "Color de acento", 13f, C.TX2, true))
            addView(colors)
        }))

        val ses = auth.sessions()
        if (ses.isNotEmpty()) {
            val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            col.addView(Ui.text(this, "Sesiones (token hasheado en la base)", 13f, C.TX2, true))
            ses.take(6).forEach { s ->
                col.addView(Ui.text(this, "#${s[0]} · ${s[1]} · ${if (s[5] == "1") "revocada" else "activa"} · ${Ui.ago(s[3].toLongOrNull() ?: 0)}", 11.5f, if (s[5] == "1") C.MUTED else C.TX2))
            }
            v.addView(Ui.card(this, col))
        }

        v.addView(Ui.row(this,
            Ui.button(this, "Cerrar sesión", false) { auth.logout(); tab = 0; renderAuth() },
            Ui.button(this, "Exportar todo", true) { exportAll() },
            Ui.button(this, "Mantenimiento", false) {
                db.exec("VACUUM")
                db.exec("DELETE FROM memory_fts")
                db.exec("INSERT INTO memory_fts(content, rid, kind) SELECT content, id, kind FROM memory_items")
                db.log("info", "db", "mantenimiento manual")
                toast("VACUUM + índice reconstruido"); render()
            }
        ))

        val archivos = Export.saved(this)
        v.addView(Ui.card(this, LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(Ui.text(this@LiteActivity, "Descargas (${archivos.size})", 13f, C.TX2, true))
            if (archivos.isEmpty()) addView(Ui.text(this@LiteActivity, "Todavía no exportaste nada. Usa Exportar todo o la consola: export <tabla>", 12f, C.MUTED))
            archivos.take(8).forEach { a ->
                addView(Ui.text(this@LiteActivity, "${a[0]}\n${Ui.human(a[2].toLongOrNull() ?: 0)} · ${Ui.ago(a[4].toLongOrNull() ?: 0)}", 11.5f, C.TX2))
            }
        }))

        v.addView(Ui.card(this, "Sobre", "FORGE CORE STOCK 1.2.0 (build 2026-11-24) · ${packageName}\nSQLite ${db.scalar("SELECT sqlite_version()")} · ${db.ftsMode()} · ${tabs.size} módulos\nSin librerías externas: solo el SDK de Android.", "v1.2.0"))
        return v
    }

    // ── acciones ──────────────────────────────────────────────────────────
    private fun exportAll() {
        pool.execute {
            val stamp = System.currentTimeMillis() / 1000
            var n = 0
            db.tables().forEach { (t, _, _) ->
                val (cols, rows) = db.raw("SELECT * FROM \"$t\" LIMIT 5000")
                if (rows.isEmpty()) return@forEach
                val fname = "$t-$stamp.xlsx"
                val bytes = Export.xlsx(t, cols, rows)
                val p = Export.save(this, fname, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes)
                Export.register(this, fname, p, bytes.size.toLong(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "completo")
                n++
            }
            db.metric("exportaciones", n.toDouble())
            ui.post { toast("Exportadas $n tabla(s) a Descargas/FORGE CORE STOCK") ; render() }
        }
    }

    private fun exportText(name: String, txt: String) {
        val bytes = txt.toByteArray()
        pool.execute {
            val p = Export.save(this, "$name-${System.currentTimeMillis() / 1000}.txt", "text/plain", bytes)
            Export.register(this, "$name.txt", p, bytes.size.toLong(), "text/plain", name)
            ui.post { toast(if (p != null) "Guardado en $p" else "No se pudo guardar") }
        }
    }

    private fun toast(s: String) {
        android.widget.Toast.makeText(this, s, android.widget.Toast.LENGTH_SHORT).show()
    }

    // ── errores ───────────────────────────────────────────────────────────
    private fun crashCard(t: Throwable): View {
        val sw = java.io.StringWriter().also { t.printStackTrace(java.io.PrintWriter(it)) }
        val trace = sw.toString()
        db.log("error", "crash", trace.take(3800))
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(Ui.title(this@LiteActivity, "Algo falló, pero sigo vivo", "El error quedó registrado en la base (tabla logs)."))
            addView(Ui.card(this@LiteActivity, Ui.text(this@LiteActivity, trace.take(1200), 10.5f, C.ERR).apply { typeface = Typeface.MONOSPACE }))
            addView(Ui.row(this@LiteActivity,
                Ui.button(this@LiteActivity, "Reintentar", true) { render() },
                Ui.button(this@LiteActivity, "Copiar error", false) {
                    val cm = getSystemService(android.content.ClipboardManager::class.java)
                    cm.setPrimaryClip(android.content.ClipData.newPlainText("error", trace))
                    toast("Copiado")
                }
            ))
        }
    }

    private fun showCrash(t: Throwable) {
        val sw = java.io.StringWriter().also { t.printStackTrace(java.io.PrintWriter(it)) }
        val trace = sw.toString()
        try { File(filesDir, "crash.txt").writeText(trace) } catch (_: Throwable) { }
        val v = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(C.BG)
            setPadding(dp(18), dp(40), dp(18), dp(18))
        }
        v.addView(Ui.text(this, "FORGE CORE STOCK no pudo arrancar", 20f, C.ERR, true))
        v.addView(Ui.text(this, "Copia este texto y mándalo: es el diagnóstico exacto.", 12.5f, C.TX2))
        v.addView(ScrollView(this).apply {
            addView(Ui.text(this@LiteActivity, trace.take(4000), 10f, C.TX2).apply { typeface = Typeface.MONOSPACE })
            setBackgroundColor(0xFF050607.toInt())
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        v.addView(Ui.button(this, "Copiar error", true) {
            getSystemService(android.content.ClipboardManager::class.java)
                .setPrimaryClip(android.content.ClipData.newPlainText("error", trace))
        })
        setContentView(v)
    }

    override fun onDestroy() {
        super.onDestroy()
        try { pool.shutdownNow() } catch (_: Throwable) { }
    }
}
