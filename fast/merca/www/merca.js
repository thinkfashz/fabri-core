/* ==========================================================================
   MercaFabrick — helpers de UI (solo presentación, sin lógica de negocio)
   --------------------------------------------------------------------------
   window.MercaUI expone funciones puras que devuelven strings de HTML o
   ejecutan efectos de presentación (toast). La app (merca-app.js) las llama
   con datos reales de la nube; acá no hay API, carrito ni estado de sesión.

   Convenciones:
   - Todo el copy está en español de Chile y habla del dominio (locales,
     productos, pesos chilenos, comunas). Nunca lorem ipsum.
   - Cada función devuelve HTML listo para inyectar; el llamante es quien
     asigna innerHTML tras escapar lo que necesite (UI.esc existe para eso).
   - Los iconos son SVG inline, sin dependencias externas.
   - Comentarios en español: el porqué de cada decisión.
   ========================================================================== */

(function () {
  "use strict";

  /* ── 0. Utilidades base ────────────────────────────────────────────── */

  /**
   * esc(s) — escapa HTML para inyectar texto de usuario de forma segura.
   * Por qué: previene XSS cuando mostramos nombres de locales, productos,
   * direcciones o comentarios que vienen de la nube. Siempre se usa antes
   * de escribir contenido ajeno en el DOM.
   */
  function esc(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * clp(n) — formatea un número como pesos chilenos.
   * Por qué: la app opera en CLP. Usa separador de miles con punto y
   * decimales solo si los hay (precios enteros suelen no llevar centavos).
   * Ejemplo: clp(1990) → "$1.990"; clp(12500) → "$12.500".
   */
  function clp(n) {
    var num = Number(n);
    if (!Number.isFinite(num)) num = 0;
    var entero = Math.floor(num).toString();
    var conMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return "$" + conMiles;
  }

  /**
   * hace(fecha) — tiempo relativo en español (Chile).
   * Por qué: mostrar "abrió hace 2 h" es más escaneable que una fecha ISO.
   * Recibe un string ISO o Date; devuelve "justo ahora", "hace X m/h/d".
   */
  function hace(fecha) {
    if (!fecha) return "";
    var d = new Date(fecha);
    if (!Number.isFinite(d.getTime())) return "";
    var ahora = Date.now();
    var diff = Math.floor((ahora - d.getTime()) / 1000);
    if (diff < 10) return "justo ahora";
    if (diff < 60) return "hace " + diff + " seg";
    var min = Math.floor(diff / 60);
    if (min < 60) return "hace " + min + " min";
    var hora = Math.floor(min / 60);
    if (hora < 24) return "hace " + hora + " h";
    var dia = Math.floor(hora / 24);
    return "hace " + dia + " d";
  }

  /* ── 1. Iconos SVG inline ──────────────────────────────────────────── */

  /**
   * icono(nombre) — devuelve un <svg> inline con el icono pedido.
   * Por qué: no cargamos librerías de iconos (ahorro de bundle y red).
   * Los trazos son simples, un solo trazo y peso consistente, para que
   * se lean a tamaños pequeños en móvil. Nombre desconocido → vacío.
   */
  var TRAZO = 'xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" ' +
    'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"';

  /* Trazos tomados de formas estándar (Lucide). Se escriben a mano para no
     cargar ninguna librería; cada uno es un solo <svg> válido. */
  var ICONOS = {
    local: '<svg ' + TRAZO + '><path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/></svg>',
    producto: '<svg ' + TRAZO + '><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7l8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
    carrito: '<svg ' + TRAZO + '><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2 3h2l2.7 12.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6L22 7H5.1"/></svg>',
    cuenta: '<svg ' + TRAZO + '><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    mapa: '<svg ' + TRAZO + '><path d="M14.1 5.6a2 2 0 0 0 1.8 0l3.6-1.8a1 1 0 0 1 1.5.9v12.7a1 1 0 0 1-.6.9l-4.5 2.3a2 2 0 0 1-1.8 0l-4.2-2.1a2 2 0 0 0-1.8 0l-3.7 1.8a1 1 0 0 1-1.4-.9V6.6a1 1 0 0 1 .6-.9l4.5-2.3a2 2 0 0 1 1.8 0z"/><path d="M15 5.8v15"/><path d="M9 3.2v15"/></svg>',
    whatsapp: '<svg ' + TRAZO + '><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/><path d="M8.5 9.5c.3 2.2 2 3.9 4.2 4.2"/></svg>',
    cerrar: '<svg ' + TRAZO + '><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    ubicacion: '<svg ' + TRAZO + '><path d="M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>',
    telefono: '<svg ' + TRAZO + '><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
    pago: '<svg ' + TRAZO + '><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>',
    envio: '<svg ' + TRAZO + '><path d="M14 17V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h1"/><path d="M14 9h4l4 4v3a1 1 0 0 1-1 1h-1"/><circle cx="7.5" cy="18" r="2"/><circle cx="17.5" cy="18" r="2"/></svg>',
    boleta: '<svg ' + TRAZO + '><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>',
    reloj: '<svg ' + TRAZO + '><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    estrella: '<svg ' + TRAZO + '><path d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.8l6.5-.9z"/></svg>',
  };

  function icono(nombre) {
    return ICONOS[nombre] || "";
  }

  /* ── 2. Plantillas de tarjetas (HTML) ───────────────────────────────── */

  /**
   * tarjetaTienda(t) — HTML de una tarjeta de local para Inicio / Mapa.
   * Espera { id, nombre, comuna, abierto, dist_km?, telefono? }.
   * Por qué: la grilla de tiendas es el núcleo de Inicio; cada tarjeta
   * es un botón que abre el catálogo del local.
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
      '<div class="mf-flex mf-justify-between mf-items-center mf-gap">' +
      '<span class="mf-flex mf-items-center mf-gap">' +
      (t.logo
        ? '<img class="mf-card__logo" src="' + esc(t.logo) + '" alt="" loading="lazy">'
        : '<span class="mf-card__logo mf-card__logo--vacia">' + icono("local") + "</span>") +
      "<span>" +
      '<span class="mf-font-peso">' + esc(t.nombre) + "</span>" +
      (t.rubro ? '<small class="mf-card__rubro">' + esc(t.rubro) + "</small>" : "") +
      "</span></span>" + chip +
      "</div>" +

      (lugar ? '<div class="mf-card__meta">' +
        '<span class="mf-card__ico">' + icono("ubicacion") + "</span>" +
        "<span>" + esc(lugar) + "</span></div>" : "") +

      (t.horario ? '<div class="mf-card__meta">' +
        '<span class="mf-card__ico">' + icono("reloj") + "</span>" +
        "<span>" + esc(t.horario) + "</span></div>" : "") +

      '<div class="mf-card__meta">' + esc(entrega.join(" · ")) + "</div>" +

      '<div class="mf-card__pie">' +
      "<small>" + (nProd ? nProd + " productos" : "Sin catálogo publicado") + "</small>" +
      '<button class="mf-btn mf-btn--texto" type="button" data-tienda="' + esc(t.id || "") + '">' +
      (nProd ? "Ver productos" : "Ver local") + "</button>" +
      "</div></article>"
    );
  }

  /**
   * tarjetaProducto(p) — HTML de una tarjeta de producto para Catálogo.
   * Espera { sku, nombre, precio, tienda? }.
   * Por qué: cada producto es una tarjeta con botón "Agregar" que el
   * llamante engancha con data-agregar=SKU.
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
      '<button class="mf-btn mf-btn--pri" type="button" data-agregar="' + esc(sku) + '"' +
      (agotado ? " disabled" : "") + ">" + (agotado ? "Agotado" : "Agregar") + "</button>" +
      "</article>"
    );
  }

  /* ── 3. Estados vacíos / carga / error ─────────────────────────────── */

  /**
   * vacio(titulo, texto) — HTML de estado vacío honesto.
   * Por qué: nunca inventamos locales ni productos. Si la nube no responde
   * o no hay datos, decimos qué falta y qué puede hacer el usuario.
   */
  function vacio(titulo, texto) {
    return (
      '<div class="mf-vacio" role="status" aria-label="' + esc(titulo) + '">' +
      '<h2 style="font-size:var(--mf-tam-titulo); font-weight:700; color:var(--mf-texto); margin:0;">' +
      esc(titulo) + "</h2>" +
      '<p style="margin:0; max-width:44ch;">' + esc(texto) + "</p>" +
      "</div>"
    );
  }

  /**
   * cargando() — HTML de estado de carga con anuncio para lectores.
   * Por qué: el usuario debe saber que algo está ocurriendo; el aria-live
   * lo anuncia sin quitar el foco.
   */
  function cargando() {
    return (
      '<div class="mf-cargando" role="status" aria-live="polite" aria-label="Cargando">\n' +
      '<div style="font-size:20px; font-weight:700; color:var(--mf-cian); margin:0;">Cargando tu barrio…</div>\n' +
      '<p style="margin:0; font-size:var(--mf-tam-peq); color:var(--mf-texto-suave);">Un momento, estamos trayendo los locales.</p>\n' +
      "</div>"
    );
  }

  /**
   * error(txt) — HTML de estado de error con el motivo real.
   * Por qué: un error sin explicación frustra. Mostramos el motivo y una
   * acción clara (reintentar o entrar de nuevo).
   */
  function error(txt) {
    return (
      '<div class="mf-error" role="alert" aria-live="assertive">' +
      '<div style="font-size:var(--mf-tam-titulo); font-weight:700; color:var(--mf-rojo); margin:0 0 8px 0;">' +
      esc(txt) + "</div>" +
      '<p style="margin:0; font-size:var(--mf-tam-peq); max-width:44ch;">' +
      "Revisa tu conexión e intenta de nuevo." +
      "</p>" +
      "</div>"
    );
  }

  /* ── 4. Toast ──────────────────────────────────────────────────────── */

  /**
   * toast(txt) — muestra un mensaje efímero abajo del centro.
   * Por qué: feedback ligero para acciones como "Agregado al carrito" sin
   * interrumpir el flujo. Se autodesaparece tras 2.5 s.
   */
  var _toastTemporizador = null;
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
    el.textContent = esc(txt);
    el.classList.add("mf-toast--visible");
    if (_toastTemporizador) clearTimeout(_toastTemporizador);
    _toastTemporizador = setTimeout(function () {
      el.classList.remove("mf-toast--visible");
    }, 2500);
  }

  /* ── 5. Navegación ─────────────────────────────────────────────────── */

  /**
   * pintarTabs(actual) — marca la pestaña activa y actualiza aria-selected.
   * Por qué: el usuario debe saber en qué sección está sin adivinar. El
   * llamante (merca-app.js) ya togglea .activo; esta función refuerza el
   * estado ARIA y el badge del carrito.
   */
  function pintarTabs(actual) {
    document.querySelectorAll(".mf-tab").forEach(function (b) {
      var on = b.dataset.tab === actual;
      b.classList.toggle("activo", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  /**
   * pintarTop(titulo, sub) — actualiza el título y subtítulo de la topbar.
   * Por qué: cada pantalla (Inicio, Catálogo, Compra…) tiene su propio
   * título; esto evita tocar el DOM directamente desde merca-app.js.
   */
  function pintarTop(titulo, sub) {
    var txt = document.querySelector(".mf-marca__txt");
    if (!txt) return;
    var b = txt.querySelector("b");
    var s = txt.querySelector("small");
    if (b) b.textContent = esc(titulo || "MercaFabrick");
    if (s) s.textContent = esc(sub || "tu barrio, en stock");
  }

  /* ── 6. Export ─────────────────────────────────────────────────────── */
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

/* ==========================================================================
   Fin de merca.js
   ========================================================================== */
