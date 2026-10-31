/* ==========================================================================
   FORGE CORE STOCK · Módulo Catálogo (#v-catalogo)
   --------------------------------------------------------------------------
   Catálogo visual de TODA la base local (núcleo SQLite) con:
     · KPIs reales del panel (total, stock bajo, valor de venta).
     · Chips fijos de categorías con sus conteos.
     · Búsqueda por texto/código con debounce + escáner de código de barras
       propio (BarcodeDetector, reutiliza la cámara del inventario si ya
       está encendida).
     · Sección «Tienda FORGE»: las 8 pantallas web de la tienda unificadas
       en un solo módulo (carpeta catalogo-web/), pestaña por pantalla.
   Todo se sirve del núcleo local: sin red la sección de base funciona
   completa; la luz piloto de conexión informa el estado de la nube.
   Reutiliza: invApiTarde (inventario.js), invClp, ico, esc, INV_CATEGORIAS.
   ========================================================================== */

const CAT = {
  activa: false,
  productos: [],          // página(s) ya bajadas del núcleo
  total: 0,               // total real en la base (lo da `listar`)
  q: "",                  // texto de búsqueda
  cat: "",                // chip de categoría activo
  cargando: false,
  pagina: 0,              // cuántas páginas de 500 se pidieron
  lote: 24,               // tarjetas por «Ver más» (visual, no de red)
  panel: null,
  escaner: { activo: false, stream: null, detector: null, raf: 0, ultimoMs: 0 },
  tienda: { tab: 0, montadas: {} }
};

const CAT_LOTE_NUCLEO = 500;   // tope que acepta la acción `listar` del núcleo
const CAT_TIENDA = [
  { n: "01-home-catalogo",   t: "Catálogo" },
  { n: "02-scanner-busqueda", t: "Escáner" },
  { n: "03-detalle-producto", t: "Detalle" },
  { n: "04-add-to-cart",     t: "Agregar" },
  { n: "05-carrito",         t: "Carrito" },
  { n: "06-checkout-form",   t: "Datos" },
  { n: "07-pasarela-pago",   t: "Pago" },
  { n: "08-pago-exitoso",    t: "Listo" }
];

/* Motivos dibujados a mano por categoría (48×48, trazo). Sin emoji ni
   fuentes externas: todo cabe dentro del APK. */
const CAT_SVG = {
  abarrotes: '<path d="M14 17h20l3 19a3 3 0 0 1-3 3.4H14A3 3 0 0 1 11 36z"/><path d="m14 17 4-6h12l4 6"/><path d="M18 11v6m12-6v6"/><path d="M20 27h8"/>',
  bebidas: '<path d="M20 6h8v7l4 6v21a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4V19l4-6z"/><path d="M16 25h16v10H16z"/><path d="M20 6h8"/>',
  alcohol: '<path d="M15 7h18l-2 9a7 7 0 0 1-14 0Z"/><path d="M24 23v12m-6 6h12"/>',
  dulces: '<rect x="14" y="16" width="20" height="16" rx="6"/><path d="m14 22-6-4v16l6-4m20-8 6-4v16l-6-4"/><path d="M21 21v6"/>',
  lacteos: '<path d="M15 21 22 12h4l7 9v17a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3z"/><path d="M15 21h18"/><path d="m22 12 3 9 3-9"/><path d="M20 28h8v7h-8z"/>',
  congelados: '<path d="M24 8v32M10 16l28 16M38 16 10 32"/><path d="m20 11 4 4 4-4M20 37l4-4 4 4"/>',
  cosmetica: '<rect x="17" y="18" width="14" height="22" rx="4"/><path d="M21 18v-5a3 3 0 0 1 3-3h0a3 3 0 0 1 3 3v5"/><path d="M21 27h6"/>',
  limpieza: '<path d="M19 18h10l2 22a3 3 0 0 1-3 3.4H20A3 3 0 0 1 17 40Z"/><path d="M22 18v-6h6v6"/><path d="M31 9h5l3 4h-8"/><path d="M21 28h6"/>',
  mascotas: '<ellipse cx="24" cy="31" rx="7" ry="6"/><circle cx="14" cy="22" r="3.4"/><circle cx="21" cy="15" r="3.4"/><circle cx="29" cy="15" r="3.4"/><circle cx="36" cy="22" r="3.4"/>',
  otros: '<path d="m12 2 9 4.5v11L12 22l-9-4.5v-11L12 2Z"/><path d="M3.3 6.7 12 11l8.7-4.3M12 11v11"/>'
};

