/* ==========================================================================
   PÁGINA: Seguimiento de pedido (seguir.html)
   --------------------------------------------------------------------------
   El comprador abre el enlace que le dio el local (`?t=<token>`) y ve cómo va
   su pedido sin crear cuenta. Si perdió el enlace, escribe el código MP-XXXXX
   y los últimos 4 dígitos del teléfono.

   Toda la lógica de pintado vive aquí; las funciones puras (normalizar el
   código, armar los pasos, formatear fechas) se exponen en `Seguir._test`
   para poder probarlas sin navegador.
   ========================================================================== */

(function () {
  "use strict";

  var MERCADO = "https://fabri-api.vercel.app/api/mercado";
  var K_ULTIMO = "fcs.seguir.ultimo";   // { codigo, token } del último pedido
  var F = window.FCS || {};

  /* ── utilidades puras ─────────────────────────────────────────────────── */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function clp(n) {
    var v = Number(n) || 0;
    try {
      return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(v);
    } catch (e) { return "$" + Math.round(v); }
  }

  /**
   * Deja el código como lo guarda la base: `MP-ABCDE`.
   * Acepta `mpabcde`, `MP ABCDE`, `ABCDE` o `MP-ABCDE`, porque el comprador lo
   * escribe como puede. Si no trae el prefijo y son 5 caracteres, lo agrega.
   */
  function normalizarCodigo(v) {
    var s = String(v == null ? "" : v).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!s) return "";
    if (s.indexOf("MP") === 0) s = s.slice(2);
    if (!s) return "";
    return "MP-" + s.slice(0, 5);
  }

  /** Últimos 4 dígitos de un teléfono escrito de cualquier forma. */
  function telefono4(v) {
    var d = String(v == null ? "" : v).replace(/\D/g, "");
    return d.length >= 4 ? d.slice(-4) : "";
  }

  /** «recibido», «preparando», «listo», «entregado» o «cancelado». */
  var ESTADOS = {
    nuevo:     { chip: "Recibido",     titulo: "El local recibió tu pedido",      clase: "nuevo" },
    visto:     { chip: "Preparando",   titulo: "Están preparando tu pedido",      clase: "visto" },
    listo:     { chip: "Listo",        titulo: "Tu pedido está listo",            clase: "listo" },
    entregado: { chip: "Entregado",    titulo: "Pedido entregado",                clase: "entregado" },
    cancelado: { chip: "Cancelado",    titulo: "El pedido fue cancelado",         clase: "cancelado" }
  };

  function estadoInfo(estado, entrega) {
    var e = ESTADOS[estado] || ESTADOS.nuevo;
    if (estado === "listo" && entrega === "delivery") {
      return { chip: "En camino", titulo: "Tu pedido va en camino", clase: "listo" };
    }
    return e;
  }

  var PASOS = [
    { clave: "nuevo", txt: "Pedido recibido" },
    { clave: "visto", txt: "En preparación" },
    { clave: "listo", txt: "Listo" },
    { clave: "entregado", txt: "Entregado" }
  ];

  /**
   * Pasos de la línea de tiempo con su marca de tiempo.
   * `eventos` es el historial real (puede venir vacío en pedidos antiguos, y
   * entonces se usa `creado` para el primer paso). Un pedido cancelado corta
   * la línea: los pasos posteriores no se marcan como hechos.
   */
  function pasos(estado, eventos, creado) {
    var hist = Array.isArray(eventos) ? eventos : [];
    var ts = {};
    for (var i = 0; i < hist.length; i++) {
      var ev = hist[i] || {};
      if (ev.estado) ts[ev.estado] = ev.ts;
    }
    if (!ts.nuevo && creado) ts.nuevo = creado;

    var indice = { nuevo: 0, visto: 1, listo: 2, entregado: 3 }[estado];
    var cancelado = estado === "cancelado";

    var lista = PASOS.map(function (p, n) {
      var hecho = cancelado ? Boolean(ts[p.clave]) : indice != null && n <= indice;
      return {
        clave: p.clave,
        txt: p.txt,
        ts: ts[p.clave] || 0,
        hecho: hecho,
        actual: !cancelado && n === indice
      };
    });

    if (cancelado) {
      lista.push({ clave: "cancelado", txt: "Cancelado", ts: ts.cancelado || 0, hecho: true, actual: true });
    }
    return lista;
  }

  /** «hoy 14:32» · «ayer 09:10» · «10 nov 18:00». Acepta número o ISO. */
  function fechaCorta(ms, ahoraMs) {
    var t = ms instanceof Date ? ms.getTime()
      : (typeof ms === "string" ? Date.parse(ms) : Number(ms));
    if (!t || !isFinite(t)) return "";
    var ahora = Number(ahoraMs) || Date.now();
    var d = new Date(t);
    var hora = "";
    try {
      hora = d.toLocaleTimeString("es-CL", {
        hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Santiago"
      });
    } catch (e) { hora = ""; }
    var dia = "";
    try {
      dia = d.toLocaleDateString("es-CL", { day: "numeric", month: "short", timeZone: "America/Santiago" })
        .replace(/\.$/, "");
    } catch (e) { dia = ""; }

    var diaMs = 86400000;
    var dif = Math.floor((ahora - t) / diaMs);
    if (dif <= 0) return "hoy " + hora;
    if (dif === 1) return "ayer " + hora;
    return dia + " " + hora;
  }

  /* ── red ──────────────────────────────────────────────────────────────── */

  function ultimo() {
    try {
      var d = JSON.parse(localStorage.getItem(K_ULTIMO) || "null");
      return d && d.token ? d : null;
    } catch (e) { return null; }
  }

  function guardarUltimo(codigo, token) {
    if (!token) return;
    try { localStorage.setItem(K_ULTIMO, JSON.stringify({ codigo: codigo, token: token })); }
    catch (e) { /* modo privado: el enlace igual sirve */ }
  }

  function buscar(cuerpo) {
    return fetch(MERCADO, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo)
    }).then(function (r) {
      return r.json().catch(function () { return {}; });
    });
  }

  /* ── pintado ──────────────────────────────────────────────────────────── */

  function error(txt) {
    var el = document.getElementById("sgError");
    if (!el) return;
    if (!txt) { el.hidden = true; el.textContent = ""; return; }
    el.hidden = false;
    el.textContent = txt;
  }

  function cargando(si) {
    var b = document.getElementById("sgBuscar");
    if (!b) return;
    b.disabled = Boolean(si);
    b.textContent = si ? "Buscando…" : "Ver el pedido";
  }

  function linea(pedido) {
    var lista = pasos(pedido.estado, pedido.eventos, pedido.creado);
    return '<ol class="sg-pasos">' + lista.map(function (p) {
      return '<li class="sg-paso' + (p.hecho ? " hecho" : "") + (p.actual ? " actual" : "") +
        (p.clave === "cancelado" ? " cancelado" : "") + '">' +
        '<i aria-hidden="true"></i>' +
        '<div><b>' + esc(p.txt) + "</b>" +
        (p.ts ? "<small>" + esc(fechaCorta(p.ts)) + "</small>" : "") +
        "</div></li>";
    }).join("") + "</ol>";
  }

  function resumen(pedido) {
    var items = Array.isArray(pedido.items) ? pedido.items : [];
    var filas = items.map(function (x) {
      var n = Number(x.cantidad) || 1;
      var precio = Number(x.precio) || 0;
      return '<div class="sg-linea"><span>' + n + " × " + esc(x.nombre || "Producto") +
        "</span><b>" + clp(precio * n) + "</b></div>";
    }).join("");
    var envio = Number(pedido.envio) || 0;
    return '<div class="ds-card sg-resumen">' +
      '<div class="sg-resumen-cab"><h2>Tu pedido</h2>' +
        '<span class="ds-badge">' + items.length + (items.length === 1 ? " producto" : " productos") + "</span></div>" +
      filas +
      (envio ? '<div class="sg-linea sg-linea--sub"><span>Envío</span><b>' + clp(envio) + "</b></div>" : "") +
      '<div class="sg-linea sg-linea--total"><span>Total</span><b>' + clp(pedido.total) + "</b></div>" +
      '<p class="sg-dato"><b>Entrega:</b> ' + esc(pedido.entrega === "delivery"
        ? "Delivery" + (pedido.direccion ? " a " + pedido.direccion : "") : "Retiro en el local") + "</p>" +
      (pedido.nota ? '<p class="sg-dato"><b>Nota:</b> ' + esc(pedido.nota) + "</p>" : "") +
    "</div>";
  }

  function localHtml(pedido) {
    var l = pedido.local || {};
    var tel = String(l.telefono || "").replace(/[^\d]/g, "");
    var wa = "";
    if (tel.length >= 8) {
      var numero = tel.indexOf("56") === 0 ? tel : "56" + tel.replace(/^0/, "");
      wa = "https://wa.me/" + numero + "?text=" +
        encodeURIComponent("Hola, consulto por mi pedido " + (pedido.codigo || ""));
    }
    return '<div class="ds-card sg-local">' +
      '<div class="sg-local-cab">' +
        "<h2>" + esc(l.nombre || "El local") + "</h2>" +
        '<span class="ds-badge ' + (l.abierto ? "ds-badge--ok" : "ds-badge--warn") + '">' +
          (l.abierto ? "abierto" : "cerrado") + "</span>" +
      "</div>" +
      (l.direccion || l.comuna
        ? '<p class="sg-dato">' + esc([l.direccion, l.comuna].filter(Boolean).join(", ")) + "</p>" : "") +
      (l.horario ? '<p class="sg-dato"><b>Horario:</b> ' + esc(l.horario) + "</p>" : "") +
      (wa ? '<a class="ds-btn ds-btn--secondary ds-btn--block sg-wa" href="' + esc(wa) +
        '" target="_blank" rel="noopener">Escribir al local por WhatsApp</a>' : "") +
    "</div>";
  }

  function pintar(pedido) {
    var cont = document.getElementById("sgResultado");
    if (!cont) return;
    var est = estadoInfo(pedido.estado, pedido.entrega);
    cont.innerHTML =
      '<div class="sg-estado sg-estado--' + est.clase + '">' +
        '<span class="ds-badge ds-badge--solid">' + esc(est.chip) + "</span>" +
        "<b>" + esc(est.titulo) + "</b>" +
        "<small>Pedido " + esc(pedido.codigo || "") +
          (pedido.local && pedido.local.nombre ? " · " + esc(pedido.local.nombre) : "") +
        "</small>" +
      "</div>" +
      linea(pedido) +
      resumen(pedido) +
      localHtml(pedido);
    cont.hidden = false;
    error("");

    // El formulario deja de estorbar cuando ya hay un pedido en pantalla.
    var form = document.getElementById("sgForm");
    if (form) form.hidden = true;
    var pie = document.getElementById("sgPie");
    if (pie) pie.hidden = true;
    var sub = document.getElementById("sgSub");
    if (sub) sub.textContent = "Este es el estado de tu pedido. El local lo actualiza desde su panel.";

    try {
      cont.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) { /* navegador viejo */ }
  }

  function mostrarError(txt) {
    error(txt);
    var cont = document.getElementById("sgResultado");
    if (cont) cont.hidden = true;
    var form = document.getElementById("sgForm");
    if (form) form.hidden = false;
  }

  /* ── flujo ────────────────────────────────────────────────────────────── */

  function porToken(token) {
    cargando(true);
    error("");
    return buscar({ accion: "pedido_seguir", token: token }).then(function (d) {
      cargando(false);
      if (d && d.ok && d.pedido) {
        guardarUltimo(d.pedido.codigo, token);
        pintar(d.pedido);
      } else {
        mostrarError((d && d.error) || "No pudimos abrir ese enlace. Revisa el código.");
      }
    }).catch(function () {
      cargando(false);
      mostrarError("No hay conexión. Revisa tu internet e inténtalo de nuevo.");
    });
  }

  function porCodigo(codigo, contacto) {
    cargando(true);
    error("");
    return buscar({ accion: "pedido_seguir", codigo: codigo, contacto: contacto })
      .then(function (d) {
        cargando(false);
        if (d && d.ok && d.pedido) {
          pintar(d.pedido);
        } else {
          mostrarError((d && d.error) || "No encontramos ese pedido.");
        }
      }).catch(function () {
        cargando(false);
        mostrarError("No hay conexión. Revisa tu internet e inténtalo de nuevo.");
      });
  }

  function montar() {
    if (F.montaNav) F.montaNav();

    var form = document.getElementById("sgForm");
    var codigo = document.getElementById("sgCodigo");
    var tel = document.getElementById("sgTel");

    if (form) {
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var c = normalizarCodigo(codigo ? codigo.value : "");
        var t = telefono4(tel ? tel.value : "");
        if (!c || c === "MP-") { mostrarError("Escribe el código del pedido (por ejemplo MP-ABCDE)."); if (codigo) codigo.focus(); return; }
        if (!t) { mostrarError("Escribe los últimos 4 dígitos del teléfono con que hiciste el pedido."); if (tel) tel.focus(); return; }
        porCodigo(c, t);
      });
    }

    if (codigo) {
      codigo.addEventListener("input", function () {
        var pos = codigo.selectionStart;
        codigo.value = codigo.value.toUpperCase();
        try { codigo.setSelectionRange(pos, pos); } catch (e) { /* nada */ }
      });
    }

    var token = "";
    try { token = new URLSearchParams(location.search).get("t") || ""; } catch (e) { token = ""; }

    if (token) { porToken(token); return; }

    // Sin enlace: si este teléfono ya abrió un pedido, se muestra solo.
    var u = ultimo();
    if (u) { porToken(u.token); return; }
  }

  window.Seguir = {
    render: montar,
    buscar: porToken,
    _test: { normalizarCodigo: normalizarCodigo, telefono4: telefono4, estadoInfo: estadoInfo, pasos: pasos, fechaCorta: fechaCorta, clp: clp }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", montar);
  } else {
    montar();
  }
})();
