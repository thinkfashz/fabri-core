/* MercaFabrick · lógica de la app (marketplace de barrio).
   --------------------------------------------------------------------------
   Datos reales: `/api/mercado` (locales, catálogo, pedidos) y `/api/auth`
   (cuenta). La sesión es la MISMA del panel web (`fcore.nube`), para que
   entrar en la APK valga en la nube y al revés.

   Flujo: Inicio → Mapa → Catálogo → Carrito → Compra (envío + pago) →
   WhatsApp con el pedido y, si se puede, boleta PDF.

   No inventa stock, precios ni locales: si la nube no responde, se dice. */

(function () {
  "use strict";

  var API = "https://fabri-api.vercel.app/api/mercado";
  var WHATS = "https://wa.me/";
  var S = {
    tab: "inicio",
    locales: [],
    tienda: null,
    productos: [],
    carrito: {},
    cargando: false,
    error: "",
    q: "",
    soloAbiertos: true,
    auth: null,
  };

  var $ = function (s) { return document.querySelector(s); };
  var UI = window.MercaUI || {};

  /* ── sesión ─────────────────────────────────────────────────────────── */
  function sesion() {
    try {
      var d = JSON.parse(localStorage.getItem("fcore.nube") || "null");
      return d && d.token && (!d.exp || d.exp > Date.now()) ? d : null;
    } catch (e) { return null; }
  }
  function dispositivo() {
    try {
      var v = localStorage.getItem("fcore.dispositivo");
      if (v && /^[A-Za-z0-9_-]{16,64}$/.test(v)) return v;
      var b = new Uint8Array(16);
      if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
      else for (var i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
      var id = Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
      localStorage.setItem("fcore.dispositivo", id);
      return id;
    } catch (e) { return "navegador"; }
  }

  /* ── API ────────────────────────────────────────────────────────────── */
  function api(cuerpo, opts) {
    var o = opts || {};
    var s = sesion();
    var cab = { "Content-Type": "application/json" };
    if (s && s.token) {
      cab.Authorization = "Bearer " + s.token;
      cab["x-dispositivo"] = dispositivo();
    }
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);
    return fetch(API, {
      method: "POST",
      headers: cab,
      body: JSON.stringify(cuerpo),
      signal: ctrl ? ctrl.signal : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        return { ok: r.ok && d.ok !== false, status: r.status, d: d || {} };
      });
    }).catch(function (e) {
      return { ok: false, status: 0, d: { codigo: "SIN_RED", error: e.message } };
    }).then(function (r) { clearTimeout(t); return r; });
  }

  function motivo(r) {
    var d = r.d || {};
    if (r.status === 0 || d.codigo === "SIN_RED") return "Sin conexión. Revisa tu internet.";
    if (r.status === 401) return "Tu sesión venció. Entra otra vez desde Cuenta.";
    return d.error || ("La nube respondió " + r.status + ".");
  }

  /* ── carrito ────────────────────────────────────────────────────────── */
  function carritoLeer() {
    try { return JSON.parse(localStorage.getItem("mf.carrito") || "{}"); } catch (e) { return {}; }
  }
  function carritoGuardar(c) {
    try { localStorage.setItem("mf.carrito", JSON.stringify(c || {})); } catch (e) {}
    pintarBadge();
  }
  function carritoTotal() {
    var c = carritoLeer(), t = 0, n = 0;
    Object.keys(c).forEach(function (k) {
      var it = c[k];
      t += (Number(it.precio) || 0) * (Number(it.cantidad) || 0);
      n += Number(it.cantidad) || 0;
    });
    return { total: t, unidades: n };
  }
  function carritoAgregar(p, tienda) {
    var c = carritoLeer();
    var k = (tienda.id || "") + "::" + (p.sku || p.codigo || p.nombre);
    var it = c[k] || { nombre: p.nombre, precio: Number(p.precio) || 0, cantidad: 0, tienda: tienda.nombre, sku: p.sku || "" };
    it.cantidad = (Number(it.cantidad) || 0) + 1;
    c[k] = it;
    carritoGuardar(c);
    if (UI.toast) UI.toast("Agregado al carrito");
  }
  function pintarBadge() {
    var b = document.getElementById("mfBadge");
    if (!b) return;
    var n = carritoTotal().unidades;
    b.textContent = n > 99 ? "99+" : String(n);
    b.hidden = n <= 0;
  }

  /* ── datos ──────────────────────────────────────────────────────────── */
  function cargarLocales() {
    S.cargando = true; S.error = ""; pintar();
    return api({ accion: "locales", con_catalogo: true }).then(function (r) {
      S.cargando = false;
      if (!r.ok) { S.error = motivo(r); pintar(); return; }
      S.locales = Array.isArray(r.d.tiendas) ? r.d.tiendas : [];
      pintar();
    });
  }

  function abrirTienda(id) {
    var t = S.locales.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    S.tienda = t;
    S.productos = Array.isArray(t.catalogo) ? t.catalogo : [];
    ir("catalogo");
  }

  /* ── compra: WhatsApp + boleta ──────────────────────────────────────── */
  function mensajePedido(datos) {
    var lineas = [];
    lineas.push("Nuevo pedido · " + (datos.tienda || ""));
    lineas.push("Cliente: " + (datos.nombre || "—"));
    lineas.push("Teléfono: " + (datos.telefono || "—"));
    lineas.push("Entrega: " + (datos.entrega === "delivery" ? "Delivery" : "Retiro"));
    if (datos.direccion) lineas.push("Dirección: " + datos.direccion + (datos.comuna ? ", " + datos.comuna : ""));
    lineas.push("");
    lineas.push("Productos:");
    datos.items.forEach(function (i) {
      lineas.push("· " + i.cantidad + " × " + i.nombre + " — " + (UI.clp ? UI.clp(i.precio * i.cantidad) : "$" + (i.precio * i.cantidad)));
    });
    lineas.push("");
    lineas.push("Total: " + (UI.clp ? UI.clp(datos.total) : "$" + datos.total));
    lineas.push("Pago: " + (datos.metodo === "transferencia" ? "Transferencia" : "Efectivo"));
    if (datos.nota) lineas.push("Nota: " + datos.nota);
    return lineas.join("\n");
  }

  function enviarWhatsApp(datos) {
    var texto = mensajePedido(datos);
    var tel = String(datos.telefonoLocal || "").replace(/[^0-9]/g, "");
    var url = WHATS + (tel ? "56" + tel.replace(/^56/, "") : "") + "?text=" + encodeURIComponent(texto);
    try { window.location.href = url; } catch (e) {}
    return texto;
  }

  /** Boleta simple en PDF: se arma un HTML y se imprime a PDF con el diálogo
   *  nativo (si existe) o se descarga el HTML. No usa librerías. */
  function boletaPdf(datos) {
    var filas = datos.items.map(function (i) {
      return "<tr><td>" + (UI.esc ? UI.esc(i.nombre) : i.nombre) + "</td><td>" + i.cantidad +
        "</td><td>$" + i.precio + "</td><td>$" + (i.precio * i.cantidad) + "</td></tr>";
    }).join("");
    var html = "<!doctype html><meta charset=utf-8><title>Boleta " + (UI.esc ? UI.esc(datos.codigo) : datos.codigo) + "</title>" +
      "<style>body{font-family:system-ui;padding:24px;color:#111}h1{font-size:18px}table{width:100%;border-collapse:collapse;margin-top:12px}" +
      "td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left;font-size:13px}</style>" +
      "<h1>FORGE CORE STOCK · Boleta</h1><p>" + (UI.esc ? UI.esc(datos.tienda) : datos.tienda) + " · " +
      (UI.esc ? UI.esc(datos.codigo) : datos.codigo) + "</p>" +
      "<p>Cliente: " + (UI.esc ? UI.esc(datos.nombre) : datos.nombre) + " · " + (UI.esc ? UI.esc(datos.telefono) : datos.telefono) + "</p>" +
      "<table><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Total</th></tr></thead><tbody>" + filas +
      "</tbody></table><p style='margin-top:12px'><b>Total: $" + datos.total + "</b></p>" +
      "<p style='font-size:11px;color:#666;margin-top:18px'>Documento no válido para crédito fiscal.</p>";
    var w = window.open("", "_blank");
    if (!w) return false;
    w.document.write(html);
    w.document.close();
    setTimeout(function () { try { w.print(); } catch (e) {} }, 350);
    return true;
  }

  /* ── pintado ────────────────────────────────────────────────────────── */
  function pintarTabs() {
    document.querySelectorAll(".mf-tab").forEach(function (b) {
      var on = b.dataset.tab === S.tab;
      b.classList.toggle("activo", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (UI.pintarTabs) UI.pintarTabs(S.tab);
  }

  function pintar() {
    var main = document.getElementById("mfMain");
    if (!main) return;
    pintarTabs();
    pintarBadge();
    var s = sesion();
    var html = "";

    if (S.error) html += '<p class="mf-error" role="alert">' + (UI.esc ? UI.esc(S.error) : S.error) + "</p>";
    if (S.cargando) html += '<div class="mf-cargando">Cargando…</div>';

    if (S.tab === "inicio") html += vistaInicio(s);
    else if (S.tab === "mapa") html += vistaMapa();
    else if (S.tab === "catalogo") html += vistaCatalogo();
    else if (S.tab === "carrito") html += vistaCarrito();
    else html += vistaCuenta(s);

    main.innerHTML = html || (UI.vacio ? UI.vacio("Sin datos", "Todavía no hay nada que mostrar.") : "<p>Sin datos.</p>");
    enganchar();
  }

  function vistaInicio(s) {
    var abiertas = S.locales.filter(function (l) { return l.abierto !== false; }).length;
    var html = '<section class="mf-hero">' +
      "<p class=\"mf-kicker\">Tu barrio, en stock</p>" +
      "<h1>Compra en los locales de tu comuna</h1>" +
      "<p>" + S.locales.length + " locales · " + abiertas + " abiertos ahora. Precios en CLP.</p>" +
      "</section>";
    if (!S.locales.length) {
      return html + (UI.vacio ? UI.vacio("Sin locales", "Cuando haya tiendas publicadas aparecerán acá.") : "");
    }
    var cerca = S.locales.slice(0, 6);
    html += '<div class="mf-grid">' + cerca.map(function (t) {
      return UI.tarjetaTienda ? UI.tarjetaTienda(t) : "<article class='mf-card'><b>" + t.nombre + "</b></article>";
    }).join("") + "</div>";
    return html;
  }

  function vistaMapa() {
    var html = '<section class="mf-hero"><p class="mf-kicker">Cerca de ti</p><h1>Mapa de locales</h1>' +
      "<p>Lista por cercanía. El mapa se dibuja con los locales que tengan coordenadas.</p></section>";
    if (!S.locales.length) return html + (UI.vacio ? UI.vacio("Sin locales", "No hay tiendas publicadas.") : "");
    html += '<div class="mf-lista">' + S.locales.map(function (t) {
      var d = (t.dist_km != null) ? " · " + Number(t.dist_km).toFixed(1) + " km" : "";
      return '<button class="mf-item" type="button" data-tienda="' + t.id + '">' +
        "<span><b>" + (UI.esc ? UI.esc(t.nombre) : t.nombre) + "</b>" +
        "<small>" + (UI.esc ? UI.esc(t.comuna || "") : (t.comuna || "")) + d + "</small></span>" +
        "<em>Ver</em></button>";
    }).join("") + "</div>";
    return html;
  }

  function vistaCatalogo() {
    if (!S.tienda) {
      return '<section class="mf-hero"><p class="mf-kicker">Catálogo</p><h1>Elige una tienda</h1>' +
        "<p>Toca un local en Inicio o Mapa para ver sus productos.</p></section>" +
        (UI.vacio ? UI.vacio("Sin tienda activa", "Elige un local para ver su catálogo.") : "");
    }
    var html = '<section class="mf-hero"><p class="mf-kicker">Catálogo</p><h1>' +
      (UI.esc ? UI.esc(S.tienda.nombre) : S.tienda.nombre) + "</h1><p>" +
      S.productos.length + " productos · precios del local.</p></section>";
    if (!S.productos.length) return html + (UI.vacio ? UI.vacio("Sin productos", "Este local todavía no publicó su catálogo.") : "");
    html += '<div class="mf-grid">' + S.productos.slice(0, 60).map(function (p) {
      return UI.tarjetaProducto ? UI.tarjetaProducto(p) : "<article class='mf-card'><b>" + p.nombre + "</b></article>";
    }).join("") + "</div>";
    return html;
  }

  function vistaCarrito() {
    var c = carritoLeer();
    var claves = Object.keys(c);
    var t = carritoTotal();
    var html = '<section class="mf-hero"><p class="mf-kicker">Carrito</p><h1>Tu pedido</h1>' +
      "<p>" + t.unidades + " unidades · " + (UI.clp ? UI.clp(t.total) : "$" + t.total) + "</p></section>";
    if (!claves.length) return html + (UI.vacio ? UI.vacio("Carrito vacío", "Agrega productos desde el catálogo.") : "");
    html += '<div class="mf-lista">' + claves.map(function (k) {
      var it = c[k];
      return '<div class="mf-item"><span><b>' + (UI.esc ? UI.esc(it.nombre) : it.nombre) + "</b>" +
        "<small>" + it.cantidad + " × " + (UI.clp ? UI.clp(it.precio) : "$" + it.precio) + " · " +
        (UI.esc ? UI.esc(it.tienda || "") : (it.tienda || "")) + "</small></span>" +
        '<button class="mf-btn" type="button" data-quitar="' + k + '">Quitar</button></div>';
    }).join("") + "</div>" +
    '<div class="mf-acciones"><button class="mf-btn mf-btn--pri" id="mfComprar" type="button">Continuar a la compra</button></div>';
    return html;
  }

  function vistaCuenta(s) {
    if (s) {
      return '<section class="mf-hero"><p class="mf-kicker">Cuenta</p><h1>' +
        (UI.esc ? UI.esc(s.usuario.nombre || s.usuario.email) : (s.usuario.nombre || s.usuario.email)) +
        "</h1><p>Sesión activa en este dispositivo.</p></section>" +
        '<div class="mf-acciones"><button class="mf-btn" id="mfSalir" type="button">Cerrar sesión</button></div>';
    }
    return '<section class="mf-hero"><p class="mf-kicker">Cuenta</p><h1>Entra para comprar</h1>' +
      "<p>Puedes explorar sin cuenta. Para confirmar el pedido, entra.</p></section>";
  }

  function enganchar() {
    document.querySelectorAll("[data-tienda]").forEach(function (b) {
      b.onclick = function () { abrirTienda(b.dataset.tienda); };
    });
    document.querySelectorAll("[data-quitar]").forEach(function (b) {
      b.onclick = function () {
        var c = carritoLeer();
        delete c[b.dataset.quitar];
        carritoGuardar(c);
        pintar();
      };
    });
    var comprar = document.getElementById("mfComprar");
    if (comprar) comprar.onclick = function () { ir("compra"); pintarCompra(); };
    var salir = document.getElementById("mfSalir");
    if (salir) salir.onclick = function () {
      localStorage.removeItem("fcore.nube");
      if (window.MercaAuth && MercaAuth.salir) MercaAuth.salir();
      pintar();
    };
    document.querySelectorAll("[data-agregar]").forEach(function (b) {
      b.onclick = function () {
        var p = S.productos.filter(function (x) { return (x.sku || x.codigo) === b.dataset.agregar; })[0];
        if (p && S.tienda) carritoAgregar(p, S.tienda);
      };
    });
  }

  function pintarCompra() {
    var main = document.getElementById("mfMain");
    if (!main) return;
    var t = carritoTotal();
    var c = carritoLeer();
    var items = Object.keys(c).map(function (k) {
      return { nombre: c[k].nombre, precio: c[k].precio, cantidad: c[k].cantidad };
    });
    main.innerHTML =
      '<section class="mf-hero"><p class="mf-kicker">Compra</p><h1>Datos de envío</h1>' +
      "<p>Se arma el pedido y se manda por WhatsApp al local.</p></section>" +
      '<div class="mf-card">' +
        '<label class="mf-campo"><span>Nombre</span><input id="mfNombre" type="text"></label>' +
        '<label class="mf-campo"><span>Teléfono</span><input id="mfTel" type="tel" inputmode="numeric"></label>' +
        '<label class="mf-campo"><span>Entrega</span><select id="mfEntrega"><option value="retiro">Retiro</option><option value="delivery">Delivery</option></select></label>' +
        '<label class="mf-campo"><span>Dirección (si es delivery)</span><input id="mfDir" type="text"></label>' +
        '<label class="mf-campo"><span>Comuna</span><input id="mfComuna" type="text"></label>' +
        '<label class="mf-campo"><span>Pago</span><select id="mfPago"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option></select></label>' +
        '<p class="mf-total">Total: <b>' + (UI.clp ? UI.clp(t.total) : "$" + t.total) + "</b></p>" +
        '<div class="mf-acciones">' +
          '<button class="mf-btn mf-btn--pri" id="mfWhats" type="button">Enviar por WhatsApp</button>' +
          '<button class="mf-btn" id="mfBoleta" type="button">Boleta PDF</button>' +
        "</div>" +
        '<p class="mf-nota">El pedido se confirma por WhatsApp con el local.</p>' +
      "</div>";
    var b = document.getElementById("mfWhats");
    if (b) b.onclick = function () {
      var datos = {
        codigo: "MP-" + String(Date.now()).slice(-5),
        tienda: S.tienda ? S.tienda.nombre : "",
        telefonoLocal: S.tienda ? S.tienda.telefono : "",
        nombre: (document.getElementById("mfNombre") || {}).value || "",
        telefono: (document.getElementById("mfTel") || {}).value || "",
        entrega: (document.getElementById("mfEntrega") || {}).value || "retiro",
        direccion: (document.getElementById("mfDir") || {}).value || "",
        comuna: (document.getElementById("mfComuna") || {}).value || "",
        metodo: (document.getElementById("mfPago") || {}).value || "efectivo",
        items: items,
        total: t.total,
      };
      if (!datos.nombre || datos.telefono.replace(/\D/g, "").length < 8) {
        if (UI.toast) UI.toast("Falta tu nombre o teléfono");
        return;
      }
      enviarWhatsApp(datos);
      if (UI.toast) UI.toast("Abriendo WhatsApp…");
    };
    var bo = document.getElementById("mfBoleta");
    if (bo) bo.onclick = function () {
      var datos = {
        codigo: "MP-" + String(Date.now()).slice(-5),
        tienda: S.tienda ? S.tienda.nombre : "",
        nombre: (document.getElementById("mfNombre") || {}).value || "Cliente",
        telefono: (document.getElementById("mfTel") || {}).value || "",
        items: items, total: t.total,
      };
      if (!boletaPdf(datos) && UI.toast) UI.toast("Tu navegador no permite abrir el PDF");
    };
    var save = document.getElementById("mfGuardarCliente");
    if (save) save.onclick = function () {};
  }

  /* ── arranque ───────────────────────────────────────────────────────── */
  function ir(tab) {
    if (tab === "compra") return;
    S.tab = tab;
    pintar();
    if (tab === "catalogo" && !S.tienda && S.locales.length) {
      /* Sin tienda elegida, el catálogo lleva a elegir una. */
    }
  }

  function iniciar() {
    if (window.MercaAuth && MercaAuth.montar) {
      MercaAuth.montar(document.getElementById("mfAuth"), {
        alEntrar: function () { pintar(); },
      });
    }
    document.querySelectorAll(".mf-tab").forEach(function (b) {
      b.onclick = function () { ir(b.dataset.tab); };
    });
    var ubi = document.getElementById("mfUbi");
    if (ubi) ubi.onclick = function () {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(function () { cargarLocales(); },
          function () { if (UI.toast) UI.toast("No pudimos obtener tu ubicación"); });
      } else if (UI.toast) UI.toast("Sin GPS en este equipo");
    };
    pintar();
    cargarLocales();
  }

  window.MercaApp = { iniciar: iniciar, cargar: cargarLocales, ir: ir, estado: S };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();