/* Tinte por categoría (fondo translúcido del thumb + color del motivo). */
const CAT_TINTES = {
  abarrotes: "#F5B942", bebidas: "#5AD9E8", alcohol: "#B48CFF", dulces: "#FF7AC8",
  lacteos: "#7FB5FF", congelados: "#9AD8F0", cosmetica: "#D8A1FF",
  limpieza: "#6FE3B2", mascotas: "#FFA85A", otros: "#C8FF00"
};

/** Icono del motivo de una categoría (o la caja genérica). */
function catIcoCat(categoria, tam) {
  const d = CAT_SVG[categoria] || CAT_SVG.otros;
  const t = tam || 38;
  return '<svg viewBox="0 0 48 48" width="' + t + '" height="' + t +
    '" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' + d + "</svg>";
}

/* ── entrada del módulo ────────────────────────────────────────────────────
   Registrada en RAMAS_VISTA.catalogo (app.js). Arranca el piloto de conexión
   la primera vez y carga la primera página del catálogo. */
function catIniciar() {
  CAT.activa = true;
  if (typeof conexionIniciar === "function") conexionIniciar();
  catCargar(false);
}

/** Al salir del módulo se apaga el escáner: nunca queda la cámara viva. */
function catSalir() {
  CAT.activa = false;
  catEscApagar();
}

/* ── datos: panel + páginas del núcleo ─────────────────────────────────── */

/** Carga el panel (KPIs y chips con conteos) en la primera llamada. */
function catPanel() {
  if (CAT.panel) return Promise.resolve(CAT.panel);
  return invApiTarde("panel", {}, { maxMs: 12000 }).then(function (r) {
    if (r.ok && r.data && r.data.ok) {
      CAT.panel = r.data;
      catPintarKpis();
      catPintarChips();
    }
    return CAT.panel;
  });
}

/**
 * Pide una página al núcleo con los filtros actuales (`texto` y `categoria`
 * los aplica el núcleo sobre TODA la base con LIKE, no solo la página).
 * `mas=true` agrega la página siguiente al listado (paginación).
 */
function catCargar(mas) {
  if (CAT.cargando) return;
  CAT.cargando = true;
  const offset = mas ? CAT.productos.length : 0;
  if (!mas) catPintarCargando();

  const args = { limite: CAT_LOTE_NUCLEO, offset: offset };
  if (CAT.q) args.texto = CAT.q;
  if (CAT.cat) args.categoria = CAT.cat;

  Promise.all([
    invApiTarde("listar", args, { maxMs: 12000 }),
    catPanel()
  ]).then(function (par) {
    CAT.cargando = false;
    const r = par[0];
    if (!r.ok || !r.data || !Array.isArray(r.data.productos)) {
      if (!mas) {
        CAT.productos = [];
        catRender();
        catAviso("No pude leer el catálogo: " + (r.error || "error desconocido"));
      }
      return;
    }
    const filas = r.data.productos;
    CAT.total = Number(r.data.total || 0);
    if (mas) CAT.productos = CAT.productos.concat(filas);
    else { CAT.productos = filas; CAT.pagina = 1; }
    if (mas) CAT.pagina++;
    catPintarEstado();
    catRender();
  });
}

/* ── pintado: KPIs, chips, lista ────────────────────────────────────────── */

