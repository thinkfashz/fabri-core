/* ==========================================================================
   TIENDA FORGE CORE STOCK · núcleo compartido
   --------------------------------------------------------------------------
   Lo que usan TODAS las páginas de la tienda:
     · catálogo en vivo desde fabri-api /api/catalogo (seed local de respaldo)
     · carrito persistente en localStorage (compartido entre páginas)
     · navegación: topbar + recorrido por pasos + bottom nav móvil
     · marca visual: reloj canvas, gauge d3, temporizador de oferta
     · QR real (ZXing) para producto y escáner
     · estados de pedido y cierre por WhatsApp
   Cada página se personaliza con <body data-pg="..."> (ver tienda.css).
   ========================================================================== */

window.FCS = (function () {
  "use strict";

  /* ── configuración ───────────────────────────────────────────────────── */
  var API = "https://fabri-api.vercel.app/api/catalogo";
  // Número real de WhatsApp: código de país + número, sin "+".
  var WA = (window.FORGE_WA && String(window.FORGE_WA)) || "56912345678";
  // Oferta activa: categoría con descuento. Se puede sobreescribir por página.
  var OFERTA = window.FORGE_OFERTA || { categoria: "Equipos", descuento: 20 };

  var LS = {
    carrito: "fcs_carrito",
    pedido: "fcs_pedido",
    resultado: "fcs_resultado",
    tour: "fcs_recorrido_visto",
    escaneos: "fcs_escaneos"
  };

  /* ── seed local (misma forma que la API) ─────────────────────────────── */
  var SEED = [
    { id: "eq-001", nombre: "Caja registradora táctil", categoria: "Equipos", clasificacion: "Gama alta", descripcion: "Pantalla de 15,6\" con Android integrado, impresora térmica de 80 mm y batería de respaldo.", precio: 489990, moneda: "CLP", stock: 12, tinte: "#c8f542" },
    { id: "eq-002", nombre: "Lector de códigos láser", categoria: "Equipos", clasificacion: "Gama media", descripcion: "Escáner de mano ergonómico, lee EAN-13, Code128 y QR a 30 cm.", precio: 45990, moneda: "CLP", stock: 40, tinte: "#8c8cff" },
    { id: "eq-003", nombre: "Báscula de mostrador", categoria: "Equipos", clasificacion: "Economico", descripcion: "Capacidad 30 kg, precisión de 5 g, cabezal orientable con teclado.", precio: 74990, moneda: "CLP", stock: 8, tinte: "#3fe0c9" },
    { id: "eq-004", nombre: "Terminal de punto de venta", categoria: "Equipos", clasificacion: "Gama alta", descripcion: "Procesador dual-core, doble pantalla, soporte VESA y 4 GB de RAM.", precio: 359990, moneda: "CLP", stock: 5, tinte: "#c8f542" },
    { id: "ac-001", nombre: "Papel térmico 80 mm", categoria: "Insumos", clasificacion: "Gama media", descripcion: "Rollos de 50 mm de diámetro, calidad industrial, por caja de 50 unidades.", precio: 18990, moneda: "CLP", stock: 120, tinte: "#5aa9ff" },
    { id: "ac-002", nombre: "Cinta para medir stock", categoria: "Insumos", clasificacion: "Economico", descripcion: "Rollo de 300 etiquetas por caja, resistente a agua y frío.", precio: 8990, moneda: "CLP", stock: 86, tinte: "#3fe0c9" },
    { id: "ac-003", nombre: "Cargador de sobremesa", categoria: "Accesorios", clasificacion: "Gama media", descripcion: "Fuente de 12 V / 3 A con cable de 1,5 m, ideal para terminales POS.", precio: 12990, moneda: "CLP", stock: 34, tinte: "#ffc24b" },
    { id: "ac-004", nombre: "Soporte metálico para display", categoria: "Accesorios", clasificacion: "Economico", descripcion: "Base orientable 360° con brazo ajustable en altura.", precio: 15990, moneda: "CLP", stock: 22, tinte: "#8c8cff" },
    { id: "au-001", nombre: "Altavoz de mostrador", categoria: "Audio", clasificacion: "Gama media", descripcion: "5 W, plug 3,5 mm, carcasa de aluminio.", precio: 19990, moneda: "CLP", stock: 18, tinte: "#c8f542" },
    { id: "au-002", nombre: "Torre de sonido para local", categoria: "Audio", clasificacion: "Gama alta", descripcion: "2×50 W, Bluetooth, entrada USB y control remoto.", precio: 129990, moneda: "CLP", stock: 6, tinte: "#ff7a8a" },
    { id: "pr-001", nombre: "Lámina anti-robo para vitrina", categoria: "Protección", clasificacion: "Premium", descripcion: "Lámina de seguridad de 0,22 mm con adhesivo de alta sujeción.", precio: 34990, moneda: "CLP", stock: 4, tinte: "#5aa9ff" },
    { id: "pr-002", nombre: "Candado de vitrina", categoria: "Protección", clasificacion: "Gama media", descripcion: "Cuerpo de acero, llave doble y cierre reforzado.", precio: 11990, moneda: "CLP", stock: 15, tinte: "#3fe0c9" }
  ];

  /* ── helpers ─────────────────────────────────────────────────────────── */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtCLP(n) {
    try {
      return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n);
    } catch (e) { return "$" + Math.round(n).toLocaleString("es-CL"); }
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function toast(msg) {
    var t = $("#tiToast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(t._x);
    t._x = setTimeout(function () { t.classList.remove("on"); }, 2000);
  }
  function param(nombre) {
    try { return new URLSearchParams(location.search).get(nombre) || ""; } catch (e) { return ""; }
  }

  /* ── datos ───────────────────────────────────────────────────────────── */
  var datos = null, origen = "local", lecturaTs = null;

  function cargar() {
    return fetch(API, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) {
        if (d && d.ok && Array.isArray(d.productos)) { datos = d; origen = "nube"; lecturaTs = Date.now(); return; }
        throw new Error("forma inválida");
      })
      .catch(function () { datos = { productos: SEED }; origen = "local"; lecturaTs = Date.now(); })
      .then(function () { pintaEstadoVivo(); });
  }

  // Estado vivo (sección 1 del orden Fabrick): "En vivo" solo si viene de la API.
  // Ojo: NO pisar className, si no la página pierde sus propias clases
  // (p. ej. ds-stat__meta en los KPIs).
  function pintaEstadoVivo() {
    var hora = new Date(lecturaTs).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    var esNube = origen === "nube";
    $$(".js-live").forEach(function (el) {
      el.classList.add("ds-live");
      el.classList.toggle("ds-live--stale", !esNube);
      el.innerHTML = esNube
        ? '<span class="ds-live__dot" aria-hidden="true"></span>En vivo · ' + hora
        : "Catálogo local · " + hora;
    });
  }

  function lista() { return (datos && datos.productos) || []; }
  function prod(id) {
    var l = lista();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  function categorias() { return uniq(function (p) { return p.categoria; }); }
  function clasificaciones() { return uniq(function (p) { return p.clasificacion; }); }
  function uniq(sel) {
    var v = [], s = {};
    lista().forEach(function (p) { var x = sel(p); if (x && !s[x]) { s[x] = 1; v.push(x); } });
    return v.sort();
  }
  function filtrados(f) {
    f = f || {};
    var q = (f.q || "").toLowerCase().trim();
    return lista().filter(function (p) {
      if (f.categoria && p.categoria !== f.categoria) return false;
      if (f.clasificacion && p.clasificacion !== f.clasificacion) return false;
      if (f.max >= 0 && p.precio > f.max) return false;
      if (q) {
        var texto = (p.id + " " + p.nombre + " " + p.descripcion + " " + p.categoria + " " + p.clasificacion).toLowerCase();
        if (texto.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  /* ── ofertas ─────────────────────────────────────────────────────────── */
  function enOferta(p) { return !!(p && p.categoria === OFERTA.categoria); }
  function precioEfectivo(p) {
    if (!p) return 0;
    return enOferta(p) ? Math.round(p.precio * (1 - OFERTA.descuento / 100)) : p.precio;
  }
  function finOferta() { var d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); }

  /* ── carrito persistente ─────────────────────────────────────────────── */
  function leerLS(clave, defecto) {
    try { var v = JSON.parse(localStorage.getItem(clave)); return v == null ? defecto : v; }
    catch (e) { return defecto; }
  }
  function escribirLS(clave, valor) {
    try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { /* modo privado */ }
  }
  var carrito = leerLS(LS.carrito, []);
  if (!Array.isArray(carrito)) carrito = [];

  function guardarCarrito() { escribirLS(LS.carrito, carrito); pintaBadge(); }
  function cantidadDe(id) {
    for (var i = 0; i < carrito.length; i++) if (carrito[i].id === id) return carrito[i].cantidad;
    return 0;
  }
  function agregar(id, cant) {
    cant = cant || 1;
    var ya = cantidadDe(id);
    carrito = carrito.filter(function (it) { return it.id !== id; });
    carrito.push({ id: id, cantidad: ya + cant });
    guardarCarrito();
  }
  function setCantidad(id, n) {
    carrito = carrito.filter(function (it) { return it.id !== id; });
    if (n > 0) carrito.push({ id: id, cantidad: n });
    guardarCarrito();
  }
  function quitar(id) {
    carrito = carrito.filter(function (it) { return it.id !== id; });
    guardarCarrito();
  }
  function vaciar() { carrito = []; guardarCarrito(); }
  function contarItems() { return carrito.reduce(function (a, c) { return a + c.cantidad; }, 0); }
  function totalCarrito() {
    var t = 0;
    carrito.forEach(function (item) { var p = prod(item.id); if (p) t += precioEfectivo(p) * item.cantidad; });
    return t;
  }
  function pintaBadge() {
    var n = contarItems();
    $$(".js-badge-carrito").forEach(function (b) {
      b.textContent = n;
      b.hidden = n === 0;
    });
  }

  /* ── construcción de tarjetas y filas ────────────────────────────────── */
  function cuboHtml(tinte) {
    var caras = "";
    for (var i = 0; i < 6; i++) caras += "<i></i>";
    return '<span class="ti-cubo" style="--tinte:' + esc(tinte || "#c8f542") + '" aria-hidden="true">' + caras + "</span>";
  }
  function precioHtml(p, claseBase) {
    if (enOferta(p)) {
      return '<div class="ti-precio ' + (claseBase || "") + '"><s>' + fmtCLP(p.precio) + '</s><b class="en-oferta">' +
        fmtCLP(precioEfectivo(p)) + '</b><span class="ti-ahorra">−' + OFERTA.descuento + "%</span></div>";
    }
    return '<div class="ti-precio ' + (claseBase || "") + '"><b>' + fmtCLP(p.precio) + "</b><small>" + esc(p.moneda || "CLP") + "</small></div>";
  }
  function tarjetaHtml(p) {
    return '<button class="ti-tarjeta" type="button" data-id="' + esc(p.id) + '">' +
      '<span class="ti-tint" style="--tinte:' + esc(p.tinte || "#c8f542") + '">' +
      '<span class="ti-cat">' + esc(p.categoria) + "</span>" +
      (enOferta(p) ? '<span class="ti-badge-oferta">OFERTA −' + OFERTA.descuento + "%</span>" : "") +
      cuboHtml(p.tinte) + "</span>" +
      '<span class="ti-cuerpo">' +
      '<span class="ti-nombre">' + esc(p.nombre) + "</span>" +
      '<span class="ti-badges"><span class="ds-badge ds-badge--accent">' + esc(p.categoria) + '</span><span class="ds-badge">' + esc(p.clasificacion) + "</span></span>" +
      '<span class="ti-desc">' + esc(p.descripcion) + "</span>" +
      precioHtml(p) +
      "</span></button>";
  }
  // Monta una grilla de tarjetas y las enlaza a producto.html?id=
  function montaTarjetas(cont, listaDeProductos) {
    if (!cont) return;
    if (!listaDeProductos.length) {
      cont.innerHTML = '<div class="ds-empty" style="grid-column:1/-1"><span class="ds-empty__icon" aria-hidden="true">' +
        ICONO.buscar + '</span><span class="ds-empty__title">Sin coincidencias</span>' +
        '<span class="ds-empty__text">Prueba con otro texto, categoría o tope de precio.</span></div>';
      return;
    }
    cont.innerHTML = listaDeProductos.map(tarjetaHtml).join("");
    $$(".ti-tarjeta", cont).forEach(function (card) {
      card.addEventListener("click", function () {
        location.href = "producto.html?id=" + encodeURIComponent(card.getAttribute("data-id"));
      });
    });
  }
  function filaProdHtml(item) {
    var p = prod(item.id);
    if (!p) return "";
    var sub = precioEfectivo(p) * item.cantidad;
    return '<div class="ti-fila-prod" data-id="' + esc(p.id) + '">' +
      '<span class="ti-fila-media" style="--tinte:' + esc(p.tinte || "#c8f542") + '">' + cuboHtml(p.tinte) + "</span>" +
      '<span class="ti-fila-info"><a class="ti-nombre" href="producto.html?id=' + esc(p.id) + '" style="color:inherit;text-decoration:none">' + esc(p.nombre) + "</a>" +
      precioHtml(p) + "</span>" +
      '<span class="ti-fila-tools">' +
      '<button class="ti-icono-btn solo-icono" type="button" data-camb="-1" data-id="' + esc(p.id) + '" aria-label="Quitar una unidad de ' + esc(p.nombre) + '">−</button>' +
      '<output aria-label="Cantidad">' + item.cantidad + "</output>" +
      '<button class="ti-icono-btn solo-icono" type="button" data-camb="1" data-id="' + esc(p.id) + '" aria-label="Agregar una unidad de ' + esc(p.nombre) + '">+</button>' +
      '<span class="ti-fila-sub">' + fmtCLP(sub) + "</span>" +
      '<button class="ti-icono-btn solo-icono" type="button" data-quitar="' + esc(p.id) + '" aria-label="Quitar ' + esc(p.nombre) + ' del carrito">' + ICONO.x + "</button>" +
      "</span></div>";
  }
  // Delegación de eventos para +/- y quitar en listas de carrito.
  function bindeaFilas(cont, alCambiar) {
    if (!cont) return;
    cont.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-camb],[data-quitar]");
      if (!b) return;
      if (b.hasAttribute("data-quitar")) { quitar(b.getAttribute("data-quitar")); alCambiar && alCambiar(); return; }
      var id = b.getAttribute("data-id");
      var delta = Number(b.getAttribute("data-camb"));
      setCantidad(id, Math.max(0, cantidadDe(id) + delta));
      alCambiar && alCambiar();
    });
  }

  /* ── reloj analógico en canvas ───────────────────────────────────────── */
  function reloj(canvasSel, fechaSel) {
    var cv = typeof canvasSel === "string" ? $(canvasSel) : canvasSel;
    if (!cv || !cv.getContext) return;
    var ctx = cv.getContext("2d");
    var W = cv.width, H = cv.height, cx = W / 2, cy = H / 2, R = W / 2 - 6;
    function linea(x1, y1, x2, y2, w, color) {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = "round"; ctx.stroke();
    }
    (function dibujar() {
      ctx.clearRect(0, 0, W, H);
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(242,245,240,.14)"; ctx.lineWidth = 2; ctx.stroke();
      for (var i = 0; i < 12; i++) {
        var ang = i / 12 * Math.PI * 2;
        var largo = i % 3 === 0 ? 10 : 6;
        linea(cx + Math.cos(ang) * (R - largo), cy + Math.sin(ang) * (R - largo),
              cx + Math.cos(ang) * (R - 1), cy + Math.sin(ang) * (R - 1),
              i % 3 === 0 ? 2 : 1, i % 3 === 0 ? "#C8F542" : "rgba(242,245,240,.32)");
      }
      var now = new Date();
      var aH = ((now.getHours() % 12) + now.getMinutes() / 60) / 12 * Math.PI * 2;
      var aM = (now.getMinutes() + now.getSeconds() / 60) / 60 * Math.PI * 2;
      var aS = (now.getSeconds() + now.getMilliseconds() / 1000) / 60 * Math.PI * 2;
      linea(cx, cy, cx + Math.cos(aH - 1.57) * (R - 26), cy + Math.sin(aH - 1.57) * (R - 26), 3.5, "#F2F5F0");
      linea(cx, cy, cx + Math.cos(aM - 1.57) * (R - 16), cy + Math.sin(aM - 1.57) * (R - 16), 2.5, "#5AD9E8");
      linea(cx, cy, cx + Math.cos(aS - 1.57) * (R - 9), cy + Math.sin(aS - 1.57) * (R - 9), 1.5, "#C8F542");
      ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fillStyle = "#C8F542"; ctx.fill();
      var f = typeof fechaSel === "string" ? $(fechaSel) : fechaSel;
      if (f) {
        f.textContent = now.toLocaleDateString("es-CL", { weekday: "short", day: "2-digit", month: "short" }) +
          " · " + pad(now.getHours()) + ":" + pad(now.getMinutes());
      }
      requestAnimationFrame(dibujar);
    })();
  }

  /* ── gauge d3 (anillo de progreso) ───────────────────────────────────── */
  function gauge(svgSel, frac, color) {
    var svg = typeof svgSel === "string" ? $(svgSel) : svgSel;
    if (!svg || !window.d3s) return;
    var D3 = window.d3s;
    var angulo = Math.max(0, Math.min(1, frac)) * Math.PI * 2;
    var ns = "http://www.w3.org/2000/svg";
    // d3.arc() dibuja centrado en (0,0): el grupo hay que trasladarlo al centro
    // del viewBox, si no solo se ve el cuadrante que cae dentro del viewport.
    var vb = (svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
    var cx = (vb.length === 4 && vb[2] ? vb[0] + vb[2] : svg.width.baseVal.value) / 2;
    var cy = (vb.length === 4 && vb[3] ? vb[1] + vb[3] : svg.height.baseVal.value) / 2;
    var arco = D3.arc().innerRadius(50).outerRadius(64).startAngle(0).cornerRadius(4);
    var g = svg.querySelector("[data-g]") || (function () {
      var n = document.createElementNS(ns, "g"); n.setAttribute("data-g", "1"); svg.appendChild(n); return n;
    })();
    g.setAttribute("transform", "translate(" + cx + "," + cy + ")");
    g.innerHTML = "";
    var bg = document.createElementNS(ns, "path");
    bg.setAttribute("d", arco({ endAngle: Math.PI * 2 }));
    bg.setAttribute("fill", "rgba(242,245,240,.07)");
    g.appendChild(bg);
    var fg = document.createElementNS(ns, "path");
    fg.setAttribute("d", arco({ endAngle: angulo }));
    fg.setAttribute("fill", color || "#FFB020");
    g.appendChild(fg);
  }

  /* ── temporizador de oferta ──────────────────────────────────────────── */
  // refs: {d,h,m,s} selectores; opts: {gauge, pct, alTerminar}
  function temporizador(refs, opts) {
    refs = refs || {}; opts = opts || {};
    var fin = opts.hasta || finOferta();
    function pintar() {
      var resto = fin - Date.now();
      var d = 0, h = 0, m = 0, s = 0;
      if (resto > 0) {
        d = Math.floor(resto / 864e5);
        h = Math.floor(resto % 864e5 / 36e5);
        m = Math.floor(resto % 36e5 / 6e4);
        s = Math.floor(resto % 6e4 / 1e3);
      }
      [[refs.d, d], [refs.h, h], [refs.m, m], [refs.s, s]].forEach(function (par) {
        var el = typeof par[0] === "string" ? $(par[0]) : par[0];
        if (el) el.textContent = pad(par[1]);
      });
      if (opts.gauge) gauge(opts.gauge, resto / 864e5, opts.colorGauge);
      if (resto <= 0 && opts.alTerminar) opts.alTerminar();
    }
    pintar();
    var id = setInterval(pintar, 1000);
    return function () { clearInterval(id); };
  }

  /* ── QR real (ZXing) ─────────────────────────────────────────────────── */
  function qrCanvas(texto, cv, size) {
    size = size || 260;
    if (!window.ZXing || !ZXing.MultiFormatWriter || !ZXing.BarcodeFormat) return false;
    try {
      var writer = new ZXing.MultiFormatWriter();
      // El 5º argumento (hints) DEBE ser null: con undefined el bundle lanza
      // "Cannot read properties of undefined (reading 'get')" dentro de encode.
      var bm = writer.encode(texto, ZXing.BarcodeFormat.QR_CODE, size, size, null);
      var w = bm.getWidth(), h = bm.getHeight();
      cv.width = w; cv.height = h;
      var ctx = cv.getContext("2d");
      var img = ctx.createImageData(w, h);
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var i = (y * w + x) * 4;
          var v = bm.get(x, y) ? 20 : 255;   // módulo oscuro sobre fondo blanco
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return true;
    } catch (e) { return false; }
  }
  // Texto canónico de un QR de producto.
  function qrProducto(p) { return "FORGE:" + p.id; }

  /* ── pedido y resultado ──────────────────────────────────────────────── */
  function guardaPedido(obj) { escribirLS(LS.pedido, obj); }
  function leePedido() { return leerLS(LS.pedido, null); }
  function guardaResultado(obj) { escribirLS(LS.resultado, obj); }
  function leeResultado() { return leerLS(LS.resultado, null); }

  /* ── iconos (SVG inline; nunca emoji) ────────────────────────────────── */
  function svg(d, extra) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' +
      (extra || "") + ">" + d + "</svg>";
  }
  var ICONO = {
    catalogo: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
    escaner: svg('<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M3.5 12h17"/>'),
    promos: svg('<path d="M20.6 13.4 13 21a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 2.4 12V5a2 2 0 0 1 2-2h7a2 2 0 0 1 1.4.6l7.8 7.8a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.3"/>'),
    carrito: svg('<circle cx="9.5" cy="20" r="1.4"/><circle cx="17.5" cy="20" r="1.4"/><path d="M3 4h2l2.2 10.4a1.6 1.6 0 0 0 1.6 1.3h7.9a1.6 1.6 0 0 0 1.6-1.2L20.5 8H6"/>'),
    checkout: svg('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/><path d="M6.5 14.5h4"/>'),
    recorrido: svg('<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6H14a3.5 3.5 0 0 1 0 7h-4a3.5 3.5 0 0 0 0 7h5.5"/>'),
    buscar: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-3.5-3.5"/>'),
    x: svg('<path d="m6 6 12 12M18 6 6 18"/>'),
    check: svg('<path d="m5 12.5 4.5 4.5L19 7"/>'),
    camara: svg('<path d="M4 8.5h3l1.5-2.2h7L17 8.5h3a1.5 1.5 0 0 1 1.5 1.5v7.5A1.5 1.5 0 0 1 20 19H4a1.5 1.5 0 0 1-1.5-1.5V10A1.5 1.5 0 0 1 4 8.5Z"/><circle cx="12" cy="13.5" r="3.4"/>'),
    whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1-.2.2-.6.8-.8 1-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4 0-.6.2-.8l.5-.6c.1-.2.2-.4.1-.6l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.7 4.3 3.8.6.3 1.1.4 1.4.5.6.2 1.1.2 1.5.1.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.5-.3Z"/></svg>'
  };

  /* ── navegación compartida (topbar + recorrido + bottom nav) ─────────── */
  var SECCIONES = [
    { id: "catalogo", txt: "Catálogo", href: "tienda.html", icono: "catalogo" },
    { id: "escaner", txt: "Escáner", href: "escaner.html", icono: "escaner" },
    { id: "promociones", txt: "Promociones", href: "promociones.html", icono: "promos" },
    { id: "carrito", txt: "Carrito", href: "carrito.html", icono: "carrito" },
    { id: "checkout", txt: "Pago", href: "checkout.html", icono: "checkout" }
  ];

  function montaNav() {
    var cont = $("#fcs-nav");
    if (!cont) return;
    var pg = document.body.getAttribute("data-pg") || "catalogo";
    var idx = SECCIONES.map(function (s) { return s.id; }).indexOf(pg);

    var pasos = SECCIONES.map(function (s, i) {
      var actual = s.id === pg;
      var hecho = idx > -1 && i < idx;
      var sep = i ? '<span class="ti-paso-sep" aria-hidden="true"></span>' : "";
      return sep + '<a class="ti-paso' + (hecho ? " is-hecho" : "") + '" href="' + s.href + '"' +
        (actual ? ' aria-current="page"' : "") + "><b>" + (i + 1) + "</b>" + esc(s.txt) + "</a>";
    }).join("");

    var bottom = SECCIONES.map(function (s, i) {
      if (s.id === "escaner") {
        return '<a class="ds-bottom-nav__item" href="' + s.href + '" data-escaner>' +
          '<span class="ds-bottom-nav__scan" aria-hidden="true">' + ICONO.escaner + "</span>" +
          '<span class="ds-bottom-nav__label">Escanear</span></a>';
      }
      return '<a class="ds-bottom-nav__item" href="' + s.href + '"' + (s.id === pg ? ' aria-current="page"' : "") + ">" +
        '<span class="ds-bottom-nav__icon">' + ICONO[s.icono] + "</span>" +
        '<span class="ds-bottom-nav__label">' + esc(s.txt) + "</span></a>";
    }).join("");

    cont.innerHTML =
      '<header class="ds-topbar ti-topbar">' +
      '<div class="ds-topbar__row">' +
      '<a class="ds-topbar__logo" href="tienda.html" aria-label="FORGE CORE STOCK · ir al catálogo">F</a>' +
      '<span class="ds-topbar__title">FORGE <em>CORE</em> STOCK <span class="ds-muted">· Tienda</span></span>' +
      '<div class="ti-acciones">' +
      '<a class="ti-icono-btn" href="escaner.html"' + (pg === "escaner" ? ' aria-current="page"' : "") + ">" + ICONO.escaner + '<span class="txt">Escanear</span></a>' +
      '<button class="ti-icono-btn" type="button" id="fcsTourBtn">' + ICONO.recorrido + '<span class="txt">Recorrido</span></button>' +
      '<a class="ti-icono-btn" href="carrito.html"' + (pg === "carrito" ? ' aria-current="page"' : "") + ">" + ICONO.carrito +
      '<span class="txt">Carrito</span><b class="badge-num js-badge-carrito" hidden>0</b></a>' +
      "</div></div>" +
      '<nav class="ti-pasos" aria-label="Recorrido de compra">' + pasos + "</nav>" +
      "</header>" +
      '<nav class="ds-bottom-nav ti-bottom" aria-label="Secciones de la tienda">' + bottom + "</nav>" +
      tourHtml();

    pintaBadge();
    var btn = $("#fcsTourBtn");
    if (btn) btn.addEventListener("click", function () { tourAbre(); });
    $$("#fcsTour [data-tour-ir]").forEach(function (b) {
      b.addEventListener("click", function () {
        tourCierra();
        location.href = b.getAttribute("data-tour-ir");
      });
    });
    ["#fcsTourAnt", "#fcsTourSig", "#fcsTourCerrar"].forEach(function (sel) {
      var b = $(sel);
      if (b) b.addEventListener("click", function () {
        if (sel === "#fcsTourCerrar") { tourCierra(true); return; }
        tourPaso(sel === "#fcsTourSig" ? 1 : -1);
      });
    });
    // Primera visita: se ofrece el recorrido una sola vez.
    if (!leerLS(LS.tour, false) && pg === "catalogo") {
      setTimeout(function () { tourAbre(); }, 900);
    }
  }

  /* ── recorrido guiado ────────────────────────────────────────────────── */
  var TOUR = [
    { t: "Catálogo en vivo", p: "Todo el catálogo llega desde la nube (fabri-api) con filtros por texto, categoría y precio. Si te quedas sin red, se usa el catálogo local de respaldo.", href: "tienda.html", ir: "Ver catálogo" },
    { t: "Escanea y agrega", p: "Apunta la cámara al QR de un producto (o de cualquier etiqueta FORGE) y el escáner lo busca en la base de datos y lo agrega al carrito al instante.", href: "escaner.html", ir: "Abrir escáner" },
    { t: "Promociones", p: "Aquí vive la oferta activa con su cuenta regresiva y el ahorro real por producto. El descuento se aplica solo en el carrito y en el pago.", href: "promociones.html", ir: "Ver promociones" },
    { t: "Carrito", p: "Tu pedido se guarda en el dispositivo: puedes cerrar la página y volver. Ajusta cantidades o quita productos antes de pagar.", href: "carrito.html", ir: "Ver carrito" },
    { t: "Pago y confirmación", p: "Elige tarjeta o efectivo, paga (demo, no mueve dinero real) y cierra el pedido por WhatsApp con el mensaje ya armado.", href: "checkout.html", ir: "Ir al pago" }
  ];
  var tourIdx = 0;
  function tourHtml() {
    return '<div class="ti-tour" id="fcsTour" role="dialog" aria-modal="true" aria-label="Recorrido de la tienda">' +
      '<div class="ti-tour-caja">' +
      '<div class="ti-tour-dots" id="fcsTourDots" aria-hidden="true"></div>' +
      '<span class="ti-tour-paso" id="fcsTourPaso">Paso 1 de ' + TOUR.length + "</span>" +
      "<h3 id=\"fcsTourTitulo\"></h3>" +
      '<p id="fcsTourTexto"></p>' +
      '<div class="ti-tour-acciones">' +
      '<button class="ds-btn ds-btn--secondary" type="button" id="fcsTourAnt">Anterior</button>' +
      '<button class="ds-btn ds-btn--secondary" type="button" id="fcsTourSig">Siguiente</button>' +
      '<button class="ds-btn" type="button" id="fcsTourIr" data-tour-ir="">Ir</button>' +
      "</div>" +
      '<button class="ds-btn ds-btn--ghost ds-btn--block" type="button" id="fcsTourCerrar" style="margin-top:8px">Cerrar y no volver a mostrar</button>' +
      "</div></div>";
  }
  function tourPinta() {
    var paso = TOUR[tourIdx];
    $("#fcsTourPaso").textContent = "Paso " + (tourIdx + 1) + " de " + TOUR.length;
    $("#fcsTourTitulo").textContent = paso.t;
    $("#fcsTourTexto").textContent = paso.p;
    var ir = $("#fcsTourIr");
    ir.textContent = paso.ir;
    ir.setAttribute("data-tour-ir", paso.href);
    $("#fcsTourDots").innerHTML = TOUR.map(function (_, i) { return '<i class="' + (i === tourIdx ? "on" : "") + '"></i>'; }).join("");
    $("#fcsTourAnt").disabled = tourIdx === 0;
    $("#fcsTourSig").disabled = tourIdx === TOUR.length - 1;
  }
  function tourAbre() {
    var pg = document.body.getAttribute("data-pg") || "catalogo";
    var i = SECCIONES.map(function (s) { return s.id; }).indexOf(pg);
    tourIdx = i > 0 ? Math.min(i, TOUR.length - 1) : 0;
    var caja = $("#fcsTour");
    if (!caja) return;
    tourPinta();
    caja.classList.add("on");
  }
  function tourCierra(marcar) {
    var caja = $("#fcsTour");
    if (caja) caja.classList.remove("on");
    if (marcar) escribirLS(LS.tour, true);
  }
  function tourPaso(delta) {
    tourIdx = Math.max(0, Math.min(TOUR.length - 1, tourIdx + delta));
    tourPinta();
  }

  /* ── utilidades de página ────────────────────────────────────────────── */
  function titulo(txt) { document.title = "FORGE CORE STOCK · " + txt; }

  return {
    API: API, WA: WA, OFERTA: OFERTA, SEED: SEED, SECCIONES: SECCIONES, ICONO: ICONO,
    $: $, $$: $$, esc: esc, fmtCLP: fmtCLP, pad: pad, toast: toast, param: param, titulo: titulo,
    cargar: cargar, lista: lista, prod: prod, categorias: categorias, clasificaciones: clasificaciones,
    filtrados: filtrados, enOferta: enOferta, precioEfectivo: precioEfectivo, finOferta: finOferta,
    carrito: function () { return carrito; }, agregar: agregar, setCantidad: setCantidad, quitar: quitar,
    vaciar: vaciar, cantidadDe: cantidadDe, contarItems: contarItems, totalCarrito: totalCarrito,
    guardarCarrito: guardarCarrito, pintaBadge: pintaBadge,
    cuboHtml: cuboHtml, tarjetaHtml: tarjetaHtml, montaTarjetas: montaTarjetas,
    filaProdHtml: filaProdHtml, bindeaFilas: bindeaFilas, precioHtml: precioHtml,
    reloj: reloj, gauge: gauge, temporizador: temporizador,
    qrCanvas: qrCanvas, qrProducto: qrProducto,
    guardaPedido: guardaPedido, leePedido: leePedido, guardaResultado: guardaResultado, leeResultado: leeResultado,
    montaNav: montaNav, tourAbre: tourAbre
  };
})();
