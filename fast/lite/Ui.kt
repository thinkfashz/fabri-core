package cl.fabri.core.lite

import android.content.ContentValues
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.charset.StandardCharsets
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** Paleta y medidas. Un solo lugar para el diseño. */
object C {
    const val BG = 0xFF08090A.toInt()
    const val SURF = 0xFF101215.toInt()
    const val ELEV = 0xFF171A1E.toInt()
    const val LINE = 0xFF22262C.toInt()
    const val TX = 0xFFF2F5F0.toInt()
    const val TX2 = 0xFFA9B2AA.toInt()
    const val MUTED = 0xFF828C84.toInt()
    const val ACC = 0xFFC8F542.toInt()
    const val OK = 0xFF3DDC84.toInt()
    const val WARN = 0xFFFFC857.toInt()
    const val ERR = 0xFFFF6B6B.toInt()
    const val CYAN = 0xFF5AD9E8.toInt()
    const val VIOLET = 0xFFB39DFF.toInt()

    fun dp(ctx: Context, n: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, n.toFloat(), ctx.resources.displayMetrics).toInt()
}

fun Context.dp(n: Int) = C.dp(this, n)

/** Constructores de vistas: tarjetas, campos, tablas y gráficas. */
object Ui {

    fun text(ctx: Context, s: CharSequence, size: Float = 14f, color: Int = C.TX, bold: Boolean = false): TextView =
        TextView(ctx).apply {
            text = s
            setTextColor(color)
            textSize = size
            if (bold) typeface = Typeface.DEFAULT_BOLD
            setLineSpacing(0f, 1.35f)
        }

