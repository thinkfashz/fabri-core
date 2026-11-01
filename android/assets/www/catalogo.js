/* ==========================================================================
   FORGE CORE STOCK · Módulo Catálogo + Tienda
   --------------------------------------------------------------------------
   Un módulo, seis páginas con navegación libre:
     catálogo → producto → carrito → checkout → pago → éxito
   Puedes seguir viendo productos y ir a pagar cuando quieras. El carrito se
   guarda en localStorage y sobrevive a la navegación dentro de la app.

   Datos: todo sale del núcleo local (acción `listar` y `panel`). La ficha de
   cada producto (JSON `ficha`) se usa como wiki: imagen, descripción,
   etiquetas, Nutri-Score, NOVA y alérgenos.

   Reutiliza del inventario: invApiTarde, invClp, invFichaDe, INV_CATEGORIAS
   y el apagado del lector (invLectorParar) para que nunca haya dos cámaras.
   ========================================================================== */

const CAT = {
  activa: false,
  productos: [],
  total: 0,
  q: "",
  cat: "",
  cargando: false,
  lote: 24,
  panel: null,
  vista: "catalogo",
  producto: null,
  lector: { activo: false, stream: null, detector: null, raf: 0, ultimoMs: 0, ultimo: "" },
  carro: [],
  pedido: null,
  banners: [],
  pedidoDemo: null
};

const CAT_LOTE_NUCLEO = 500;
const CAT_CLAVE_CARRO = "forge.tienda.carrito";
const CAT_CLAVE_PEDIDO = "forge.tienda.pedido";

/* ── iconos (24×24, trazo; sin emoji ni fuentes externas) ──────────────── */
const CAT_ICO = {
  buscar: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="3" y1="12" x2="21" y2="12"/>',
  carro: '<path d="M4 5h2l2.1 9.6a1.6 1.6 0 0 0 1.6 1.3h7.6a1.6 1.6 0 0 0 1.6-1.2L20.5 8H6.4"/><circle cx="10" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/>',
  volver: '<path d="M15 18l-6-6 6-6"/>',
  mas: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
  menos: '<circle cx="12" cy="12" r="9"/><line x1="8" y1="12" x2="16" y2="12"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  rayo: '<path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z"/>',
  etiqueta: '<path d="M20.6 13.4 12 22l-9-9V4h9l8.6 8.6a1.4 1.4 0 0 1 0 2z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
  caja: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>'
};

function catIco(nombre, tam) {
  const d = CAT_ICO[nombre] || CAT_ICO.caja;
  const t = tam || 18;
  return '<svg viewBox="0 0 24 24" width="' + t + '" height="' + t +
    '" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
}

/** Precio compacto para los KPIs: $12,3 M en vez de $12.345.678 (que no cabe). */
function catClpCorto(n) {
  const v = Number(n || 0);
  if (v >= 1000000000) return "$" + (v / 1000000000).toFixed(1).replace(".", ",") + " MM";
  if (v >= 1000000) return "$" + (v / 1000000).toFixed(1).replace(".", ",") + " M";
  if (v >= 100000) return "$" + Math.round(v / 1000) + " mil";
  return invClp(v);
}

/* Motivos por categoría (48×48) y tintes. */
const CAT_MOTIVO = {
  abarrotes: '<path d="M14 17h20l3 19a3 3 0 0 1-3 3.4H14A3 3 0 0 1 11 36z"/><path d="m14 17 4-6h12l4 6"/><path d="M20 27h8"/>',
  bebidas: '<path d="M20 6h8v7l4 6v21a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4V19l4-6z"/><path d="M16 25h16v10H16z"/>',
  alcohol: '<path d="M15 7h18l-2 9a7 7 0 0 1-14 0Z"/><path d="M24 23v12m-6 6h12"/>',
  dulces: '<rect x="14" y="16" width="20" height="16" rx="6"/><path d="m14 22-6-4v16l6-4m20-4 6 4V18l-6 4"/><path d="M21 21v6"/>',
  lacteos: '<path d="M15 21 22 12h4l7 9v17a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3z"/><path d="M15 21h18"/><path d="m22 12 3 9 3-9"/>',
  congelados: '<path d="M24 8v32M10 16l28 16M38 16 10 32"/><path d="m20 11 4 4 4-4M20 37l4-4 4 4"/>',
  cosmetica: '<rect x="17" y="18" width="14" height="22" rx="4"/><path d="M21 18v-5a3 3 0 0 1 3-3 3 3 0 0 1 3 3v5"/><path d="M21 27h6"/>',
  limpieza: '<path d="M19 18h10l2 22a3 3 0 0 1-3 3.4H20A3 3 0 0 1 17 40Z"/><path d="M22 18v-6h6v6"/><path d="M31 9h5l3 4h-8"/>',
  mascotas: '<ellipse cx="24" cy="31" rx="7" ry="6"/><circle cx="14" cy="22" r="3.4"/><circle cx="21" cy="15" r="3.4"/><circle cx="29" cy="15" r="3.4"/><circle cx="36" cy="22" r="3.4"/>',
  otros: '<path d="m12 2 9 4.5v11L12 22l-9-4.5v-11L12 2Z"/><path d="M3.3 6.7 12 11l8.7-4.3M12 11v11"/>'
};
const CAT_TINTE = {
  abarrotes: "#F5B942", bebidas: "#5AD9E8", alcohol: "#B48CFF", dulces: "#FF7AC8",
  lacteos: "#7FB5FF", congelados: "#9AD8F0", cosmetica: "#D8A1FF",
  limpieza: "#6FE3B2", mascotas: "#FFA85A", otros: "#C8FF00"
};

function catMotivo(categoria, tam) {
  const d = CAT_MOTIVO[categoria] || CAT_MOTIVO.otros;
  const t = tam || 40;
  return '<svg viewBox="0 0 48 48" width="' + t + '" height="' + t +
    '" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
}

function catTinte(categoria) {
  const c = CAT_TINTE[categoria] || CAT_TINTE.otros;
  return { fondo: c + "1A", texto: c };
}

/* ── ciclo de vida ─────────────────────────────────────────────────────── */
function catIniciar() {
  CAT.activa = true;
  CAT.carro = catCarroLeer();
  if (typeof conexionIniciar === "function") conexionIniciar();
  catIr("catalogo", true);
  catCargar(false);
}

function catSalir() {
  CAT.activa = false;
  catEscApagar();
  ESC.abierto = false;
}

/* ── navegación entre páginas del módulo ───────────────────────────────── */
function catIr(vista, silencio) {
  const paginas = {
    catalogo: ["catEscenaCatalogo", "Catálogo", "Tu tienda"],
    producto: ["catEscenaProducto", "Producto", "Detalle"],
    escaner: ["catEscenaEscaner", "Escáner", "Agrega al carrito"],
    carrito: ["catEscenaCarrito", "Carrito", "Tu pedido"],
    checkout: ["catEscenaCheckout", "Entrega y pago", "Paso 2 de 3"],
    pago: ["catEscenaPago", "Procesando pago", "Paso 3 de 3"],
    exito: ["catEscenaExito", "Pedido confirmado", "Listo"]
  };
  if (!paginas[vista]) vista = "catalogo";
  CAT.vista = vista;
  const def = paginas[vista];
  document.querySelectorAll("#v-catalogo .cat-escena").forEach(function (s) {
    s.classList.remove("activa");
  });
  const escena = document.getElementById(def[0]);
  if (escena) escena.classList.add("activa");
  const titulo = document.getElementById("catTituloBarra");
  const sub = document.getElementById("catSubBarra");
  if (titulo) titulo.textContent = def[1];
  if (sub) sub.textContent = def[2];
  const volver = document.getElementById("catVolver");
  if (volver) volver.hidden = vista === "catalogo";
  catCarroBadge();
  if (!silencio) window.scrollTo({ top: 0, behavior: "instant" });
}

function catCarroBadge() {
  const b = document.getElementById("catCarroBadge");
  if (!b) return;
  const n = CAT.carro.reduce(function (a, x) { return a + Number(x.cantidad || 0); }, 0);
  b.textContent = n ? String(n) : "";
}