function catPintarKpis() {
  const caja = document.getElementById("catKpis");
  if (!caja || !CAT.panel) return;
  const r = CAT.panel.resumen || {};
  caja.innerHTML =
    '<div class="cat-kpi"><span class="cat-kpi-etq">Productos</span>' +
      '<b class="cat-kpi-valor">' + Number(r.total || 0).toLocaleString("es-CL") + "</b>" +
      '<span class="cat-kpi-pie">en tu base local</span></div>' +
    '<div class="cat-kpi' + (Number(r.stock_bajo) > 0 ? " alto" : "") + '">' +
      '<span class="cat-kpi-etq">Stock bajo</span>' +
      '<b class="cat-kpi-valor">' + Number(r.stock_bajo || 0).toLocaleString("es-CL") + "</b>" +
      '<span class="cat-kpi-pie">a reponer ya</span></div>' +
    '<div class="cat-kpi acento"><span class="cat-kpi-etq">Valor venta</span>' +
      '<b class="cat-kpi-valor">' + invClp(r.valor_venta || 0) + "</b>" +
      '<span class="cat-kpi-pie">a precio actual</span></div>';
}

/** Chips fijos de categorías con sus conteos reales del panel. */
function catPintarChips() {
  const caja = document.getElementById("catChips");
  if (!caja) return;
  const conteos = {};
  (CAT.panel && CAT.panel.categorias || []).forEach(function (c) {
    conteos[c.categoria] = c.n;
  });
  let html = '<button class="cat-chip' + (CAT.cat === "" ? " activo" : "") +
    '" data-cat="" type="button">Todas<b>' +
    Number(CAT.panel && CAT.panel.resumen ? CAT.panel.resumen.total || 0 : 0).toLocaleString("es-CL") +
    "</b></button>";
  Object.keys(INV_CATEGORIAS).forEach(function (id) {
    const n = conteos[id];
    if (!n) return;   // sólo chips de lo que existe en la base
    html += '<button class="cat-chip' + (CAT.cat === id ? " activo" : "") +
      '" data-cat="' + id + '" type="button">' + INV_CATEGORIAS[id] +
      "<b>" + Number(n).toLocaleString("es-CL") + "</b></button>";
  });
  caja.innerHTML = html;
  caja.querySelectorAll(".cat-chip").forEach(function (b) {
    b.addEventListener("click", function () {
      const id = b.dataset.cat || "";
      if (CAT.cat === id) return;   // ya activo
      CAT.cat = id;
      catPintarChips();
      catCargar(false);
    });
  });
}

function catPintarCargando() {
  const caja = document.getElementById("catLista");
  if (!caja) return;
  caja.innerHTML = '<div class="cat-skeleton"></div><div class="cat-skeleton"></div>' +
    '<div class="cat-skeleton"></div><div class="cat-skeleton"></div>';
}

function catPintarEstado() {
  const caja = document.getElementById("catEstado");
  if (!caja) return;
  const n = CAT.productos.length;
  const d = new Date();
  const hora = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  caja.innerHTML = "<span>" + (n ? "Mostrando <b>" + Number(n).toLocaleString("es-CL") +
    "</b> de <b>" + Number(CAT.total).toLocaleString("es-CL") + "</b> productos" : "Sin resultados") +
    "</span><span>· lectura local " + hora + "</span>";
}

function catAviso(msg) {
  const caja = document.getElementById("catAviso");
  if (!caja) return;
  caja.textContent = msg || "";
}

/** Tarjeta de producto: thumb con tinte de la categoría + precio + stock. */
function catCardHtml(p) {
  const tinte = CAT_TINTES[p.categoria] || CAT_TINTES.otros;
  const stock = Number(p.stock || 0);
  const minimo = Number(p.stock_minimo || 0);
  const clase = stock <= 0 ? " cero" : (stock <= minimo ? " bajo" : "");
  const marca = p.marca ? esc(p.marca) : "";
  const unidad = p.unidad ? " · " + esc(p.unidad) : "";
  return '<article class="cat-card" data-codigo="' + esc(p.codigo || "") + '">' +
    '<span class="cat-stock' + clase + '">' + stock + " und</span>" +
    '<span class="cat-thumb" style="color:' + tinte + ";background:" + tinte + '18">' +
      catIcoCat(p.categoria) + "</span>" +
    '<b class="cat-nombre">' + esc(p.nombre || "(sin nombre)") + "</b>" +
    '<span class="cat-meta">' + (marca || "Sin marca") + unidad + "</span>" +
    '<b class="cat-precio">' + invClp(p.precio || 0) + "</b>" +
    '<span class="cat-codigo">' + esc(p.codigo || "") + "</span>" +
    "</article>";
}

