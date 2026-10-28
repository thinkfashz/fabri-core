/* ==========================================================================
   FABRI-CORE · Importación desde la SD (SQLite / Excel / texto)
   --------------------------------------------------------------------------
   El selector nativo de Android (SAF) entrega una URI, no una ruta. El puente
   copia el archivo a la caché de la app y devuelve qué contiene:

     { tipo: "sqlite", tablas: [{nombre, filas, columnas, muestra}], recomendada }
     { tipo: "xlsx",   hojas:  [{nombre, filas: [[...]], total, truncada}] }
     { tipo: "texto",  texto, extension }

   Aquí se elige tabla u hoja, se leen las filas y se pasan al mapeador de
   inventario.js (`invImportarFilas`), que reutiliza los alias de columnas y la
   vista previa de siempre. Nada se escribe en la base hasta confirmar.
   ========================================================================== */

(function () {
  "use strict";

  var ESTADO = {
    base: null,
    tipo: "",
    seleccion: "",
    filas: [],
    encabezados: [],
    limite: 5000,
    leyendo: false
  };

  function $(id) {
    return typeof document === "undefined" ? null : document.getElementById(id);
  }

  function nativo(metodo, args) {
    try {
      if (!window.FabrickNative || typeof window.FabrickNative[metodo] !== "function") {
        return { ok: false, error: "el puente nativo no está disponible" };
      }
      var crudo = window.FabrickNative[metodo].apply(window.FabrickNative, args || []);
      if (!crudo) return { ok: false, error: "respuesta vacía del puente" };
      return JSON.parse(crudo);
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  }

  function aviso(texto, tipo) {
    if (typeof window.toast === "function") window.toast(texto, tipo || "");
    else if (typeof window.invAviso === "function") window.invAviso(texto, tipo);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function miles(n) {
    try { return Number(n || 0).toLocaleString("es-CL"); }
    catch (e) { return String(n || 0); }
  }

  /* ── estado visual ────────────────────────────────────────────────────── */

  function estado(texto, error) {
    var caja = $("invBaseEstado");
    if (!caja) return;
    caja.textContent = texto || "";
    caja.className = "inv-ayuda" + (error ? " inv-error" : "");
  }

  function pintarTarjeta(nombre, chip) {
    var t = $("invEquipoBase");
    var c = $("invEquipoBaseChip");
    if (t) t.textContent = nombre || "SQLite, Excel o CSV";
    if (c) {
      c.textContent = chip || "—";
      c.className = "inv-chip" + (chip ? " lima" : "");
    }
  }

  function abrirPanel() {
    var panel = $("invImportarPanel");
    if (panel) panel.hidden = false;
    var base = $("invBaseNativa");
    if (base && base.scrollIntoView) {
      setTimeout(function () { base.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, 60);
    }
  }

  /* ── elegir archivo ───────────────────────────────────────────────────── */

  function elegir() {
    var r = nativo("elegirBase", []);
    if (!r || !r.ok) {
      var msg = (r && r.error) || "no se pudo abrir el selector";
      estado("No se pudo abrir el selector: " + msg, true);
      aviso("Selector de archivos: " + msg, "error");
      return r;
    }
    estado("Esperando que elijas el archivo en el teléfono…");
    pintarTarjeta("eligiendo archivo…", "…");
    return r;
  }

  /** Callback del puente cuando el usuario elige (o cancela) el archivo. */
  function base(ev) {
    if (!ev) return;
    if (ev.ok === false) {
      estado("No se pudo leer el archivo: " + (ev.error || "error"), true);
      aviso("Importar: " + (ev.error || "no se pudo leer el archivo"), "error");
      pintarTarjeta("", "");
      return;
    }

    ESTADO.base = ev;
    ESTADO.tipo = ev.tipo || "";
    ESTADO.seleccion = "";
    ESTADO.filas = [];
    ESTADO.encabezados = [];

    abrirPanel();

    if (ESTADO.tipo === "texto") {
      var t = $("invImportarTexto");
      if (t) t.value = ev.texto || "";
      if (window.INV) window.INV.importarNativo = false;
      if (typeof window.invImportarPrevia === "function") window.invImportarPrevia();
      var ext = String(ev.extension || "").toUpperCase() || "TEXTO";
      estado(ev.archivo + " · " + ext + " · " + miles(ev.bytes) + " bytes"
        + (ev.truncado ? " · se leyó sólo el inicio" : "") + ". Revisá la vista previa.");
      pintarTarjeta(ev.archivo || "texto", ext);
      ocultarSelector();
      aviso("Archivo cargado: " + (ev.archivo || "texto"));
      return;
    }

    if (ESTADO.tipo === "sqlite") {
      var tablas = ev.tablas || [];
      estado((ev.archivo || "base") + " · SQLite · " + tablas.length + " tabla(s). Elegí la que tiene los productos.");
      pintarTarjeta(ev.archivo || "SQLite", "SQLite");
      llenarSelector(tablas.map(function (x) {
        return {
          valor: x.nombre,
          texto: x.nombre + " · " + miles(x.filas) + " fila(s)",
          datos: x
        };
      }), ev.recomendada);
      return;
    }

    if (ESTADO.tipo === "xlsx") {
      var hojas = ev.hojas || [];
      estado((ev.archivo || "libro") + " · Excel · " + hojas.length + " hoja(s). Elegí la hoja de productos.");
      pintarTarjeta(ev.archivo || "Excel", "Excel");
      llenarSelector(hojas.map(function (x) {
        return {
          valor: x.nombre,
          texto: x.nombre + " · " + miles(x.total) + " fila(s)",
          datos: x
        };
      }), ev.recomendada);
      return;
    }

    estado("El archivo no tiene un formato reconocible.", true);
    pintarTarjeta("", "");
  }

  function cancelado() {
    estado("Selección cancelada. Podés elegir otro archivo cuando quieras.");
    pintarTarjeta("", "");
    aviso("No se eligió ningún archivo");
  }

  function ocultarSelector() {
    var sel = $("invBaseSelector");
    if (sel) sel.hidden = true;
    var m = $("invBaseMuestra");
    if (m) m.innerHTML = "";
  }

  function llenarSelector(opciones, recomendada) {
    var sel = $("invBaseTabla");
    var caja = $("invBaseSelector");
    if (!sel || !caja) return;
    sel.innerHTML = opciones.map(function (o) {
      return '<option value="' + esc(o.valor) + '">' + esc(o.texto) + "</option>";
    }).join("");
    caja.hidden = false;

    var elegida = recomendada;
    if (!elegida || !opciones.some(function (o) { return o.valor === elegida; })) {
      elegida = opciones.length ? opciones[0].valor : "";
    }
    if (elegida) {
      sel.value = elegida;
      ESTADO.seleccion = elegida;
      // Deja pintar el selector antes de leer la tabla.
      setTimeout(function () { seleccionar(elegida); }, 40);
    }
  }

  /* ── leer la tabla u hoja elegida ─────────────────────────────────────── */

  function seleccionar(nombre) {
    if (!ESTADO.base) return;
    ESTADO.seleccion = nombre;
    ESTADO.limite = Number(($("invBaseLimite") || {}).value || 5000) || 5000;

    if (ESTADO.tipo === "sqlite") {
      var tabla = (ESTADO.base.tablas || []).filter(function (x) { return x.nombre === nombre; })[0];
      if (!tabla) return;
      estado("Leyendo " + nombre + "…");
      ESTADO.leyendo = true;
      setTimeout(function () {
        var r = nativo("leerTablaBase", [nombre, ESTADO.limite, 0]);
        ESTADO.leyendo = false;
        if (!r || !r.ok) {
          estado("No se pudo leer la tabla: " + ((r && r.error) || "error"), true);
          aviso("Tabla " + nombre + ": " + ((r && r.error) || "error"), "error");
          return;
        }
        var filasObj = r.filas || [];
        var columnas = tabla.columnas || [];
        if (!columnas.length && filasObj.length) columnas = Object.keys(filasObj[0]);
        var filas = filasObj.map(function (o) {
          return columnas.map(function (c) { return o[c] == null ? "" : o[c]; });
        });
        ESTADO.encabezados = columnas;
        ESTADO.filas = filas;
        pintarMuestra("SQLite · " + nombre, columnas, filas, r.total, r.truncado);
        aplicar();
        estado(nombre + " · " + miles(r.filas ? r.filas.length : 0) + " de "
          + miles(r.total) + " fila(s) leídas. Revisá la vista previa y confirmá abajo.");
      }, 30);
      return;
    }

    if (ESTADO.tipo === "xlsx") {
      var hoja = (ESTADO.base.hojas || []).filter(function (x) { return x.nombre === nombre; })[0];
      if (!hoja) return;
      var todas = hoja.filas || [];
      var limite = Math.min(ESTADO.limite, todas.length);
      var primeras = todas.slice(0, limite);
      var encabezados = primeras.length ? primeras[0].map(String) : [];
      var datos = primeras.slice(1);
      ESTADO.encabezados = encabezados;
      ESTADO.filas = datos;
      pintarMuestra("Excel · " + nombre, encabezados, datos, hoja.total, hoja.truncada || limite < todas.length);
      aplicar();
      estado(nombre + " · " + miles(datos.length) + " fila(s) de datos. Revisá la vista previa y confirmá abajo.");
      return;
    }
  }

  /** Pasa las filas al mapeador de inventario.js. */
  function aplicar() {
    if (!ESTADO.filas.length) return;
    if (typeof window.invImportarFilas === "function") {
      var etiqueta = ESTADO.tipo === "sqlite" ? "SQLite" : "Excel";
      window.invImportarFilas(ESTADO.encabezados, ESTADO.filas,
        etiqueta + " · " + ESTADO.seleccion);
    }
  }

  function pintarMuestra(titulo, encabezados, filas, total, truncado) {
    var caja = $("invBaseMuestra");
    if (!caja) return;
    var cabecera = encabezados.slice(0, 6);
    var cuerpo = filas.slice(0, 5).map(function (f) {
      return "<tr>" + cabecera.map(function (_, i) {
        return "<td>" + esc(f[i] == null ? "" : f[i]) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    caja.innerHTML = `
      <div class="inv-meta">
        <span class="inv-chip lima">${esc(titulo)}</span>
        <span class="inv-chip">${miles(filas.length)} fila(s)</span>
        <span class="inv-chip">${cabecera.length} columna(s)</span>
        ${truncado ? `<span class="inv-chip baja">se leyó una parte de ${miles(total)}</span>` : ""}
      </div>
      <div class="inv-tabla-scroll">
        <table class="inv-tabla">
          <thead><tr>${cabecera.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("")}</tr></thead>
          <tbody>${cuerpo || `<tr><td colspan="${Math.max(1, cabecera.length)}">Sin filas de datos.</td></tr>`}</tbody>
        </table>
      </div>`;
  }

  /* ── arranque ─────────────────────────────────────────────────────────── */

  function iniciarUi() {
    if ($("btnInvBaseElegir")) $("btnInvBaseElegir").addEventListener("click", elegir);
    if ($("invBaseTabla")) $("invBaseTabla").addEventListener("change", function () {
      seleccionar(this.value);
    });
    if ($("invBaseLimite")) $("invBaseLimite").addEventListener("change", function () {
      ESTADO.limite = Number(this.value) || 5000;
      if (ESTADO.seleccion) seleccionar(ESTADO.seleccion);
    });
  }

  window.FabriImportar = {
    elegir: elegir,
    base: base,
    cancelado: cancelado,
    seleccionar: seleccionar,
    estado: ESTADO,
    iniciarUi: iniciarUi
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", iniciarUi);
    } else {
      iniciarUi();
    }
  }
})();