/* ── carrito persistente ───────────────────────────────────────────────── */
function catCarroLeer() {
  try {
    const raw = localStorage.getItem(CAT_CLAVE_CARRO);
    const l = raw ? JSON.parse(raw) : [];
    return Array.isArray(l) ? l.filter(function (x) { return x && x.codigo; }) : [];
  } catch (e) { return []; }
}

function catCarroGuardar() {
  try { localStorage.setItem(CAT_CLAVE_CARRO, JSON.stringify(CAT.carro)); } catch (e) {}
  catCarroBadge();
}

function catCarroAgregar(p, cantidad) {
  if (!p || !p.codigo) return;
  const n = Math.max(1, Number(cantidad || 1));
  const ya = CAT.carro.find(function (x) { return x.codigo === p.codigo; });
  if (ya) {
    ya.cantidad = Number(ya.cantidad || 0) + n;
  } else {
    CAT.carro.push({
      codigo: p.codigo,
      nombre: p.nombre || "(sin nombre)",
      precio: Number(p.precio || 0),
      categoria: p.categoria || "otros",
      unidad: p.unidad || "",
      cantidad: n,
      imagen: (catFicha(p).imagen || "")
    });
  }
  catCarroGuardar();
  if (typeof toast === "function") toast("Agregado al carrito · " + (p.nombre || ""));
}

function catCarroQuitar(codigo) {
  CAT.carro = CAT.carro.filter(function (x) { return x.codigo !== codigo; });
  catCarroGuardar();
  catPintarCarrito();
}

function catCarroCantidad(codigo, delta) {
  const it = CAT.carro.find(function (x) { return x.codigo === codigo; });
  if (!it) return;
  it.cantidad = Number(it.cantidad || 0) + delta;
  if (it.cantidad <= 0) {
    CAT.carro = CAT.carro.filter(function (x) { return x.codigo !== codigo; });
  }
  catCarroGuardar();
  catPintarCarrito();
}

function catCarroTotales() {
  const subtotal = CAT.carro.reduce(function (a, x) {
    return a + Number(x.precio || 0) * Number(x.cantidad || 0);
  }, 0);
  const envio = subtotal >= 20000 || subtotal === 0 ? 0 : 2990;
  const total = subtotal + envio;
  return { subtotal: subtotal, envio: envio, total: total };
}

/* ── datos ─────────────────────────────────────────────────────────────── */
function catFicha(p) {
  if (!p) return {};
  if (typeof invFichaDe === "function") return invFichaDe(p);
  try { return JSON.parse(p.ficha || "{}") || {}; } catch (e) { return {}; }
}

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

function catCargar(mas) {
  if (CAT.cargando) return;
  CAT.cargando = true;
  if (!mas) catPintarCargando();
  const args = { limite: CAT_LOTE_NUCLEO, offset: mas ? CAT.productos.length : 0 };
  if (CAT.q) args.texto = CAT.q;
  if (CAT.cat) args.categoria = CAT.cat;

  Promise.all([invApiTarde("listar", args, { maxMs: 12000 }), catPanel()]).then(function (par) {
    CAT.cargando = false;
    const r = par[0];
    if (!r.ok || !r.data || !Array.isArray(r.data.productos)) {
      if (!mas) {
        CAT.productos = [];
        catRender();
        catAviso("No pude leer el catálogo: " + (r.error || "error"));
      }
      return;
    }
    const filas = r.data.productos;
    CAT.total = Number(r.data.total || 0);
    CAT.productos = mas ? CAT.productos.concat(filas) : filas;
    // Si «Ver más» tuvo que traer una página nueva, muestra enseguida el
    // siguiente lote: si no, el usuario pulsa y no ve nada nuevo.
    if (mas && CAT.recargarLote) {
      CAT.lote = Math.min(CAT.productos.length, CAT.lote + 24);
      CAT.recargarLote = false;
    }
    catPintarEstado();
    catRender();
    catPintarBanners();
  });
}

/* ── pintado del catálogo ──────────────────────────────────────────────── */
function catPintarKpis() {
  const caja = document.getElementById("catKpis");
  if (!caja || !CAT.panel) return;
  const r = CAT.panel.resumen || {};
  caja.innerHTML =
    '<div class="cat-kpi"><span class="cat-kpi-etq">Productos</span>' +
      '<b class="cat-kpi-valor">' + Number(r.total || 0).toLocaleString("es-CL") + '</b>' +
      '<span class="cat-kpi-pie">en tu base</span></div>' +
    '<div class="cat-kpi' + (Number(r.stock_bajo) > 0 ? " alto" : "") + '">' +
      '<span class="cat-kpi-etq">Stock bajo</span>' +
      '<b class="cat-kpi-valor">' + Number(r.stock_bajo || 0).toLocaleString("es-CL") + '</b>' +
      '<span class="cat-kpi-pie">a reponer</span></div>' +
    '<div class="cat-kpi acento"><span class="cat-kpi-etq">Valor venta</span>' +
      '<b class="cat-kpi-valor">' + catClpCorto(r.valor_venta || 0) + '</b>' +
      '<span class="cat-kpi-pie">a precio actual</span></div>';
}

