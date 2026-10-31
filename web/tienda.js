/* ==========================================================================
   TIENDA PÚBLICA · FORGE CORE STOCK
   --------------------------------------------------------------------------
   Catálogo en vivo desde fabri-api /api/catalogo (con seed local como
   respaldo offline). Flujo: catálogo → detalle → carrito → checkout →
   pasarela simulada (tarjeta/efectivo) → estado aprobado/rechazado →
   confirmación por WhatsApp con pedido preconfigurado.
   El pago es de DEMOSTRACIÓN: no mueve dinero real.
   ========================================================================== */

(function () {
  "use strict";

  /* ── configuración ─────────────────────────────────────────────────────── */
  // Cambia por tu número real de WhatsApp: código de país + número, sin "+".
  var WA_NUMERO = "56912345678";
  if (window.FORGE_WA) WA_NUMERO = String(window.FORGE_WA);

  var API = "https://fabri-api.vercel.app/api/catalogo";

  /* ── seed local de respaldo (mismo formato que la API) ─────────────────── */
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

  /* ── estado ────────────────────────────────────────────────────────────── */
  var datos = null;            // {productos, categorias, clasificaciones}
  var origen = "local";
  var carrito = [];            // [{id, cantidad}]
  var vista = "catalogo";
  var detalleId = null;
  var metodo = "tarjeta";
  var pedidoRef = "";
  var pagando = false;

  var filtro = { q: "", categoria: "", max: -1 };

  /* ── helpers ───────────────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtCLP(n) {
    try { return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n); }
    catch (e) { return "$" + Math.round(n).toLocaleString("es-CL"); }
  }
  function toast(msg) {
    var t = $("tiToast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(t._x);
    t._x = setTimeout(function () { t.classList.remove("on"); }, 1800);
  }

  /* ── Tienda 2.0: oferta, reloj canvas, gauge d3 y temporizador ────────── */
  var OFERTA = { categoria: "Equipos", descuento: 20 };

  function pad(n) { return String(n).padStart(2, "0"); }

  // Precio con descuento aplicado si el producto pertenece a la categoría en promo.
  function precioEfectivo(p) {
    return p && p.categoria === OFERTA.categoria
      ? Math.round(p.precio * (1 - OFERTA.descuento / 100))
      : (p ? p.precio : 0);
  }

  function finOferta() {
    var d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }

  /* Reloj analógico en canvas (marca de la tienda). */
  function relojCanvas() {
    var cv = $("tiReloj");
    if (!cv) return;
    var ctx = cv.getContext("2d");
    var W = cv.width, H = cv.height, cx = W / 2, cy = H / 2, R = W / 2 - 6;
    function linea(x1, y1, x2, y2, w, color) {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = "round"; ctx.stroke();
    }
    (function dib() {
      ctx.clearRect(0, 0, W, H);
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.05)";
      ctx.beginPath(); ctx.arc(cx, cy, R - 26, 0, Math.PI * 2); ctx.fill();
      var i, ang;
      for (i = 0; i < 12; i++) {
        ang = i / 12 * Math.PI * 2;
        var largo = i % 3 === 0 ? 10 : 6;
        linea(cx + Math.cos(ang) * (R - largo), cy + Math.sin(ang) * (R - largo),
              cx + Math.cos(ang) * R, cy + Math.sin(ang) * R,
              i % 3 === 0 ? 2 : 1,
              i % 3 === 0 ? "#c8f542" : "rgba(255,255,255,.35)");
      }
      var now = new Date();
      var hora = now.getHours() % 12, min = now.getMinutes(), seg = now.getSeconds() + now.getMilliseconds() / 1000;
      var aH = (hora + min / 60) / 12 * Math.PI * 2;
      var aM = (min + seg / 60) / 60 * Math.PI * 2;
      var aS = seg / 60 * Math.PI * 2;
      linea(cx, cy, cx + Math.cos(aH - 1.57) * (R - 26), cy + Math.sin(aH - 1.57) * (R - 26), 3.5, "#f2f5fd");
      linea(cx, cy, cx + Math.cos(aM - 1.57) * (R - 16), cy + Math.sin(aM - 1.57) * (R - 16), 2.5, "#8c8cff");
      linea(cx, cy, cx + Math.cos(aS - 1.57) * (R - 9), cy + Math.sin(aS - 1.57) * (R - 9), 1.5, "#c8f542");
      ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fillStyle = "#c8f542"; ctx.fill();
      var fecha = $("tiFecha");
      if (fecha) fecha.textContent = now.toLocaleDateString("es-CL", { weekday: "short", day: "2-digit", month: "short" })
        + " · " + pad(now.getHours()) + ":" + pad(now.getMinutes());
      requestAnimationFrame(dib);
    })();
  }

  /* Gauge d3: anillo de progreso de la oferta (fracción del día restante). */
  function dibujarGauge(resto) {
    var svg = $("promoGauge");
    if (!svg || !window.d3s) return;
    var D3 = window.d3s;
    var total = 864e5;
    var frac = Math.max(0, Math.min(1, resto / total));
    var angulo = frac * Math.PI * 2;
    var ns = "http://www.w3.org/2000/svg";
    var arco = D3.arc().innerRadius(50).outerRadius(64).startAngle(0).cornerRadius(4);
    var g = svg.querySelector("[data-g]") || (function () {
      var n = document.createElementNS(ns, "g"); n.setAttribute("data-g", "1"); svg.appendChild(n); return n;
    })();
    g.innerHTML = "";
    var bg = document.createElementNS(ns, "path");
    bg.setAttribute("d", arco({ endAngle: Math.PI * 2 }));
    bg.setAttribute("fill", "rgba(255,255,255,.06)");
    g.appendChild(bg);
    var fg = document.createElementNS(ns, "path");
    fg.setAttribute("d", arco({ endAngle: angulo }));
    fg.setAttribute("fill", "#c8f542");
    fg.style.filter = "drop-shadow(0 0 6px rgba(200,245,66,.6))";
    g.appendChild(fg);
  }

  function temporizador() {
    var fin = finOferta();
    function pintar() {
      var resto = fin - Date.now();
      var d = 0, h = 0, m = 0, s = 0;
      if (resto > 0) {
        d = Math.floor(resto / 864e5);
        h = Math.floor(resto % 864e5 / 36e5);
        m = Math.floor(resto % 36e5 / 6e4);
        s = Math.floor(resto % 6e4 / 1e3);
      }
      [["cdD", d], ["cdH", h], ["cdM", m], ["cdS", s]].forEach(function (par) {
        var el = $(par[0]); if (el) el.textContent = pad(par[1]);
      });
      dibujarGauge(resto);
      if (resto <= 0) {
        var sub = $("tiPromoSub");
        if (sub) sub.textContent = "La oferta terminó. Vuelve pronto por nuevas promociones.";
      }
    }
    pintar();
    setInterval(pintar, 1000);
  }
  function prod(id) {
    var lista = (datos && datos.productos) || [];
    for (var i = 0; i < lista.length; i++) if (lista[i].id === id) return lista[i];
    return null;
  }
  function totalCarrito() {
    var t = 0;
    carrito.forEach(function (item) {
      var p = prod(item.id);
      if (p) t += precioEfectivo(p) * item.cantidad;
    });
    return t;
  }
  function cantidadDe(id) {
    for (var i = 0; i < carrito.length; i++) if (carrito[i].id === id) return carrito[i].cantidad;
    return 0;
  }
  function actualizarBadge() {
    var n = carrito.reduce(function (a, c) { return a + c.cantidad; }, 0);
    var badge = $("tiCarBadge");
    if (!badge) return;
    badge.hidden = n === 0;
    badge.textContent = n;
  }

  /* ── datos ────────────────────────────────────────────────────────────── */
  function cargar() {
    return fetch(API, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) {
        if (d && d.ok && Array.isArray(d.productos)) { datos = d; origen = "nube"; return; }
        throw new Error("forma inválida");
      })
      .catch(function () { datos = { productos: SEED }; origen = "local"; });
  }
  function categorias() {
    var v = [], s = {};
    (datos.productos || []).forEach(function (p) { if (p.categoria && !s[p.categoria]) { s[p.categoria] = 1; v.push(p.categoria); } });
    return v.sort();
  }
  function filtrados() {
    var q = filtro.q.toLowerCase();
    return (datos.productos || []).filter(function (p) {
      if (filtro.categoria && p.categoria !== filtro.categoria) return false;
      if (filtro.max >= 0 && p.precio > filtro.max) return false;
      if (q) {
        var texto = (p.nombre + " " + p.descripcion + " " + p.categoria + " " + p.clasificacion).toLowerCase();
        if (texto.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  /* ── render catálogo ──────────────────────────────────────────────────── */
  function cuboHtml(tinte) {
    var f = "";
    for (var i = 0; i < 6; i++) f += "<i></i>";
    return '<div class="ti-cubo" style="--tinte:' + tinte + '">' + f + "</div>";
  }
  function renderGrid() {
    var grid = $("tiGrid");
    var lista = filtrados();
    if (!lista.length) {
      grid.innerHTML = '<div class="ti-vacio"><b>Sin coincidencias</b><br>Prueba con otro filtro.</div>';
      return;
    }
    grid.innerHTML = lista.map(function (p) {
      var oferta = p.categoria === OFERTA.categoria;
      var badgeCat = '<span class="ti-badge cat">' + esc(p.categoria) + "</span>";
      var badgeClas = '<span class="ti-badge">' + esc(p.clasificacion) + "</span>";
      var badgeOff = oferta ? '<span class="ti-badge oferta">OFERTA −' + OFERTA.descuento + '%</span>' : "";
      var htmlPrecio;
      if (oferta) {
        htmlPrecio = '<div class="ti-precio ti-precio-oferta"><s>' + fmtCLP(p.precio) + '</s><b>' + fmtCLP(precioEfectivo(p)) + '</b><span class="ti-ahorra">−' + OFERTA.descuento + '%</span></div>';
      } else {
        htmlPrecio = '<div class="ti-precio"><b>' + fmtCLP(p.precio) + '</b><small>' + esc(p.moneda || "CLP") + "</small></div>";
      }
      return '<article class="ti-tarjeta" data-id="' + esc(p.id) + '">' +
        '<div class="ti-tint"><span class="ti-cat">' + esc(p.categoria) + "</span>" + cuboHtml(p.tinte || "#c8f542") + "</div>" +
        '<div class="ti-cuerpo">' +
        '<div class="ti-nombre">' + esc(p.nombre) + "</div>" +
        '<div class="ti-badges">' + badgeCat + badgeClas + badgeOff + "</div>" +
        '<p class="ti-desc">' + esc(p.descripcion) + "</p>" +
        htmlPrecio +
        "</div></article>";
    }).join("");
    Array.prototype.forEach.call(grid.querySelectorAll(".ti-tarjeta"), function (card) {
      card.addEventListener("click", function () { abrirDetalle(card.getAttribute("data-id")); });
    });
  }
  function renderChips() {
    var c = $("fiCats");
    c.innerHTML = categorias().map(function (cat) {
      return '<button class="ti-chip' + (filtro.categoria === cat ? " on" : "") + '" data-c="' + esc(cat) + '" type="button">' + esc(cat) + "</button>";
    }).join("");
    Array.prototype.forEach.call(c.querySelectorAll(".ti-chip"), function (chip) {
      chip.addEventListener("click", function () {
        filtro.categoria = chip.getAttribute("data-c") === filtro.categoria ? "" : chip.getAttribute("data-c");
        renderChips();
        renderGrid();
      });
    });
  }

  /* ── navegación de vistas ─────────────────────────────────────────────── */
  function ir(v) {
    vista = v;
    [["v-catalogo", "catalogo"], ["v-detalle", "detalle"], ["v-carrito", "carrito"], ["v-checkout", "checkout"], ["v-estado", "estado"]].forEach(function (par) {
      $(par[0]).hidden = par[1] !== v;
    });
    $("tiBack").hidden = v === "catalogo";
  }

  /* ── detalle ──────────────────────────────────────────────────────────── */
  function abrirDetalle(id) {
    detalleId = id;
    var p = prod(id);
    if (!p) return;
    var caja = $("tiDetalle");
    caja.innerHTML =
      '<div class="ti-detalle-media">' + cuboHtml(p.tinte || "#c8f542") + "</div>" +
      '<div class="ti-detalle-info">' +
      '<p class="ti-eyebrow">' + esc(p.categoria) + " · " + esc(p.clasificacion) + "</p>" +
      "<h1>" + esc(p.nombre) + "</h1>" +
      '<div class="ti-detalle-precio">' + (p.categoria === OFERTA.categoria
        ? '<s style="font-size:18px;color:var(--tx3)">' + fmtCLP(p.precio) + '</s> ' + fmtCLP(precioEfectivo(p)) + ' <span class="ti-ahorra">(−' + OFERTA.descuento + '%)</span>'
        : fmtCLP(p.precio)) + "</div>" +
      '<p class="ti-detalle-desc">' + esc(p.descripcion) + "</p>" +
      '<div class="ti-cant"><button type="button" id="detMenos">−</button><output id="detCant">' + (cantidadDe(id) || 1) + '</output><button type="button" id="detMas">+</button></div>' +
      '<div class="ti-detalle-acciones">' +
      '<button class="ti-btn primario" id="detAgregar" type="button">Agregar al carrito</button>' +
      '<button class="ti-btn lima" id="detComprar" type="button">Comprar ahora</button>' +
      "</div></div>";
    ir("detalle");
    var cant = cantidadDe(id) || 1;
    $("detMenos").addEventListener("click", function () { if (cant > 1) { cant--; $("detCant").value = cant; } });
    $("detMas").addEventListener("click", function () { cant++; $("detCant").value = cant; });
    function sumar(inmediato) {
      var g = prod(id);
      var ya = cantidadDe(id);
      carrito = carrito.filter(function (it) { return it.id !== id; });
      carrito.push({ id: id, cantidad: ya + cant });
      actualizarBadge();
      if (inmediato) { ir("carrito"); renderCarrito(); }
      else toast("Agregado: " + g.nombre);
    }
    $("detAgregar").addEventListener("click", function () { sumar(false); });
    $("detComprar").addEventListener("click", function () { sumar(true); });
  }

  /* ── carrito ──────────────────────────────────────────────────────────── */
  function renderCarrito() {
    var caja = $("tiCarrito");
    var pie = $("tiCarritoPie");
    if (!carrito.length) {
      caja.innerHTML = '<div class="ti-vacio"><b>Tu carrito está vacío</b><br><a href="#" data-ir="catalogo">Ver catálogo</a></div>';
      pie.innerHTML = "";
      return;
    }
    caja.innerHTML = carrito.map(function (item) {
      var p = prod(item.id);
      if (!p) return "";
      return '<div class="ti-bloque" style="flex-direction:row;align-items:center;justify-content:space-between">' +
        '<div><div class="ti-nombre">' + esc(p.nombre) + '</div><div class="ti-precio">' +
        (p.categoria === OFERTA.categoria
          ? '<s style="font-size:12px;color:var(--tx3)">' + fmtCLP(p.precio) + '</s> <b>' + fmtCLP(precioEfectivo(p)) + '</b>'
          : '<b>' + fmtCLP(p.precio) + '</b>') +
        "</div></div>" +
        '<div style="display:flex;align-items:center;gap:10px">' +
        '<button class="ti-cant" data-camb="-1" data-id="' + esc(p.id) + '" type="button" style="width:36px;height:36px">−</button>' +
        '<output>' + item.cantidad + "</output>" +
        '<button class="ti-cant" data-camb="1" data-id="' + esc(p.id) + '" type="button" style="width:36px;height:36px">+</button>' +
        '<button class="ti-pill" data-quitar="' + esc(p.id) + '" type="button">Quitar</button>' +
        "</div></div>";
    }).join("");
    pie.innerHTML =
      '<div class="ti-fila-total"><span>Total</span><span>' + fmtCLP(totalCarrito()) + "</span></div>" +
      '<div style="display:flex;gap:10px;margin-top:14px">' +
      '<button class="ti-btn ghost" id="carSeguir" type="button">Seguir comprando</button>' +
      '<button class="ti-btn primario" id="carCheckout" type="button">Continuar</button>' +
      "</div>";
    Array.prototype.forEach.call(caja.querySelectorAll(".ti-cant"), function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-id");
        var delta = Number(b.getAttribute("data-camb"));
        var item = carrito.filter(function (it) { return it.id === id; })[0];
        if (!item) return;
        item.cantidad += delta;
        if (item.cantidad <= 0) carrito = carrito.filter(function (it) { return it.id !== id; });
        actualizarBadge();
        renderCarrito();
      });
    });
    Array.prototype.forEach.call(caja.querySelectorAll("[data-quitar]"), function (b) {
      b.addEventListener("click", function () {
        carrito = carrito.filter(function (it) { return it.id !== b.getAttribute("data-quitar"); });
        actualizarBadge();
        renderCarrito();
      });
    });
    $("carSeguir").addEventListener("click", function () { ir("catalogo"); });
    $("carCheckout").addEventListener("click", function () { abrirCheckout(); });
  }

  /* ── checkout ──────────────────────────────────────────────────────────── */
  function abrirCheckout() {
    ir("checkout");
    var res = $("coResumen");
    res.innerHTML = carrito.map(function (item) {
      var p = prod(item.id);
      return "<div style=\"display:flex;justify-content:space-between;gap:10px\"><span>" + item.cantidad + "× " + esc(p.nombre) + '</span><span>' + fmtCLP(precioEfectivo(p) * item.cantidad) + "</span></div>";
    }).join("") +
      '<div class="ti-fila-total"><span>Total</span><span>' + fmtCLP(totalCarrito()) + "</span></div>";
    $("coEstado").textContent = "";
    $("coEstado").className = "ti-pasarela";
    $("coPagar").disabled = false;
    $("coPagar").textContent = "Pagar " + fmtCLP(totalCarrito());
  }

  /* ── pasarela simulada ────────────────────────────────────────────────── */
  function luhn(digitos) {
    var suma = 0, doble = false;
    for (var i = digitos.length - 1; i >= 0; i--) {
      var d = Number(digitos[i]);
      if (doble) { d *= 2; if (d > 9) d -= 9; }
      suma += d;
      doble = !doble;
    }
    return suma % 10 === 0;
  }
  function validarTarjeta() {
    var num = ($("coCardNum").value || "").replace(/\s+/g, "");
    var exp = ($("coCardExp").value || "").trim();
    var cvv = ($("coCardCvv").value || "").trim();
    if (!/^\d{13,19}$/.test(num)) return "Número de tarjeta inválido";
    if (!luhn(num)) return "Tarjeta rechazada: número no válido (Luhn)";
    var m = exp.match(/^(\d{2})\/(\d{2})$/);
    if (!m) return "Fecha de expiración inválida (MM/AA)";
    var mes = Number(m[1]), anio = 2000 + Number(m[2]);
    if (mes < 1 || mes > 12) return "Mes de expiración inválido";
    var ahora = new Date();
    var tope = new Date(anio, mes, 1);
    if (tope <= ahora) return "Tarjeta expirada";
    if (!/^\d{3,4}$/.test(cvv)) return "CVV inválido";
    return null;
  }
  function pagar() {
    if (pagando) return;
    var estado = $("coEstado");
    var btn = $("coPagar");
    if (!carrito.length) { ir("catalogo"); return; }
    var nombre = $("coNombre").value.trim();
    var tel = $("coTel").value.trim();
    if (!nombre) { toast("Escribe tu nombre"); $("coNombre").focus(); return; }
    if (!tel) { toast("Escribe tu teléfono"); $("coTel").focus(); return; }
    var error = null;
    if (metodo === "tarjeta") {
      error = validarTarjeta();
      if (error) {
        mostrarRechazado(error);
        return;
      }
    }
    pagando = true;
    btn.disabled = true;
    estado.textContent = "Procesando pago…";
    estado.className = "ti-pasarela";
    setTimeout(function () {
      pagando = false;
      // Demo: la pasarela simula respuesta. Con tarjeta válida o efectivo → aprueba.
      var aprobado = metodo === "efectivo"
        ? true
        : luhn(($("coCardNum").value || "").replace(/\s+/g, ""));
      if (aprobado) mostrarAprobado();
      else {
        mostrarRechazado("La entidad emisora rechazó la tarjeta. Revisa el número o usa otra.");
      }
    }, 1300);
  }

  /* ── estado final ──────────────────────────────────────────────────────── */
  function pedidoTexto() {
    var lineas = [];
    carrito.forEach(function (item) {
      var p = prod(item.id);
      lineas.push(item.cantidad + "× " + p.nombre + " — " + fmtCLP(precioEfectivo(p) * item.cantidad));
    });
    var texto = "Hola! Quiero comprar en FORGE CORE STOCK:\n\n";
    texto += "*Pedido " + pedidoRef + "*\n";
    texto += lineas.join("\n") + "\n";
    texto += "\n*Total:* " + fmtCLP(totalCarrito()) + "\n";
    texto += "*Pago:* " + (metodo === "tarjeta" ? "Tarjeta" : "Efectivo") + "\n";
    var nombre = $("coNombre").value.trim();
    var tel = $("coTel").value.trim();
    if (nombre) texto += "*Nombre:* " + nombre + "\n";
    if (tel) texto += "*Teléfono:* " + tel + "\n";
    texto += "\nConfirmo mi pedido.";
    return texto;
  }
  function linkWhatsApp() {
    return "https://wa.me/" + WA_NUMERO + "?text=" + encodeURIComponent(pedidoTexto());
  }
  function mostrarAprobado() {
    pedidoRef = "FCS-" + Date.now().toString(36).toUpperCase().slice(-6);
    var icono = metodo === "tarjeta" ? "💳" : "💵";
    var caja = $("tiEstado");
    caja.innerHTML =
      '<div class="ti-icono ok">✓</div>' +
      "<h2>¡Pago aprobado!</h2>" +
      '<p class="ti-sub">Tu pedido fue registrado. Compartilo por WhatsApp para confirmarlo con el negocio.</p>' +
      '<a class="ti-wa" href="' + linkWhatsApp() + '" target="_blank" rel="noopener">' +
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1-.2.2-.6.8-.8 1-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4 0-.6.2-.8l.5-.6c.1-.2.2-.4.1-.6l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.7 4.3 3.8.6.3 1.1.4 1.4.5.6.2 1.1.2 1.5.1.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.5-.3Z"/></svg>' +
      "Confirmar mi compra por WhatsApp</a>" +
      '<p class="ti-pedido-ref">Pedido ' + pedidoRef + " · Pago: " + (metodo === "tarjeta" ? "Tarjeta" : "Efectivo") + " · " + icono + "</p>";
    ir("v-estado");
    carrito = [];
    actualizarBadge();
  }
  function mostrarRechazado(motivo) {
    var caja = $("tiEstado");
    caja.innerHTML =
      '<div class="ti-icono err">✕</div>' +
      "<h2>Pago rechazado</h2>" +
      '<p class="ti-sub">' + esc(motivo || "La entidad emisora rechazó el pago.") + "</p>" +
      '<button class="ti-btn primario" id="estReintentar" type="button">Reintentar pago</button>' +
      '<button class="ti-btn ghost" id="estVolver" type="button" style="margin-left:8px">Volver al carrito</button>';
    ir("v-estado");
    $("estReintentar").addEventListener("click", function () { abrirCheckout(); });
    $("estVolver").addEventListener("click", function () { ir("carrito"); renderCarrito(); });
  }

  /* ── eventos globales ──────────────────────────────────────────────────── */
  function bindear() {
    $("tiCarBtn").addEventListener("click", function () {
      if (vista === "carrito") { ir("catalogo"); return; }
      ir("carrito");
      renderCarrito();
    });
    $("tiBack").addEventListener("click", function () {
      if (vista === "detalle") ir("catalogo");
      else if (vista === "carrito") ir("catalogo");
      else if (vista === "checkout") { ir("carrito"); renderCarrito(); }
      else if (vista === "v-estado") ir("catalogo");
      else ir("catalogo");
    });
    document.addEventListener("click", function (ev) {
      var irEl = ev.target.closest("[data-ir]");
      if (irEl) { ev.preventDefault(); ir(irEl.getAttribute("data-ir")); renderGrid(); }
    });

    $("fiQ").addEventListener("input", function () { filtro.q = $("fiQ").value; renderGrid(); });
    var fiMax = $("fiMax"), fiMaxVal = $("fiMaxVal");
    fiMax.addEventListener("input", function () {
      var tope = Number(fiMax.max) || 500000;
      filtro.max = Number(fiMax.value) >= tope ? -1 : Number(fiMax.value);
      fiMaxVal.textContent = fmtCLP(Number(fiMax.value));
      renderGrid();
    });

    // método de pago
    $("coMetodo").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-m]");
      if (!b) return;
      metodo = b.getAttribute("data-m");
      Array.prototype.forEach.call($("coMetodo").querySelectorAll("button"), function (x) { x.classList.toggle("on", x === b); });
      $("coTarjeta").hidden = metodo !== "tarjeta";
      $("coEfectivo").hidden = metodo !== "efectivo";
      $("coEstado").textContent = "";
      $("coEstado").className = "ti-pasarela";
    });

    // formato de tarjeta mientras se escribe
    $("coCardNum").addEventListener("input", function () {
      var dig = ($("coCardNum").value || "").replace(/\D/g, "").slice(0, 16);
      $("coCardNum").value = dig.replace(/(.{4})/g, "$1 ").trim();
    });
    $("coCardExp").addEventListener("input", function () {
      var v = ($("coCardExp").value || "").replace(/\D/g, "").slice(0, 4);
      $("coCardExp").value = v.length > 2 ? v.slice(0, 2) + "/" + v.slice(2) : v;
    });

    $("coPagar").addEventListener("click", pagar);
  }

  /* ── arranque ──────────────────────────────────────────────────────────── */
  cargar().then(function () {
    renderChips();
    renderGrid();
    bindear();
    actualizarBadge();
    relojCanvas();
    temporizador();
    if (document.title) document.title = "FORGE CORE STOCK · Tienda";
  });
})();
