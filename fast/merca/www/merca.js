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
  var ICONOS = {
    local: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18V3H3z"/><path d="M7 7h10v10H7z"/></svg>',
    producto: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    carrito: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>',
    cuenta: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    mapa: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="1 3 1 22 8 22 16 3 1 3"/><line x1="8" x1="16" x1="3" x1="21" y1="3" y1="21" y1="21" y1="3"/></svg>',
    whatsapp: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12c0-4.7-3.8-8.5-8.5-8.5-4.7 0-8.5 3.8-8.5 8.5 0 3.3 1.7 6.3 4.3 8.1l-1.5 4.2L8 23l4.2-1.5c1.8 2.6 4.8 5 8.1 5C20.2 23 22 19.2 22 12z"/></svg>',
    cerrar: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" x1="6" y1="6" y1="18"/><line x1="6" x1="18" y1="6" y1="18"/></svg>',
    ubicacion: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0"/><circle cx="12" cy="10" r="3"/></svg>',
    telefono: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.8 19.8 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.8 12.8 0 0 1 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 2 2 0 0 1 2.11.45A12.8 12.8 0 0 1 22.5 14c0 .83-.09 1.67-.27 2.47 2.5.27 4.93.93 6.69 2.23a2 2 0 0 1 .27 1.29"/></svg>',
    pago: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1" y="11" width="22" height="11" rx="2" ry="2"/><line x1="12" x1="12" y1="11" y1="15"/><line x1="12" x1="12" y1="17" y1="22"/></svg>',
    envio: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h6v6"/><path d="M8 17H3l5-5 5 5H16"/><path d="M12 17v5"/></svg>',
    boleta: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x1="13" y1="13" y1="13"/><line x1="16" x1="13" y1="17" y1="17"/><line x1="10" x1="13" y1="13" y1="13"/><line x1="10" x1="13" y1="17" y1="17"/></svg>',
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
    var meta = [
      icono("ubicacion") + esc(t.comuna || ""),
      t.dist_km != null ? Number(t.dist_km).toFixed(1) + " km" : ""
    ].filter(Boolean).join(" · ");
    return (
      '<article class="mf-card" role="button" tabindex="0" aria-label="' +
      esc(t.nombre) + ", " + esc(t.comuna || "") + '" data-tienda="' +
      esc(t.id || "") + '">' +
      '<div class="mf-flex mf-justify-between mf-items-center">' +
      '<span class="mf-font-peso">' + esc(t.nombre) + "</span>" + chip +
      "</div>" +
      '<div class="mf-card__meta" aria-hidden="true">' +
      '<span>' + icono("local") + "</span>" +
      esc(meta) +
      "</div>" +
      '<button class="mf-btn mf-btn--texto mf-card__accion" type="button" data-tienda="' +
      esc(t.id || "") + '">Ver productos</button>' +
      "</article>"
    );
  }

  /**
   * tarjetaProducto(p) — HTML de una tarjeta de producto para Catálogo.
   * Espera { sku, nombre, precio, tienda? }.
   * Por qué: cada producto es una tarjeta con botón "Agregar" que el
   * llamante engancha con data-agregar=SKU.
   */
  function tarjetaProducto(p) {
    return (
      '<article class="mf-prod" role="button" tabindex="0" aria-label="' +
      esc(p.nombre) + ", " + clp(p.precio) + '" data-producto="' +
      esc(p.sku || p.codigo || "") + '">' +
      '<div class="mf-font-peso">' + esc(p.nombre) + "</div>" +
      '<div class="mf-flex mf-justify-between mf-items-center">' +
      '<span class="mf-prod__precio">' + clp(p.precio) + "</span>" +
      '<span class="mf-prod__tienda">' + esc(p.tienda || "") + "</span>" +
      "</div>" +
      '<button class="mf-btn mf-btn--pri" type="button" data-agregar="' +
      esc(p.sku || p.codigo || "") + '">Agregar</button>' +
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