/** Pinta la grilla (lote visual de 24) + paginación y estados. */
function catRender() {
  const caja = document.getElementById("catLista");
  if (!caja) return;
  const lista = CAT.productos;
  if (!lista.length) {
    caja.innerHTML = '<div class="cat-vacio">' + ico("buscar", 30) +
      "<b>Sin productos para esta búsqueda</b>" +
      "<span>Prueba otro texto, toca «Todas» o escanea el código de barras.</span></div>";
    return;
  }
  const n = CAT.lote;
  const mostrados = lista.slice(0, n);
  const restantes = CAT.total - mostrados.length;
  caja.innerHTML = '<div class="cat-lista">' + mostrados.map(catCardHtml).join("") + "</div>" +
    (restantes > 0
      ? '<button class="btn cat-mas" id="catMas" type="button">' + ico("mas", 15) +
        " Ver " + Number(restantes).toLocaleString("es-CL") + " más</button>"
      : "");
  const b = document.getElementById("catMas");
  if (b) b.addEventListener("click", catMas);
}

/** «Ver más»: agranda el lote visual; si se acabó la página, baja otra. */
function catMas() {
  if (CAT.productos.length < CAT.total) {
    // Quedan filas en el núcleo por bajar: otra página de 500.
    catCargar(true);
    return;
  }
  CAT.lote += 24;
  catRender();
}

/* ── buscador ──────────────────────────────────────────────────────────── */

/** Búsqueda con debounce: el texto lo resuelve el núcleo sobre toda la base. */
function catBuscar(texto) {
  CAT.q = String(texto || "").trim();
  clearTimeout(catBuscar._t);
  catBuscar._t = setTimeout(function () { catCargar(false); }, 260);
}

/* ── escáner de código de barras del catálogo ──────────────────────────── */

function catEscBoton() {
  return document.getElementById("btnCatEsc");
}

function catEscVideo() {
  return document.getElementById("catEscVideo");
}

function catEscNota(msg) {
  const n = document.getElementById("catEscNota");
  if (n) n.textContent = msg || "";
}

function catEscToggle() {
  if (CAT.escaner.activo) catEscApagar();
  else catEscEncender();
}

function catEscEncender() {
  const video = catEscVideo();
  const btn = catEscBoton();
  if (!video || !btn) return;

  if (typeof window.BarcodeDetector !== "function") {
    catEscNota("Este Android no trae lector nativo de códigos: escribe el código en el buscador.");
    if (typeof toast === "function") toast("Sin detector nativo de códigos en este dispositivo.", "error");
    return;
  }
  if (!CAT.escaner.detector) {
    CAT.escaner.detector = new window.BarcodeDetector({
      formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"]
    });
  }

  const usarStream = function (stream) {
    CAT.escaner.stream = stream;
    CAT.escaner.activo = true;
    video.srcObject = stream;
    video.hidden = false;
    const caja = document.getElementById("catEscCaja");
    if (caja) caja.hidden = false;
    btn.setAttribute("aria-pressed", "true");
    const b = btn.querySelector("b");
    if (b) b.textContent = "ON";
    catEscNota("Apunta al código de barras del producto.");
    video.play().catch(function () {});
    CAT.escaner.raf = requestAnimationFrame(catEscBucle);
  };

  // Si el inventario ya tiene la cámara encendida, se comparte el mismo
  // stream (mismo truco que usan los pasos 1-4 entre sí): nunca dos cámaras.
  if (window.INV && INV.lec && INV.lec.camara) {
    usarStream(INV.lec.camara);
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    catEscNota("Sin acceso a la cámara en este dispositivo.");
    return;
  }
  navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false
  }).then(usarStream).catch(function (e) {
    catEscNota("No pude abrir la cámara: " + (e && e.message ? e.message : "permiso denegado"));
    if (typeof toast === "function") toast("Revisa el permiso de cámara de la APK.", "error");
  });
}

