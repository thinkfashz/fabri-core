/* MercaFabrick · lógica de la app (marketplace de barrio).
   --------------------------------------------------------------------------
   Datos reales: `/api/mercado` (locales, catálogo y pedidos) y `/api/auth`
   (cuenta, en auth.js). La sesión es la MISMA del panel web (`fcore.nube`).

   Flujo: Inicio → Mapa → Catálogo → Carrito → Compra (envío + pago) →
   pedido registrado en la nube (`pedido_crear`) → WhatsApp al local con el
   código → boleta PDF como lista de pedido.

   Reglas que no se rompen:
   · Los precios y el stock los manda la nube; acá no se inventan.
   · El pedido se crea en la nube ANTES de avisar por WhatsApp: así queda
     registrado, descuenta stock y el local lo ve en su panel.
   · Si la red falla, se dice y se ofrece avisar igual (sin registrar).
*/

(function () {
  "use strict";

  var API = "https://fabri-api.vercel.app/api/mercado";
  var WHATS = "https://wa.me/";

  var S = {
    tab: "inicio",
    vista: "app",        // "app" | "compra" | "exito"
    locales: [],
    tienda: null,
    productos: [],
    cargando: false,
    error: "",
    q: "",
    cat: "",
    idem: "",
    ultimo: null,
    enviando: false,
  };

  var $ = function (s) { return document.querySelector(s); };
  var UI = window.MercaUI || {};

  function esc(t) { return UI.esc ? UI.esc(String(t == null ? "" : t)) : String(t == null ? "" : t); }
  function clp(n) { return UI.clp ? UI.clp(n) : "$" + Number(n || 0); }

  /* ── sesión y dispositivo ───────────────────────────────────────────── */
  function sesion() {
    try {
      var d = JSON.parse(localStorage.getItem("fcore.nube") || "null");
      return d && d.token && (!d.exp || Number(d.exp) > Date.now()) ? d : null;
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
  function api(cuerpo) {
    var s = sesion();
    var cab = { "Content-Type": "application/json" };
    if (s && s.token) {
      cab.Authorization = "Bearer " + s.token;
      cab["x-dispositivo"] = dispositivo();
    }
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, 18000);
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

  /* Traduce la respuesta a algo que una persona entienda. Los códigos son los
     que devuelve la API; si no hay código, se usa el estado HTTP. */
  function motivo(r) {
    var d = r.d || {};
    if (r.status === 0 || d.codigo === "SIN_RED") return "Sin conexión. Revisa tu internet.";
    if (r.status === 401) return "Tu sesión venció. Entra otra vez desde Cuenta.";
    if (d.codigo === "CERRADO") return "El local está cerrado justo ahora.";
    if (d.codigo === "SIN_STOCK" || d.codigo === "NO_CATALOGO" || d.codigo === "BAJO_MINIMO" ||
        d.codigo === "PAGO_CORTO" || d.codigo === "SIN_DIRECCION" || d.codigo === "SIN_COMUNA" ||
        d.codigo === "SIN_NOMBRE" || d.codigo === "SIN_TELEFONO") {
      return d.error || "Revisa los datos del pedido.";
    }
    return d.error || ("La nube respondió " + r.status + ".");
  }

  /* ── carrito (siempre de UNA tienda: la nube crea un pedido por local) ─ */
  function carritoLeer() {
    try {
      var c = JSON.parse(localStorage.getItem("mf.carrito") || "null");
      if (c && typeof c === "object" && c.items) return c;
    } catch (e) {}
    return { local_id: "", items: {} };
  }

  function carritoGuardar(c) {
    try { localStorage.setItem("mf.carrito", JSON.stringify(c)); } catch (e) {}
    pintarBadge();
  }

  function carritoLimpiar() { carritoGuardar({ local_id: "", items: {} }); }

  function carritoTotal() {
    var c = carritoLeer(), t = 0, n = 0;
    Object.keys(c.items || {}).forEach(function (k) {
      var it = c.items[k];
      t += (Number(it.precio) || 0) * (Number(it.cantidad) || 0);
      n += Number(it.cantidad) || 0;
    });
    return { total: t, unidades: n, items: c.items || {}, local_id: c.local_id || "" };
  }

  function carritoAgregar(p, tienda) {
    var c = carritoLeer();
    if (c.local_id && c.local_id !== tienda.id && Object.keys(c.items).length) {
      if (!window.confirm("Tu carrito tiene productos de «" + c.items[Object.keys(c.items)[0]].tienda +
        "». Para comprar en «" + tienda.nombre + "» hay que vaciarlo.\n\n¿Continuar?")) return;
      c = { local_id: tienda.id, items: {} };
    }
    c.local_id = tienda.id;
    var k = (p.sku || p.codigo || p.nombre);
    var it = c.items[k] || {
      sku: p.sku || "", nombre: p.nombre, precio: Number(p.precio_efectivo || p.precio) || 0,
      cantidad: 0, tienda: tienda.nombre, stock: p.stock == null ? null : Number(p.stock),
    };
    it.precio = Number(p.precio_efectivo || p.precio) || it.precio;
    var max = it.stock == null ? 999 : it.stock;
    if (it.cantidad + 1 > max) {
      if (UI.toast) UI.toast(it.stock === 0 ? "Está agotado" : "Sólo quedan " + it.stock);
      return;
    }
    it.cantidad += 1;
    c.items[k] = it;
    carritoGuardar(c);
    if (UI.toast) UI.toast("Agregado · " + clp(it.precio));
  }

  function carritoCambiar(k, delta) {
    var c = carritoLeer();
    var it = c.items[k];
    if (!it) return;
    var max = it.stock == null ? 999 : it.stock;
    var n = (Number(it.cantidad) || 0) + delta;
    if (n <= 0) delete c.items[k];
    else if (n > max) { if (UI.toast) UI.toast("Sólo quedan " + it.stock); return; }
    else it.cantidad = n;
    if (!Object.keys(c.items).length) c.local_id = "";
    carritoGuardar(c);
    pintar();
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
    S.cargando = true; S.error = "";
    try { pintar(); } catch (e) { reportar("cargarLocales", e); return; }
    return api({ accion: "locales", con_catalogo: true }).then(function (r) {
      S.cargando = false;
      if (!r.ok) { S.error = motivo(r); pintar(); return; }
      var lista = Array.isArray(r.d.tiendas) ? r.d.tiendas : [];
      /* Un local sin productos no puede venderse: se deja, pero marcado. */
      S.locales = lista.map(function (t) {
        return {
          id: t.id, nombre: t.nombre || "Local", rubro: t.rubro || "",
          logo: t.logo || "", descripcion: t.descripcion || "",
          telefono: t.telefono || "", direccion: t.direccion || "",
          comuna: t.comuna || "", horario: t.horario || "",
          abierto: t.abierto !== false, minimo: Number(t.minimo) || 0,
          envio: Number(t.envio) || 0,
          entrega: Array.isArray(t.entrega) && t.entrega.length ? t.entrega : ["retiro"],
          lat: t.lat, lon: t.lon,
          catalogo: Array.isArray(t.catalogo) ? t.catalogo : [],
          calificacion: t.calificacion || null,
        };
      });
      /* Si la tienda activa se recargó, se refresca su catálogo. */
      if (S.tienda) {
        var viva = S.locales.filter(function (x) { return x.id === S.tienda.id; })[0];
        if (viva) { S.tienda = viva; S.productos = viva.catalogo; }
      }
      pintar();
    });
  }

  function abrirTienda(id) {
    var t = S.locales.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    S.tienda = t;
    S.productos = t.catalogo;
    S.q = ""; S.cat = "";
    ir("catalogo");
  }

  function filtrados() {
    var q = S.q.trim().toLowerCase();
    return S.productos.filter(function (p) {
      var okQ = !q || String(p.nombre || "").toLowerCase().indexOf(q) >= 0 ||
        String(p.sku || "").toLowerCase() === q;
      var okC = !S.cat || String(p.categoria || "") === S.cat;
      return okQ && okC;
    });
  }

  /* ── pedido: se registra en la nube y se avisa por WhatsApp ──────────── */
  function itemsDelCarrito() {
    var c = carritoTotal();
    return Object.keys(c.items).map(function (k) {
      var it = c.items[k];
      return { sku: it.sku || "", nombre: it.nombre, precio: it.precio, cantidad: it.cantidad };
    });
  }

  function mensajePedido(d) {
    var L = [];
    L.push("*Pedido " + (d.codigo || "") + "* · " + (d.tienda || ""));
    L.push("");
    L.push("Cliente: " + d.nombre);
    L.push("Teléfono: " + d.telefono);
    L.push("Entrega: " + (d.entrega === "delivery" ? "Delivery" : "Retiro en tienda"));
    if (d.entrega === "delivery") {
      L.push("Dirección: " + d.direccion + (d.comuna ? ", " + d.comuna : ""));
      if (d.referencia) L.push("Referencia: " + d.referencia);
    }
    L.push("Pago: " + (d.pago === "transferencia" ? "Transferencia" : "Efectivo"));
    if (d.pago === "efectivo" && d.pagoCon) {
      L.push("Paga con: " + clp(d.pagoCon));
      if (d.vuelto) L.push("Vuelto: " + clp(d.vuelto));
    }
    if (d.clave) L.push("Clave de entrega: " + d.clave);
    L.push("");
    L.push("*Productos*");
    d.items.forEach(function (i) {
      L.push("• " + i.cantidad + " × " + i.nombre + " — " + clp(i.precio * i.cantidad));
    });
    L.push("");
    L.push("Subtotal: " + clp(d.subtotal));
    if (d.envio) L.push("Envío: " + clp(d.envio));
    L.push("*Total: " + clp(d.total) + "*");
    if (d.ahorro) L.push("Ahorro en ofertas: " + clp(d.ahorro));
    if (d.nota) L.push("Nota: " + d.nota);
    L.push("");
    L.push("_Pedido registrado en MercaFabrick. Confirmo el envío y el pago por acá._");
    return L.join("\n");
  }

  function telefonoWa(tel) {
    var n = String(tel || "").replace(/[^0-9]/g, "");
    if (!n) return "";
    if (n.indexOf("56") === 0) return n;
    if (n.length === 9) return "56" + n;
    return n;
  }

  function abrirWhatsApp(d) {
    var texto = mensajePedido(d);
    var tel = telefonoWa(d.telefonoLocal);
    var url = WHATS + (tel || "") + "?text=" + encodeURIComponent(texto);
    try { window.location.href = url; } catch (e) {}
    return texto;
  }

  /* ── boleta PDF (generador mínimo, sin librerías) ─────────────────────
     PDF 1.4 de una o más páginas con Helvetica. Se arma byte a byte: sirve
     para imprimir o compartir la lista de pedido desde el teléfono. */
  function pdfTexto(lineas) {
    var limpias = lineas.map(function (t) {
      return String(t == null ? "" : t)
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\x20-\x7E]/g, " ")
        .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    });

    var porPagina = 46, paginas = [];
    for (var i = 0; i < limpias.length; i += porPagina) paginas.push(limpias.slice(i, i + porPagina));
    if (!paginas.length) paginas.push([""]);

    var objetos = [];
    var total = 2 + paginas.length * 2 + 1;   // catálogo, páginas, (page+contents)*n, fuente
    var idsPagina = [];
    var base = 3;
    paginas.forEach(function (_, idx) { idsPagina.push(base + idx * 2); });

    objetos[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objetos[2] = "<< /Type /Pages /Kids [" + idsPagina.map(function (id) { return id + " 0 R"; }).join(" ") +
      "] /Count " + paginas.length + " >>";

    paginas.forEach(function (ls, idx) {
      var idPagina = base + idx * 2;
      var idCont = idPagina + 1;
      var cuerpo = "BT\n/F1 11 Tf\n16 TL\n40 800 Td\n";
      ls.forEach(function (t, j) {
        cuerpo += "(" + t + ") Tj\n";
        if (j < ls.length - 1) cuerpo += "T*\n";
      });
      cuerpo += "ET\n";
      objetos[idPagina] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
        "/Resources << /Font << /F1 " + total + " 0 R >> >> /Contents " + idCont + " 0 R >>";
      objetos[idCont] = "<< /Length " + cuerpo.length + " >>\nstream\n" + cuerpo + "endstream";
    });
    objetos[total] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";

    var salida = "%PDF-1.4\n";
    var offsets = [];
    for (var n = 1; n <= total; n++) {
      offsets[n] = salida.length;
      salida += n + " 0 obj\n" + (objetos[n] || "<< >>") + "\nendobj\n";
    }
    var inicioXref = salida.length;
    salida += "xref\n0 " + (total + 1) + "\n0000000000 65535 f \n";
    for (var m = 1; m <= total; m++) {
      salida += ("0000000000" + offsets[m]).slice(-10) + " 00000 n \n";
    }
    salida += "trailer\n<< /Size " + (total + 1) + " /Root 1 0 R >>\nstartxref\n" + inicioXref + "\n%%EOF\n";
    return salida;
  }

  function lineasBoleta(d) {
    var L = [];
    L.push("MercaFabrick - lista de pedido");
    L.push(d.tienda + (d.comuna ? " - " + d.comuna : ""));
    L.push("Pedido: " + (d.codigo || ""));
    L.push("Fecha: " + new Date().toLocaleString("es-CL"));
    L.push("");
    L.push("Cliente: " + d.nombre);
    L.push("Telefono: " + d.telefono);
    L.push("Entrega: " + (d.entrega === "delivery" ? "Delivery" : "Retiro en tienda"));
    if (d.entrega === "delivery") {
      L.push("Direccion: " + (d.direccion || "") + (d.comuna ? ", " + d.comuna : ""));
      if (d.referencia) L.push("Referencia: " + d.referencia);
    }
    L.push("Pago: " + (d.pago === "transferencia" ? "Transferencia bancaria" : "Efectivo"));
    if (d.clave) L.push("Clave de entrega: " + d.clave);
    L.push("");
    L.push("Detalle");
    L.push("----------------------------------------------");
    d.items.forEach(function (i) {
      L.push(i.cantidad + " x " + i.nombre);
      L.push("      " + clp(i.precio) + " c/u = " + clp(i.precio * i.cantidad));
    });
    L.push("----------------------------------------------");
    L.push("Subtotal: " + clp(d.subtotal));
    if (d.envio) L.push("Envio: " + clp(d.envio));
    L.push("TOTAL: " + clp(d.total));
    if (d.ahorro) L.push("Ahorro en ofertas: " + clp(d.ahorro));
    if (d.nota) { L.push(""); L.push("Nota: " + d.nota); }
    L.push("");
    L.push("Documento de pedido. No es boleta ni factura fiscal.");
    L.push("MercaFabrick - solucionesfabrick.com");
    return L;
  }

  function b64(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes.charCodeAt(i));
    return window.btoa(bin);
  }

  function compartirBoleta(d) {
    var pdf = pdfTexto(lineasBoleta(d));
    var nombre = "pedido-" + (d.codigo || "mercafabrick") + ".pdf";
    /* Con la app Android instalada se guarda en Descargas y se abre el menú
       de compartir (WhatsApp, correo, etc.). En navegador, se descarga. */
    if (window.MercaPuente && window.MercaPuente.compartirPdf) {
      try {
        var r = window.MercaPuente.compartirPdf(nombre, b64(pdf));
        if (UI.toast) UI.toast(r && r.indexOf("ok") === 0 ? "Boleta guardada en Descargas" : "No se pudo guardar la boleta");
        return;
      } catch (e) { reportar("compartirBoleta", e); }
    }
    try {
      var blob = new Blob([pdf], { type: "application/pdf" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = nombre;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      if (UI.toast) UI.toast("Boleta descargada");
    } catch (e2) {
      if (UI.toast) UI.toast("Este equipo no permite generar el PDF");
    }
  }

  /* ── navegación ─────────────────────────────────────────────────────── */
  function ir(tab) {
    S.vista = "app";
    S.tab = tab;
    pintar();
  }

  window.addEventListener("popstate", function () {
    if (S.vista !== "app") { S.vista = "app"; pintar(); }
  });

  function reportar(donde, e) {
    if (window.mfMostrarError) window.mfMostrarError(donde + ": " + (e && e.stack || e));
  }

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
    if (S.vista === "compra") return pintarCompra();
    if (S.vista === "exito") return pintarExito();
    pintarTabs();
    pintarBadge();

    var html = "";
    if (S.error) html += '<p class="mf-error" role="alert">' + esc(S.error) + "</p>";
    if (S.cargando) html += '<div class="mf-cargando" aria-live="polite">Cargando tu barrio…</div>';

    if (S.tab === "inicio") html += vistaInicio();
    else if (S.tab === "mapa") html += vistaMapa();
    else if (S.tab === "catalogo") html += vistaCatalogo();
    else if (S.tab === "carrito") html += vistaCarrito();
    else html += vistaCuenta();

    main.innerHTML = html || (UI.vacio ? UI.vacio("Sin datos", "Todavía no hay nada que mostrar.") : "<p>Sin datos.</p>");
    enganchar();
  }

  /* ── vistas ─────────────────────────────────────────────────────────── */
  function vistaInicio() {
    var abiertas = S.locales.filter(function (l) { return l.abierto; }).length;
    var conCatalogo = S.locales.filter(function (l) { return l.catalogo.length; }).length;
    var html = '<section class="mf-hero">' +
      '<p class="mf-kicker">Tu barrio, en stock</p>' +
      "<h1>Compra en los locales de tu comuna</h1>" +
      "<p>" + S.locales.length + " locales publicados · " + abiertas + " abiertos ahora · " +
      conCatalogo + " con catálogo. Precios en CLP, al día.</p>" +
      "</section>";

    if (!S.locales.length) {
      return html + (UI.vacio ? UI.vacio("Sin locales todavía",
        "Cuando las tiendas publiquen su catálogo van a aparecer acá. Si eres dueño, publícalo desde el panel.") : "");
    }

    html += '<div class="mf-grid">' + S.locales.map(function (t) {
      return UI.tarjetaTienda ? UI.tarjetaTienda(t) : "";
    }).join("") + "</div>";
    return html;
  }

  function vistaMapa() {
    var conUbi = S.locales.filter(function (t) { return t.lat != null && t.lon != null; });
    var html = '<section class="mf-hero"><p class="mf-kicker">Cerca de ti</p><h1>Mapa de locales</h1>' +
      "<p>" + conUbi.length + " locales con coordenadas. Se ordenan por cercanía cuando el teléfono comparte tu ubicación.</p></section>";

    if (!S.locales.length) {
      return html + (UI.vacio ? UI.vacio("Sin locales", "No hay tiendas publicadas todavía.") : "");
    }

    html += '<div class="mf-lista">' + S.locales.map(function (t) {
      var d = (t.dist_km != null) ? " · " + Number(t.dist_km).toFixed(1) + " km" : "";
      return '<button class="mf-item" type="button" data-tienda="' + esc(t.id) + '">' +
        "<span><b>" + esc(t.nombre) + "</b>" +
        "<small>" + esc(t.rubro || "Local") + " · " + esc(t.direccion || t.comuna || "") + d + "</small>" +
        "<small>" + (t.abierto ? "Abierto" : "Cerrado") +
        (t.horario ? " · " + esc(t.horario) : "") + "</small></span>" +
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
    var t = S.tienda;
    var html = '<section class="mf-hero mf-hero--tienda">' +
      (t.logo ? '<img class="mf-hero__logo" src="' + esc(t.logo) + '" alt="">' : "") +
      '<p class="mf-kicker">' + esc(t.rubro || "Catálogo") + "</p>" +
      "<h1>" + esc(t.nombre) + "</h1>" +
      "<p>" + (t.abierto ? "Abierto" : "Cerrado") +
      (t.horario ? " · " + esc(t.horario) : "") +
      (t.direccion ? " · " + esc(t.direccion) : "") + "</p>" +
      "<p>" + t.catalogo.length + " productos" +
      (t.minimo ? " · mínimo " + clp(t.minimo) : "") +
      (t.entrega.indexOf("delivery") >= 0 ? " · delivery " + clp(t.envio) : " · sólo retiro") + "</p>" +
      "</section>";

    if (!S.productos.length) {
      return html + (UI.vacio ? UI.vacio("Sin productos", "Este local todavía no publicó su catálogo.") : "");
    }

    var cats = {};
    S.productos.forEach(function (p) { if (p.categoria) cats[p.categoria] = 1; });
    var chips = Object.keys(cats).slice(0, 8).map(function (c) {
      return '<button class="mf-chip-f" type="button" data-cat="' + esc(c) + '"' +
        (S.cat === c ? ' aria-pressed="true"' : "") + ">" + esc(c) + "</button>";
    }).join("");

    html += '<div class="mf-buscador">' +
      '<input id="mfQ" type="search" inputmode="search" placeholder="Buscar en ' + esc(t.nombre) + '" value="' + esc(S.q) + '" aria-label="Buscar productos">' +
      (chips ? '<div class="mf-chips">' +
        '<button class="mf-chip-f" type="button" data-cat=""' + (S.cat === "" ? ' aria-pressed="true"' : "") + ">Todo</button>" +
        chips + "</div>" : "") +
      "</div>" +
      '<p class="mf-nota" id="mfCuenta" aria-live="polite">' + filtrados().length + " de " + S.productos.length + " productos</p>" +
      '<div class="mf-grid" id="mfLista">' + listaProductos() + "</div>";
    return html;
  }

  function listaProductos() {
    var lista = filtrados();
    if (!lista.length) {
      return '<div style="grid-column:1/-1">' +
        (UI.vacio ? UI.vacio("Sin resultados", "No hay productos que coincidan con la búsqueda.") : "") + "</div>";
    }
    return lista.map(function (p) {
      return UI.tarjetaProducto ? UI.tarjetaProducto(p) : "";
    }).join("");
  }

  function vistaCarrito() {
    var c = carritoTotal();
    var claves = Object.keys(c.items);
    var t = S.tienda && c.local_id === S.tienda.id ? S.tienda :
      S.locales.filter(function (x) { return x.id === c.local_id; })[0] || null;

    var html = '<section class="mf-hero"><p class="mf-kicker">Carrito</p><h1>Tu pedido</h1>' +
      "<p>" + c.unidades + " unidades · " + clp(c.total) +
      (t ? " · " + esc(t.nombre) : "") + "</p></section>";

    if (!claves.length) {
      return html + (UI.vacio ? UI.vacio("Carrito vacío", "Agrega productos desde el catálogo de un local.") : "");
    }

    html += '<div class="mf-lista">' + claves.map(function (k) {
      var it = c.items[k];
      return '<div class="mf-item"><span><b>' + esc(it.nombre) + "</b>" +
        "<small>" + clp(it.precio) + " c/u · " + esc(it.tienda || "") + "</small></span>" +
        '<span class="mf-paso">' +
        '<button class="mf-paso__btn" type="button" data-menos="' + esc(k) + '" aria-label="Quitar uno">−</button>' +
        "<b>" + it.cantidad + "</b>" +
        '<button class="mf-paso__btn" type="button" data-mas="' + esc(k) + '" aria-label="Agregar uno">+</button>' +
        "</span></div>";
    }).join("") + "</div>";

    if (t && t.minimo && c.total < t.minimo) {
      html += '<p class="mf-error" role="status">El mínimo del local es ' + clp(t.minimo) +
        ". Te faltan " + clp(t.minimo - c.total) + ".</p>";
    }

    html += '<div class="mf-acciones">' +
      '<button class="mf-btn mf-btn--pri" id="mfComprar" type="button">Continuar a la compra</button>' +
      '<button class="mf-btn" id="mfVaciar" type="button">Vaciar</button>' +
      "</div>";
    return html;
  }

  function vistaCuenta() {
    var s = sesion();
    if (s) {
      var u = s.usuario || {};
      return '<section class="mf-hero"><p class="mf-kicker">Cuenta</p><h1>' +
        esc(u.nombre || u.email || "Tu cuenta") + "</h1><p>" + esc(u.email || "") +
        " · sesión activa en este dispositivo, la misma del panel.</p></section>" +
        '<div class="mf-lista" id="mfPedidos"><div class="mf-cargando">Buscando tus pedidos…</div></div>' +
        '<div class="mf-acciones"><button class="mf-btn" id="mfSalir" type="button">Cerrar sesión</button></div>';
    }
    return '<section class="mf-hero"><p class="mf-kicker">Cuenta</p><h1>Entra para comprar</h1>' +
      "<p>Puedes mirar los locales sin cuenta. Para confirmar un pedido y verlo después, entra con tu correo.</p></section>" +
      '<div class="mf-acciones"><button class="mf-btn mf-btn--pri" id="mfEntrar" type="button">Entrar o crear cuenta</button></div>';
  }

  function cargarPedidos() {
    var caja = document.getElementById("mfPedidos");
    if (!caja) return;
    api({ accion: "mis_pedidos" }).then(function (r) {
      if (!r.ok) {
        caja.innerHTML = '<p class="mf-nota">No se pudieron traer tus pedidos: ' + esc(motivo(r)) + "</p>";
        return;
      }
      var lista = r.d.pedidos || r.d.items || [];
      if (!lista.length) {
        caja.innerHTML = UI.vacio ? UI.vacio("Sin pedidos", "Cuando compres, tus pedidos aparecen acá.") : "";
        return;
      }
      caja.innerHTML = lista.slice(0, 20).map(function (p) {
        return '<div class="mf-item"><span><b>' + esc(p.codigo || p.id) + "</b>" +
          "<small>" + esc(p.local_nombre || "") + " · " + clp(p.total) + "</small></span>" +
          "<em>" + esc(p.estado || "") + "</em></div>";
      }).join("");
    });
  }

  /* ── compra ─────────────────────────────────────────────────────────── */
  function datosCliente() {
    var s = sesion();
    var u = (s && s.usuario) || {};
    var guardado = {};
    try { guardado = JSON.parse(localStorage.getItem("mf.cliente") || "{}"); } catch (e) {}
    return {
      nombre: guardado.nombre || u.nombre || "",
      telefono: guardado.telefono || u.telefono || "",
      email: u.email || "",
      comuna: guardado.comuna || "",
      direccion: guardado.direccion || "",
    };
  }

  function pintarCompra() {
    var main = document.getElementById("mfMain");
    if (!main) return;
    var c = carritoTotal();
    var t = S.locales.filter(function (x) { return x.id === c.local_id; })[0] || S.tienda;
    if (!Object.keys(c.items).length || !t) { S.vista = "app"; return pintar(); }
    S.tienda = t;
    S.idem = "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

    var cli = datosCliente();
    var entregas = t.entrega && t.entrega.length ? t.entrega : ["retiro"];
    var puedeDelivery = entregas.indexOf("delivery") >= 0;
    var envio = puedeDelivery ? Number(t.envio) || 0 : 0;
    var total = c.total + envio;

    pintarTabs();
    main.innerHTML =
      '<section class="mf-hero"><p class="mf-kicker">Compra</p><h1>Datos de envío y pago</h1>' +
      "<p>" + esc(t.nombre) + (t.direccion ? " · " + esc(t.direccion) : "") +
      (t.horario ? " · " + esc(t.horario) : "") + "</p></section>" +

      '<form id="mfForm" class="mf-card" novalidate>' +
      "<label class=\"mf-campo\"><span>Nombre y apellido</span>" +
      '<input id="mfNombre" type="text" autocomplete="name" value="' + esc(cli.nombre) + '" required></label>' +
      "<label class=\"mf-campo\"><span>Teléfono (WhatsApp)</span>" +
      '<input id="mfTel" type="tel" inputmode="tel" autocomplete="tel" placeholder="+56 9 1234 5678" value="' + esc(cli.telefono) + '" required></label>' +

      "<label class=\"mf-campo\"><span>Entrega</span><select id=\"mfEntrega\">" +
      '<option value="retiro">Retiro en el local</option>' +
      (puedeDelivery ? '<option value="delivery">Delivery' + (envio ? " (+" + clp(envio) + ")" : "") + "</option>" : "") +
      "</select></label>" +

      '<div id="mfDirCaja"' + (puedeDelivery ? "" : ' hidden') + ">" +
      "<label class=\"mf-campo\"><span>Calle y número</span>" +
      '<input id="mfDir" type="text" autocomplete="street-address" value="' + esc(cli.direccion) + '"></label>' +
      "<label class=\"mf-campo\"><span>Comuna</span>" +
      '<input id="mfComuna" type="text" autocomplete="address-level2" value="' + esc(cli.comuna || t.comuna) + '"></label>' +
      "<label class=\"mf-campo\"><span>Referencia (opcional)</span>" +
      '<input id="mfRef" type="text" placeholder="Ej: portón verde, casa 12"></label>' +
      "</div>" +

      "<label class=\"mf-campo\"><span>Pago</span><select id=\"mfPago\">" +
      '<option value="efectivo">Efectivo</option>' +
      '<option value="transferencia">Transferencia bancaria</option>' +
      "</select></label>" +

      '<div id="mfEfectivoCaja">' +
      "<label class=\"mf-campo\"><span>¿Con cuánto pagas? (para el vuelto)</span>" +
      '<input id="mfPagoCon" type="number" inputmode="numeric" min="0" step="100" placeholder="' + Math.ceil(total) + '"></label>' +
      '<p class="mf-nota" id="mfVuelto" aria-live="polite"></p>' +
      "</div>" +

      "<label class=\"mf-campo\"><span>Nota para el local (opcional)</span>" +
      '<input id="mfNota" type="text" maxlength="300" placeholder="Ej: tocar el timbre dos veces"></label>' +

      '<div class="mf-resumen">' +
      '<div><span>Subtotal</span><b>' + clp(c.total) + "</b></div>" +
      (envio ? '<div><span>Envío</span><b>' + clp(envio) + "</b></div>" : "") +
      '<div class="mf-resumen__total"><span>Total</span><b>' + clp(total) + "</b></div>" +
      "</div>" +

      '<p class="mf-error" id="mfFallo" role="alert"></p>' +
      '<div class="mf-acciones">' +
      '<button class="mf-btn mf-btn--pri" id="mfConfirmar" type="submit">Confirmar pedido</button>' +
      '<button class="mf-btn" id="mfVolver" type="button">Volver al carrito</button>' +
      "</div>" +
      '<p class="mf-nota">El pedido queda registrado y se avisa al local por WhatsApp con el código y la clave de entrega.</p>' +
      "</form>";

    engancharCompra(t, c, envio);
  }

  function engancharCompra(t, c, envio) {
    var selEntrega = document.getElementById("mfEntrega");
    var selPago = document.getElementById("mfPago");
    var cajaDir = document.getElementById("mfDirCaja");
    var cajaEf = document.getElementById("mfEfectivoCaja");
    var pagoCon = document.getElementById("mfPagoCon");
    var vuelto = document.getElementById("mfVuelto");

    function totalActual() {
      return c.total + (selEntrega && selEntrega.value === "delivery" ? envio : 0);
    }
    function refrescar() {
      if (cajaDir) cajaDir.hidden = !selEntrega || selEntrega.value !== "delivery";
      if (cajaEf) cajaEf.hidden = !selPago || selPago.value !== "efectivo";
      if (vuelto && pagoCon) {
        var dado = Number(pagoCon.value) || 0;
        var tot = totalActual();
        vuelto.textContent = dado <= 0 ? "" :
          dado < tot ? "Faltan " + clp(tot - dado) : "Vuelto: " + clp(dado - tot);
      }
    }
    if (selEntrega) selEntrega.onchange = refrescar;
    if (selPago) selPago.onchange = refrescar;
    if (pagoCon) pagoCon.oninput = refrescar;
    refrescar();

    var volver = document.getElementById("mfVolver");
    if (volver) volver.onclick = function () { S.vista = "app"; ir("carrito"); };

    var form = document.getElementById("mfForm");
    if (form) form.onsubmit = function (ev) {
      ev.preventDefault();
      confirmarPedido(t, c, envio);
    };
  }

  function confirmarPedido(t, c, envio) {
    if (S.enviando) return;
    var fallo = document.getElementById("mfFallo");
    var btn = document.getElementById("mfConfirmar");

    function dios(msg) { if (fallo) { fallo.textContent = msg; fallo.style.display = "block"; } }

    var nombre = (document.getElementById("mfNombre") || {}).value || "";
    var telefono = (document.getElementById("mfTel") || {}).value || "";
    var entrega = (document.getElementById("mfEntrega") || {}).value || "retiro";
    var direccion = (document.getElementById("mfDir") || {}).value || "";
    var comuna = (document.getElementById("mfComuna") || {}).value || "";
    var referencia = (document.getElementById("mfRef") || {}).value || "";
    var pago = (document.getElementById("mfPago") || {}).value || "efectivo";
    var pagoCon = Number((document.getElementById("mfPagoCon") || {}).value) || 0;
    var nota = (document.getElementById("mfNota") || {}).value || "";

    nombre = nombre.trim(); telefono = telefono.trim();
    direccion = direccion.trim(); comuna = comuna.trim(); referencia = referencia.trim();

    if (nombre.length < 2) return dios("Escribe tu nombre.");
    if (telefono.replace(/\D/g, "").length < 8) return dios("Escribe un teléfono válido (8 dígitos o más).");
    if (entrega === "delivery") {
      if (direccion.length < 5) return dios("Falta la calle y el número para el delivery.");
      if (comuna.length < 2) return dios("Falta la comuna para el delivery.");
    }
    var total = c.total + (entrega === "delivery" ? envio : 0);
    if (pago === "efectivo" && pagoCon && pagoCon < total) return dios("El efectivo no alcanza: faltan " + clp(total - pagoCon) + ".");
    if (t.minimo && c.total < t.minimo) return dios("El mínimo del local es " + clp(t.minimo) + ".");

    try { localStorage.setItem("mf.cliente", JSON.stringify({ nombre: nombre, telefono: telefono, comuna: comuna, direccion: direccion })); } catch (e) {}

    S.enviando = true;
    if (btn) { btn.disabled = true; btn.textContent = "Registrando pedido…"; }
    if (fallo) { fallo.style.display = "none"; }

    api({
      accion: "pedido_crear",
      local_id: t.id,
      cliente: nombre,
      telefono: telefono,
      entrega: entrega,
      direccion: direccion,
      comuna_entrega: comuna,
      referencia_entrega: referencia,
      metodo_pago: pago,
      pago_con: pago === "efectivo" ? pagoCon : 0,
      nota: nota,
      idempotencia: S.idem,
      items: itemsDelCarrito().map(function (i) {
        return { sku: i.sku, nombre: i.nombre, precio: i.precio, cantidad: i.cantidad };
      }),
    }).then(function (r) {
      S.enviando = false;
      if (btn) { btn.disabled = false; btn.textContent = "Confirmar pedido"; }
      if (!r.ok) {
        dios(motivo(r));
        /* Si no hay red, el pedido no quedó registrado: se ofrece avisar
           igual, dejando claro que el local lo verá sólo por WhatsApp. */
        if (r.status === 0 || (r.d && r.d.codigo === "SIN_RED")) {
          if (fallo) {
            fallo.innerHTML = esc(motivo(r)) + ' <button class="mf-btn mf-btn--texto" type="button" id="mfSinRed">Avisar por WhatsApp igual</button>';
            var b = document.getElementById("mfSinRed");
            if (b) b.onclick = function () {
              abrirWhatsApp({
                tienda: t.nombre, telefonoLocal: t.telefono, codigo: "sin registrar",
                nombre: nombre, telefono: telefono, entrega: entrega, direccion: direccion,
                comuna: comuna, referencia: referencia, pago: pago, pagoCon: pagoCon,
                items: itemsDelCarrito(), subtotal: c.total, envio: envio, total: total,
                ahorro: 0, nota: nota,
              });
            };
          }
        }
        return;
      }

      var d = r.d || {};
      var pedido = {
        tienda: t.nombre, comuna: t.comuna, telefonoLocal: t.telefono,
        codigo: d.codigo || "", clave: d.clave_entrega || "", verificacion: d.verificacion || "",
        nombre: nombre, telefono: telefono, entrega: entrega,
        direccion: direccion, comuna: comuna, referencia: referencia,
        pago: pago, pagoCon: pagoCon, vuelto: Number(d.vuelto) || 0,
        nota: nota, items: itemsDelCarrito(),
        subtotal: Number(d.subtotal) || c.total,
        envio: Number(d.envio) || (entrega === "delivery" ? envio : 0),
        total: Number(d.total) || total,
        ahorro: Number(d.ahorro) || 0,
        seguimiento: d.seguimiento || "",
      };
      carritoLimpiar();
      S.ultimo = pedido;
      S.vista = "exito";
      try { history.pushState({ v: "exito" }, ""); } catch (e) {}
      pintarExito();
    });
  }

  function pintarExito() {
    var main = document.getElementById("mfMain");
    if (!main) return;
    var d = S.ultimo;
    if (!d) { S.vista = "app"; return pintar(); }

    main.innerHTML =
      '<section class="mf-hero mf-hero--exito">' +
      '<p class="mf-kicker">Pedido registrado</p>' +
      "<h1>" + esc(d.codigo) + "</h1>" +
      "<p>" + esc(d.tienda) + " · " + clp(d.total) + "</p></section>" +

      '<div class="mf-card">' +
      '<div class="mf-resumen">' +
      (d.clave ? '<div><span>Clave de entrega</span><b style="letter-spacing:.12em">' + esc(d.clave) + "</b></div>" : "") +
      '<div><span>Entrega</span><b>' + (d.entrega === "delivery" ? "Delivery" : "Retiro") + "</b></div>" +
      '<div><span>Pago</span><b>' + (d.pago === "transferencia" ? "Transferencia" : "Efectivo") +
      (d.vuelto ? " · vuelto " + clp(d.vuelto) : "") + "</b></div>" +
      '<div class="mf-resumen__total"><span>Total</span><b>' + clp(d.total) + "</b></div>" +
      "</div>" +
      '<p class="mf-nota">Envía el pedido por WhatsApp: el local confirma el envío y el pago por ese chat. La boleta PDF es la misma lista para imprimir o guardar.</p>' +
      '<div class="mf-acciones">' +
      '<button class="mf-btn mf-btn--pri" id="mfWa" type="button">Enviar por WhatsApp</button>' +
      '<button class="mf-btn" id="mfPdf" type="button">Boleta PDF</button>' +
      '<button class="mf-btn mf-btn--texto" id="mfOtra" type="button">Volver a la tienda</button>' +
      "</div></div>";

    var wa = document.getElementById("mfWa");
    if (wa) wa.onclick = function () { abrirWhatsApp(d); };
    var pdf = document.getElementById("mfPdf");
    if (pdf) pdf.onclick = function () { compartirBoleta(d); };
    var otra = document.getElementById("mfOtra");
    if (otra) otra.onclick = function () { S.vista = "app"; ir("inicio"); };
  }

  /* ── eventos de la app ──────────────────────────────────────────────── */
  function enganchar() {
    document.querySelectorAll("[data-tienda]").forEach(function (b) {
      b.onclick = function () { abrirTienda(b.dataset.tienda); };
    });
    document.querySelectorAll("[data-agregar]").forEach(function (b) {
      b.onclick = function (ev) {
        ev.stopPropagation();
        var sku = b.dataset.agregar;
        var p = S.productos.filter(function (x) { return (x.sku || x.codigo) === sku; })[0];
        if (p && S.tienda) carritoAgregar(p, S.tienda);
      };
    });
    document.querySelectorAll("[data-mas]").forEach(function (b) {
      b.onclick = function () { carritoCambiar(b.dataset.mas, 1); };
    });
    document.querySelectorAll("[data-menos]").forEach(function (b) {
      b.onclick = function () { carritoCambiar(b.dataset.menos, -1); };
    });
    document.querySelectorAll("[data-cat]").forEach(function (b) {
      b.onclick = function () {
        S.cat = b.dataset.cat || "";
        var lista = document.getElementById("mfLista");
        var cuenta = document.getElementById("mfCuenta");
        if (lista) lista.innerHTML = listaProductos();
        if (cuenta) cuenta.textContent = filtrados().length + " de " + S.productos.length + " productos";
        document.querySelectorAll("[data-cat]").forEach(function (x) {
          if ((x.dataset.cat || "") === S.cat) x.setAttribute("aria-pressed", "true");
          else x.removeAttribute("aria-pressed");
        });
        engancharLista();
      };
    });

    var q = document.getElementById("mfQ");
    if (q) {
      q.oninput = function () {
        S.q = q.value;
        var lista = document.getElementById("mfLista");
        var cuenta = document.getElementById("mfCuenta");
        if (lista) lista.innerHTML = listaProductos();
        if (cuenta) cuenta.textContent = filtrados().length + " de " + S.productos.length + " productos";
        engancharLista();
      };
    }

    var comprar = document.getElementById("mfComprar");
    if (comprar) comprar.onclick = function () {
      S.vista = "compra";
      try { history.pushState({ v: "compra" }, ""); } catch (e) {}
      pintarCompra();
    };

    var vaciar = document.getElementById("mfVaciar");
    if (vaciar) vaciar.onclick = function () { carritoLimpiar(); pintar(); };

    var salir = document.getElementById("mfSalir");
    if (salir) salir.onclick = function () {
      if (window.MercaAuth && MercaAuth.salir) MercaAuth.salir();
      else try { localStorage.removeItem("fcore.nube"); } catch (e) {}
      pintar();
    };

    var entrar = document.getElementById("mfEntrar");
    if (entrar) entrar.onclick = function () {
      if (window.MercaAuth && MercaAuth.montar) {
        MercaAuth.montar(document.getElementById("mfAuth"), { alEntrar: function () { pintar(); } });
      }
    };

    if (S.tab === "cuenta" && sesion()) cargarPedidos();
  }

  /* Los productos se repintan sin volver a montar la vista (así el buscador
     no pierde el foco ni el cursor). */
  function engancharLista() {
    document.querySelectorAll("[data-agregar]").forEach(function (b) {
      b.onclick = function (ev) {
        ev.stopPropagation();
        var sku = b.dataset.agregar;
        var p = S.productos.filter(function (x) { return (x.sku || x.codigo) === sku; })[0];
        if (p && S.tienda) carritoAgregar(p, S.tienda);
      };
    });
  }

  /* ── arranque ───────────────────────────────────────────────────────── */
  function arrancarInterfaz() {
    if (window.MercaAuth && MercaAuth.montar) {
      MercaAuth.montar(document.getElementById("mfAuth"), {
        alEntrar: function () {
          try { pintar(); cargarLocales(); } catch (e) { reportar("alEntrar", e); }
        },
      });
    }
    document.querySelectorAll(".mf-tab").forEach(function (b) {
      b.onclick = function () { ir(b.dataset.tab); };
    });
    var ubi = document.getElementById("mfUbi");
    if (ubi) ubi.onclick = function () {
      if (navigator.geolocation) {
        if (UI.toast) UI.toast("Buscando tu ubicación…");
        navigator.geolocation.getCurrentPosition(function () {
          cargarLocales();
        }, function () {
          if (UI.toast) UI.toast("No pudimos obtener tu ubicación");
        }, { timeout: 8000, maximumAge: 60000 });
      } else if (UI.toast) UI.toast("Sin GPS en este equipo");
    };
    pintar();
    cargarLocales();
  }

  function iniciar() {
    try {
      arrancarInterfaz();
    } catch (e) {
      reportar("iniciar", e);
    }
  }

  window.MercaApp = { iniciar: iniciar, cargar: cargarLocales, ir: ir, estado: S };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