    fun title(ctx: Context, t: String, sub: String = ""): View = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(0, ctx.dp(12), 0, ctx.dp(8))
        addView(text(ctx, t, 22f, C.TX, true))
        if (sub.isNotBlank()) addView(text(ctx, sub, 12.5f, C.MUTED))
    }

    fun card(ctx: Context, body: View): LinearLayout = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        background = GradientDrawable().apply {
            cornerRadius = ctx.dp(16).toFloat()
            setColor(C.SURF)
            setStroke(ctx.dp(1), C.LINE)
        }
        setPadding(ctx.dp(14), ctx.dp(12), ctx.dp(14), ctx.dp(12))
        addView(body)
        val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        lp.bottomMargin = ctx.dp(10)
        layoutParams = lp
    }

    fun card(ctx: Context, title: String, detail: String, badge: String? = null, badgeOk: Boolean = true): View {
        val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val col = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        col.addView(text(ctx, title, 14.5f, C.TX, true))
        if (detail.isNotBlank()) col.addView(text(ctx, detail, 12.5f, C.TX2))
        row.addView(col, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        if (badge != null) row.addView(pill(ctx, badge, badgeOk))
        return card(ctx, row)
    }

    fun pill(ctx: Context, s: String, ok: Boolean = true, color: Int? = null): TextView {
        val c = color ?: if (ok) C.OK else C.WARN
        return TextView(ctx).apply {
            text = s.uppercase()
            textSize = 9.5f
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = 0.06f
            setTextColor(c)
            setPadding(ctx.dp(8), ctx.dp(3), ctx.dp(8), ctx.dp(3))
            background = GradientDrawable().apply {
                cornerRadius = ctx.dp(20).toFloat()
                setColor((c and 0x00FFFFFF) or 0x1A000000)
                setStroke(ctx.dp(1), (c and 0x00FFFFFF) or 0x40000000)
            }
        }
    }

    fun field(ctx: Context, hint: String, password: Boolean = false, value: String = ""): EditText =
        EditText(ctx).apply {
            this.hint = hint
            setText(value)
            textSize = 14.5f
            setTextColor(C.TX)
            setHintTextColor(C.MUTED)
            setSingleLine(true)
            setPadding(ctx.dp(12), ctx.dp(10), ctx.dp(12), ctx.dp(10))
            background = GradientDrawable().apply {
                cornerRadius = ctx.dp(12).toFloat(); setColor(C.ELEV); setStroke(ctx.dp(1), C.LINE)
            }
            if (password) inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            lp.bottomMargin = ctx.dp(8)
            layoutParams = lp
        }

    fun button(ctx: Context, label: String, primary: Boolean = true, onClick: () -> Unit): Button =
        Button(ctx).apply {
            text = label
            textSize = 13.5f
            isAllCaps = false
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(if (primary) C.BG else C.TX)
            background = GradientDrawable().apply {
                cornerRadius = ctx.dp(12).toFloat()
                if (primary) setColor(C.ACC) else { setColor(C.ELEV); setStroke(ctx.dp(1), C.LINE) }
            }
            stateListAnimator = null
            minHeight = 0
            minimumHeight = 0
            setPadding(ctx.dp(14), ctx.dp(10), ctx.dp(14), ctx.dp(10))
            setOnClickListener { onClick() }
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            lp.rightMargin = ctx.dp(8); lp.bottomMargin = ctx.dp(6)
            layoutParams = lp
        }

    fun row(ctx: Context, vararg views: View): LinearLayout = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        views.forEach { addView(it) }
    }

    /** Tabla con encabezado fijo y scroll horizontal: sirve para cualquier consulta. */
    fun table(ctx: Context, cols: List<String>, rows: List<List<String>>, maxRows: Int = 60): View {
        val wrap = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        if (cols.isEmpty()) return card(ctx, text(ctx, "Sin columnas", 13f, C.MUTED))

        fun cell(s: String, head: Boolean, w: Int = -1): TextView = text(
            ctx, s, if (head) 11.5f else 12.5f,
            if (head) C.MUTED else C.TX, head
        ).apply {
            setPadding(ctx.dp(8), ctx.dp(7), ctx.dp(8), ctx.dp(7))
            maxLines = if (head) 1 else 3
            if (w > 0) width = w
        }

        val headRow = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; setBackgroundColor(C.ELEV) }
        cols.forEach { headRow.addView(cell(it.uppercase(), true), LinearLayout.LayoutParams(ctx.dp(120), ViewGroup.LayoutParams.WRAP_CONTENT)) }
        wrap.addView(HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; addView(headRow) })

        val body = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        rows.take(maxRows).forEachIndexed { i, r ->
            val l = LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                if (i % 2 == 0) setBackgroundColor(0x14FFFFFF)
            }
            r.forEach { l.addView(cell(it, false), LinearLayout.LayoutParams(ctx.dp(120), ViewGroup.LayoutParams.WRAP_CONTENT)) }
            body.addView(l)
        }
        wrap.addView(HorizontalScrollView(ctx).apply { addView(body) })
        if (rows.size > maxRows) wrap.addView(text(ctx, "… ${rows.size - maxRows} fila(s) más", 11.5f, C.MUTED))
        return card(ctx, wrap)
    }

    /** Barras horizontales proporcionales, dibujadas con Canvas (sin librerías). */
    fun bars(ctx: Context, data: List<Pair<String, Double>>, color: Int = C.ACC): View {
        val max = (data.maxOfOrNull { it.second } ?: 0.0).coerceAtLeast(1.0)
        val col = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        data.take(12).forEach { (label, v) ->
            val r = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            r.addView(text(ctx, label, 11.5f, C.TX2).apply { width = ctx.dp(88); maxLines = 1 }, LinearLayout.LayoutParams(ctx.dp(88), ViewGroup.LayoutParams.WRAP_CONTENT))
            val bar = View(ctx).apply {
                background = GradientDrawable().apply { cornerRadius = ctx.dp(3).toFloat(); setColor(color) }
                layoutParams = LinearLayout.LayoutParams(0, ctx.dp(10), (v / max).toFloat().coerceAtLeast(0.02f))
            }
            val rest = View(ctx)
            r.addView(bar); r.addView(rest, LinearLayout.LayoutParams(0, 1, (1.0 - v / max).toFloat().coerceAtLeast(0.0f)))
            r.addView(text(ctx, fmtNum(v), 11.5f, C.TX, true).apply { width = ctx.dp(46); gravity = Gravity.END }, LinearLayout.LayoutParams(ctx.dp(46), ViewGroup.LayoutParams.WRAP_CONTENT))
            col.addView(r, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = ctx.dp(6) })
        }
        if (data.isEmpty()) col.addView(text(ctx, "Sin datos todavía", 12.5f, C.MUTED))
        return col
    }

    /** Gráfica de línea compacta para series temporales. */
    class Spark(ctx: Context, private val series: List<Double>, private val color: Int = C.ACC) : View(ctx) {
        private val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = C.dp(ctx, 2).toFloat() }
        private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
        override fun onDraw(canvas: Canvas) {
            if (series.size < 2) return
            val max = series.max().coerceAtLeast(1.0)
            val dx = width.toFloat() / (series.size - 1)
            val path = android.graphics.Path()
            series.forEachIndexed { i, v ->
                val y = height - (v / max * (height * 0.86)).toFloat() - 2f
                if (i == 0) path.moveTo(0f, y) else path.lineTo(i * dx, y)
            }
            val area = android.graphics.Path(path).apply {
                lineTo(width.toFloat(), height.toFloat()); lineTo(0f, height.toFloat()); close()
            }
            fill.color = (color and 0x00FFFFFF) or 0x22000000
            canvas.drawPath(area, fill)
            p.color = color
            canvas.drawPath(path, p)
        }
    }

    fun scroll(ctx: Context, content: View): View = ScrollView(ctx).apply {
        isFillViewport = true
        addView(content)
        setPadding(ctx.dp(14), ctx.dp(4), ctx.dp(14), ctx.dp(24))
        clipToPadding = false
    }

    // ── formato ───────────────────────────────────────────────────────────
    fun human(bytes: Long): String = when {
        bytes >= 1L shl 30 -> String.format("%.2f GB", bytes / 1073741824.0)
        bytes >= 1L shl 20 -> String.format("%.1f MB", bytes / 1048576.0)
        bytes >= 1024 -> String.format("%.0f KB", bytes / 1024.0)
        else -> "$bytes B"
    }

    fun fmtNum(v: Double): String =
        if (v == v.toLong().toDouble()) v.toLong().toString() else String.format("%.2f", v)

    fun ago(ms: Long): String {
        val d = (System.currentTimeMillis() - ms) / 1000
        return when {
            d < 60 -> "hace ${d}s"
            d < 3600 -> "hace ${d / 60}m"
            d < 86400 -> "hace ${d / 3600}h"
            else -> "hace ${d / 86400}d"
        }
    }
}