function catEscApagar() {
  const e = CAT.escaner;
  cancelAnimationFrame(e.raf);
  e.raf = 0;
  // El stream es del inventario si venía de ahí: ahí se apaga también.
  const delInventario = window.INV && INV.lec && INV.lec.camara === e.stream;
  if (e.stream && !delInventario) {
    e.stream.getTracks().forEach(function (t) { t.stop(); });
  }
  e.stream = null;
  e.activo = false;
  const video = catEscVideo();
  if (video) { video.srcObject = null; video.hidden = true; }
  const caja = document.getElementById("catEscCaja");
  if (caja) caja.hidden = true;
  const btn = catEscBoton();
  if (btn) {
    btn.setAttribute("aria-pressed", "false");
    const b = btn.querySelector("b");
    if (b) b.textContent = "OFF";
  }
  catEscNota("Escáner apagado. Toca «Escanear» para buscar por código.");
}

/** Bucle de lectura: muestrea ~8 veces por segundo para no calentar. */
function catEscBucle(ts) {
  const e = CAT.escaner;
  if (!e.activo) return;
  e.raf = requestAnimationFrame(catEscBucle);
  if (ts - e.ultimoMs < 120) return;
  e.ultimoMs = ts;
  const video = catEscVideo();
  if (!video || !video.videoWidth || !e.detector) return;
  e.detector.detect(video).then(function (codigos) {
    if (!codigos || !codigos.length || !CAT.escaner.activo) return;
    const raw = codigos[0].rawValue;
    if (!raw) return;
    catEscLeido(String(raw));
  }).catch(function () { /* frame no legible: se reintenta solo */ });
}