function catPintarChips() {
  const caja = document.getElementById("catChips");
  if (!caja) return;
  const conteos = {};
  ((CAT.panel && CAT.panel.categorias) || []).forEach(function (c) { conteos[c.categoria] = c.n; });
  let html = '<button class="cat-chip' + (CAT.cat === "" ? " activo" : "") +
    '" data-cat="" type="button">Todas <b>' +
    Number(CAT.panel && CAT.panel.resumen ? CAT.panel.resumen.total || 0 : 0).toLocaleString("es-CL") +
    '</b></button>';
  Object.keys(INV_CATEGORIAS).forEach(function (id) {
    const n = conteos[id];
    if (!n) return;
    html += '<button class="cat-chip' + (CAT.cat === id ? " activo" : "") +
      '" data-cat="' + id + '" type="button">' + INV_CATEGORIAS[id] +
      ' <b>' + Number(n).toLocaleString("es-CL") + '</b></button>';
  });
  caja.innerHTML = html;
  caja.querySelectorAll(".cat-chip").forEach(function (b) {
    b.addEventListener("click", function () {
      const id = b.dataset.cat || "";
      if (CAT.cat === id) return;
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
  caja.innerHTML = n
    ? "Mostrando <b>" + Number(n).toLocaleString("es-CL") + "</b> de <b>" +
      Number(Math.min(CAT.total, CAT.productos.length)).toLocaleString("es-CL") + "</b> cargados · " + hora
    : "Sin resultados";
}

function catAviso(msg) {
  const caja = document.getElementById("catAviso");
  if (caja) caja.textContent = msg || "";
}

/* Promoción determinista por producto: siempre la misma para el mismo código,
   pero variada entre productos. */
function catPromo(p) {
  const cod = String(p.codigo || "");
  let h = 0;
  for (let i = 0; i < cod.length; i++) h = (h * 31 + cod.charCodeAt(i)) >>> 0;
  const stock = Number(p.stock || 0);
  const minimo = Number(p.stock_minimo || 0);
  const precio = Number(p.precio || 0);
  if (stock <= 0) return null;
  if (stock <= minimo) return { texto: "Últimas " + stock, clase: "ambar" };
  if (precio >= 15000) return { texto: "Envío gratis", clase: "" };
  const r = h % 6;
  if (r === 0) return { texto: "Oferta", clase: "rojo" };
  if (r === 1) return { texto: "2x1", clase: "" };
  if (r === 2) return { texto: "Top ventas", clase: "ambar" };
  if (r === 3) return { texto: "-15%", clase: "rojo" };
  if (r === 4) return { texto: "Recomendado", clase: "" };
  return null;
}

function catCardHtml(p) {
  const t = catTinte(p.categoria);
  const stock = Number(p.stock || 0);
  const minimo = Number(p.stock_minimo || 0);
  const claseStock = stock <= 0 ? " cero" : (stock <= minimo ? " bajo" : "");
  const promo = catPromo(p);
  const f = catFicha(p);
  const img = f.imagen
    ? '<img src="' + esc(f.imagen) + '" alt="" loading="lazy" ' +
      'onerror="this.remove()" />'
    : catMotivo(p.categoria, 40);
  return '<article class="cat-card" data-codigo="' + esc(p.codigo || "") + '" ' +
      'style="--cat-tinte:' + t.fondo + ';--cat-tinte-txt:' + t.texto + '">' +
    '<div class="cat-card-thumb">' + img +
      (promo ? '<span class="cat-card-promo ' + promo.clase + '">' + promo.texto + '</span>' : "") +
      '<span class="cat-card-stock' + claseStock + '">' + stock + ' und</span>' +
    '</div>' +
    '<b class="cat-card-nombre">' + esc(p.nombre || "(sin nombre)") + '</b>' +
    '<span class="cat-card-meta">' + esc(p.marca || "Sin marca") +
      (p.unidad ? " · " + esc(p.unidad) : "") + '</span>' +
    '<span class="cat-card-precio"><b>' + invClp(p.precio || 0) + '</b></span>' +
    '<span class="cat-card-codigo">' + esc(p.codigo || "") + '</span>' +
    '<button class="cat-card-agregar" data-agregar="' + esc(p.codigo || "") + '" type="button">' +
      catIco("carro", 14) + ' Agregar</button>' +
    '</article>';
}

function catRender() {
  const caja = document.getElementById("catLista");
  if (!caja) return;
  if (!CAT.productos.length) {
    caja.innerHTML = '<div class="cat-vacio">' + catIco("buscar", 32) +
      "<b>Sin productos para esta búsqueda</b>" +
      "<span>Prueba otro texto, toca «Todas» o escanea el código.</span></div>";
    return;
  }
  const visibles = CAT.productos.slice(0, CAT.lote);
  const rest = catRestantes();
  caja.innerHTML = visibles.map(catCardHtml).join("") +
    (rest
      ? '<button class="cat-btn bloque" id="catMas" type="button" style="grid-column:1/-1">' +
        catIco("mas", 16) + " " + rest.texto + "</button>"
      : "");
  const b = document.getElementById("catMas");
  if (b) b.addEventListener("click", catMas);
  caja.querySelectorAll(".cat-card").forEach(function (c) {
    c.addEventListener("click", function (ev) {
      if (ev.target.closest("[data-agregar]")) return;
      catAbrirProducto(c.dataset.codigo);
    });
  });
  caja.querySelectorAll("[data-agregar]").forEach(function (b2) {
    b2.addEventListener("click", function (ev) {
      ev.stopPropagation();
      const p = CAT.productos.find(function (x) { return x.codigo === b2.dataset.agregar; });
      if (p) catCarroAgregar(p, 1);
    });
  });
}

/** «Ver más»: primero muestra lo ya descargado; sólo pide otra página cuando
 *  se agotó el búfer local. Antes siempre pedía una página nueva y el render
 *  seguía cortando en CAT.lote, así que no aparecía nada. */
function catMas() {
  if (CAT.lote < CAT.productos.length) {
    CAT.lote += 24;
    catRender();
    return;
  }
  if (CAT.productos.length < CAT.total) {
    CAT.recargarLote = true;
    catCargar(true);
  }
}

function catRestantes() {
  const porMostrar = Math.max(0, CAT.productos.length - CAT.lote);
  if (porMostrar > 0) return { n: porMostrar, texto: "Ver " + Number(porMostrar).toLocaleString("es-CL") + " más" };
  const porTraer = Math.max(0, CAT.total - CAT.productos.length);
  if (porTraer > 0) return { n: porTraer, texto: "Cargar " + Number(porTraer).toLocaleString("es-CL") + " más" };
  return null;
}

function catBuscar(texto) {
  CAT.q = String(texto || "").trim();
  clearTimeout(catBuscar._t);
  catBuscar._t = setTimeout(function () { catCargar(false); }, 260);
}

/* ── banners de promoción en SVG (español) ─────────────────────────────── */
const CAT_BANNERS = [
  { t: "OFERTA FLASH",     s: "hasta 30% OFF", c: "en productos seleccionados", cta: "VER OFERTAS",   tema: 0 },
  { t: "PRECIO BAJÓ",      s: "nuevos precios", c: "en tu catálogo local",      cta: "VER PRECIOS",   tema: 1 },
  { t: "LLEVA 3 PAGA 2",   s: "en toda la tienda", c: "mientras haya stock",    cta: "APROVECHAR",    tema: 2 },
  { t: "ENVÍO GRATIS",     s: "desde $20.000", c: "en toda la región",          cta: "COMPRAR",       tema: 3 },
  { t: "TOP VENTAS",       s: "lo más pedido", c: "elegido por tus clientes",   cta: "VER RANKING",   tema: 4 },
  { t: "LIQUIDACIÓN",      s: "últimas unidades", c: "hasta agotar stock",      cta: "VER AHORA",     tema: 5 }
];

const CAT_TEMAS = [
  { fondo: "#C8FF00", texto: "#0A0A0A", acento: "#0A0A0A", cta: "#0A0A0A", ctaTxt: "#C8FF00" },
  { fondo: "#121212", texto: "#F5F6F2", acento: "#C8FF00", cta: "#C8FF00", ctaTxt: "#0A0A0A" },
  { fondo: "#FF5A4E", texto: "#FFF8F5", acento: "#0A0A0A", cta: "#0A0A0A", ctaTxt: "#FFF3F0" },
  { fondo: "#7FB5FF", texto: "#06101F", acento: "#06101F", cta: "#06101F", ctaTxt: "#CFE6FF" },
  { fondo: "#B48CFF", texto: "#150A28", acento: "#150A28", cta: "#150A28", ctaTxt: "#E9DBFF" },
  { fondo: "#FFA85A", texto: "#231000", acento: "#231000", cta: "#231000", ctaTxt: "#FFE0C2" }
];

function catBannerSvg(temaIdx, p) {
  const def = CAT_BANNERS[temaIdx % CAT_BANNERS.length];
  const t = CAT_TEMAS[def.tema];
  const nombre = esc((p && p.nombre ? p.nombre : "Productos seleccionados").slice(0, 18)) +
    ((p && p.nombre && p.nombre.length > 18) ? "…" : "");
  const precio = p && p.precio ? invClp(p.precio) : "";
  return '<svg viewBox="0 0 640 260" role="img" aria-label="' + def.t + '">' +
    '<defs><linearGradient id="bg' + temaIdx + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + t.fondo + '"/>' +
      '<stop offset="1" stop-color="' + t.fondo + '"/></linearGradient></defs>' +
    '<rect width="640" height="260" rx="28" fill="' + t.fondo + '"/>' +
    '<g opacity="0.14" stroke="' + t.acento + '" stroke-width="2">' +
      '<path d="M0 210 210 0M120 260 330 50M300 260 510 50M480 260 640 100"/></g>' +
    '<text x="40" y="70" fill="' + t.acento + '" font-family="system-ui,-apple-system,sans-serif" ' +
      'font-size="15" font-weight="700" letter-spacing="4">' + def.t + '</text>' +
    '<text x="40" y="126" fill="' + t.texto + '" font-family="system-ui,-apple-system,sans-serif" ' +
      'font-size="40" font-weight="800" letter-spacing="-1.5">' + def.s + '</text>' +
    '<text x="40" y="162" fill="' + t.texto + '" opacity="0.72" ' +
      'font-family="system-ui,-apple-system,sans-serif" font-size="16" font-weight="500">' +
      def.c + '</text>' +
    '<rect x="40" y="188" rx="14" width="196" height="44" fill="' + t.cta + '"/>' +
    '<text x="138" y="216" text-anchor="middle" fill="' + t.ctaTxt + '" ' +
      'font-family="system-ui,-apple-system,sans-serif" font-size="14" font-weight="800">' +
      def.cta + '</text>' +
    '<g transform="translate(430 58)">' +
      '<rect x="0" y="0" width="150" height="142" rx="24" fill="rgba(0,0,0,0.10)"/>' +
      '<text x="75" y="60" text-anchor="middle" fill="' + t.texto + '" ' +
        'font-family="system-ui,-apple-system,sans-serif" font-size="11.5" font-weight="600" ' +
        'opacity="0.85">' + nombre + '</text>' +
      '<text x="75" y="100" text-anchor="middle" fill="' + t.acento + '" ' +
        'font-family="system-ui,-apple-system,sans-serif" font-size="24" font-weight="800">' +
        precio + '</text>' +
      '<text x="75" y="122" text-anchor="middle" fill="' + t.texto + '" opacity="0.55" ' +
        'font-family="system-ui,-apple-system,sans-serif" font-size="10" font-weight="600">' +
        'precio tienda</text>' +
    '</g></svg>';
}

function catPintarBanners() {
  const caja = document.getElementById("catBanners");
  const dots = document.getElementById("catBannersDots");
  if (!caja) return;
  const conStock = CAT.productos.filter(function (p) { return Number(p.stock || 0) > 0; });
  const base = conStock.length ? conStock : CAT.productos;
  const pick = base.slice(0, 6).map(function (_, i) {
    return base[(i * 7 + 3) % base.length];
  });
  const lista = pick.length ? pick : [null, null, null];
  caja.innerHTML = lista.map(function (p, i) {
    return '<div class="cat-banner" data-banner="' + esc(p ? p.codigo : "") + '">' +
      catBannerSvg(i, p) + '</div>';
  }).join("");
  if (dots) {
    dots.innerHTML = lista.map(function (_, i) {
      return '<i' + (i === 0 ? ' class="activo"' : '') + '></i>';
    }).join("");
  }
  caja.querySelectorAll(".cat-banner").forEach(function (b) {
    b.addEventListener("click", function () {
      if (b.dataset.banner) catAbrirProducto(b.dataset.banner);
    });
  });
  caja.onscroll = function () { catBannersPunto(caja); };
  catBannersAuto();
}

/** Índice del banner más cercano al borde izquierdo del carrusel. */
function catBannerIndice(caja) {
  const first = caja.children[0];
  if (!first) return 0;
  const base = first.offsetLeft;
  let mejor = 0, dist = Infinity;
  for (let i = 0; i < caja.children.length; i++) {
    const d = Math.abs((caja.children[i].offsetLeft - base) - caja.scrollLeft);
    if (d < dist) { dist = d; mejor = i; }
  }
  return mejor;
}

function catBannersPunto(caja) {
  const dots = document.getElementById("catBannersDots");
  if (!dots) return;
  const i = catBannerIndice(caja);
  dots.querySelectorAll("i").forEach(function (d, k) {
    d.classList.toggle("activo", k === i);
  });
}

function catBannersAuto() {
  clearInterval(CAT.bannerTimer);
  CAT.bannerTimer = setInterval(function () {
    if (!CAT.activa || CAT.vista !== "catalogo") return;
    const caja = document.getElementById("catBanners");
    if (!caja || caja.children.length < 2) return;
    const i = catBannerIndice(caja);
    const n = (i + 1) % caja.children.length;
    const first = caja.children[0];
    const destino = caja.children[n].offsetLeft - first.offsetLeft;
    caja.scrollTo({ left: destino, behavior: "smooth" });
  }, 5200);
}

/* ==========================================================================
   WIKI DEL PRODUCTO (Open Food/Beauty/Products Facts) + PRECIOS DE MERCADO
   ========================================================================== */

const CAT_WIKI_TTL = 30 * 24 * 60 * 60 * 1000;   // 30 días

function catWikiLeer(codigo) {
  try {
    const raw = localStorage.getItem("forge.wiki." + codigo);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || !o.ts || Date.now() - o.ts > CAT_WIKI_TTL) return null;
    return o.datos || null;
  } catch (e) { return null; }
}

function catWikiGuardar(codigo, datos) {
  try {
    localStorage.setItem("forge.wiki." + codigo,
      JSON.stringify({ ts: Date.now(), datos: datos }));
  } catch (e) { /* sin espacio: se ignora */ }
}

/** Pide la ficha a las bases libres (sin clave) y la cachea 30 días. */
function catWikiCargar(p, forzar) {
  if (!p || !p.codigo) return Promise.resolve(null);
  const codigo = String(p.codigo);
  if (!forzar) {
    const guardado = catWikiLeer(codigo);
    if (guardado) return Promise.resolve(guardado);
  }
  if (typeof invConsultarApiLibre !== "function") return Promise.resolve(null);
  if (navigator.onLine === false) return Promise.resolve(null);
  return invConsultarApiLibre(codigo).then(function (r) {
    if (!r || !r.ok || !r.producto) return null;
    catWikiGuardar(codigo, r.producto);
    return r.producto;
  }).catch(function () { return null; });
}

/** Pinta la ficha ampliada de la wiki en el detalle. */
function catPintarWikiApi(p, wiki) {
  const caja = document.getElementById("catWikiApi");
  if (!caja) return;
  if (!wiki) { caja.hidden = true; return; }
  const f = wiki.ficha || {};
  const chips = [];
  if (f.nutriscore) chips.push('<span class="cat-etq alerta">Nutri-Score ' + esc(String(f.nutriscore).toUpperCase()) + '</span>');
  if (f.nova) chips.push('<span class="cat-etq">NOVA ' + esc(String(f.nova)) + '</span>');
  (f.alergenos || []).slice(0, 4).forEach(function (a) {
    chips.push('<span class="cat-etq error">' + esc(a) + '</span>');
  });
  (f.etiquetas_todas || []).slice(0, 6).forEach(function (e) {
    chips.push('<span class="cat-etq ok">' + esc(e) + '</span>');
  });
  const desc = (wiki.descripcion || "").trim();
  const ing = (f.ingredientes || "").trim();
  caja.hidden = false;
  caja.innerHTML =
    '<h3>Ficha ampliada <small>' + esc(wiki.fuente || "Open Food Facts") + '</small></h3>' +
    (wiki.imagen
      ? '<img class="cat-wiki-img" src="' + esc(wiki.imagen) + '" alt="" loading="lazy" ' +
        'onerror="this.remove()" />'
      : "") +
    (desc ? '<p>' + esc(desc) + '</p>' : "") +
    (ing ? '<p class="cat-wiki-ing"><b>Ingredientes:</b> ' + esc(ing) + '</p>' : "") +
    (chips.length ? '<div class="cat-wiki-etiquetas">' + chips.join("") + '</div>' : "");
}

/** Precios de mercado: referencia local + Open Prices (comunitario). */
function catPreciosMercado(p) {
  const caja = document.getElementById("catMercado");
  if (!caja) return;
  const precio = Number(p.precio || 0);
  // 1) Referencia local: misma categoría en tu propia base.
  const pares = CAT.productos.filter(function (x) {
    return x.categoria === p.categoria && Number(x.precio || 0) > 0 && x.codigo !== p.codigo;
  });
  const valores = pares.map(function (x) { return Number(x.precio); });
  let local = null;
  if (valores.length) {
    const min = Math.min.apply(null, valores);
    const max = Math.max.apply(null, valores);
    const prom = valores.reduce(function (a, b) { return a + b; }, 0) / valores.length;
    const dif = precio > 0 ? Math.round(((precio - prom) / prom) * 100) : 0;
    local = { min: min, max: max, prom: prom, n: valores.length, dif: dif };
  }

  const filaLocal = local
    ? '<div class="cat-mercado-fila"><span>Tu base · ' + local.n + ' similares</span>' +
      '<b>' + invClp(local.prom) + '</b></div>' +
      '<div class="cat-mercado-rango">' +
        '<span>mín ' + invClp(local.min) + '</span>' +
        '<span>máx ' + invClp(local.max) + '</span>' +
        (precio > 0 ? '<span class="' + (local.dif > 0 ? "caro" : "barato") + '">' +
          (local.dif > 0 ? "+" : "") + local.dif + '% vs promedio</span>' : "") +
      '</div>'
    : '<div class="cat-mercado-rango"><span>Sin otros productos de la misma categoría.</span></div>';

  caja.hidden = false;
  caja.innerHTML =
    '<h3>Precios de mercado</h3>' +
    '<div class="cat-mercado-tu">' +
      '<span>Tu precio</span><b>' + invClp(precio) + '</b>' +
    '</div>' +
    filaLocal +
    '<div class="cat-mercado-ext" id="catMercadoExt">' +
      '<span class="cat-mercado-cargando">Buscando precios comunitarios…</span>' +
    '</div>' +
    '<p class="cat-mercado-nota">Referencia local de tu base. Los precios ' +
      'comunitarios vienen de Open Prices (colaborativo, sin clave) y pueden no ' +
      'existir para este código en Chile.</p>';

  // 2) Open Prices: precios observados por la comunidad.
  if (navigator.onLine === false) {
    catMercadoExt("Sin conexión: sólo referencia local.", false);
    return;
  }
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const tope = setTimeout(function () { if (ctrl) ctrl.abort(); }, 8000);
  fetch("https://prices.openfoodfacts.org/api/v1/prices?product_code=" +
        encodeURIComponent(p.codigo) + "&size=20", { signal: ctrl ? ctrl.signal : undefined })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      clearTimeout(tope);
      const items = (d && d.items) || [];
      if (!items.length) {
        catMercadoExt("Sin precios comunitarios para este código.", true);
        return;
      }
      const cl = items.filter(function (it) {
        return (it.location_osm_address_country_code === "CL") ||
               (it.location && it.location.osm_address_country_code === "CL") ||
               String(it.currency || "").toUpperCase() === "CLP";
      });
      const usar = cl.length ? cl : items.slice(0, 5);
      const filas = usar.slice(0, 5).map(function (it) {
        const moneda = it.currency || "";
        const precioTxt = moneda === "CLP"
          ? invClp(it.price)
          : Number(it.price || 0).toLocaleString("es-CL") + " " + esc(moneda);
        const lugar = (it.location && (it.location.osm_name || it.location.osm_address_city)) || "Comunidad";
        const fecha = it.date ? String(it.date) : "";
        return '<div class="cat-mercado-obs">' +
          '<span>' + esc(lugar) + (fecha ? " · " + esc(fecha) : "") + '</span>' +
          '<b>' + precioTxt + '</b></div>';
      }).join("");
      catMercadoExt(
        (cl.length ? "" : '<p class="cat-mercado-aviso">Sin observaciones en Chile; ' +
          'se muestran referencias de otros países.</p>') + filas, true);
    })
    .catch(function () {
      clearTimeout(tope);
      catMercadoExt("No se pudo consultar Open Prices ahora.", false);
    });
}

function catMercadoExt(html, ok) {
  const caja = document.getElementById("catMercadoExt");
  if (!caja) return;
  caja.innerHTML = html;
  caja.classList.toggle("sin-datos", !ok);
}

/* ── página de producto ────────────────────────────────────────────────── */
function catAbrirProducto(codigo) {
  if (!codigo) return;
  const p = CAT.productos.find(function (x) { return x.codigo === codigo; });
  if (!p) { if (typeof toast === "function") toast("Producto no encontrado en la página actual."); return; }
  CAT.producto = p;
  catPintarProducto(p);
  catIr("producto");
}

function catPintarProducto(p) {
  const t = catTinte(p.categoria);
  const f = catFicha(p);
  const stock = Number(p.stock || 0);
  const minimo = Number(p.stock_minimo || 0);
  const claseStock = stock <= 0 ? " cero" : (stock <= minimo ? " bajo" : "");
  const img = f.imagen
    ? '<img src="' + esc(f.imagen) + '" alt="" onerror="this.parentNode.classList.add(\'sin-img\');this.remove()" />'
    : catMotivo(p.categoria, 96);

  const cajaImg = document.getElementById("catDetalleImg");
  if (cajaImg) {
    cajaImg.innerHTML = img + '<span class="cat-card-stock cat-detalle-stock' + claseStock + '">' +
      stock + " und</span>";
  }

  const cab = document.getElementById("catDetalleCab");
  if (cab) {
    cab.innerHTML =
      '<h2>' + esc(p.nombre || "(sin nombre)") + '</h2>' +
      '<span class="cat-detalle-marca">' + esc(p.marca || "Sin marca") +
        (p.unidad ? " · " + esc(p.unidad) : "") + '</span>' +
      '<div class="cat-detalle-precio"><b>' + invClp(p.precio || 0) + '</b>' +
        (Number(p.costo || 0) > 0 ? '<s>' + invClp(p.costo) + '</s>' : "") + '</div>';
  }

  const datos = document.getElementById("catDetalleDatos");
  if (datos) {
    datos.innerHTML =
      '<div class="cat-dato"><span>Código</span><b>' + esc(p.codigo || "") + '</b></div>' +
      '<div class="cat-dato"><span>Categoría</span><b>' +
        esc(INV_CATEGORIAS[p.categoria] || p.categoria || "Otros") + '</b></div>' +
      '<div class="cat-dato"><span>Stock</span><b>' + stock + ' und</b></div>' +
      '<div class="cat-dato"><span>Stock mínimo</span><b>' + minimo + ' und</b></div>' +
      '<div class="cat-dato"><span>Proveedor</span><b>' + esc(p.proveedor || "—") + '</b></div>';
  }

  const wiki = document.getElementById("catDetalleWiki");
  if (wiki) {
    const etiquetas = [];
    (f.etiquetas || []).forEach(function (id) {
      const et = (typeof invFreeEtiqueta === "function") ? invFreeEtiqueta(id) : id;
      etiquetas.push('<span class="cat-etq ok">' + esc(et) + '</span>');
    });
    if (f.nutriscore) etiquetas.push('<span class="cat-etq alerta">Nutri-Score ' + esc(String(f.nutriscore).toUpperCase()) + '</span>');
    if (f.nova) etiquetas.push('<span class="cat-etq">NOVA ' + esc(String(f.nova)) + '</span>');
    if ((f.alergenos || []).length) {
      etiquetas.push('<span class="cat-etq error">Alérgenos: ' + esc(f.alergenos.join(", ")) + '</span>');
    }
    const desc = f.descripcion || p.notas || "";
    if (!desc && !etiquetas.length) {
      wiki.hidden = true;
    } else {
      wiki.hidden = false;
      wiki.innerHTML = '<h3>Ficha del producto</h3>' +
        (desc ? '<p>' + esc(desc) + '</p>' : "") +
        (etiquetas.length ? '<div class="cat-wiki-etiquetas">' + etiquetas.join("") + '</div>' : "");
    }
  }

  const rel = document.getElementById("catRelacionados");
  if (rel) {
    const mismos = CAT.productos.filter(function (x) {
      return x.codigo !== p.codigo && x.categoria === p.categoria;
    }).slice(0, 8);
    if (!mismos.length) { rel.hidden = true; }
    else {
      rel.hidden = false;
      rel.innerHTML = '<h3>También te puede interesar</h3><div class="cat-relacionados-lista">' +
        mismos.map(function (r) {
          const tt = catTinte(r.categoria);
          const ff = catFicha(r);
          return '<div class="cat-rel-card" data-rel="' + esc(r.codigo) + '" ' +
            'style="--cat-tinte:' + tt.fondo + ';--cat-tinte-txt:' + tt.texto + '">' +
            '<span class="cat-rel-thumb">' +
              (ff.imagen ? '<img src="' + esc(ff.imagen) + '" alt="" loading="lazy" onerror="this.remove()" style="width:100%;height:100%;object-fit:contain;padding:4px" />'
                : catMotivo(r.categoria, 30)) + '</span>' +
            '<b>' + esc(r.nombre || "") + '</b>' +
            '<span>' + invClp(r.precio || 0) + '</span></div>';
        }).join("") + '</div>';
      rel.querySelectorAll("[data-rel]").forEach(function (c) {
        c.addEventListener("click", function () { catAbrirProducto(c.dataset.rel); });
      });
    }
  }

  catCargarExtras(p);
}

/** Carga en segundo plano la wiki del código y los precios de mercado. */
function catCargarExtras(p) {
  catPintarWikiApi(p, null);
  catPreciosMercado(p);
  const objetivo = p.codigo;
  catWikiCargar(p).then(function (w) {
    // Si el usuario ya abrió otro producto, no se pinta encima.
    if (!CAT.producto || CAT.producto.codigo !== objetivo) return;
    catPintarWikiApi(p, w);
  });
}

function catProductoAgregar() {
  const p = CAT.producto;
  if (!p) return;
  catCarroAgregar(p, 1);
  catIr("carrito");
}

/* ── carrito ───────────────────────────────────────────────────────────── */
function catPintarCarrito() {
  const lista = document.getElementById("catCarroLista");
  const tot = document.getElementById("catCarroTotales");
  if (!lista) return;
  if (!CAT.carro.length) {
    lista.innerHTML = '<div class="cat-vacio">' + catIco("carro", 34) +
      "<b>Tu carrito está vacío</b><span>Agrega productos desde el catálogo.</span></div>";
    if (tot) tot.innerHTML = "";
    return;
  }
  lista.innerHTML = CAT.carro.map(function (it) {
    const t = catTinte(it.categoria);
    return '<div class="cat-carro-item" style="--cat-tinte:' + t.fondo + ';--cat-tinte-txt:' + t.texto + '">' +
      '<span class="cat-carro-thumb">' +
        (it.imagen ? '<img src="' + esc(it.imagen) + '" alt="" onerror="this.remove()" />' : catMotivo(it.categoria, 26)) +
      '</span>' +
      '<div class="cat-carro-info"><b>' + esc(it.nombre) + '</b>' +
        '<span>' + invClp(it.precio) + '</span></div>' +
      '<div class="cat-carro-cant">' +
        '<button type="button" data-menos="' + esc(it.codigo) + '" aria-label="Quitar uno">−</button>' +
        '<b>' + it.cantidad + '</b>' +
        '<button type="button" data-mas="' + esc(it.codigo) + '" aria-label="Agregar uno">+</button>' +
      '</div></div>';
  }).join("");
  lista.querySelectorAll("[data-mas]").forEach(function (b) {
    b.addEventListener("click", function () { catCarroCantidad(b.dataset.mas, 1); });
  });
  lista.querySelectorAll("[data-menos]").forEach(function (b) {
    b.addEventListener("click", function () { catCarroCantidad(b.dataset.menos, -1); });
  });
  const t = catCarroTotales();
  if (tot) {
    tot.innerHTML =
      '<div class="cat-total-linea"><span>Subtotal</span><b>' + invClp(t.subtotal) + '</b></div>' +
      '<div class="cat-total-linea"><span>Envío</span><b>' +
        (t.envio ? invClp(t.envio) : "Gratis") + '</b></div>' +
      '<div class="cat-total-linea grande"><span>Total</span><b>' + invClp(t.total) + '</b></div>';
  }
}

/* ── checkout ──────────────────────────────────────────────────────────── */
function catPintarCheckout() {
  const t = catCarroTotales();
  const resumen = document.getElementById("catCheckoutResumen");
  if (resumen) {
    resumen.innerHTML =
      '<div class="cat-total-linea"><span>' + CAT.carro.length + ' producto(s)</span><b>' +
        invClp(t.subtotal) + '</b></div>' +
      '<div class="cat-total-linea"><span>Envío</span><b>' + (t.envio ? invClp(t.envio) : "Gratis") + '</b></div>' +
      '<div class="cat-total-linea grande"><span>Total</span><b>' + invClp(t.total) + '</b></div>';
  }
}

function catIrPagar() {
  if (!CAT.carro.length) { if (typeof toast === "function") toast("Tu carrito está vacío.", "error"); return; }
  catPintarCheckout();
  catIr("checkout");
}

function catConfirmarPedido(ev) {
  if (ev) ev.preventDefault();
  const nombre = (document.getElementById("catNombre") || {}).value || "";
  const direccion = (document.getElementById("catDireccion") || {}).value || "";
  const comuna = (document.getElementById("catComuna") || {}).value || "";
  const telefono = (document.getElementById("catTelefono") || {}).value || "";
  if (!nombre.trim() || !direccion.trim() || !comuna.trim()) {
    if (typeof toast === "function") toast("Completa nombre, dirección y comuna.", "error");
    return;
  }
  const metodo = document.querySelector('input[name="catPago"]:checked');
  const entrega = document.querySelector('input[name="catEntrega"]:checked');
  const t = catCarroTotales();
  CAT.pedido = {
    folio: "F-" + Date.now().toString().slice(-6),
    nombre: nombre.trim(),
    direccion: direccion.trim(),
    comuna: comuna.trim(),
    telefono: telefono.trim(),
    pago: metodo ? metodo.value : "WebPay",
    entrega: entrega ? entrega.value : "Despacho 24H",
    items: CAT.carro.slice(),
    subtotal: t.subtotal,
    envio: t.envio,
    total: t.total,
    ts: Date.now()
  };
  try { localStorage.setItem(CAT_CLAVE_PEDIDO, JSON.stringify(CAT.pedido)); } catch (e) {}
  catIr("pago");
  catSimularPago();
}

/* ── pago simulado ─────────────────────────────────────────────────────── */
function catSimularPago() {
  const aro = document.getElementById("catPagoAro");
  const pct = document.getElementById("catPagoPct");
  const pasos = ["Validando datos", "Autorizando pago", "Confirmando pedido"];
  let i = 0;
  const total = 100;
  const paso = function () {
    i += 1;
    const p = Math.round((i / pasos.length) * total);
    if (aro) aro.style.strokeDashoffset = String(264 - (264 * p) / 100);
    if (pct) pct.textContent = p + "%";
    document.querySelectorAll("#catPagoPasos .cat-pago-paso").forEach(function (el, idx) {
      el.classList.toggle("hecho", idx < i - 1);
      el.classList.toggle("activo", idx === i - 1);
    });
    if (i < pasos.length) {
      setTimeout(paso, 900);
    } else {
      document.querySelectorAll("#catPagoPasos .cat-pago-paso").forEach(function (el) {
        el.classList.add("hecho");
        el.classList.remove("activo");
      });
      setTimeout(catExito, 500);
    }
  };
  setTimeout(paso, 400);
}

/* ── éxito + seguimiento ───────────────────────────────────────────────── */
function catExito() {
  const p = CAT.pedido;
  if (!p) { catIr("catalogo"); return; }
  const caja = document.getElementById("catExitoCaja");
  if (caja) {
    caja.innerHTML =
      '<div class="cat-exito-cab">' +
        '<div class="cat-exito-check">' + catIco("check", 36) + '</div>' +
        '<h2>¡Pedido confirmado!</h2>' +
        '<p>Folio <b>' + esc(p.folio) + '</b> · ' + esc(p.pago) + ' · ' + esc(p.entrega) + '</p>' +
      '</div>' +
      '<div class="cat-seguimiento">' +
        '<div class="cat-seg-cab"><span>' + esc(p.entrega) + ' · en camino</span><b>60%</b></div>' +
        '<div class="cat-seg-barra"><i style="width:60%"></i></div>' +
        '<div class="cat-seg-pasos">' +
          '<div class="cat-seg-paso hecho"><i></i>Pedido confirmado</div>' +
          '<div class="cat-seg-paso hecho"><i></i>Preparado</div>' +
          '<div class="cat-seg-paso hecho"><i></i>En camino</div>' +
          '<div class="cat-seg-paso"><i></i>Entregado</div>' +
        '</div>' +
      '</div>' +
      '<div class="cat-totales">' +
        '<div class="cat-total-linea"><span>Envío a</span><b>' + esc(p.direccion) + ', ' + esc(p.comuna) + '</b></div>' +
        '<div class="cat-total-linea"><span>Productos</span><b>' + p.items.length + '</b></div>' +
        '<div class="cat-total-linea grande"><span>Total pagado</span><b>' + invClp(p.total) + '</b></div>' +
      '</div>';
  }
  catIr("exito");
  CAT.carro = [];
  catCarroGuardar();
  catPintarCarrito();
}

/* ==========================================================================
   ESCÁNER CON CANVAS
   --------------------------------------------------------------------------
   Escáner a pantalla completa pensado para trabajar de pie, en la tienda:

     · El vídeo va detrás y un <canvas> dibuja encima: máscara, esquinas,
       línea de barrido y destello verde al leer.
     · La lectura se hace sobre un canvas fuera de pantalla (más estable que
       leer el <video>), con BarcodeDetector y respaldo a invEscanearCuadro.
     · Cada código encontrado se agrega al carrito y se apila en el panel
       inferior, que sube con una fila por producto y el precio animado.
     · El código se busca en TODA la base (no sólo en la página cargada).
   ========================================================================== */

const ESC = {
  abierto: false,
  stream: null,
  detector: null,
  raf: 0,
  ultimoMs: 0,
  ultimoCodigo: "",
  ultimoT: 0,
  items: [],
  total: 0,
  totalMostrado: 0,
  destello: 0,
  audio: null,
  mudo: false,
  linterna: null,
  trabajando: false
};

/** Vibración corta (si el WebView la expone). */
function escVibrar(ms) {
  try { if (navigator.vibrate) navigator.vibrate(ms || 25); } catch (e) {}
}

/** Pitido corto generado con WebAudio: no hay archivos externos. */
function escPitar() {
  if (ESC.mudo) return;
  try {
    if (!ESC.audio) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      ESC.audio = new Ctx();
    }
    const ac = ESC.audio;
    if (ac.state === "suspended") ac.resume();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = "sine";
    o.frequency.value = 1180;
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ac.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.12);
    o.connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + 0.13);
  } catch (e) { /* sin audio: no pasa nada */ }
}

