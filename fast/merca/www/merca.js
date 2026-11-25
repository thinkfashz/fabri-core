/* MercaFabrick · componentes de interfaz (merca.js)
   --------------------------------------------------------------------------
   Iconos SVG inline, tarjetas de tienda y producto, estados y toast.
   Sin librerías. Expone window.MercaUI con la misma API de siempre.
   -------------------------------------------------------------------------- */

(function () {
  "use strict";

  /* ── 1. Utilidades ─────────────────────────────────────────────────── */

  function esc(t) {
    return String(t == null ? "" : t)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function clp(n) {
    var v = Math.round(Number(n) || 0);
    return "$" + v.toLocaleString("es-CL");
  }

  function hace(fecha) {
    var d = new Date(fecha);
    if (!Number.isFinite(d.getTime())) return "";
    var diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 10) return "justo ahora";
    if (diff < 60) return "hace " + diff + " seg";
    var min = Math.floor(diff / 60);
    if (min < 60) return "hace " + min + " min";
    var hora = Math.floor(min / 60);
    if (hora < 24) return "hace " + hora + " h";
    return "hace " + Math.floor(hora / 24) + " d";
  }

  /* ── 2. Iconos ─────────────────────────────────────────────────────── */

  var TRAZO =
    'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"';

  var ICONOS = {
    local: '<svg ' + TRAZO + '><path d="M3 9l1.6-5h14.8L21 9"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/></svg>',
    producto: '<svg ' + TRAZO + '><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7l8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
    carrito: '<svg ' + TRAZO + '><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h2.2l2.4 11.2a2 2 0 0 0 2 1.6h8.9a2 2 0 0 0 2-1.6L21.5 7H6"/></svg>',
    cuenta: '<svg ' + TRAZO + '><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></svg>',
    mapa: '<svg ' + TRAZO + '><path d="M9 4 3 6.5v14L9 18l6 2.5 6-2.5v-14L15 6.5 9 4z"/><path d="M9 4v14M15 6.5v14"/></svg>',
    whatsapp: '<svg ' + TRAZO + '><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/><path d="M8.5 9.5c.3 2.2 2 3.9 4.2 4.2"/></svg>',
    cerrar: '<svg ' + TRAZO + '><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    ubicacion: '<svg ' + TRAZO + '><path d="M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>',
    telefono: '<svg ' + TRAZO + '><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
    pago: '<svg ' + TRAZO + '><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/></svg>',
    envio: '<svg ' + TRAZO + '><path d="M14 17V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h1"/><path d="M14 9h4l4 4v3a1 1 0 0 1-1 1h-1"/><circle cx="7.5" cy="18" r="2"/><circle cx="17.5" cy="18" r="2"/></svg>',
    boleta: '<svg ' + TRAZO + '><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>',
    reloj: '<svg ' + TRAZO + '><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    estrella: '<svg ' + TRAZO + '><path d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.8l6.5-.9z"/></svg>',
    mas: '<svg ' + TRAZO + '><path d="M12 5v14M5 12h14"/></svg>',
    menos: '<svg ' + TRAZO + '><path d="M5 12h14"/></svg>',
    buscar: '<svg ' + TRAZO + '><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    chevron: '<svg ' + TRAZO + '><path d="m9 6 6 6-6 6"/></svg>',
    check: '<svg ' + TRAZO + '><path d="M20 6 9 17l-5-5"/></svg>',
    cubo: '<svg ' + TRAZO + '><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7l8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
    lista: '<svg ' + TRAZO + '><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>',
    camara: '<svg ' + TRAZO + '><path d="M14.5 4h-5L8 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  };

  function icono(nombre) { return ICONOS[nombre] || ""; }

  /* ── 3. Tarjetas ───────────────────────────────────────────────────── */

  /**
   * tarjetaTienda(t) — tarjeta de local con logo, rubro, dirección, horario,
   * entrega y catálogo. Todo el texto se escapa; los iconos van como HTML.
   */
  function tarjetaTienda(t) {
    var abierto = t.abierto !== false;
    var chip = abierto
      ? '<span class="mf-chip mf-chip--abierto">Abierto</span>'
      : '<span class="mf-chip mf-chip--cerrado">Cerrado</span>';

    var lugar = [t.direccion || t.comuna || "", t.dist_km != null ? Number(t.dist_km).toFixed(1) + " km" : ""]
      .filter(Boolean).join(" · ");

    var entrega = [];
    if (Array.isArray(t.entrega) && t.entrega.indexOf("delivery") >= 0) {
      entrega.push("Delivery" + (Number(t.envio) > 0 ? " " + clp(t.envio) : " gratis"));
    }
    if (!Array.isArray(t.entrega) || t.entrega.indexOf("retiro") >= 0) entrega.push("Retiro");
    if (Number(t.minimo) > 0) entrega.push("mínimo " + clp(t.minimo));

    var nProd = Array.isArray(t.catalogo) ? t.catalogo.length : 0;

    return (
      '<article class="mf-card mf-card--tienda" role="button" tabindex="0" aria-label="' +
      esc(t.nombre) + ", " + esc(t.comuna || "") + '" data-tienda="' + esc(t.id || "") + '">' +

      '<div class="mf-card__top">' +
      (t.logo
        ? '<img class="mf-card__logo" src="' + esc(t.logo) + '" alt="" loading="lazy">'
        : '<span class="mf-card__logo mf-card__logo--vacia">' + icono("local") + "</span>") +
      '<div class="mf-card__id">' +
      '<div class="mf-card__nombre">' + esc(t.nombre) + "</div>" +
      (t.rubro ? '<span class="mf-card__rubro">' + esc(t.rubro) + "</span>" : "") +
      "</div>" + chip +
      "</div>" +

      (lugar
        ? '<div class="mf-card__meta"><span class="mf-card__ico">' + icono("ubicacion") +
          "</span><span>" + esc(lugar) + "</span></div>"
        : "") +

      (t.horario
        ? '<div class="mf-card__meta"><span class="mf-card__ico">' + icono("reloj") +
          "</span><span>" + esc(t.horario) + "</span></div>"
        : "") +

      '<div class="mf-card__meta"><span class="mf-card__ico">' + icono("envio") +
      "</span><span>" + esc(entrega.join(" · ")) + "</span></div>" +

      '<div class="mf-card__pie">' +
      "<small>" + (nProd ? nProd + " productos" : "Sin catálogo publicado") + "</small>" +
      '<button class="mf-btn mf-btn--pri mf-btn--sm" type="button" data-tienda="' + esc(t.id || "") + '">' +
      (nProd ? "Ver productos" : "Ver local") +
      "</button></div>" +
      "</article>"
    );
  }

  /**
   * tarjetaProducto(p) — foto, nombre, precio (con oferta tachada), stock y
   * botón circular de agregar. Se deshabilita si está agotado.
   */
  function tarjetaProducto(p) {
    var precio = Number(p.precio_efectivo != null ? p.precio_efectivo : p.precio) || 0;
    var lista = Number(p.precio) || precio;
    var oferta = lista > precio;
    var stock = p.stock === null || p.stock === undefined ? null : Number(p.stock);
    var agotado = stock !== null && stock <= 0;
    var sku = p.sku || p.codigo || "";

    var imagen = p.imagen
      ? '<img class="mf-prod__img" src="' + esc(p.imagen) + '" alt="" loading="lazy">'
      : '<span class="mf-prod__img mf-prod__img--vacia">' + icono("producto") + "</span>";

    return (
      '<article class="mf-prod' + (agotado ? " mf-prod--agotado" : "") + '" data-producto="' + esc(sku) + '">' +
      '<div class="mf-prod__fila">' + imagen +
      '<div class="mf-prod__info">' +
      '<div class="mf-prod__nombre">' + esc(p.nombre) + "</div>" +
      '<div class="mf-prod__precios">' +
      '<span class="mf-prod__precio">' + clp(precio) + "</span>" +
      (oferta ? '<s class="mf-prod__antes">' + clp(lista) + "</s>" : "") +
      (p.destacado ? '<span class="mf-prod__dest" title="Destacado">' + icono("estrella") + "</span>" : "") +
      "</div>" +
      (stock !== null
        ? '<small class="mf-prod__stock">' +
          (agotado ? "Agotado" : stock <= 5 ? "Quedan " + stock : "Stock " + stock) + "</small>"
        : "") +
      "</div></div>" +
      '<button class="mf-add" type="button" data-agregar="' + esc(sku) + '"' +
      (agotado ? " disabled" : "") + ' aria-label="Agregar ' + esc(p.nombre) + '">' +
      icono(agotado ? "cerrar" : "mas") + "</button>" +
      "</article>"
    );
  }

  /* ── 4. Estados ────────────────────────────────────────────────────── */

  function vacio(titulo, texto) {
    return (
      '<div class="mf-vacio" role="status" aria-label="' + esc(titulo) + '">' +
      "<h2>" + esc(titulo) + "</h2>" +
      "<p>" + esc(texto) + "</p>" +
      "</div>"
    );
  }

  function cargando() {
    return '<div class="mf-cargando" role="status" aria-live="polite">Cargando tu barrio…</div>';
  }

  function error(txt) {
    return '<div class="mf-error" role="alert" aria-live="assertive">' + esc(txt) + "</div>";
  }

  /* ── 5. Toast ──────────────────────────────────────────────────────── */

  var _toastT = null;
  function toast(txt) {
    var el = document.getElementById("mfToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "mfToast";
      el.className = "mf-toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    el.textContent = txt;
    el.classList.add("mf-toast--visible");
    if (_toastT) clearTimeout(_toastT);
    _toastT = setTimeout(function () { el.classList.remove("mf-toast--visible"); }, 2400);
  }

  /* ── 6. Navegación ─────────────────────────────────────────────────── */

  function pintarTabs(actual) {
    document.querySelectorAll(".mf-tab").forEach(function (b) {
      var on = b.dataset.tab === actual;
      b.classList.toggle("activo", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function pintarTop(titulo, sub) {
    var txt = document.querySelector(".mf-marca__txt");
    if (!txt) return;
    var b = txt.querySelector("b");
    var s = txt.querySelector("small");
    if (b) b.textContent = titulo || "MercaFabrick";
    if (s) s.textContent = sub || "tu barrio, en stock";
  }

  /* ── 7. Export ─────────────────────────────────────────────────────── */
  window.MercaUI = {
    esc: esc,
    clp: clp,
    hace: hace,
    icono: icono,
    tarjetaTienda: tarjetaTienda,
    tarjetaProducto: tarjetaProducto,
    vacio: vacio,
    cargando: cargando,
    error: error,
    toast: toast,
    pintarTabs: pintarTabs,
    pintarTop: pintarTop,
  };
})();