/** Exportación real a Excel (.xlsx) y CSV, con guardado en Descargas. */
object Export {

    /** XLSX mínimo pero válido: Excel, LibreOffice y Google Sheets lo abren. */
    fun xlsx(sheet: String, cols: List<String>, rows: List<List<String>>): ByteArray {
        fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace("\"", "&quot;").replace("\n", "&#10;")

        fun colName(i: Int): String = buildString {
            var n = i
            while (true) { append(('A' + n % 26)); n = n / 26 - 1; if (n < 0) break }
            reverse()
        }

        val sb = StringBuilder()
        sb.append("""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>""")
        sb.append("""<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>""")

        fun rowXml(r: Int, values: List<String>, head: Boolean) {
            sb.append("""<row r="$r">""")
            values.forEachIndexed { i, v ->
                val ref = "${colName(i)}$r"
                val num = if (!head) v.toDoubleOrNull() else null
                sb.append(if (num != null) {
                    """<c r="$ref" s="${if (head) 1 else 0}"><v>$num</v></c>"""
                } else {
                    """<c r="$ref" t="inlineStr" s="${if (head) 1 else 0}"><is><t xml:space="preserve">${esc(v)}</t></is></c>"""
                })
            }
            sb.append("</row>")
        }

        rowXml(1, cols, true)
        rows.forEachIndexed { i, r -> rowXml(i + 2, r, false) }
        sb.append("</sheetData></worksheet>")

        val contentTypes = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>"""

        val rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"""

        val workbook = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${esc(sheet.take(28))}" sheetId="1" r:id="rId1"/></sheets></workbook>"""

        val wbRels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"""

        val styles = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="2"><xf xfId="0"/><xf fontId="1" xfId="0" applyFont="1"/></cellXfs>
</styleSheet>"""

        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { z ->
            fun put(name: String, s: String) {
                z.putNextEntry(ZipEntry(name)); z.write(s.toByteArray(StandardCharsets.UTF_8)); z.closeEntry()
            }
            put("[Content_Types].xml", contentTypes)
            put("_rels/.rels", rels)
            put("xl/workbook.xml", workbook)
            put("xl/_rels/workbook.xml.rels", wbRels)
            put("xl/styles.xml", styles)
            put("xl/worksheets/sheet1.xml", sb.toString())
        }
        return out.toByteArray()
    }

    fun csv(cols: List<String>, rows: List<List<String>>): ByteArray {
        fun q(s: String) = "\"" + s.replace("\"", "\"\"") + "\""
        val sb = StringBuilder("\uFEFF") // BOM: Excel reconoce UTF-8
        sb.append(cols.joinToString(";") { q(it) }).append("\r\n")
        rows.forEach { sb.append(it.joinToString(";") { c -> q(c) }).append("\r\n") }
        return sb.toString().toByteArray(StandardCharsets.UTF_8)
    }

    /**
     * Guarda en Descargas (visible para el usuario y para Termux).
     * API 29+ usa MediaStore; antes, almacenamiento público con permiso.
     * Devuelve la ruta/URI visible o null si no se pudo.
     */
    fun save(ctx: Context, name: String, mime: String, bytes: ByteArray): String? = try {
        if (Build.VERSION.SDK_INT >= 29) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, mime)
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/FABRI-CORE")
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = ctx.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            if (uri == null) null
            else {
                ctx.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                values.clear(); values.put(MediaStore.Downloads.IS_PENDING, 0)
                ctx.contentResolver.update(uri, values, null, null)
                "Descargas/FABRI-CORE/$name"
            }
        } else {
            val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "FABRI-CORE")
            if (!dir.exists()) dir.mkdirs()
            val f = File(dir, name)
            f.writeBytes(bytes)
            f.absolutePath
        }
    } catch (e: Throwable) {
        Db.get(ctx).log("error", "export", e.message ?: "no se pudo guardar")
        null
    }

    fun register(ctx: Context, name: String, path: String?, size: Long, mime: String, kind: String) = try {
        Db.get(ctx).writableDatabase.insert("files", null, ContentValues().apply {
            put("name", name); put("path", path); put("size", size)
            put("mime", mime); put("kind", kind); put("at", System.currentTimeMillis())
        })
        Unit
    } catch (_: Throwable) { Unit }

    /** Archivos ya exportados por la app (lista real de Descargas). */
    fun saved(ctx: Context): List<List<String>> = try {
        Db.get(ctx).raw("SELECT name, kind, size, path, at FROM files ORDER BY id DESC LIMIT 100").second
    } catch (_: Throwable) { emptyList() }
}