/** Busca un producto por código en la página cargada o en toda la base. */
function catPorCodigo(codigo) {
  const c = String(codigo || "");
  const enMem = CAT.productos.find(function (p) { return String(p.codigo) === c; });
  if (enMem) return Promise.resolve(enMem);
  if (CAT.cacheCodigo && CAT.cacheCodigo[c]) return Promise.resolve(CAT.cacheCodigo[c]);
  return invApiTarde("listar", { texto: c, limite: 8 }, { maxMs: 9000 }).then(function (r) {
    if (!r.ok || !r.data || !Array.isArray(r.data.productos)) return null;
    const p = r.data.productos.find(function (x) { return String(x.codigo) === c; }) || null;
    if (p) {
      CAT.cacheCodigo = CAT.cacheCodigo || {};
      CAT.cacheCodigo[c] = p;
    }
    return p;
  });
}

function catEscEstado(texto, clase) {
  const el = document.getElementById("escEstado");
  if (!el) return;
  el.className = "esc-chip" + (clase ? " " + clase : "");
  el.innerHTML = "<i></i>" + esc(texto);
}

/* ── abrir / cerrar ────────────────────────────────────────────────────── */
function catEscAbrir() {
  ESC.abierto = true;
  catIr("escaner");
  catEscPintar(null, true);
  catEscEncender();
}