/** Código leído: va al buscador como búsqueda exacta y resalta la tarjeta. */
function catEscLeido(codigo) {
  catEscApagar();
  const input = document.getElementById("catBuscar");
  if (input) input.value = codigo;
  CAT.q = codigo;
  catCargar(false);
  if (typeof toast === "function") toast("Código leído: " + codigo);
  // Resalta la tarjeta del código exacto cuando la lista ya esté pintada.
  setTimeout(function () {
    const tarjeta = document.querySelector('.cat-card[data-codigo="' + codigo + '"]');
    if (tarjeta) {
      tarjeta.classList.add("destacado");
      tarjeta.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, 450);
}

/* ── Tienda FORGE: las 8 pantallas web unificadas ──────────────────────── */

function catTiendaTab(n) {
  const i = Number(n) - 1;
  if (i < 0 || i >= CAT_TIENDA.length) return;
  CAT.tienda.tab = n;
  const marco = document.getElementById("catTiendaMarco");
  const progreso = document.getElementById("catTiendaProgreso");
  if (!marco) return;
  const def = CAT_TIENDA[i];
  if (!CAT.tienda.montadas[def.n]) {
    const f = document.createElement("iframe");
    f.src = "catalogo-web/" + def.n + "/index.html";
    f.title = "Pantalla " + n + "/8 · " + def.t;
    f.setAttribute("loading", "lazy");
    marco.innerHTML = "";
    marco.appendChild(f);
    CAT.tienda.montadas[def.n] = true;
  } else {
    // Ya se montó: se recicla la vista en vez de recargar (mantiene scroll).
    if (marco.firstElementChild && marco.firstElementChild.title.indexOf(def.n) < 0) {
      marco.innerHTML = "";
      // Recrear el iframe guardado no es posible: se vuelve a montar limpio.
      const f = document.createElement("iframe");
      f.src = "catalogo-web/" + def.n + "/index.html";
      f.title = "Pantalla " + n + "/8 · " + def.t;
      marco.appendChild(f);
    }
  }
  if (progreso) progreso.textContent = "PASO " + n + "/8 · " + def.t.toUpperCase();
  document.querySelectorAll(".cat-tienda-tab").forEach(function (b) {
    b.classList.toggle("activo", Number(b.dataset.tab) === n);
  });
}

/* ── luz piloto de conexión (también en la topbar de toda la app) ──────── */

const CONEXION = { estado: "espera", ms: 0, ts: 0, timer: 0, corriendo: false };

/**
 * Piloto de conexión: internet (online/offline) + nube (ping a /api/health
 * de fabri-api cada 45 s). Estados: ok (verde), aviso (ámbar, internet sin
 * nube o nube lenta), error (rojo, sin internet). Siempre acompañados de
 * texto: nunca color solo.
 */
function conexionIniciar() {
  if (CONEXION.corriendo) return;
  CONEXION.corriendo = true;
  window.addEventListener("online", function () { conexionPing(); });
  window.addEventListener("offline", function () { conexionPintar("error", 0, "Sin internet"); });
  conexionPing();
  CONEXION.timer = setInterval(conexionPing, 45000);
}

function conexionPing() {
  if (navigator.onLine === false) {
    conexionPintar("error", 0, "Sin internet");
    return;
  }
  conexionPintar("espera", 0, "Verificando…");
  const t0 = Date.now();
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const limite = setTimeout(function () { if (ctrl) ctrl.abort(); }, 6000);
  fetch("https://fabri-api.vercel.app/api/health", {
    cache: "no-store", signal: ctrl ? ctrl.signal : undefined
  }).then(function (r) {
    clearTimeout(limite);
    const ms = Date.now() - t0;
    if (r.ok) {
      if (ms > 2500) conexionPintar("aviso", ms, "Nube lenta");
      else conexionPintar("ok", ms, "En línea");
    } else {
      conexionPintar("aviso", ms, "Nube HTTP " + r.status);
    }
  }).catch(function () {
    clearTimeout(limite);
    // Sin internet da igual que sin nube: el piloto rojo es "no conectado".
    if (navigator.onLine === false) conexionPintar("error", 0, "Sin internet");
    else conexionPintar("aviso", 0, "Sin nube");
  });
}

function conexionPintar(estado, ms, texto) {
  CONEXION.estado = estado;
  CONEXION.ms = ms;
  CONEXION.ts = Date.now();
  ["pilotoConexion", "catPiloto", "invPilotoConexion"].forEach(function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = "piloto-conexion " + estado;
    const hora = new Date();
    const hh = String(hora.getHours()).padStart(2, "0") + ":" + String(hora.getMinutes()).padStart(2, "0");
    const msTxt = ms ? " · " + ms + " ms" : "";
    el.innerHTML = "<i></i>" + esc(texto) + msTxt + " · " + hh;
    el.title = estado === "ok"
      ? "La nube responde (" + ms + " ms). Última verificación " + hh + "."
      : (estado === "aviso"
        ? "Hay internet pero la nube no responde bien. Última verificación " + hh + "."
        : "Sin conexión a internet. Última verificación " + hh + ".");
  });
}

/* ── arranque del módulo (delegación de eventos del documento) ─────────── */
(function catMontar() {
  document.addEventListener("click", function (ev) {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    const escanear = t.closest("#btnCatEsc");
    if (escanear) { catEscToggle(); return; }
    const tab = t.closest(".cat-tienda-tab");
    if (tab) { catTiendaTab(Number(tab.dataset.tab)); return; }
    const refrescar = t.closest("#btnCatRefrescar");
    if (refrescar) {
      CAT.panel = null;
      CAT.lote = 24;
      catCargar(false);
      return;
    }
  });
  document.addEventListener("input", function (ev) {
    if (ev.target && ev.target.id === "catBuscar") catBuscar(ev.target.value);
  });
})();