function catEscCerrar() {
  catEscApagar();
  ESC.abierto = false;
  catIr("catalogo");
}

function catEscApagar() {
  if (ESC.raf) cancelAnimationFrame(ESC.raf);
  ESC.raf = 0;
  if (ESC.stream) {
    ESC.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
  }
  ESC.stream = null;
  ESC.detector = null;
  ESC.linterna = null;
  const video = document.getElementById("escVideo");
  if (video) video.srcObject = null;
  const cv = document.getElementById("escCanvas");
  if (cv) {
    const ctx = cv.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, cv.width, cv.height);
  }
}

async function catEscEncender() {
  const video = document.getElementById("escVideo");
  if (!video) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    catEscEstado("Sin cámara en este dispositivo", "error");
    return;
  }
  // Una sola cámara en toda la app.
  if (typeof invLectorParar === "function") invLectorParar();

  catEscEstado("Abriendo cámara…");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });
    ESC.stream = stream;
    video.srcObject = stream;
    await video.play().catch(function () {});

    if (typeof window.BarcodeDetector === "function" && !ESC.detector) {
      try {
        ESC.detector = new window.BarcodeDetector({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code", "codabar"]
        });
      } catch (e) {
        try { ESC.detector = new window.BarcodeDetector(); } catch (e2) { ESC.detector = null; }
      }
    }

    // Linterna, si el teléfono la expone.
    try {
      const track = stream.getVideoTracks()[0];
      const cap = track && track.getCapabilities ? track.getCapabilities() : {};
      if (cap && cap.torch) {
        ESC.linterna = track;
        const btn = document.getElementById("escLinterna");
        if (btn) btn.hidden = false;
      }
    } catch (e) {}

    catEscEstado("Apunta al código de barras");
    ESC.raf = requestAnimationFrame(catEscBucle);
  } catch (e) {
    catEscEstado("No pude abrir la cámara", "error");
    if (typeof toast === "function") toast("Cámara: " + (e && e.message ? e.message : "permiso denegado"), "error");
  }
}

function escLinternaToggle() {
  if (!ESC.linterna) return;
  ESC.torch = !ESC.torch;
  ESC.linterna.applyConstraints({ advanced: [{ torch: ESC.torch }] }).catch(function () {});
  const b = document.getElementById("escLinterna");
  if (b) b.classList.toggle("activa", ESC.torch);
}

/* ── bucle: dibujo del canvas + lectura ────────────────────────────────── */
function catEscBucle(ts) {
  if (!ESC.abierto) return;
  ESC.raf = requestAnimationFrame(catEscBucle);
  catEscDibujar(ts);
  if (ts - ESC.ultimoMs < 150 || ESC.trabajando) return;
  ESC.ultimoMs = ts;
  catEscLeerCuadro();
}

/** Lienzo fuera de pantalla reutilizado para leer fotogramas. */
let ESC_LIENZO = null;

function catEscLeerCuadro() {
  const video = document.getElementById("escVideo");
  if (!video || !video.videoWidth || !video.videoHeight) return;
  if (!ESC_LIENZO) {
    ESC_LIENZO = document.createElement("canvas");
    ESC_LIENZO.width = 720;
    ESC_LIENZO.height = 540;
  }
  const c = ESC_LIENZO;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  // Recorte central 4:3 (donde apunta la mira) y reescalado: menos píxeles,
  // más rápido y más estable que leer el vídeo entero.
  const vw = video.videoWidth, vh = video.videoHeight;
  const escala = Math.max(c.width / vw, c.height / vh);
  const sw = c.width / escala, sh = c.height / escala;
  ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, c.width, c.height);

  if (ESC.detector) {
    ESC.trabajando = true;
    ESC.detector.detect(c).then(function (codigos) {
      ESC.trabajando = false;
      if (!ESC.abierto || !codigos || !codigos.length) return;
      const raw = codigos[0].rawValue;
      if (raw) {
        // QR con URL o JSON: se extrae el código antes de buscar.
        const limpio = (typeof invCodigoDeTexto === "function")
          ? invCodigoDeTexto(raw) : String(raw);
        catEscLeido(limpio);
      }
    }).catch(function () { ESC.trabajando = false; });
  } else if (typeof invEscanearCuadro === "function") {
    // Respaldo del inventario: sólo si el WebView no trae BarcodeDetector.
    let v = "";
    try { v = invEscanearCuadro("escVideo"); } catch (e) { v = ""; }
    if (v) catEscLeido(String(v));
  }
}

/** Dibuja la máscara, las esquinas, el barrido y el destello. */
function catEscDibujar(ts) {
  const cv = document.getElementById("escCanvas");
  const video = document.getElementById("escVideo");
  if (!cv || !video) return;
  const r = cv.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = r.width, h = r.height;
  ctx.clearRect(0, 0, w, h);

  // Ventana de lectura
  const mx = w * 0.1, my = h * 0.2;
  const vx = mx, vy = my, vw = w - mx * 2, vh = h - my * 2;
  const radio = 20;

  // Máscara oscura con hueco
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(vx, vy, vw, vh, radio);
  else ctx.rect(vx, vy, vw, vh);
  ctx.fill();
  ctx.restore();

  // Destello al leer
  const ahora = ts || 0;
  const desde = ESC.destello ? ahora - ESC.destello : 9999;
  const leyendo = desde < 700;
  const alpha = leyendo ? Math.max(0, 1 - desde / 700) : 0;

  // Esquinas
  const largo = Math.min(34, vw * 0.16);
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.strokeStyle = leyendo ? "rgba(74,222,128," + (0.5 + alpha * 0.5) + ")" : "#C8FF00";
  ctx.shadowColor = leyendo ? "rgba(74,222,128,0.9)" : "rgba(200,255,0,0.9)";
  ctx.shadowBlur = 12;
  const esquinas = [
    [vx, vy, 1, 1], [vx + vw, vy, -1, 1],
    [vx, vy + vh, 1, -1], [vx + vw, vy + vh, -1, -1]
  ];
  esquinas.forEach(function (e) {
    ctx.beginPath();
    ctx.moveTo(e[0] + e[2] * largo, e[1]);
    ctx.lineTo(e[0], e[1]);
    ctx.lineTo(e[0], e[1] + e[3] * largo);
    ctx.stroke();
  });
  ctx.shadowBlur = 0;

  // Línea de barrido
  const t = (ahora % 2200) / 2200;
  const tri = t < 0.5 ? t * 2 : (1 - t) * 2;
  const y = vy + vh * (0.08 + tri * 0.84);
  const grad = ctx.createLinearGradient(vx, y, vx + vw, y);
  grad.addColorStop(0, "rgba(200,255,0,0)");
  grad.addColorStop(0.5, "rgba(200,255,0,0.9)");
  grad.addColorStop(1, "rgba(200,255,0,0)");
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(vx + 6, y);
  ctx.lineTo(vx + vw - 6, y);
  ctx.stroke();

  // Ondas del destello
  if (leyendo) {
    ctx.strokeStyle = "rgba(74,222,128," + (alpha * 0.6) + ")";
    ctx.lineWidth = 2;
    for (let i = 1; i <= 2; i++) {
      const off = alpha * 26 * i;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(vx - off, vy - off, vw + off * 2, vh + off * 2, radio + off);
      else ctx.rect(vx - off, vy - off, vw + off * 2, vh + off * 2);
      ctx.stroke();
    }
  }
}

/* ── lectura: agrega al carrito y apila la fila ────────────────────────── */
function catEscLeido(codigo) {
  const ahora = Date.now();
  // El mismo código seguido no debe contar como lectura nueva cada 150 ms.
  if (codigo === ESC.ultimoCodigo && ahora - ESC.ultimoT < 2200) return;
  ESC.ultimoCodigo = codigo;
  ESC.ultimoT = ahora;
  ESC.destello = performance.now();
  escVibrar(28);
  escPitar();

  catEscEstado("Buscando " + codigo + "…");
  catPorCodigo(codigo).then(function (p) {
    if (!p) {
      catEscEstado("Código " + codigo + " no está en tu base", "error");
      return;
    }
    catCarroAgregar(p, 1);
    const it = ESC.items.find(function (x) { return x.codigo === p.codigo; });
    if (it) {
      it.cantidad += 1;
      it.precio = Number(p.precio || 0);
      catEscPintar(String(p.codigo));
    } else {
      ESC.items.unshift({
        codigo: p.codigo,
        nombre: p.nombre || "(sin nombre)",
        precio: Number(p.precio || 0),
        cantidad: 1,
        categoria: p.categoria || "otros",
        imagen: catFicha(p).imagen || ""
      });
      catEscPintar(String(p.codigo));
    }
    catEscEstado("Agregado: " + (p.nombre || codigo), "ok");
  });
}

/* ── panel inferior con animación de precios ───────────────────────────── */
function catAnimarNumero(el, desde, hasta) {
  if (!el) return;
  const ini = performance.now();
  const dur = 420;
  const paso = function (t) {
    const k = Math.min(1, (t - ini) / dur);
    const e = 1 - Math.pow(1 - k, 3);   // ease-out cúbico
    const v = desde + (hasta - desde) * e;
    el.textContent = invClp(v);
    if (k < 1) requestAnimationFrame(paso);
    else el.textContent = invClp(hasta);
  };
  requestAnimationFrame(paso);
}

function catEscPintar(nuevoCodigo, primera) {
  const lista = document.getElementById("escLista");
  const totalEl = document.getElementById("escTotal");
  const cuenta = document.getElementById("escCuenta");
  if (!lista) return;

  if (!ESC.items.length) {
    lista.innerHTML = '<div class="esc-vacio">Apunta al código de barras.<br>Los productos se van sumando aquí.</div>';
  } else {
    lista.innerHTML = ESC.items.map(function (it) {
      const t = catTinte(it.categoria);
      return '<div class="esc-fila' + (it.codigo === nuevoCodigo ? " entra" : "") + '" ' +
          'style="--cat-tinte:' + t.fondo + ';--cat-tinte-txt:' + t.texto + '">' +
        '<span class="esc-fila-thumb">' +
          (it.imagen ? '<img src="' + esc(it.imagen) + '" alt="" onerror="this.remove()" />' : catMotivo(it.categoria, 22)) +
        '</span>' +
        '<span class="esc-fila-info"><b>' + esc(it.nombre) + '</b>' +
          '<span class="esc-fila-cod">' + esc(it.codigo) + '</span></span>' +
        '<span class="esc-fila-cant">x' + it.cantidad + '</span>' +
        '<b class="esc-fila-precio' + (it.codigo === nuevoCodigo ? " sube" : "") + '">' +
          invClp(it.precio * it.cantidad) + '</b>' +
      '</div>';
    }).join("");
  }

  const total = ESC.items.reduce(function (a, x) { return a + x.precio * x.cantidad; }, 0);
  const n = ESC.items.reduce(function (a, x) { return a + x.cantidad; }, 0);
  if (cuenta) cuenta.textContent = n + (n === 1 ? " producto" : " productos");
  if (totalEl) catAnimarNumero(totalEl, ESC.totalMostrado, total);
  ESC.total = total;
  ESC.totalMostrado = total;

  const panel = document.getElementById("escPanel");
  if (panel) panel.classList.toggle("con-items", ESC.items.length > 0);
}

function catEscLimpiar() {
  ESC.items = [];
  ESC.total = 0;
  ESC.totalMostrado = 0;
  catEscPintar(null, true);
  const t = document.getElementById("escTotal");
  if (t) t.textContent = invClp(0);
}

/* ── luz piloto de conexión ────────────────────────────────────────────── */
const CONEXION = { estado: "espera", ms: 0, ts: 0, timer: 0, corriendo: false };

function conexionIniciar() {
  if (CONEXION.corriendo) return;
  CONEXION.corriendo = true;
  window.addEventListener("online", function () { conexionPing(); });
  window.addEventListener("offline", function () { conexionPintar("error", 0, "Sin internet"); });
  conexionPing();
  CONEXION.timer = setInterval(conexionPing, 45000);
}

function conexionPing() {
  if (navigator.onLine === false) { conexionPintar("error", 0, "Sin internet"); return; }
  conexionPintar("espera", 0, "Verificando…");
  const t0 = Date.now();
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const limite = setTimeout(function () { if (ctrl) ctrl.abort(); }, 6000);
  fetch("https://fabri-api.vercel.app/api/health", { cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
    .then(function (r) {
      clearTimeout(limite);
      const ms = Date.now() - t0;
      if (r.ok) conexionPintar(ms > 2500 ? "aviso" : "ok", ms, ms > 2500 ? "Nube lenta" : "En línea");
      else conexionPintar("aviso", ms, "Nube HTTP " + r.status);
    }).catch(function () {
      clearTimeout(limite);
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
    // En la barra del módulo el piloto va compacto: ahí manda el título.
    if (id === "catPiloto") {
      el.innerHTML = "<i></i>" + esc(texto);
      el.title = texto + (ms ? " · " + ms + " ms" : "") + " · " + hh;
      return;
    }
    el.innerHTML = "<i></i>" + esc(texto) + (ms ? " · " + ms + " ms" : "") + " · " + hh;
  });
}

/* ── eventos ───────────────────────────────────────────────────────────── */
(function catMontar() {
  document.addEventListener("click", function (ev) {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    if (t.closest("#btnCatLector")) { catEscAbrir(); return; }
    if (t.closest("#escCerrar")) { catEscCerrar(); return; }
    if (t.closest("#escLimpiar")) { catEscLimpiar(); return; }
    if (t.closest("#escLinterna")) { escLinternaToggle(); return; }
    if (t.closest("#escPagar")) {
      catEscApagar();
      ESC.abierto = false;
      catPintarCarrito();
      catIrPagar();
      return;
    }
    if (t.closest("#escSeguir")) { catEscCerrar(); return; }
    if (t.closest("#catVolver")) {
      if (CAT.vista === "escaner") { catEscCerrar(); return; }
      catIr("catalogo");
      return;
    }
    if (t.closest("#catBtnCarro")) { catPintarCarrito(); catIr("carrito"); return; }
    if (t.closest("#catIrPagar")) { catIrPagar(); return; }
    if (t.closest("#catAgregarDetalle")) { catProductoAgregar(); return; }
    if (t.closest("#catSeguirComprando")) { catIr("catalogo"); return; }
    if (t.closest("#catVolverTienda")) { catIr("catalogo"); return; }
    if (t.closest("#catVolverTienda2")) { catIr("catalogo"); return; }
  });
  document.addEventListener("input", function (ev) {
    if (ev.target && ev.target.id === "catBuscar") catBuscar(ev.target.value);
  });
  const form = document.getElementById("catFormPedido");
  if (form) form.addEventListener("submit", catConfirmarPedido);
})();
